//! Which language Murmur would pick for an audio file opened without one (import.rs).
//!     cargo run --release --example lang_probe -- ../../data/reunio.m4a [more files…]

use std::time::Instant;

use transcriptor_lib::engine::models_dir;
use transcriptor_lib::{import, retranscribe};

fn main() -> anyhow::Result<()> {
    let tmp = std::env::temp_dir().join("murmur-lang-probe");
    for path in std::env::args().skip(1) {
        let t0 = Instant::now();
        let samples = import::decode(path.as_ref(), &tmp)?;
        let decoded = t0.elapsed().as_secs_f32();
        let spans = import::speech(&models_dir(), &samples)?;
        let vad = t0.elapsed().as_secs_f32() - decoded;
        let pcm = tmp.join("probe.pcm");
        let bytes: Vec<u8> = samples.iter().flat_map(|s| ((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()).collect();
        std::fs::write(&pcm, bytes)?;
        let windows = import::windows(&spans);
        let heard = retranscribe::detect(&models_dir(), &pcm, &windows)?;
        println!("== {path} ({:.0} s, {} trossos de veu)", samples.len() as f32 / 16_000.0, spans.len());
        for (w, h) in windows.iter().zip(&heard) {
            println!("  {:6.1}s  top={:3} ca={:.2} es={:.2} en={:.2}", w[0].start, h.top, h.ca, h.es, h.en);
        }
        println!(
            "  → {:?}  (descodificar {decoded:.1}s, VAD {vad:.1}s, total {:.1}s)",
            import::decide(&heard).language,
            t0.elapsed().as_secs_f32()
        );
    }
    Ok(())
}
