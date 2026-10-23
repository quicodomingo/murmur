//! Keeps the heavy work after a recording (speaker check, Whisper, punctuation, cover) out of
//! the way of a new recording: it waits while one is going on, and one meeting is processed at
//! a time. Whisper runs in its own process, so it's paused on the spot (SIGSTOP); the rest
//! checks `wait` between steps. The speaker check is a single call into sherpa-onnx: once
//! started it finishes, which takes a few minutes at most.

use std::sync::{Condvar, Mutex, MutexGuard};

struct Gate {
    recording: Mutex<bool>,
    changed: Condvar,
    /// The Whisper process running now, if any.
    whisper: Mutex<Option<u32>>,
}

static GATE: Gate = Gate {
    recording: Mutex::new(false),
    changed: Condvar::new(),
    whisper: Mutex::new(None),
};

/// One meeting's heavy work at a time.
static HEAVY: Mutex<()> = Mutex::new(());

/// Called when a recording starts or stops.
pub fn set_recording(on: bool) {
    *GATE.recording.lock().unwrap() = on;
    GATE.changed.notify_all();
    if let Some(pid) = *GATE.whisper.lock().unwrap() {
        signal(pid, on);
    }
}

pub fn recording() -> bool {
    *GATE.recording.lock().unwrap()
}

/// Blocks while a recording is going on.
pub fn wait() {
    let mut recording = GATE.recording.lock().unwrap();
    while *recording {
        recording = GATE.changed.wait(recording).unwrap();
    }
}

/// Holds the heavy work of one meeting; others wait for it to be dropped.
pub fn heavy() -> MutexGuard<'static, ()> {
    HEAVY.lock().unwrap_or_else(|e| e.into_inner())
}

/// The Whisper process started (`Some`) or ended (`None`); it's paused if a recording is on.
pub fn whisper(pid: Option<u32>) {
    let mut slot = GATE.whisper.lock().unwrap();
    *slot = pid;
    if let Some(pid) = pid {
        if recording() {
            signal(pid, true);
        }
    }
}

fn signal(pid: u32, pause: bool) {
    let sig = if pause { libc::SIGSTOP } else { libc::SIGCONT };
    // SAFETY: plain kill(2) on our own child process.
    unsafe {
        libc::kill(pid as libc::pid_t, sig);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    #[test]
    fn waits_until_the_recording_stops() {
        set_recording(true);
        let passed = Arc::new(AtomicBool::new(false));
        let worker = {
            let passed = passed.clone();
            std::thread::spawn(move || {
                wait();
                passed.store(true, Ordering::SeqCst);
            })
        };
        std::thread::sleep(Duration::from_millis(100));
        assert!(!passed.load(Ordering::SeqCst));
        set_recording(false);
        worker.join().unwrap();
        assert!(passed.load(Ordering::SeqCst));
    }
}
