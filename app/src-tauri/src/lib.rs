pub mod aec;
pub mod audio;
pub mod calendar;
pub mod capture;
pub mod db;
pub mod diarize;
pub mod engine;
pub mod gate;
pub mod i18n;
pub mod import;
pub mod cloud;
pub mod share;
pub mod llm;
pub mod mcp;
pub mod micwatch;
pub mod models;
pub mod punctuate;
pub mod permissions;
pub mod playback;
pub mod pipeline;
pub mod recorder;
pub mod retranscribe;
pub mod shell;
pub mod storage;
#[cfg(target_os = "macos")]
pub mod systap;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use crossbeam_channel::{RecvTimeoutError, Sender, unbounded};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use engine::{Channel, LiveModel, Models, SAMPLE_RATE, models_dir};
use i18n::tr;
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
    /// "Som més a la sala", which can change while recording.
    room: Arc<AtomicBool>,
    audio: JoinHandle<()>,
    worker: JoinHandle<()>,
}

#[derive(Clone, Serialize)]
struct Level {
    rms: f32,
}

/// The live models for a meeting's language; switching language replaces them (one set in memory).
fn models(state: &AppState, kind: LiveModel) -> Result<Arc<Models>, String> {
    let mut slot = state.models.lock().unwrap();
    if slot.as_ref().is_none_or(|m| m.kind != kind) {
        *slot = None;
        *slot = Some(Arc::new(
            Models::load(&models_dir(), kind).map_err(|e| format!("{e:#}"))?,
        ));
    }
    Ok(slot.clone().unwrap())
}

/// Loads models ahead of time so the first recording starts instantly.
#[tauri::command]
async fn prepare(state: State<'_, AppState>, language: String) -> Result<(), String> {
    models(&state, LiveModel::for_language(&language)).map(|_| ())
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
    language: String,
    final_text: bool,
    file: Option<String>,
) -> Result<Option<String>, String> {
    {
        // An opened file ends on its own, without stop_recording: once its worker is done, the
        // slot is free.
        let mut slot = state.recording.lock().unwrap();
        match slot.as_ref() {
            Some(rec) if rec.worker.is_finished() => *slot = None,
            Some(_) => return Err(tr!("already_recording").into()),
            None => {}
        }
    }
    // Whisper only for one language: told "Catalan", it turns Spanish into Catalan.
    let final_language = (final_text && matches!(language.as_str(), "ca" | "es" | "en")).then(|| language.clone());
    let models = models(&state, LiveModel::for_language(&language))?;
    let (audio_tx, audio_rx) = unbounded::<audio::Frame>();
    let (stop_tx, stop_rx) = unbounded::<()>();
    let (ready_tx, ready_rx) = unbounded::<Result<(), String>>();

    // cpal streams aren't Send on macOS: own the stream in its own thread until told to stop.
    let simulate = std::env::var("TRANSCRIPTOR_SIMULATE").ok();
    // The simulator plays a recording as if it were the remote side of a call. An opened file is
    // one channel with everyone on it, like the microphone in a room.
    let (mic, system) = if file.is_some() {
        (true, false)
    } else if simulate.is_some() {
        (false, true)
    } else {
        (mic, system)
    };
    let importing = file.is_some();
    let tmp = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("import");
    let progress_app = app.clone();
    let audio = std::thread::spawn(move || match (file, simulate) {
        (Some(path), _) => match import::decode(path.as_ref(), &tmp) {
            Ok(samples) => {
                let _ = ready_tx.send(Ok(()));
                feed_file(&progress_app, &samples, audio_tx, stop_rx);
            }
            Err(e) => {
                let _ = ready_tx.send(Err(format!("{e:#}")));
            }
        },
        (None, Some(path)) => {
            let _ = ready_tx.send(Ok(()));
            if let Err(e) = audio::simulate_from_file(&path, audio_tx, stop_rx) {
                log::error!("{e:#}");
            }
        }
        (None, None) => match audio::start_capture(mic, mic_device.as_deref(), system, audio_tx) {
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
    // A file isn't a call: no floating pill, and the work after it needn't wait.
    if !importing {
        shell::set_recording(&app, true);
    }

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
            match recorder::Recorder::create(path, Pipeline::record_channels(mic, system)) {
                Ok(r) => r,
                Err(e) => {
                    let _ = stop_tx.send(());
                    shell::set_recording(&app, false);
                    return Err(format!("{e:#}"));
                }
            },
        ),
        None => None,
    };
    // Audio for the final pass: the channel whose speakers it re-checks (the other side of a call
    // when there is one; otherwise everyone is on the mic), and every channel for Whisper.
    let speakers_channel = if system { Channel::System } else { Channel::Mic };
    let mut tap_channels = vec![];
    if verify_speakers {
        tap_channels.push(speakers_channel);
    }
    if final_language.is_some() {
        for (on, channel) in [(mic, Channel::Mic), (system, Channel::System)] {
            if on && !tap_channels.contains(&channel) {
                tap_channels.push(channel);
            }
        }
    }
    let tap_dir = app
        .path()
        .app_cache_dir()
        .ok()
        .map(|d| d.join("final-pass"))
        .and_then(|d| std::fs::create_dir_all(&d).ok().map(|_| d));
    let taps: Vec<(Channel, std::path::PathBuf)> = match tap_dir {
        Some(dir) => tap_channels
            .into_iter()
            .map(|c| {
                let name = if c == Channel::System { "system" } else { "mic" };
                (c, dir.join(format!("{}-{name}.pcm", safe_id(&meeting_id))))
            })
            .collect(),
        None => vec![],
    };
    let plan = FinalPlan {
        speakers: verify_speakers.then_some((speakers_channel, max_speakers)),
        language: final_language,
    };
    let stopped = Arc::new(AtomicBool::new(false));
    let stopped_worker = stopped.clone();
    let room = Arc::new(AtomicBool::new(room_speakers));
    let room_worker = room.clone();
    let final_pass_meeting = meeting_id.clone();

    let worker = std::thread::spawn(move || {
        let mut pipeline = match Pipeline::new(
            &models,
            mic,
            system,
            max_speakers,
            threshold,
            recorder,
            taps,
        ) {
            Ok(p) => p,
            Err(e) => {
                let _ = app.emit("transcript-error", format!("{e:#}"));
                return;
            }
        };
        // A call with nobody else in the room: the microphone is only the user.
        let mut room_now = room_speakers;
        if mic && system && !room_now {
            pipeline.mic_speakers(1);
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
                // A file has no clock to keep up with: nothing to pad.
                Err(RecvTimeoutError::Timeout) => {
                    if !importing {
                        emit(pipeline.tick());
                    }
                    continue;
                }
                Err(RecvTimeoutError::Disconnected) => break,
            };
            // "Som més a la sala" changed: the microphone's voices from now on.
            let room = room_worker.load(Ordering::Relaxed);
            if room != room_now && mic && system {
                room_now = room;
                pipeline.mic_speakers(if room { max_speakers } else { 1 });
            }
            level_samples += samples.len();
            if level_samples >= SAMPLE_RATE / 20 && !samples.is_empty() {
                level_samples = 0;
                let rms =
                    (samples.iter().map(|x| x * x).sum::<f32>() / samples.len() as f32).sqrt();
                let _ = app.emit("level", Level { rms });
            }
            emit(pipeline.push(source, &samples));
            // A busy Mac (a video call can take most of the CPU): audio piles up in the queue.
            // Skip the provisional text, the costliest part, until it's caught up.
            let waiting = audio_rx.len();
            if waiting > BACKLOG_FRAMES {
                pipeline.set_partials(false);
            } else if waiting == 0 {
                pipeline.set_partials(true);
            }
            // Pad stalled sources only once everything that arrived has been taken in.
            if waiting == 0 && !importing {
                emit(pipeline.tick());
            }
        }
        let tapped = match pipeline.finish() {
            Ok((events, tapped)) => {
                emit(events);
                tapped
            }
            Err(e) => {
                let _ = app.emit("transcript-error", format!("{e:#}"));
                vec![]
            }
        };
        let _ = app.emit("transcript-done", ());
        if !importing {
            shell::set_recording(&app, false);
        }
        // Runs on its own thread so stopping returns at once; the UI shows its progress.
        // Without it, "final-pass-done" still follows so the UI can go on (punctuation, cover).
        match tapped.is_empty() {
            false => {
                std::thread::spawn(move || final_pass(app, final_pass_meeting, tapped, plan));
            }
            true => {
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
        room,
        audio,
        worker,
    });
    Ok(audio_path.map(|p| p.to_string_lossy().into_owned()))
}

/// How far an opened file has gone through the engine, in seconds.
#[derive(Clone, Serialize)]
struct ImportProgress {
    done: f32,
    total: f32,
}

/// Gives an opened file's samples to the pipeline as fast as it takes them (a few seconds of
/// audio queued at most, so the file isn't copied whole into the queue), until it ends or the
/// user stops it.
fn feed_file(app: &AppHandle, samples: &[f32], tx: Sender<audio::Frame>, stop: crossbeam_channel::Receiver<()>) {
    const CHUNK: usize = SAMPLE_RATE / 2;
    let total = samples.len() as f32 / SAMPLE_RATE as f32;
    let mut said = 0.0;
    for (i, chunk) in samples.chunks(CHUNK).enumerate() {
        while tx.len() > 8 {
            if stop.recv_timeout(Duration::from_millis(20)).is_ok() {
                return;
            }
        }
        if stop.try_recv().is_ok() || tx.send((audio::Source::Mic, chunk.to_vec())).is_err() {
            return;
        }
        let done = ((i + 1) * CHUNK) as f32 / SAMPLE_RATE as f32;
        if done - said >= 5.0 {
            said = done;
            let _ = app.emit("import-progress", ImportProgress { done: done.min(total), total });
        }
    }
    let _ = app.emit("import-progress", ImportProgress { done: total, total });
}

/// Audio files that macOS asked Murmur to open (Finder › Open With, the Dock icon, the Share
/// menu's extension), until the window takes them: on a cold launch they arrive before it loads.
#[derive(Default)]
struct Opened(Mutex<Vec<String>>);

#[tauri::command]
fn take_opened_files(opened: State<'_, Opened>) -> Vec<String> {
    std::mem::take(&mut *opened.0.lock().unwrap())
}

/// The language of an audio file opened without one ("ca", "es", "en" or "ca-es"), by listening
/// to a few moments of it with Whisper. None if it isn't clear or Whisper isn't installed.
#[tauri::command]
async fn detect_language(app: AppHandle, path: String) -> Result<import::Detected, String> {
    let tmp = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("import");
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<import::Detected> {
        if !models::WHISPER.file(&models_dir(), 0).is_file() {
            return Ok(import::Detected { language: None, windows: 0 });
        }
        let samples = import::decode(path.as_ref(), &tmp)?;
        let spans = import::speech(&models_dir(), &samples)?;
        let windows = import::windows(&spans);
        let pcm = tmp.join(format!("detect-{}.pcm", std::process::id()));
        std::fs::write(&pcm, import::pcm_bytes(&samples))?;
        let heard = retranscribe::detect(&models_dir(), &pcm, &windows);
        let _ = std::fs::remove_file(&pcm);
        Ok(import::decide(&heard?))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:#}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeStatus {
    /// What Claude runs to reach Murmur: this very app with `--mcp` (mcp.rs).
    command: String,
    desktop_installed: bool,
    desktop_connected: bool,
}

fn claude_status_now() -> Result<ClaudeStatus, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(ClaudeStatus { command: exe.display().to_string(), desktop_installed: mcp::desktop_installed(), desktop_connected: mcp::desktop_connected() })
}

/// Settings › Claude: how the connector is set up.
#[tauri::command]
async fn claude_status() -> Result<ClaudeStatus, String> {
    claude_status_now()
}

/// Adds Murmur to Claude Desktop's servers, or takes it out.
#[tauri::command]
async fn claude_desktop_connect(on: bool) -> Result<ClaudeStatus, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    mcp::set_desktop(on, &exe).map_err(|e| format!("{e:#}"))?;
    claude_status_now()
}

/// "Som més a la sala" changed while recording.
#[tauri::command]
fn set_room_speakers(state: State<'_, AppState>, on: bool) {
    if let Some(rec) = state.recording.lock().unwrap().as_ref() {
        rec.room.store(on, Ordering::Relaxed);
    }
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
/// Captured frames waiting beyond which the recording is "behind" (mic callbacks come every
/// ~10 ms, system audio every ~60 ms: about a second or more of audio).
const BACKLOG_FRAMES: usize = 60;

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
struct FinalPassText {
    meeting_id: String,
    base: usize,
    texts: Vec<retranscribe::Text>,
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

/// What the final pass does after a recording.
struct FinalPlan {
    /// Re-check who spoke when on this channel, with the user's maximum number of speakers.
    speakers: Option<(Channel, usize)>,
    /// Write the text again with Whisper in this language ("ca", "es", "en").
    language: Option<String>,
}

/// After a recording: re-check who spoke when, then improve the text with Whisper.
fn final_pass(app: AppHandle, meeting_id: String, tapped: Vec<pipeline::Tapped>, plan: FinalPlan) {
    let started = |stage: &'static str, seconds: f32| {
        let _ = app.emit(
            "final-pass",
            FinalPassStarted { meeting_id: meeting_id.clone(), stage, estimate_seconds: seconds },
        );
    };
    let mut errors = vec![];
    let _heavy = gate::heavy();

    if let Some((channel, max_speakers)) = plan.speakers {
        gate::wait();
        let result = (|| -> anyhow::Result<()> {
            let Some(tapped) = tapped.iter().find(|t| t.channel == channel && !t.spans.is_empty()) else {
                return Ok(());
            };
            let samples = pipeline::read_tap(&tapped.path)?;
            started("speakers", samples.len() as f32 / SAMPLE_RATE as f32 * DIARIZE_RTF_ESTIMATE);
            let assignments = diarize::verify(&models_dir(), &samples, &tapped.spans, tapped.base, max_speakers, gate::wait)?;
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
        if let Err(e) = result {
            errors.push(tr!("speaker_check_error", error = format!("{e:#}")));
        }
    }

    if let Some(language) = &plan.language {
        gate::wait();
        let result = (|| -> anyhow::Result<()> {
            let channels: Vec<&pipeline::Tapped> = tapped.iter().filter(|t| !t.spans.is_empty()).collect();
            if channels.is_empty() {
                return Ok(());
            }
            let speech: f32 = channels.iter().flat_map(|t| &t.spans).map(|s| s.end - s.start).sum();
            started("text", 5.0 + speech * retranscribe::RTF_ESTIMATE);
            let jobs: Vec<(&std::path::Path, &[diarize::Span])> =
                channels.iter().map(|t| (t.path.as_path(), t.spans.as_slice())).collect();
            let results = retranscribe::transcribe(&models_dir(), language, &jobs, |_| {})?;
            for (tapped, texts) in channels.iter().zip(results) {
                let _ = app.emit(
                    "final-pass-text",
                    FinalPassText { meeting_id: meeting_id.clone(), base: tapped.base, texts },
                );
            }
            Ok(())
        })();
        if let Err(e) = result {
            errors.push(tr!("final_pass_error", error = format!("{e:#}")));
        }
    }

    for t in &tapped {
        let _ = std::fs::remove_file(&t.path);
    }
    let _ = app.emit(
        "final-pass-done",
        FinalPassDone {
            meeting_id,
            error: (!errors.is_empty()).then(|| errors.join(". ")),
        },
    );
}

#[derive(Deserialize)]
struct RetranscribeChannel {
    /// 0 for the mic's speakers, SYSTEM_SPEAKER_BASE for the call's.
    base: usize,
    /// The meeting's utterances on this channel, [start, end] in seconds: Whisper writes each again.
    spans: Vec<(f32, f32)>,
}

/// "Torna a transcriure en…": Whisper listens to the saved recording again in another language,
/// utterance by utterance, as the final pass does after recording. Same events ("final-pass"…).
#[tauri::command]
async fn retranscribe_meeting(app: AppHandle, meeting_id: String, audio_path: String, language: String, channels: Vec<RetranscribeChannel>) -> Result<(), String> {
    if !["ca", "es", "en"].contains(&language.as_str()) {
        return Err(tr!("whisper_one_language").into());
    }
    let ogg = recording_path(&audio_path)?;
    let tmp = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("retranscribe");
    std::thread::spawn(move || {
        let tapped = (|| -> anyhow::Result<Vec<pipeline::Tapped>> {
            let decoded = playback::decode_channels(&ogg)?;
            std::fs::create_dir_all(&tmp)?;
            let mut tapped = vec![];
            for c in channels.into_iter().filter(|c| !c.spans.is_empty()) {
                let system = c.base >= engine::SYSTEM_SPEAKER_BASE;
                // In a call the system is on the right; a recording of one source has one channel.
                let samples = decoded.get(if system && decoded.len() > 1 { 1 } else { 0 }).ok_or_else(|| anyhow::anyhow!(tr!("audio_empty")))?;
                let path = tmp.join(format!("{}-{}.pcm", safe_id(&meeting_id), c.base));
                let pcm: Vec<u8> = samples.iter().flat_map(|s| ((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()).collect();
                std::fs::write(&path, pcm)?;
                tapped.push(pipeline::Tapped {
                    channel: if system { engine::Channel::System } else { engine::Channel::Mic },
                    path,
                    spans: c.spans.into_iter().map(|(start, end)| diarize::Span { start, end }).collect(),
                    base: c.base,
                });
            }
            Ok(tapped)
        })();
        match tapped {
            Ok(tapped) => final_pass(app, meeting_id, tapped, FinalPlan { speakers: None, language: Some(language) }),
            Err(e) => {
                let _ = app.emit("final-pass-done", FinalPassDone { meeting_id, error: Some(tr!("final_pass_error", error = format!("{e:#}"))) });
            }
        }
    });
    Ok(())
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

/// Installed models with a newer version in the catalog (empty if it can't be reached).
#[tauri::command]
async fn model_updates(app: AppHandle) -> Vec<models::ModelUpdate> {
    let version = semver::Version::parse(&app.package_info().version.to_string()).unwrap_or(semver::Version::new(0, 0, 0));
    tauri::async_runtime::spawn_blocking(move || match models::fetch_catalog() {
        Ok(catalog) => models::updates(&models_dir(), &catalog, &version),
        Err(e) => {
            log::warn!("{e:#}");
            vec![]
        }
    })
    .await
    .unwrap_or_default()
}

/// Installs the catalog's version of a model; same progress events as a download.
#[tauri::command]
async fn update_model(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
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
        let result = models::fetch_catalog().and_then(|catalog| {
            let next = catalog.models.get(model.id).ok_or_else(|| anyhow::anyhow!(tr!("catalog_model_gone")))?;
            model.update(&models_dir(), next, &cancel, |done, total| {
                let _ = app.emit("model-download", DownloadProgress { id: id.clone(), done, total });
            })
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
        return Err(tr!("model_required").into());
    }
    if state.downloads.lock().unwrap().contains_key(&id) {
        return Err(tr!("stop_download_first").into());
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
        gate::wait();
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
    engine: Option<cloud::Engine>,
) -> Result<Vec<LlmResult>, String> {
    if let Some(engine) = engine {
        return tauri::async_runtime::spawn_blocking(move || run_cloud(&app, &job, &engine, &system, &document, &tasks))
            .await
            .map_err(|e| e.to_string())?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        // A cover waits for any recording and for the other meetings' work; trying out prompts doesn't.
        let _heavy = (!keep_loaded).then(|| {
            gate::wait();
            gate::heavy()
        });
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
            let mut session = llm.session(&system, &document, !keep_loaded).map_err(|e| format!("{e:#}"))?;
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

/// The same with Claude or OpenAI: nothing to load and light on the Mac, so it doesn't wait for
/// recordings (gate.rs). Only text leaves the computer.
fn run_cloud(
    app: &AppHandle,
    job: &str,
    engine: &cloud::Engine,
    system: &str,
    document: &str,
    tasks: &[LlmTask],
) -> Result<Vec<LlmResult>, String> {
    let progress = |step: &str, done: usize| {
        let _ = app.emit(
            "llm-progress",
            LlmProgress { job: job.into(), step: step.into(), done, total: tasks.len(), read_seconds: None },
        );
    };
    let key = cloud::key(engine.provider).map_err(|e| format!("{e:#}"))?;
    progress("reading", 0);
    let mut results = Vec::with_capacity(tasks.len());
    for (i, task) in tasks.iter().enumerate() {
        progress(&task.id, i);
        results.push(match cloud::ask(engine, &key, system, document, &task.prompt, task.schema.as_deref()) {
            Ok(a) => LlmResult { id: task.id.clone(), text: Some(a.text), error: None, seconds: a.seconds, tokens: a.generated_tokens },
            Err(e) => LlmResult { id: task.id.clone(), text: None, error: Some(format!("{e:#}")), seconds: 0.0, tokens: 0 },
        });
    }
    progress("done", tasks.len());
    Ok(results)
}

#[derive(Serialize)]
struct CloudStatus {
    /// The saved key's last characters, per provider; None = not connected.
    anthropic: Option<String>,
    openai: Option<String>,
}

#[tauri::command]
async fn cloud_status() -> Result<CloudStatus, String> {
    tauri::async_runtime::spawn_blocking(|| CloudStatus {
        anthropic: cloud::key_hint(cloud::Provider::Anthropic),
        openai: cloud::key_hint(cloud::Provider::OpenAI),
    })
    .await
    .map_err(|e| e.to_string())
}

/// Checks the key and saves it to the keychain; returns the models it can use.
#[tauri::command]
async fn cloud_connect(provider: cloud::Provider, key: String) -> Result<Vec<cloud::CloudModel>, String> {
    tauri::async_runtime::spawn_blocking(move || cloud::connect(provider, &key).map_err(|e| format!("{e:#}")))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cloud_disconnect(provider: cloud::Provider) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || cloud::disconnect(provider).map_err(|e| format!("{e:#}")))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cloud_models(provider: cloud::Provider) -> Result<Vec<cloud::CloudModel>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let key = cloud::key(provider)?;
        cloud::list_models(provider, &key)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:#}"))
}

/// The Worker for shared links, if connected: its address and the key's last characters.
#[tauri::command]
async fn share_status() -> Result<Option<share::Status>, String> {
    tauri::async_runtime::spawn_blocking(share::status).await.map_err(|e| e.to_string())
}

/// Checks the Worker's address and API key, and saves them to the keychain.
#[tauri::command]
async fn share_connect(url: String, key: String) -> Result<share::Status, String> {
    tauri::async_runtime::spawn_blocking(move || share::connect(&url, &key).map_err(|e| format!("{e:#}")))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn share_disconnect() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| share::disconnect().map_err(|e| format!("{e:#}")))
        .await
        .map_err(|e| e.to_string())?
}

/// Uploads a meeting the interface has already encrypted; `ttl` in seconds, none = never expires.
#[tauri::command]
async fn share_publish(envelope: String, ttl: Option<u64>) -> Result<share::Published, String> {
    tauri::async_runtime::spawn_blocking(move || share::publish(&envelope, ttl).map_err(|e| format!("{e:#}")))
        .await
        .map_err(|e| e.to_string())?
}

/// Cloudflare's token form, filled in with the permissions Murmur needs.
#[tauri::command]
fn share_token_url() -> String {
    share::token_url()
}

/// The Cloudflare accounts a token can use: checks it before publishing.
#[tauri::command]
async fn share_cf_accounts(token: String) -> Result<Vec<share::CfAccount>, String> {
    tauri::async_runtime::spawn_blocking(move || share::cf_accounts(&token).map_err(|e| format!("{e:#}")))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
struct SetupDone {
    status: share::Status,
    /// The workers.dev address answers already (a new one can take a few minutes).
    ready: bool,
}

/// Publishes the Worker on the user's Cloudflare account and connects to it; progress on "share-setup".
#[tauri::command]
async fn share_setup(app: AppHandle, token: String, account: share::CfAccount) -> Result<SetupDone, String> {
    tauri::async_runtime::spawn_blocking(move || {
        share::setup(&token, &account, |step| {
            let _ = app.emit("share-setup", step);
        })
        .map(|(status, ready)| SetupDone { status, ready })
        .map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// One encrypted file of a shared meeting, sent as raw bytes; which one, in the headers.
#[tauri::command]
async fn share_upload_file(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(tr!("share_not_worker").into());
    };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let (id, name, ttl) = (header("x-share-id"), header("x-share-file"), header("x-share-ttl").parse::<u64>().ok());
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || share::upload_file(&id, &name, ttl, &bytes).map_err(|e| format!("{e:#}")))
        .await
        .map_err(|e| e.to_string())?
}

/// A meeting's screenshot, or its audio as .m4a, as raw bytes to encrypt and share.
#[tauri::command]
async fn share_read_file(app: AppHandle, meeting_id: String, kind: String, path: String) -> Result<tauri::ipc::Response, String> {
    let file = if kind == "audio" {
        std::path::PathBuf::from(playback_audio(app, meeting_id, path).await?)
    } else {
        let root = screens_dir(&app, &meeting_id)?;
        let path = std::path::PathBuf::from(path);
        if !path.starts_with(&root) || path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return Err(tr!("share_not_capture").into());
        }
        path
    };
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(file)).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
async fn share_revoke(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || share::revoke(&id).map_err(|e| format!("{e:#}")))
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
async fn rename_tag(app: AppHandle, from: String, to: String) -> Result<(), String> {
    with_db(&app, |db| db.rename_tag(&from, &to))
}

#[tauri::command]
async fn delete_tag(app: AppHandle, name: String) -> Result<(), String> {
    with_db(&app, |db| db.delete_tag(&name))
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
    // Its screenshots (only the folder named after this meeting, inside the app's data).
    if let Ok(dir) = screens_dir(&app, &id) {
        let _ = std::fs::remove_dir_all(dir);
    }
    // Its recording too. Only ever an .ogg the app wrote (the path comes from the meeting).
    if let Some(path) = audio_path.map(std::path::PathBuf::from) {
        if path.extension().is_some_and(|e| e == "ogg") && path.exists() {
            std::fs::remove_file(path)
                .map_err(|e| tr!("audio_delete_failed", error = e))?;
        }
    }
    Ok(())
}

/// `<app data>/screens/<meeting id>`: where a meeting's screenshots go.
fn screens_dir(app: &AppHandle, meeting_id: &str) -> Result<std::path::PathBuf, String> {
    if meeting_id.is_empty() || !meeting_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(tr!("unknown_meeting").into());
    }
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("screens").join(meeting_id))
}

/// A screenshot of the call (capture.rs) at `t` seconds into the meeting; returns its path.
#[tauri::command]
async fn capture_screen(app: AppHandle, meeting_id: String, t: f64) -> Result<String, String> {
    let dir = screens_dir(&app, &meeting_id)?;
    // Only the screenshots need it: the first time, macOS shows its prompt.
    if !permissions::screen_granted() {
        permissions::request_screen();
        return Err(tr!("screen_permission_needed").into());
    }
    let path = tauri::async_runtime::spawn_blocking(move || capture::capture(&dir, (t * 1000.0) as u64))
        .await
        .map_err(|e| e.to_string())??;
    let _ = app.emit("screen-captured", ());
    Ok(path.to_string_lossy().into_owned())
}

/// A meeting's recording as an .m4a anyone can play (playback.rs), kept in the cache; returns its path.
#[tauri::command]
async fn playback_audio(app: AppHandle, meeting_id: String, audio_path: String) -> Result<String, String> {
    let ogg = recording_path(&audio_path)?;
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("playback");
    let out = dir.join(format!("{}.m4a", screens_dir(&app, &meeting_id).map(|_| meeting_id)?));
    let target = out.clone();
    tauri::async_runtime::spawn_blocking(move || playback::ensure_m4a(&ogg, &target))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))?;
    Ok(out.to_string_lossy().into_owned())
}

/// "Exporta l'àudio…": the same .m4a, saved where the user chose.
#[tauri::command]
async fn export_audio(app: AppHandle, meeting_id: String, audio_path: String, dest: String) -> Result<(), String> {
    let m4a = playback_audio(app, meeting_id, audio_path).await?;
    std::fs::copy(m4a, dest).map(|_| ()).map_err(|e| tr!("audio_save_failed", error = e))
}

/// A meeting's saved recording: only ever an existing .ogg (the path comes from the meeting).
fn recording_path(path: &str) -> Result<std::path::PathBuf, String> {
    let path = std::path::PathBuf::from(path);
    if path.extension().is_some_and(|e| e == "ogg") && path.is_file() {
        Ok(path)
    } else {
        Err(tr!("this_meeting_audio_missing").into())
    }
}

/// "Exporta les captures…": copies a meeting's screenshots into a new folder `dest`, named `names`.
#[tauri::command]
fn export_screens(app: AppHandle, meeting_id: String, paths: Vec<String>, names: Vec<String>, dest: String) -> Result<(), String> {
    let root = screens_dir(&app, &meeting_id)?;
    let dest = std::path::PathBuf::from(dest);
    std::fs::create_dir_all(&dest).map_err(|e| tr!("screens_save_failed", error = e))?;
    for (path, name) in paths.iter().zip(&names) {
        let path = std::path::PathBuf::from(path);
        let inside = path.starts_with(&root) && !path.components().any(|c| matches!(c, std::path::Component::ParentDir));
        if !inside || name.is_empty() || name.contains(['/', '\\', ':']) || name.starts_with('.') {
            return Err(tr!("not_a_capture").into());
        }
        std::fs::copy(&path, dest.join(name)).map_err(|e| tr!("screens_save_failed", error = e))?;
    }
    Ok(())
}

/// Removes one screenshot (only files inside the screenshots folder).
#[tauri::command]
fn delete_screen(app: AppHandle, path: String) -> Result<(), String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?.join("screens");
    let path = std::path::PathBuf::from(path);
    if !path.starts_with(&root) || path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(tr!("not_a_capture").into());
    }
    std::fs::remove_file(path).map_err(|e| e.to_string())
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
    std::fs::write(&path, contents).map_err(|e| tr!("file_save_failed", error = e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// The interface language ("ca", "es", "en"), for texts made here: menus, alerts, errors.
#[tauri::command]
fn set_ui_language(app: AppHandle, language: String) {
    if i18n::set(&language) {
        shell::retranslate(&app);
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // The standard macOS menus (Edit gives copy/paste), with our own About window and
            // Settings… in the app menu.
            let menu = tauri::menu::Menu::default(app.handle())?;
            let about = tauri::menu::MenuItem::with_id(app, "about", tr!("menu_about"), true, None::<&str>)?;
            let settings = tauri::menu::MenuItem::with_id(
                app,
                "settings",
                tr!("menu_settings"),
                true,
                Some("CmdOrCtrl+,"),
            )?;
            shell::keep_label(app.handle(), &about, "menu_about");
            shell::keep_label(app.handle(), &settings, "menu_settings");
            if let Some(tauri::menu::MenuItemKind::Submenu(app_menu)) = menu.items()?.first() {
                app_menu.remove_at(0)?; // the standard About panel
                app_menu.insert(&about, 0)?;
                app_menu.insert(&settings, 1)?;
            }
            // View: the notes text's size (⌘+ / ⌘− / ⌘0), above Full Screen.
            for item in menu.items()? {
                if let tauri::menu::MenuItemKind::Submenu(file) = &item {
                    if file.text()? == "File" {
                        // A meeting from an audio file, as if it had been recorded.
                        let open = tauri::menu::MenuItem::with_id(app, "open-audio", i18n::t("menu_open_audio"), true, Some("CmdOrCtrl+O"))?;
                        shell::keep_label(app.handle(), &open, "menu_open_audio");
                        file.insert(&open, 0)?;
                        file.insert(&tauri::menu::PredefinedMenuItem::separator(app)?, 1)?;
                    }
                }
                if let tauri::menu::MenuItemKind::Submenu(view) = item {
                    if view.text()? != "View" {
                        continue;
                    }
                    let zoom = [("text-zoom-in", "menu_zoom_in", "CmdOrCtrl+="), ("text-zoom-out", "menu_zoom_out", "CmdOrCtrl+-"), ("text-zoom-reset", "menu_zoom_reset", "CmdOrCtrl+0")];
                    for (i, (id, key, accelerator)) in zoom.into_iter().enumerate() {
                        let entry = tauri::menu::MenuItem::with_id(app, id, i18n::t(key), true, Some(accelerator))?;
                        shell::keep_label(app.handle(), &entry, key);
                        view.insert(&entry, i)?;
                    }
                    view.insert(&tauri::menu::PredefinedMenuItem::separator(app)?, 3)?;
                }
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
                "open-audio" => {
                    shell::show_main(app);
                    let _ = app.emit_to("main", "open-audio", ());
                }
                "text-zoom-in" => {
                    let _ = app.emit_to("main", "text-zoom", 1);
                }
                "text-zoom-out" => {
                    let _ = app.emit_to("main", "text-zoom", -1);
                }
                "text-zoom-reset" => {
                    let _ = app.emit_to("main", "text-zoom", 0);
                }
                _ => {}
            });
            if let Ok(data) = app.path().app_data_dir() {
                engine::set_app_models_dir(data.join("models"));
            }
            gate::init(app.handle().clone());
            shell::setup(app)?;
            Ok(())
        })
        .manage(AppState::default())
        .manage(Opened::default())
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
            set_ui_language,
            prepare,
            start_recording,
            detect_language,
            take_opened_files,
            claude_status,
            claude_desktop_connect,
            stop_recording,
            list_meetings,
            get_meeting,
            put_meeting,
            apply_changes,
            search_meetings,
            rename_tag,
            delete_tag,
            delete_meeting,
            list_microphones,
            start_mic_monitor,
            stop_mic_monitor,
            write_export,
            model_status,
            download_model,
            cancel_model_download,
            model_updates,
            update_model,
            delete_model,
            punctuate,
            run_llm,
            release_llm,
            cloud_status,
            cloud_connect,
            cloud_disconnect,
            cloud_models,
            share_status,
            share_connect,
            share_disconnect,
            share_publish,
            share_revoke,
            retranscribe_meeting,
            share_token_url,
            share_cf_accounts,
            share_setup,
            share_upload_file,
            share_read_file,
            shell::current_toast,
            shell::dismiss_toast,
            shell::toast_start,
            shell::set_meeting_detection,
            shell::set_calendar_watch,
            shell::set_indicator,
            shell::indicator_open,
            shell::set_compact,
            shell::indicator_capture,
            capture_screen,
            playback_audio,
            export_audio,
            delete_screen,
            export_screens,
            set_room_speakers,
            shell::indicator_stop,
            print_page,
            calendar::calendar_access,
            calendar::request_calendar_access,
            calendar::list_calendars,
            calendar::calendar_events,
            permissions::permission_status,
            permissions::request_microphone,
            permissions::request_system_audio,
            permissions::request_screen,
            permissions::open_privacy_settings
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // Clicking the Dock icon brings the hidden window back.
            match event {
                tauri::RunEvent::Reopen { .. } => shell::show_main(app),
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Opened { urls } => {
                    let audio: Vec<String> = urls
                        .iter()
                        .filter_map(|u| u.to_file_path().ok())
                        .filter(|p| p.extension().and_then(|e| e.to_str()).is_some_and(|e| import::EXTENSIONS.contains(&e.to_lowercase().as_str())))
                        .map(|p| p.to_string_lossy().into_owned())
                        .collect();
                    if audio.is_empty() {
                        return;
                    }
                    app.state::<Opened>().0.lock().unwrap().extend(audio);
                    shell::show_main(app);
                    let _ = app.emit("opened-files", ());
                }
                _ => {}
            }
        });
}
