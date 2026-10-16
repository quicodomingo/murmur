//! Encode a WAV into Ogg/Opus with the app's recorder.
//!     cargo run --release --example record_probe -- in.wav out.ogg
fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let wave = sherpa_onnx::Wave::read(&args[1]).expect("read wav");
    let mut rec = transcriptor_lib::recorder::Recorder::create(std::path::Path::new(&args[2]), 1)?;
    for chunk in wave.samples().chunks(1600) {
        rec.push(chunk)?;
    }
    rec.finish()
}
