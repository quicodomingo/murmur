//! Screenshots of a meeting, taken by hand from the recording indicator: the call's window
//! (Meet in a browser, Zoom, Teams, FaceTime) or, if there's none, the main screen. Saved as JPEG
//! in `<app data>/screens/<meeting id>/`. It uses the "screen and system audio recording"
//! permission Murmur already has for the other side of calls.

use crate::i18n::tr;
use std::path::{Path, PathBuf};

/// A window on screen (CGWindowList).
#[derive(Debug, Clone)]
pub struct WindowInfo {
    pub id: u32,
    pub owner: String,
    pub name: String,
    pub layer: i64,
    pub width: f64,
    pub height: f64,
}

const BROWSERS: [&str; 6] = ["Google Chrome", "Safari", "Arc", "Microsoft Edge", "Firefox", "Brave Browser"];
const CALL_APPS: [&str; 4] = ["zoom.us", "Microsoft Teams", "FaceTime", "Webex"];
/// Browser tab titles of a call: "Meet - abc-defg-hij", "Microsoft Teams", "Zoom"…
const CALL_TITLES: [&str; 4] = ["Meet", "Teams", "Zoom", "Whereby"];

/// The call's window: a call app's, or a browser window showing a call; the largest if several.
pub fn meeting_window(windows: &[WindowInfo]) -> Option<u32> {
    let is_call = |w: &WindowInfo| {
        CALL_APPS.contains(&w.owner.as_str())
            || (BROWSERS.contains(&w.owner.as_str()) && CALL_TITLES.iter().any(|t| w.name.contains(t)))
    };
    windows
        .iter()
        .filter(|w| w.layer == 0 && w.width >= 320.0 && w.height >= 240.0 && is_call(w))
        .max_by(|a, b| (a.width * a.height).total_cmp(&(b.width * b.height)))
        .map(|w| w.id)
}

#[cfg(target_os = "macos")]
pub fn windows() -> Vec<WindowInfo> {
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use core_graphics::window::{
        copy_window_info, kCGNullWindowID, kCGWindowBounds, kCGWindowLayer, kCGWindowListExcludeDesktopElements,
        kCGWindowListOptionOnScreenOnly, kCGWindowName, kCGWindowNumber, kCGWindowOwnerName,
    };

    let Some(list) = copy_window_info(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID)
    else {
        return vec![];
    };
    list.iter()
        .filter_map(|item| {
            let dict: CFDictionary<CFString, CFType> = unsafe { CFDictionary::wrap_under_get_rule(*item as CFDictionaryRef) };
            let get = |key| dict.find(unsafe { CFString::wrap_under_get_rule(key) });
            let text = |key| get(key).and_then(|v| v.downcast::<CFString>()).map(|s| s.to_string()).unwrap_or_default();
            let number = |v: &CFType| v.downcast::<CFNumber>().and_then(|n| n.to_f64());
            let bounds = get(unsafe { kCGWindowBounds })
                .and_then(|v| v.downcast::<CFDictionary>())
                .map(|b| unsafe { CFDictionary::<CFString, CFType>::wrap_under_get_rule(b.as_concrete_TypeRef()) })?;
            let size = |k: &str| bounds.find(CFString::new(k)).and_then(|v| number(&v)).unwrap_or(0.0);
            Some(WindowInfo {
                id: get(unsafe { kCGWindowNumber }).and_then(|v| number(&v))? as u32,
                owner: text(unsafe { kCGWindowOwnerName }),
                name: text(unsafe { kCGWindowName }),
                layer: get(unsafe { kCGWindowLayer }).and_then(|v| number(&v)).unwrap_or(0.0) as i64,
                width: size("Width"),
                height: size("Height"),
            })
        })
        .collect()
}

#[cfg(not(target_os = "macos"))]
pub fn windows() -> Vec<WindowInfo> {
    vec![]
}

/// Takes the screenshot into `dir` (named after the meeting time in ms) and returns its path.
pub fn capture(dir: &Path, t_ms: u64) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{t_ms}.jpg"));
    // -x: no sound, -o: no window shadow, -t: format; -l: one window, -m: the main screen.
    let mut cmd = std::process::Command::new("/usr/sbin/screencapture");
    cmd.args(["-x", "-o", "-t", "jpg"]);
    match meeting_window(&windows()) {
        Some(id) => cmd.arg(format!("-l{id}")),
        None => cmd.arg("-m"),
    };
    let status = cmd.arg(&path).status().map_err(|e| e.to_string())?;
    if !status.success() || !path.exists() {
        return Err(tr!("capture_failed").into());
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(id: u32, owner: &str, name: &str, width: f64) -> WindowInfo {
        WindowInfo { id, owner: owner.into(), name: name.into(), layer: 0, width, height: width * 0.6 }
    }

    #[test]
    fn finds_the_call_window() {
        let list = [
            w(1, "Google Chrome", "Gmail - Inbox", 1400.0),
            w(2, "Google Chrome", "Meet - abc-defg-hij", 1200.0),
            w(3, "Murmur", "Murmur", 1280.0),
        ];
        assert_eq!(meeting_window(&list), Some(2));
        assert_eq!(meeting_window(&[w(4, "zoom.us", "Zoom Meeting", 900.0), w(5, "zoom.us", "", 100.0)]), Some(4));
        assert_eq!(meeting_window(&[w(6, "Finder", "Documents", 900.0)]), None);
    }
}
