//! The Claude connector: Murmur as a local MCP server (stdio), for Claude Desktop and Claude Code.
//! The same app binary, started with `--mcp` (main.rs), so nothing else has to be installed:
//!
//!     /Applications/Murmur.app/Contents/MacOS/transcriptor --mcp
//!
//! Claude can read and search the meetings saved in Murmur, and transcribe an audio file on this
//! Mac. Everything runs here; Claude gets only text. Transcribing takes minutes, longer than a
//! tool call may wait: `transcribe_file` answers at once with a job id, and `get_transcription`
//! says how far it has got, then gives the text.

use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::os::fd::FromRawFd;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::{Result, anyhow};
use serde_json::{Value, json};

use crate::db::Db;
use crate::engine::{SYSTEM_SPEAKER_BASE, models_dir, set_app_models_dir};
use crate::import::{self, Stage, Transcript};

const IDENTIFIER: &str = "com.quicodomingo.murmur";
const LANGUAGES: [&str; 4] = ["ca", "es", "en", "ca-es"];
/// The MCP version spoken when the client doesn't say one.
const PROTOCOL: &str = "2025-06-18";

/// Murmur's data folder, the one the app uses (tauri.conf.json identifier).
fn data_dir() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    home.join("Library/Application Support").join(IDENTIFIER)
}

enum JobState {
    Queued,
    Running(Stage, f32),
    Done(Transcript),
    Failed(String),
}

struct Job {
    path: String,
    state: Mutex<JobState>,
}

struct Server {
    jobs: Mutex<HashMap<String, Arc<Job>>>,
    /// One transcription at a time: two would need twice the memory.
    running: Arc<Mutex<()>>,
}

/// Answers Claude's requests on stdin/stdout until stdin closes.
pub fn serve() -> Result<()> {
    // The protocol owns stdout; anything a library prints goes to stderr instead.
    let out = unsafe {
        let fd = libc::dup(1);
        libc::dup2(2, 1);
        std::fs::File::from_raw_fd(fd)
    };
    let mut out = std::io::BufWriter::new(out);
    set_app_models_dir(data_dir().join("models"));
    let server = Server { jobs: Mutex::new(HashMap::new()), running: Arc::new(Mutex::new(())) };
    for line in std::io::stdin().lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(request) => server.handle(&request),
            Err(e) => Some(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": e.to_string() } })),
        };
        if let Some(reply) = reply {
            writeln!(out, "{reply}")?;
            out.flush()?;
        }
    }
    Ok(())
}

impl Server {
    /// The reply to one JSON-RPC message; None for notifications.
    fn handle(&self, request: &Value) -> Option<Value> {
        let id = request.get("id")?.clone();
        let method = request.get("method").and_then(Value::as_str).unwrap_or("");
        let params = request.get("params").cloned().unwrap_or(json!({}));
        let result = match method {
            "initialize" => Ok(json!({
                "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL),
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "murmur", "title": "Murmur", "version": env!("CARGO_PKG_VERSION") },
                "instructions": "Murmur transcribes meetings on this Mac (Catalan, Spanish and English). Use it to read or search the user's recorded meetings, or to transcribe an audio file on disk. Transcribing runs in the background: call transcribe_file, then get_transcription until it is done.",
            })),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({ "tools": tools() })),
            "tools/call" => {
                let name = params.get("name").and_then(Value::as_str).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                Ok(match self.call(name, &args) {
                    Ok(text) => json!({ "content": [{ "type": "text", "text": text }] }),
                    Err(e) => json!({ "content": [{ "type": "text", "text": format!("{e:#}") }], "isError": true }),
                })
            }
            _ => Err(json!({ "code": -32601, "message": format!("Unknown method: {method}") })),
        };
        Some(match result {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err(error) => json!({ "jsonrpc": "2.0", "id": id, "error": error }),
        })
    }

    fn call(&self, name: &str, args: &Value) -> Result<String> {
        let text = |key: &str| args.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
        match name {
            "list_meetings" => list_meetings(args.get("limit").and_then(Value::as_u64).unwrap_or(20) as usize, text("tag")),
            "search_meetings" => search_meetings(text("query").ok_or_else(|| anyhow!("query is required"))?),
            "get_meeting" => get_meeting(text("id").ok_or_else(|| anyhow!("id is required"))?),
            "transcribe_file" => self.transcribe(
                text("path").ok_or_else(|| anyhow!("path is required"))?,
                text("language"),
                args.get("max_speakers").and_then(Value::as_u64).unwrap_or(6).clamp(1, 12) as usize,
            ),
            "get_transcription" => self.transcription(text("job_id").ok_or_else(|| anyhow!("job_id is required"))?),
            _ => Err(anyhow!("Unknown tool: {name}")),
        }
    }

    fn transcribe(&self, path: &str, language: Option<&str>, max_speakers: usize) -> Result<String> {
        let path = expand(path);
        if !path.is_file() {
            return Err(anyhow!("There is no file at {}", path.display()));
        }
        if let Some(l) = language {
            if !LANGUAGES.contains(&l) {
                return Err(anyhow!("language must be one of ca, es, en, ca-es"));
            }
        }
        let id = format!("t{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_millis());
        let job = Arc::new(Job { path: path.display().to_string(), state: Mutex::new(JobState::Queued) });
        self.jobs.lock().unwrap().insert(id.clone(), job.clone());
        let running = self.running.clone();
        let language = language.map(str::to_string);
        let file = path.clone();
        std::thread::spawn(move || {
            let _one = running.lock().unwrap_or_else(|e| e.into_inner());
            *job.state.lock().unwrap() = JobState::Running(Stage::Language, 0.0);
            let tmp = std::env::temp_dir().join("murmur-mcp");
            let glossary = open_db().and_then(|db| db.glossary()).unwrap_or_default();
            let result = import::transcribe_file(&models_dir(), &file, language.as_deref(), max_speakers, &glossary, &tmp, |stage, share| {
                *job.state.lock().unwrap() = JobState::Running(stage, share);
            });
            *job.state.lock().unwrap() = match result {
                Ok(t) => JobState::Done(t),
                Err(e) => JobState::Failed(format!("{e:#}")),
            };
        });
        Ok(format!(
            "Transcribing {} on this Mac. Job id: {id}\nIt takes about a minute per 10 minutes of audio, plus the final pass. Call get_transcription with this job id to follow it.",
            path.display()
        ))
    }

    fn transcription(&self, id: &str) -> Result<String> {
        let job = self.jobs.lock().unwrap().get(id).cloned().ok_or_else(|| anyhow!("No transcription with job id {id}"))?;
        let state = job.state.lock().unwrap();
        Ok(match &*state {
            JobState::Queued => format!("Waiting for another transcription to finish ({}).", job.path),
            JobState::Running(stage, share) => {
                let doing = match stage {
                    Stage::Language => "listening for the language",
                    Stage::Transcribing => "transcribing",
                    Stage::Speakers => "checking who spoke when",
                    Stage::Whisper => "rewriting the text with Whisper",
                };
                format!("Still working on {}: {doing} ({:.0}%). Ask again in a little while.", job.path, share * 100.0)
            }
            JobState::Failed(e) => format!("The transcription of {} failed: {e}", job.path),
            JobState::Done(t) => transcript_text(&job.path, t),
        })
    }
}

/// `~/…` as the user's home: Claude often writes paths that way.
fn expand(path: &str) -> PathBuf {
    match path.strip_prefix("~/") {
        Some(rest) => std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default().join(rest),
        None => PathBuf::from(path),
    }
}

fn tools() -> Value {
    json!([
        {
            "name": "list_meetings",
            "title": "List meetings",
            "description": "The meetings recorded in Murmur, newest first: id, title, date, length and tags.",
            "inputSchema": { "type": "object", "properties": {
                "limit": { "type": "integer", "description": "How many (default 20)." },
                "tag": { "type": "string", "description": "Only meetings with this tag." },
            } },
            "annotations": { "readOnlyHint": true },
        },
        {
            "name": "search_meetings",
            "title": "Search meetings",
            "description": "Full-text search over the titles, transcripts and notes of every meeting in Murmur. Accents don't matter.",
            "inputSchema": { "type": "object", "properties": {
                "query": { "type": "string", "description": "Words to look for." },
            }, "required": ["query"] },
            "annotations": { "readOnlyHint": true },
        },
        {
            "name": "get_meeting",
            "title": "Read a meeting",
            "description": "One meeting in full: its summary (if written), decisions, tasks, notes and transcript with who said what and when.",
            "inputSchema": { "type": "object", "properties": {
                "id": { "type": "string", "description": "The meeting id, from list_meetings or search_meetings." },
            }, "required": ["id"] },
            "annotations": { "readOnlyHint": true },
        },
        {
            "name": "transcribe_file",
            "title": "Transcribe an audio file",
            "description": "Transcribes an audio or video file on this Mac (mp3, m4a, wav, ogg, flac, mp4, mov…) with Murmur's local models, telling speakers apart. Catalan, Spanish, both mixed, or English. Runs in the background and returns a job id: then call get_transcription. Pass the language when you know it; otherwise Murmur listens for it.",
            "inputSchema": { "type": "object", "properties": {
                "path": { "type": "string", "description": "Absolute path to the file (~/ is fine)." },
                "language": { "type": "string", "enum": LANGUAGES, "description": "ca (Catalan), es (Spanish), en (English) or ca-es (Catalan and Spanish mixed). Leave it out to detect it." },
                "max_speakers": { "type": "integer", "description": "Most people that speak (default 6)." },
            }, "required": ["path"] },
            "annotations": { "readOnlyHint": true, "openWorldHint": false },
        },
        {
            "name": "get_transcription",
            "title": "Get a transcription",
            "description": "How a transcribe_file job is going, or its text when done: one line per utterance with time and speaker.",
            "inputSchema": { "type": "object", "properties": {
                "job_id": { "type": "string" },
            }, "required": ["job_id"] },
            "annotations": { "readOnlyHint": true },
        },
    ])
}

fn open_db() -> Result<Db> {
    let path = data_dir().join("transcriptor.sqlite3");
    if !path.is_file() {
        return Err(anyhow!("Murmur has no meetings on this Mac yet."));
    }
    Db::open_read_only(&path)
}

fn list_meetings(limit: usize, tag: Option<&str>) -> Result<String> {
    let all = open_db()?.list()?;
    let shown: Vec<_> = all
        .iter()
        .filter(|m| tag.is_none_or(|t| m.tags.iter().any(|x| x.eq_ignore_ascii_case(t))))
        .take(limit.max(1))
        .collect();
    if shown.is_empty() {
        return Ok("No meetings.".into());
    }
    let mut text = String::new();
    for m in shown {
        let tags = if m.tags.is_empty() { String::new() } else { format!(" · tags: {}", m.tags.join(", ")) };
        text += &format!("- {} ({}, {}){tags} · id: {}\n", m.title, date(m.created_at), length(m.duration as f32), m.id);
    }
    Ok(text)
}

fn search_meetings(query: &str) -> Result<String> {
    let hits = open_db()?.search(query, 30)?;
    if hits.is_empty() {
        return Ok(format!("Nothing found for \"{query}\"."));
    }
    let mut text = String::new();
    for h in hits {
        let snippet = h.snippet.replace(['\u{2}', '\u{3}'], "**");
        let at = if h.kind == "title" { String::new() } else { format!(" at {}", clock(h.t as f32)) };
        text += &format!("- {} ({}){at}, {}: {snippet} · id: {}\n", h.title, date(h.created_at), h.kind, h.meeting_id);
    }
    Ok(text)
}

fn get_meeting(id: &str) -> Result<String> {
    let db = open_db()?;
    let m = db.get(id)?.ok_or_else(|| anyhow!("No meeting with id {id}"))?;
    let s = |v: &Value| v.as_str().unwrap_or("").to_string();
    let mut text = format!("# {}\n\n{} · {}", s(&m["title"]), date(m["createdAt"].as_f64().unwrap_or(0.0)), length(m["duration"].as_f64().unwrap_or(0.0) as f32));
    if let Some(tags) = m["tags"].as_array().filter(|t| !t.is_empty()) {
        text += &format!(" · tags: {}", tags.iter().map(s).collect::<Vec<_>>().join(", "));
    }
    text += "\n";
    let call = m["sources"]["mic"].as_bool() == Some(true) && m["sources"]["system"].as_bool() == Some(true);
    let name = |speaker: usize| -> String {
        if let Some(n) = m["speakerNames"][speaker.to_string()].as_str().filter(|n| !n.is_empty()) {
            return n.to_string();
        }
        match speaker {
            n if n >= SYSTEM_SPEAKER_BASE => format!("Speaker {}", n - SYSTEM_SPEAKER_BASE + 1),
            0 if call => "The Murmur user".into(),
            n => format!("Speaker {}", n + 1),
        }
    };
    let cover = &m["cover"];
    if cover.is_object() {
        if let Some(excerpt) = cover["excerpt"].as_str() {
            text += &format!("\n## Summary\n\n{excerpt}\n");
        }
        for (key, title) in [("summary", "Key points"), ("decisions", "Decisions")] {
            if let Some(items) = cover[key].as_array().filter(|a| !a.is_empty()) {
                text += &format!("\n## {title}\n\n");
                for item in items {
                    text += &format!("- {}\n", item.as_str().map(str::to_string).unwrap_or_else(|| s(&item["text"])));
                }
            }
        }
        if let Some(tasks) = cover["tasks"].as_array().filter(|a| !a.is_empty()) {
            text += "\n## Tasks\n\n";
            for task in tasks {
                let done = if task["done"].as_bool() == Some(true) { "x" } else { " " };
                let who = task["owner"].as_str().map(|o| format!(" ({o})")).unwrap_or_default();
                let when = task["when"].as_str().map(|w| format!(", {w}")).unwrap_or_default();
                text += &format!("- [{done}] {}{who}{when}\n", s(&task["text"]));
            }
        }
    }
    let notes = db.note_texts(id)?;
    if !notes.is_empty() {
        text += "\n## Notes\n\n";
        for (t, note) in notes {
            text += &format!("- [{}] {note}\n", clock(t as f32));
        }
    }
    text += "\n## Transcript\n\n";
    for u in m["utterances"].as_array().into_iter().flatten() {
        let speaker = u["speaker"].as_u64().unwrap_or(0) as usize;
        text += &format!("[{}] {}: {}\n", clock(u["start"].as_f64().unwrap_or(0.0) as f32), name(speaker), s(&u["text"]));
    }
    Ok(text)
}

fn transcript_text(path: &str, t: &Transcript) -> String {
    let language = match t.language.as_str() {
        "ca" => "Catalan",
        "es" => "Spanish",
        "en" => "English",
        _ => "Catalan and Spanish",
    };
    let how = if t.detected { " (detected)" } else { "" };
    let speakers = t.utterances.iter().map(|u| u.speaker).max().map_or(0, |n| n + 1);
    let mut text = format!(
        "Transcript of {}\n{} · {language}{how} · {speakers} speakers\n\n",
        Path::new(path).file_name().map(|n| n.to_string_lossy()).unwrap_or_default(),
        length(t.duration)
    );
    for u in &t.utterances {
        text += &format!("[{}] Speaker {}: {}\n", clock(u.start), u.speaker + 1, u.text);
    }
    text
}

fn clock(seconds: f32) -> String {
    let s = seconds.max(0.0) as u64;
    if s >= 3600 { format!("{}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60) } else { format!("{:02}:{:02}", s / 60, s % 60) }
}

fn length(seconds: f32) -> String {
    let minutes = (seconds / 60.0).round() as u64;
    if minutes >= 60 { format!("{} h {} min", minutes / 60, minutes % 60) } else { format!("{} min", minutes.max(1)) }
}

/// Local date and time of a timestamp in milliseconds.
fn date(ms: f64) -> String {
    let secs = (ms / 1000.0) as libc::time_t;
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    unsafe { libc::localtime_r(&secs, &mut tm) };
    format!("{}-{:02}-{:02} {:02}:{:02}", tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday, tm.tm_hour, tm.tm_min)
}

// --- Settings › Claude --------------------------------------------------------------------

/// Claude Desktop's settings file, where its local MCP servers are listed.
pub fn desktop_config() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    home.join("Library/Application Support/Claude/claude_desktop_config.json")
}

/// Claude Desktop is on this Mac (it made its settings folder).
pub fn desktop_installed() -> bool {
    desktop_config().parent().is_some_and(Path::is_dir) || Path::new("/Applications/Claude.app").is_dir()
}

/// Murmur is among Claude Desktop's servers.
pub fn desktop_connected() -> bool {
    std::fs::read_to_string(desktop_config())
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .is_some_and(|c| c["mcpServers"]["murmur"].is_object())
}

/// Adds Murmur to Claude Desktop's servers, or takes it out, leaving everything else as it was.
pub fn set_desktop(on: bool, command: &Path) -> Result<()> {
    let path = desktop_config();
    let current = match std::fs::read_to_string(&path) {
        Ok(s) if !s.trim().is_empty() => Some(s),
        Ok(_) => None,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    let updated = with_murmur(current.as_deref(), on, command)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let partial = path.with_extension("json.murmur");
    std::fs::write(&partial, updated)?;
    std::fs::rename(&partial, &path)?;
    Ok(())
}

/// `config` (Claude Desktop's JSON, if any) with Murmur's entry added or removed. A file that
/// isn't valid JSON is left alone: it's the user's, and rewriting it could lose their servers.
fn with_murmur(config: Option<&str>, on: bool, command: &Path) -> Result<String> {
    let mut config: Value = match config {
        Some(s) => serde_json::from_str(s).map_err(|_| anyhow!("Claude Desktop's settings file isn't valid JSON: fix it or add Murmur by hand"))?,
        None => json!({}),
    };
    if !config.is_object() {
        return Err(anyhow!("Claude Desktop's settings file isn't a JSON object"));
    }
    if !config["mcpServers"].is_object() {
        config["mcpServers"] = json!({});
    }
    let servers = config["mcpServers"].as_object_mut().unwrap();
    if on {
        servers.insert("murmur".into(), json!({ "command": command, "args": ["--mcp"] }));
    } else {
        servers.remove("murmur");
    }
    Ok(serde_json::to_string_pretty(&config)? + "\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ask(server: &Server, method: &str, params: Value) -> Value {
        server.handle(&json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params })).unwrap()
    }

    #[test]
    fn speaks_mcp() {
        let server = Server { jobs: Mutex::new(HashMap::new()), running: Arc::new(Mutex::new(())) };
        let init = ask(&server, "initialize", json!({ "protocolVersion": "2025-03-26" }));
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert!(server.handle(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).is_none());
        let tools = ask(&server, "tools/list", json!({}));
        assert_eq!(tools["result"]["tools"].as_array().unwrap().len(), 5);
        let missing = ask(&server, "tools/call", json!({ "name": "transcribe_file", "arguments": { "path": "/no/such/file.mp3" } }));
        assert_eq!(missing["result"]["isError"], true);
        assert_eq!(ask(&server, "nope", json!({}))["error"]["code"], -32601);
    }

    #[test]
    fn edits_only_its_own_entry() {
        let exe = Path::new("/Applications/Murmur.app/Contents/MacOS/transcriptor");
        let mine = r#"{"mcpServers": {"other": {"command": "x"}}, "theme": "dark"}"#;
        let on: Value = serde_json::from_str(&with_murmur(Some(mine), true, exe).unwrap()).unwrap();
        assert_eq!(on["mcpServers"]["murmur"]["args"][0], "--mcp");
        assert_eq!(on["mcpServers"]["other"]["command"], "x");
        assert_eq!(on["theme"], "dark");
        let off: Value = serde_json::from_str(&with_murmur(Some(&on.to_string()), false, exe).unwrap()).unwrap();
        assert!(off["mcpServers"]["murmur"].is_null());
        assert_eq!(off["mcpServers"]["other"]["command"], "x");
        assert!(with_murmur(None, true, exe).unwrap().contains("murmur"));
        assert!(with_murmur(Some("{not json"), true, exe).is_err());
    }

    #[test]
    fn formats_times() {
        assert_eq!(clock(65.4), "01:05");
        assert_eq!(clock(3725.0), "1:02:05");
        assert_eq!(length(30.0), "1 min");
        assert_eq!(length(3900.0), "1 h 5 min");
    }
}
