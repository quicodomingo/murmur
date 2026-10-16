//! Offline speaker diarization for the final pass: pyannote segmentation + 3D-Speaker embeddings
//! + clustering over a whole channel, then each live utterance gets the speaker it overlaps most.

use std::path::Path;

use anyhow::{Context, Result, anyhow};
use serde::Serialize;
use sherpa_onnx::{
    FastClusteringConfig, OfflineSpeakerDiarization, OfflineSpeakerDiarizationConfig,
    OfflineSpeakerSegmentationModelConfig, OfflineSpeakerSegmentationPyannoteModelConfig,
    SpeakerEmbeddingExtractorConfig,
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

/// Clustering threshold for meetings. On a real 20-min, 5-speaker meeting: 1.0 → 8 speakers,
/// 1.05 → 7, 1.1 → 5, 1.2 → 3 (see diarize_probe). Tuned on one meeting: revisit with more.
pub const DEFAULT_THRESHOLD: f32 = 1.1;

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

/// Segmentation window step used by the app. 0.5 is ~6× faster than the library's 0.1
/// (RTF 0.035 vs 0.19 on an M4) with the same speaker count (see diarize_probe).
pub const DEFAULT_WINDOW_SHIFT: f32 = 0.5;

pub fn diarize(models: &Path, samples: &[f32], opts: Options) -> Result<Vec<Turn>> {
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
            model: Some(path("3dspeaker_eres2net_base.onnx")?),
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
    let result = sd
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

/// Gives every utterance the speaker it overlaps most (or the nearest turn if it falls in a gap).
/// Speakers are renumbered by order of appearance, starting at `base`, so "Parlant 1" speaks first.
/// Speakers that actually got utterances.
pub fn speaker_count(assignments: &[Assignment]) -> usize {
    let mut ids: Vec<usize> = assignments.iter().map(|a| a.speaker).collect();
    ids.sort();
    ids.dedup();
    ids.len()
}

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

#[cfg(test)]
mod tests {
    use super::*;

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
