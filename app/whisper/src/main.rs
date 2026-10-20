//! Murmur's final pass for meetings in one language: Whisper large-v3-turbo (whisper.cpp, Metal)
//! listens again to each channel, and every live utterance takes the words Whisper heard during
//! it. Speakers, times and lines stay as they were; only the text improves.
//!
//!     murmur-whisper <model.bin> <ca|es|en>  < job.json
//!
//! Job (stdin): `{"channels": [{"pcm": "<16 kHz mono s16le file>", "spans": [{"start": s, "end": s}]}]}`.
//! Output (stdout), one JSON object per line: `{"progress": 0.4}` as it goes, then
//! `{"channel": i, "texts": [{"start": s, "text": "…"}]}` per channel. Utterances Whisper heard
//! nothing in, or where it went wrong, are left out (they keep their live text).
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

fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let [_, model, language] = args.as_slice() else {
        return Err(anyhow!("ús: murmur-whisper <model.bin> <ca|es|en> < job.json"));
    };
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let job: Job = serde_json::from_str(&input).context("feina no vàlida")?;

    let mut params = WhisperContextParameters::default();
    // DTW timestamps put the words in the right utterance; flash attention (20% faster) can't
    // give them and spills words into the next one.
    params.use_gpu(true).flash_attn(false).dtw_parameters(DtwParameters {
        mode: DtwMode::ModelPreset { model_preset: DtwModelPreset::LargeV3Turbo },
        ..Default::default()
    });
    let ctx = WhisperContext::new_with_params(model, params).context("no s'ha pogut carregar Whisper")?;
    let mut state = ctx.create_state()?;
    let eot = ctx.token_eot();

    let audio: Vec<Vec<f32>> = job.channels.iter().map(|c| read_pcm(&c.pcm)).collect::<Result<_>>()?;
    let all: Vec<Vec<Vec<Placed>>> = job.channels.iter().map(|c| chunk(&c.spans)).collect();
    let total: usize = all.iter().map(|c| c.len()).sum::<usize>().max(1);
    let mut done = 0;
    let mut out = std::io::stdout().lock();
    for (i, (channel, chunks)) in job.channels.iter().zip(&all).enumerate() {
        let samples = &audio[i];
        let mut words: Vec<Vec<String>> = vec![vec![]; channel.spans.len()];
        for placed in chunks {
            let mut buf: Vec<f32> = vec![];
            for p in placed {
                let span = channel.spans[p.span];
                let from = ((span.start * RATE) as usize).min(samples.len());
                let to = ((span.end * RATE) as usize).clamp(from, samples.len());
                buf.resize((p.offset * RATE) as usize, 0.0);
                buf.extend_from_slice(&samples[from..to]);
            }
            let speech: f32 = placed.iter().map(|p| p.len).sum();
            let heard = decode(&mut state, eot, &buf, speech, language)?;
            if std::env::var_os("MURMUR_WHISPER_DEBUG").is_some() {
                let at: Vec<String> = placed.iter().map(|p| format!("{:.1}–{:.1}", p.offset, p.offset + p.len)).collect();
                eprintln!("CHUNK {}", at.join(" "));
                for (t, w) in heard.iter().flatten() {
                    eprint!("{w}@{t:.2} ");
                }
                eprintln!();
            }
            if let Some(heard) = heard {
                for (t, word) in heard {
                    // The utterance playing at that moment (a word in a gap goes to the one before).
                    let at = placed.iter().rposition(|p| p.offset <= t + 0.1).unwrap_or(0);
                    words[placed[at].span].push(word);
                }
            }
            done += 1;
            writeln!(out, "{}", serde_json::json!({ "progress": done as f32 / total as f32 }))?;
            out.flush()?;
        }
        let texts: Vec<Text> = channel
            .spans
            .iter()
            .zip(words)
            .filter_map(|(span, words)| {
                let text = words.join(" ");
                let lower = text.to_lowercase();
                (!text.is_empty() && !HALLUCINATIONS.iter().any(|h| lower.contains(h)))
                    .then(|| Text { start: (span.start * 100.0).round() / 100.0, text })
            })
            .collect();
        writeln!(out, "{}", serde_json::json!({ "channel": i, "texts": texts }))?;
        out.flush()?;
    }
    Ok(())
}

fn read_pcm(path: &str) -> Result<Vec<f32>> {
    let bytes = std::fs::read(path).with_context(|| format!("no s'ha pogut llegir {path}"))?;
    Ok(bytes.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect())
}

/// Whisper's words with the time (s into `audio`) each one starts at; None if it looks wrong.
/// `eot`: the end-of-text token; every special token comes after it.
fn decode(state: &mut WhisperState, eot: i32, audio: &[f32], speech_s: f32, language: &str) -> Result<Option<Vec<(f32, String)>>> {
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

    // Words: a token starting with a space starts one. Bytes, not text: a token can hold half a
    // character.
    let mut words: Vec<(f32, Vec<u8>)> = vec![];
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
            match words.last_mut() {
                Some(last) if !bytes.starts_with(b" ") => last.1.extend_from_slice(bytes),
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
