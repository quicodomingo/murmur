//! Murmur's engine for the phone apps (docs/MOBIL.md), through UniFFI: the computer's live
//! transcription (`murmur-core`) with the Conformer in int8, and the same meetings database, so a
//! meeting recorded on the phone has the computer's format and goes to it as it is.
//!
//! Swift (and later Kotlin) see one object, `Murmur`: the list of meetings, and a recording that
//! starts, takes the microphone's 16 kHz samples and stops into a saved meeting.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use murmur_core::db::Db;
use murmur_core::engine::{Channel, Event, LiveModel, LoadOptions, Models, SAMPLE_RATE};
use murmur_core::{glossary, voice};
use murmur_core::pipeline::{Pipeline, Source};
use murmur_core::recorder::Recorder;
use serde_json::{Value, json};

uniffi::setup_scaffolding!();

/// The speaker threshold and the most speakers, as the computer's defaults (Settings).
const THRESHOLD: f32 = 0.7;
const MAX_SPEAKERS: usize = 6;
/// On the phone the Conformer runs in int8 on the two fast cores (docs/MOBIL.md: 4 threads are slower).
const LOAD: LoadOptions = LoadOptions { int8: true, threads: 2 };

/// LOAD, unless MURMUR_THREADS or MURMUR_INT8=0 say otherwise (development: measuring a new phone).
fn load_options() -> LoadOptions {
    let env = |k: &str| std::env::var(k).ok();
    LoadOptions {
        int8: env("MURMUR_INT8").map_or(LOAD.int8, |v| v != "0"),
        threads: env("MURMUR_THREADS").and_then(|v| v.parse().ok()).unwrap_or(LOAD.threads),
    }
}

mod pairing;

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum MurmurError {
    #[error("{0}")]
    Failed(String),
    /// The QR isn't a Murmur pairing code.
    #[error("not a pairing code")]
    NotACode,
    /// The code answered no more (it expired, or it was closed on the computer).
    #[error("the pairing code isn't on screen any more")]
    CodeExpired,
    /// No computer answered: not on the same network, or Murmur closed.
    #[error("the computer isn't reachable")]
    Unreachable,
    /// The computer answered but doesn't know this phone any more (it unpaired it).
    #[error("this phone isn't paired with the computer")]
    NotPaired,
    /// A sync is already running.
    #[error("already syncing")]
    Busy,
}

impl From<anyhow::Error> for MurmurError {
    fn from(e: anyhow::Error) -> Self {
        Self::Failed(format!("{e:#}"))
    }
}

type Result<T> = std::result::Result<T, MurmurError>;

/// One finished line of the transcript.
#[derive(uniffi::Record)]
pub struct Line {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub speaker: i64,
    pub text: String,
}

/// What a piece of audio brought: finished lines, the provisional text (`Some("")` clears it),
/// the seconds recorded so far and the level of this piece (rms).
#[derive(uniffi::Record)]
pub struct LiveUpdate {
    pub finals: Vec<Line>,
    pub partial: Option<String>,
    pub seconds: f64,
    pub level: f32,
}

/// A meeting in the list, without its transcript.
#[derive(uniffi::Record)]
pub struct MeetingRow {
    pub id: String,
    pub title: String,
    /// Milliseconds since 1970, as the computer stores it.
    pub created_at: f64,
    pub duration: f64,
    pub status: String,
    pub tags: Vec<String>,
    /// The last thing said, to recognise it in the list.
    pub last_line: Option<String>,
    /// The computer has it (stored whole).
    pub sent: bool,
    /// The computer has revised it (Whisper, speakers, summary).
    pub revised: bool,
    /// Recorded on the computer and sent here, text only: no audio on the phone.
    pub from_computer: bool,
}

/// A recording that never got saved: the app was closed or killed in the middle (by iOS, out of
/// memory, or a crash). Its audio is there; `recover_recording` makes it a meeting again.
#[derive(uniffi::Record)]
pub struct UnfinishedRecording {
    pub id: String,
    /// Milliseconds since 1970, from its id.
    pub created_at: f64,
}

/// A search result: where in which meeting. `snippet` has the matched words between \u{2} and
/// \u{3}, to highlight them.
#[derive(uniffi::Record)]
pub struct SearchHit {
    pub meeting_id: String,
    pub title: String,
    pub created_at: f64,
    /// "title", "utterance" or "note".
    pub kind: String,
    pub t: f64,
    pub snippet: String,
}

/// The loaded models, shared by every recording. sherpa-onnx's objects aren't marked Send/Sync,
/// but they're only used by one recording at a time, behind `Murmur.live`'s lock.
struct SharedModels(&'static Models);
unsafe impl Send for SharedModels {}
unsafe impl Sync for SharedModels {}

/// The recording in progress. Moved between threads only behind the lock.
struct Live {
    pipeline: Pipeline<'static>,
    meeting: Value,
    samples: u64,
    lines: Vec<Value>,
}
unsafe impl Send for Live {}

#[derive(uniffi::Object)]
pub struct Murmur {
    models_dir: PathBuf,
    data_dir: PathBuf,
    models: Mutex<Option<SharedModels>>,
    db: Mutex<Db>,
    live: Mutex<Option<Live>>,
    /// Held while syncing with the computer: one sync at a time.
    syncing: Mutex<()>,
}

fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

/// A meeting id as a folder name: never a path out of where it goes.
pub(crate) fn safe_dir(id: &str) -> String {
    id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect()
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

#[uniffi::export]
impl Murmur {
    /// `models_dir`: the app bundle's models; `data_dir`: where meetings and recordings go.
    #[uniffi::constructor]
    pub fn new(models_dir: String, data_dir: String) -> Result<std::sync::Arc<Self>> {
        let data_dir = PathBuf::from(data_dir);
        let db = Db::open(&data_dir.join("murmur.db"))?;
        Ok(std::sync::Arc::new(Self { models_dir: PathBuf::from(models_dir), data_dir, models: Mutex::new(None), db: Mutex::new(db), live: Mutex::new(None), syncing: Mutex::new(()) }))
    }

    /// Loads the models now (they load on the first recording otherwise): about half a second.
    pub fn prepare(&self) -> Result<()> {
        self.models().map(|_| ())
    }

    /// The meetings, newest first.
    pub fn meetings(&self) -> Result<Vec<MeetingRow>> {
        let state = self.load_sync();
        let db = lock(&self.db);
        let list = db.list()?;
        Ok(list
            .into_iter()
            .map(|s| {
                let full = db.get(&s.id).ok().flatten();
                let last_line = full
                    .as_ref()
                    .and_then(|m| m["utterances"].as_array().and_then(|u| u.last()).and_then(|u| u["text"].as_str()).map(str::to_owned));
                let (sent, revised, from_computer) = (state.sent.contains(&s.id), state.revised.contains(&s.id), state.from_computer.contains(&s.id));
                MeetingRow { id: s.id, title: s.title, created_at: s.created_at, duration: s.duration, status: s.status, tags: s.tags, last_line, sent, revised, from_computer }
            })
            .collect())
    }

    /// Searches titles, transcripts and notes (every word, as the beginning of a word: the
    /// computer's search).
    pub fn search(&self, query: String) -> Result<Vec<SearchHit>> {
        Ok(lock(&self.db)
            .search(&query, 60)?
            .into_iter()
            .map(|h| SearchHit { meeting_id: h.meeting_id, title: h.title, created_at: h.created_at, kind: h.kind, t: h.t, snippet: h.snippet })
            .collect())
    }

    /// Saves a whole meeting as the computer stores it (JSON): the sample meetings of the App
    /// Store's screenshots (`-demo`, development only).
    pub fn put_meeting(&self, json: String) -> Result<()> {
        let meeting: Value = serde_json::from_str(&json).map_err(|e| MurmurError::Failed(e.to_string()))?;
        lock(&self.db).put(&meeting).map_err(Into::into)
    }

    /// A meeting as the computer stores it (JSON), or None.
    pub fn meeting_json(&self, id: String) -> Result<Option<String>> {
        Ok(lock(&self.db).get(&id)?.map(|m| m.to_string()))
    }

    pub fn delete_meeting(&self, id: String) -> Result<()> {
        if let Some(m) = lock(&self.db).get(&id)? {
            if let Some(path) = self.audio_of(&m) {
                let _ = std::fs::remove_file(path);
            }
            // Its photos.
            let _ = std::fs::remove_dir_all(self.data_dir.join("screens").join(safe_dir(&id)));
        }
        lock(&self.db).delete(&id)?;
        // One of the computer's: it doesn't come again.
        let mut state = self.load_sync();
        if state.from_computer.remove(&id) {
            state.dismissed.insert(id);
            self.save_sync(&state)?;
        }
        Ok(())
    }

    /// A new title for a meeting (empty: left as it was).
    pub fn rename_meeting(&self, id: String, title: String) -> Result<()> {
        let title = title.trim();
        if title.is_empty() {
            return Ok(());
        }
        self.edit(&id, |m| m["title"] = json!(title))
    }

    /// A task of the cover done (or not), by its place in the list.
    pub fn set_task_done(&self, id: String, task: u32, done: bool) -> Result<()> {
        self.edit(&id, |m| {
            if let Some(t) = m.pointer_mut(&format!("/cover/tasks/{task}")) {
                t["done"] = json!(done);
            }
        })
    }

    /// A meeting's tags (by client, project…), the same as the computer's.
    pub fn set_tags(&self, id: String, tags: Vec<String>) -> Result<()> {
        let mut clean: Vec<String> = vec![];
        for tag in tags.iter().map(|t| t.trim()).filter(|t| !t.is_empty()) {
            if !clean.iter().any(|c| c.to_lowercase() == tag.to_lowercase()) {
                clean.push(tag.to_owned());
            }
        }
        self.edit(&id, |m| m["tags"] = json!(clean))
    }

    /// The notes of a finished meeting, as the computer's editor stores them (a TipTap document).
    pub fn set_notes(&self, id: String, doc: String) -> Result<()> {
        let doc: Value = serde_json::from_str(&doc).map_err(|e| MurmurError::Failed(e.to_string()))?;
        self.edit(&id, |m| m["notesDoc"] = doc)
    }

    /// A speaker's name ("Parlant 2" is "Laia"); empty takes it away. As the computer stores it:
    /// `speakerNames` by number.
    pub fn set_speaker_name(&self, id: String, speaker: i64, name: String) -> Result<()> {
        let name = name.trim().to_owned();
        self.edit(&id, |m| {
            if !m["speakerNames"].is_object() {
                m["speakerNames"] = json!({});
            }
            if name.is_empty() {
                m["speakerNames"].as_object_mut().map(|o| o.remove(&speaker.to_string()));
            } else {
                m["speakerNames"][speaker.to_string()] = json!(name);
            }
        })
    }

    /// One line goes to another speaker, set by hand (`speakerLocked`: the computer's final pass
    /// leaves it alone).
    pub fn set_line_speaker(&self, id: String, line: String, speaker: i64) -> Result<()> {
        self.edit(&id, |m| {
            for u in m["utterances"].as_array_mut().into_iter().flatten() {
                if u["id"] == json!(line) {
                    u["speaker"] = json!(speaker);
                    u["speakerLocked"] = json!(true);
                }
            }
        })
    }

    /// Every line of `from` is `into`'s: two speakers that were the same person.
    pub fn merge_speakers(&self, id: String, from: i64, into: i64) -> Result<()> {
        self.edit(&id, |m| {
            for u in m["utterances"].as_array_mut().into_iter().flatten() {
                if u["speaker"] == json!(from) {
                    u["speaker"] = json!(into);
                }
            }
            m["speakerNames"].as_object_mut().map(|o| o.remove(&from.to_string()));
        })
    }

    /// Starts recording a meeting: `title` as the phone shows it until the computer names it,
    /// `language` ("ca", "es", "ca-es", "en"), whether there are more people in the room (or
    /// it's only the user: one speaker), and how often the provisional text is redone (0: never).
    /// Returns the meeting's id.
    pub fn start(&self, title: String, language: String, more_in_room: bool, partial_every: f32) -> Result<String> {
        let models = self.models()?;
        let created = now_ms();
        let id = format!("phone-{}", created as u64);
        let audio = self.data_dir.join("recordings").join(format!("{id}.ogg"));
        let recorder = Recorder::create(&audio, 1)?;
        let mut pipeline = self.pipeline(models, more_in_room, Some(recorder))?;
        pipeline.set_partials(partial_every > 0.0);
        if partial_every > 0.0 {
            pipeline.set_partial_every(partial_every);
        }
        let meeting = json!({
            "id": id, "title": title, "createdAt": created, "duration": 0.0, "status": "recording",
            "utterances": [], "speakerNames": {}, "notes": [], "language": language,
            "sources": { "mic": true, "system": false }, "audioPath": audio.to_string_lossy(),
        });
        *lock(&self.live) = Some(Live { pipeline, meeting, samples: 0, lines: vec![] });
        Ok(id)
    }

    /// Recordings whose meeting was never saved (`UnfinishedRecording`). Only while not recording.
    pub fn unfinished_recordings(&self) -> Result<Vec<UnfinishedRecording>> {
        if lock(&self.live).is_some() {
            return Ok(vec![]);
        }
        let db = lock(&self.db);
        let mut out = vec![];
        for entry in std::fs::read_dir(self.data_dir.join("recordings")).into_iter().flatten().flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(id) = name.strip_suffix(".ogg").filter(|id| id.starts_with("phone-") && safe_dir(id) == *id) else { continue };
            let Some(created_at) = id.strip_prefix("phone-").and_then(|ms| ms.parse::<f64>().ok()) else { continue };
            if db.get(id)?.is_none() {
                out.push(UnfinishedRecording { id: id.to_owned(), created_at });
            }
        }
        Ok(out)
    }

    /// Makes an unfinished recording a meeting again: its audio goes through the same live
    /// transcription (faster than it was spoken), the file is written again whole, and the photos
    /// taken during it go with it. The notes were only in the app and are lost. Too short to hold
    /// anything (under a second), it's deleted. Returns whether there's a meeting.
    pub fn recover_recording(&self, id: String, title: String, language: String, more_in_room: bool) -> Result<bool> {
        let id = safe_dir(&id);
        let audio = self.data_dir.join("recordings").join(format!("{id}.ogg"));
        let samples = murmur_core::playback::decode(&audio).unwrap_or_default();
        if samples.len() < SAMPLE_RATE {
            let _ = std::fs::remove_file(&audio);
            return Ok(false);
        }
        let models = self.models()?;
        let whole = audio.with_extension("ogg.recovered");
        let mut pipeline = self.pipeline(models, more_in_room, Some(Recorder::create(&whole, 1)?))?;
        let mut events = vec![];
        for chunk in samples.chunks(SAMPLE_RATE) {
            events.extend(pipeline.push(Source::Mic, chunk));
        }
        events.extend(pipeline.finish()?.0);
        std::fs::rename(&whole, &audio).map_err(|e| MurmurError::Failed(e.to_string()))?;
        let lines: Vec<Value> = events
            .into_iter()
            .filter_map(|e| match e {
                Event::Final { id: n, start, end, speaker, text, .. } => Some(json!({ "id": line_id(&id, n), "start": start, "end": end, "speaker": speaker, "text": text })),
                _ => None,
            })
            .collect();
        let mut screens: Vec<Value> = std::fs::read_dir(self.data_dir.join("screens").join(&id))
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| {
                let file = e.file_name().to_string_lossy().into_owned();
                let ms = file.strip_suffix(".jpg")?.parse::<f64>().ok()?;
                Some(json!({ "t": ms / 1000.0, "path": format!("screens/{id}/{file}") }))
            })
            .collect();
        screens.sort_by(|a, b| a["t"].as_f64().partial_cmp(&b["t"].as_f64()).unwrap_or(std::cmp::Ordering::Equal));
        let created_at = id.strip_prefix("phone-").and_then(|ms| ms.parse::<f64>().ok()).unwrap_or_else(now_ms);
        let meeting = json!({
            "id": id, "title": title, "createdAt": created_at, "duration": samples.len() as f64 / SAMPLE_RATE as f64,
            "status": "done", "utterances": lines, "speakerNames": {}, "notes": [], "language": language,
            "sources": { "mic": true, "system": false }, "audioPath": audio.to_string_lossy(), "screens": screens,
        });
        lock(&self.db).put(&meeting)?;
        Ok(true)
    }

    /// 16 kHz mono samples from the microphone.
    pub fn push(&self, samples: Vec<f32>) -> Result<LiveUpdate> {
        let mut guard = lock(&self.live);
        let live = guard.as_mut().ok_or_else(|| MurmurError::Failed("not recording".into()))?;
        let level = if samples.is_empty() { 0.0 } else { (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt() };
        live.samples += samples.len() as u64;
        let events = live.pipeline.push(Source::Mic, &samples);
        Ok(update(live, events, level))
    }

    /// Stops and saves the meeting. `extra` is a JSON object the app adds to it: its notes
    /// (`notesDoc`), its photos (`screens`) and the moments marked as important (`marks`).
    pub fn stop(&self, extra: String) -> Result<String> {
        let live = lock(&self.live).take().ok_or_else(|| MurmurError::Failed("not recording".into()))?;
        let Live { pipeline, mut meeting, samples, mut lines } = live;
        let (events, _) = pipeline.finish()?;
        let prefix = meeting["id"].as_str().unwrap_or_default().to_owned();
        for e in events {
            if let Event::Final { id, start, end, speaker, text, .. } = e {
                lines.push(json!({ "id": line_id(&prefix, id), "start": start, "end": end, "speaker": speaker, "text": text }));
            }
        }
        meeting["duration"] = json!(samples as f64 / SAMPLE_RATE as f64);
        meeting["status"] = json!("done");
        if let Ok(Value::Object(mut add)) = serde_json::from_str::<Value>(&extra) {
            // What was changed while recording: speakers merged (`speakerAliases`, from → into,
            // also for the last lines, which only arrive now) and lines given to someone else
            // (`lineSpeakers`, by line id, set by hand).
            let aliases = add.remove("speakerAliases").unwrap_or_default();
            let by_line = add.remove("lineSpeakers").unwrap_or_default();
            for u in &mut lines {
                let id = u["id"].as_str().unwrap_or_default().to_owned();
                if let Some(s) = by_line.get(&id).and_then(Value::as_i64) {
                    u["speaker"] = json!(s);
                    u["speakerLocked"] = json!(true);
                } else if let Some(s) = u["speaker"].as_i64().and_then(|s| aliases.get(s.to_string()).and_then(Value::as_i64)) {
                    u["speaker"] = json!(s);
                }
            }
            for (k, v) in add {
                meeting[k] = v;
            }
        }
        meeting["utterances"] = Value::Array(lines);
        lock(&self.db).put(&meeting)?;
        Ok(meeting["id"].as_str().unwrap_or_default().to_owned())
    }

    /// Throws the recording away: nothing is saved, and its audio and photos are deleted.
    pub fn discard(&self) -> Result<()> {
        let Some(live) = lock(&self.live).take() else { return Ok(()) };
        let id = live.meeting["id"].as_str().unwrap_or_default().to_owned();
        drop(live);
        let _ = std::fs::remove_file(self.data_dir.join("recordings").join(format!("{}.ogg", safe_dir(&id))));
        let _ = std::fs::remove_dir_all(self.data_dir.join("screens").join(safe_dir(&id)));
        Ok(())
    }

    // "La teva veu" (voice.rs): a print of the user's voice, only on this phone.

    /// When it was saved (seconds since 1970), if it is.
    pub fn voice_saved(&self) -> Option<f64> {
        voice::load(&self.data_dir).map(|v| v.created_at)
    }

    /// How many words of `sentence` have been read so far in `samples` (the karaoke).
    pub fn voice_progress(&self, sentence: String, samples: Vec<f32>) -> Result<u32> {
        let words: Vec<&str> = sentence.split_whitespace().collect();
        Ok(voice::progress(&words, &self.models()?.transcribe(&samples)) as u32)
    }

    /// Makes and saves the print from the user reading the sentence. Fails (translated) with too
    /// little speech, to read it again.
    pub fn enroll_voice(&self, samples: Vec<f32>) -> Result<f64> {
        self.models()?;
        voice::enroll(&self.models_dir, &self.data_dir, &samples).map(|v| v.created_at).map_err(Into::into)
    }

    pub fn delete_voice(&self) -> Result<()> {
        voice::delete(&self.data_dir).map_err(Into::into)
    }

    /// Whether a recording is in progress (after the app was killed, it isn't).
    pub fn is_recording(&self) -> bool {
        lock(&self.live).is_some()
    }
}

impl Murmur {
    /// A meeting's audio on this phone. By its place in the data folder, not the path stored with
    /// it: iOS moves the app's folder when the app is reinstalled or updated.
    pub(crate) fn audio_of(&self, meeting: &Value) -> Option<PathBuf> {
        let id = meeting["id"].as_str()?;
        let here = self.data_dir.join("recordings").join(format!("{id}.ogg"));
        if here.exists() {
            return Some(here);
        }
        meeting["audioPath"].as_str().map(PathBuf::from).filter(|p| p.exists())
    }

    /// The live transcription of one recording, without provisional text: the glossary and the
    /// user's voice set.
    fn pipeline(&self, models: &'static Models, more_in_room: bool, recorder: Option<Recorder>) -> Result<Pipeline<'static>> {
        let mut pipeline = Pipeline::new(models, true, false, if more_in_room { MAX_SPEAKERS } else { 1 }, THRESHOLD, recorder, vec![])?;
        pipeline.set_partials(false);
        // "Murmur" spelled right, so "Murmur, sóc la Laia" is heard as such (glossary.rs).
        pipeline.set_glossary(glossary::with_guests(&[], &[]));
        // The user's voice (voice.rs), if saved: they're speaker 0, "Tu", from the first word.
        if let Some(voice) = voice::load(&self.data_dir) {
            pipeline.known_speakers(Channel::Mic, vec![(0, voice.embedding)], 1);
        }
        Ok(pipeline)
    }

    /// Reads a meeting, changes it and saves it back (nothing if it isn't there).
    fn edit(&self, id: &str, change: impl FnOnce(&mut Value)) -> Result<()> {
        let mut db = lock(&self.db);
        let Some(mut meeting) = db.get(id)? else { return Ok(()) };
        change(&mut meeting);
        db.put(&meeting)?;
        drop(db);
        // Already on the computer: the phone's names win when it comes back revised.
        self.note_edit(id);
        Ok(())
    }

    fn models(&self) -> Result<&'static Models> {
        let mut slot = lock(&self.models);
        if let Some(SharedModels(m)) = slot.as_ref() {
            return Ok(m);
        }
        let loaded: &'static Models = Box::leak(Box::new(Models::load_with(Path::new(&self.models_dir), LiveModel::CatalanSpanish, load_options())?));
        *slot = Some(SharedModels(loaded));
        Ok(loaded)
    }
}

/// A line's id. The database keys lines by id across every meeting (the desktop uses UUIDs), so
/// the meeting's id goes in front: "u3" alone would overwrite line 3 of another meeting.
fn line_id(meeting: &str, n: u32) -> String {
    format!("{meeting}-{n}")
}

fn update(live: &mut Live, events: Vec<Event>, level: f32) -> LiveUpdate {
    let prefix = live.meeting["id"].as_str().unwrap_or_default().to_owned();
    let mut finals = vec![];
    let mut partial = None;
    for e in events {
        match e {
            Event::Final { id, start, end, speaker, text, .. } => {
                let line = Line { id: line_id(&prefix, id), start: start as f64, end: end as f64, speaker: speaker as i64, text };
                live.lines.push(json!({ "id": line.id, "start": line.start, "end": line.end, "speaker": line.speaker, "text": line.text }));
                finals.push(line);
            }
            Event::Partial { text, .. } => partial = Some(text),
        }
    }
    LiveUpdate { finals, partial, seconds: live.samples as f64 / SAMPLE_RATE as f64, level }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(id: &str, speaker: i64) -> Value {
        json!({ "id": id, "start": 0.0, "end": 1.0, "speaker": speaker, "text": "hola" })
    }

    fn saved(m: &Murmur) -> Value {
        serde_json::from_str(&m.meeting_json("phone-1".into()).unwrap().unwrap()).unwrap()
    }

    #[test]
    fn recordings_never_saved_are_found_and_empty_ones_dropped() {
        let dir = std::env::temp_dir().join(format!("murmur-mobile-unfinished-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("recordings")).unwrap();
        let m = Murmur::new("/nowhere".into(), dir.to_string_lossy().into_owned()).unwrap();
        // One saved, one killed half a second in, and a file that isn't a recording.
        lock(&m.db).put(&json!({ "id": "phone-1000", "title": "Desada", "createdAt": 1000.0, "status": "done" })).unwrap();
        for id in ["phone-1000", "phone-2000"] {
            let mut rec = Recorder::create(&dir.join(format!("recordings/{id}.ogg")), 1).unwrap();
            rec.push(&vec![0.1; SAMPLE_RATE / 2]).unwrap();
        }
        std::fs::write(dir.join("recordings/other.ogg"), b"x").unwrap();
        let found = m.unfinished_recordings().unwrap();
        assert_eq!(found.iter().map(|r| (r.id.as_str(), r.created_at)).collect::<Vec<_>>(), [("phone-2000", 2000.0)]);
        // Too short to hold anything: gone, without loading the models.
        assert!(!m.recover_recording("phone-2000".into(), "Reunió".into(), "ca".into(), true).unwrap());
        assert!(m.unfinished_recordings().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn speakers_are_named_moved_and_merged() {
        let dir = std::env::temp_dir().join(format!("murmur-mobile-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let m = Murmur::new("/nowhere".into(), dir.to_string_lossy().into_owned()).unwrap();
        let meeting = json!({ "id": "phone-1", "title": "T", "createdAt": 0.0, "duration": 3.0, "status": "done",
            "utterances": [line("phone-1-0", 0), line("phone-1-1", 1), line("phone-1-2", 2)] });
        lock(&m.db).put(&meeting).unwrap();

        m.set_speaker_name("phone-1".into(), 1, " Laia ".into()).unwrap();
        m.set_speaker_name("phone-1".into(), 2, "Jordi".into()).unwrap();
        m.set_line_speaker("phone-1".into(), "phone-1-0".into(), 1).unwrap();
        m.merge_speakers("phone-1".into(), 2, 1).unwrap();
        m.rename_meeting("phone-1".into(), "Llançament".into()).unwrap();

        let s = saved(&m);
        assert_eq!(s["title"], "Llançament");
        assert_eq!(s["speakerNames"]["1"], "Laia");
        assert!(s["speakerNames"].get("2").is_none());
        let speakers: Vec<i64> = s["utterances"].as_array().unwrap().iter().map(|u| u["speaker"].as_i64().unwrap()).collect();
        assert_eq!(speakers, vec![1, 1, 1]);
        let locked: Vec<bool> = s["utterances"].as_array().unwrap().iter().map(|u| u["speakerLocked"] == json!(true)).collect();
        assert_eq!(locked, vec![true, false, false]);

        // An empty name takes it away.
        m.set_speaker_name("phone-1".into(), 1, "".into()).unwrap();
        assert!(saved(&m)["speakerNames"].get("1").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The computer's side as mobile.rs does it: stores what arrives, and sends back a revised
    /// version of each meeting it got.
    fn computer(keys: murmur_core::sync::Keys, secret: Option<[u8; 32]>, paired: Vec<[u8; 32]>, dest: std::path::PathBuf) -> (u16, std::thread::JoinHandle<Vec<Value>>) {
        use murmur_core::sync::{self, Accept, Incoming, Msg, Receiving};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let (mut s, _) = sync::accept(stream, &keys, &Accept { pairing_secret: secret.as_ref(), paired: &paired }, "MacBook de Quico").unwrap();
            let mut got = vec![];
            loop {
                match s.recv() {
                    Ok(Incoming::Msg(Msg::PutMeeting { meeting, files })) => {
                        let id = meeting["id"].as_str().unwrap().to_owned();
                        let r = Receiving::new(dest.join(&id), files).unwrap();
                        s.send(&Msg::Have { meeting_id: id.clone(), files: r.progress() }).unwrap();
                        while !r.finish().unwrap() {
                            let Incoming::Chunk { name, offset, data, .. } = s.recv().unwrap() else { panic!() };
                            r.write(&name, offset, &data).unwrap();
                        }
                        s.send(&Msg::Stored { meeting_id: id }).unwrap();
                        got.push(meeting);
                    }
                    Ok(Incoming::Msg(Msg::GetResults { known, .. })) => {
                        for m in &got {
                            let mut revised = m.clone();
                            revised["title"] = json!("Revisió del pressupost");
                            revised["speakerNames"] = json!({ "0": "Marta" });
                            revised["utterances"] = json!([{ "id": "w-0", "start": 0.0, "end": 2.0, "speaker": 0, "text": "Text de Whisper." }]);
                            revised["cover"] = json!({ "summary": "Resum" });
                            s.send(&Msg::Results { meeting: revised, revised_at: 100.0, computer: false }).unwrap();
                        }
                        // One of the computer's own, unless the phone says it has it (or deleted it).
                        if !known.unwrap_or_default().iter().any(|k| k == "pc-1") {
                            let theirs = json!({ "id": "pc-1", "title": "Comitè de direcció", "createdAt": 0.0, "duration": 60.0, "status": "done",
                                "utterances": [{ "id": "pc-1-0", "start": 0.0, "end": 2.0, "speaker": 0, "text": "Al Mac." }] });
                            s.send(&Msg::Results { meeting: theirs, revised_at: 50.0, computer: true }).unwrap();
                        }
                        s.send(&Msg::Bye).unwrap();
                    }
                    _ => return got,
                }
            }
        });
        (port, handle)
    }

    #[test]
    fn pairs_sends_a_meeting_with_its_audio_and_takes_the_results() {
        use murmur_core::sync::{Keys, PairingCode, VERSION};
        let dir = std::env::temp_dir().join(format!("murmur-mobile-sync-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("recordings")).unwrap();
        let m = Murmur::new("/nowhere".into(), dir.to_string_lossy().into_owned()).unwrap();
        let audio = dir.join("recordings/phone-1.ogg");
        std::fs::write(&audio, vec![7u8; 300_000]).unwrap();
        // Stored with the app's folder of an older install: iOS moves it on reinstalls and updates.
        let meeting = json!({ "id": "phone-1", "title": "Reunió de les 10:00", "createdAt": 0.0, "duration": 3.0, "status": "done",
            "audioPath": "/old/container/recordings/phone-1.ogg", "utterances": [line("phone-1-0", 0)],
            "screens": [{ "t": 12.0, "path": "screens/phone-1/12000.jpg" }] });
        std::fs::create_dir_all(dir.join("screens/phone-1")).unwrap();
        std::fs::write(dir.join("screens/phone-1/12000.jpg"), b"jpeg").unwrap();
        lock(&m.db).put(&meeting).unwrap();
        assert_eq!(m.unsent_count().unwrap(), 1);

        // Pairing, with the QR's code.
        let (pc, phone) = (Keys::generate().unwrap(), crate::pairing::new_sync_key().unwrap());
        let secret = [9u8; 32];
        let (port, handle) = computer(pc.clone(), Some(secret), vec![], dir.join("pc"));
        let uri = PairingCode { version: VERSION, name: "MacBook de Quico".into(), key: pc.public, secret, addrs: vec!["127.0.0.1".into()], port }.to_uri();
        assert_eq!(crate::pairing::read_pairing_code(uri.clone()).unwrap().computer_name, "MacBook de Quico");
        assert!(matches!(crate::pairing::read_pairing_code("https://example.com".into()), Err(MurmurError::NotACode)));
        let computer_info = m.pair(uri, vec![], phone.clone(), "iPhone de Quico".into()).unwrap();
        assert_eq!((computer_info.name.as_str(), computer_info.key.as_slice()), ("MacBook de Quico", pc.public.as_slice()));
        handle.join().unwrap();

        // Syncing: the meeting and its audio go; the revised version comes back.
        let phone_public = Keys::from_private(&phone).unwrap().public;
        let (port, handle) = computer(pc.clone(), None, vec![phone_public], dir.join("pc"));
        let report = m.sync(vec![format!("127.0.0.1:{port}")], phone.clone(), pc.public.to_vec(), "iPhone de Quico".into(), true).unwrap();
        let got = handle.join().unwrap();
        assert_eq!((report.sent, report.revised, report.received, report.failed), (1, 1, 1, 0));
        assert!(got[0].get("audioPath").is_none(), "the phone's paths stay on the phone");
        assert_eq!(std::fs::read(dir.join("pc/phone-1/audio.ogg")).unwrap(), vec![7u8; 300_000]);
        // The photo goes as the computer's screenshot, by a plain name.
        assert_eq!(got[0]["screens"][0]["path"], "screens/12000.jpg");
        assert_eq!(std::fs::read(dir.join("pc/phone-1/screens/12000.jpg")).unwrap(), b"jpeg");

        let back = saved(&m);
        assert_eq!(back["utterances"][0]["text"], "Text de Whisper.");
        assert_eq!(back["title"], "Revisió del pressupost");
        assert_eq!(back["audioPath"], json!(audio.to_string_lossy()));
        // ...and the phone keeps its own (the computer doesn't send its paths back).
        assert_eq!(back["screens"][0]["path"], "screens/phone-1/12000.jpg");
        let rows = m.meetings().unwrap();
        let row = rows.iter().find(|r| r.id == "phone-1").unwrap();
        assert!(row.sent && row.revised && !row.from_computer);
        // The computer's own meeting arrived, text only, and isn't sent back as the phone's.
        let theirs = rows.iter().find(|r| r.id == "pc-1").unwrap();
        assert!(theirs.from_computer);
        assert_eq!(theirs.last_line.as_deref(), Some("Al Mac."));
        assert_eq!(m.unsent_count().unwrap(), 0);

        // Renamed on the phone after sending: the phone's name wins when it comes back again.
        m.rename_meeting("phone-1".into(), "El meu títol".into()).unwrap();
        assert!(m.load_sync().edited.contains("phone-1"));
        // The fake computer only answers for what it gets in the same connection: send it again.
        let mut state = m.load_sync();
        state.sent.clear();
        state.since = 0.0;
        m.save_sync(&state).unwrap();
        let (port, handle) = computer(pc.clone(), None, vec![phone_public], dir.join("pc2"));
        let report = m.sync(vec![format!("127.0.0.1:{port}")], phone.clone(), pc.public.to_vec(), "iPhone de Quico".into(), false).unwrap();
        let got = handle.join().unwrap();
        // The phone said it has pc-1: it doesn't come again, nor go to the computer.
        assert_eq!(report.received, 0);
        assert!(got.iter().all(|m| m["id"] != "pc-1"));
        assert_eq!(saved(&m)["title"], "El meu títol");
        assert_eq!(saved(&m)["utterances"][0]["text"], "Text de Whisper.");
        // Without "Desa l'àudio al telèfon", the audio goes once the computer has it.
        assert!(!audio.exists());
        assert_eq!(std::fs::read(dir.join("pc2/phone-1/audio.ogg")).unwrap(), vec![7u8; 300_000]);

        // Deleted on the phone: it stays deleted, also after unpairing and pairing again.
        m.delete_meeting("pc-1".into()).unwrap();
        m.forget_computer().unwrap();
        assert!(m.load_sync().dismissed.contains("pc-1"));
        let (port, handle) = computer(pc.clone(), None, vec![phone_public], dir.join("pc3"));
        let report = m.sync(vec![format!("127.0.0.1:{port}")], phone.clone(), pc.public.to_vec(), "iPhone de Quico".into(), true).unwrap();
        handle.join().unwrap();
        assert_eq!(report.received, 0);
        assert!(m.meeting_json("pc-1".into()).unwrap().is_none());

        // A computer that doesn't know this phone: refused, and said so.
        let (port, handle) = computer(pc.clone(), None, vec![], dir.join("pc"));
        assert!(matches!(m.sync(vec![format!("127.0.0.1:{port}")], phone.clone(), pc.public.to_vec(), "iPhone".into(), true), Err(MurmurError::NotPaired)));
        let _ = handle.join();
        // Nobody there.
        assert!(matches!(m.sync(vec!["127.0.0.1:1".into()], phone, pc.public.to_vec(), "iPhone".into(), true), Err(MurmurError::Unreachable)));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
