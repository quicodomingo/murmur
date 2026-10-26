//! Shared links (docs/COMPARTIR.md): the user's own Cloudflare Worker (share/) keeps meetings that
//! the interface has already encrypted, and serves the page that decrypts them. Its address and
//! API key live in the macOS keychain; the key never reaches the interface.

use std::time::Duration;

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::i18n::tr;

const SERVICE: &str = "com.quicodomingo.murmur.share";
const ACCOUNT: &str = "worker";

#[derive(Serialize, Deserialize)]
struct Connection {
    url: String,
    key: String,
}

/// What the settings show: the Worker's address and the key's last characters.
#[derive(Serialize)]
pub struct Status {
    pub url: String,
    pub hint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Published {
    pub id: String,
    /// The page's address, without the key (the interface adds it after the #).
    pub url: String,
    pub expires_at: Option<f64>,
}

fn connection() -> Result<Connection> {
    let bytes = security_framework::passwords::get_generic_password(SERVICE, ACCOUNT).map_err(|_| anyhow!(tr!("share_not_connected")))?;
    serde_json::from_slice(&bytes).map_err(|_| anyhow!(tr!("share_not_connected")))
}

pub fn status() -> Option<Status> {
    let c = connection().ok()?;
    let hint: String = c.key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    Some(Status { url: c.url, hint })
}

/// "murmur-share.x.workers.dev/" → "https://murmur-share.x.workers.dev".
fn normalize(url: &str) -> Result<String> {
    let url = url.trim().trim_end_matches('/');
    let url = if url.contains("://") { url.to_string() } else { format!("https://{url}") };
    // Plain http only for a Worker running on this Mac (`npm run dev` in share/).
    let host = match url.strip_prefix("https://") {
        Some(host) => host,
        None => url
            .strip_prefix("http://")
            .filter(|h| h.starts_with("localhost:") || h.starts_with("127.0.0.1:"))
            .ok_or_else(|| anyhow!(tr!("share_bad_url")))?,
    };
    if host.is_empty() || host.contains(['/', '?', '#', ' ']) || !host.contains(['.', ':']) {
        return Err(anyhow!(tr!("share_bad_url")));
    }
    Ok(url)
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(15)).timeout(Duration::from_secs(120)).build()
}

/// A failed call as something the user can act on.
fn failure(e: ureq::Error) -> anyhow::Error {
    match e {
        ureq::Error::Status(401 | 403, _) => anyhow!(tr!("share_bad_key")),
        ureq::Error::Status(404 | 405, _) => anyhow!(tr!("share_not_worker")),
        ureq::Error::Status(413, _) => anyhow!(tr!("share_too_large")),
        ureq::Error::Status(code, _) => anyhow!(tr!("server_status", code = code)),
        ureq::Error::Transport(_) => anyhow!(tr!("cloud_offline")),
    }
}

/// Checks the address and key against the Worker, and only then saves them.
pub fn connect(url: &str, key: &str) -> Result<Status> {
    let url = normalize(url)?;
    let key = key.trim().to_string();
    let reply: Value = agent()
        .get(&format!("{url}/api/ping"))
        .set("Authorization", &format!("Bearer {key}"))
        .call()
        .map_err(failure)?
        .into_json()
        .map_err(|_| anyhow!(tr!("share_not_worker")))?;
    if reply["ok"] != true {
        return Err(anyhow!(tr!("share_not_worker")));
    }
    let saved = serde_json::to_vec(&Connection { url, key })?;
    security_framework::passwords::set_generic_password(SERVICE, ACCOUNT, &saved)
        .map_err(|e| anyhow!(tr!("cloud_keychain_failed", error = e)))?;
    status().ok_or_else(|| anyhow!(tr!("share_not_connected")))
}

pub fn disconnect() -> Result<()> {
    match security_framework::passwords::delete_generic_password(SERVICE, ACCOUNT) {
        Ok(()) => Ok(()),
        // Nothing saved: already disconnected.
        Err(e) if e.code() == -25300 => Ok(()),
        Err(e) => Err(anyhow!(tr!("cloud_keychain_failed", error = e))),
    }
}

/// Uploads an encrypted meeting; `ttl` in seconds, None = it never expires.
pub fn publish(envelope: &str, ttl: Option<u64>) -> Result<Published> {
    let c = connection()?;
    let mut req = agent()
        .post(&format!("{}/api/shares", c.url))
        .set("Authorization", &format!("Bearer {}", c.key))
        .set("Content-Type", "application/json");
    if let Some(ttl) = ttl {
        req = req.query("ttl", &ttl.to_string());
    }
    let reply: Value = req.send_string(envelope).map_err(failure)?.into_json()?;
    Ok(Published {
        id: reply["id"].as_str().ok_or_else(|| anyhow!(tr!("share_not_worker")))?.to_string(),
        url: reply["url"].as_str().ok_or_else(|| anyhow!(tr!("share_not_worker")))?.to_string(),
        expires_at: reply["expiresAt"].as_f64(),
    })
}

/// Withdraws a shared meeting: its link stops working.
pub fn revoke(id: &str) -> Result<()> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(anyhow!(tr!("share_not_worker")));
    }
    let c = connection()?;
    match agent().delete(&format!("{}/api/shares/{id}", c.url)).set("Authorization", &format!("Bearer {}", c.key)).call() {
        Ok(_) | Err(ureq::Error::Status(404, _)) => Ok(()),
        Err(e) => Err(failure(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_are_normalized() {
        assert_eq!(normalize(" murmur-share.quico.workers.dev/ ").unwrap(), "https://murmur-share.quico.workers.dev");
        assert_eq!(normalize("https://share.example.com").unwrap(), "https://share.example.com");
        assert!(normalize("http://share.example.com").is_err());
        assert!(normalize("https://share.example.com/path").is_err());
        assert!(normalize("localhost").is_err());
        assert_eq!(normalize("http://localhost:8787").unwrap(), "http://localhost:8787");
    }
}
