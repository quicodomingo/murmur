//! Time the final-pass diarization on a 16 kHz WAV and count speakers for a few settings.
//!     cargo run --release --example diarize_probe -- ../../data/reunio.wav
use std::time::Instant;
use transcriptor_lib::{
    diarize::{Options, diarize},
    engine::models_dir,
};

fn main() -> anyhow::Result<()> {
    let path = std::env::args().nth(1).expect("wav");
    let wave = sherpa_onnx::Wave::read(&path).expect("read");
    let samples = wave.samples();
    let secs = samples.len() as f32 / 16_000.0;
    // "shift,threshold[,speakers]" triples, e.g. 0.5,1.0 0.5,0.9,5
    let configs: Vec<Options> = std::env::args()
        .skip(2)
        .map(|a| {
            let v: Vec<&str> = a.split(',').collect();
            Options {
                window_shift: v[0].parse().unwrap(),
                threshold: v[1].parse().unwrap(),
                num_speakers: v.get(2).map(|n| n.parse().unwrap()),
            }
        })
        .collect();
    for opts in configs {
        let (n, th, shift) = (opts.num_speakers, opts.threshold, opts.window_shift);
        let t0 = Instant::now();
        let turns = diarize(&models_dir(), samples, opts)?;
        let mut speakers: Vec<usize> = turns.iter().map(|t| t.speaker).collect();
        speakers.sort();
        speakers.dedup();
        let dt = t0.elapsed().as_secs_f32();
        println!(
            "speakers={n:?} threshold={th}: {} speakers, {} turns, {dt:.1}s (RTF {:.3})",
            speakers.len(),
            turns.len(),
            dt / secs
        );
    }
    Ok(())
}
