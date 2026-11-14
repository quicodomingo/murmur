//! A meeting from an audio file (File › Open audio…): the file decoded to 16 kHz mono, and its
//! language when nobody says which it is. The samples then go through the same pipeline as a
//! recording, as fast as the Mac can take them.

use crate::i18n::tr;
use std::path::Path;

use anyhow::{Result, anyhow};
use serde::Serialize;
use sherpa_onnx::{SileroVadModelConfig, VadModelConfig, VoiceActivityDetector};

use crate::diarize::Span;
use crate::engine::SAMPLE_RATE;

/// What the open panel offers. macOS reads all of them (`afconvert`), Ogg/Opus included; on
/// Windows and Linux Symphonia does, except Opus and CAF's own codecs.
pub const EXTENSIONS: &[&str] = &["mp3", "m4a", "aac", "wav", "aif", "aiff", "caf", "flac", "ogg", "opus", "mp4", "mov"];

/// The file as 16 kHz mono samples: macOS's `afconvert` (or Symphonia elsewhere) decodes it, or,
/// for an Ogg/Opus they can't read, our own decoder (the format Murmur records in).
pub fn decode(path: &Path, tmp_dir: &Path) -> Result<Vec<f32>> {
    // Later steps write there too (the language detection's windows).
    std::fs::create_dir_all(tmp_dir)?;
    let samples = match system_decode(path, tmp_dir)? {
        Ok(samples) => samples,
        // Why the system's decoder couldn't, said along with ours if it can't either.
        Err(why) => crate::playback::decode(path).map_err(|e| anyhow!("{why}; Opus: {e}").context(tr!("audio_open_failed")))?,
    };
    if samples.is_empty() {
        return Err(anyhow!(tr!("audio_empty")));
    }
    Ok(samples)
}

/// `afconvert` turns it into a 16 kHz WAV in `tmp_dir`; `Err(why)` if it can't read it.
#[cfg(target_os = "macos")]
fn system_decode(path: &Path, tmp_dir: &Path) -> Result<std::result::Result<Vec<f32>, String>> {
    let wav = tmp_dir.join(format!("import-{}.wav", std::process::id()));
    let converted = std::process::Command::new("/usr/bin/afconvert")
        // Channels as they are: told "-c 1", it keeps only the left one.
        .args(["-f", "WAVE", "-d", "LEI16@16000"])
        .arg(path)
        .arg(&wav)
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success());
    if !converted {
        let _ = std::fs::remove_file(&wav);
        return Ok(Err("afconvert".into()));
    }
    let bytes = std::fs::read(&wav);
    let _ = std::fs::remove_file(&wav);
    Ok(Ok(wav_samples(&bytes?).ok_or_else(|| anyhow!(tr!("audio_open_failed")))?))
}

/// Symphonia decodes the first audio track, its channels mixed into one and resampled to 16 kHz;
/// `Err(why)` if it can't read it (Opus, which `playback::decode` handles).
#[cfg(not(target_os = "macos"))]
fn system_decode(path: &Path, _tmp_dir: &Path) -> Result<std::result::Result<Vec<f32>, String>> {
    Ok(symphonia_decode(path))
}

#[cfg(any(not(target_os = "macos"), test))]
fn symphonia_decode(path: &Path) -> std::result::Result<Vec<f32>, String> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::{CODEC_TYPE_NULL, DecoderOptions};
    use symphonia::core::errors::Error;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, stream, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("Symphonia: {e}"))?;
    let mut format = probed.format;
    // A video's first track is usually the picture: the first one with sound.
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL && t.codec_params.sample_rate.is_some())
        .ok_or("Symphonia: no audio track")?;
    let track_id = track.id;
    let rate = track.codec_params.sample_rate.unwrap_or(SAMPLE_RATE as u32);
    let mut decoder = symphonia::default::get_codecs().make(&track.codec_params, &DecoderOptions::default()).map_err(|e| format!("Symphonia: {e}"))?;
    let mut resampler = crate::audio::Resampler::new(rate);
    let mut mono = Vec::new();
    let mut out = Vec::new();
    // The buffer and how many frames it holds: a bigger packet needs a new one.
    let mut buffer: Option<(SampleBuffer<f32>, usize)> = None;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            // The end of the file, or something it can't go past.
            Err(_) => break,
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            // A damaged packet: skip it, as players do.
            Err(Error::DecodeError(_)) => continue,
            Err(_) => break,
        };
        let spec = *decoded.spec();
        let channels = spec.channels.count().max(1);
        let frames = decoded.capacity();
        if buffer.as_ref().is_none_or(|(_, held)| *held < frames) {
            buffer = Some((SampleBuffer::new(frames as u64, spec), frames));
        }
        let (buf, _) = buffer.as_mut().unwrap();
        buf.copy_interleaved_ref(decoded);
        // Two people on two channels (a call recorded apart) both stay in.
        mono.clear();
        mono.extend(buf.samples().chunks_exact(channels).map(|f| f.iter().sum::<f32>() / channels as f32));
        if rate as usize == SAMPLE_RATE {
            out.extend_from_slice(&mono);
        } else {
            resampler.process(&mono, &mut out);
        }
    }
    if out.is_empty() { Err("Symphonia: no samples".into()) } else { Ok(out) }
}

/// The samples of a 16-bit PCM WAV, its channels mixed into one, whatever chunks come before
/// them (afconvert can write an extended format header, which sherpa-onnx's reader refuses).
#[cfg(any(target_os = "macos", test))]
fn wav_samples(bytes: &[u8]) -> Option<Vec<f32>> {
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return None;
    }
    let mut channels = 1;
    let mut at = 12;
    while at + 8 <= bytes.len() {
        let size = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().ok()?) as usize;
        let body = at + 8;
        match &bytes[at..at + 4] {
            b"fmt " => channels = u16::from_le_bytes(bytes.get(body + 2..body + 4)?.try_into().ok()?).max(1) as usize,
            b"data" => {
                let data = &bytes[body..(body + size).min(bytes.len())];
                let samples = data.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0);
                // Two people on two channels (a call recorded apart) both stay in.
                let mono = samples.collect::<Vec<_>>().chunks_exact(channels).map(|f| f.iter().sum::<f32>() / channels as f32).collect();
                return Some(mono);
            }
            _ => {}
        }
        // Chunks are padded to an even size.
        at = body + size + size % 2;
    }
    None
}

/// Where there is speech, by Silero VAD with the live engine's settings.
pub fn speech(models: &Path, samples: &[f32]) -> Result<Vec<Span>> {
    const WINDOW: usize = 512;
    let config = VadModelConfig {
        silero_vad: SileroVadModelConfig {
            model: Some(models.join("silero_vad.onnx").to_string_lossy().into_owned()),
            threshold: 0.5,
            min_silence_duration: 0.5,
            min_speech_duration: 0.25,
            window_size: WINDOW as i32,
            max_speech_duration: 15.0,
        },
        sample_rate: SAMPLE_RATE as i32,
        num_threads: 1,
        ..Default::default()
    };
    let vad = VoiceActivityDetector::create(&config, 60.0).ok_or_else(|| anyhow!(tr!("vad_load_failed")))?;
    let mut spans = vec![];
    let mut take = |vad: &VoiceActivityDetector| {
        while let Some(seg) = vad.front() {
            let start = seg.start() as f32 / SAMPLE_RATE as f32;
            spans.push(Span { start, end: start + seg.samples().len() as f32 / SAMPLE_RATE as f32 });
            vad.pop();
        }
    };
    for window in samples.chunks(WINDOW) {
        vad.accept_waveform(window);
        take(&vad);
    }
    vad.flush();
    take(&vad);
    Ok(spans)
}

/// Seconds of speech in each window Whisper listens to for the language.
const WINDOW_S: f32 = 10.0;
/// Windows spread over the file: enough to notice two languages, a few seconds in all.
const MAX_WINDOWS: usize = 8;

/// Up to MAX_WINDOWS groups of consecutive utterances with about WINDOW_S of speech each, spread
/// evenly over the file.
pub fn windows(spans: &[Span]) -> Vec<Vec<Span>> {
    let mut all: Vec<Vec<Span>> = vec![];
    let mut speech = 0.0;
    for span in spans {
        if all.is_empty() || speech >= WINDOW_S {
            all.push(vec![]);
            speech = 0.0;
        }
        let end = span.end.min(span.start + WINDOW_S);
        all.last_mut().unwrap().push(Span { start: span.start, end });
        speech += end - span.start;
    }
    // A short last window says little.
    if all.len() > 1 && all.last().is_some_and(|w| w.iter().map(|s| s.end - s.start).sum::<f32>() < WINDOW_S / 2.0) {
        all.pop();
    }
    if all.len() <= MAX_WINDOWS {
        return all;
    }
    let step = all.len() as f32 / MAX_WINDOWS as f32;
    (0..MAX_WINDOWS).map(|i| all[(i as f32 * step) as usize].clone()).collect()
}

/// Whisper's view of one window: how likely each of our languages is, and its own first choice.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct Heard {
    pub top: String,
    pub ca: f32,
    pub es: f32,
    pub en: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detected {
    /// "ca", "es", "en" or "ca-es"; None when it isn't clear (or it's another language).
    pub language: Option<String>,
    /// Windows Whisper listened to.
    pub windows: usize,
}

/// One of our languages wins a window by at least this much.
const SURE: f32 = 0.6;
/// Catalan and Spanish both at least this likely in one window: someone speaks each.
const SPLIT: f32 = 0.3;
/// Share of the windows that must be in each language to call the file mixed.
const MIXED_SHARE: f32 = 0.15;

/// The file's language from what Whisper heard in each window. Catalan and Spanish both heard
/// clearly means a mixed meeting: Whisper told one of them would translate the other.
pub fn decide(heard: &[Heard]) -> Detected {
    let windows = heard.len();
    // Windows won by each language; one where Catalan and Spanish are both likely (two people,
    // one in each) counts half for each.
    let mut count = [0f32; 3];
    for h in heard {
        let probs = [h.ca, h.es, h.en];
        let sum: f32 = probs.iter().sum();
        // Another language (Whisper's top is none of ours) or noise.
        if sum < 0.5 {
            continue;
        }
        let [ca, es, _] = probs.map(|p| p / sum);
        if let Some(i) = (0..3).find(|&i| probs[i] / sum >= SURE) {
            count[i] += 1.0;
        } else if ca >= SPLIT && es >= SPLIT {
            count[0] += 0.5;
            count[1] += 0.5;
        }
    }
    let counted: f32 = count.iter().sum();
    if counted == 0.0 || counted < windows as f32 / 2.0 {
        return Detected { language: None, windows };
    }
    let share = |n: f32| n / counted;
    let language = if share(count[2]) > 0.5 {
        "en"
    } else if share(count[0]) >= MIXED_SHARE && share(count[1]) >= MIXED_SHARE {
        "ca-es"
    } else if count[0] >= count[1] {
        "ca"
    } else {
        "es"
    };
    Detected { language: Some(language.into()), windows }
}

/// A file transcribed outside the app (the Claude connector, mcp.rs): the same steps as File ›
/// Transcribe from File… and its final pass, without the interface.
#[derive(Debug, Clone, Serialize)]
pub struct Transcript {
    pub language: String,
    /// The language came from listening to the file (not from whoever asked).
    pub detected: bool,
    pub duration: f32,
    pub utterances: Vec<Line>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Line {
    pub start: f32,
    pub end: f32,
    /// 0, 1, 2…: the same person keeps the same number.
    pub speaker: usize,
    pub text: String,
}

/// What a transcription is doing, for whoever waits on it.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Language,
    Transcribing,
    Speakers,
    Whisper,
}

/// Transcribes `path`: its language (if not given), the live engine, then who spoke when and
/// Whisper's text, as after a recording. `glossary`: words to spell as given (glossary.rs).
/// `progress` gets the stage and the share of it done.
pub fn transcribe_file(
    models: &Path,
    path: &Path,
    language: Option<&str>,
    max_speakers: usize,
    glossary: &[String],
    tmp_dir: &Path,
    mut progress: impl FnMut(Stage, f32),
) -> Result<Transcript> {
    use crate::engine::{Channel, Event, LiveModel, Models};
    use crate::pipeline::Pipeline;

    let samples = decode(path, tmp_dir)?;
    let duration = samples.len() as f32 / SAMPLE_RATE as f32;
    let whisper = crate::models::WHISPER.file(models, 0).is_file();
    let (language, detected) = match language {
        Some(l) => (l.to_string(), false),
        None if whisper => {
            progress(Stage::Language, 0.0);
            let pcm = tmp_dir.join(format!("detect-{}.pcm", std::process::id()));
            std::fs::write(&pcm, pcm_bytes(&samples))?;
            let heard = crate::retranscribe::detect(models, &pcm, &windows(&speech(models, &samples)?));
            let _ = std::fs::remove_file(&pcm);
            match decide(&heard?).language {
                Some(l) => (l, true),
                None => ("ca".to_string(), false),
            }
        }
        None => ("ca".to_string(), false),
    };

    progress(Stage::Transcribing, 0.0);
    let live = Models::load(models, LiveModel::for_language(&language))?;
    let tap = tmp_dir.join(format!("tap-{}.pcm", std::process::id()));
    let mut pipeline = Pipeline::new(&live, true, false, max_speakers, 0.65, None, vec![(Channel::Mic, tap.clone())])?;
    pipeline.set_partials(false);
    pipeline.set_glossary(glossary.to_vec());
    let mut lines: Vec<Line> = vec![];
    let mut take = |events: Vec<Event>| {
        for e in events {
            if let Event::Final { start, end, speaker, text, .. } = e {
                lines.push(Line { start, end, speaker, text });
            }
        }
    };
    let chunks = samples.chunks(SAMPLE_RATE / 2);
    let total = chunks.len().max(1);
    for (i, chunk) in chunks.enumerate() {
        take(pipeline.push(crate::audio::Source::Mic, chunk));
        if i % 20 == 0 {
            progress(Stage::Transcribing, i as f32 / total as f32);
        }
    }
    let (events, tapped) = pipeline.finish()?;
    take(events);
    drop(live);

    let result = (|| -> Result<()> {
        let Some(tapped) = tapped.into_iter().find(|t| !t.spans.is_empty()) else {
            return Ok(());
        };
        progress(Stage::Speakers, 0.0);
        let assignments = crate::diarize::verify(models, &samples, &tapped.spans, 0, max_speakers, || {})?;
        for a in assignments {
            if let Some(line) = lines.iter_mut().find(|l| (l.start - a.start).abs() < 0.01) {
                line.speaker = a.speaker;
            }
        }
        // Whisper only for one language: told "Catalan", it turns Spanish into Catalan.
        if whisper && language != "ca-es" {
            progress(Stage::Whisper, 0.0);
            let texts = crate::retranscribe::transcribe(models, &language, &[(tapped.path.as_path(), tapped.spans.as_slice())], glossary, |p| progress(Stage::Whisper, p))?;
            for t in texts.into_iter().flatten() {
                if let Some(line) = lines.iter_mut().find(|l| (l.start - t.start).abs() < 0.01) {
                    line.text = t.text;
                }
            }
        }
        Ok(())
    })();
    let _ = std::fs::remove_file(&tap);
    result?;
    // Speakers numbered in the order they first speak.
    let mut order: Vec<usize> = vec![];
    for line in &mut lines {
        let n = order.iter().position(|&s| s == line.speaker).unwrap_or_else(|| {
            order.push(line.speaker);
            order.len() - 1
        });
        line.speaker = n;
    }
    Ok(Transcript { language, detected, duration, utterances: lines })
}

/// Samples as 16-bit PCM, what the Whisper process reads.
pub fn pcm_bytes(samples: &[f32]) -> Vec<u8> {
    samples.iter().flat_map(|s| ((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn heard(ca: f32, es: f32, en: f32) -> Heard {
        Heard { top: String::new(), ca, es, en }
    }

    #[test]
    fn one_language() {
        let ca = vec![heard(0.99, 0.01, 0.0), heard(0.84, 0.11, 0.03), heard(0.61, 0.28, 0.06), heard(0.97, 0.02, 0.0)];
        assert_eq!(decide(&ca).language.as_deref(), Some("ca"));
        assert_eq!(decide(&[heard(0.0, 1.0, 0.0)]).language.as_deref(), Some("es"));
        assert_eq!(decide(&[heard(0.0, 0.0, 1.0), heard(0.1, 0.0, 0.9)]).language.as_deref(), Some("en"));
    }

    #[test]
    fn both_catalan_and_spanish_is_mixed() {
        let mixed = vec![heard(0.95, 0.05, 0.0), heard(0.1, 0.9, 0.0), heard(0.9, 0.1, 0.0), heard(0.8, 0.2, 0.0)];
        assert_eq!(decide(&mixed).language.as_deref(), Some("ca-es"));
        // Sentences in each language within the same window.
        assert_eq!(decide(&[heard(0.53, 0.45, 0.0)]).language.as_deref(), Some("ca-es"));
    }

    #[test]
    fn symphonia_reads_and_resamples() {
        // One second of 48 kHz stereo 16-bit WAV: left at +0.5, right at -0.25.
        let rate = 48_000u32;
        let mut wav = b"RIFF".to_vec();
        let data = rate * 4;
        wav.extend((36 + data).to_le_bytes());
        wav.extend(b"WAVEfmt ");
        wav.extend(16u32.to_le_bytes());
        wav.extend(1u16.to_le_bytes());
        wav.extend(2u16.to_le_bytes());
        wav.extend(rate.to_le_bytes());
        wav.extend((rate * 4).to_le_bytes());
        wav.extend(4u16.to_le_bytes());
        wav.extend(16u16.to_le_bytes());
        wav.extend(b"data");
        wav.extend(data.to_le_bytes());
        for _ in 0..rate {
            wav.extend(16384i16.to_le_bytes());
            wav.extend((-8192i16).to_le_bytes());
        }
        let path = std::env::temp_dir().join(format!("murmur-import-{}.wav", std::process::id()));
        std::fs::write(&path, wav).unwrap();
        let samples = symphonia_decode(&path).unwrap();
        std::fs::remove_file(&path).ok();
        assert!((15_990..=16_010).contains(&samples.len()), "{}", samples.len());
        assert!(samples[100..].iter().all(|s| (s - 0.125).abs() < 0.01));
    }

    #[test]
    fn reads_an_extended_wav() {
        let mut wav = b"RIFF\0\0\0\0WAVEfmt \x28\0\0\0".to_vec();
        wav.extend([0u8; 40]);
        wav[22] = 1;
        wav.extend(b"data\x04\0\0\0");
        wav.extend([0x00, 0x40, 0x00, 0xc0]);
        assert_eq!(wav_samples(&wav), Some(vec![0.5, -0.5]));
        // Stereo: the channels mixed.
        wav[22] = 2;
        assert_eq!(wav_samples(&wav), Some(vec![0.0]));
    }

    #[test]
    fn unclear_or_another_language() {
        assert_eq!(decide(&[]).language, None);
        // Portuguese: none of ours is likely.
        assert_eq!(decide(&[heard(0.05, 0.2, 0.01), heard(0.02, 0.1, 0.0)]).language, None);
        // Noise: no window is sure.
        assert_eq!(decide(&[heard(0.2, 0.25, 0.02), heard(0.2, 0.1, 0.1)]).language, None);
        // Catalan with a noisy window that sounds half Spanish.
        let ca = [vec![heard(0.98, 0.02, 0.0); 7], vec![heard(0.36, 0.59, 0.02)]].concat();
        assert_eq!(decide(&ca).language.as_deref(), Some("ca"));
    }

    #[test]
    fn windows_spread_over_the_file() {
        let spans: Vec<Span> = (0..100).map(|i| Span { start: i as f32 * 6.0, end: i as f32 * 6.0 + 5.0 }).collect();
        let w = windows(&spans);
        assert_eq!(w.len(), MAX_WINDOWS);
        assert!(w.iter().all(|w| w.len() == 2));
        assert!(w.last().unwrap()[0].start > 500.0);
        assert_eq!(windows(&spans[..1]).len(), 1);
    }
}
