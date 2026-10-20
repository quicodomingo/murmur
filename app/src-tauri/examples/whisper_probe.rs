//! Final-pass check: the live engine's utterances of a 16 kHz WAV next to what Whisper
//! (retranscribe.rs) makes of them, and how long Whisper takes.
//!     cargo run --release --example whisper_probe -- ../../data/reunio-3min.wav ca [seconds]

use std::time::Instant;

use sherpa_onnx::{SileroVadModelConfig, VadModelConfig, VoiceActivityDetector, Wave};
use transcriptor_lib::diarize::Span;
use transcriptor_lib::engine::{LiveModel, Models, models_dir};
use transcriptor_lib::retranscribe;

const RATE: f32 = 16_000.0;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = args.get(1).expect("wav");
    let language = args.get(2).cloned().unwrap_or_else(|| "ca".into());
    let limit: Option<f32> = args.get(3).and_then(|s| s.parse().ok());
    let dir = models_dir();
    let wave = Wave::read(path).expect("read wav");
    let mut samples = wave.samples().to_vec();
    if let Some(limit) = limit {
        samples.truncate((limit * RATE) as usize);
    }
    let seconds = samples.len() as f32 / RATE;

    // Utterances as the live engine cuts them (same VAD settings as engine.rs).
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
    let mut spans: Vec<Span> = vec![];
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

    let live_model = if language == "en" { LiveModel::English } else { LiveModel::CatalanSpanish };
    let live = Models::load(&dir, live_model).expect("live models");
    // The sidecar reads 16-bit PCM, as the pipeline taps it.
    let pcm = std::env::temp_dir().join("murmur-whisper-probe.pcm");
    let bytes: Vec<u8> = samples.iter().flat_map(|s| ((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()).collect();
    std::fs::write(&pcm, bytes).unwrap();
    eprintln!("{} frases", spans.len());
    let t = Instant::now();
    let texts = retranscribe::transcribe(&dir, &language, &[(pcm.as_path(), spans.as_slice())], |_| {})
        .expect("whisper")
        .remove(0);
    let took = t.elapsed().as_secs_f32();

    for span in &spans {
        let audio = &samples[(span.start * RATE) as usize..((span.end * RATE) as usize).min(samples.len())];
        let start = (span.start * 100.0).round() / 100.0;
        println!("[{:>6.1}] directe: {}", span.start, live.transcribe(audio));
        match texts.iter().find(|t| t.start == start) {
            Some(t) => println!("         whisper: {}", t.text),
            None => println!("         whisper: (es queda el directe)"),
        }
    }
    eprintln!("{seconds:.0} s d'àudio, Whisper {took:.1} s → RTF {:.3}", took / seconds);
}
