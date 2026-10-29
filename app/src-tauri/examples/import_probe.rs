//! An audio file through the live pipeline as File › Open Audio… does: decoded, on the mic
//! channel, as fast as the engine takes it.
//!     cargo run --release --example import_probe -- ../../data/reunio.m4a [ca|es|en|ca-es]

use std::time::Instant;

use transcriptor_lib::audio::Source;
use transcriptor_lib::engine::{Event, LiveModel, Models, SAMPLE_RATE, models_dir};
use transcriptor_lib::import;
use transcriptor_lib::pipeline::Pipeline;

fn main() -> anyhow::Result<()> {
    let path = std::env::args().nth(1).expect("usage: import_probe <file> [language]");
    let language = std::env::args().nth(2).unwrap_or_else(|| "ca".into());
    let t0 = Instant::now();
    let samples = import::decode(path.as_ref(), &std::env::temp_dir().join("murmur-import-probe"))?;
    let audio_s = samples.len() as f32 / SAMPLE_RATE as f32;
    println!("descodificat: {audio_s:.0}s d'àudio en {:.1}s", t0.elapsed().as_secs_f32());
    let models = Models::load(&models_dir(), LiveModel::for_language(&language))?;
    let mut pipeline = Pipeline::new(&models, true, false, 6, 0.65, None, vec![])?;
    pipeline.set_partials(false);
    let t0 = Instant::now();
    let mut lines = 0;
    let mut print = |events: Vec<Event>| {
        for e in events {
            if let Event::Final { start, speaker, text, .. } = e {
                lines += 1;
                if lines <= 12 {
                    println!("[{start:6.1}] P{}: {}", speaker + 1, text.chars().take(90).collect::<String>());
                }
            }
        }
    };
    for chunk in samples.chunks(SAMPLE_RATE / 2) {
        print(pipeline.push(Source::Mic, chunk));
    }
    let (events, _) = pipeline.finish()?;
    print(events);
    let busy = t0.elapsed().as_secs_f32();
    println!("\n{lines} frases. {busy:.1}s per {audio_s:.0}s d'àudio ({:.0}× més ràpid que el temps real)", audio_s / busy);
    Ok(())
}
