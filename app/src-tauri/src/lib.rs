pub mod aec;
pub mod audio;
pub mod calendar;
pub mod db;
pub mod diarize;
pub mod engine;
pub mod llm;
pub mod micwatch;
pub mod models;
pub mod punctuate;
pub mod permissions;
pub mod pipeline;
pub mod recorder;
pub mod shell;
pub mod storage;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use crossbeam_channel::{RecvTimeoutError, Sender, unbounded};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use engine::{Models, SAMPLE_RATE, models_dir};
use pipeline::Pipeline;

#[derive(Default)]
struct AppState {
    models: Mutex<Option<Arc<Models>>>,
    recording: Mutex<Option<Recording>>,
    db: Mutex<Option<db::Db>>,
    /// Input level preview in the settings window.
    monitor: Mutex<Option<Sender<()>>>,
    /// Optional models: loaded on first use, dropped when deleted (the LLM also after each job).
    llm: Mutex<Option<Arc<llm::Llm>>>,
    /// One LLM job at a time: two would need twice the memory.
    llm_job: Mutex<()>,
    punctuator: Mutex<Option<punctuate::Punctuator>>,
    /// Downloads in progress, by model id, with their cancel flag.
    downloads: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

struct Recording {
    stop: Sender<()>,
    stopped: Arc<AtomicBool>,
    audio: JoinHandle<()>,
    worker: JoinHandle<()>,
}

#[derive(Clone, Serialize)]
struct Level {
    rms: f32,
}

fn models(state: &AppState) -> Result<Arc<Models>, String> {
    let mut slot = state.models.lock().unwrap();
    if slot.is_none() {
        *slot = Some(Arc::new(
            Models::load(&models_dir()).map_err(|e| format!("{e:#}"))?,
        ));
    }
    Ok(slot.clone().unwrap())
}

/// Loads models ahead of time so the first recording starts instantly.
#[tauri::command]
async fn prepare(state: State<'_, AppState>) -> Result<(), String> {
    models(&state).map(|_| ())
}

#[tauri::command]
async fn start_recording(
    app: AppHandle,
    state: State<'_, AppState>,
    max_speakers: usize,
    threshold: f32,
    mic: bool,
    mic_device: Option<String>,
    system: bool,
    meeting_id: String,
    save_audio: bool,
    recordings_dir: Option<String>,
    verify_speakers: bool,
    room_speakers: bool,
) -> Result<Option<String>, String> {
    if state.recording.lock().unwrap().is_some() {
        return Err("Ja s'està gravant".into());
    }
    let models = models(&state)?;
    let (audio_tx, audio_rx) = unbounded::<audio::Frame>();
    let (stop_tx, stop_rx) = unbounded::<()>();
    let (ready_tx, ready_rx) = unbounded::<Result<(), String>>();

    // cpal streams aren't Send on macOS: own the stream in its own thread until told to stop.
    let simulate = std::env::var("TRANSCRIPTOR_SIMULATE").ok();
    // The simulator plays a recording as if it were the remote side of a call.
    let (mic, system) = if simulate.is_some() {
        (false, true)
    } else {
        (mic, system)
    };
    let audio = std::thread::spawn(move || match simulate {
        Some(path) => {
            let _ = ready_tx.send(Ok(()));
            if let Err(e) = audio::simulate_from_file(&path, audio_tx, stop_rx) {
                log::error!("{e:#}");
            }
        }
        None => match audio::start_capture(mic, mic_device.as_deref(), system, audio_tx) {
            Ok(stream) => {
                let _ = ready_tx.send(Ok(()));
                let _ = stop_rx.recv();
                drop(stream);
            }
            Err(e) => {
                let _ = ready_tx.send(Err(format!("{e:#}")));
            }
        },
    });
    ready_rx.recv().map_err(|e| e.to_string())??;
    shell::set_recording(&app, true);

    let audio_path = if save_audio {
        // The folder chosen in the settings, or the app's own data folder.
        let dir = match recordings_dir.filter(|d| !d.is_empty()) {
            Some(d) => std::path::PathBuf::from(d),
            None => app
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .join("recordings"),
        };
        Some(dir.join(format!("{}.ogg", safe_id(&meeting_id))))
    } else {
        None
    };
    let recorder = match &audio_path {
        Some(path) => Some(
            recorder::Recorder::create(path, Pipeline::record_channels(mic, system))
                .map_err(|e| format!("{e:#}"))?,
        ),
        None => None,
    };
    // Audio of the channel whose speakers the final pass re-checks (only when it will run).
    let tap_path = verify_speakers
        .then(|| app.path().app_cache_dir().ok())
        .flatten()
        .map(|d| d.join("final-pass"))
        .and_then(|d| std::fs::create_dir_all(&d).ok().map(|_| d))
        .map(|d| d.join(format!("{}.pcm", safe_id(&meeting_id))));
    let stopped = Arc::new(AtomicBool::new(false));
    let stopped_worker = stopped.clone();
    let final_pass_meeting = meeting_id.clone();

    let worker = std::thread::spawn(move || {
        let mut pipeline = match Pipeline::new(
            &models,
            mic,
            system,
            max_speakers,
            threshold,
            recorder,
            tap_path,
        ) {
            Ok(p) => p,
            Err(e) => {
                let _ = app.emit("transcript-error", format!("{e:#}"));
                return;
            }
        };
        // A call with nobody else in the room: the microphone is only the user.
        if mic && system && !room_speakers {
            pipeline.single_mic_speaker();
        }
        let emit = |events: Vec<engine::Event>| {
            for event in events {
                let _ = app.emit("transcript", event);
            }
        };
        let mut level_samples = 0usize;
        loop {
            // Normally ends when the audio thread drops the streams and the sender disconnects;
            // the flag covers capture backends that keep their handler alive a bit longer.
            let (source, samples) = match audio_rx.recv_timeout(Duration::from_millis(150)) {
                Ok(frame) => frame,
                Err(RecvTimeoutError::Timeout) if stopped_worker.load(Ordering::Relaxed) => break,
                Err(RecvTimeoutError::Timeout) => {
                    emit(pipeline.tick());
                    continue;
                }
                Err(RecvTimeoutError::Disconnected) => break,
            };
            level_samples += samples.len();
            if level_samples >= SAMPLE_RATE / 20 && !samples.is_empty() {
                level_samples = 0;
                let rms =
                    (samples.iter().map(|x| x * x).sum::<f32>() / samples.len() as f32).sqrt();
                let _ = app.emit("level", Level { rms });
            }
            emit(pipeline.push(source, &samples));
            emit(pipeline.tick());
        }
        let tapped = match pipeline.finish() {
            Ok((events, tapped)) => {
                emit(events);
                tapped
            }
            Err(e) => {
                let _ = app.emit("transcript-error", format!("{e:#}"));
                None
            }
        };
        let _ = app.emit("transcript-done", ());
        shell::set_recording(&app, false);
        // Runs on its own thread so stopping returns at once; the UI shows its progress.
        // Without it, "final-pass-done" still follows so the UI can go on (punctuation, cover).
        match tapped {
            Some(tapped) => {
                std::thread::spawn(move || {
                    final_pass(app, final_pass_meeting, tapped, max_speakers)
                });
            }
            None => {
                let _ = app.emit(
                    "final-pass-done",
                    FinalPassDone { meeting_id: final_pass_meeting, error: None },
                );
            }
        }
    });

    *state.recording.lock().unwrap() = Some(Recording {
        stop: stop_tx,
        stopped,
        audio,
        worker,
    });
    Ok(audio_path.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn stop_recording(state: State<'_, AppState>) -> Result<(), String> {
    let Some(rec) = state.recording.lock().unwrap().take() else {
        return Ok(());
    };
    rec.stopped.store(true, Ordering::Relaxed);
    let _ = rec.stop.send(());
    tauri::async_runtime::spawn_blocking(move || {
        let _ = rec.audio.join();
        let _ = rec.worker.join();
    })
    .await
    .map_err(|e| e.to_string())
}

/// Ids come from the UI: keep only characters that are safe in a file name.
fn safe_id(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect()
}

/// 0.116 measured on an M4 base (window 0.2, see diarize_probe), with margin for slower Macs.
/// Only drives the estimate shown in the UI.
const DIARIZE_RTF_ESTIMATE: f32 = 0.15;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FinalPassStarted {
    meeting_id: String,
    stage: &'static str,
    estimate_seconds: f32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FinalPassSpeakers {
    meeting_id: String,
    base: usize,
    assignments: Vec<diarize::Assignment>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FinalPassDone {
    meeting_id: String,
    error: Option<String>,
}

/// "PDF o envia…" on the cover: the system print panel (Save as PDF, Mail, Messages…).
#[tauri::command]
fn print_page(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

/// After a recording: re-check who spoke when over the whole tapped channel.
fn final_pass(app: AppHandle, meeting_id: String, tapped: pipeline::Tapped, max_speakers: usize) {
    let result = (|| -> anyhow::Result<()> {
        if tapped.spans.is_empty() {
            return Ok(());
        }
        let samples = pipeline::read_tap(&tapped.path)?;
        let seconds = samples.len() as f32 / SAMPLE_RATE as f32;
        let _ = app.emit(
            "final-pass",
            FinalPassStarted {
                meeting_id: meeting_id.clone(),
                stage: "speakers",
                estimate_seconds: seconds * DIARIZE_RTF_ESTIMATE,
            },
        );
        let turns = diarize::diarize(&models_dir(), &samples, diarize::Options::default())?;
        let mut assignments = diarize::assign(&tapped.spans, &turns, tapped.base);
        // More voices than the user expects: redo the clustering with their maximum.
        if diarize::speaker_count(&assignments) > max_speakers {
            let opts = diarize::Options {
                num_speakers: Some(max_speakers),
                ..Default::default()
            };
            let turns = diarize::diarize(&models_dir(), &samples, opts)?;
            assignments = diarize::assign(&tapped.spans, &turns, tapped.base);
        }
        let assignments =
            diarize::absorb_small_speakers(&models_dir(), &samples, &tapped.spans, assignments, tapped.base)?;
        let _ = app.emit(
            "final-pass-speakers",
            FinalPassSpeakers {
                meeting_id: meeting_id.clone(),
                base: tapped.base,
                assignments,
            },
        );
        Ok(())
    })();
    let _ = std::fs::remove_file(&tapped.path);
    let _ = app.emit(
        "final-pass-done",
        FinalPassDone {
            meeting_id,
            error: result.err().map(|e| format!("{e:#}")),
        },
    );
}

// --- Optional models ---------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    id: String,
    done: u64,
    total: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadDone {
    id: String,
    error: Option<String>,
    cancelled: bool,
}

#[tauri::command]
async fn model_status() -> Vec<models::Status> {
    let root = models_dir();
    models::ALL.iter().map(|m| m.status(&root)).collect()
}

/// Starts downloading a model; "model-download" reports progress, "model-download-done" the end.
#[tauri::command]
async fn download_model(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    let model = models::find(&id).map_err(|e| e.to_string())?;
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut downloads = state.downloads.lock().unwrap();
        if downloads.contains_key(&id) {
            return Ok(());
        }
        downloads.insert(id.clone(), cancel.clone());
    }
    std::thread::spawn(move || {
        let result = model.download(&models_dir(), &cancel, |done, total| {
            let _ = app.emit("model-download", DownloadProgress { id: id.clone(), done, total });
        });
        app.state::<AppState>().downloads.lock().unwrap().remove(&id);
        let cancelled = cancel.load(Ordering::Relaxed);
        let error = result.err().filter(|_| !cancelled).map(|e| format!("{e:#}"));
        let _ = app.emit("model-download-done", DownloadDone { id, error, cancelled });
    });
    Ok(())
}

#[tauri::command]
async fn cancel_model_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if let Some(cancel) = state.downloads.lock().unwrap().get(&id) {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
async fn delete_model(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let model = models::find(&id).map_err(|e| e.to_string())?;
    if model.required {
        return Err("Murmur necessita aquest model per transcriure".into());
    }
    if state.downloads.lock().unwrap().contains_key(&id) {
        return Err("Primer atura la descàrrega".into());
    }
    match model.id {
        "llm" => {
            let _job = state.llm_job.lock().unwrap();
            *state.llm.lock().unwrap() = None;
        }
        _ => *state.punctuator.lock().unwrap() = None,
    }
    model.delete(&models_dir()).map_err(|e| format!("{e:#}"))
}

/// Punctuates consecutive utterances (`punctuate.rs`); returns their new text.
#[tauri::command]
async fn punctuate(app: AppHandle, texts: Vec<String>, speakers: Vec<i32>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut slot = state.punctuator.lock().unwrap();
        if slot.is_none() {
            let dir = models::PUNCTUATION.path(&models_dir());
            *slot = Some(punctuate::Punctuator::load(&dir).map_err(|e| format!("{e:#}"))?);
        }
        slot.as_mut().unwrap().punctuate(&texts, &speakers).map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LlmTask {
    id: String,
    prompt: String,
    max_tokens: usize,
    /// JSON schema the answer must follow.
    schema: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmResult {
    id: String,
    text: Option<String>,
    error: Option<String>,
    seconds: f32,
    tokens: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmProgress {
    job: String,
    /// "loading", "reading", or the id of the task being answered.
    step: String,
    done: usize,
    total: usize,
    /// Seconds spent reading the document (once known).
    read_seconds: Option<f32>,
}

/// Reads `document` once and answers each task about it ("llm-progress" events along the way).
/// The model stays loaded with `keep_loaded` (trying out prompts); otherwise it's freed at the end.
#[tauri::command]
async fn run_llm(
    app: AppHandle,
    job: String,
    system: String,
    document: String,
    tasks: Vec<LlmTask>,
    keep_loaded: bool,
) -> Result<Vec<LlmResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _job = state.llm_job.lock().unwrap();
        let progress = |step: &str, done: usize, read_seconds: Option<f32>| {
            let _ = app.emit(
                "llm-progress",
                LlmProgress { job: job.clone(), step: step.into(), done, total: tasks.len(), read_seconds },
            );
        };
        let loaded = state.llm.lock().unwrap().clone();
        let llm = match loaded {
            Some(llm) => llm,
            None => {
                progress("loading", 0, None);
                let path = models::LLM.file(&models_dir(), 0);
                let llm = Arc::new(llm::Llm::load(&path).map_err(|e| format!("{e:#}"))?);
                *state.llm.lock().unwrap() = Some(llm.clone());
                llm
            }
        };
        progress("reading", 0, None);
        let results = (|| -> Result<Vec<LlmResult>, String> {
            let mut session = llm.session(&system, &document).map_err(|e| format!("{e:#}"))?;
            let read = Some(session.read_seconds);
            let mut results = Vec::with_capacity(tasks.len());
            for (i, task) in tasks.iter().enumerate() {
                progress(&task.id, i, read);
                let answer = session.ask(&task.prompt, task.max_tokens, task.schema.as_deref());
                results.push(match answer {
                    Ok(a) => LlmResult {
                        id: task.id.clone(),
                        text: Some(a.text),
                        error: None,
                        seconds: a.seconds,
                        tokens: a.generated_tokens,
                    },
                    Err(e) => LlmResult {
                        id: task.id.clone(),
                        text: None,
                        error: Some(format!("{e:#}")),
                        seconds: 0.0,
                        tokens: 0,
                    },
                });
            }
            progress("done", tasks.len(), read);
            Ok(results)
        })();
        if !keep_loaded {
            *state.llm.lock().unwrap() = None;
        }
        results
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Frees the language model (closing the prompt editor).
#[tauri::command]
async fn release_llm(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _job = state.llm_job.lock().unwrap();
        *state.llm.lock().unwrap() = None;
    })
    .await
    .map_err(|e| e.to_string())
}

/// Opens the database on first use, importing the JSON files of earlier versions.
fn with_db<T>(
    app: &AppHandle,
    f: impl FnOnce(&mut db::Db) -> anyhow::Result<T>,
) -> Result<T, String> {
    let state = app.state::<AppState>();
    let mut slot = state.db.lock().unwrap();
    if slot.is_none() {
        let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let mut database =
            db::Db::open(&data.join("transcriptor.sqlite3")).map_err(|e| format!("{e:#}"))?;
        if database.is_empty().map_err(|e| format!("{e:#}"))? {
            match db::migrate_json(&mut database, &storage::meetings_dir(&data)) {
                Ok(0) => {}
                Ok(n) => log::info!("imported {n} meetings from JSON files"),
                Err(e) => log::error!("JSON import failed: {e:#}"),
            }
        }
        *slot = Some(database);
    }
    f(slot.as_mut().unwrap()).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn list_meetings(app: AppHandle) -> Result<Vec<db::Summary>, String> {
    with_db(&app, |db| db.list())
}

#[tauri::command]
async fn get_meeting(app: AppHandle, id: String) -> Result<Option<serde_json::Value>, String> {
    with_db(&app, |db| db.get(&id))
}

/// Creates or fully replaces a meeting (new recordings, migration from the webview's storage).
#[tauri::command]
async fn put_meeting(app: AppHandle, meeting: serde_json::Value) -> Result<(), String> {
    with_db(&app, |db| db.put(&meeting))
}

#[tauri::command]
async fn apply_changes(app: AppHandle, id: String, changes: db::Changes) -> Result<(), String> {
    with_db(&app, |db| db.apply(&id, changes))
}

#[tauri::command]
async fn search_meetings(app: AppHandle, query: String) -> Result<Vec<db::Hit>, String> {
    with_db(&app, |db| db.search(&query, 60))
}

#[tauri::command]
async fn delete_meeting(
    app: AppHandle,
    id: String,
    audio_path: Option<String>,
) -> Result<(), String> {
    with_db(&app, |db| db.delete(&id))?;
    // Its recording too. Only ever an .ogg the app wrote (the path comes from the meeting).
    if let Some(path) = audio_path.map(std::path::PathBuf::from) {
        if path.extension().is_some_and(|e| e == "ogg") && path.exists() {
            std::fs::remove_file(path)
                .map_err(|e| format!("No s'ha pogut eliminar l'àudio: {e}"))?;
        }
    }
    Ok(())
}

/// Shows the selected microphone's level in the settings window ("mic-level" events).
#[tauri::command]
async fn start_mic_monitor(
    app: AppHandle,
    state: State<'_, AppState>,
    device: Option<String>,
) -> Result<(), String> {
    if let Some(stop) = state.monitor.lock().unwrap().take() {
        let _ = stop.send(());
    }
    let (stop_tx, stop_rx) = unbounded::<()>();
    let (ready_tx, ready_rx) = unbounded::<Result<(), String>>();
    std::thread::spawn(move || {
        let (tx, rx) = unbounded::<audio::Frame>();
        let capture = match audio::start_capture(true, device.as_deref(), false, tx) {
            Ok(c) => {
                let _ = ready_tx.send(Ok(()));
                c
            }
            Err(e) => {
                let _ = ready_tx.send(Err(format!("{e:#}")));
                return;
            }
        };
        let mut pending: Vec<f32> = vec![];
        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok((_, samples)) => pending.extend(samples),
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => break,
            }
            if pending.len() >= SAMPLE_RATE / 20 {
                let rms =
                    (pending.iter().map(|x| x * x).sum::<f32>() / pending.len() as f32).sqrt();
                pending.clear();
                let _ = app.emit("mic-level", Level { rms });
            }
        }
        drop(capture);
    });
    ready_rx.recv().map_err(|e| e.to_string())??;
    *state.monitor.lock().unwrap() = Some(stop_tx);
    Ok(())
}

#[tauri::command]
async fn stop_mic_monitor(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(stop) = state.monitor.lock().unwrap().take() {
        let _ = stop.send(());
    }
    Ok(())
}

#[tauri::command]
async fn list_microphones() -> Vec<String> {
    audio::list_microphones()
}

/// Writes an export to a path the user picked in the save dialog.
#[tauri::command]
async fn write_export(path: String, contents: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("No s'ha pogut desar el fitxer: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // The standard macOS menus (Edit gives copy/paste), with our own About window and
            // Settings… in the app menu.
            let menu = tauri::menu::Menu::default(app.handle())?;
            let about = tauri::menu::MenuItem::with_id(app, "about", "Quant a Murmur", true, None::<&str>)?;
            let settings = tauri::menu::MenuItem::with_id(
                app,
                "settings",
                "Configuració…",
                true,
                Some("CmdOrCtrl+,"),
            )?;
            if let Some(tauri::menu::MenuItemKind::Submenu(app_menu)) = menu.items()?.first() {
                app_menu.remove_at(0)?; // the standard About panel
                app_menu.insert(&about, 0)?;
                app_menu.insert(&settings, 1)?;
            }
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| match event.id().as_ref() {
                "settings" => {
                    let _ = app.emit_to("main", "open-settings", ());
                }
                "about" => {
                    shell::show_main(app);
                    let _ = app.emit_to("main", "open-about", ());
                }
                _ => {}
            });
            if let Ok(data) = app.path().app_data_dir() {
                engine::set_app_models_dir(data.join("models"));
            }
            shell::setup(app)?;
            Ok(())
        })
        .manage(AppState::default())
        .manage(shell::Shell::default())
        // Closing the window keeps Murmur in the menu bar (it still notices meetings).
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            prepare,
            start_recording,
            stop_recording,
            list_meetings,
            get_meeting,
            put_meeting,
            apply_changes,
            search_meetings,
            delete_meeting,
            list_microphones,
            start_mic_monitor,
            stop_mic_monitor,
            write_export,
            model_status,
            download_model,
            cancel_model_download,
            delete_model,
            punctuate,
            run_llm,
            release_llm,
            shell::current_toast,
            shell::dismiss_toast,
            shell::toast_start,
            shell::set_meeting_detection,
            shell::set_calendar_watch,
            print_page,
            calendar::calendar_access,
            calendar::request_calendar_access,
            calendar::list_calendars,
            calendar::calendar_events,
            permissions::permission_status,
            permissions::request_microphone,
            permissions::request_system_audio,
            permissions::open_privacy_settings
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // Clicking the Dock icon brings the hidden window back.
            if let tauri::RunEvent::Reopen { .. } = event {
                shell::show_main(app);
            }
        });
}
