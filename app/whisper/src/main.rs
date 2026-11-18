//! Murmur's final pass for meetings in one language: Whisper large-v3-turbo (whisper.cpp, Metal)
//! listens again to each channel, and every live utterance takes the words Whisper heard during
//! it. Speakers, times and lines stay as they were; only the text improves.
//!
//!     murmur-whisper <model.bin> <ca|es|en>  < job.json
//!
//! Job (stdin): `{"channels": [{"pcm": "<16 kHz mono s16le file>", "spans": [{"start": s, "end": s}]}]}`.
//! Output (stdout), one JSON object per chunk (below) as each is done:
//! `{"progress": 0.4, "channel": i, "texts": [{"start": s, "text": "…"}]}`, the texts of that
//! chunk's utterances. Utterances Whisper heard nothing in, or where it went wrong, are left out
//! (they keep their live text). `"skip": n` in the job leaves out the first n chunks, done by an
//! earlier run that crashed: the chunks only depend on the spans, so they're the same ones.
//!
//!     murmur-whisper <model.bin> detect  < job.json
//!
//! Language detection for a file opened without one. Job: `{"pcm": "<file>", "windows":
//! [[{"start": s, "end": s}, …], …]}`, each window a few utterances spliced as below (up to 30 s).
//! Output, one line per window: `{"window": i, "top": "pt", "ca": p, "es": p, "en": p}`, Whisper's
//! probabilities.
//!
//! The utterances' audio is spliced into chunks of up to 28 s (Whisper reads 30 s at a time) with
//! a short silence between them, so pauses cost nothing and can't make Whisper invent text.
//! Token timestamps (DTW) say which utterance each word belongs to.

use std::io::{Read, Write};

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use whisper_rs::{
    DtwMode, DtwModelPreset, DtwParameters, FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters,
    WhisperState,
};

const RATE: f32 = 16_000.0;
const CHUNK_S: f32 = 28.0;
/// Silence put between two utterances in a chunk.
const GAP_S: f32 = 0.5;
/// More words than this per second of speech (plus a margin) means Whisper is making things up.
const MAX_WORDS_PER_S: f32 = 6.0;
/// The same phrase of 2–6 words this many times in a row is a Whisper loop. One word needs
/// twice as many: people do say "clic, clic, clic, clic".
const MAX_REPEATS: usize = 4;
/// Phrases Whisper is known to invent from the subtitled videos it was trained on.
const HALLUCINATIONS: &[&str] = &[
    "subtítols realitzats per",
    "subtítulos realizados por",
    "subtítulos por la comunidad",
    "gràcies per veure",
    "gracias por ver",
    "thanks for watching",
    "thank you for watching",
    "amara.org",
];

#[derive(Deserialize)]
struct Job {
    channels: Vec<ChannelJob>,
    #[serde(default)]
    skip: usize,
}

#[derive(Deserialize)]
struct ChannelJob {
    pcm: String,
    spans: Vec<Span>,
}

#[derive(Deserialize, Clone, Copy)]
struct Span {
    start: f32,
    end: f32,
}

#[derive(Deserialize)]
struct DetectJob {
    pcm: String,
    windows: Vec<Vec<Span>>,
}

#[derive(Serialize)]
struct Text {
    start: f32,
    text: String,
}

/// One utterance inside a chunk: where it starts in the chunk, its length, and which span it is.
struct Placed {
    offset: f32,
    len: f32,
    span: usize,
}

fn main() {
    if let Err(e) = run() {
        eprintln!("murmur-whisper: {e:#}");
        std::process::exit(1);
    }
}

/// The DTW alignment heads depend on the model: large-v3-turbo has 4 text layers, large-v3 and
/// the models fine-tuned from it (BSC's Valencian and Balearic) have 32. Read from the ggml header:
/// magic, then n_vocab, n_audio_ctx, n_audio_state, n_audio_head, n_audio_layer, n_text_ctx,
/// n_text_state, n_text_head, n_text_layer (i32 each).
fn dtw_preset(model: &str) -> Result<DtwModelPreset> {
    let mut header = [0u8; 40];
    std::fs::File::open(model)
        .and_then(|mut f| f.read_exact(&mut header))
        .context("no s'ha pogut llegir el model")?;
    let text_layers = i32::from_le_bytes(header[36..40].try_into()?);
    Ok(if text_layers >= 32 { DtwModelPreset::LargeV3 } else { DtwModelPreset::LargeV3Turbo })
}

/// What a GPU needs free besides the model file: the KV caches and compute buffers (about 1.2 GB
/// for large-v3, most of it the decoder's 600 MB), and a margin.
#[cfg(not(target_os = "macos"))]
const GPU_HEADROOM: usize = 1300 << 20;

/// The GPU whisper.cpp should take (its `gpu_device`: GPUs counted as it counts them), or None for
/// the CPU. On Windows and Linux (Vulkan), only a dedicated GPU with room for the model: an
/// integrated one shares the RAM and is slower than the CPU (a UHD 620 did half the job in the time
/// the CPU does all of it), and a GPU without room makes whisper.cpp crash instead of failing
/// (an MX150 with 2 GB, issue #9). Every GPU found goes to the log with its verdict.
#[cfg(not(target_os = "macos"))]
fn pick_gpu(model: &str) -> Option<i32> {
    use std::ffi::CStr;
    use whisper_rs_sys::{
        ggml_backend_dev_count, ggml_backend_dev_description, ggml_backend_dev_get, ggml_backend_dev_memory,
        ggml_backend_dev_type, ggml_backend_dev_type_GGML_BACKEND_DEVICE_TYPE_GPU as GPU,
        ggml_backend_dev_type_GGML_BACKEND_DEVICE_TYPE_IGPU as IGPU,
    };
    let need = std::fs::metadata(model).map_or(0, |m| m.len() as usize) + GPU_HEADROOM;
    let mut chosen = None;
    let mut index = 0;
    // SAFETY: ggml's device registry lives for the whole process; the pointers it hands out stay valid.
    unsafe {
        for i in 0..ggml_backend_dev_count() {
            let dev = ggml_backend_dev_get(i);
            let kind = ggml_backend_dev_type(dev);
            if kind != GPU && kind != IGPU {
                continue;
            }
            let name = CStr::from_ptr(ggml_backend_dev_description(dev)).to_string_lossy();
            let (mut free, mut total) = (0usize, 0usize);
            ggml_backend_dev_memory(dev, &mut free, &mut total);
            let verdict = if kind == IGPU {
                "integrada, no s'hi fa"
            } else if free < need {
                "no hi cap"
            } else if chosen.is_none() {
                chosen = Some(index);
                "s'hi fa"
            } else {
                "ja n'hi ha una altra"
            };
            eprintln!("Whisper: GPU {index}, {name}, {} MB lliures de {} (cal {}): {verdict}", free >> 20, total >> 20, need >> 20);
            index += 1;
        }
    }
    chosen
}

/// On the Mac, Metal: one GPU, sharing the RAM, and much faster than the CPU.
#[cfg(target_os = "macos")]
fn pick_gpu(_model: &str) -> Option<i32> {
    Some(0)
}

/// Whisper on the GPU `pick_gpu` chooses, and on the CPU if there's none or loading fails there (a
/// driver that won't take it). `MURMUR_NO_GPU` skips the GPU. Without a GPU build (no Vulkan),
/// there's no GPU to pick.
fn load(model: &str, configure: impl Fn(&mut WhisperContextParameters)) -> Result<WhisperContext> {
    let with = |gpu: Option<i32>| {
        let mut params = WhisperContextParameters::default();
        params.use_gpu(gpu.is_some());
        if let Some(device) = gpu {
            params.gpu_device(device);
        }
        configure(&mut params);
        WhisperContext::new_with_params(model, params)
    };
    if std::env::var_os("MURMUR_NO_GPU").is_none() {
        if let Some(device) = pick_gpu(model) {
            match with(Some(device)) {
                Ok(ctx) => {
                    eprintln!("Whisper: model carregat amb la GPU activada");
                    return Ok(ctx);
                }
                Err(e) => eprintln!("Whisper a la GPU: {e}; es fa amb el processador"),
            }
        }
    }
    let ctx = with(None).context("no s'ha pogut carregar Whisper")?;
    eprintln!("Whisper: model carregat amb el processador (sense GPU)");
    Ok(ctx)
}

fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let [_, model, language] = args.as_slice() else {
        return Err(anyhow!("ús: murmur-whisper <model.bin> <ca|es|en> < job.json"));
    };
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    if language == "detect" {
        let job: DetectJob = serde_json::from_str(&input).context("feina no vàlida")?;
        return detect(model, &job);
    }
    let job: Job = serde_json::from_str(&input).context("feina no vàlida")?;

    // DTW timestamps put the words in the right utterance; flash attention (20% faster) can't
    // give them and spills words into the next one.
    let preset = dtw_preset(model)?;
    let ctx = load(model, |params| {
        params.flash_attn(false).dtw_parameters(DtwParameters {
            mode: DtwMode::ModelPreset { model_preset: preset.clone() },
            ..Default::default()
        });
    })?;
    let mut state = ctx.create_state()?;
    let eot = ctx.token_eot();

    let audio: Vec<Vec<f32>> = job.channels.iter().map(|c| read_pcm(&c.pcm)).collect::<Result<_>>()?;
    let all: Vec<Vec<Vec<Placed>>> = job.channels.iter().map(|c| chunk(&c.spans)).collect();
    let total: usize = all.iter().map(|c| c.len()).sum::<usize>().max(1);
    let mut done = 0;
    let mut out = std::io::stdout().lock();
    for (i, (channel, chunks)) in job.channels.iter().zip(&all).enumerate() {
        let samples = &audio[i];
        for placed in chunks {
            done += 1;
            if done <= job.skip {
                continue;
            }
            let mut buf: Vec<f32> = vec![];
            for p in placed {
                let span = channel.spans[p.span];
                let from = ((span.start * RATE) as usize).min(samples.len());
                let to = ((span.end * RATE) as usize).clamp(from, samples.len());
                buf.resize((p.offset * RATE) as usize, 0.0);
                buf.extend_from_slice(&samples[from..to]);
            }
            let speech: f32 = placed.iter().map(|p| p.len).sum();
            let starts: Vec<f32> = placed.iter().map(|p| p.offset).collect();
            let heard = decode(&mut state, eot, &buf, speech, language, &starts)?;
            if std::env::var_os("MURMUR_WHISPER_DEBUG").is_some() {
                let at: Vec<String> = placed.iter().map(|p| format!("{:.1}–{:.1}", p.offset, p.offset + p.len)).collect();
                eprintln!("CHUNK {}", at.join(" "));
                for (t, w) in heard.iter().flatten() {
                    eprint!("{w}@{t:.2} ");
                }
                eprintln!();
            }
            let mut words: Vec<Vec<String>> = vec![vec![]; placed.len()];
            for (t, word) in heard.into_iter().flatten() {
                // The utterance playing at that moment (a word in a gap goes to the one before).
                let at = placed.iter().rposition(|p| p.offset <= t + 0.1).unwrap_or(0);
                words[at].push(word);
            }
            let texts: Vec<Text> = placed
                .iter()
                .zip(words)
                .filter_map(|(p, words)| {
                    let text = words.join(" ");
                    let lower = text.to_lowercase();
                    let start = channel.spans[p.span].start;
                    (!text.is_empty() && !HALLUCINATIONS.iter().any(|h| lower.contains(h)))
                        .then(|| Text { start: (start * 100.0).round() / 100.0, text })
                })
                .collect();
            let progress = done as f32 / total as f32;
            writeln!(out, "{}", serde_json::json!({ "progress": progress, "channel": i, "texts": texts }))?;
            out.flush()?;
        }
    }
    Ok(())
}

/// Whisper's language probabilities for each window of `job.pcm`.
fn detect(model: &str, job: &DetectJob) -> Result<()> {
    let ctx = load(model, |_| {})?;
    let mut state = ctx.create_state()?;
    let samples = read_pcm(&job.pcm)?;
    let id = |code: &str| whisper_rs::get_lang_id(code).map(|i| i as usize);
    let (ca, es, en) = (id("ca"), id("es"), id("en"));
    let mut out = std::io::stdout().lock();
    for (i, spans) in job.windows.iter().enumerate() {
        let mut buf: Vec<f32> = vec![];
        for span in spans {
            let from = ((span.start * RATE) as usize).min(samples.len());
            let to = ((span.end * RATE) as usize).clamp(from, samples.len());
            if !buf.is_empty() {
                buf.resize(buf.len() + (GAP_S * RATE) as usize, 0.0);
            }
            buf.extend_from_slice(&samples[from..to]);
        }
        buf.truncate(30 * RATE as usize);
        if buf.len() < RATE as usize {
            continue;
        }
        state.pcm_to_mel(&buf, 4)?;
        let (top, probs) = state.lang_detect(0, 4)?;
        let p = |id: Option<usize>| id.and_then(|i| probs.get(i)).copied().unwrap_or(0.0);
        let line = serde_json::json!({
            "window": i,
            "top": whisper_rs::get_lang_str(top).unwrap_or(""),
            "ca": p(ca),
            "es": p(es),
            "en": p(en),
        });
        writeln!(out, "{line}")?;
        out.flush()?;
    }
    Ok(())
}

fn read_pcm(path: &str) -> Result<Vec<f32>> {
    let bytes = std::fs::read(path).with_context(|| format!("no s'ha pogut llegir {path}"))?;
    Ok(bytes.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect())
}

/// Whisper's words with the time (s into `audio`) each one starts at; None if it looks wrong.
/// `eot`: the end-of-text token; every special token comes after it. `starts`: where each
/// utterance begins in `audio`.
fn decode(state: &mut WhisperState, eot: i32, audio: &[f32], speech_s: f32, language: &str, starts: &[f32]) -> Result<Option<Vec<(f32, String)>>> {
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some(language));
    params.set_n_threads(4);
    params.set_token_timestamps(true);
    // Each chunk on its own: a mistake in one doesn't spread to the next.
    params.set_no_context(true);
    params.set_suppress_nst(true);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_special(false);
    params.set_print_timestamps(false);
    // Whisper needs at least a second; pad short chunks with silence.
    let mut padded;
    let audio = if audio.len() < RATE as usize + RATE as usize / 2 {
        padded = audio.to_vec();
        padded.resize(RATE as usize * 3 / 2, 0.0);
        &padded[..]
    } else {
        audio
    };
    state.full(params, audio)?;

    // Words: a token starting with a space starts one, and so does the first token of the next
    // utterance (BSC's models write it without the space: "tardi" + "també" → "tarditambé"). Bytes,
    // not text: a token can hold half a character.
    let mut words: Vec<(f32, Vec<u8>)> = vec![];
    let mut previous = f32::NEG_INFINITY;
    for segment in state.as_iter() {
        for i in 0..segment.n_tokens() {
            let Some(token) = segment.get_token(i) else { continue };
            let data = token.token_data();
            // Special tokens (start, language, timestamps…) come after the text ones.
            if data.id >= eot {
                continue;
            }
            let bytes = token.to_bytes()?;
            let t = if data.t_dtw >= 0 { data.t_dtw } else { data.t0 } as f32 / 100.0;
            let next_utterance = starts.iter().any(|&s| previous < s - 0.1 && t >= s - 0.1);
            previous = t;
            match words.last_mut() {
                Some(last) if !bytes.starts_with(b" ") && !next_utterance => last.1.extend_from_slice(bytes),
                _ => words.push((t, bytes.to_vec())),
            }
        }
    }
    let words: Vec<(f32, String)> = words
        .into_iter()
        .map(|(t, b)| (t, String::from_utf8_lossy(&b).trim().to_string()))
        .filter(|(_, w)| !w.is_empty())
        .collect();
    let text: Vec<&str> = words.iter().map(|(_, w)| w.as_str()).collect();
    if text.is_empty() || text.len() as f32 > MAX_WORDS_PER_S * speech_s + 8.0 || repeats(&text) {
        return Ok(None);
    }
    Ok(Some(words))
}

/// Splices consecutive utterances into chunks Whisper can read at once.
fn chunk(spans: &[Span]) -> Vec<Vec<Placed>> {
    let mut chunks: Vec<Vec<Placed>> = vec![];
    let mut used = CHUNK_S;
    for (i, span) in spans.iter().enumerate() {
        let len = (span.end - span.start).clamp(0.0, CHUNK_S);
        let offset = used + GAP_S;
        if offset + len > CHUNK_S {
            chunks.push(vec![Placed { offset: 0.0, len, span: i }]);
            used = len;
        } else {
            chunks.last_mut().unwrap().push(Placed { offset, len, span: i });
            used = offset + len;
        }
    }
    chunks
}

/// A phrase of 2–6 words said MAX_REPEATS times in a row, or one word twice as many times.
fn repeats(words: &[&str]) -> bool {
    let words: Vec<String> = words.iter().map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()).collect();
    (1..=6).any(|n| {
        let times = if n == 1 { MAX_REPEATS * 2 } else { MAX_REPEATS };
        words.windows(n * times).any(|w| {
            let first = &w[..n];
            w.chunks(n).all(|c| c == first)
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_fill_up_to_the_limit() {
        let spans: Vec<Span> = (0..10).map(|i| Span { start: i as f32 * 10.0, end: i as f32 * 10.0 + 8.0 }).collect();
        let chunks = chunk(&spans);
        // 8 + 0.5 + 8 + 0.5 + 8 = 25 fits; a fourth one doesn't.
        assert_eq!(chunks.iter().map(|c| c.len()).collect::<Vec<_>>(), vec![3, 3, 3, 1]);
        assert!((chunks[0][1].offset - 8.5).abs() < 1e-4);
    }

    #[test]
    fn spots_loops() {
        fn words(s: &str) -> Vec<&str> {
            s.split(' ').collect()
        }
        assert!(repeats(&words("a b, a b, a b, a b")));
        assert!(repeats(&words("sí sí sí sí sí sí sí sí")));
        assert!(!repeats(&words("clic, clic, clic, clic, clic")));
        assert!(!repeats(&words("sí sí sí no")));
    }
}
