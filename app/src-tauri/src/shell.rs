//! Murmur outside its main window: the menu bar icon (idle, meeting nearby, recording), the
//! floating alert ("Reunió detectada") and the watcher that notices other apps using the mic.

use std::collections::HashSet;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::micwatch;

const TRAY_IDLE: &[u8] = include_bytes!("../icons/menubar/MenuBarTemplate@2x.png");
const TRAY_ALERT: &[u8] = include_bytes!("../icons/menubar/MenuBarAlertTemplate@2x.png");
const TRAY_RECORDING: &[u8] = include_bytes!("../icons/menubar/MenuBarRecording@2x.png");

/// The alert window: a 470 pt card plus room for its close button and shadow.
const TOAST_SIZE: (f64, f64) = (512.0, 120.0);
/// Seconds an alert stays before going away on its own.
const TOAST_SECONDS: u32 = 20;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Toast {
    /// "detected": another app is using the microphone.
    pub kind: &'static str,
    pub title: String,
    pub subtitle: String,
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
    /// Apps whose alert was closed: not shown again until they stop using the microphone.
    dismissed: Mutex<HashSet<String>>,
    next_id: Mutex<u64>,
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
    refresh_tray(app);
}

fn show_toast(app: &AppHandle, title: String, subtitle: String) {
    let toast = {
        let shell = shell(app);
        let mut next = shell.next_id.lock().unwrap();
        *next += 1;
        Toast { kind: "detected", title, subtitle, seconds: TOAST_SECONDS, id: *next }
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
    if let Some(toast) = shell(&app).toast.lock().unwrap().as_ref() {
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
            let shown = shell.toast.lock().unwrap().as_ref().map(|t| t.subtitle.clone());
            if let Some(subtitle) = &shown {
                if !active || !users.iter().any(|u| subtitle.starts_with(u.as_str())) {
                    hide_toast(&app);
                }
            }
            if active {
                let dismissed = shell.dismissed.lock().unwrap().clone();
                if let Some(name) = users.difference(&previous).find(|n| !dismissed.iter().any(|d| d.starts_with(n.as_str()))) {
                    show_toast(&app, "Reunió detectada".into(), format!("{name} fa servir el micròfon"));
                }
            }
            previous = users;
        }
    });
    Ok(())
}
