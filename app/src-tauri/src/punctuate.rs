//! Punctuation for the transcript: Softcatalà's Catalan "fullstop" RoBERTa (token
//! classification), exported to ONNX int8 by `tools/export_punctuation.py`. It runs on the
//! onnxruntime that sherpa-onnx already links. About 8 s for a 20-minute meeting on an M4.

use std::path::Path;
use std::sync::OnceLock;

use anyhow::{Context, Result, anyhow};
use ort::environment::Environment;
use ort::session::Session;
use ort::value::Tensor;
use tokenizers::{InputSequence, Tokenizer};

/// Words per model call, and how many are shared with the next call so that every word is
/// predicted with context on both sides.
const WINDOW: usize = 150;
const OVERLAP: usize = 30;
/// Within the overlap, predictions this close to a window's right edge are replaced by the
/// next window's.
const EDGE: usize = 15;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mark {
    None,
    Comma,
    Period,
    Question,
}

impl Mark {
    fn from_label(label: usize) -> Self {
        // Labels: 0 none, 1 ".", 2 ",", 3 "?", 4 "-", 5 ":". Dashes and colons are often
        // optional and the model is unsure of them (F1 0.64 for ":"): written as commas.
        match label {
            1 => Mark::Period,
            2 | 4 | 5 => Mark::Comma,
            3 => Mark::Question,
            _ => Mark::None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Mark::None => "",
            Mark::Comma => ",",
            Mark::Period => ".",
            Mark::Question => "?",
        }
    }

    fn ends_sentence(self) -> bool {
        matches!(self, Mark::Period | Mark::Question)
    }
}

fn environment() -> Result<&'static Environment> {
    static ENV: OnceLock<Environment> = OnceLock::new();
    if let Some(env) = ENV.get() {
        return Ok(env);
    }
    let env = ort::init().with_name("transcriptor").build().map_err(|e| anyhow!("onnxruntime: {e}"))?;
    Ok(ENV.get_or_init(|| env))
}

pub struct Punctuator {
    session: Session,
    tokenizer: Tokenizer,
}

impl Punctuator {
    pub fn load(dir: &Path) -> Result<Self> {
        let model = dir.join("model.int8.onnx");
        if !model.exists() {
            return Err(anyhow!("Falta el model de puntuació {}", model.display()));
        }
        let session = Session::builder(environment()?)
            .map_err(|e| anyhow!("{e}"))?
            .with_intra_threads(4)
            .map_err(|e| anyhow!("{e}"))?
            .commit_from_file(&model)
            .map_err(|e| anyhow!("No s'ha pogut carregar el model de puntuació: {e}"))?;
        let tokenizer = Tokenizer::from_file(dir.join("tokenizer.json"))
            .map_err(|e| anyhow!("No s'ha pogut carregar el tokenitzador: {e}"))?;
        Ok(Self { session, tokenizer })
    }

    /// One mark per word (the punctuation that follows it).
    pub fn marks(&mut self, words: &[&str]) -> Result<Vec<Mark>> {
        let mut marks: Vec<Option<Mark>> = vec![None; words.len()];
        let mut start = 0;
        while start < words.len() {
            let chunk = &words[start..(start + WINDOW).min(words.len())];
            let encoding = self
                .tokenizer
                .encode(InputSequence::PreTokenized(chunk.into()), true)
                .map_err(|e| anyhow!("tokenitzador: {e}"))?;
            let ids: Vec<i64> = encoding.get_ids().iter().map(|&i| i as i64).collect();
            let n = ids.len();
            let input_ids = Tensor::from_array(([1, n], ids))?;
            let attention_mask = Tensor::from_array(([1, n], vec![1i64; n]))?;
            let outputs = self
                .session
                .run(ort::inputs!["input_ids" => input_ids, "attention_mask" => attention_mask])
                .context("model de puntuació")?;
            let (shape, logits) = outputs["logits"].try_extract_tensor::<f32>()?;
            let n_labels = shape[2] as usize;
            let mut seen = None;
            for (t, word) in encoding.get_word_ids().iter().enumerate() {
                let Some(w) = word.map(|w| w as usize) else { continue };
                if seen == Some(w) {
                    continue; // only the word's first sub-token
                }
                seen = Some(w);
                let row = &logits[t * n_labels..(t + 1) * n_labels];
                let best = (0..n_labels).max_by(|&a, &b| row[a].total_cmp(&row[b])).unwrap_or(0);
                let slot = &mut marks[start + w];
                if slot.is_none() || w < chunk.len().saturating_sub(EDGE) {
                    *slot = Some(Mark::from_label(best));
                }
            }
            if start + WINDOW >= words.len() {
                break;
            }
            start += WINDOW - OVERLAP;
        }
        Ok(marks.into_iter().map(|m| m.unwrap_or(Mark::None)).collect())
    }

    /// Punctuates consecutive segments of a transcript as one text, so each phrase gets the
    /// context around it. `speakers[i]` is who said `texts[i]`; a change of speaker always
    /// ends the sentence. Returns the new text of each segment.
    pub fn punctuate(&mut self, texts: &[String], speakers: &[i32]) -> Result<Vec<String>> {
        let words: Vec<&str> = texts.iter().flat_map(|t| t.split_whitespace()).collect();
        let marks = self.marks(&words)?;
        let mut out = Vec::with_capacity(texts.len());
        let mut i = 0;
        let mut capitalize = true;
        for (s, text) in texts.iter().enumerate() {
            let n = text.split_whitespace().count();
            let last_of_turn = speakers.get(s + 1).is_none_or(|next| *next != speakers[s]);
            let mut parts = Vec::with_capacity(n);
            for k in 0..n {
                let mut mark = marks[i];
                if k + 1 == n && last_of_turn && !mark.ends_sentence() {
                    mark = Mark::Period;
                }
                let word = if capitalize { capitalize_first(words[i]) } else { words[i].to_string() };
                parts.push(format!("{word}{}", mark.as_str()));
                capitalize = mark.ends_sentence();
                i += 1;
            }
            out.push(parts.join(" "));
        }
        Ok(out)
    }
}

fn capitalize_first(word: &str) -> String {
    let mut chars = word.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}
