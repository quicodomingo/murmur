//! SQLite storage: meetings, one row per utterance, notes, and a full-text index (FTS5) over
//! titles, utterances and note blocks. The JSON shapes match the UI's `Meeting` type.

use crate::i18n::tr;
use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result, anyhow};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meetings (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    created_at    REAL NOT NULL,
    duration      REAL NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'done',
    speaker_names TEXT NOT NULL DEFAULT '{}',
    sources       TEXT,
    audio_path    TEXT,
    notes_doc     TEXT,
    legacy_notes  TEXT,
    cover         TEXT,
    guests        TEXT,
    screens       TEXT,
    language      TEXT,
    shares        TEXT
);

CREATE TABLE IF NOT EXISTS utterances (
    id         TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    start      REAL NOT NULL,
    end        REAL NOT NULL,
    speaker    INTEGER NOT NULL,
    text       TEXT NOT NULL,
    edited     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS utterances_by_meeting ON utterances(meeting_id, start);

-- Tags to organise meetings (by client, project…). A tag lives while some meeting has it.
CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS meeting_tags (
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (meeting_id, tag_id)
);

-- One row per searchable piece: a title, an utterance or a note block.
-- remove_diacritics 2: "reunio" finds "reunió", "cami" finds "camí".
CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(
    kind UNINDEXED, meeting_id UNINDEXED, ref UNINDEXED, t UNINDEXED, text,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS utterances_ai AFTER INSERT ON utterances BEGIN
    INSERT INTO search (kind, meeting_id, ref, t, text)
    VALUES ('utterance', new.meeting_id, new.id, new.start, new.text);
END;
CREATE TRIGGER IF NOT EXISTS utterances_au AFTER UPDATE OF text, start ON utterances BEGIN
    DELETE FROM search WHERE kind = 'utterance' AND ref = old.id;
    INSERT INTO search (kind, meeting_id, ref, t, text)
    VALUES ('utterance', new.meeting_id, new.id, new.start, new.text);
END;
CREATE TRIGGER IF NOT EXISTS utterances_ad AFTER DELETE ON utterances BEGIN
    DELETE FROM search WHERE kind = 'utterance' AND ref = old.id;
END;
CREATE TRIGGER IF NOT EXISTS meetings_ai AFTER INSERT ON meetings BEGIN
    INSERT INTO search (kind, meeting_id, ref, t, text) VALUES ('title', new.id, new.id, 0, new.title);
END;
CREATE TRIGGER IF NOT EXISTS meetings_au AFTER UPDATE OF title ON meetings BEGIN
    DELETE FROM search WHERE kind = 'title' AND meeting_id = old.id;
    INSERT INTO search (kind, meeting_id, ref, t, text) VALUES ('title', new.id, new.id, 0, new.title);
END;
CREATE TRIGGER IF NOT EXISTS meetings_ad AFTER DELETE ON meetings BEGIN
    DELETE FROM search WHERE meeting_id = old.id;
END;
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Utterance {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub speaker: i64,
    pub text: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub edited: bool,
    /// Speaker set by hand: the final pass leaves it alone.
    #[serde(
        default,
        rename = "speakerLocked",
        skip_serializing_if = "std::ops::Not::not"
    )]
    pub speaker_locked: bool,
}

/// What the sidebar needs, without loading transcripts.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub title: String,
    pub created_at: f64,
    pub duration: f64,
    pub status: String,
    pub tags: Vec<String>,
    /// Its shared links: the sidebar marks the meetings with one that still works.
    pub shares: Value,
}

/// Metadata fields the UI can change; absent fields are left alone.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaPatch {
    pub title: Option<String>,
    pub duration: Option<f64>,
    pub status: Option<String>,
    pub speaker_names: Option<Value>,
    pub sources: Option<Value>,
    pub audio_path: Option<Option<String>>,
    /// The generated cover (title, summary, tasks…); null removes it.
    #[serde(default, deserialize_with = "present")]
    pub cover: Option<Value>,
    /// Guests of the calendar event it was recorded for (names to offer for speakers).
    pub guests: Option<Value>,
    /// Screenshots taken during the meeting: [{t, path}].
    pub screens: Option<Value>,
    /// What it was spoken in when recorded (ca, es, ca-es, en): the cover can be written in it.
    pub language: Option<String>,
    /// Links it was shared with (lib/share.ts): [{id, url, createdAt, expiresAt, …}].
    pub shares: Option<Value>,
    /// Its tags, in order; replaces the ones it had.
    pub tags: Option<Vec<String>>,
}

/// A field that was sent, even as null (plain `Option` would read null as absent).
fn present<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(d).map(Some)
}

/// A stamped notes block, extracted by the UI (`notesFromDoc`) so notes are searchable.
#[derive(Debug, Deserialize)]
pub struct NoteBlock {
    pub t: f64,
    pub text: String,
}

#[derive(Debug, Deserialize)]
pub struct Notes {
    pub doc: Value,
    pub blocks: Vec<NoteBlock>,
}

/// One batch of edits to a meeting, applied in a single transaction.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    #[serde(default)]
    pub meta: Option<MetaPatch>,
    #[serde(default)]
    pub utterances: Vec<Utterance>,
    #[serde(default)]
    pub notes: Option<Notes>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub meeting_id: String,
    pub title: String,
    pub created_at: f64,
    pub kind: String,
    /// Utterance id for utterance hits.
    pub r#ref: String,
    pub t: f64,
    /// Matched words are wrapped in \u{2} … \u{3} so the UI can highlight them without HTML.
    pub snippet: String,
}

pub struct Db {
    conn: Connection,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let conn = Connection::open(path).context(tr!("db_open_failed"))?;
        conn.execute_batch(SCHEMA)
            .context(tr!("db_prepare_failed"))?;
        migrate(&conn).context(tr!("db_migrate_failed"))?;
        Ok(Self { conn })
    }

    /// The app's database for reading only, while the app may be writing it (the Claude
    /// connector, mcp.rs).
    pub fn open_read_only(path: &Path) -> Result<Self> {
        let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX)
            .context(tr!("db_open_failed"))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(Self { conn })
    }

    /// A meeting's note blocks as plain text, with the minute each was written at.
    pub fn note_texts(&self, id: &str) -> Result<Vec<(f64, String)>> {
        let mut stmt = self.conn.prepare("SELECT t, text FROM search WHERE kind = 'note' AND meeting_id = ?1 ORDER BY CAST(t AS REAL)")?;
        let rows = stmt.query_map([id], |r| Ok((r.get::<_, f64>(0)?, r.get::<_, String>(1)?)))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    #[cfg(test)]
    fn in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(SCHEMA)?;
        migrate(&conn)?;
        Ok(Self { conn })
    }

    pub fn is_empty(&self) -> Result<bool> {
        Ok(self
            .conn
            .query_row("SELECT COUNT(*) FROM meetings", [], |r| r.get::<_, i64>(0))?
            == 0)
    }

    pub fn list(&self) -> Result<Vec<Summary>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, created_at, duration, status, shares FROM meetings ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Summary {
                id: r.get(0)?,
                title: r.get(1)?,
                created_at: r.get(2)?,
                duration: r.get(3)?,
                status: r.get(4)?,
                tags: vec![],
                shares: r
                    .get::<_, Option<String>>(5)?
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or(json!([])),
            })
        })?;
        let mut list: Vec<Summary> = rows.collect::<rusqlite::Result<_>>()?;
        let mut tags = self.all_meeting_tags()?;
        for m in &mut list {
            m.tags = tags.remove(&m.id).unwrap_or_default();
        }
        Ok(list)
    }

    /// Every meeting's tags, in the order they were given.
    fn all_meeting_tags(&self) -> Result<HashMap<String, Vec<String>>> {
        let mut stmt = self.conn.prepare(
            "SELECT mt.meeting_id, t.name FROM meeting_tags mt JOIN tags t ON t.id = mt.tag_id
             ORDER BY mt.rowid",
        )?;
        let mut out: HashMap<String, Vec<String>> = HashMap::new();
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (meeting, tag) = row?;
            out.entry(meeting).or_default().push(tag);
        }
        Ok(out)
    }

    fn meeting_tags(&self, id: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.name FROM meeting_tags mt JOIN tags t ON t.id = mt.tag_id
             WHERE mt.meeting_id = ?1 ORDER BY mt.rowid",
        )?;
        let tags = stmt.query_map([id], |r| r.get(0))?;
        Ok(tags.collect::<rusqlite::Result<_>>()?)
    }

    /// Renames a tag in every meeting. If another tag already has that name, the two become one.
    pub fn rename_tag(&mut self, from: &str, to: &str) -> Result<()> {
        let to = to.trim();
        if to.is_empty() {
            return Ok(());
        }
        let tx = self.conn.transaction()?;
        let source: Option<i64> = tx
            .query_row("SELECT id FROM tags WHERE name = ?1", [from], |r| r.get(0))
            .optional()?;
        let Some(source) = source else {
            return Ok(());
        };
        let target: Option<i64> = tx
            .query_row("SELECT id FROM tags WHERE name = ?1", [to], |r| r.get(0))
            .optional()?;
        match target {
            Some(target) if target != source => {
                tx.execute(
                    "INSERT OR IGNORE INTO meeting_tags (meeting_id, tag_id)
                     SELECT meeting_id, ?2 FROM meeting_tags WHERE tag_id = ?1",
                    params![source, target],
                )?;
                tx.execute("DELETE FROM tags WHERE id = ?1", [source])?;
            }
            // The same tag (maybe only the capitals change), or a free name.
            _ => {
                tx.execute("UPDATE tags SET name = ?2 WHERE id = ?1", params![source, to])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Removes a tag from every meeting; the meetings stay.
    pub fn delete_tag(&mut self, name: &str) -> Result<()> {
        self.conn.execute("DELETE FROM tags WHERE name = ?1", [name])?;
        Ok(())
    }

    /// The full meeting, in the UI's JSON shape.
    pub fn get(&self, id: &str) -> Result<Option<Value>> {
        let meta = self
            .conn
            .query_row(
                "SELECT id, title, created_at, duration, status, speaker_names, sources, audio_path,
                        notes_doc, legacy_notes, cover, guests, screens, language, shares
                 FROM meetings WHERE id = ?1",
                [id],
                |r| {
                    let parse = |s: Option<String>| s.and_then(|s| serde_json::from_str::<Value>(&s).ok());
                    Ok(json!({
                        "id": r.get::<_, String>(0)?,
                        "title": r.get::<_, String>(1)?,
                        "createdAt": r.get::<_, f64>(2)?,
                        "duration": r.get::<_, f64>(3)?,
                        "status": r.get::<_, String>(4)?,
                        "speakerNames": parse(r.get(5)?).unwrap_or(json!({})),
                        "sources": parse(r.get(6)?),
                        "audioPath": r.get::<_, Option<String>>(7)?,
                        "notesDoc": parse(r.get(8)?),
                        "notes": parse(r.get(9)?).unwrap_or(json!([])),
                        "cover": parse(r.get(10)?),
                        "guests": parse(r.get(11)?).unwrap_or(json!([])),
                        "screens": parse(r.get(12)?).unwrap_or(json!([])),
                        "language": r.get::<_, Option<String>>(13)?,
                        "shares": parse(r.get(14)?).unwrap_or(json!([])),
                    }))
                },
            )
            .optional()?;
        let Some(mut meeting) = meta else {
            return Ok(None);
        };
        meeting["tags"] = json!(self.meeting_tags(id)?);
        let mut stmt = self.conn.prepare(
            "SELECT id, start, end, speaker, text, edited, speaker_locked FROM utterances
             WHERE meeting_id = ?1 ORDER BY start",
        )?;
        let utterances = stmt
            .query_map([id], |r| {
                Ok(Utterance {
                    id: r.get(0)?,
                    start: r.get(1)?,
                    end: r.get(2)?,
                    speaker: r.get(3)?,
                    text: r.get(4)?,
                    edited: r.get::<_, i64>(5)? != 0,
                    speaker_locked: r.get::<_, i64>(6)? != 0,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        meeting["utterances"] = serde_json::to_value(utterances)?;
        Ok(Some(meeting))
    }

    /// Inserts or replaces a whole meeting (new recordings, imports, migration).
    pub fn put(&mut self, meeting: &Value) -> Result<()> {
        let id = meeting
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("Reunió sense id"))?;
        // Replacing a meeting keeps its tags unless the new version brings its own.
        let tags = match meeting.get("tags") {
            Some(t) => serde_json::from_value::<Vec<String>>(t.clone()).unwrap_or_default(),
            None => self.meeting_tags(id)?,
        };
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM meetings WHERE id = ?1", [id])?;
        let text = |k: &str| {
            meeting
                .get(k)
                .filter(|v| !v.is_null())
                .map(Value::to_string)
        };
        tx.execute(
            "INSERT INTO meetings (id, title, created_at, duration, status, speaker_names, sources,
                                   audio_path, notes_doc, legacy_notes, cover, guests, screens, language, shares)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                id,
                meeting
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or(tr!("default_meeting_title")),
                meeting
                    .get("createdAt")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0),
                meeting
                    .get("duration")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0),
                meeting
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("done"),
                text("speakerNames").unwrap_or_else(|| "{}".into()),
                text("sources"),
                meeting.get("audioPath").and_then(Value::as_str),
                text("notesDoc"),
                text("notes"),
                text("cover"),
                text("guests"),
                text("screens"),
                meeting.get("language").and_then(Value::as_str),
                text("shares"),
            ],
        )?;
        let utterances: Vec<Utterance> =
            serde_json::from_value(meeting.get("utterances").cloned().unwrap_or(json!([])))?;
        for u in &utterances {
            upsert_utterance(&tx, id, u)?;
        }
        // Notes from older versions were single lines; index them too.
        let blocks: Vec<NoteBlock> = match meeting.get("notes") {
            Some(Value::Array(notes)) => notes
                .iter()
                .filter_map(|n| {
                    Some(NoteBlock {
                        t: n.get("t")?.as_f64()?,
                        text: n.get("text")?.as_str()?.into(),
                    })
                })
                .collect(),
            _ => vec![],
        };
        index_notes(&tx, id, &blocks)?;
        set_tags(&tx, id, &tags)?;
        prune_tags(&tx)?;
        tx.commit()?;
        Ok(())
    }

    pub fn apply(&mut self, id: &str, changes: Changes) -> Result<()> {
        let tx = self.conn.transaction()?;
        let exists: bool = tx
            .query_row("SELECT 1 FROM meetings WHERE id = ?1", [id], |_| Ok(true))
            .optional()?
            .is_some();
        if !exists {
            return Err(anyhow!(tr!("meeting_not_found", id = id)));
        }
        if let Some(meta) = changes.meta {
            if let Some(v) = meta.title {
                tx.execute(
                    "UPDATE meetings SET title = ?2 WHERE id = ?1",
                    params![id, v],
                )?;
            }
            if let Some(v) = meta.duration {
                tx.execute(
                    "UPDATE meetings SET duration = ?2 WHERE id = ?1",
                    params![id, v],
                )?;
            }
            if let Some(v) = meta.status {
                tx.execute(
                    "UPDATE meetings SET status = ?2 WHERE id = ?1",
                    params![id, v],
                )?;
            }
            if let Some(v) = meta.speaker_names {
                tx.execute(
                    "UPDATE meetings SET speaker_names = ?2 WHERE id = ?1",
                    params![id, v.to_string()],
                )?;
            }
            if let Some(v) = meta.sources {
                tx.execute(
                    "UPDATE meetings SET sources = ?2 WHERE id = ?1",
                    params![id, v.to_string()],
                )?;
            }
            if let Some(v) = meta.screens {
                tx.execute(
                    "UPDATE meetings SET screens = ?2 WHERE id = ?1",
                    params![id, v.to_string()],
                )?;
            }
            if let Some(v) = meta.shares {
                tx.execute(
                    "UPDATE meetings SET shares = ?2 WHERE id = ?1",
                    params![id, v.to_string()],
                )?;
            }
            if let Some(v) = meta.language {
                tx.execute(
                    "UPDATE meetings SET language = ?2 WHERE id = ?1",
                    params![id, v],
                )?;
            }
            if let Some(v) = meta.guests {
                tx.execute(
                    "UPDATE meetings SET guests = ?2 WHERE id = ?1",
                    params![id, v.to_string()],
                )?;
            }
            if let Some(v) = meta.cover {
                tx.execute(
                    "UPDATE meetings SET cover = ?2 WHERE id = ?1",
                    params![id, (!v.is_null()).then(|| v.to_string())],
                )?;
            }
            if let Some(v) = meta.audio_path {
                tx.execute(
                    "UPDATE meetings SET audio_path = ?2 WHERE id = ?1",
                    params![id, v],
                )?;
            }
            if let Some(tags) = meta.tags {
                set_tags(&tx, id, &tags)?;
                prune_tags(&tx)?;
            }
        }
        for u in &changes.utterances {
            upsert_utterance(&tx, id, u)?;
        }
        if let Some(notes) = changes.notes {
            tx.execute(
                "UPDATE meetings SET notes_doc = ?2 WHERE id = ?1",
                params![id, notes.doc.to_string()],
            )?;
            index_notes(&tx, id, &notes.blocks)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn delete(&mut self, id: &str) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM meetings WHERE id = ?1", [id])?;
        prune_tags(&tx)?;
        tx.commit()?;
        Ok(())
    }

    /// Full-text search. Every word must match (as a prefix, so "transcri" finds "transcripció").
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<Hit>> {
        let Some(fts) = fts_query(query) else {
            return Ok(vec![]);
        };
        let mut stmt = self.conn.prepare(
            "SELECT s.meeting_id, m.title, m.created_at, s.kind, s.ref, s.t,
                    snippet(search, 4, char(2), char(3), '…', 14)
             FROM search s JOIN meetings m ON m.id = s.meeting_id
             WHERE search MATCH ?1
             ORDER BY bm25(search), m.created_at DESC
             LIMIT ?2",
        )?;
        let hits = stmt.query_map(params![fts, limit as i64], |r| {
            Ok(Hit {
                meeting_id: r.get(0)?,
                title: r.get(1)?,
                created_at: r.get(2)?,
                kind: r.get(3)?,
                r#ref: r.get(4)?,
                t: r.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
                snippet: r.get(6)?,
            })
        })?;
        Ok(hits.collect::<rusqlite::Result<_>>()?)
    }
}

/// Columns added after the first release, for databases created before them.
fn migrate(conn: &Connection) -> Result<()> {
    let has = |table: &str, column: &str| -> Result<bool> {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let names = stmt
            .query_map([], |r| r.get::<_, String>(1))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(names.iter().any(|n| n == column))
    };
    if !has("utterances", "speaker_locked")? {
        conn.execute(
            "ALTER TABLE utterances ADD COLUMN speaker_locked INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    if !has("meetings", "cover")? {
        conn.execute("ALTER TABLE meetings ADD COLUMN cover TEXT", [])?;
    }
    if !has("meetings", "guests")? {
        conn.execute("ALTER TABLE meetings ADD COLUMN guests TEXT", [])?;
    }
    if !has("meetings", "screens")? {
        conn.execute("ALTER TABLE meetings ADD COLUMN screens TEXT", [])?;
    }
    if !has("meetings", "language")? {
        conn.execute("ALTER TABLE meetings ADD COLUMN language TEXT", [])?;
    }
    if !has("meetings", "shares")? {
        conn.execute("ALTER TABLE meetings ADD COLUMN shares TEXT", [])?;
    }
    Ok(())
}

/// Replaces a meeting's tags, creating the ones that don't exist yet (names ignore capitals).
fn set_tags(tx: &Transaction, meeting_id: &str, tags: &[String]) -> Result<()> {
    tx.execute("DELETE FROM meeting_tags WHERE meeting_id = ?1", [meeting_id])?;
    for name in tags.iter().map(|t| t.trim()).filter(|t| !t.is_empty()) {
        tx.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [name])?;
        tx.execute(
            "INSERT OR IGNORE INTO meeting_tags (meeting_id, tag_id)
             SELECT ?1, id FROM tags WHERE name = ?2",
            params![meeting_id, name],
        )?;
    }
    Ok(())
}

/// Tags no meeting has any more.
fn prune_tags(tx: &Transaction) -> Result<()> {
    tx.execute(
        "DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM meeting_tags)",
        [],
    )?;
    Ok(())
}

fn upsert_utterance(tx: &Transaction, meeting_id: &str, u: &Utterance) -> Result<()> {
    tx.execute(
        "INSERT INTO utterances (id, meeting_id, start, end, speaker, text, edited)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET start = excluded.start, end = excluded.end,
             speaker = excluded.speaker, text = excluded.text, edited = excluded.edited",
        params![
            u.id,
            meeting_id,
            u.start,
            u.end,
            u.speaker,
            u.text,
            u.edited as i64
        ],
    )?;
    Ok(())
}

fn index_notes(tx: &Transaction, meeting_id: &str, blocks: &[NoteBlock]) -> Result<()> {
    tx.execute(
        "DELETE FROM search WHERE kind = 'note' AND meeting_id = ?1",
        [meeting_id],
    )?;
    for (i, b) in blocks
        .iter()
        .filter(|b| !b.text.trim().is_empty())
        .enumerate()
    {
        tx.execute(
            "INSERT INTO search (kind, meeting_id, ref, t, text) VALUES ('note', ?1, ?2, ?3, ?4)",
            params![meeting_id, format!("b{i}"), b.t, b.text],
        )?;
    }
    Ok(())
}

/// Turns what the user typed into a safe FTS5 query: each word quoted, as a prefix, all required.
fn fts_query(input: &str) -> Option<String> {
    let terms: Vec<String> = input
        .split(|c: char| !c.is_alphanumeric() && c != '·' && c != '\'')
        .map(|w| w.trim_matches('\''))
        .filter(|w| !w.is_empty())
        .map(|w| format!("\"{}\"*", w.replace('"', "\"\"")))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

/// One-time import of the JSON files written by earlier versions (see storage.rs).
pub fn migrate_json(db: &mut Db, dir: &Path) -> Result<usize> {
    if !dir.exists() {
        return Ok(0);
    }
    let meetings = crate::storage::list(dir)?;
    for m in &meetings {
        db.put(m)?;
    }
    // Keep the files as a backup, out of the way.
    let backup = dir.with_file_name("meetings-json-backup");
    std::fs::rename(dir, &backup).context(tr!("old_files_archive_failed"))?;
    Ok(meetings.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meeting() -> Value {
        json!({
            "id": "m1", "title": "Reunió amb el banc", "createdAt": 1000.0, "duration": 60.0,
            "status": "done", "speakerNames": {"0": "Marta"}, "sources": {"mic": true, "system": true}, "language": "ca-es",
            "notes": [], "notesDoc": {"type": "doc"},
            "utterances": [
                {"id": "u1", "start": 0.0, "end": 2.0, "speaker": 0, "text": "Hem de parlar del TPV."},
                {"id": "u2", "start": 3.0, "end": 5.0, "speaker": 100, "text": "La transcripció funciona bé."}
            ]
        })
    }

    #[test]
    fn put_get_roundtrip() {
        let mut db = Db::in_memory().unwrap();
        db.put(&meeting()).unwrap();
        let m = db.get("m1").unwrap().unwrap();
        assert_eq!(m["title"], "Reunió amb el banc");
        assert_eq!(m["speakerNames"]["0"], "Marta");
        assert_eq!(m["language"], "ca-es");
        assert_eq!(m["utterances"].as_array().unwrap().len(), 2);
        assert_eq!(db.list().unwrap().len(), 1);
    }

    #[test]
    fn tags_are_set_renamed_merged_and_deleted() {
        let mut db = Db::in_memory().unwrap();
        db.put(&meeting()).unwrap();
        let mut other = meeting();
        other["id"] = json!("m2");
        other["tags"] = json!(["acme labs"]);
        db.put(&other).unwrap();
        let tags = |db: &Db, id: &str| db.get(id).unwrap().unwrap()["tags"].clone();

        let mut changes = Changes::default();
        changes.meta = Some(MetaPatch { tags: Some(vec!["Acme".into(), " Comercial ".into(), "acme".into()]), ..Default::default() });
        db.apply("m1", changes).unwrap();
        assert_eq!(tags(&db, "m1"), json!(["Acme", "Comercial"]));
        assert_eq!(db.list().unwrap()[0].tags.len(), 2);

        // Replacing the whole meeting keeps them.
        db.put(&meeting()).unwrap();
        assert_eq!(tags(&db, "m1"), json!(["Acme", "Comercial"]));

        // Renaming onto an existing name merges the two.
        db.rename_tag("acme labs", "ACME").unwrap();
        assert_eq!(tags(&db, "m2"), json!(["Acme"]));
        db.rename_tag("Acme", "Acme Labs").unwrap();
        assert_eq!(tags(&db, "m1"), json!(["Acme Labs", "Comercial"]));

        db.delete_tag("Comercial").unwrap();
        assert_eq!(tags(&db, "m1"), json!(["Acme Labs"]));

        // A tag no meeting has any more disappears.
        db.delete("m1").unwrap();
        db.delete("m2").unwrap();
        let left: i64 = db.conn.query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn cover_is_saved_and_removed() {
        let mut db = Db::in_memory().unwrap();
        db.put(&meeting()).unwrap();
        assert!(db.get("m1").unwrap().unwrap()["cover"].is_null());
        let set = |cover: Value| Changes {
            meta: Some(MetaPatch { cover: Some(cover), ..Default::default() }),
            ..Default::default()
        };
        db.apply("m1", set(json!({"summary": "Resum"}))).unwrap();
        assert_eq!(db.get("m1").unwrap().unwrap()["cover"]["summary"], "Resum");
        let clear: Changes = serde_json::from_value(json!({"meta": {"cover": null}})).unwrap();
        assert_eq!(clear.meta.as_ref().unwrap().cover, Some(Value::Null));
        db.apply("m1", clear).unwrap();
        assert!(db.get("m1").unwrap().unwrap()["cover"].is_null());
    }

    #[test]
    fn search_ignores_accents_and_matches_prefixes() {
        let mut db = Db::in_memory().unwrap();
        db.put(&meeting()).unwrap();
        let hits = db.search("transcripcio", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].r#ref, "u2");
        assert!(hits[0].snippet.contains('\u{2}'));
        assert_eq!(db.search("reunio", 10).unwrap()[0].kind, "title");
        assert_eq!(db.search("tp", 10).unwrap()[0].r#ref, "u1");
        assert!(
            db.search("parlar banc", 10).unwrap().is_empty(),
            "all words in one row"
        );
        assert!(
            db.search("\" OR *", 10).unwrap().is_empty(),
            "syntax is neutralised"
        );
    }

    #[test]
    fn edits_update_the_index() {
        let mut db = Db::in_memory().unwrap();
        db.put(&meeting()).unwrap();
        let changes = Changes {
            meta: Some(MetaPatch {
                title: Some("Llançament".into()),
                ..Default::default()
            }),
            utterances: vec![Utterance {
                id: "u1".into(),
                start: 0.0,
                end: 2.0,
                speaker: 0,
                text: "Parlem del WordPress.".into(),
                edited: true,
                speaker_locked: true,
            }],
            notes: Some(Notes {
                doc: json!({"type": "doc"}),
                blocks: vec![NoteBlock {
                    t: 4.0,
                    text: "Preu del plugin".into(),
                }],
            }),
        };
        db.apply("m1", changes).unwrap();
        assert!(db.search("TPV", 10).unwrap().is_empty());
        assert_eq!(db.search("wordpress", 10).unwrap()[0].r#ref, "u1");
        assert_eq!(db.search("llançament", 10).unwrap()[0].kind, "title");
        assert_eq!(db.search("plugin", 10).unwrap()[0].kind, "note");
        assert!(
            db.get("m1").unwrap().unwrap()["utterances"][0]["edited"]
                .as_bool()
                .unwrap()
        );
    }

    #[test]
    fn migrates_json_files_and_archives_them() {
        let root =
            std::env::temp_dir().join(format!("transcriptor-migrate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let dir = root.join("meetings");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("m1.json"), meeting().to_string()).unwrap();
        let mut db = Db::in_memory().unwrap();
        assert_eq!(migrate_json(&mut db, &dir).unwrap(), 1);
        assert_eq!(db.search("tpv", 10).unwrap().len(), 1);
        assert!(!dir.exists() && root.join("meetings-json-backup/m1.json").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn opens_a_database_created_before_speaker_locked() {
        let path =
            std::env::temp_dir().join(format!("transcriptor-old-{}.sqlite3", std::process::id()));
        let _ = std::fs::remove_file(&path);
        {
            let old = Connection::open(&path).unwrap();
            old.execute_batch(
                "CREATE TABLE utterances (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, start REAL NOT NULL,
                 end REAL NOT NULL, speaker INTEGER NOT NULL, text TEXT NOT NULL, edited INTEGER NOT NULL DEFAULT 0);",
            )
            .unwrap();
        }
        let mut db = Db::open(&path).unwrap();
        db.put(&meeting()).unwrap();
        assert_eq!(
            db.get("m1").unwrap().unwrap()["utterances"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        drop(db);
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn delete_removes_everything() {
        let mut db = Db::in_memory().unwrap();
        db.put(&meeting()).unwrap();
        db.delete("m1").unwrap();
        assert!(db.get("m1").unwrap().is_none());
        assert!(db.search("tpv", 10).unwrap().is_empty());
    }
}
