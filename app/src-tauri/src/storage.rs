//! Meetings stored as one JSON file each in `<app_data_dir>/meetings/`. The UI owns the schema;
//! Rust only stores and lists documents, writing atomically so a crash never leaves half a file.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow};
use serde_json::Value;

pub fn meetings_dir(app_data: &Path) -> PathBuf {
    app_data.join("meetings")
}

/// Ids come from the UI: keep only characters that are safe in a file name.
fn file_for(dir: &Path, id: &str) -> Result<PathBuf> {
    let safe: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    if safe.is_empty() || safe.len() != id.len() {
        return Err(anyhow!("Identificador de reunió no vàlid: {id}"));
    }
    Ok(dir.join(format!("{safe}.json")))
}

pub fn list(dir: &Path) -> Result<Vec<Value>> {
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut meetings = vec![];
    for entry in fs::read_dir(dir).context("No s'han pogut llegir les reunions")? {
        let path = entry?.path();
        if path.extension().is_some_and(|e| e == "json") {
            match fs::read(&path)
                .map_err(anyhow::Error::from)
                .and_then(|b| Ok(serde_json::from_slice(&b)?))
            {
                Ok(v) => meetings.push(v),
                Err(e) => log::error!("skipping unreadable meeting {}: {e:#}", path.display()),
            }
        }
    }
    // Newest first, as the sidebar shows them.
    meetings.sort_by(|a, b| {
        let at = |v: &Value| v.get("createdAt").and_then(Value::as_f64).unwrap_or(0.0);
        at(b).total_cmp(&at(a))
    });
    Ok(meetings)
}

pub fn save(dir: &Path, meeting: &Value) -> Result<()> {
    let id = meeting
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Reunió sense id"))?;
    fs::create_dir_all(dir).context("No s'ha pogut crear la carpeta de reunions")?;
    let path = file_for(dir, id)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec(meeting)?).context("No s'ha pogut desar la reunió")?;
    fs::rename(&tmp, &path).context("No s'ha pogut desar la reunió")?;
    Ok(())
}

pub fn delete(dir: &Path, id: &str) -> Result<()> {
    let path = file_for(dir, id)?;
    if path.exists() {
        fs::remove_file(path).context("No s'ha pogut eliminar la reunió")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("transcriptor-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn save_list_delete_roundtrip() {
        let dir = temp_dir("roundtrip");
        save(&dir, &json!({"id": "a-1", "createdAt": 1, "title": "old"})).unwrap();
        save(&dir, &json!({"id": "b-2", "createdAt": 2, "title": "new"})).unwrap();
        save(
            &dir,
            &json!({"id": "a-1", "createdAt": 1, "title": "old, edited"}),
        )
        .unwrap();
        let all = list(&dir).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0]["id"], "b-2", "newest first");
        assert_eq!(all[1]["title"], "old, edited");
        delete(&dir, "a-1").unwrap();
        assert_eq!(list(&dir).unwrap().len(), 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_ids_that_are_not_plain_names() {
        let dir = temp_dir("ids");
        assert!(save(&dir, &json!({"id": "../escape"})).is_err());
        assert!(save(&dir, &json!({"title": "no id"})).is_err());
        assert!(delete(&dir, "a/b").is_err());
    }

    #[test]
    fn skips_unreadable_files() {
        let dir = temp_dir("corrupt");
        save(&dir, &json!({"id": "ok", "createdAt": 1})).unwrap();
        fs::write(dir.join("broken.json"), b"{not json").unwrap();
        assert_eq!(list(&dir).unwrap().len(), 1);
        fs::remove_dir_all(dir).unwrap();
    }
}
