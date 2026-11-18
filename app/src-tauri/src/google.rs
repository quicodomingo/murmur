//! Google Calendar (Settings › Calendari), on every system: "Inicia la sessió" signs in in the
//! browser with OAuth (PKCE and a loopback redirect, oauth.rs) and asks only to read the list of
//! calendars and their events. The grant (refresh token and the account's address) lives in the
//! keychain. Murmur reads the events near now, for the alert and the meeting's title and guests,
//! straight from Google to this computer, and never writes anything.
//!
//! The OAuth client is baked in at build time (build.rs): without it there's no Google sign-in.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use anyhow::{Result, anyhow, bail};
use base64::Engine as _;
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::calendar::{Attendee, CalendarInfo, EventInfo, platform};
use crate::i18n::tr;
use crate::oauth::{self, enc};

const AUTHORIZE: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN: &str = "https://oauth2.googleapis.com/token";
const REVOKE: &str = "https://oauth2.googleapis.com/revoke";
const API: &str = "https://www.googleapis.com/calendar/v3";
const CALENDARS_SCOPE: &str = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const EVENTS_SCOPE: &str = "https://www.googleapis.com/auth/calendar.events.readonly";
const SERVICE: &str = "com.quicodomingo.murmur.calendar";
const ACCOUNT: &str = "google";
/// Refresh this long before the access token expires.
const MARGIN_S: f64 = 300.0;
/// How long the calendars and the events read are used before asking Google again.
const FRESH: Duration = Duration::from_secs(5 * 60);
/// Each read of events also takes this much before and after what was asked, so that the next
/// asks (the alert's, every minute, always near now) come from what's kept.
const SPAN_BEFORE_MS: f64 = 3600.0 * 1000.0;
const SPAN_AFTER_MS: f64 = 24.0 * 3600.0 * 1000.0;

/// The OAuth client, if this build has one.
fn client() -> Option<(&'static str, &'static str)> {
    Some((option_env!("MURMUR_GOOGLE_CLIENT_ID")?, option_env!("MURMUR_GOOGLE_CLIENT_SECRET")?))
}

/// Whether this build can sign in with Google.
pub fn available() -> bool {
    client().is_some()
}

/// What's kept in the keychain.
#[derive(Clone, Serialize, Deserialize)]
struct Grant {
    access_token: String,
    refresh_token: String,
    /// Seconds since the epoch.
    expires_at: f64,
    email: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub available: bool,
    pub connected: bool,
    pub email: Option<String>,
    /// Why the last read failed, or that the session ended and it has to sign in again.
    pub error: Option<String>,
}

struct Cached<T> {
    at: Instant,
    value: T,
}

struct Events {
    from: f64,
    to: f64,
    events: Vec<EventInfo>,
}

static REFRESH: Mutex<()> = Mutex::new(());
static CANCEL: AtomicBool = AtomicBool::new(false);
static ERROR: Mutex<Option<String>> = Mutex::new(None);
static CALENDARS: Mutex<Option<Cached<Vec<CalendarInfo>>>> = Mutex::new(None);
static EVENTS: Mutex<Option<HashMap<String, Cached<Events>>>> = Mutex::new(None);

fn now() -> f64 {
    Utc::now().timestamp_millis() as f64 / 1000.0
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(10)).timeout(Duration::from_secs(30)).build()
}

fn load() -> Option<Grant> {
    serde_json::from_slice(&crate::keychain::get(SERVICE, ACCOUNT)?).ok()
}

fn store(grant: &Grant) -> Result<()> {
    crate::keychain::set(SERVICE, ACCOUNT, &serde_json::to_vec(grant)?)
}

fn forget() {
    let _ = crate::keychain::delete(SERVICE, ACCOUNT);
    *CALENDARS.lock().unwrap() = None;
    *EVENTS.lock().unwrap() = None;
}

fn set_error(error: Option<String>) {
    *ERROR.lock().unwrap() = error;
}

pub fn status() -> Status {
    let grant = load();
    Status { available: available(), connected: grant.is_some(), email: grant.map(|g| g.email), error: ERROR.lock().unwrap().clone() }
}

/// Stops a sign-in waiting for the browser.
pub fn cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// Forgets the account here and tells Google to end Murmur's access (if it can be reached).
pub fn disconnect() -> Result<()> {
    if let Some(grant) = load() {
        if let Err(e) = agent().post(REVOKE).send_form(&[("token", &grant.refresh_token)]) {
            log::warn!("Google: couldn't revoke the access: {e}");
        }
    }
    forget();
    set_error(None);
    log::info!("Google Calendar disconnected");
    Ok(())
}

fn http_error(e: ureq::Error) -> anyhow::Error {
    match e {
        ureq::Error::Status(code, r) => {
            let body: Value = r.into_json().unwrap_or(Value::Null);
            let what = body["error_description"].as_str().or(body["error"]["message"].as_str()).or(body["error"].as_str()).unwrap_or("").to_string();
            anyhow!("Google {code} {what}")
        }
        ureq::Error::Transport(_) => anyhow!(tr!("ical_offline")),
    }
}

/// "Inicia la sessió": signs in in the browser and keeps the grant. Returns the account's address.
pub fn connect(open: impl Fn(&str) -> Result<()>) -> Result<String> {
    let (client_id, secret) = client().ok_or_else(|| anyhow!("Google: no OAuth client in this build"))?;
    CANCEL.store(false, Ordering::SeqCst);
    let (listener, redirect) = oauth::listen()?;
    let pkce = oauth::Pkce::new();
    let scope = format!("openid email {CALENDARS_SCOPE} {EVENTS_SCOPE}");
    // access_type=offline and prompt=consent: a refresh token every time, also when signing in again.
    let url = format!(
        "{AUTHORIZE}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent",
        enc(client_id),
        enc(&redirect),
        enc(&scope),
        pkce.state,
        pkce.challenge
    );
    open(&url)?;
    let texts = oauth::Texts {
        cancelled: tr!("google_cancelled").into(),
        timed_out: tr!("google_timed_out").into(),
        signed_in_page: tr!("google_signed_in_page").into(),
        refused: |e| tr!("google_refused", error = e),
    };
    let code = oauth::wait_for_code(&listener, &pkce.state, &CANCEL, None, &texts)?;
    let tok: Value = agent()
        .post(TOKEN)
        .send_form(&[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", &redirect),
            ("client_id", client_id),
            ("client_secret", secret),
            ("code_verifier", &pkce.verifier),
        ])
        .map_err(http_error)?
        .into_json()?;
    // Google lets the person untick each permission on its page: without both, nothing to read.
    let granted = tok["scope"].as_str().unwrap_or("");
    if !granted.split(' ').any(|s| s == CALENDARS_SCOPE) || !granted.split(' ').any(|s| s == EVENTS_SCOPE) {
        if let Some(t) = tok["access_token"].as_str() {
            let _ = agent().post(REVOKE).send_form(&[("token", t)]);
        }
        bail!(tr!("google_missing_scope"));
    }
    let grant = Grant {
        access_token: tok["access_token"].as_str().ok_or_else(|| anyhow!("Google: no token"))?.into(),
        refresh_token: tok["refresh_token"].as_str().ok_or_else(|| anyhow!("Google: no refresh token"))?.into(),
        expires_at: now() + tok["expires_in"].as_f64().unwrap_or(3600.0),
        email: tok["id_token"].as_str().and_then(email_in).unwrap_or_else(|| "Google".into()),
    };
    store(&grant)?;
    *CALENDARS.lock().unwrap() = None;
    *EVENTS.lock().unwrap() = None;
    set_error(None);
    log::info!("Google Calendar connected");
    Ok(grant.email)
}

/// The address in an ID token. It comes straight from Google's token endpoint over TLS, so its
/// signature doesn't need checking (OpenID Connect Core, 3.1.3.7).
fn email_in(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let claims: Value = serde_json::from_slice(&bytes).ok()?;
    claims["email"].as_str().map(str::to_lowercase)
}

/// A valid access token, refreshing it first if it's about to expire.
fn token() -> Result<String> {
    let _one = REFRESH.lock().unwrap();
    let mut grant = load().ok_or_else(|| anyhow!("Google: not connected"))?;
    if grant.expires_at - now() > MARGIN_S {
        return Ok(grant.access_token);
    }
    let (client_id, secret) = client().ok_or_else(|| anyhow!("Google: no OAuth client in this build"))?;
    let res = agent().post(TOKEN).send_form(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", &grant.refresh_token),
        ("client_id", client_id),
        ("client_secret", secret),
    ]);
    let tok: Value = match res {
        Ok(r) => r.into_json()?,
        // The session ended (revoked in the Google account, the password changed, or a week
        // passed while the app is in testing): sign in again.
        Err(ureq::Error::Status(400 | 401, _)) => {
            log::warn!("Google: the session ended; it has to sign in again");
            forget();
            let message = tr!("google_reconnect").to_string();
            set_error(Some(message.clone()));
            bail!(message);
        }
        Err(e) => return Err(http_error(e)),
    };
    grant.access_token = tok["access_token"].as_str().ok_or_else(|| anyhow!("Google: no token"))?.into();
    grant.expires_at = now() + tok["expires_in"].as_f64().unwrap_or(3600.0);
    store(&grant)?;
    Ok(grant.access_token)
}

fn get(url: &str) -> Result<Value> {
    let token = token()?;
    agent().get(url).set("Authorization", &format!("Bearer {token}")).call().map_err(http_error)?.into_json().map_err(Into::into)
}

/// The account's calendars, as the picker lists them. Empty if it isn't connected.
pub fn calendars() -> Vec<CalendarInfo> {
    let Some(grant) = load() else { return vec![] };
    if let Some(c) = CALENDARS.lock().unwrap().as_ref().filter(|c| c.at.elapsed() < FRESH) {
        return c.value.clone();
    }
    let read = get(&format!("{API}/users/me/calendarList?fields=items(id,summary,summaryOverride,backgroundColor,primary)"));
    let list: Vec<CalendarInfo> = match read {
        Ok(json) => {
            set_error(None);
            let mut items: Vec<&Value> = json["items"].as_array().map(|a| a.iter().collect()).unwrap_or_default();
            // The person's own calendar first, as Google shows it.
            items.sort_by_key(|c| !c["primary"].as_bool().unwrap_or(false));
            items
                .into_iter()
                .filter_map(|c| {
                    let id = c["id"].as_str()?;
                    let title = c["summaryOverride"].as_str().or(c["summary"].as_str()).unwrap_or(id);
                    Some(CalendarInfo { id: format!("google:{id}"), title: title.into(), account: grant.email.clone(), color: c["backgroundColor"].as_str().unwrap_or("#4F7DF3").into() })
                })
                .collect()
        }
        Err(e) => {
            log::warn!("Google: couldn't read the calendars: {e:#}");
            if load().is_some() {
                set_error(Some(format!("{e:#}")));
            }
            // The last list read, if there is one.
            return CALENDARS.lock().unwrap().as_ref().map(|c| c.value.clone()).unwrap_or_default();
        }
    };
    *CALENDARS.lock().unwrap() = Some(Cached { at: Instant::now(), value: list.clone() });
    list
}

/// The events between two times (ms since 1970) in the account's calendars among `ids` (all if `None`).
pub fn events(from_ms: f64, to_ms: f64, ids: Option<&[String]>) -> Vec<EventInfo> {
    let mut out = vec![];
    for calendar in calendars() {
        if ids.is_some_and(|ids| !ids.contains(&calendar.id)) {
            continue;
        }
        out.extend(calendar_events(&calendar.id, from_ms, to_ms).into_iter().filter(|e| e.end > from_ms && e.start < to_ms));
    }
    out
}

fn calendar_events(id: &str, from_ms: f64, to_ms: f64) -> Vec<EventInfo> {
    let kept = |fresh_only: bool| {
        EVENTS.lock().unwrap().as_ref().and_then(|m| m.get(id)).filter(|c| (!fresh_only || c.at.elapsed() < FRESH) && c.value.from <= from_ms && c.value.to >= to_ms).map(|c| c.value.events.clone())
    };
    if let Some(events) = kept(true) {
        return events;
    }
    let (from, to) = (from_ms - SPAN_BEFORE_MS, to_ms + SPAN_AFTER_MS);
    let time = |ms: f64| DateTime::<Utc>::from_timestamp_millis(ms as i64).unwrap_or_default().to_rfc3339_opts(SecondsFormat::Secs, true);
    let google_id = id.strip_prefix("google:").unwrap_or(id);
    let url = format!(
        "{API}/calendars/{}/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin={}&timeMax={}&fields=items(id,status,eventType,summary,start,end,location,description,hangoutLink,attendees(email,displayName,self,responseStatus),conferenceData(entryPoints(uri)))",
        enc(google_id),
        enc(&time(from)),
        enc(&time(to))
    );
    match get(&url) {
        Ok(json) => {
            let events: Vec<EventInfo> = json["items"].as_array().map(|items| items.iter().filter_map(|e| event_info(e, id)).collect()).unwrap_or_default();
            EVENTS.lock().unwrap().get_or_insert_with(HashMap::new).insert(id.to_string(), Cached { at: Instant::now(), value: Events { from, to, events: events.clone() } });
            events
        }
        Err(e) => {
            log::warn!("Google: couldn't read a calendar's events: {e:#}");
            if load().is_some() {
                set_error(Some(format!("{e:#}")));
            }
            kept(false).unwrap_or_default()
        }
    }
}

/// Instant of a Google `start` or `end` (`dateTime`; all-day events only have `date`).
fn instant(t: &Value) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(t["dateTime"].as_str()?).ok().map(|d| d.with_timezone(&Utc))
}

/// One event as the rest of Murmur sees it; `None` for the cancelled, the declined, the all-day
/// ones (not meetings, as with the iCal links) and the ones that aren't time with others (working
/// location, out of office, focus time).
fn event_info(e: &Value, calendar_id: &str) -> Option<EventInfo> {
    if e["status"] == "cancelled" || matches!(e["eventType"].as_str(), Some("workingLocation" | "outOfOffice" | "focusTime")) {
        return None;
    }
    let people = e["attendees"].as_array().cloned().unwrap_or_default();
    if people.iter().any(|a| a["self"] == true && a["responseStatus"] == "declined") {
        return None;
    }
    let start = instant(&e["start"])?;
    let end = instant(&e["end"])?;
    let attendees = people
        .iter()
        .map(|a| Attendee {
            name: a["displayName"].as_str().map(str::to_string),
            email: a["email"].as_str().map(str::to_lowercase),
            me: a["self"] == true,
        })
        .collect();
    let links: Vec<&str> = e["conferenceData"]["entryPoints"].as_array().map(|p| p.iter().filter_map(|p| p["uri"].as_str()).collect()).unwrap_or_default();
    let text = [e["hangoutLink"].as_str().unwrap_or(""), &links.join(" "), e["location"].as_str().unwrap_or(""), e["description"].as_str().unwrap_or("")].join(" ");
    let title = e["summary"].as_str().unwrap_or("").trim();
    Some(EventInfo {
        id: format!("google:{}", e["id"].as_str()?),
        calendar_id: calendar_id.to_string(),
        title: if title.is_empty() { tr!("calendar_untitled").to_string() } else { title.to_string() },
        start: start.timestamp_millis() as f64,
        end: end.timestamp_millis() as f64,
        attendees,
        platform: platform(&text).map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_an_event() {
        let e = json!({
            "id": "abc", "status": "confirmed", "summary": "Revisió del pressupost",
            "start": { "dateTime": "2026-11-18T10:00:00+01:00" }, "end": { "dateTime": "2026-11-18T10:30:00+01:00" },
            "hangoutLink": "https://meet.google.com/abc-defg-hij",
            "attendees": [
                { "email": "Marta@estudinord.cat", "self": true, "responseStatus": "accepted" },
                { "email": "jordi@example.com", "displayName": "Jordi" }
            ]
        });
        let info = event_info(&e, "google:primary").unwrap();
        assert_eq!(info.title, "Revisió del pressupost");
        assert_eq!(info.start, DateTime::parse_from_rfc3339("2026-11-18T09:00:00Z").unwrap().timestamp_millis() as f64);
        assert_eq!(info.end - info.start, 30.0 * 60_000.0);
        assert_eq!(info.platform.as_deref(), Some("Google Meet"));
        assert!(info.attendees[0].me && info.attendees[0].email.as_deref() == Some("marta@estudinord.cat"));
        assert_eq!(info.attendees[1].name.as_deref(), Some("Jordi"));
        assert!(info.is_meeting());
    }

    #[test]
    fn skips_what_isnt_a_meeting_to_go_to() {
        let at = json!({ "dateTime": "2026-11-18T10:00:00Z" });
        let declined = json!({ "id": "d", "start": at, "end": at, "attendees": [{ "self": true, "responseStatus": "declined" }] });
        let cancelled = json!({ "id": "c", "status": "cancelled", "start": at, "end": at });
        let away = json!({ "id": "o", "eventType": "outOfOffice", "start": at, "end": at });
        for e in [declined, cancelled, away] {
            assert!(event_info(&e, "google:primary").is_none());
        }
        let all_day = json!({ "id": "a", "start": { "date": "2026-11-18" }, "end": { "date": "2026-11-19" } });
        assert!(event_info(&all_day, "google:primary").is_none());
    }

    #[test]
    fn the_address_in_the_id_token() {
        let claims = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(br#"{"email":"Marta@EstudiNord.cat","email_verified":true}"#);
        assert_eq!(email_in(&format!("eyJhbGciOiJSUzI1NiJ9.{claims}.sig")).as_deref(), Some("marta@estudinord.cat"));
        assert_eq!(email_in("not-a-token"), None);
    }
}
