//! Calendars from an iCal link (Settings › Calendari › Enllaç iCal): Google's "secret address in
//! iCal format", Outlook's published calendar, iCloud's public link… Murmur reads them every few
//! minutes and only reads them. The links are secret (whoever has one sees the calendar), so the
//! list lives in the keychain. Repeating events are expanded with `rrule`; Outlook's Windows time
//! zone names ("Romance Standard Time") are turned into IANA ones.

use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use anyhow::{Result, anyhow};
use chrono::{DateTime, Local, NaiveDateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};

use crate::calendar::{Attendee, CalendarInfo, EventInfo, platform};
use crate::i18n::tr;

const SERVICE: &str = "com.quicodomingo.murmur.calendar";
const ACCOUNT: &str = "ical";
/// A feed is read again after this long.
const FRESH: Duration = Duration::from_secs(5 * 60);
/// Occurrences of one repeating event, at most, in a window.
const MAX_OCCURRENCES: u16 = 200;
/// Colours for the feeds' calendars, in order (they have none of their own).
const COLORS: [&str; 6] = ["#4F7DF3", "#E5484D", "#30A46C", "#F5A524", "#8E4EC6", "#12A594"];

/// A saved link: its id (stable, for the calendar ids), the calendar's name and the URL.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Feed {
    pub id: String,
    pub name: String,
    pub url: String,
}

/// What the interface sees of a feed: never its URL (it's the secret), only where it's from.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedInfo {
    pub id: String,
    pub name: String,
    pub host: String,
    /// When it was last read (ms since 1970), if it has been.
    pub read_at: Option<f64>,
    /// Why the last read failed, if it did.
    pub error: Option<String>,
}

struct Cached {
    at: Instant,
    read_at: f64,
    events: Vec<Vevent>,
    error: Option<String>,
}

static CACHE: Mutex<Option<HashMap<String, Cached>>> = Mutex::new(None);

// --- The saved links ----------------------------------------------------------------------

fn feeds() -> Vec<Feed> {
    crate::keychain::get(SERVICE, ACCOUNT).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save(feeds: &[Feed]) -> Result<()> {
    if feeds.is_empty() {
        return crate::keychain::delete(SERVICE, ACCOUNT);
    }
    crate::keychain::set(SERVICE, ACCOUNT, &serde_json::to_vec(feeds)?)
}

fn host(url: &str) -> String {
    url.split("://").nth(1).unwrap_or(url).split(['/', '?']).next().unwrap_or("").to_string()
}

pub fn list() -> Vec<FeedInfo> {
    let cache = CACHE.lock().unwrap();
    feeds()
        .into_iter()
        .map(|f| {
            let c = cache.as_ref().and_then(|c| c.get(&f.id));
            FeedInfo { host: host(&f.url), read_at: c.map(|c| c.read_at), error: c.and_then(|c| c.error.clone()), id: f.id, name: f.name }
        })
        .collect()
}

/// Reads the link once to check it's a calendar and take its name, then saves it.
pub fn add(url: &str) -> Result<FeedInfo> {
    let url = url.trim().replacen("webcal://", "https://", 1);
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err(anyhow!(tr!("ical_not_a_link")));
    }
    let text = fetch(&url)?;
    let parsed = parse(&text);
    let mut list = feeds();
    if list.iter().any(|f| f.url == url) {
        return Err(anyhow!(tr!("ical_already_added")));
    }
    let id = format!("{:016x}", rand_id());
    let name = parsed.name.unwrap_or_else(|| host(&url));
    list.push(Feed { id: id.clone(), name: name.clone(), url: url.clone() });
    save(&list)?;
    let now = now_ms();
    CACHE.lock().unwrap().get_or_insert_with(HashMap::new).insert(id.clone(), Cached { at: Instant::now(), read_at: now, events: parsed.events, error: None });
    log::info!("iCal link added ({})", host(&url));
    Ok(FeedInfo { id, name, host: host(&url), read_at: Some(now), error: None })
}

pub fn remove(id: &str) -> Result<()> {
    let list: Vec<Feed> = feeds().into_iter().filter(|f| f.id != id).collect();
    save(&list)?;
    if let Some(c) = CACHE.lock().unwrap().as_mut() {
        c.remove(id);
    }
    Ok(())
}

fn rand_id() -> u64 {
    let mut b = [0u8; 8];
    crate::keychain::random_bytes(&mut b);
    u64::from_le_bytes(b)
}

fn now_ms() -> f64 {
    Utc::now().timestamp_millis() as f64
}

fn fetch(url: &str) -> Result<String> {
    let agent = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(10)).timeout(Duration::from_secs(30)).build();
    let text = agent.get(url).call().map_err(|e| match e {
        ureq::Error::Status(404 | 401 | 403, _) => anyhow!(tr!("ical_not_found")),
        ureq::Error::Status(code, _) => anyhow!(tr!("server_status", code = code)),
        ureq::Error::Transport(_) => anyhow!(tr!("ical_offline")),
    })?;
    let text = text.into_string()?;
    if !text.contains("BEGIN:VCALENDAR") {
        return Err(anyhow!(tr!("ical_not_a_calendar")));
    }
    Ok(text)
}

/// Each feed's events, read again if they're older than `FRESH` (a failed read keeps the last ones).
fn events_by_feed() -> Vec<(usize, Feed, Vec<Vevent>)> {
    let list = feeds();
    let mut out = vec![];
    for (i, feed) in list.into_iter().enumerate() {
        let stale = CACHE.lock().unwrap().as_ref().and_then(|c| c.get(&feed.id)).is_none_or(|c| c.at.elapsed() > FRESH);
        if stale {
            let read = fetch(&feed.url).map(|t| parse(&t).events);
            let mut cache = CACHE.lock().unwrap();
            let cache = cache.get_or_insert_with(HashMap::new);
            match read {
                Ok(events) => {
                    cache.insert(feed.id.clone(), Cached { at: Instant::now(), read_at: now_ms(), events, error: None });
                }
                Err(e) => {
                    log::warn!("iCal link ({}): {e:#}", host(&feed.url));
                    let old = cache.remove(&feed.id);
                    let (events, read_at) = old.map(|c| (c.events, c.read_at)).unwrap_or_default();
                    cache.insert(feed.id.clone(), Cached { at: Instant::now(), read_at, events, error: Some(format!("{e:#}")) });
                }
            }
        }
        let events = CACHE.lock().unwrap().as_ref().and_then(|c| c.get(&feed.id)).map(|c| c.events.clone()).unwrap_or_default();
        out.push((i, feed, events));
    }
    out
}

pub fn calendars() -> Vec<CalendarInfo> {
    feeds()
        .into_iter()
        .enumerate()
        .map(|(i, f)| CalendarInfo { id: format!("ics:{}", f.id), title: f.name, account: host(&f.url), color: COLORS[i % COLORS.len()].into() })
        .collect()
}

/// The events between two times (ms since 1970) in the feeds among `ids` (all if `None`).
pub fn events(from_ms: f64, to_ms: f64, ids: Option<&[String]>) -> Vec<EventInfo> {
    events_by_feed()
        .into_iter()
        .filter(|(_, f, _)| ids.is_none_or(|ids| ids.iter().any(|i| i == &format!("ics:{}", f.id))))
        .flat_map(|(_, f, events)| expand(&events, &format!("ics:{}", f.id), owner(&f.name).as_deref(), from_ms, to_ms))
        .collect()
}

/// Google names a person's main calendar after their address: the attendee with it is the user.
fn owner(name: &str) -> Option<String> {
    name.contains('@').then(|| name.to_lowercase())
}

/// For `examples/ics_probe.rs`: a feed's name and its occurrences in a window.
pub fn probe(text: &str, from_ms: f64, to_ms: f64) -> (Option<String>, Vec<EventInfo>) {
    let p = parse(text);
    let events = expand(&p.events, "ics:probe", None, from_ms, to_ms);
    (p.name, events)
}

// --- Parsing --------------------------------------------------------------------------------

/// A line of an iCal file: `NAME;PARAM=value;…:value`.
#[derive(Debug, Clone)]
struct Prop {
    name: String,
    params: Vec<(String, String)>,
    value: String,
}

impl Prop {
    fn param(&self, name: &str) -> Option<&str> {
        self.params.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

/// One VEVENT, kept as its lines: times are worked out when a window is asked for.
#[derive(Debug, Clone, Default)]
struct Vevent {
    props: Vec<Prop>,
}

impl Vevent {
    fn get(&self, name: &str) -> Option<&Prop> {
        self.props.iter().find(|p| p.name == name)
    }
    fn all(&self, name: &str) -> impl Iterator<Item = &Prop> {
        self.props.iter().filter(move |p| p.name == name)
    }
    fn text(&self, name: &str) -> String {
        self.get(name).map(|p| unescape(&p.value)).unwrap_or_default()
    }
}

struct Parsed {
    name: Option<String>,
    events: Vec<Vevent>,
}

fn parse(text: &str) -> Parsed {
    // Long lines are folded: a line starting with a space or a tab goes on the one before.
    let mut lines: Vec<String> = vec![];
    for raw in text.split('\n') {
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        if let Some(rest) = raw.strip_prefix([' ', '\t']) {
            if let Some(last) = lines.last_mut() {
                last.push_str(rest);
                continue;
            }
        }
        lines.push(raw.to_string());
    }
    let mut name = None;
    let mut events = vec![];
    let mut current: Option<Vevent> = None;
    let mut depth = 0usize; // VALARM and the like inside an event
    for line in lines {
        let Some(prop) = prop(&line) else { continue };
        match (prop.name.as_str(), prop.value.to_ascii_uppercase().as_str()) {
            ("BEGIN", "VEVENT") => current = Some(Vevent::default()),
            ("END", "VEVENT") => events.extend(current.take()),
            ("BEGIN", _) if current.is_some() => depth += 1,
            ("END", _) if current.is_some() => depth = depth.saturating_sub(1),
            ("X-WR-CALNAME", _) if current.is_none() => name = Some(unescape(&prop.value)),
            _ => {
                if let Some(ev) = current.as_mut().filter(|_| depth == 0) {
                    ev.props.push(prop);
                }
            }
        }
    }
    Parsed { name: name.filter(|n| !n.trim().is_empty()), events }
}

fn prop(line: &str) -> Option<Prop> {
    // The value starts at the first colon outside quotes.
    let mut quoted = false;
    let at = line.char_indices().find(|&(_, c)| {
        if c == '"' {
            quoted = !quoted;
        }
        c == ':' && !quoted
    })?.0;
    let (head, value) = (&line[..at], &line[at + 1..]);
    let mut parts = vec![];
    let mut cur = String::new();
    let mut quoted = false;
    for c in head.chars() {
        match c {
            '"' => quoted = !quoted,
            ';' if !quoted => parts.push(std::mem::take(&mut cur)),
            _ => cur.push(c),
        }
    }
    parts.push(cur);
    let name = parts.remove(0).to_ascii_uppercase();
    let params = parts.into_iter().filter_map(|p| p.split_once('=').map(|(k, v)| (k.to_ascii_uppercase(), v.to_string()))).collect();
    Some(Prop { name, params, value: value.to_string() })
}

fn unescape(s: &str) -> String {
    s.replace("\\n", "\n").replace("\\N", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")
}

// --- Times -----------------------------------------------------------------------------------

/// Windows' names for the zones Outlook writes, to IANA's (the most common; others fall back to
/// the computer's own zone).
const WINDOWS_ZONES: [(&str, &str); 24] = [
    ("Romance Standard Time", "Europe/Paris"),
    ("W. Europe Standard Time", "Europe/Berlin"),
    ("Central Europe Standard Time", "Europe/Budapest"),
    ("Central European Standard Time", "Europe/Warsaw"),
    ("GMT Standard Time", "Europe/London"),
    ("Greenwich Standard Time", "Atlantic/Reykjavik"),
    ("GTB Standard Time", "Europe/Bucharest"),
    ("FLE Standard Time", "Europe/Kiev"),
    ("E. Europe Standard Time", "Europe/Chisinau"),
    ("Russian Standard Time", "Europe/Moscow"),
    ("Morocco Standard Time", "Africa/Casablanca"),
    ("Canary Standard Time", "Atlantic/Canary"),
    ("UTC", "UTC"),
    ("Coordinated Universal Time", "UTC"),
    ("Eastern Standard Time", "America/New_York"),
    ("Central Standard Time", "America/Chicago"),
    ("Mountain Standard Time", "America/Denver"),
    ("Pacific Standard Time", "America/Los_Angeles"),
    ("Central Standard Time (Mexico)", "America/Mexico_City"),
    ("SA Pacific Standard Time", "America/Bogota"),
    ("Argentina Standard Time", "America/Argentina/Buenos_Aires"),
    ("E. South America Standard Time", "America/Sao_Paulo"),
    ("Tokyo Standard Time", "Asia/Tokyo"),
    ("India Standard Time", "Asia/Kolkata"),
];

/// A TZID as IANA knows it, if it can be told.
fn zone(tzid: &str) -> Option<chrono_tz::Tz> {
    let tzid = tzid.trim_matches('"');
    chrono_tz::Tz::from_str(tzid)
        .ok()
        .or_else(|| WINDOWS_ZONES.iter().find(|(w, _)| w.eq_ignore_ascii_case(tzid)).and_then(|(_, iana)| chrono_tz::Tz::from_str(iana).ok()))
        // "/mozilla.org/20050126_1/Europe/Madrid" and the like.
        .or_else(|| tzid.rsplit_once('/').and_then(|(rest, city)| rest.rsplit_once('/').map(|(_, area)| format!("{area}/{city}"))).and_then(|z| chrono_tz::Tz::from_str(&z).ok()))
}

/// A time property as UTC; None for all-day ones (a date, not a meeting) or what can't be read.
fn instant(p: &Prop) -> Option<DateTime<Utc>> {
    if p.param("VALUE").is_some_and(|v| v.eq_ignore_ascii_case("DATE")) || p.value.len() == 8 {
        return None;
    }
    let v = p.value.trim();
    if let Some(utc) = v.strip_suffix('Z') {
        return NaiveDateTime::parse_from_str(utc, "%Y%m%dT%H%M%S").ok().map(|n| Utc.from_utc_datetime(&n));
    }
    let naive = NaiveDateTime::parse_from_str(v, "%Y%m%dT%H%M%S").ok()?;
    match p.param("TZID").and_then(zone) {
        Some(tz) => tz.from_local_datetime(&naive).earliest().map(|d| d.with_timezone(&Utc)),
        None => Local.from_local_datetime(&naive).earliest().map(|d| d.with_timezone(&Utc)),
    }
}

/// "PT1H30M", "P1D"… in seconds.
fn duration(v: &str) -> Option<i64> {
    let v = v.trim().trim_start_matches('+');
    let (sign, v) = v.strip_prefix('-').map_or((1, v), |r| (-1, r));
    let v = v.strip_prefix('P')?;
    let (mut total, mut num, mut in_time) = (0i64, String::new(), false);
    for c in v.chars() {
        match c {
            'T' => in_time = true,
            '0'..='9' => num.push(c),
            _ => {
                let n: i64 = std::mem::take(&mut num).parse().ok()?;
                total += n * match (c, in_time) {
                    ('W', _) => 604_800,
                    ('D', _) => 86_400,
                    ('H', true) => 3_600,
                    ('M', true) => 60,
                    ('S', true) => 1,
                    _ => return None,
                };
            }
        }
    }
    Some(sign * total)
}

/// A line as `rrule` reads it, with the zone made IANA (it doesn't know Windows' names).
fn rrule_line(p: &Prop) -> String {
    let mut head = p.name.clone();
    for (k, v) in &p.params {
        let v = if k == "TZID" { zone(v).map(|z| z.name().to_string()).unwrap_or_else(|| v.clone()) } else { v.clone() };
        head.push_str(&format!(";{k}={v}"));
    }
    format!("{head}:{}", p.value)
}

/// The occurrences of `events` that overlap the window, as the calendar shows them.
fn expand(events: &[Vevent], calendar_id: &str, owner: Option<&str>, from_ms: f64, to_ms: f64) -> Vec<EventInfo> {
    let from = Utc.timestamp_millis_opt(from_ms as i64).single().unwrap_or_else(Utc::now);
    let to = Utc.timestamp_millis_opt(to_ms as i64).single().unwrap_or_else(Utc::now);
    // Moved or cancelled occurrences of a repeating event: by UID and the time they replace.
    let mut overrides: HashMap<(String, i64), &Vevent> = HashMap::new();
    for ev in events {
        if let (Some(rid), uid) = (ev.get("RECURRENCE-ID").and_then(instant), ev.text("UID")) {
            overrides.insert((uid, rid.timestamp()), ev);
        }
    }
    let mut out = vec![];
    for ev in events {
        if ev.text("STATUS").eq_ignore_ascii_case("CANCELLED") {
            continue;
        }
        let Some(start_prop) = ev.get("DTSTART") else { continue };
        let Some(start) = instant(start_prop) else { continue };
        let length = ev
            .get("DTEND")
            .and_then(instant)
            .map(|end| (end - start).num_seconds())
            .or_else(|| ev.get("DURATION").and_then(|d| duration(&d.value)))
            .unwrap_or(0)
            .max(0);
        let uid = ev.text("UID");
        let starts: Vec<DateTime<Utc>> = if ev.get("RECURRENCE-ID").is_some() || ev.get("RRULE").is_none() {
            vec![start]
        } else {
            occurrences(ev, start_prop, from - chrono::Duration::seconds(length), to).unwrap_or_else(|e| {
                log::warn!("iCal repeating event not expanded: {e:#}");
                vec![start]
            })
        };
        for s in starts {
            // An occurrence that was moved or cancelled is replaced by its own VEVENT.
            if ev.get("RECURRENCE-ID").is_none() && overrides.contains_key(&(uid.clone(), s.timestamp())) {
                continue;
            }
            let e = s + chrono::Duration::seconds(length);
            if e < from || s > to {
                continue;
            }
            out.push(event_info(ev, calendar_id, owner, s, e));
        }
    }
    out.sort_by(|a, b| a.start.total_cmp(&b.start));
    out
}

fn occurrences(ev: &Vevent, start_prop: &Prop, from: DateTime<Utc>, to: DateTime<Utc>) -> Result<Vec<DateTime<Utc>>> {
    let mut lines = vec![rrule_line(start_prop)];
    for name in ["RRULE", "RDATE", "EXDATE"] {
        lines.extend(ev.all(name).map(rrule_line));
    }
    let set: rrule::RRuleSet = lines.join("\n").parse().map_err(|e| anyhow!("{e}"))?;
    let tz = rrule::Tz::UTC;
    let found = set.after(from.with_timezone(&tz)).before(to.with_timezone(&tz)).all(MAX_OCCURRENCES);
    Ok(found.dates.into_iter().map(|d| d.with_timezone(&Utc)).collect())
}

fn event_info(ev: &Vevent, calendar_id: &str, owner: Option<&str>, start: DateTime<Utc>, end: DateTime<Utc>) -> EventInfo {
    let attendees = ev
        .all("ATTENDEE")
        .map(|p| {
            let email = p.value.strip_prefix("mailto:").or_else(|| p.value.strip_prefix("MAILTO:")).map(|e| e.to_lowercase());
            let me = owner.is_some() && email.as_deref() == owner;
            Attendee { name: p.param("CN").map(|n| n.trim_matches('"').to_string()).filter(|n| !n.contains('@')), email, me }
        })
        .collect();
    let text = ["LOCATION", "DESCRIPTION", "URL", "X-GOOGLE-CONFERENCE"].map(|n| ev.text(n)).join(" ");
    let title = ev.text("SUMMARY");
    EventInfo {
        id: format!("{}@{}", ev.text("UID"), start.timestamp()),
        calendar_id: calendar_id.to_string(),
        title: if title.trim().is_empty() { tr!("calendar_untitled").to_string() } else { title },
        start: start.timestamp_millis() as f64,
        end: end.timestamp_millis() as f64,
        attendees,
        platform: platform(&text).map(str::to_string),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEED: &str = "BEGIN:VCALENDAR\r\nX-WR-CALNAME:marta@estudinord.cat\r\nBEGIN:VTIMEZONE\r\nTZID:Europe/Madrid\r\nEND:VTIMEZONE\r\n\
BEGIN:VEVENT\r\nUID:weekly\r\nDTSTART;TZID=Europe/Madrid:20261103T100000\r\nDTEND;TZID=Europe/Madrid:20261103T103000\r\n\
RRULE:FREQ=WEEKLY;BYDAY=TU\r\nEXDATE;TZID=Europe/Madrid:20261110T100000\r\nSUMMARY:Seguiment setmanal\r\n\
ATTENDEE;CN=Marta;PARTSTAT=ACCEPTED:mailto:marta@estudinord.cat\r\nATTENDEE;CN=\"Jordi, l'altre\":mailto:jordi@estudinord.cat\r\n\
DESCRIPTION:Enllaç: https://meet.google.com/abc-defg-hij\\nDu\r\n  te el portàtil\r\nBEGIN:VALARM\r\nTRIGGER:-PT10M\r\nEND:VALARM\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:weekly\r\nRECURRENCE-ID;TZID=Europe/Madrid:20261117T100000\r\nDTSTART;TZID=Europe/Madrid:20261117T120000\r\nDURATION:PT45M\r\nSUMMARY:Seguiment setmanal (moguda)\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:outlook\r\nDTSTART;TZID=Romance Standard Time:20261118T160000\r\nDTEND;TZID=Romance Standard Time:20261118T170000\r\nSUMMARY:Pressupost\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:allday\r\nDTSTART;VALUE=DATE:20261118\r\nSUMMARY:Festiu\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    fn ms(s: &str) -> f64 {
        DateTime::parse_from_rfc3339(s).unwrap().timestamp_millis() as f64
    }

    #[test]
    fn reads_the_name_and_the_events() {
        let p = parse(FEED);
        assert_eq!(p.name.as_deref(), Some("marta@estudinord.cat"));
        assert_eq!(p.events.len(), 4);
        // Folded lines are joined, alarms are left out.
        assert!(p.events[0].text("DESCRIPTION").contains("Du te el portàtil"));
        assert!(p.events[0].get("TRIGGER").is_none());
    }

    #[test]
    fn repeating_events_skip_exceptions_and_take_moved_ones() {
        let events = parse(FEED).events;
        let got = expand(&events, "ics:x", owner("marta@estudinord.cat").as_deref(), ms("2026-11-01T00:00:00Z"), ms("2026-11-30T00:00:00Z"));
        let weekly: Vec<(String, f64)> = got.iter().filter(|e| e.title.starts_with("Seguiment")).map(|e| (e.title.clone(), e.start)).collect();
        assert_eq!(
            weekly,
            vec![
                ("Seguiment setmanal".into(), ms("2026-11-03T10:00:00+01:00")),
                // 10 November is an exception.
                ("Seguiment setmanal (moguda)".into(), ms("2026-11-17T12:00:00+01:00")),
                ("Seguiment setmanal".into(), ms("2026-11-24T10:00:00+01:00")),
            ]
        );
        let first = &got[0];
        assert_eq!(first.end - first.start, 30.0 * 60_000.0);
        assert_eq!(first.platform.as_deref(), Some("Google Meet"));
        assert!(first.attendees[0].me && !first.attendees[1].me);
        assert_eq!(first.attendees[1].name.as_deref(), Some("Jordi, l'altre"));
        assert!(first.is_meeting());
    }

    #[test]
    fn windows_zones_and_all_day_events() {
        let got = expand(&parse(FEED).events, "ics:x", None, ms("2026-11-18T00:00:00Z"), ms("2026-11-19T00:00:00Z"));
        assert_eq!(got.len(), 1, "the all-day event isn't a meeting time");
        assert_eq!(got[0].title, "Pressupost");
        assert_eq!(got[0].start, ms("2026-11-18T16:00:00+01:00"));
    }

    #[test]
    fn durations() {
        assert_eq!(duration("PT1H30M"), Some(5400));
        assert_eq!(duration("P1DT2H"), Some(93_600));
        assert_eq!(duration("-PT15M"), Some(-900));
    }
}
