//! Shared links (docs/COMPARTIR.md): the user's own Cloudflare Worker (share/) keeps meetings that
//! the interface has already encrypted, and serves the page that decrypts them. Murmur publishes
//! that Worker itself with a Cloudflare API token the user creates (`setup`), or connects to one
//! published with share/setup.sh (`connect`). The Worker's address, its API key and the token
//! live in the macOS keychain; none of them reach the interface.

use std::time::{Duration, Instant};

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::i18n::tr;

const SERVICE: &str = "com.quicodomingo.murmur.share";
const ACCOUNT: &str = "worker";

/// The Worker Murmur publishes: share/src, built into the app.
const WORKER_NAME: &str = "murmur-share";
const KV_TITLE: &str = "murmur-shares";
const COMPATIBILITY_DATE: &str = "2026-10-01";
/// share/src/worker.js `VERSION`: an older Worker is republished before sharing.
const WORKER_VERSION: u64 = 3;
const MODULES: [(&str, &str, &str); 4] = [
    ("worker.js", "application/javascript+module", include_str!("../../../share/src/worker.js")),
    ("viewer.html", "text/plain", include_str!("../../../share/src/viewer.html")),
    ("viewer.css", "text/plain", include_str!("../../../share/src/viewer.css")),
    ("viewer-script.js", "text/plain", include_str!("../../../share/src/viewer-script.js")),
];
const CF_API: &str = "https://api.cloudflare.com/client/v4";

#[derive(Serialize, Deserialize)]
struct Connection {
    url: String,
    key: String,
    /// Set when Murmur published the Worker: what it needs to publish it again.
    #[serde(default)]
    cloudflare: Option<Cloudflare>,
}

#[derive(Serialize, Deserialize, Clone)]
struct Cloudflare {
    token: String,
    account: String,
    namespace: String,
}

/// What the settings show: the Worker's address and the key's last characters.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub url: String,
    pub hint: String,
    /// Murmur published it on the user's Cloudflare account (and keeps it up to date).
    pub managed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Published {
    pub id: String,
    /// The page's address, without the key (the interface adds it after the #).
    pub url: String,
    pub expires_at: Option<f64>,
}

#[derive(Serialize, Deserialize)]
pub struct CfAccount {
    pub id: String,
    pub name: String,
}

// --- Keychain --------------------------------------------------------------------------------

fn connection() -> Result<Connection> {
    let bytes = security_framework::passwords::get_generic_password(SERVICE, ACCOUNT).map_err(|_| anyhow!(tr!("share_not_connected")))?;
    serde_json::from_slice(&bytes).map_err(|_| anyhow!(tr!("share_not_connected")))
}

fn save(c: &Connection) -> Result<()> {
    security_framework::passwords::set_generic_password(SERVICE, ACCOUNT, &serde_json::to_vec(c)?)
        .map_err(|e| anyhow!(tr!("cloud_keychain_failed", error = e)))
}

fn status_of(c: &Connection) -> Status {
    let hint: String = c.key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    Status { url: c.url.clone(), hint, managed: c.cloudflare.is_some() }
}

pub fn status() -> Option<Status> {
    connection().ok().map(|c| status_of(&c))
}

pub fn disconnect() -> Result<()> {
    match security_framework::passwords::delete_generic_password(SERVICE, ACCOUNT) {
        Ok(()) => Ok(()),
        // Nothing saved: already disconnected.
        Err(e) if e.code() == -25300 => Ok(()),
        Err(e) => Err(anyhow!(tr!("cloud_keychain_failed", error = e))),
    }
}

/// `n` random letters and digits, from the system's secure generator.
fn random(n: usize) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut out = String::with_capacity(n);
    while out.len() < n {
        let mut bytes = [0u8; 32];
        security_framework::random::SecRandom::default().copy_bytes(&mut bytes).expect("system random generator");
        // 248 = 4 × 62: dropping bytes above it keeps every character equally likely.
        out.extend(bytes.iter().filter(|b| **b < 248).map(|b| ALPHABET[(*b % 62) as usize] as char).take(n - out.len()));
    }
    out
}

// --- The Worker ------------------------------------------------------------------------------

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
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(15)).timeout(Duration::from_secs(300)).build()
}

/// A failed call to the Worker as something the user can act on.
fn failure(e: ureq::Error) -> anyhow::Error {
    match e {
        ureq::Error::Status(401 | 403, _) => anyhow!(tr!("share_bad_key")),
        ureq::Error::Status(404 | 405, _) => anyhow!(tr!("share_not_worker")),
        ureq::Error::Status(413, _) => anyhow!(tr!("share_too_large")),
        ureq::Error::Status(code, _) => anyhow!(tr!("server_status", code = code)),
        ureq::Error::Transport(_) => anyhow!(tr!("cloud_offline")),
    }
}

/// The Worker's version (1 for the first one, which didn't say).
fn ping(url: &str, key: &str) -> Result<u64> {
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
    Ok(reply["version"].as_u64().unwrap_or(1))
}

/// Checks the address and key of a Worker published with setup.sh, and only then saves them.
pub fn connect(url: &str, key: &str) -> Result<Status> {
    let url = normalize(url)?;
    let key = key.trim().to_string();
    ping(&url, &key)?;
    let c = Connection { url, key, cloudflare: None };
    save(&c)?;
    Ok(status_of(&c))
}

/// Before sharing: a Worker Murmur published is brought up to this version of Murmur.
fn current() -> Result<Connection> {
    let c = connection()?;
    if let Some(cf) = &c.cloudflare
        && ping(&c.url, &c.key)? < WORKER_VERSION
    {
        upload_worker(cf, &c.key)?;
    }
    Ok(c)
}

/// Uploads an encrypted meeting; `ttl` in seconds, None = it never expires.
pub fn publish(envelope: &str, ttl: Option<u64>) -> Result<Published> {
    let c = current()?;
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

fn valid_id(id: &str) -> bool {
    id.len() == 12 && id.chars().all(|c| c.is_ascii_alphanumeric())
}

/// One encrypted file of a shared meeting (a screenshot, a piece of the audio).
pub fn upload_file(id: &str, name: &str, ttl: Option<u64>, bytes: &[u8]) -> Result<()> {
    let name_ok = !name.is_empty() && name.len() <= 21 && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.');
    if !valid_id(id) || !name_ok {
        return Err(anyhow!(tr!("share_not_worker")));
    }
    let c = connection()?;
    let mut req = agent()
        .put(&format!("{}/api/shares/{id}/{name}", c.url))
        .set("Authorization", &format!("Bearer {}", c.key))
        .set("Content-Type", "application/octet-stream");
    if let Some(ttl) = ttl {
        req = req.query("ttl", &ttl.to_string());
    }
    req.send_bytes(bytes).map_err(failure)?;
    Ok(())
}

/// Withdraws a shared meeting, files included: its link stops working.
pub fn revoke(id: &str) -> Result<()> {
    if !valid_id(id) {
        return Err(anyhow!(tr!("share_not_worker")));
    }
    let c = connection()?;
    match agent().delete(&format!("{}/api/shares/{id}", c.url)).set("Authorization", &format!("Bearer {}", c.key)).call() {
        Ok(_) | Err(ureq::Error::Status(404, _)) => Ok(()),
        Err(e) => Err(failure(e)),
    }
}

// --- Publishing it on Cloudflare -------------------------------------------------------------

/// Where the user creates the token: Cloudflare's form, filled in with what Murmur needs.
pub fn token_url() -> String {
    let permissions = r#"[{"key":"workers_scripts","type":"edit"},{"key":"workers_kv_storage","type":"edit"},{"key":"account_settings","type":"read"}]"#;
    let encode = |s: &str| {
        s.bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
                _ => format!("%{b:02X}"),
            })
            .collect::<String>()
    };
    format!(
        "https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys={}&accountId=*&zoneId=all&name={}",
        encode(permissions),
        encode("Murmur")
    )
}

/// A call to Cloudflare's API: its `result`, or its first error as something to act on.
fn cf(method: &str, path: &str, token: &str, body: Option<CfBody>) -> Result<Value> {
    let req = agent().request(method, &format!("{CF_API}{path}")).set("Authorization", &format!("Bearer {token}"));
    let response = match body {
        None => req.call(),
        Some(CfBody::Json(v)) => req.send_json(v),
        Some(CfBody::Multipart(boundary, bytes)) => req.set("Content-Type", &format!("multipart/form-data; boundary={boundary}")).send_bytes(&bytes),
    };
    let reply: Value = match response {
        Ok(r) => r.into_json()?,
        Err(ureq::Error::Status(401 | 403, _)) => return Err(anyhow!(tr!("share_cf_bad_token"))),
        Err(ureq::Error::Status(code, r)) => {
            let body: Value = r.into_json().unwrap_or(Value::Null);
            let message = body["errors"][0]["message"].as_str().unwrap_or("").to_string();
            return Err(if message.is_empty() { anyhow!(tr!("server_status", code = code)) } else { anyhow!(tr!("share_cf_failed", error = message)) });
        }
        Err(ureq::Error::Transport(_)) => return Err(anyhow!(tr!("cloud_offline"))),
    };
    Ok(reply["result"].clone())
}

enum CfBody {
    Json(Value),
    Multipart(String, Vec<u8>),
}

/// The Cloudflare accounts the token can use (usually one).
pub fn cf_accounts(token: &str) -> Result<Vec<CfAccount>> {
    let list = cf("GET", "/accounts?per_page=50", token.trim(), None)?;
    let accounts: Vec<CfAccount> = list
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| Some(CfAccount { id: a["id"].as_str()?.into(), name: a["name"].as_str().unwrap_or("").into() }))
        .collect();
    if accounts.is_empty() {
        return Err(anyhow!(tr!("share_cf_bad_token")));
    }
    Ok(accounts)
}

/// The Worker with its page, the KV store and the API key as a secret, in one upload.
fn upload_worker(cf_: &Cloudflare, key: &str) -> Result<()> {
    let boundary = format!("murmur{}", random(24));
    let metadata = json!({
        "main_module": "worker.js",
        "compatibility_date": COMPATIBILITY_DATE,
        "bindings": [
            { "type": "kv_namespace", "name": "SHARES", "namespace_id": cf_.namespace },
            { "type": "secret_text", "name": "API_KEY", "text": key },
        ],
    });
    let mut body = Vec::new();
    let mut part = |name: &str, content_type: &str, content: &[u8]| {
        body.extend_from_slice(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{name}\"\r\nContent-Type: {content_type}\r\n\r\n").as_bytes(),
        );
        body.extend_from_slice(content);
        body.extend_from_slice(b"\r\n");
    };
    part("metadata", "application/json", metadata.to_string().as_bytes());
    for (name, content_type, content) in MODULES {
        part(name, content_type, content.as_bytes());
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    cf("PUT", &format!("/accounts/{}/workers/scripts/{WORKER_NAME}", cf_.account), &cf_.token, Some(CfBody::Multipart(boundary, body)))?;
    Ok(())
}

/// The account's KV store for shared meetings, made the first time (or found from setup.sh).
fn kv_namespace(token: &str, account: &str) -> Result<String> {
    let list = cf("GET", &format!("/accounts/{account}/storage/kv/namespaces?per_page=100"), token, None)?;
    if let Some(id) = list.as_array().into_iter().flatten().find(|n| n["title"] == KV_TITLE).and_then(|n| n["id"].as_str()) {
        return Ok(id.to_string());
    }
    let made = cf("POST", &format!("/accounts/{account}/storage/kv/namespaces"), token, Some(CfBody::Json(json!({ "title": KV_TITLE }))))?;
    made["id"].as_str().map(str::to_string).ok_or_else(|| anyhow!(tr!("share_not_worker")))
}

/// The account's workers.dev name ("quico" in murmur-share.quico.workers.dev), made if it has none.
fn workers_subdomain(token: &str, account: &str, account_name: &str) -> Result<String> {
    if let Ok(found) = cf("GET", &format!("/accounts/{account}/workers/subdomain"), token, None)
        && let Some(name) = found["subdomain"].as_str()
    {
        return Ok(name.to_string());
    }
    let base: String = account_name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
        .chars()
        .take(24)
        .collect();
    let base = if base.is_empty() { "murmur".to_string() } else { base };
    // The name is global to workers.dev: if it's taken, add a few letters.
    for name in [base.clone(), format!("{base}-{}", random(4).to_lowercase())] {
        if let Ok(made) = cf("PUT", &format!("/accounts/{account}/workers/subdomain"), token, Some(CfBody::Json(json!({ "subdomain": name })))) {
            return Ok(made["subdomain"].as_str().unwrap_or(&name).to_string());
        }
    }
    Err(anyhow!(tr!("share_cf_subdomain")))
}

/// Publishes the Worker on the user's account and connects Murmur to it. `step` reports
/// progress: "storage", "worker", "address", "check". Ok(false): published, but the new
/// workers.dev address doesn't answer yet (it can take a few minutes the first time).
pub fn setup(token: &str, account: &CfAccount, step: impl Fn(&str)) -> Result<(Status, bool)> {
    let token = token.trim().to_string();
    step("storage");
    let namespace = kv_namespace(&token, &account.id)?;
    let cf_ = Cloudflare { token: token.clone(), account: account.id.clone(), namespace };
    // A new key each time: setting it up again also rotates it.
    let key = format!("mm_{}", random(40));
    step("worker");
    upload_worker(&cf_, &key)?;
    step("address");
    let subdomain = workers_subdomain(&token, &account.id, &account.name)?;
    cf(
        "POST",
        &format!("/accounts/{}/workers/scripts/{WORKER_NAME}/subdomain", account.id),
        &token,
        Some(CfBody::Json(json!({ "enabled": true, "previews_enabled": false }))),
    )?;
    let c = Connection { url: format!("https://{WORKER_NAME}.{subdomain}.workers.dev"), key, cloudflare: Some(cf_) };
    save(&c)?;
    step("check");
    // A new Worker takes a moment to answer, and a new workers.dev name longer.
    let t0 = Instant::now();
    let ready = loop {
        if ping(&c.url, &c.key).is_ok() {
            break true;
        }
        if t0.elapsed() > Duration::from_secs(60) {
            break false;
        }
        std::thread::sleep(Duration::from_secs(3));
    };
    Ok((status_of(&c), ready))
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

    #[test]
    fn the_bundled_worker_is_this_version() {
        assert!(MODULES[0].2.contains(&format!("const VERSION = {WORKER_VERSION};")));
    }

    #[test]
    fn random_strings() {
        let a = random(40);
        assert_eq!(a.len(), 40);
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric()));
        assert_ne!(a, random(40));
    }

    #[test]
    fn token_link_asks_for_workers_and_kv() {
        let url = token_url();
        assert!(url.starts_with("https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22"));
        assert!(url.ends_with("&name=Murmur"));
    }
}
