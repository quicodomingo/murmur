//! Whisper for meetings in Catalan and Spanish, sentence by sentence, as the final pass does it
//! (retranscribe::languages and transcribe_split): each live utterance gets its language from
//! Whisper, the Catalan ones go to the BSC's model and the Spanish ones to the turbo. Compared with
//! the live text and with Whisper told one language for everything.
//!
//!     cargo run --release --example mixed_probe -- ../../data/mixta.mp3 [--seconds 600]
//!         [--draft ../../data/mixta.ref.txt] [--ref ../../data/mixta.ref.txt]
//!
//! `--draft` writes a reference to correct by hand: one line per utterance, "[start] text", with
//! the sentence-by-sentence text. Once corrected, `--ref` gives the WER of each way (the whole text,
//! lowercase, without punctuation). Timings are on this computer: run it where it would run (GPU).

use std::path::Path;
use std::time::Instant;

use sherpa_onnx::{SileroVadModelConfig, VadModelConfig, VoiceActivityDetector};
use transcriptor_lib::diarize::Span;
use transcriptor_lib::engine::{LiveModel, Models, models_dir};
use transcriptor_lib::{import, retranscribe};

const RATE: f32 = 16_000.0;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = args.get(1).expect("àudio");
    let flag = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let limit: Option<f32> = flag("--seconds").and_then(|s| s.parse().ok());
    let dir = models_dir();
    let tmp = std::env::temp_dir().join("murmur-mixed-probe");

    let mut samples = import::decode(Path::new(path), &tmp).expect("decode");
    if let Some(limit) = limit {
        samples.truncate((limit * RATE) as usize);
    }
    let seconds = samples.len() as f32 / RATE;
    let spans = utterances(&dir, &samples);
    eprintln!("{seconds:.0} s, {} frases", spans.len());

    let pcm = tmp.join("audio.pcm");
    let bytes: Vec<u8> = samples.iter().flat_map(|s| ((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()).collect();
    std::fs::write(&pcm, bytes).unwrap();

    // The language of each utterance, and each language with its model: as the final pass does.
    let t = Instant::now();
    let catalan = retranscribe::languages(&dir, &pcm, &spans).expect("detect");
    let detect_s = t.elapsed().as_secs_f32();
    let t = Instant::now();
    let mixed_texts = retranscribe::transcribe_split(&dir, &[(pcm.as_path(), spans.as_slice())], &[catalan.clone()], &[], |_| {}).expect("whisper").remove(0);
    let mixed_s = t.elapsed().as_secs_f32();

    // One language for everything, as the final pass does today with one-language meetings.
    let t = Instant::now();
    let all_ca = whisper(&dir, "ca", &pcm, &spans);
    let all_ca_s = t.elapsed().as_secs_f32();
    let t = Instant::now();
    let all_es = whisper(&dir, "es", &pcm, &spans);
    let all_es_s = t.elapsed().as_secs_f32();

    let live_model = Models::load(&dir, LiveModel::CatalanSpanish).expect("live models");
    let text_at = |texts: &[retranscribe::Text], s: &Span, fallback: &str| -> String {
        let start = (s.start * 100.0).round() / 100.0;
        texts.iter().find(|t| t.start == start).map(|t| t.text.clone()).unwrap_or_else(|| fallback.to_string())
    };

    let mut live_all = vec![];
    let mut mixed_all = vec![];
    let mut ca_all = vec![];
    let mut es_all = vec![];
    for (i, s) in spans.iter().enumerate() {
        let audio = &samples[(s.start * RATE) as usize..((s.end * RATE) as usize).min(samples.len())];
        let live = live_model.transcribe(audio);
        let mixed = text_at(&mixed_texts, s, &live);
        println!("[{:>6.1}] {}", s.start, if catalan[i] { "CA" } else { "ES" });
        println!("   directe : {live}");
        println!("   frase   : {mixed}");
        println!("   tot ca  : {}", text_at(&all_ca, s, "·"));
        println!("   tot es  : {}", text_at(&all_es, s, "·"));
        ca_all.push(text_at(&all_ca, s, &live));
        es_all.push(text_at(&all_es, s, &live));
        live_all.push(live);
        mixed_all.push(mixed);
    }

    if let Some(draft) = flag("--draft") {
        let lines: Vec<String> = spans.iter().zip(&mixed_all).map(|(s, t)| format!("[{:.1}] {t}", s.start)).collect();
        std::fs::write(&draft, lines.join("\n") + "\n").unwrap();
        eprintln!("esborrany de la referència: {draft}");
    }

    let ca_share = catalan.iter().filter(|c| **c).count() as f32 / catalan.len().max(1) as f32;
    eprintln!("\n{:.0}% de frases en català segons Whisper", ca_share * 100.0);
    eprintln!("RTF  detectar {:.3} · frase a frase {:.3} (total {:.3}) · tot ca {:.3} · tot es {:.3}",
        detect_s / seconds, mixed_s / seconds, (detect_s + mixed_s) / seconds, all_ca_s / seconds, all_es_s / seconds);
    if let Some(reference) = flag("--ref") {
        let reference = std::fs::read_to_string(reference).expect("ref");
        let reference: Vec<String> = reference.lines().map(|l| l.split_once("] ").map_or(l, |(_, t)| t).to_string()).collect();
        assert_eq!(reference.len(), spans.len(), "one reference line per utterance");
        // Numbers in words, in each utterance's language: "13", "tretze" and "trece" are the same.
        let all = |texts: &[String]| -> Vec<String> { texts.iter().zip(&catalan).flat_map(|(t, ca)| words(t, *ca)).collect() };
        let r = all(&reference);
        eprintln!("referència: {} paraules", r.len());
        for (name, texts) in [("directe", &live_all), ("frase a frase", &mixed_all), ("tot en català", &ca_all), ("tot en castellà", &es_all)] {
            eprintln!("WER {name:<16} {:.1}%", wer(&r, &all(texts)) * 100.0);
        }
    }
}

/// The live engine's utterances (same VAD settings as engine.rs).
fn utterances(dir: &Path, samples: &[f32]) -> Vec<Span> {
    let vad = VoiceActivityDetector::create(
        &VadModelConfig {
            silero_vad: SileroVadModelConfig {
                model: Some(dir.join("silero_vad.onnx").to_string_lossy().into()),
                threshold: 0.5,
                min_silence_duration: 0.5,
                min_speech_duration: 0.25,
                window_size: 512,
                max_speech_duration: 15.0,
            },
            sample_rate: 16_000,
            num_threads: 1,
            ..Default::default()
        },
        120.0,
    )
    .unwrap();
    let mut spans = vec![];
    let mut take = |vad: &VoiceActivityDetector| {
        while let Some(seg) = vad.front() {
            let start = seg.start() as f32 / RATE;
            spans.push(Span { start, end: start + seg.samples().len() as f32 / RATE });
            vad.pop();
        }
    };
    for w in samples.chunks_exact(512) {
        vad.accept_waveform(w);
        take(&vad);
    }
    vad.flush();
    take(&vad);
    spans
}

fn whisper(dir: &Path, language: &str, pcm: &Path, spans: &[Span]) -> Vec<retranscribe::Text> {
    if spans.is_empty() {
        return vec![];
    }
    retranscribe::transcribe(dir, language, &[(pcm, spans)], &[], |_| {}).expect("whisper").remove(0)
}

/// Lowercase words without punctuation, numbers spelt out in Catalan or Spanish.
fn words(text: &str, catalan: bool) -> Vec<String> {
    let text = text.to_lowercase().replace('%', if catalan { " per cent" } else { " por ciento" });
    text.replace(['\'', '’', '·'], " ")
        .chars()
        .map(|c| if c.is_alphanumeric() || c.is_whitespace() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .flat_map(|w| match w.parse::<u32>() {
            Ok(n) if n < 10_000 => spell(n, catalan).split(|c: char| c == ' ' || c == '-').map(str::to_string).collect(),
            _ => vec![w.to_string()],
        })
        .collect()
}

fn spell(n: u32, catalan: bool) -> String {
    if catalan { spell_ca(n) } else { spell_es(n) }
}

fn spell_ca(n: u32) -> String {
    const UNITS: [&str; 20] = ["zero", "u", "dos", "tres", "quatre", "cinc", "sis", "set", "vuit", "nou", "deu", "onze", "dotze", "tretze", "catorze", "quinze", "setze", "disset", "divuit", "dinou"];
    const TENS: [&str; 10] = ["", "", "vint", "trenta", "quaranta", "cinquanta", "seixanta", "setanta", "vuitanta", "noranta"];
    match n {
        0..=19 => UNITS[n as usize].into(),
        20..=99 => match (n / 10, n % 10) {
            (t, 0) => TENS[t as usize].into(),
            (2, u) => format!("vint-i-{}", UNITS[u as usize]),
            (t, u) => format!("{}-{}", TENS[t as usize], UNITS[u as usize]),
        },
        100..=999 => {
            let head = if n / 100 == 1 { "cent".to_string() } else { format!("{}-cents", UNITS[(n / 100) as usize]) };
            if n % 100 == 0 { head } else { format!("{head} {}", spell_ca(n % 100)) }
        }
        _ => {
            let head = if n / 1000 == 1 { "mil".to_string() } else { format!("{} mil", spell_ca(n / 1000)) };
            if n % 1000 == 0 { head } else { format!("{head} {}", spell_ca(n % 1000)) }
        }
    }
}

fn spell_es(n: u32) -> String {
    const UNITS: [&str; 30] = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
    const TENS: [&str; 10] = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
    const HUNDREDS: [&str; 10] = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];
    match n {
        0..=29 => UNITS[n as usize].into(),
        30..=99 => match n % 10 {
            0 => TENS[(n / 10) as usize].into(),
            u => format!("{} y {}", TENS[(n / 10) as usize], UNITS[u as usize]),
        },
        100 => "cien".into(),
        101..=999 => {
            let head = HUNDREDS[(n / 100) as usize];
            if n % 100 == 0 { head.into() } else { format!("{head} {}", spell_es(n % 100)) }
        }
        _ => {
            let head = if n / 1000 == 1 { "mil".to_string() } else { format!("{} mil", spell_es(n / 1000)) };
            if n % 1000 == 0 { head } else { format!("{head} {}", spell_es(n % 1000)) }
        }
    }
}

/// Word error rate: edits to turn `hyp` into `reference`, over the reference's length.
fn wer(reference: &[String], hyp: &[String]) -> f32 {
    let mut row: Vec<usize> = (0..=hyp.len()).collect();
    for (i, r) in reference.iter().enumerate() {
        let mut prev = row[0];
        row[0] = i + 1;
        for (j, h) in hyp.iter().enumerate() {
            let cur = row[j + 1];
            row[j + 1] = (row[j + 1] + 1).min(row[j] + 1).min(prev + usize::from(r != h));
            prev = cur;
        }
    }
    row[hyp.len()] as f32 / reference.len().max(1) as f32
}
