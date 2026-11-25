//! Final pass: the BSC's Catalan Whisper or large-v3-turbo (`model_for`) listens again to each
//! channel and every live utterance takes the words Whisper heard during it. Speakers, times and
//! lines stay as they were; only the text improves.
//!
//! Meetings in Catalan and Spanish ("ca-es") go sentence by sentence: Whisper tells each live
//! utterance's language (`languages`), and each language goes to its own model (`transcribe_split`).
//! Told one language for everything, Whisper turns the other into it. On a mixed radio show
//! (examples/mixed_probe.rs) that's 6 % WER, against 21 % with everything in Catalan.
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

/// The same for a meeting in Catalan and Spanish: telling each sentence's language and then
/// writing it took 0.25 on an M4 (0.12 + 0.13, examples/mixed_probe.rs).
pub const RTF_ESTIMATE_MIXED: f32 = 0.35;

/// Shorter than this, Whisper can't tell an utterance's language from it alone: its neighbours go
/// in the same window.
const SHORT_S: f32 = 2.0;

/// The estimate for a meeting in `language`, by the model that will run.
pub fn rtf_estimate(models: &Path, language: &str) -> f32 {
    if language == "ca-es" {
        RTF_ESTIMATE_MIXED
    } else if model_for(models, language).id == WHISPER_CA.id {
        RTF_ESTIMATE_CA
    } else {
        RTF_ESTIMATE
    }
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
    if language == "ca-es" {
        // Telling the languages is about half the work.
        let mut catalan = vec![];
        for (i, (pcm, spans)) in channels.iter().enumerate() {
            catalan.push(languages(models, pcm, spans)?);
            progress(0.45 * (i + 1) as f32 / channels.len() as f32);
        }
        return transcribe_split(models, channels, &catalan, glossary, |p| progress(0.45 + 0.55 * p));
    }
    transcribe_one(models, language, channels, glossary, &mut progress)
}

/// One language for everything.
fn transcribe_one(models: &Path, language: &str, channels: &[(&Path, &[Span])], glossary: &[String], progress: &mut dyn FnMut(f32)) -> Result<Vec<Vec<Text>>> {
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
        let result = read_replies(&mut child, &job.to_string(), &mut done, &mut *progress);
        crate::gate::whisper(None);
        result
    })?;
    let mut result = done.texts;
    for text in result.iter_mut().flatten() {
        text.text = crate::glossary::correct(&text.text, glossary);
    }
    Ok(result)
}

/// Whether each utterance of `spans` is in Catalan (else Spanish), as Whisper hears it in a window
/// of at least SHORT_S around it. An utterance Whisper can't tell takes the one before's (Catalan
/// at the start).
pub fn languages(models: &Path, pcm: &Path, spans: &[Span]) -> Result<Vec<bool>> {
    if spans.is_empty() {
        return Ok(vec![]);
    }
    let windows: Vec<Vec<Span>> = (0..spans.len()).map(|i| window(spans, i)).collect();
    let mut heard: Vec<Option<bool>> = vec![None; spans.len()];
    for h in detect(models, pcm, &windows)? {
        if let Some(slot) = heard.get_mut(h.window) {
            *slot = Some(h.ca >= h.es);
        }
    }
    let mut last = true;
    Ok(heard.into_iter().map(|h| { last = h.unwrap_or(last); last }).collect())
}

/// The audio Whisper hears to tell utterance `i`'s language: itself, and its neighbours while it's
/// too short (alternately after and before).
fn window(spans: &[Span], i: usize) -> Vec<Span> {
    let len = |w: &[Span]| w.iter().map(|s| s.end - s.start).sum::<f32>();
    let (mut from, mut to) = (i, i);
    while len(&spans[from..=to]) < SHORT_S && (from > 0 || to + 1 < spans.len()) {
        if to + 1 < spans.len() {
            to += 1;
        }
        if len(&spans[from..=to]) < SHORT_S && from > 0 {
            from -= 1;
        }
    }
    spans[from..=to].to_vec()
}

/// Each channel's Catalan utterances (`catalan`, one flag per span) with the Catalan model and the
/// rest with the Spanish one, each in one go; the texts come back together, by channel.
pub fn transcribe_split(models: &Path, channels: &[(&Path, &[Span])], catalan: &[Vec<bool>], glossary: &[String], mut progress: impl FnMut(f32)) -> Result<Vec<Vec<Text>>> {
    let pick = |ca: bool| -> Vec<Vec<Span>> {
        channels.iter().zip(catalan).map(|((_, spans), flags)| spans.iter().zip(flags).filter(|(_, c)| **c == ca).map(|(s, _)| *s).collect()).collect()
    };
    let (ca_spans, es_spans) = (pick(true), pick(false));
    let share = |spans: &[Vec<Span>]| spans.iter().flatten().map(|s| s.end - s.start).sum::<f32>();
    let ca_share = share(&ca_spans) / (share(&ca_spans) + share(&es_spans)).max(0.001);
    let mut result: Vec<Vec<Text>> = vec![vec![]; channels.len()];
    for (language, spans, from, part) in [("ca", &ca_spans, 0.0, ca_share), ("es", &es_spans, ca_share, 1.0 - ca_share)] {
        if spans.iter().all(|s| s.is_empty()) {
            continue;
        }
        let jobs: Vec<(&Path, &[Span])> = channels.iter().zip(spans).map(|((pcm, _), s)| (*pcm, s.as_slice())).collect();
        let texts = transcribe_one(models, language, &jobs, glossary, &mut |p| progress(from + part * p))?;
        for (all, texts) in result.iter_mut().zip(texts) {
            all.extend(texts);
        }
    }
    for texts in &mut result {
        texts.sort_by(|a, b| a.start.total_cmp(&b.start));
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
    fn short_utterances_borrow_their_neighbours_to_tell_the_language() {
        let spans = [Span { start: 0.0, end: 3.0 }, Span { start: 4.0, end: 4.5 }, Span { start: 5.0, end: 5.4 }, Span { start: 6.0, end: 7.5 }];
        assert_eq!(window(&spans, 0).len(), 1);
        // 0.5 s, then 0.4 more, then the one before (3 s).
        let w = window(&spans, 1);
        assert_eq!((w[0].start, w.last().unwrap().start), (0.0, 5.0));
        assert!(window(&spans, 3).iter().map(|s| s.end - s.start).sum::<f32>() >= SHORT_S);
        assert_eq!(window(&spans[1..2], 0).len(), 1);
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
