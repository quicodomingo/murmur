//! The macOS calendar (EventKit): every account added to the system (iCloud, Google, Exchange…).
//! Murmur only reads it: the next meeting for the alert, and its title when recording starts.

use serde::{Deserialize, Serialize};

use crate::permissions::Access;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarInfo {
    pub id: String,
    pub title: String,
    /// The account it belongs to ("iCloud", "q@example.com"…).
    pub account: String,
    /// "#rrggbb".
    pub color: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attendee {
    pub name: Option<String>,
    pub email: Option<String>,
    /// The person using this Mac.
    pub me: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventInfo {
    pub id: String,
    pub calendar_id: String,
    pub title: String,
    /// Milliseconds since 1970, like JavaScript dates.
    pub start: f64,
    pub end: f64,
    pub attendees: Vec<Attendee>,
    /// "Google Meet", "Zoom"… when the event has a video call link.
    pub platform: Option<String>,
}

impl EventInfo {
    /// A meeting rather than a reminder or a block of time: other people or a video call.
    pub fn is_meeting(&self) -> bool {
        self.platform.is_some() || self.attendees.iter().any(|a| !a.me)
    }
}

/// What the calendar alert watches (from Settings › General).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Watch {
    pub enabled: bool,
    /// Calendars to watch; `None` means all of them.
    pub calendar_ids: Option<Vec<String>>,
    /// Also events with no guests and no video link.
    pub include_no_guests: bool,
}

/// The video call service named in a link, location or notes.
fn platform(text: &str) -> Option<&'static str> {
    const SERVICES: [(&str, &str); 7] = [
        ("meet.google.com", "Google Meet"),
        ("zoom.us/", "Zoom"),
        ("teams.microsoft.com", "Microsoft Teams"),
        ("teams.live.com", "Microsoft Teams"),
        ("webex.com", "Webex"),
        ("whereby.com", "Whereby"),
        ("facetime.apple.com", "FaceTime"),
    ];
    let text = text.to_lowercase();
    SERVICES.iter().find(|(host, _)| text.contains(host)).map(|(_, name)| *name)
}

#[cfg(target_os = "macos")]
mod imp {
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2_app_kit::NSColorSpace;
    use objc2_event_kit::{EKAuthorizationStatus, EKCalendar, EKEntityType, EKEventStatus, EKEventStore};
    use objc2_foundation::{NSArray, NSDate, NSError};

    use super::{Attendee, CalendarInfo, EventInfo, platform};
    use crate::permissions::Access;

    pub fn access() -> Access {
        match unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) } {
            EKAuthorizationStatus::NotDetermined => Access::Undetermined,
            EKAuthorizationStatus::FullAccess => Access::Granted,
            // Restricted, denied or write-only: reading needs the System Settings now.
            _ => Access::Denied,
        }
    }

    /// Shows the system dialog (only while undetermined) and waits for the answer.
    pub fn request() -> Access {
        if access() != Access::Undetermined {
            return access();
        }
        let (tx, rx) = mpsc::channel::<bool>();
        let handler = RcBlock::new(move |granted: Bool, _error: *mut NSError| {
            let _ = tx.send(granted.as_bool());
        });
        let store = unsafe { EKEventStore::new() };
        unsafe { store.requestFullAccessToEventsWithCompletion(&*handler as *const _ as *mut _) };
        match rx.recv_timeout(Duration::from_secs(300)) {
            Ok(true) => Access::Granted,
            Ok(false) => Access::Denied,
            Err(_) => access(),
        }
    }

    fn hex(calendar: &EKCalendar) -> String {
        let color = unsafe { calendar.color() };
        match color.colorUsingColorSpace(&NSColorSpace::sRGBColorSpace()) {
            Some(c) => {
                let byte = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
                format!("#{:02x}{:02x}{:02x}", byte(c.redComponent()), byte(c.greenComponent()), byte(c.blueComponent()))
            }
            None => "#8f8f8f".into(),
        }
    }

    fn info(calendar: &EKCalendar) -> CalendarInfo {
        unsafe {
            CalendarInfo {
                id: calendar.calendarIdentifier().to_string(),
                title: calendar.title().to_string(),
                account: calendar.source().map(|s| s.title().to_string()).unwrap_or_default(),
                color: hex(calendar),
            }
        }
    }

    fn event_calendars(store: &EKEventStore) -> Vec<Retained<EKCalendar>> {
        unsafe { store.calendarsForEntityType(EKEntityType::Event) }.to_vec()
    }

    pub fn calendars() -> Vec<CalendarInfo> {
        if access() != Access::Granted {
            return vec![];
        }
        let store = unsafe { EKEventStore::new() };
        event_calendars(&store).iter().map(|c| info(c)).collect()
    }

    pub fn events(from_ms: f64, to_ms: f64, ids: Option<&[String]>) -> Vec<EventInfo> {
        if access() != Access::Granted {
            return vec![];
        }
        let store = unsafe { EKEventStore::new() };
        let chosen: Vec<Retained<EKCalendar>> = event_calendars(&store)
            .into_iter()
            .filter(|c| ids.is_none_or(|ids| ids.contains(&unsafe { c.calendarIdentifier() }.to_string())))
            .collect();
        if chosen.is_empty() {
            return vec![];
        }
        let from = NSDate::dateWithTimeIntervalSince1970(from_ms / 1000.0);
        let to = NSDate::dateWithTimeIntervalSince1970(to_ms / 1000.0);
        let chosen = NSArray::from_retained_slice(&chosen);
        let predicate = unsafe { store.predicateForEventsWithStartDate_endDate_calendars(&from, &to, Some(&chosen)) };
        let found = unsafe { store.eventsMatchingPredicate(&predicate) };
        found
            .iter()
            .filter(|e| unsafe { !e.isAllDay() && e.status() != EKEventStatus::Canceled })
            .map(|e| unsafe {
                let attendees = e
                    .attendees()
                    .map(|list| {
                        list.iter()
                            .map(|p| {
                                let url = p.URL().absoluteString().map(|s| s.to_string()).unwrap_or_default();
                                Attendee {
                                    name: p.name().map(|n| n.to_string()),
                                    email: url.strip_prefix("mailto:").map(str::to_string),
                                    me: p.isCurrentUser(),
                                }
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                let text = [
                    e.URL().and_then(|u| u.absoluteString()).map(|s| s.to_string()),
                    e.location().map(|s| s.to_string()),
                    e.notes().map(|s| s.to_string()),
                ]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" ");
                EventInfo {
                    id: e.eventIdentifier().map(|s| s.to_string()).unwrap_or_default(),
                    calendar_id: e.calendar().map(|c| c.calendarIdentifier().to_string()).unwrap_or_default(),
                    title: e.title().to_string(),
                    start: e.startDate().timeIntervalSince1970() * 1000.0,
                    end: e.endDate().timeIntervalSince1970() * 1000.0,
                    attendees,
                    platform: platform(&text).map(str::to_string),
                }
            })
            .collect()
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::{CalendarInfo, EventInfo};
    use crate::permissions::Access;
    pub fn access() -> Access {
        Access::Denied
    }
    pub fn request() -> Access {
        Access::Denied
    }
    pub fn calendars() -> Vec<CalendarInfo> {
        vec![]
    }
    pub fn events(_from_ms: f64, _to_ms: f64, _ids: Option<&[String]>) -> Vec<EventInfo> {
        vec![]
    }
}

pub use imp::events;

#[tauri::command]
pub fn calendar_access() -> Access {
    imp::access()
}

/// Asks for calendar access with the system dialog; resolves when the user answers.
#[tauri::command]
pub async fn request_calendar_access() -> Access {
    tauri::async_runtime::spawn_blocking(imp::request).await.unwrap_or(Access::Denied)
}

#[tauri::command]
pub async fn list_calendars() -> Vec<CalendarInfo> {
    tauri::async_runtime::spawn_blocking(imp::calendars).await.unwrap_or_default()
}

/// Events between two times (ms since 1970) in the given calendars (all if `None`).
#[tauri::command]
pub async fn calendar_events(from: f64, to: f64, calendar_ids: Option<Vec<String>>) -> Vec<EventInfo> {
    tauri::async_runtime::spawn_blocking(move || imp::events(from, to, calendar_ids.as_deref()))
        .await
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::platform;

    #[test]
    fn finds_the_video_call_service() {
        assert_eq!(platform("https://meet.google.com/abc-defg-hij"), Some("Google Meet"));
        assert_eq!(platform("Join: https://us02web.Zoom.us/j/123"), Some("Zoom"));
        assert_eq!(platform("Sala 3, segona planta"), None);
    }
}
