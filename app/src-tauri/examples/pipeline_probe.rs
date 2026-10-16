//! Speakerphone call through the full pipeline: system = remote audio, mic = local speech + echo.
//!     cargo run --release --example pipeline_probe -- remote.wav local.wav [out.ogg]
use transcriptor_lib::audio::Source;
use transcriptor_lib::engine::{Event, Models, SAMPLE_RATE, models_dir};
use transcriptor_lib::pipeline::Pipeline;
use transcriptor_lib::recorder::Recorder;

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
    let delay = SAMPLE_RATE * 120 / 1000;
    let mut mic = vec![0.0f32; n];
    for i in delay..n {
        for (k, g) in [0.5f32, 0.25, 0.12, 0.06].iter().enumerate() {
            if i >= delay + k * 40 {
                mic[i] += g * remote[i - delay - k * 40];
            }
        }
    }
    for (i, s) in local.iter().enumerate() {
        if 8 * SAMPLE_RATE + i < n {
            mic[8 * SAMPLE_RATE + i] += 0.8 * s;
        }
    }
    let models = Models::load(&models_dir())?;
    let recorder = args
        .get(3)
        .map(|p| Recorder::create(std::path::Path::new(p), 2))
        .transpose()?;
    let mut pipeline = Pipeline::new(&models, true, true, 5, 0.65, recorder, None)?;
    let mut events = vec![];
    // Callbacks arrive in uneven sizes and the system stream runs slightly ahead.
    let (sys_step, mic_step) = (1024, 441);
    let (mut si, mut mi) = (0, 0);
    while si < n || mi < n {
        if si < n {
            events.extend(pipeline.push(Source::System, &remote[si..(si + sys_step).min(n)]));
            si += sys_step;
        }
        for _ in 0..2 {
            if mi < n {
                events.extend(pipeline.push(Source::Mic, &mic[mi..(mi + mic_step).min(n)]));
                mi += mic_step;
            }
        }
    }
    events.extend(pipeline.finish()?.0);
    for e in events {
        if let Event::Final {
            channel,
            start,
            speaker,
            text,
            ..
        } = e
        {
            println!(
                "{channel:?} [{start:5.1}] spk {speaker}: {}",
                text.chars().take(80).collect::<String>()
            );
        }
    }
    Ok(())
}
