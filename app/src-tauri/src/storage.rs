//! Reader for the one-JSON-file-per-meeting format used before SQLite (`<app_data_dir>/meetings/`).
//! Only kept to migrate those files into the database (see `db::migrate_json`).

use crate::i18n::tr;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde_json::Value;

pub fn meetings_dir(app_data: &Path) -> PathBuf {
    app_data.join("meetings")
}

pub fn list(dir: &Path) -> Result<Vec<Value>> {
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut meetings = vec![];
    for entry in fs::read_dir(dir).context(tr!("meetings_read_failed"))? {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_newest_first_and_skips_unreadable_files() {
        let dir = std::env::temp_dir().join(format!("transcriptor-json-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.json"), r#"{"id":"a","createdAt":1}"#).unwrap();
        fs::write(dir.join("b.json"), r#"{"id":"b","createdAt":2}"#).unwrap();
        fs::write(dir.join("broken.json"), b"{not json").unwrap();
        let all = list(&dir).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0]["id"], "b");
        fs::remove_dir_all(dir).unwrap();
    }
}
