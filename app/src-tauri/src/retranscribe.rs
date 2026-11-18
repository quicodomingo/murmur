//! Final pass for meetings in one language (Catalan, Spanish or English): the BSC's Catalan Whisper
//! or large-v3-turbo (`model_for`) listens again to each channel and every live utterance takes the words Whisper heard during
//! it. Speakers, times and lines stay as they were; only the text improves.
//!
//! Whisper runs in a process of its own, `murmur-whisper` (app/whisper): whisper.cpp and the
//! llama.cpp we use for the cover each bring their own ggml, which can't share one binary. It
//! also gives all of Whisper's memory back when it ends.

use crate::i18n::tr;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};

use crate::diarize::Span;
use crate::models::{OptionalModel, WHISPER, WHISPER_CA};

/// The model for a meeting in `language`: in Catalan, the BSC's (or the turbo, if that one isn't
/// downloaded yet: what Catalan used before); in Spanish and English, large-v3-turbo.
pub fn model_for(models: &Path, language: &str) -> &'static OptionalModel {
    if language == "ca" && WHISPER_CA.installed(models) { &WHISPER_CA } else { &WHISPER }
}

/// Seconds of work per second of speech, measured on an M4 base (examples/whisper_probe), with
/// margin for slower Macs. Only drives the estimate shown in the UI.
pub const RTF_ESTIMATE: f32 = 0.15;
/// The same for the BSC's Catalan model, a full large-v3: about twice as slow (11 min per hour of
/// meeting on an M4, bench/dialects.py).
pub const RTF_ESTIMATE_CA: f32 = 0.25;

/// The estimate for a meeting in `language`, by the model that will run.
pub fn rtf_estimate(models: &Path, language: &str) -> f32 {
    if model_for(models, language).id == WHISPER_CA.id { RTF_ESTIMATE_CA } else { RTF_ESTIMATE }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Text {
    /// Start of the live utterance it replaces (its key, as in diarize::Assignment).
    pub start: f32,
    pub text: String,
}

/// The sidecar: next to Murmur's executable in the app (tauri.conf.json externalBin), or the
/// one built in app/whisper during development. `MURMUR_WHISPER_BIN` overrides it.
fn sidecar() -> Result<PathBuf> {
    if let Some(path) = std::env::var_os("MURMUR_WHISPER_BIN") {
        return Ok(path.into());
    }
    let name = format!("murmur-whisper{}", std::env::consts::EXE_SUFFIX);
    let beside = std::env::current_exe()?.with_file_name(&name);
    if beside.is_file() {
        return Ok(beside);
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("../whisper/target/release").join(&name);
    if dev.is_file() {
        return Ok(dev);
    }
    Err(anyhow!("Falta murmur-whisper (cd app/whisper && cargo build --release)"))
}

/// New text for the utterances of each channel (`pcm`: 16 kHz mono s16le, as the pipeline taps
/// it). Utterances left out keep their live text. `glossary`: words to spell as given
/// (glossary.rs). `progress` gets the share done, 0–1.
pub fn transcribe(models: &Path, language: &str, channels: &[(&Path, &[Span])], glossary: &[String], mut progress: impl FnMut(f32)) -> Result<Vec<Vec<Text>>> {
    let model = model_for(models, language).file(models, 0);
    if !model.is_file() {
        return Err(anyhow!(tr!("model_missing", path = model.display())));
    }
    let channels_job: Vec<_> = channels
        .iter()
        .map(|(pcm, spans)| {
            serde_json::json!({
                "pcm": pcm,
                "spans": spans.iter().map(|s| serde_json::json!({ "start": s.start, "end": s.end })).collect::<Vec<_>>(),
            })
        })
        .collect();
    // What's done survives a crash: the retry on the CPU goes on from the next chunk.
    let mut done = Done { texts: vec![vec![]; channels.len()], chunks: 0 };
    with_cpu_fallback(models, |cpu| {
        if done.chunks > 0 {
            log::info!("murmur-whisper goes on after the {} chunks already done", done.chunks);
        }
        let job = serde_json::json!({ "channels": channels_job, "skip": done.chunks });
        let mut child = spawn(&model, language, cpu, Stdio::piped())?;
        crate::gate::whisper(Some(child.id()));
        let result = read_replies(&mut child, &job.to_string(), &mut done, &mut progress);
        crate::gate::whisper(None);
        result
    })?;
    let mut result = done.texts;
    for text in result.iter_mut().flatten() {
        text.text = crate::glossary::correct(&text.text, glossary);
    }
    Ok(result)
}

/// The sidecar with `model` and its second argument (a language, or "detect"). `cpu`: skip the GPU.
fn spawn(model: &Path, arg: &str, cpu: bool, stderr: Stdio) -> Result<Child> {
    let mut command = Command::new(sidecar()?);
    command.arg(model).arg(arg).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(stderr);
    if cpu {
        command.env("MURMUR_NO_GPU", "1");
    }
    let name = model.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    log::info!("murmur-whisper {name} {arg}, {}", if cpu { "on the CPU" } else { "on the GPU if there is one" });
    command.spawn().context(tr!("whisper_start_failed"))
}

/// Reads the sidecar's stderr as it runs. whisper.cpp logs a lot: the lines about the GPU (which
/// devices Vulkan or Metal found, which one it took, its memory) go to Murmur's log as they come,
/// to tell later which card a crash was on; the last few lines are returned, to explain a failure.
fn watch_stderr(child: &mut Child) -> std::thread::JoinHandle<Vec<String>> {
    let stderr = child.stderr.take().unwrap();
    std::thread::spawn(move || {
        let mut tail: Vec<String> = vec![];
        let mut logged = 0;
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if logged < 30 && about_the_gpu(&line) {
                log::info!("murmur-whisper: {}", line.trim());
                logged += 1;
            }
            tail.push(line);
            if tail.len() > 8 {
                tail.remove(0);
            }
        }
        tail
    })
}

fn about_the_gpu(line: &str) -> bool {
    let line = line.to_ascii_lowercase();
    ["vulkan", "metal", "gpu", "backend", "device", "vram", "processador"].iter().any(|word| line.contains(word))
}

/// The sidecar died instead of ending with an error of its own (exit code 1): a crash, which on
/// the GPU is usually the driver (a SIGSEGV with Vulkan on some Linux laptops, issue #9).
#[derive(Debug)]
struct Crashed(String);

impl std::fmt::Display for Crashed {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Crashed {}

fn crashed(status: std::process::ExitStatus) -> bool {
    !status.success() && status.code() != Some(1)
}

/// Present when Whisper crashed on this computer's GPU: until Murmur updates, it goes straight to
/// the CPU. It holds the version, so a new one (another whisper.cpp) tries the GPU again.
fn no_gpu_marker(models: &Path) -> PathBuf {
    models.join("whisper-no-gpu")
}

fn gpu_disabled(models: &Path) -> bool {
    std::fs::read_to_string(no_gpu_marker(models)).is_ok_and(|v| v.trim() == env!("CARGO_PKG_VERSION"))
}

/// Runs `attempt` (its argument: CPU only), on the GPU first unless it crashed there before, and
/// once more on the CPU if the sidecar crashes on the GPU now.
fn with_cpu_fallback<T>(models: &Path, mut attempt: impl FnMut(bool) -> Result<T>) -> Result<T> {
    let cpu = gpu_disabled(models);
    match attempt(cpu) {
        Err(e) if !cpu && e.downcast_ref::<Crashed>().is_some() => {
            log::warn!("murmur-whisper crashed on the GPU ({e}); again on the CPU, and from now on until Murmur updates");
            if let Err(e) = std::fs::write(no_gpu_marker(models), env!("CARGO_PKG_VERSION")) {
                log::warn!("can't remember that Whisper's GPU crashed: {e}");
            }
            attempt(true)
        }
        result => result,
    }
}

/// What a transcription has so far: the texts of each channel, and how many chunks they came from.
struct Done {
    texts: Vec<Vec<Text>>,
    chunks: usize,
}

/// Sends the job to the Whisper process and adds the texts of each chunk to `done` as they come.
fn read_replies(child: &mut Child, job: &str, done: &mut Done, mut progress: impl FnMut(f32)) -> Result<()> {
    child.stdin.take().unwrap().write_all(job.as_bytes())?;
    let log = watch_stderr(child);

    #[derive(Deserialize)]
    struct Line {
        progress: Option<f32>,
        channel: Option<usize>,
        texts: Option<Vec<Text>>,
    }
    let mut share = 0.0;
    let read = (|| -> Result<()> {
        for line in BufReader::new(child.stdout.take().unwrap()).lines() {
            let line: Line = serde_json::from_str(&line?).context(tr!("whisper_bad_reply"))?;
            if let Some(p) = line.progress {
                share = p;
                progress(p);
            }
            if let (Some(i), Some(texts)) = (line.channel, line.texts) {
                if let Some(slot) = done.texts.get_mut(i) {
                    slot.extend(texts);
                }
                done.chunks += 1;
            }
        }
        Ok(())
    })();
    // Waited for even when a reply was cut short: a crash mid-line is still a crash.
    let status = child.wait()?;
    let tail = log.join().unwrap_or_default();
    if crashed(status) {
        log::warn!("murmur-whisper ended with {status} at {:.0}% of the job; its last lines: {}", share * 100.0, tail.join(" | "));
        return Err(Crashed(tr!("whisper_failed", error = tail.last().cloned().unwrap_or_else(|| status.to_string()))).into());
    }
    read?;
    if !status.success() {
        return Err(anyhow!(tr!("whisper_failed", error = tail.last().cloned().unwrap_or_default())));
    }
    log::info!("murmur-whisper finished");
    Ok(())
}

/// What Whisper hears in each window of `pcm` (16 kHz mono s16le): its language probabilities.
/// `windows`: a few utterances each (import::windows).
pub fn detect(models: &Path, pcm: &Path, windows: &[Vec<Span>]) -> Result<Vec<crate::import::Heard>> {
    let model = WHISPER.file(models, 0);
    if !model.is_file() {
        return Err(anyhow!(tr!("model_missing", path = model.display())));
    }
    let job = serde_json::json!({
        "pcm": pcm,
        "windows": windows.iter().map(|w| w.iter().map(|s| serde_json::json!({ "start": s.start, "end": s.end })).collect::<Vec<_>>()).collect::<Vec<_>>(),
    });
    with_cpu_fallback(models, |cpu| {
        let mut child = spawn(&model, "detect", cpu, Stdio::piped())?;
        let log = watch_stderr(&mut child);
        crate::gate::whisper(Some(child.id()));
        let result = (|| -> Result<Vec<crate::import::Heard>> {
            child.stdin.take().unwrap().write_all(job.to_string().as_bytes())?;
            let mut heard = vec![];
            let read = (|| -> Result<()> {
                for line in BufReader::new(child.stdout.take().unwrap()).lines() {
                    heard.push(serde_json::from_str(&line?).context(tr!("whisper_bad_reply"))?);
                }
                Ok(())
            })();
            let status = child.wait()?;
            let tail = log.join().unwrap_or_default();
            if crashed(status) {
                log::warn!("murmur-whisper (detect) ended with {status}; its last lines: {}", tail.join(" | "));
                return Err(Crashed(tr!("whisper_failed", error = status.to_string())).into());
            }
            read?;
            if !status.success() {
                return Err(anyhow!(tr!("whisper_failed", error = "")));
            }
            Ok(heard)
        })();
        crate::gate::whisper(None);
        result
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalan_goes_to_the_bscs_model_once_it_is_there() {
        let dir = std::env::temp_dir().join(format!("murmur-model-for-{}", std::process::id()));
        assert_eq!(model_for(&dir, "ca").id, "whisper");
        let file = WHISPER_CA.file(&dir, 0);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, b"").unwrap();
        assert_eq!(model_for(&dir, "ca").id, "whisper-ca");
        assert_eq!(model_for(&dir, "es").id, "whisper");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_crash_on_the_gpu_retries_on_the_cpu_and_stays_there() {
        let dir = std::env::temp_dir().join(format!("murmur-no-gpu-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut tries = vec![];
        let result = with_cpu_fallback(&dir, |cpu| {
            tries.push(cpu);
            if cpu { Ok(()) } else { Err(Crashed("SIGSEGV".into()).into()) }
        });
        assert!(result.is_ok());
        assert_eq!(tries, [false, true]);
        tries.clear();
        let _ = with_cpu_fallback(&dir, |cpu| {
            tries.push(cpu);
            Ok(())
        });
        assert_eq!(tries, [true]);
        // An ordinary error isn't retried, and a new version tries the GPU again.
        std::fs::write(no_gpu_marker(&dir), "0.0.1").unwrap();
        tries.clear();
        let result: Result<()> = with_cpu_fallback(&dir, |cpu| {
            tries.push(cpu);
            Err(anyhow!("bad model"))
        });
        assert!(result.is_err());
        assert_eq!(tries, [false]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
