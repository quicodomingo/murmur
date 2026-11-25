//! Murmur's log: a text file in the app's log folder, for testers to send when something goes
//! wrong (Settings › General › "Mostra el registre"). It never leaves the computer by itself.
//!
//! Only technical events: the version and the system, recordings starting and stopping (length,
//! sources), the microphone going quiet, models, GPU or CPU, errors and timings. Never what's said
//! in a meeting, titles, notes, names, audio, keys or device names; the home folder is written
//! as "~", so paths don't carry the user's name. At most two files of 1 MB: murmur.log and,
//! once it fills, the one before (murmur.1.log).

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use log::{Level, LevelFilter, Log, Metadata, Record};

const MAX_BYTES: u64 = 1024 * 1024;
const FILE: &str = "murmur.log";
const PREVIOUS: &str = "murmur.1.log";

struct FileLog {
    dir: PathBuf,
    file: Mutex<Option<File>>,
    /// The home folder as it appears in paths, to write "~" instead.
    home: Option<String>,
}

/// Starts writing to `dir` (created if missing). Called once, when the app starts.
pub fn init(dir: &Path) {
    let _ = fs::create_dir_all(dir);
    let logger = FileLog {
        dir: dir.to_path_buf(),
        file: Mutex::new(open(dir)),
        home: home_dir().map(|h| h.to_string_lossy().into_owned()).filter(|h| h.len() > 1),
    };
    if log::set_boxed_logger(Box::new(logger)).is_ok() {
        log::set_max_level(LevelFilter::Info);
    }
    log::info!(
        "Murmur {} on {} {} ({})",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        os_version(),
        std::env::consts::ARCH
    );
}

/// The folder, for "Mostra el registre".
pub fn dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app.path().app_log_dir().ok()
}

fn open(dir: &Path) -> Option<File> {
    OpenOptions::new().create(true).append(true).open(dir.join(FILE)).ok()
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

pub(crate) fn os_version() -> String {
    #[cfg(target_os = "macos")]
    let out = std::process::Command::new("sw_vers").arg("-productVersion").output().ok();
    #[cfg(windows)]
    let out = {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: no console flashing up when Murmur starts.
        std::process::Command::new("cmd").args(["/C", "ver"]).creation_flags(0x0800_0000).output().ok()
    };
    #[cfg(not(any(windows, target_os = "macos")))]
    let out = std::process::Command::new("uname").arg("-r").output().ok();
    out.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default()
}

/// Our own crates write from Info up; the libraries underneath only their warnings and errors.
fn wanted(meta: &Metadata) -> bool {
    let ours = meta.target().starts_with("transcriptor") || meta.target().starts_with("murmur");
    meta.level() <= if ours { Level::Info } else { Level::Warn }
}

impl FileLog {
    fn clean(&self, line: String) -> String {
        match &self.home {
            Some(home) => line.replace(home.as_str(), "~"),
            None => line,
        }
    }

    /// Past the limit, the file becomes the previous one (replacing it) and a new one starts.
    fn rotate(&self, slot: &mut Option<File>) {
        let full = slot.as_ref().and_then(|f| f.metadata().ok()).is_some_and(|m| m.len() >= MAX_BYTES);
        if full {
            *slot = None;
            let _ = fs::rename(self.dir.join(FILE), self.dir.join(PREVIOUS));
            *slot = open(&self.dir);
        }
    }
}

impl Log for FileLog {
    fn enabled(&self, meta: &Metadata) -> bool {
        wanted(meta)
    }

    fn log(&self, record: &Record) {
        if !wanted(record.metadata()) {
            return;
        }
        let line = self.clean(format!(
            "{} {:<5} {}\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
            record.level(),
            record.args()
        ));
        if cfg!(debug_assertions) {
            eprint!("{line}");
        }
        let mut slot = self.file.lock().unwrap_or_else(|e| e.into_inner());
        self.rotate(&mut slot);
        if let Some(f) = slot.as_mut() {
            let _ = f.write_all(line.as_bytes());
        }
    }

    fn flush(&self) {
        if let Some(f) = self.file.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            let _ = f.flush();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn home_becomes_tilde_and_files_rotate() {
        let dir = std::env::temp_dir().join(format!("murmur-log-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let log = FileLog { dir: dir.clone(), file: Mutex::new(open(&dir)), home: Some("/Users/marta".into()) };
        assert_eq!(log.clean("can't read /Users/marta/Music/x.ogg".into()), "can't read ~/Music/x.ogg");

        let mut slot = log.file.lock().unwrap();
        slot.as_mut().unwrap().write_all(&vec![b'x'; MAX_BYTES as usize]).unwrap();
        log.rotate(&mut slot);
        assert_eq!(fs::metadata(dir.join(PREVIOUS)).unwrap().len(), MAX_BYTES);
        assert_eq!(fs::metadata(dir.join(FILE)).unwrap().len(), 0);
        drop(slot);
        let _ = fs::remove_dir_all(&dir);
    }
}
