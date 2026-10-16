//! Feed a 16 kHz mono WAV through the live engine in 100 ms chunks, as the microphone would.
//!     cargo run --release --example simulate -- ../../data/reunio-3min.wav

use std::time::Instant;

use transcriptor_lib::engine::{Channel, Event, LiveSession, Models, SAMPLE_RATE, models_dir};

fn main() -> anyhow::Result<()> {
    let path = std::env::args().nth(1).expect("usage: simulate <file.wav>");
    let wave = sherpa_onnx::Wave::read(&path).expect("read wav");
    assert_eq!(wave.sample_rate() as usize, SAMPLE_RATE, "expected 16 kHz");
    let samples = wave.samples();

    let t0 = Instant::now();
    let models = Models::load(&models_dir())?;
    println!("models: {:.1}s", t0.elapsed().as_secs_f32());

    let mut session = LiveSession::new(&models, Channel::System, 5, 0.65)?;
    let (mut partials, t0) = (0, Instant::now());
    let mut print = |e: Event| match e {
        Event::Final {
            start,
            speaker,
            text,
            ..
        } => {
            println!(
                "[{start:6.1}] P{}: {}",
                speaker + 1,
                text.chars().take(90).collect::<String>()
            )
        }
        Event::Partial { text, .. } if !text.is_empty() => partials += 1,
        _ => {}
    };
    for chunk in samples.chunks(SAMPLE_RATE / 10) {
        session.accept(chunk).into_iter().for_each(&mut print);
    }
    session.finish().into_iter().for_each(&mut print);
    let audio_s = samples.len() as f32 / SAMPLE_RATE as f32;
    let busy = t0.elapsed().as_secs_f32();
    println!(
        "\n{busy:.1}s per {audio_s:.0}s d'àudio ({:.0}% CPU d'un fil), {partials} parcials",
        busy / audio_s * 100.0
    );
    Ok(())
}
