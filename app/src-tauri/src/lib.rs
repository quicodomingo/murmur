pub mod aec;
pub mod audio;
pub mod engine;
pub mod pipeline;
pub mod recorder;
pub mod storage;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use crossbeam_channel::{RecvTimeoutError, Sender, unbounded};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use engine::{Models, SAMPLE_RATE, models_dir};
use pipeline::Pipeline;

#[derive(Default)]
struct AppState {
    models: Mutex<Option<Arc<Models>>>,
    recording: Mutex<Option<Recording>>,
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

    let audio_path = if save_audio {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("recordings");
        // The id comes from the UI: keep only safe characters for the file name.
        let name: String = meeting_id
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
            .collect();
        Some(dir.join(format!("{name}.ogg")))
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
    let stopped = Arc::new(AtomicBool::new(false));
    let stopped_worker = stopped.clone();

    let worker = std::thread::spawn(move || {
        let mut pipeline =
            match Pipeline::new(&models, mic, system, max_speakers, threshold, recorder) {
                Ok(p) => p,
                Err(e) => {
                    let _ = app.emit("transcript-error", format!("{e:#}"));
                    return;
                }
            };
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
        match pipeline.finish() {
            Ok(events) => emit(events),
            Err(e) => {
                let _ = app.emit("transcript-error", format!("{e:#}"));
            }
        }
        let _ = app.emit("transcript-done", ());
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

fn meetings_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(storage::meetings_dir(
        &app.path().app_data_dir().map_err(|e| e.to_string())?,
    ))
}

#[tauri::command]
async fn list_meetings(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    storage::list(&meetings_dir(&app)?).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn save_meeting(app: AppHandle, meeting: serde_json::Value) -> Result<(), String> {
    storage::save(&meetings_dir(&app)?, &meeting).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn delete_meeting(app: AppHandle, id: String) -> Result<(), String> {
    storage::delete(&meetings_dir(&app)?, &id).map_err(|e| format!("{e:#}"))?;
    // Its recording too, if one was saved (same id → same file name, see start_recording).
    let audio = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("recordings")
        .join(format!("{id}.ogg"));
    if id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && audio.exists() {
        std::fs::remove_file(audio).map_err(|e| format!("No s'ha pogut eliminar l'àudio: {e}"))?;
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
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            prepare,
            start_recording,
            stop_recording,
            list_meetings,
            save_meeting,
            delete_meeting,
            list_microphones,
            write_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
