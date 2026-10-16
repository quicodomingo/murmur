//! Prints which other apps are using the microphone, every second (for "Reunió detectada").
use transcriptor_lib::micwatch::{mic_processes, mic_users};

fn main() {
    for _ in 0..8 {
        println!("{:?} · processos: {:?}", mic_users(), mic_processes());
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
}
