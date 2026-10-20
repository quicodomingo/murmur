//! Live transcription engine: Silero VAD → Conformer ca-es (partial + final) → online speaker
//! clustering. Port of `mvp/live.py` on top of sherpa-onnx.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow};
use serde::Serialize;
use sherpa_onnx::{
    OfflineNemoEncDecCtcModelConfig, OfflineRecognizer, OfflineRecognizerConfig,
    OfflineTransducerModelConfig, SileroVadModelConfig,
    SpeakerEmbeddingExtractor, SpeakerEmbeddingExtractorConfig, VadModelConfig,
    VoiceActivityDetector,
};

pub const SAMPLE_RATE: usize = 16_000;
const VAD_WINDOW: usize = 512;
/// How often the in-progress utterance is re-decoded, in seconds of audio.
const PARTIAL_EVERY_S: f32 = 0.6;
/// Shorter utterances can't create or update speakers (their embeddings are too noisy).
const MIN_EMBED_S: f32 = 1.0;

/// Shortest utterance that may start a new speaker (shorter ones join the closest one): short
/// phrases, above all on calls, have the least reliable voice prints. On the hand-labelled
/// meeting 1–2.5 s score the same (88%), 3 s drops to 75%. `TRANSCRIPTOR_NEW_SPEAKER_S` overrides it.
fn new_speaker_min_s() -> f32 {
    std::env::var("TRANSCRIPTOR_NEW_SPEAKER_S").ok().and_then(|v| v.parse().ok()).unwrap_or(2.0)
}
/// Audio kept before the VAD fires, so partials don't miss the first syllable.
const PREROLL_S: f32 = 0.4;
const MAX_SPEECH_S: f32 = 15.0;
/// Partials only re-decode the tail of the utterance, to bound CPU on long sentences.
const PARTIAL_MAX_S: f32 = 8.0;

/// Speaker-embedding model for live clustering. On hand-labelled lines of a real meeting, NeMo
/// TitaNet-small at threshold 0.7 got 88% right vs 75% for 3D-Speaker (see bench/speakers_eval.py).
/// `TRANSCRIPTOR_EMBEDDING` overrides it for experiments.
pub fn embedding_model() -> String {
    std::env::var("TRANSCRIPTOR_EMBEDDING").unwrap_or_else(|_| "nemo_en_titanet_small.onnx".into())
}

static APP_MODELS: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Set at startup: `<app data>/models`, where downloaded models go.
pub fn set_app_models_dir(dir: PathBuf) {
    let _ = APP_MODELS.set(dir);
}

/// Where the model files live: `TRANSCRIPTOR_MODELS`, else the repo's `models/` folder when the
/// app was built on this Mac (development), else the app's data folder.
pub fn models_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("TRANSCRIPTOR_MODELS") {
        return PathBuf::from(dir);
    }
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../models");
    if repo.is_dir() {
        return repo;
    }
    APP_MODELS.get().cloned().unwrap_or(repo)
}

fn path_str(p: PathBuf) -> Result<String> {
    if !p.exists() {
        return Err(anyhow!("Falta el model {}", p.display()));
    }
    Ok(p.to_string_lossy().into_owned())
}

/// Models loaded once and shared by sessions.
pub struct Models {
    pub kind: LiveModel,
    recognizer: OfflineRecognizer,
    embedder: SpeakerEmbeddingExtractor,
    vad_model: String,
}

/// Which speech model transcribes live, by the meeting's language.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LiveModel {
    /// The AINA Conformer: Catalan and Spanish, also mixed in one sentence.
    CatalanSpanish,
    /// NVIDIA Parakeet TDT-CTC 110M (models.rs ENGLISH).
    English,
}

impl LiveModel {
    /// `language`: "ca", "es", "ca-es" or "en" (Settings.language in the UI).
    pub fn for_language(language: &str) -> Self {
        if language == "en" { Self::English } else { Self::CatalanSpanish }
    }
}

impl Models {
    pub fn load(dir: &Path, kind: LiveModel) -> Result<Self> {
        let mut config = OfflineRecognizerConfig::default();
        match kind {
            LiveModel::CatalanSpanish => {
                let asr = dir.join("conformer-ca-es-sherpa");
                config.model_config.transducer = OfflineTransducerModelConfig {
                    encoder: Some(path_str(asr.join("encoder.onnx"))?),
                    decoder: Some(path_str(asr.join("decoder.onnx"))?),
                    joiner: Some(path_str(asr.join("joiner.onnx"))?),
                };
                config.model_config.tokens = Some(path_str(asr.join("tokens.txt"))?);
                config.model_config.model_type = Some("nemo_transducer".into());
            }
            LiveModel::English => {
                let asr = crate::models::ENGLISH.path(dir);
                config.model_config.nemo_ctc = OfflineNemoEncDecCtcModelConfig {
                    model: Some(path_str(asr.join("model.onnx"))?),
                };
                config.model_config.tokens = Some(path_str(asr.join("tokens.txt"))?);
            }
        }
        config.model_config.num_threads = 4;
        config.decoding_method = Some("greedy_search".into());
        let recognizer =
            OfflineRecognizer::create(&config).context("No s'ha pogut carregar el model de veu")?;

        let embedder = SpeakerEmbeddingExtractor::create(&SpeakerEmbeddingExtractorConfig {
            model: Some(path_str(dir.join(embedding_model()))?),
            num_threads: 2,
            ..Default::default()
        })
        .context("No s'ha pogut carregar el model de parlants")?;

        Ok(Self {
            kind,
            recognizer,
            embedder,
            vad_model: path_str(dir.join("silero_vad.onnx"))?,
        })
    }

    pub fn transcribe(&self, samples: &[f32]) -> String {
        let stream = self.recognizer.create_stream();
        stream.accept_waveform(SAMPLE_RATE as i32, samples);
        self.recognizer.decode(&stream);
        stream
            .get_result()
            .map(|r| r.text.trim().to_string())
            .unwrap_or_default()
    }

    fn embed(&self, samples: &[f32]) -> Option<Vec<f32>> {
        let stream = self.embedder.create_stream()?;
        stream.accept_waveform(SAMPLE_RATE as i32, samples);
        stream.input_finished();
        if !self.embedder.is_ready(&stream) {
            return None;
        }
        let mut emb = self.embedder.compute(&stream)?;
        let norm = emb.iter().map(|x| x * x).sum::<f32>().sqrt() + 1e-9;
        emb.iter_mut().for_each(|x| *x /= norm);
        Some(emb)
    }
}

/// Online clustering: each utterance joins the closest speaker or starts a new one.
struct SpeakerClusters {
    max_speakers: usize,
    threshold: f32,
    sums: Vec<Vec<f32>>,
    last: usize,
}

impl SpeakerClusters {
    fn assign(&mut self, emb: Option<Vec<f32>>, duration: f32) -> usize {
        let Some(emb) = emb else { return self.last };
        let reliable = duration >= MIN_EMBED_S;
        if self.sums.is_empty() {
            if reliable {
                self.sums.push(emb);
            }
            return 0;
        }
        let sims: Vec<f32> = self
            .sums
            .iter()
            .map(|s| {
                let norm = s.iter().map(|x| x * x).sum::<f32>().sqrt() + 1e-9;
                s.iter().zip(&emb).map(|(a, b)| a * b).sum::<f32>() / norm
            })
            .collect();
        let (mut best, best_sim) =
            sims.iter()
                .copied()
                .enumerate()
                .fold(
                    (0, f32::MIN),
                    |acc, (i, s)| if s > acc.1 { (i, s) } else { acc },
                );

        if !reliable {
            // Short interjection: never create speakers from it; if unsure keep the current one.
            if best_sim < self.threshold {
                best = self.last;
            }
        } else if best_sim >= self.threshold || self.sums.len() >= self.max_speakers || duration < new_speaker_min_s() {
            add_into(&mut self.sums[best], &emb);
        } else {
            self.sums.push(emb);
            best = self.sums.len() - 1;
        }
        self.last = best;
        best
    }
}

fn add_into(acc: &mut [f32], v: &[f32]) {
    acc.iter_mut().zip(v).for_each(|(a, b)| *a += b);
}

/// Where an utterance was heard. Each channel is transcribed by its own session, so the remote
/// side of a call never gets mixed with (or echoed into) the local microphone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Mic,
    System,
}

/// Speaker ids heard on the system channel start here, so both channels can share one id space.
pub const SYSTEM_SPEAKER_BASE: usize = 100;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Event {
    Partial {
        channel: Channel,
        text: String,
    },
    Final {
        id: u32,
        channel: Channel,
        start: f32,
        end: f32,
        speaker: usize,
        text: String,
    },
}

pub struct LiveSession<'m> {
    models: &'m Models,
    channel: Channel,
    vad: VoiceActivityDetector,
    speakers: SpeakerClusters,
    leftover: Vec<f32>,
    preroll: VecDeque<f32>,
    speech: Vec<f32>,
    in_speech: bool,
    samples_seen: usize,
    last_partial: usize,
    partial_shown: bool,
    /// Provisional text while someone speaks; off while the recording is behind (a busy Mac).
    partials: bool,
    next_id: u32,
}

impl<'m> LiveSession<'m> {
    /// Caps how many speakers this channel can tell apart (1: everything is the same person).
    pub fn set_max_speakers(&mut self, max: usize) {
        self.speakers.max_speakers = max.max(1);
    }

    /// Turns the provisional text on or off (it costs about ten times the final text).
    pub fn set_partials(&mut self, on: bool) {
        self.partials = on;
    }

    pub fn new(
        models: &'m Models,
        channel: Channel,
        max_speakers: usize,
        threshold: f32,
    ) -> Result<Self> {
        let config = VadModelConfig {
            silero_vad: SileroVadModelConfig {
                model: Some(models.vad_model.clone()),
                threshold: 0.5,
                min_silence_duration: 0.5,
                min_speech_duration: 0.25,
                window_size: VAD_WINDOW as i32,
                max_speech_duration: MAX_SPEECH_S,
            },
            sample_rate: SAMPLE_RATE as i32,
            num_threads: 1,
            ..Default::default()
        };
        let vad = VoiceActivityDetector::create(&config, 60.0)
            .ok_or_else(|| anyhow!("No s'ha pogut carregar el detector de veu"))?;
        Ok(Self {
            models,
            channel,
            vad,
            speakers: SpeakerClusters {
                max_speakers,
                threshold,
                sums: vec![],
                last: 0,
            },
            leftover: vec![],
            preroll: VecDeque::new(),
            speech: vec![],
            in_speech: false,
            samples_seen: 0,
            last_partial: 0,
            partial_shown: false,
            partials: true,
            next_id: 0,
        })
    }

    pub fn accept(&mut self, samples: &[f32]) -> Vec<Event> {
        let mut events = vec![];
        self.leftover.extend_from_slice(samples);
        let n = self.leftover.len() / VAD_WINDOW * VAD_WINDOW;
        let buf: Vec<f32> = self.leftover.drain(..n).collect();
        for window in buf.chunks(VAD_WINDOW) {
            self.vad.accept_waveform(window);
            self.track_speech(window);
            self.drain(&mut events);
        }
        self.samples_seen += samples.len();
        if let Some(e) = self.partial() {
            events.push(e);
        }
        events
    }

    pub fn finish(&mut self) -> Vec<Event> {
        let mut events = vec![];
        self.vad.flush();
        self.drain(&mut events);
        events
    }

    /// Keep our own copy of the in-progress utterance: the Rust VAD API has no current_segment.
    fn track_speech(&mut self, window: &[f32]) {
        let detected = self.vad.detected();
        if detected && !self.in_speech {
            self.speech = self.preroll.iter().copied().collect();
        }
        if detected {
            self.speech.extend_from_slice(window);
            let max = (MAX_SPEECH_S * SAMPLE_RATE as f32) as usize;
            if self.speech.len() > max {
                self.speech.drain(..self.speech.len() - max);
            }
        }
        self.in_speech = detected;
        self.preroll.extend(window.iter().copied());
        let keep = (PREROLL_S * SAMPLE_RATE as f32) as usize;
        while self.preroll.len() > keep {
            self.preroll.pop_front();
        }
    }

    fn drain(&mut self, events: &mut Vec<Event>) {
        while let Some(seg) = self.vad.front() {
            let samples = seg.samples().to_vec();
            let start = seg.start() as f32 / SAMPLE_RATE as f32;
            self.vad.pop();
            self.speech.clear();
            self.partial_shown = false;
            let duration = samples.len() as f32 / SAMPLE_RATE as f32;
            let text = self.models.transcribe(&samples);
            if text.is_empty() {
                continue;
            }
            let speaker = self.speakers.assign(self.models.embed(&samples), duration);
            let base = if self.channel == Channel::System {
                SYSTEM_SPEAKER_BASE
            } else {
                0
            };
            events.push(Event::Final {
                id: self.next_id,
                channel: self.channel,
                start: (start * 100.0).round() / 100.0,
                end: ((start + duration) * 100.0).round() / 100.0,
                speaker: base + speaker,
                text,
            });
            self.next_id += 1;
        }
    }

    fn partial(&mut self) -> Option<Event> {
        // Experiments that only look at final utterances can skip this cost.
        if !self.partials || std::env::var_os("TRANSCRIPTOR_NO_PARTIALS").is_some() {
            return None;
        }
        if !self.in_speech {
            if self.partial_shown {
                self.partial_shown = false;
                return Some(Event::Partial {
                    channel: self.channel,
                    text: String::new(),
                });
            }
            return None;
        }
        // Throttle on audio time, not wall time, so it behaves the same live and in simulations.
        if self.samples_seen - self.last_partial < (PARTIAL_EVERY_S * SAMPLE_RATE as f32) as usize {
            return None;
        }
        self.last_partial = self.samples_seen;
        if self.speech.len() < SAMPLE_RATE / 2 {
            return None;
        }
        self.partial_shown = true;
        let max = (PARTIAL_MAX_S * SAMPLE_RATE as f32) as usize;
        let tail = &self.speech[self.speech.len().saturating_sub(max)..];
        Some(Event::Partial {
            channel: self.channel,
            text: self.models.transcribe(tail),
        })
    }
}
