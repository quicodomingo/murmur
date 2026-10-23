//! Keeps the heavy work after a recording (speaker check, Whisper, punctuation, cover) out of
//! the way of a new meeting: it waits while Murmur records, or while another app uses the
//! microphone (a call in Meet, Teams, Zoom…, as "Reunió detectada" sees it), and one meeting is
//! processed at a time. Whisper runs in its own process, so it's paused on the spot (SIGSTOP); the rest
//! checks `wait` between steps. The speaker check is a single call into sherpa-onnx: once
//! started it finishes, which takes a few minutes at most.

use std::sync::{Condvar, Mutex, MutexGuard, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Why the work waits; the UI says it ("post-paused" event).
#[derive(Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Busy {
    recording: bool,
    call: bool,
}

impl Busy {
    fn any(self) -> bool {
        self.recording || self.call
    }
}

struct Gate {
    busy: Mutex<Busy>,
    changed: Condvar,
    /// The Whisper process running now, if any.
    whisper: Mutex<Option<u32>>,
}

static GATE: Gate = Gate {
    busy: Mutex::new(Busy { recording: false, call: false }),
    changed: Condvar::new(),
    whisper: Mutex::new(None),
};

/// One meeting's heavy work at a time.
static HEAVY: Mutex<()> = Mutex::new(());

static APP: OnceLock<AppHandle> = OnceLock::new();

/// To tell the UI when the work pauses and resumes.
pub fn init(app: AppHandle) {
    let _ = APP.set(app);
}

/// Called when a recording starts or stops.
pub fn set_recording(on: bool) {
    update(|b| b.recording = on);
}

/// Another app started or stopped using the microphone.
pub fn set_call(on: bool) {
    update(|b| b.call = on);
}

fn update(change: impl FnOnce(&mut Busy)) {
    let (was, now) = {
        let mut busy = GATE.busy.lock().unwrap();
        let was = *busy;
        change(&mut busy);
        (was, *busy)
    };
    if was == now {
        return;
    }
    GATE.changed.notify_all();
    if was.any() != now.any() {
        if let Some(pid) = *GATE.whisper.lock().unwrap() {
            signal(pid, now.any());
        }
    }
    if let Some(app) = APP.get() {
        let _ = app.emit("post-paused", now);
    }
}

fn paused() -> bool {
    GATE.busy.lock().unwrap().any()
}

/// Blocks while Murmur records or another app uses the microphone.
pub fn wait() {
    let mut busy = GATE.busy.lock().unwrap();
    while busy.any() {
        busy = GATE.changed.wait(busy).unwrap();
    }
}

/// Holds the heavy work of one meeting; others wait for it to be dropped.
pub fn heavy() -> MutexGuard<'static, ()> {
    HEAVY.lock().unwrap_or_else(|e| e.into_inner())
}

/// The Whisper process started (`Some`) or ended (`None`); it starts paused if the work waits.
pub fn whisper(pid: Option<u32>) {
    let mut slot = GATE.whisper.lock().unwrap();
    *slot = pid;
    if let Some(pid) = pid {
        if paused() {
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
