//! Download a model for a few seconds, cancel, resume, then delete (checks Range resumption).
//!     cargo run --release --example download_probe -- /tmp/models llm
//!     cargo run --release --example download_probe -- /tmp/models transcription full   (whole download)
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use transcriptor_lib::models;

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let root = Path::new(&args[1]);
    let model = models::find(&args[2])?;
    if args.get(3).is_some_and(|a| a == "full") {
        let t0 = std::time::Instant::now();
        let r = model.download(root, &AtomicBool::new(false), |d, t| print!("\r{:.0} / {:.0} MB", d as f64 / 1e6, t as f64 / 1e6));
        println!("\n{:?} en {:.0}s · {:?}", r.err().map(|e| e.to_string()), t0.elapsed().as_secs_f32(), model.status(root));
        return Ok(());
    }
    for round in 0..2 {
        let cancel = Arc::new(AtomicBool::new(false));
        let c = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(3));
            c.store(true, Ordering::Relaxed);
        });
        let r = model.download(root, &cancel, |d, t| print!("\r{round}: {:.1} / {:.1} MB", d as f64 / 1e6, t as f64 / 1e6));
        println!("\n{round}: {:?} · status {:?}", r.err().map(|e| e.to_string()), model.status(root));
    }
    model.delete(root)?;
    println!("esborrat: {:?}", model.status(root));
    Ok(())
}
