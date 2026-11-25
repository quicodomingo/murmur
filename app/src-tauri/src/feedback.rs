//! "Envia un comentari" (docs/COMENTARIS.md): what the person writes goes to Murmur's feedback
//! Worker (`feedback/`), only when they press "Envia". With it go the app's version and the system
//! (os, version, machine, memory, interface language), shown in the window before sending, and,
//! only if they tick it, the log of the last 24 hours (logfile.rs: never anything from the
//! meetings), which they can read first.
//!
//! Without a connection the message isn't lost: it waits in `feedback-outbox/` and goes, alone and
//! without asking again, the next time Murmur opens with a connection.

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// The Worker's address (docs/COMENTARIS.md); `MURMUR_FEEDBACK_URL` at build time takes its place
/// (a Worker running here, to try it). Empty: no "Envia un comentari".
const URL_DEFAULT: &str = "https://murmur-feedback.quicodomingo.workers.dev";
const URL: &str = match option_env!("MURMUR_FEEDBACK_URL") {
    Some(url) => url,
    None => URL_DEFAULT,
};
const OUTBOX: &str = "feedback-outbox";
/// The log goes from this far back, and no bigger than the Worker takes.
const LOG_HOURS: i64 = 24;
const LOG_MAX: usize = 256 * 1024;

pub fn available() -> bool {
    !URL.is_empty()
}

/// What the person filled in the window.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub kind: String,
    pub message: String,
    pub email: Option<String>,
    /// The error it came from ("Explica'ns què ha passat" on an error).
    pub context: Option<String>,
    pub include_log: bool,
    /// The interface language ("ca").
    pub language: String,
}

/// What goes with the message besides what they wrote, as the window shows it.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct System {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    /// "Mac16,1" on a Mac; empty elsewhere.
    pub machine: String,
    /// "16 GB".
    pub memory: String,
    pub language: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Payload {
    kind: String,
    message: String,
    email: Option<String>,
    context: Option<String>,
    app: String,
    system: System,
    log: Option<String>,
}

pub fn system(language: &str) -> System {
    let os = match std::env::consts::OS {
        "macos" => "macOS",
        "windows" => "Windows",
        "linux" => "Linux",
        other => other,
    };
    System {
        os: os.into(),
        os_version: crate::logfile::os_version(),
        arch: std::env::consts::ARCH.into(),
        machine: machine(),
        memory: memory_gb().map(|gb| format!("{gb} GB")).unwrap_or_default(),
        language: language.into(),
    }
}

fn sysctl(name: &str) -> Option<String> {
    let out = std::process::Command::new("/usr/sbin/sysctl").args(["-n", name]).output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string()).filter(|s| !s.is_empty())
}

fn machine() -> String {
    if cfg!(target_os = "macos") { sysctl("hw.model").unwrap_or_default() } else { String::new() }
}

/// The computer's memory, rounded to whole GB.
fn memory_gb() -> Option<u64> {
    let bytes: u64 = {
        #[cfg(target_os = "macos")]
        {
            sysctl("hw.memsize")?.parse().ok()?
        }
        #[cfg(target_os = "linux")]
        {
            let info = std::fs::read_to_string("/proc/meminfo").ok()?;
            let kb: u64 = info.lines().find_map(|l| l.strip_prefix("MemTotal:"))?.trim().trim_end_matches("kB").trim().parse().ok()?;
            kb * 1024
        }
        #[cfg(windows)]
        {
            use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
            let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
            status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
            // SAFETY: a struct of our own, with its size set as the call asks.
            if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
                return None;
            }
            status.ullTotalPhys
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
        {
            return None;
        }
    };
    Some((bytes as f64 / (1u64 << 30) as f64).round() as u64)
}

/// The log of the last 24 hours (both files, oldest first), cut from the start if it's too big.
pub fn log_tail(dir: &Path, now: chrono::NaiveDateTime) -> String {
    let since = (now - chrono::Duration::hours(LOG_HOURS)).format("%Y-%m-%d %H:%M:%S").to_string();
    let mut lines: Vec<String> = vec![];
    for file in ["murmur.1.log", "murmur.log"] {
        let Ok(text) = std::fs::read_to_string(dir.join(file)) else { continue };
        // Lines start with "2026-11-25 10:00:00", which sorts as text; a line without a date
        // (one that ran over) goes with the one before.
        let mut keep = false;
        for line in text.lines() {
            if let Some(stamp) = line.get(..19).filter(|s| s.as_bytes().get(4) == Some(&b'-')) {
                keep = stamp >= since.as_str();
            }
            if keep {
                lines.push(line.to_string());
            }
        }
    }
    let mut out = lines.join("\n");
    if out.len() > LOG_MAX {
        let mut cut = out.len() - LOG_MAX;
        while !out.is_char_boundary(cut) {
            cut += 1;
        }
        let from = out[cut..].find('\n').map(|i| cut + i + 1).unwrap_or(cut);
        out = out[from..].to_string();
    }
    out
}

fn log_now(app: &AppHandle) -> String {
    log::logger().flush();
    crate::logfile::dir(app).map(|dir| log_tail(&dir, chrono::Local::now().naive_local())).unwrap_or_default()
}

/// What the window shows before sending: what goes with the message, and the log.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub app: String,
    pub system: System,
    pub log: String,
}

pub fn preview(app: &AppHandle, language: &str) -> Preview {
    Preview { app: app_name(), system: system(language), log: log_now(app) }
}

fn app_name() -> String {
    format!("desktop {}", env!("CARGO_PKG_VERSION"))
}

/// How a send went.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Sent {
    Sent,
    /// No connection: it waits in the outbox and goes next time.
    Queued,
}

/// Why it couldn't go, for the window to say.
#[derive(Debug, PartialEq)]
pub enum Refused {
    /// Too many from here in the last hour.
    TooMany,
    /// The Worker said no (a bad message), or something else went wrong.
    Failed(String),
}

fn outbox(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_data_dir().map_err(|e| anyhow!("{e}"))?.join(OUTBOX))
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(10)).timeout(Duration::from_secs(30)).build()
}

/// One message to the Worker. `Err(None)`: no connection (try again later).
fn post(payload: &Payload) -> std::result::Result<(), Option<Refused>> {
    match agent().post(&format!("{}/feedback", URL.trim_end_matches('/'))).send_json(payload) {
        Ok(_) => Ok(()),
        Err(ureq::Error::Status(429, _)) => Err(Some(Refused::TooMany)),
        Err(ureq::Error::Status(code, r)) => Err(Some(Refused::Failed(format!("{code}: {}", r.into_string().unwrap_or_default())))),
        Err(ureq::Error::Transport(_)) => Err(None),
    }
}

/// "Envia": sends it now, or keeps it for later without a connection.
pub fn send(app: &AppHandle, draft: Draft) -> std::result::Result<Sent, Refused> {
    if !available() {
        return Err(Refused::Failed("no feedback address in this build".into()));
    }
    let payload = Payload {
        kind: draft.kind,
        message: draft.message.trim().to_string(),
        email: draft.email.map(|e| e.trim().to_string()).filter(|e| !e.is_empty()),
        context: draft.context.filter(|c| !c.trim().is_empty()),
        app: app_name(),
        system: system(&draft.language),
        log: draft.include_log.then(|| log_now(app)).filter(|l| !l.is_empty()),
    };
    match post(&payload) {
        Ok(()) => {
            log::info!("feedback sent ({}, log={})", payload.kind, payload.log.is_some());
            Ok(Sent::Sent)
        }
        Err(Some(refused)) => {
            log::warn!("feedback refused: {refused:?}");
            Err(refused)
        }
        Err(None) => {
            let saved = (|| -> Result<()> {
                let dir = outbox(app)?;
                std::fs::create_dir_all(&dir)?;
                let name = format!("{}.json", chrono::Utc::now().timestamp_millis());
                std::fs::write(dir.join(name), serde_json::to_vec(&payload)?)?;
                Ok(())
            })();
            match saved {
                Ok(()) => {
                    log::info!("feedback queued: no connection");
                    Ok(Sent::Queued)
                }
                Err(e) => Err(Refused::Failed(format!("{e:#}"))),
            }
        }
    }
}

/// At startup: what waited for a connection goes now. Refused ones are dropped (they'd be
/// refused again); without a connection yet, they wait for next time.
pub fn flush_outbox(app: &AppHandle) {
    if !available() {
        return;
    }
    let Ok(dir) = outbox(app) else { return };
    let Ok(entries) = std::fs::read_dir(&dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(payload) = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice::<Payload>(&b).ok()) else {
            let _ = std::fs::remove_file(&path);
            continue;
        };
        match post(&payload) {
            Ok(()) => {
                log::info!("feedback sent from the outbox");
                let _ = std::fs::remove_file(&path);
            }
            Err(Some(refused)) => {
                log::warn!("feedback from the outbox refused: {refused:?}");
                if refused != Refused::TooMany {
                    let _ = std::fs::remove_file(&path);
                }
            }
            Err(None) => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_log_goes_back_a_day_and_keeps_lines_together() {
        let dir = std::env::temp_dir().join(format!("murmur-feedback-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("murmur.1.log"), "2026-11-23 09:00:00 INFO old\n2026-11-24 11:00:00 INFO yesterday\n").unwrap();
        std::fs::write(dir.join("murmur.log"), "2026-11-25 10:00:00 ERROR failed:\n  and more\n2026-11-25 10:00:01 INFO later\n").unwrap();
        let now = chrono::NaiveDate::from_ymd_opt(2026, 11, 25).unwrap().and_hms_opt(10, 30, 0).unwrap();
        assert_eq!(log_tail(&dir, now), "2026-11-24 11:00:00 INFO yesterday\n2026-11-25 10:00:00 ERROR failed:\n  and more\n2026-11-25 10:00:01 INFO later");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn what_goes_with_the_message() {
        let s = system("ca");
        assert!(!s.os.is_empty() && !s.arch.is_empty());
        assert_eq!(s.language, "ca");
        if cfg!(target_os = "macos") {
            assert!(s.machine.starts_with("Mac"), "{}", s.machine);
            assert!(s.memory.ends_with(" GB"), "{}", s.memory);
        }
    }
}

/// Against a Worker running here: `cd feedback && npx wrangler dev --port 8799`, then
/// `MURMUR_FEEDBACK_URL=http://127.0.0.1:8799 cargo test feedback -- --ignored`.
#[cfg(test)]
mod live {
    use super::*;

    #[test]
    #[ignore]
    fn a_message_reaches_the_worker() {
        assert!(available(), "build with MURMUR_FEEDBACK_URL");
        let payload = Payload {
            kind: "idea".into(),
            message: "Una prova des de cargo test.".into(),
            email: None,
            context: None,
            app: app_name(),
            system: system("ca"),
            log: Some("2026-11-25 10:00:00 INFO prova".into()),
        };
        assert!(post(&payload).is_ok());
        let mut bad = payload;
        bad.message = "curt".into();
        assert!(matches!(post(&bad), Err(Some(Refused::Failed(_)))));
    }
}
