//! Capture system audio for a few seconds and transcribe it (checks permission + format).
//!     cargo run --example system_probe -- 8

use std::time::{Duration, Instant};

use transcriptor_lib::audio::start_capture;
use transcriptor_lib::engine::{Models, SAMPLE_RATE, models_dir};

fn main() -> anyhow::Result<()> {
    let secs: u64 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(8);
    let (tx, rx) = crossbeam_channel::unbounded();
    let capture = start_capture(false, None, true, tx)?;
    println!("capturing system audio for {secs}s…");
    let t0 = Instant::now();
    let mut audio = vec![];
    while t0.elapsed() < Duration::from_secs(secs) {
        if let Ok((_, chunk)) = rx.recv_timeout(Duration::from_millis(200)) {
            audio.extend(chunk);
        }
    }
    drop(capture);
    let rms = (audio.iter().map(|x| x * x).sum::<f32>() / audio.len().max(1) as f32).sqrt();
    println!(
        "got {:.1}s of audio, rms {rms:.4}",
        audio.len() as f32 / SAMPLE_RATE as f32
    );
    let models = Models::load(&models_dir())?;
    println!("text: {}", models.transcribe(&audio));
    Ok(())
}
