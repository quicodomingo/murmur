//! Lists the windows on screen and the one a screenshot would take (capture.rs).
//!     cargo run --release --example capture_probe
use transcriptor_lib::capture::{meeting_window, windows};

fn main() {
    let list = windows();
    for w in list.iter().filter(|w| w.layer == 0) {
        println!("{:>6} {:<22} {:<40} {:.0}×{:.0}", w.id, w.owner, w.name.chars().take(40).collect::<String>(), w.width, w.height);
    }
    println!("call window: {:?}", meeting_window(&list));
}
