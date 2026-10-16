//! Final-pass speakers for labelled spans, for several settings (diarizes the whole file).
//!     cargo run --release --example diarize_spans -- reunio.wav qui-parla.json 0.5,1.1 0.1,0.9,5 …
//! Prints one JSON line per setting: {"config": "...", "speakers": [...]} in span order.
use transcriptor_lib::diarize::{Options, Span, assign, diarize};
use transcriptor_lib::engine::models_dir;

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let wave = sherpa_onnx::Wave::read(&args[1]).expect("read");
    let labelled: Vec<serde_json::Value> =
        serde_json::from_str(&std::fs::read_to_string(&args[2])?)?;
    let spans: Vec<Span> = labelled
        .iter()
        .map(|l| Span {
            start: l["start"].as_f64().unwrap() as f32,
            end: l["end"].as_f64().unwrap() as f32,
        })
        .collect();
    for config in &args[3..] {
        let v: Vec<&str> = config.split(',').collect();
        let opts = Options {
            window_shift: v[0].parse()?,
            threshold: v[1].parse()?,
            num_speakers: v.get(2).map(|n| n.parse()).transpose()?,
        };
        let turns = diarize(&models_dir(), wave.samples(), opts)?;
        let speakers: Vec<usize> = assign(&spans, &turns, 0)
            .iter()
            .map(|a| a.speaker)
            .collect();
        println!(
            "{}",
            serde_json::json!({"config": config, "speakers": speakers})
        );
    }
    Ok(())
}
