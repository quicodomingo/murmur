//! Murmur outside its main window: the menu bar icon (idle, meeting nearby, recording), the
//! recording indicator on the right edge of the screen, the floating alert ("Reunió detectada", "Comença d'aquí a 2 minuts"), the watcher that notices
//! other apps using the mic and the one that looks for upcoming meetings in the calendar.

use std::collections::HashSet;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::calendar;
use crate::micwatch;

const TRAY_IDLE: &[u8] = include_bytes!("../icons/menubar/MenuBarTemplate@2x.png");
const TRAY_ALERT: &[u8] = include_bytes!("../icons/menubar/MenuBarAlertTemplate@2x.png");
const TRAY_RECORDING: &[u8] = include_bytes!("../icons/menubar/MenuBarRecording@2x.png");

/// The alert window: a 470 pt card plus room for its close button and shadow.
const TOAST_SIZE: (f64, f64) = (512.0, 120.0);
/// The recording indicator: a 40 × ~150 pt pill plus room for its shadow.
const INDICATOR_SIZE: (f64, f64) = (60.0, 172.0);
/// The main window in compact mode (notes only, next to the call).
const COMPACT_SIZE: (f64, f64) = (380.0, 600.0);
/// The main window's minimum size outside compact mode (tauri.conf.json).
const MAIN_MIN_SIZE: (f64, f64) = (900.0, 600.0);
/// Seconds an alert stays before going away on its own.
const TOAST_SECONDS: u32 = 20;
/// The calendar alert shows this long before a meeting starts (and up to a minute after).
const CALENDAR_LEAD_S: f64 = 120.0;
const CALENDAR_LATE_S: f64 = 60.0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Toast {
    /// "detected": another app is using the microphone; "calendar": a meeting is about to start.
    pub kind: &'static str,
    pub title: String,
    /// The app using the microphone (detected), or the video call service, if any (calendar).
    pub subtitle: String,
    /// When the meeting starts, in ms since 1970 (calendar): the window counts down to it.
    pub start: Option<f64>,
    pub seconds: u32,
    /// Changes with every alert, so the window restarts its countdown.
    pub id: u64,
}

#[derive(Default)]
pub struct Shell {
    tray: Mutex<Option<TrayIcon>>,
    start_item: Mutex<Option<MenuItem<tauri::Wry>>>,
    toast: Mutex<Option<Toast>>,
    recording: AtomicBool,
    detect: AtomicBool,
    /// Show the recording indicator while recording (Settings › General).
    indicator: AtomicBool,
    /// The indicator was placed once: later recordings keep where the user dragged it.
    indicator_placed: AtomicBool,
    /// Clicking the indicator opens Murmur in compact mode (Settings › General).
    compact_enabled: AtomicBool,
    /// Where the main window was before compact mode (position, size), to put it back.
    compact_frame: Mutex<Option<(LogicalPosition<f64>, LogicalSize<f64>)>>,
    /// Apps whose alert was closed: not shown again until they stop using the microphone.
    dismissed: Mutex<HashSet<String>>,
    next_id: Mutex<u64>,
    calendar: Mutex<calendar::Watch>,
    /// Calendar events already announced (id + start), so each one alerts once.
    announced: Mutex<HashSet<String>>,
}

#[derive(Clone, Copy)]
enum TrayState {
    Idle,
    Alert,
    Recording,
}

fn shell(app: &AppHandle) -> tauri::State<'_, Shell> {
    app.state::<Shell>()
}

fn set_tray(app: &AppHandle, state: TrayState) {
    let shell = shell(app);
    if let Some(tray) = shell.tray.lock().unwrap().as_ref() {
        let (bytes, template) = match state {
            TrayState::Idle => (TRAY_IDLE, true),
            TrayState::Alert => (TRAY_ALERT, true),
            // The only coloured state: the red dot must show from afar.
            TrayState::Recording => (TRAY_RECORDING, false),
        };
        if let Ok(icon) = Image::from_bytes(bytes) {
            let _ = tray.set_icon(Some(icon));
            let _ = tray.set_icon_as_template(template);
        }
        let _ = tray.set_tooltip(Some(match state {
            TrayState::Recording => "Murmur: gravant",
            _ => "Murmur",
        }));
    }
    if let Some(item) = shell.start_item.lock().unwrap().as_ref() {
        let _ = item.set_text(if matches!(state, TrayState::Recording) { "Atura la gravació" } else { "Comença a gravar" });
    }
}

fn refresh_tray(app: &AppHandle) {
    let shell = shell(app);
    let state = if shell.recording.load(Ordering::Relaxed) {
        TrayState::Recording
    } else if shell.toast.lock().unwrap().is_some() {
        TrayState::Alert
    } else {
        TrayState::Idle
    };
    set_tray(app, state);
}

/// Brings the main window back (it hides instead of closing, see `run`).
pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Called when a recording starts or stops.
pub fn set_recording(app: &AppHandle, recording: bool) {
    shell(app).recording.store(recording, Ordering::Relaxed);
    if recording {
        hide_toast(app);
    }
    show_indicator(app, recording && shell(app).indicator.load(Ordering::Relaxed));
    refresh_tray(app);
}

/// The pill on the right edge of the screen while recording: open Murmur or stop.
fn show_indicator(app: &AppHandle, visible: bool) {
    let Some(w) = app.get_webview_window("indicator") else { return };
    if !visible {
        let _ = w.hide();
        return;
    }
    // First time: middle of the right edge of the main screen.
    if !shell(app).indicator_placed.swap(true, Ordering::Relaxed) {
        if let Ok(Some(monitor)) = w.primary_monitor() {
            let scale = monitor.scale_factor();
            let size = monitor.size().to_logical::<f64>(scale);
            let origin = monitor.position().to_logical::<f64>(scale);
            let _ = w.set_position(LogicalPosition::new(
                origin.x + size.width - INDICATOR_SIZE.0 - 2.0,
                origin.y + (size.height - INDICATOR_SIZE.1) / 2.0,
            ));
        }
    }
    let _ = w.show();
}

/// Settings › General › "Indicador de gravació" and "Mode compacte".
#[tauri::command]
pub fn set_indicator(app: AppHandle, enabled: bool, compact: bool) {
    shell(&app).indicator.store(enabled, Ordering::Relaxed);
    shell(&app).compact_enabled.store(compact, Ordering::Relaxed);
    show_indicator(&app, enabled && shell(&app).recording.load(Ordering::Relaxed));
}

/// The indicator's pill: bring Murmur back, in compact mode if it's turned on.
#[tauri::command]
pub fn indicator_open(app: AppHandle) {
    if shell(&app).compact_enabled.load(Ordering::Relaxed) {
        set_compact(app.clone(), true);
    }
    show_main(&app);
}

/// Compact mode: the main window becomes a narrow notes window, always in front, beside the
/// indicator; leaving it puts the window back where it was.
#[tauri::command]
pub fn set_compact(app: AppHandle, on: bool) {
    let Some(w) = app.get_webview_window("main") else { return };
    let scale = w.scale_factor().unwrap_or(1.0);
    let state = shell(&app);
    let mut saved = state.compact_frame.lock().unwrap();
    if on {
        if saved.is_none() {
            let (Ok(pos), Ok(size)) = (w.outer_position(), w.inner_size()) else { return };
            *saved = Some((pos.to_logical(scale), size.to_logical(scale)));
        }
        let _ = w.unmaximize();
        let _ = w.set_min_size(None::<LogicalSize<f64>>);
        let _ = w.set_size(LogicalSize::new(COMPACT_SIZE.0, COMPACT_SIZE.1));
        // To the left of the indicator, or at the right edge of the main screen.
        let indicator = app
            .get_webview_window("indicator")
            .filter(|i| i.is_visible().unwrap_or(false))
            .and_then(|i| i.outer_position().ok().map(|p| p.to_logical::<f64>(i.scale_factor().unwrap_or(1.0))));
        if let Ok(Some(monitor)) = w.primary_monitor() {
            let m = monitor.scale_factor();
            let size = monitor.size().to_logical::<f64>(m);
            let origin = monitor.position().to_logical::<f64>(m);
            let x = indicator.map_or(origin.x + size.width - INDICATOR_SIZE.0, |p| p.x) - COMPACT_SIZE.0 - 8.0;
            let y = indicator.map_or(origin.y + (size.height - COMPACT_SIZE.1) / 2.0, |p| p.y + INDICATOR_SIZE.1 / 2.0 - COMPACT_SIZE.1 / 2.0);
            let y = y.clamp(origin.y + 30.0, origin.y + size.height - COMPACT_SIZE.1);
            let _ = w.set_position(LogicalPosition::new(x.max(origin.x), y));
        }
        let _ = w.set_always_on_top(true);
    } else {
        let _ = w.set_always_on_top(false);
        let _ = w.set_min_size(Some(LogicalSize::new(MAIN_MIN_SIZE.0, MAIN_MIN_SIZE.1)));
        if let Some((pos, size)) = saved.take() {
            let _ = w.set_size(size);
            let _ = w.set_position(pos);
        }
    }
    drop(saved);
    let _ = app.emit_to("main", "compact", on);
}

/// The indicator's camera button: the main window takes the screenshot (it knows the meeting).
#[tauri::command]
pub fn indicator_capture(app: AppHandle) {
    let _ = app.emit_to("main", "capture-request", ());
}

/// The indicator's stop button: the main window stops the recording.
#[tauri::command]
pub fn indicator_stop(app: AppHandle) {
    let _ = app.emit_to("main", "stop-recording", ());
}

fn show_toast(app: &AppHandle, kind: &'static str, title: String, subtitle: String, start: Option<f64>, seconds: u32) {
    let toast = {
        let shell = shell(app);
        let mut next = shell.next_id.lock().unwrap();
        *next += 1;
        Toast { kind, title, subtitle, start, seconds, id: *next }
    };
    *shell(app).toast.lock().unwrap() = Some(toast.clone());
    if let Some(w) = app.get_webview_window("toast") {
        // Top right of the main screen, just under the menu bar.
        if let Ok(Some(monitor)) = w.primary_monitor() {
            let scale = monitor.scale_factor();
            let size = monitor.size().to_logical::<f64>(scale);
            let origin = monitor.position().to_logical::<f64>(scale);
            let _ = w.set_position(LogicalPosition::new(origin.x + size.width - TOAST_SIZE.0 - 4.0, origin.y + 30.0));
        }
        let _ = w.emit("toast", &toast);
        let _ = w.show();
    }
    refresh_tray(app);
}

fn hide_toast(app: &AppHandle) {
    *shell(app).toast.lock().unwrap() = None;
    if let Some(w) = app.get_webview_window("toast") {
        let _ = w.hide();
    }
    refresh_tray(app);
}

/// The alert window asks what to show when it loads.
#[tauri::command]
pub fn current_toast(app: AppHandle) -> Option<Toast> {
    shell(&app).toast.lock().unwrap().clone()
}

/// Closed by hand or timed out: don't ask again for this app until it stops using the mic.
#[tauri::command]
pub fn dismiss_toast(app: AppHandle) {
    if let Some(toast) = shell(&app).toast.lock().unwrap().as_ref().filter(|t| t.kind == "detected") {
        shell(&app).dismissed.lock().unwrap().insert(toast.subtitle.clone());
    }
    hide_toast(&app);
}

/// "Comença a gravar" on the alert: the main window starts a meeting.
#[tauri::command]
pub fn toast_start(app: AppHandle) {
    hide_toast(&app);
    show_main(&app);
    let _ = app.emit_to("main", "start-recording", ());
}

#[tauri::command]
pub fn set_meeting_detection(app: AppHandle, enabled: bool) {
    shell(&app).detect.store(enabled, Ordering::Relaxed);
    if !enabled {
        hide_toast(&app);
    }
}

/// Settings › General › Calendaris: whether to alert and which calendars to watch.
#[tauri::command]
pub fn set_calendar_watch(app: AppHandle, watch: calendar::Watch) {
    let enabled = watch.enabled;
    *shell(&app).calendar.lock().unwrap() = watch;
    let calendar_shown = shell(&app).toast.lock().unwrap().as_ref().is_some_and(|t| t.kind == "calendar");
    if !enabled && calendar_shown {
        hide_toast(&app);
    }
}

/// The next meeting starting within `CALENDAR_LEAD_S` (or that just started) not yet announced.
fn upcoming_meeting(app: &AppHandle) -> Option<calendar::EventInfo> {
    let watch = shell(app).calendar.lock().unwrap().clone();
    if !watch.enabled {
        return None;
    }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_secs_f64() * 1000.0;
    let announced = shell(app).announced.lock().unwrap().clone();
    calendar::events(now - CALENDAR_LATE_S * 1000.0, now + CALENDAR_LEAD_S * 1000.0, watch.calendar_ids.as_deref())
        .into_iter()
        .filter(|e| e.start >= now - CALENDAR_LATE_S * 1000.0 && e.start <= now + CALENDAR_LEAD_S * 1000.0)
        .filter(|e| watch.include_no_guests || e.is_meeting())
        .filter(|e| !announced.contains(&format!("{}@{}", e.id, e.start)))
        .min_by(|a, b| a.start.total_cmp(&b.start))
}

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let handle = app.handle();

    // Menu bar icon and its menu.
    let start = MenuItem::with_id(handle, "tray-start", "Comença a gravar", true, None::<&str>)?;
    let menu = Menu::with_items(
        handle,
        &[
            &start,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "tray-open", "Obre Murmur", true, None::<&str>)?,
            &MenuItem::with_id(handle, "tray-settings", "Configuració…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "tray-quit", "Surt de Murmur", true, None::<&str>)?,
        ],
    )?;
    let tray = TrayIconBuilder::with_id("murmur")
        .icon(Image::from_bytes(TRAY_IDLE)?)
        .icon_as_template(true)
        .tooltip("Murmur")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-start" => {
                show_main(app);
                let recording = shell(app).recording.load(Ordering::Relaxed);
                let _ = app.emit_to("main", if recording { "stop-recording" } else { "start-recording" }, ());
            }
            "tray-open" => show_main(app),
            "tray-settings" => {
                show_main(app);
                let _ = app.emit_to("main", "open-settings", ());
            }
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .build(handle)?;
    *shell(handle).tray.lock().unwrap() = Some(tray);
    *shell(handle).start_item.lock().unwrap() = Some(start);

    // The alert: a transparent, borderless window that floats over everything.
    WebviewWindowBuilder::new(handle, "toast", WebviewUrl::App("index.html".into()))
        .title("Murmur")
        .inner_size(TOAST_SIZE.0, TOAST_SIZE.1)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()?;

    // The recording indicator: like the alert, transparent and above everything.
    WebviewWindowBuilder::new(handle, "indicator", WebviewUrl::App("index.html".into()))
        .title("Murmur")
        .inner_size(INDICATOR_SIZE.0, INDICATOR_SIZE.1)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .accept_first_mouse(true)
        .visible(false)
        .build()?;

    // Meeting detection: watch which other apps use the microphone.
    let app = handle.clone();
    std::thread::spawn(move || {
        let mut previous: HashSet<String> = HashSet::new();
        loop {
            std::thread::sleep(Duration::from_millis(1500));
            let users: HashSet<String> = micwatch::mic_users().into_iter().map(|u| u.name).collect();
            let shell = shell(&app);
            // An app that let go of the microphone may ask again next time.
            shell.dismissed.lock().unwrap().retain(|s| users.iter().any(|u| s.starts_with(u.as_str())));
            let active = shell.detect.load(Ordering::Relaxed) && !shell.recording.load(Ordering::Relaxed);
            // Only "Reunió detectada" follows the microphone; a calendar alert stays.
            let shown = shell.toast.lock().unwrap().as_ref().filter(|t| t.kind == "detected").map(|t| t.subtitle.clone());
            let calendar_shown = shell.toast.lock().unwrap().as_ref().is_some_and(|t| t.kind == "calendar");
            if let Some(subtitle) = &shown {
                if !active || !users.iter().any(|u| subtitle.starts_with(u.as_str())) {
                    hide_toast(&app);
                }
            }
            if active && !calendar_shown {
                let dismissed = shell.dismissed.lock().unwrap().clone();
                if let Some(name) = users.difference(&previous).find(|n| !dismissed.iter().any(|d| d.starts_with(n.as_str()))) {
                    show_toast(&app, "detected", "Reunió detectada".into(), format!("{name} fa servir el micròfon"), None, TOAST_SECONDS);
                }
            }
            previous = users;
        }
    });

    // Calendar alert: a meeting in the watched calendars is about to start.
    let app = handle.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(20));
        if shell(&app).recording.load(Ordering::Relaxed) {
            continue;
        }
        let Some(event) = upcoming_meeting(&app) else { continue };
        shell(&app).announced.lock().unwrap().insert(format!("{}@{}", event.id, event.start));
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0.0, |d| d.as_secs_f64() * 1000.0);
        // Until a minute after it starts, at least half a minute.
        let seconds = (((event.start - now) / 1000.0 + CALENDAR_LATE_S).max(30.0)) as u32;
        show_toast(&app, "calendar", event.title, event.platform.unwrap_or_default(), Some(event.start), seconds);
    });
    Ok(())
}
