//! What signing in with OAuth in the browser needs on a desktop app, shared by Notion (notion.rs)
//! and Google Calendar (google.rs): PKCE, and a one-off server on this computer that the browser
//! comes back to with the code (a loopback redirect, RFC 8252).

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use anyhow::{Result, anyhow, bail};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use sha2::{Digest, Sha256};

/// How long the browser has to come back.
const SIGN_IN: Duration = Duration::from_secs(5 * 60);

/// A PKCE pair and the `state` that ties the browser's answer to this sign-in.
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
    pub state: String,
}

impl Pkce {
    pub fn new() -> Self {
        let mut random = [0u8; 32];
        crate::keychain::random_bytes(&mut random);
        let verifier = B64.encode(random);
        let challenge = B64.encode(Sha256::digest(verifier.as_bytes()));
        crate::keychain::random_bytes(&mut random[..16]);
        Self { verifier, challenge, state: B64.encode(&random[..16]) }
    }
}

/// The local server the browser comes back to, and its address for `redirect_uri`.
pub fn listen() -> Result<(TcpListener, String)> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    listener.set_nonblocking(true)?;
    let redirect = format!("http://127.0.0.1:{}/callback", listener.local_addr()?.port());
    Ok((listener, redirect))
}

/// The texts of one service, already translated.
pub struct Texts {
    pub cancelled: String,
    pub timed_out: String,
    /// The page the browser shows once it's back: it can be closed.
    pub signed_in_page: String,
    /// Takes the service's error code ("access_denied"…).
    pub refused: fn(&str) -> String,
}

/// Waits for the browser's redirect and answers it with a page that says it can be closed.
/// `issuer`: when the service sends `iss` (RFC 9207), it must be this one.
pub fn wait_for_code(listener: &TcpListener, state: &str, cancel: &AtomicBool, issuer: Option<&str>, texts: &Texts) -> Result<String> {
    let until = Instant::now() + SIGN_IN;
    loop {
        if cancel.load(Ordering::SeqCst) {
            bail!(texts.cancelled.clone());
        }
        if Instant::now() > until {
            bail!(texts.timed_out.clone());
        }
        let (mut stream, _) = match listener.accept() {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(200));
                continue;
            }
            Err(e) => return Err(e.into()),
        };
        stream.set_nonblocking(false)?;
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        let mut line = String::new();
        BufReader::new(&stream).read_line(&mut line)?;
        // "GET /callback?code=…&state=… HTTP/1.1"
        let target = line.split_whitespace().nth(1).unwrap_or("");
        let Some(query) = target.strip_prefix("/callback?") else {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
            continue;
        };
        let param = |k: &str| query.split('&').find_map(|kv| kv.strip_prefix(k).and_then(|v| v.strip_prefix('='))).map(dec);
        let body = format!(
            "<!doctype html><meta charset=utf-8><title>Murmur</title><p style=\"font:16px -apple-system,system-ui,sans-serif;margin:4em auto;max-width:28em\">{}</p>",
            texts.signed_in_page
        );
        let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        if param("state").as_deref() != Some(state) {
            bail!("OAuth: state mismatch");
        }
        if let Some(e) = param("error") {
            bail!((texts.refused)(&e));
        }
        if let (Some(expected), Some(iss)) = (issuer, param("iss")) {
            if iss != expected {
                bail!("OAuth: unexpected issuer");
            }
        }
        return param("code").ok_or_else(|| anyhow!("OAuth: no code"));
    }
}

/// Percent-encodes for a URL's query.
pub fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

pub fn dec(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = vec![];
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                out.push(u8::from_str_radix(&s[i + 1..i + 3], 16).unwrap_or(b'?'));
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_and_decodes() {
        assert_eq!(enc("http://127.0.0.1:5/callback"), "http%3A%2F%2F127.0.0.1%3A5%2Fcallback");
        assert_eq!(dec("a%2Fb+c"), "a/b c");
        let pkce = Pkce::new();
        assert_eq!(pkce.challenge, B64.encode(Sha256::digest(pkce.verifier.as_bytes())));
    }
}
