//! Simulate a speakerphone call: mic = local speech + delayed, filtered echo of the remote audio.
//! Measures how much echo AEC removes and what the engine transcribes from the cleaned mic.
//!     cargo run --release --example aec_probe -- remote.wav local.wav
use transcriptor_lib::aec::{EchoCanceller, FRAME};
use transcriptor_lib::engine::{Models, SAMPLE_RATE, models_dir};

fn energy(x: &[f32]) -> f32 {
    x.iter().map(|s| s * s).sum::<f32>() / x.len().max(1) as f32
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let remote = sherpa_onnx::Wave::read(&args[1])
        .expect("remote")
        .samples()
        .to_vec();
    let local = sherpa_onnx::Wave::read(&args[2])
        .expect("local")
        .samples()
        .to_vec();
    let n = remote.len();
    // Echo path: 120 ms delay, 0.5 gain, a short smearing filter (room + speaker).
    let delay = SAMPLE_RATE * 120 / 1000;
    let taps = [0.5f32, 0.25, 0.12, 0.06];
    let mut echo = vec![0.0f32; n];
    for i in delay..n {
        for (k, g) in taps.iter().enumerate() {
            if i >= delay + k * 40 {
                echo[i] += g * remote[i - delay - k * 40];
            }
        }
    }
    // Local speaker talks from second 8.
    let start = 8 * SAMPLE_RATE;
    let mut mic: Vec<f32> = echo.clone();
    for (i, s) in local.iter().enumerate() {
        if start + i < n {
            mic[start + i] += 0.8 * s;
        }
    }

    let mut aec = EchoCanceller::new();
    let mut cleaned = Vec::with_capacity(n);
    for f in 0..n / FRAME {
        let r = f * FRAME..(f + 1) * FRAME;
        aec.render(&remote[r.clone()]);
        let mut frame = mic[r].to_vec();
        aec.capture(&mut frame);
        cleaned.extend(frame);
    }
    // Echo-only stretch (first 8 s, after 2 s of convergence).
    let a = 2 * SAMPLE_RATE..start;
    let erle = 10.0 * (energy(&mic[a.clone()]) / energy(&cleaned[a]).max(1e-12)).log10();
    println!("echo reduction (echo-only part): {erle:.1} dB");

    let models = Models::load(&models_dir(), transcriptor_lib::engine::LiveModel::CatalanSpanish)?;
    println!("mic raw    : {}", models.transcribe(&mic));
    println!("mic cleaned: {}", models.transcribe(&cleaned));
    Ok(())
}
