//! Local LLM (Gemma 4 E4B via llama.cpp, Metal on Apple). A `Session` reads a document (the
//! transcript) once and then answers several questions about it, reusing that prefix in the
//! KV cache: on a meeting the costly part is reading it, not answering.

use std::num::NonZeroU32;
use std::path::Path;
use std::sync::OnceLock;
use std::time::Instant;

use anyhow::{Context, Result, anyhow};
use llama_cpp_2::context::LlamaContext;
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::LlamaModel;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::LlamaToken;
use llama_cpp_2::token::data::LlamaTokenData;
use llama_cpp_2::token::data_array::LlamaTokenDataArray;
use serde::Serialize;

/// Prompt-processing batch: tokens decoded per call while reading the document.
const BATCH: usize = 1024;
/// Room left after the document for each question and its answer.
const ANSWER_ROOM: u32 = 4096;

fn backend() -> Result<&'static LlamaBackend> {
    static BACKEND: OnceLock<LlamaBackend> = OnceLock::new();
    if let Some(b) = BACKEND.get() {
        return Ok(b);
    }
    let mut b = LlamaBackend::init().map_err(|e| anyhow!("llama.cpp: {e}"))?;
    b.void_logs();
    Ok(BACKEND.get_or_init(|| b))
}

pub struct Llm {
    model: LlamaModel,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    pub text: String,
    pub prompt_tokens: usize,
    pub generated_tokens: usize,
    pub seconds: f32,
}

impl Llm {
    pub fn load(path: &Path) -> Result<Self> {
        if !path.exists() {
            return Err(anyhow!("Falta el model {}", path.display()));
        }
        let params = LlamaModelParams::default().with_n_gpu_layers(999);
        let model = LlamaModel::load_from_file(backend()?, path, &params)
            .context("No s'ha pogut carregar el model de llenguatge")?;
        Ok(Self { model })
    }

    /// Reads `system` + `document` into a fresh context. Questions are then asked in the same
    /// user turn, right after the document (Gemma 4 format, thinking off).
    pub fn session(&self, system: &str, document: &str) -> Result<Session<'_>> {
        let prefix = format!("<bos><|turn>system\n{system}<turn|>\n<|turn>user\n{document}\n\n---\n");
        let tokens = self.model.vocab().tokenize(prefix.as_bytes(), false, true);
        let n_ctx = (tokens.len() as u32 + ANSWER_ROOM).next_multiple_of(256);
        let params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(n_ctx))
            .with_n_batch(BATCH as u32)
            .with_n_ubatch(BATCH as u32);
        let ctx = self
            .model
            .new_context(backend()?, params)
            .context("No s'ha pogut crear el context del model")?;
        let mut session = Session { model: &self.model, ctx, prefix_len: 0, read_seconds: 0.0 };
        let t0 = Instant::now();
        session.feed(&tokens, 0, false)?;
        session.prefix_len = tokens.len() as i32;
        session.read_seconds = t0.elapsed().as_secs_f32();
        Ok(session)
    }
}

pub struct Session<'m> {
    model: &'m LlamaModel,
    ctx: LlamaContext<'m>,
    prefix_len: i32,
    pub read_seconds: f32,
}

impl Session<'_> {
    pub fn prefix_tokens(&self) -> usize {
        self.prefix_len as usize
    }

    /// Decodes `tokens` starting at position `pos`; logits only for the last one if `want_last`.
    fn feed(&mut self, tokens: &[LlamaToken], pos: i32, want_last: bool) -> Result<()> {
        let mut batch = LlamaBatch::new(BATCH, 1);
        for (chunk_index, chunk) in tokens.chunks(BATCH).enumerate() {
            batch.clear();
            let last_chunk = (chunk_index + 1) * BATCH >= tokens.len();
            for (i, t) in chunk.iter().enumerate() {
                let p = pos + (chunk_index * BATCH + i) as i32;
                let logits = want_last && last_chunk && i == chunk.len() - 1;
                batch.add(*t, p, &[0], logits)?;
            }
            self.ctx.decode(&mut batch).map_err(|e| anyhow!("llama.cpp decode: {e}"))?;
        }
        Ok(())
    }

    /// Asks one question about the document. With `json_schema`, the answer is constrained to
    /// valid JSON matching it. The question and answer are dropped afterwards, so every question
    /// sees only the document.
    pub fn ask(&mut self, question: &str, max_tokens: usize, json_schema: Option<&str>) -> Result<Answer> {
        let t0 = Instant::now();
        let turn = format!("{question}<turn|>\n<|turn>model\n");
        let tokens = self.model.vocab().tokenize(turn.as_bytes(), false, true);
        let mut pos = self.prefix_len;
        let result = (|| -> Result<Answer> {
            self.feed(&tokens, pos, true)?;
            pos += tokens.len() as i32;

            // JSON answers are greedy and grammar-constrained; free text is sampled.
            let mut grammar = match json_schema {
                Some(schema) => {
                    let grammar = llama_cpp_2::json_schema_to_grammar(schema)
                        .map_err(|e| anyhow!("Esquema JSON no vàlid: {e}"))?;
                    Some(
                        LlamaSampler::grammar(self.model, &grammar, "root")
                            .map_err(|e| anyhow!("Gramàtica no vàlida: {e}"))?,
                    )
                }
                None => None,
            };
            let mut sampler = LlamaSampler::chain_simple([
                LlamaSampler::penalties(self.model.n_vocab(), 64, 1.1, 0.0, 0.0),
                LlamaSampler::top_p(0.9, 1),
                LlamaSampler::temp(0.3),
                LlamaSampler::dist(42),
            ]);

            let vocab = self.model.vocab();
            let mut out: Vec<u8> = Vec::new();
            let mut generated = 0;
            let mut batch = LlamaBatch::new(1, 1);
            let mut last_logits = (tokens.len() - 1) as i32 % BATCH as i32;
            while generated < max_tokens {
                let token = match grammar.as_mut() {
                    Some(grammar) => {
                        let token = constrained_greedy(&self.ctx, last_logits, grammar);
                        grammar.accept(token);
                        token
                    }
                    None => {
                        let token = sampler.sample(&self.ctx, last_logits);
                        sampler.accept(token);
                        token
                    }
                };
                if vocab.is_eog(token) {
                    break;
                }
                out.extend(vocab.token_to_piece(token, false, None));
                generated += 1;
                batch.clear();
                batch.add(token, pos, &[0], true)?;
                self.ctx.decode(&mut batch).map_err(|e| anyhow!("llama.cpp decode: {e}"))?;
                pos += 1;
                last_logits = 0;
            }
            Ok(Answer {
                text: String::from_utf8_lossy(&out).trim().to_string(),
                prompt_tokens: tokens.len(),
                generated_tokens: generated,
                seconds: t0.elapsed().as_secs_f32(),
            })
        })();
        // Forget this question and its answer; keep the document.
        let _ = self.ctx.clear_kv_cache_seq(Some(0), Some(self.prefix_len as u32), None);
        result
    }
}

/// Greedy token allowed by `grammar`. Checking the grammar against Gemma's 262K-token
/// vocabulary is slow, so the unconstrained best token is tried first (it is valid almost
/// always, since the model already writes JSON) and the full check only runs when it isn't.
fn constrained_greedy(ctx: &LlamaContext<'_>, idx: i32, grammar: &mut LlamaSampler) -> LlamaToken {
    let logits = ctx.get_logits_ith(idx);
    let (best, logit) = logits
        .iter()
        .enumerate()
        .fold((0, f32::NEG_INFINITY), |acc, (i, &l)| if l > acc.1 { (i, l) } else { acc });
    let mut single = LlamaTokenDataArray::new(vec![LlamaTokenData::new(LlamaToken(best as i32), logit, 0.0)], false);
    grammar.apply(&mut single);
    if single.data[0].logit().is_finite() {
        return LlamaToken(best as i32);
    }
    let mut all = ctx.token_data_array_ith(idx);
    grammar.apply(&mut all);
    all.sample_token_greedy()
}
