//! Live diarization prototype: pyannote over a sliding window, local speakers linked to global
//! ones by voice (3D-Speaker centroids). Window 5 s / hop 0.5 s is diart-like; 20 s / 5 s is the
//! coarse option. Each labelled span gets its speaker from the first window that covers its end.
//!     cargo run --release --example window_diarize -- audio.wav spans.json 5,0.5,0.6 20,5,0.6 …
//! Config: window seconds, hop seconds, link threshold (cosine to an existing speaker)
//! [, local clustering threshold [, least speech in the window to start a new speaker]]. Prints one JSON line per config (bench/speakers_eval.py).
use std::time::Instant;

use sherpa_onnx::{SpeakerEmbeddingExtractor, SpeakerEmbeddingExtractorConfig};
use transcriptor_lib::diarize::{Diarizer, Options, Span, Turn, embedding_model};
use transcriptor_lib::engine::models_dir;

const SR: f32 = 16_000.0;
/// Least speech of a local speaker in a window to trust its voice print.
const MIN_VOICE_S: f32 = 1.0;

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let n = |v: &[f32]| v.iter().map(|x| x * x).sum::<f32>().sqrt() + 1e-9;
    a.iter().zip(b).map(|(x, y)| x * y).sum::<f32>() / (n(a) * n(b))
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let wave = sherpa_onnx::Wave::read(&args[1]).expect("read");
    let samples = wave.samples();
    let labelled: Vec<serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(&args[2])?)?;
    let spans: Vec<Span> = labelled
        .iter()
        .map(|l| Span { start: l["start"].as_f64().unwrap() as f32, end: l["end"].as_f64().unwrap() as f32 })
        .collect();
    let last = spans.iter().map(|s| s.end).fold(0.0, f32::max) + 1.0;
    let extractor = SpeakerEmbeddingExtractor::create(&SpeakerEmbeddingExtractorConfig {
        model: Some(models_dir().join(embedding_model()).to_string_lossy().into_owned()),
        num_threads: 2,
        ..Default::default()
    })
    .expect("extractor");
    let embed = |audio: &[f32]| -> Option<Vec<f32>> {
        let stream = extractor.create_stream()?;
        stream.accept_waveform(16_000, audio);
        stream.input_finished();
        if !extractor.is_ready(&stream) {
            return None;
        }
        let mut e = extractor.compute(&stream)?;
        let norm = e.iter().map(|x| x * x).sum::<f32>().sqrt() + 1e-9;
        e.iter_mut().for_each(|x| *x /= norm);
        Some(e)
    };

    for config in &args[3..] {
        let v: Vec<f32> = config.split(',').map(|x| x.parse().unwrap()).collect();
        let (window, hop, link) = (v[0], v[1], v[2]);
        let local_threshold = v.get(3).copied().unwrap_or(0.9);
        let min_new = v.get(4).copied().unwrap_or(2.0);
        let diarizer = Diarizer::new(
            &models_dir(),
            Options { threshold: local_threshold, window_shift: 0.2, num_speakers: None },
        )?;
        let mut globals: Vec<Vec<f32>> = vec![];
        let mut speakers: Vec<Option<usize>> = vec![None; spans.len()];
        let mut delays = vec![];
        let mut previous = 0usize;
        let started = Instant::now();
        let mut now = hop;
        while now < last + hop {
            let from = (now - window).max(0.0);
            let audio = &samples[(from * SR) as usize..((now * SR) as usize).min(samples.len())];
            let turns: Vec<Turn> = diarizer
                .run(audio)?
                .into_iter()
                .map(|t| Turn { start: t.start + from, end: t.end + from, speaker: t.speaker })
                .collect();
            // Local speakers: their speech and voice in this window.
            let mut locals: Vec<usize> = turns.iter().map(|t| t.speaker).collect();
            locals.sort();
            locals.dedup();
            let mut local_voice = vec![];
            for &l in &locals {
                let mine: Vec<&Turn> = turns.iter().filter(|t| t.speaker == l).collect();
                let secs: f32 = mine.iter().map(|t| t.end - t.start).sum();
                let mut audio = vec![];
                for t in &mine {
                    let a = ((t.start - from) * SR) as usize;
                    let b = (((t.end - from) * SR) as usize).min(((now - from) * SR) as usize);
                    audio.extend_from_slice(&samples[(from * SR) as usize + a..((from * SR) as usize + b).min(samples.len())]);
                }
                let voice = if secs >= MIN_VOICE_S { embed(&audio) } else { None };
                local_voice.push((l, secs, voice));
            }
            // Link each local speaker to a global one (best first, one local per global).
            let mut pairs = vec![];
            for (i, (_, _, voice)) in local_voice.iter().enumerate() {
                if let Some(voice) = voice {
                    for (g, centroid) in globals.iter().enumerate() {
                        pairs.push((cosine(centroid, voice), i, g));
                    }
                }
            }
            pairs.sort_by(|a, b| b.0.total_cmp(&a.0));
            let mut map: Vec<Option<usize>> = vec![None; local_voice.len()];
            let mut taken = vec![false; globals.len()];
            for (sim, i, g) in pairs {
                if sim >= link && map[i].is_none() && !taken[g] {
                    map[i] = Some(g);
                    taken[g] = true;
                }
            }
            for (i, (_, secs, voice)) in local_voice.iter().enumerate() {
                match (map[i], voice) {
                    (Some(g), Some(voice)) => globals[g].iter_mut().zip(voice).for_each(|(c, x)| *c += x),
                    (None, Some(voice)) if *secs >= min_new => {
                        globals.push(voice.clone());
                        map[i] = Some(globals.len() - 1);
                    }
                    _ => {}
                }
            }
            // Spans that ended in this window get the global speaker they overlap most.
            for (k, span) in spans.iter().enumerate() {
                if speakers[k].is_some() || span.end > now || span.end < from {
                    continue;
                }
                let mut best = (0.0f32, None);
                for t in &turns {
                    let overlap = (span.end.min(t.end) - span.start.max(t.start)).max(0.0);
                    let li = locals.iter().position(|&l| l == t.speaker).unwrap();
                    if overlap > best.0 && map[li].is_some() {
                        best = (overlap, map[li]);
                    }
                }
                let speaker = best.1.unwrap_or(previous);
                speakers[k] = Some(speaker);
                previous = speaker;
                delays.push(now - span.end);
            }
            now += hop;
        }
        let elapsed = started.elapsed().as_secs_f32();
        let speakers: Vec<usize> = speakers.iter().map(|s| s.unwrap_or(previous)).collect();
        let delay = delays.iter().sum::<f32>() / delays.len().max(1) as f32;
        eprintln!("{config}: {} speakers, RTF {:.3}, mean delay {delay:.1}s", globals.len(), elapsed / last);
        println!("{}", serde_json::json!({"config": config, "speakers": speakers}));
    }
    Ok(())
}
