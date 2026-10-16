//! Live pipeline over the first N seconds of a WAV; prints the utterances as JSON for labelling.
//!     cargo run --release --example label_dump -- ../../data/reunio.wav 360 > labels.json
use transcriptor_lib::audio::Source;
use transcriptor_lib::engine::{Event, Models, models_dir};
use transcriptor_lib::pipeline::Pipeline;

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let secs: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(360);
    let wave = sherpa_onnx::Wave::read(&args[1]).expect("read");
    let audio = &wave.samples()[..(secs * 16_000).min(wave.samples().len())];
    let models = Models::load(&models_dir())?;
    let mut pipeline = Pipeline::new(&models, false, true, 5, 0.65, None, None)?;
    let mut events = vec![];
    for chunk in audio.chunks(1600) {
        events.extend(pipeline.push(Source::System, chunk));
    }
    events.extend(pipeline.finish()?.0);
    let lines: Vec<_> = events
        .into_iter()
        .filter_map(|e| match e {
            Event::Final { start, end, speaker, text, .. } => Some(serde_json::json!({"start": start, "end": end, "live": speaker - 100, "text": text})),
            _ => None,
        })
        .collect();
    println!("{}", serde_json::to_string(&lines)?);
    Ok(())
}
