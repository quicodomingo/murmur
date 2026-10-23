//! Final pass for meetings in one language (Catalan, Spanish or English): Whisper large-v3-turbo
//! listens again to each channel and every live utterance takes the words Whisper heard during
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
use crate::models::WHISPER;

/// Seconds of work per second of speech, measured on an M4 base (examples/whisper_probe), with
/// margin for slower Macs. Only drives the estimate shown in the UI.
pub const RTF_ESTIMATE: f32 = 0.15;

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
    let beside = std::env::current_exe()?.with_file_name("murmur-whisper");
    if beside.is_file() {
        return Ok(beside);
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("../whisper/target/release/murmur-whisper");
    if dev.is_file() {
        return Ok(dev);
    }
    Err(anyhow!("Falta murmur-whisper (cd app/whisper && cargo build --release)"))
}

/// New text for the utterances of each channel (`pcm`: 16 kHz mono s16le, as the pipeline taps
/// it). Utterances left out keep their live text. `progress` gets the share done, 0–1.
pub fn transcribe(models: &Path, language: &str, channels: &[(&Path, &[Span])], progress: impl FnMut(f32)) -> Result<Vec<Vec<Text>>> {
    let model = WHISPER.file(models, 0);
    if !model.is_file() {
        return Err(anyhow!(tr!("model_missing", path = model.display())));
    }
    let job = serde_json::json!({
        "channels": channels.iter().map(|(pcm, spans)| serde_json::json!({
            "pcm": pcm,
            "spans": spans.iter().map(|s| serde_json::json!({ "start": s.start, "end": s.end })).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
    });
    let mut child = Command::new(sidecar()?)
        .arg(&model)
        .arg(language)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context(tr!("whisper_start_failed"))?;
    crate::gate::whisper(Some(child.id()));
    let result = read_replies(&mut child, &job.to_string(), channels.len(), progress);
    crate::gate::whisper(None);
    result
}

/// Sends the job to the Whisper process and collects its texts, one list per channel.
fn read_replies(child: &mut Child, job: &str, channels: usize, mut progress: impl FnMut(f32)) -> Result<Vec<Vec<Text>>> {
    child.stdin.take().unwrap().write_all(job.as_bytes())?;
    // whisper.cpp logs a lot: keep the end, to explain a failure.
    let stderr = child.stderr.take().unwrap();
    let log = std::thread::spawn(move || {
        let mut tail: Vec<String> = vec![];
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            tail.push(line);
            if tail.len() > 8 {
                tail.remove(0);
            }
        }
        tail
    });

    #[derive(Deserialize)]
    struct Line {
        progress: Option<f32>,
        channel: Option<usize>,
        texts: Option<Vec<Text>>,
    }
    let mut out: Vec<Vec<Text>> = vec![vec![]; channels];
    for line in BufReader::new(child.stdout.take().unwrap()).lines() {
        let line: Line = serde_json::from_str(&line?).context(tr!("whisper_bad_reply"))?;
        if let Some(p) = line.progress {
            progress(p);
        }
        if let (Some(i), Some(texts)) = (line.channel, line.texts) {
            if let Some(slot) = out.get_mut(i) {
                *slot = texts;
            }
        }
    }
    let status = child.wait()?;
    let tail = log.join().unwrap_or_default();
    if !status.success() {
        return Err(anyhow!(tr!("whisper_failed", error = tail.last().cloned().unwrap_or_default())));
    }
    Ok(out)
}
