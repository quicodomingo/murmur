//! Live pipeline (system channel) with the final-pass tap, then diarization and reassignment.
//!     cargo run --release --example final_pass_probe -- ../../data/reunio-3min.wav
use std::collections::HashMap;
use transcriptor_lib::audio::Source;
use transcriptor_lib::diarize::{Options, assign, diarize};
use transcriptor_lib::engine::{Event, Models, models_dir};
use transcriptor_lib::pipeline::{Pipeline, read_tap};

fn main() -> anyhow::Result<()> {
    let path = std::env::args().nth(1).expect("wav");
    let audio = sherpa_onnx::Wave::read(&path)
        .expect("read")
        .samples()
        .to_vec();
    let tap = std::env::temp_dir().join("transcriptor-final-pass-probe.pcm");
    let models = Models::load(&models_dir())?;
    let mut pipeline = Pipeline::new(&models, false, true, 5, 0.65, None, Some(tap.clone()))?;
    let mut finals = vec![];
    for chunk in audio.chunks(1600) {
        finals.extend(pipeline.push(Source::System, chunk));
    }
    let (rest, tapped) = pipeline.finish()?;
    finals.extend(rest);
    let tapped = tapped.expect("tap");
    let samples = read_tap(&tapped.path)?;
    println!(
        "tap: {:.1}s of audio, {} utterances",
        samples.len() as f32 / 16000.0,
        tapped.spans.len()
    );
    let threshold: f32 = std::env::var("THRESHOLD")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(transcriptor_lib::diarize::DEFAULT_THRESHOLD);
    let num_speakers = std::env::var("SPEAKERS").ok().and_then(|v| v.parse().ok());
    let turns = diarize(
        &models_dir(),
        &samples,
        Options {
            threshold,
            num_speakers,
            ..Default::default()
        },
    )?;
    let assignments = assign(&tapped.spans, &turns, tapped.base);
    let verified: HashMap<String, usize> = assignments
        .iter()
        .map(|a| (format!("{:.2}", a.start), a.speaker))
        .collect();
    let mut line = String::new();
    for e in finals {
        if let Event::Final { start, speaker, .. } = e {
            line += &format!(
                "{:.0}s:{}/{} ",
                start,
                speaker - 100,
                verified[&format!("{start:.2}")] - 100
            );
        }
    }
    println!("threshold={threshold} speakers={num_speakers:?}  (start: live/verified)\n{line}");
    std::fs::remove_file(tap)?;
    Ok(())
}
