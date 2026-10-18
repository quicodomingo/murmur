//! Converts a meeting recording to the .m4a the player uses (playback.rs).
//!     cargo run --release --example playback_probe -- reunio.ogg sortida.m4a
fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let samples = transcriptor_lib::playback::decode(std::path::Path::new(&args[1]))?;
    println!("{:.1} s decoded", samples.len() as f32 / 16_000.0);
    transcriptor_lib::playback::write_m4a(&samples, std::path::Path::new(&args[2]))
}
