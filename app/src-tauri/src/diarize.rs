//! Offline speaker diarization for the final pass: pyannote segmentation + 3D-Speaker embeddings
//! + clustering over a whole channel, then each live utterance gets the speaker it overlaps most.

use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result, anyhow};
use serde::Serialize;
use sherpa_onnx::{
    FastClusteringConfig, OfflineSpeakerDiarization, OfflineSpeakerDiarizationConfig,
    OfflineSpeakerSegmentationModelConfig, OfflineSpeakerSegmentationPyannoteModelConfig,
    SpeakerEmbeddingExtractor, SpeakerEmbeddingExtractorConfig,
};

#[derive(Debug, Clone, Copy)]
pub struct Turn {
    pub start: f32,
    pub end: f32,
    pub speaker: usize,
}

/// A live utterance to relabel (start/end in seconds, as emitted by the engine).
#[derive(Debug, Clone, Copy)]
pub struct Span {
    pub start: f32,
    pub end: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct Assignment {
    pub start: f32,
    pub speaker: usize,
}

/// Final-pass settings, chosen on hand-labelled lines of a real 20-min, 4-speaker meeting
/// (bench/speakers_eval.py; live clustering scored F1 0.62):
///   window 0.1, threshold 0.9 → F1 0.85 (RTF 0.18) · window 0.2, threshold 0.9 → F1 0.91, 96% of
///   lines right (RTF 0.12) · window 0.5 → F1 ≤ 0.71 at any threshold.
/// Counting speakers is misleading: window 0.5 / threshold 1.1 found "5 speakers" but lumped
/// most lines together. Tuned on one meeting: re-check with more labelled meetings.
pub const DEFAULT_THRESHOLD: f32 = 0.9;
pub const DEFAULT_WINDOW_SHIFT: f32 = 0.2;

/// The final pass keeps 3D-Speaker: with TitaNet (better live) it scored F1 ≤ 0.72.
/// `TRANSCRIPTOR_DIARIZE_EMBEDDING` overrides it for experiments.
pub fn embedding_model() -> String {
    std::env::var("TRANSCRIPTOR_DIARIZE_EMBEDDING")
        .unwrap_or_else(|_| "3dspeaker_eres2net_base.onnx".into())
}

#[derive(Debug, Clone, Copy)]
pub struct Options {
    /// Exact number of speakers, if known; otherwise clustering decides with `threshold`.
    pub num_speakers: Option<usize>,
    /// Clustering distance: higher merges more voices into one speaker.
    pub threshold: f32,
    /// Segmentation window step as a fraction of its 10 s window (higher = faster, coarser).
    pub window_shift: f32,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            num_speakers: None,
            threshold: DEFAULT_THRESHOLD,
            window_shift: DEFAULT_WINDOW_SHIFT,
        }
    }
}

pub fn diarize(models: &Path, samples: &[f32], opts: Options) -> Result<Vec<Turn>> {
    Diarizer::new(models, opts)?.run(samples)
}

/// The loaded models, to diarize several pieces of audio (e.g. windows of a live recording).
pub struct Diarizer {
    sd: OfflineSpeakerDiarization,
}

impl Diarizer {
    pub fn new(models: &Path, opts: Options) -> Result<Self> {
        let path = |p: &str| -> Result<String> {
            let full = models.join(p);
            if !full.exists() {
                return Err(anyhow!("Falta el model {}", full.display()));
            }
            Ok(full.to_string_lossy().into_owned())
        };
        let threads = std::thread::available_parallelism().map_or(4, |n| n.get().min(8)) as i32;
        let config = OfflineSpeakerDiarizationConfig {
            segmentation: OfflineSpeakerSegmentationModelConfig {
                pyannote: OfflineSpeakerSegmentationPyannoteModelConfig {
                    model: Some(path("sherpa-onnx-pyannote-segmentation-3-0/model.onnx")?),
                    window_shift_ratio: opts.window_shift,
                },
                num_threads: threads,
                ..Default::default()
            },
            embedding: SpeakerEmbeddingExtractorConfig {
                model: Some(path(&embedding_model())?),
                num_threads: threads,
                ..Default::default()
            },
            clustering: FastClusteringConfig {
                num_clusters: opts.num_speakers.map_or(-1, |n| n as i32),
                threshold: opts.threshold,
                ..Default::default()
            },
            ..Default::default()
        };
        let sd = OfflineSpeakerDiarization::create(&config)
            .context("No s'ha pogut carregar el model de parlants")?;
        Ok(Self { sd })
    }

    pub fn run(&self, samples: &[f32]) -> Result<Vec<Turn>> {
        let result = self
            .sd
            .process(samples)
            .ok_or_else(|| anyhow!("La verificació de parlants ha fallat"))?;
        Ok(result
            .sort_by_start_time()
            .into_iter()
            .map(|s| Turn {
                start: s.start,
                end: s.end,
                speaker: s.speaker as usize,
            })
            .collect())
    }
}

/// Speakers that actually got utterances.
pub fn speaker_count(assignments: &[Assignment]) -> usize {
    let mut ids: Vec<usize> = assignments.iter().map(|a| a.speaker).collect();
    ids.sort();
    ids.dedup();
    ids.len()
}

/// Gives every utterance the speaker it overlaps most (or the nearest turn if it falls in a gap).
/// Speakers are renumbered by order of appearance, starting at `base`, so "Parlant 1" speaks first.
pub fn assign(spans: &[Span], turns: &[Turn], base: usize) -> Vec<Assignment> {
    if turns.is_empty() {
        return vec![];
    }
    let mut order: Vec<usize> = vec![];
    spans
        .iter()
        .map(|s| {
            let overlap = |t: &Turn| (s.end.min(t.end) - s.start.max(t.start)).max(0.0);
            let best = turns
                .iter()
                .max_by(|a, b| overlap(a).total_cmp(&overlap(b)))
                .filter(|t| overlap(t) > 0.0)
                .or_else(|| {
                    let mid = (s.start + s.end) / 2.0;
                    let gap = |t: &Turn| (mid - t.start).abs().min((mid - t.end).abs());
                    turns.iter().min_by(|a, b| gap(a).total_cmp(&gap(b)))
                })
                .unwrap();
            let index = order
                .iter()
                .position(|&k| k == best.speaker)
                .unwrap_or_else(|| {
                    order.push(best.speaker);
                    order.len() - 1
                });
            Assignment {
                start: s.start,
                speaker: base + index,
            }
        })
        .collect()
}

/// A speaker heard for less than this over the whole channel is taken for one of the others.
/// On a Google Meet call with one remote person (~35 s of speech), the clustering split off
/// groups of 1–6 s depending on where its windows fell; on the hand-labelled room meeting the
/// smallest real group had 16 s. Someone who only says a few words gets merged too.
pub const MIN_SPEAKER_S: f32 = 10.0;
/// Longest utterances used for each speaker's average voice (bounds the cost on long meetings).
const VOICE_SPANS: usize = 30;

/// Moves the utterances of speakers with under `MIN_SPEAKER_S` of speech to the larger speaker
/// with the most similar voice (3D-Speaker), then renumbers by order of appearance from `base`.
pub fn absorb_small_speakers(
    models: &Path,
    samples: &[f32],
    spans: &[Span],
    assignments: Vec<Assignment>,
    base: usize,
) -> Result<Vec<Assignment>> {
    if small_and_large(spans, &assignments).is_none() {
        return Ok(assignments);
    }
    let model = models.join(embedding_model());
    let extractor = SpeakerEmbeddingExtractor::create(&SpeakerEmbeddingExtractorConfig {
        model: Some(model.to_string_lossy().into_owned()),
        num_threads: std::thread::available_parallelism().map_or(4, |n| n.get().min(8)) as i32,
        ..Default::default()
    })
    .context("No s'ha pogut carregar el model de parlants")?;
    let audio = |s: &Span| {
        let a = ((s.start.max(0.0) * 16_000.0) as usize).min(samples.len());
        let b = ((s.end.max(0.0) * 16_000.0) as usize).min(samples.len());
        &samples[a..b]
    };
    let voice = |indices: &[usize]| -> Option<Vec<f32>> {
        let mut sum: Vec<f32> = vec![];
        for &i in indices {
            let stream = extractor.create_stream()?;
            stream.accept_waveform(16_000, audio(&spans[i]));
            stream.input_finished();
            if !extractor.is_ready(&stream) {
                continue;
            }
            let e = extractor.compute(&stream)?;
            let norm = e.iter().map(|x| x * x).sum::<f32>().sqrt() + 1e-9;
            sum.resize(e.len(), 0.0);
            sum.iter_mut().zip(&e).for_each(|(s, x)| *s += x / norm);
        }
        (!sum.is_empty()).then_some(sum)
    };
    Ok(absorb(spans, assignments, base, voice))
}

/// Seconds of speech per speaker, split at `MIN_SPEAKER_S`; `None` unless there are both.
fn small_and_large(spans: &[Span], assignments: &[Assignment]) -> Option<(Vec<usize>, Vec<usize>)> {
    let mut secs: HashMap<usize, f32> = HashMap::new();
    for (s, a) in spans.iter().zip(assignments) {
        *secs.entry(a.speaker).or_default() += s.end - s.start;
    }
    let (small, large): (Vec<usize>, Vec<usize>) = secs.keys().partition(|k| secs[k] < MIN_SPEAKER_S);
    (!small.is_empty() && !large.is_empty()).then_some((small, large))
}

/// `voice` gives the summed voice print of some utterances (by index), if any is long enough.
fn absorb(
    spans: &[Span],
    mut assignments: Vec<Assignment>,
    base: usize,
    voice: impl Fn(&[usize]) -> Option<Vec<f32>>,
) -> Vec<Assignment> {
    let Some((small, large)) = small_and_large(spans, &assignments) else { return assignments };
    let lines = |speaker: usize| -> Vec<usize> {
        (0..assignments.len()).filter(|&i| assignments[i].speaker == speaker).collect()
    };
    let large: Vec<(usize, Vec<f32>)> = large
        .into_iter()
        .filter_map(|speaker| {
            let mut indices = lines(speaker);
            indices.sort_by(|&a, &b| (spans[b].end - spans[b].start).total_cmp(&(spans[a].end - spans[a].start)));
            indices.truncate(VOICE_SPANS);
            voice(&indices).map(|v| (speaker, v))
        })
        .collect();
    let cosine = |a: &[f32], b: &[f32]| {
        let norm = |v: &[f32]| v.iter().map(|x| x * x).sum::<f32>().sqrt() + 1e-9;
        a.iter().zip(b).map(|(x, y)| x * y).sum::<f32>() / (norm(a) * norm(b))
    };
    let mut target: HashMap<usize, usize> = HashMap::new();
    for speaker in small {
        let Some(v) = voice(&lines(speaker)) else { continue };
        if let Some((to, _)) = large.iter().max_by(|a, b| cosine(&a.1, &v).total_cmp(&cosine(&b.1, &v))) {
            target.insert(speaker, *to);
        }
    }
    for a in &mut assignments {
        a.speaker = target.get(&a.speaker).copied().unwrap_or(a.speaker);
    }
    // Renumber by order of appearance again.
    let mut order: Vec<usize> = vec![];
    for a in &mut assignments {
        let index = order.iter().position(|&k| k == a.speaker).unwrap_or_else(|| {
            order.push(a.speaker);
            order.len() - 1
        });
        a.speaker = base + index;
    }
    assignments
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_speakers_join_the_closest_voice() {
        let spans: Vec<Span> = [(0.0, 8.0), (9.0, 10.0), (11.0, 23.0), (24.0, 26.0), (27.0, 37.0)]
            .iter()
            .map(|&(start, end)| Span { start, end })
            .collect();
        let speakers = [100, 101, 102, 103, 100];
        let assignments = spans
            .iter()
            .zip(speakers)
            .map(|(s, speaker)| Assignment { start: s.start, speaker })
            .collect();
        // 100 and 102 are large; 101 sounds like 102, 103 like 100.
        let voice = |indices: &[usize]| -> Option<Vec<f32>> {
            let near_first = indices.iter().any(|&i| speakers[i] == 100 || speakers[i] == 103);
            Some(if near_first { vec![1.0, 0.1] } else { vec![0.1, 1.0] })
        };
        let out: Vec<usize> = absorb(&spans, assignments, 100, voice).iter().map(|a| a.speaker).collect();
        assert_eq!(out, [100, 101, 101, 100, 100]);
    }

    #[test]
    fn assigns_by_overlap_and_numbers_by_appearance() {
        let turns = [
            Turn {
                start: 0.0,
                end: 4.0,
                speaker: 7,
            },
            Turn {
                start: 4.0,
                end: 9.0,
                speaker: 2,
            },
            Turn {
                start: 9.5,
                end: 12.0,
                speaker: 7,
            },
        ];
        let spans = [
            Span {
                start: 0.5,
                end: 3.0,
            },
            Span {
                start: 3.5,
                end: 8.0,
            }, // mostly in speaker 2's turn
            Span {
                start: 9.3,
                end: 9.45,
            }, // in a gap, closer to the third turn (speaker 7)
            Span {
                start: 10.0,
                end: 11.0,
            },
        ];
        let a = assign(&spans, &turns, 100);
        let speakers: Vec<usize> = a.iter().map(|x| x.speaker).collect();
        assert_eq!(speakers, vec![100, 101, 100, 100]);
    }
}
