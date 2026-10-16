//! SQLite storage: meetings, one row per utterance, notes, and a full-text index (FTS5) over
//! titles, utterances and note blocks. The JSON shapes match the UI's `Meeting` type.

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
    legacy_notes  TEXT
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
        let conn = Connection::open(path).context("No s'ha pogut obrir la base de dades")?;
        conn.execute_batch(SCHEMA)
            .context("No s'ha pogut preparar la base de dades")?;
        migrate(&conn).context("No s'ha pogut actualitzar la base de dades")?;
        Ok(Self { conn })
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
            "SELECT id, title, created_at, duration, status FROM meetings ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Summary {
                id: r.get(0)?,
                title: r.get(1)?,
                created_at: r.get(2)?,
                duration: r.get(3)?,
                status: r.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// The full meeting, in the UI's JSON shape.
    pub fn get(&self, id: &str) -> Result<Option<Value>> {
        let meta = self
            .conn
            .query_row(
                "SELECT id, title, created_at, duration, status, speaker_names, sources, audio_path,
                        notes_doc, legacy_notes
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
                    }))
                },
            )
            .optional()?;
        let Some(mut meeting) = meta else {
            return Ok(None);
        };
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
                                   audio_path, notes_doc, legacy_notes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                meeting
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Reunió"),
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
            return Err(anyhow!("La reunió {id} no existeix"));
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
            if let Some(v) = meta.audio_path {
                tx.execute(
                    "UPDATE meetings SET audio_path = ?2 WHERE id = ?1",
                    params![id, v],
                )?;
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
        self.conn
            .execute("DELETE FROM meetings WHERE id = ?1", [id])?;
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
    std::fs::rename(dir, &backup).context("No s'han pogut arxivar els fitxers antics")?;
    Ok(meetings.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meeting() -> Value {
        json!({
            "id": "m1", "title": "Reunió amb el banc", "createdAt": 1000.0, "duration": 60.0,
            "status": "done", "speakerNames": {"0": "Marta"}, "sources": {"mic": true, "system": true},
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
        assert_eq!(m["utterances"].as_array().unwrap().len(), 2);
        assert_eq!(db.list().unwrap().len(), 1);
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
