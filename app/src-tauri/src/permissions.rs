//! macOS privacy permissions, asked the way other apps do: the system's own dialog for the
//! microphone; system audio (the Core Audio tap, systap.rs), checked and asked through the TCC
//! framework (private, loaded at run time; without it, opening a tap shows the prompt and the
//! state is unknown); and screen recording, only for the screenshots.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Access {
    /// Never asked: asking shows the system dialog.
    Undetermined,
    Granted,
    /// Refused (or blocked by the administrator): only the System Settings can change it now.
    Denied,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub microphone: Access,
    /// "System audio recording" for the tap. Undetermined also when macOS doesn't let us know.
    pub system_audio: Access,
    /// Screen recording, for the screenshots. macOS doesn't say whether it was never asked or
    /// refused, so this is only granted or not.
    pub screen: bool,
}

#[cfg(target_os = "macos")]
mod imp {
    use std::sync::mpsc;
    use std::time::Duration;

    use std::ffi::{CStr, c_void};

    use block2::RcBlock;
    use core_foundation::base::TCFType;
    use core_foundation::string::CFString;
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, Bool};
    use objc2_foundation::NSString;

    use super::Access;

    #[link(name = "AVFoundation", kind = "framework")]
    unsafe extern "C" {
        static AVMediaTypeAudio: &'static NSString;
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }

    fn capture_device() -> &'static AnyClass {
        AnyClass::get(c"AVCaptureDevice").expect("AVFoundation is linked")
    }

    pub fn microphone() -> Access {
        // AVAuthorizationStatus: 0 not determined, 1 restricted, 2 denied, 3 authorized.
        let status: isize = unsafe { msg_send![capture_device(), authorizationStatusForMediaType: AVMediaTypeAudio] };
        match status {
            0 => Access::Undetermined,
            3 => Access::Granted,
            _ => Access::Denied,
        }
    }

    /// Shows the system dialog (only while undetermined) and waits for the answer.
    pub fn request_microphone() -> Access {
        if microphone() != Access::Undetermined {
            return microphone();
        }
        let (tx, rx) = mpsc::channel::<bool>();
        let handler = RcBlock::new(move |granted: Bool| {
            let _ = tx.send(granted.as_bool());
        });
        unsafe {
            let _: () = msg_send![capture_device(), requestAccessForMediaType: AVMediaTypeAudio, completionHandler: &*handler];
        }
        match rx.recv_timeout(Duration::from_secs(300)) {
            Ok(true) => Access::Granted,
            Ok(false) => Access::Denied,
            Err(_) => microphone(),
        }
    }

    pub fn screen() -> bool {
        unsafe { CGPreflightScreenCaptureAccess() }
    }

    /// The first time, macOS adds Murmur to the list and shows a prompt that opens the settings.
    pub fn request_screen() -> bool {
        unsafe { CGRequestScreenCaptureAccess() }
    }

    /// Opens a tap for a moment: the first time, macOS asks for "System audio recording".
    // TCC, the framework behind every privacy prompt. Its functions are private: looked up at
    // run time so a macOS without them just falls back to "unknown".
    type Preflight = unsafe extern "C" fn(service: *const c_void, options: *const c_void) -> i32;
    type Request = unsafe extern "C" fn(service: *const c_void, options: *const c_void, done: &block2::DynBlock<dyn Fn(Bool)>);

    fn tcc<T>(name: &CStr) -> Option<T> {
        static HANDLE: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
        let handle = *HANDLE.get_or_init(|| unsafe {
            libc::dlopen(c"/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC".as_ptr(), libc::RTLD_LAZY) as usize
        });
        if handle == 0 {
            return None;
        }
        let symbol = unsafe { libc::dlsym(handle as *mut c_void, name.as_ptr()) };
        (!symbol.is_null()).then(|| unsafe { std::mem::transmute_copy::<*mut c_void, T>(&symbol) })
    }

    fn audio_capture_service() -> CFString {
        CFString::from_static_string("kTCCServiceAudioCapture")
    }

    pub fn system_audio() -> Access {
        let Some(preflight) = tcc::<Preflight>(c"TCCAccessPreflight") else { return Access::Undetermined };
        // 0: granted, 1: denied, anything else: not asked yet.
        match unsafe { preflight(audio_capture_service().as_concrete_TypeRef() as *const c_void, std::ptr::null()) } {
            0 => Access::Granted,
            1 => Access::Denied,
            _ => Access::Undetermined,
        }
    }

    /// Shows macOS's "System audio recording" dialog (only while undetermined) and waits for it.
    pub fn request_system_audio() -> Access {
        if system_audio() != Access::Undetermined {
            return system_audio();
        }
        let Some(request) = tcc::<Request>(c"TCCAccessRequest") else {
            // No TCC functions: opening a tap shows the prompt; the answer stays unknown.
            let (tx, _rx) = crossbeam_channel::unbounded();
            if let Ok(tap) = crate::systap::start(tx) {
                std::thread::sleep(Duration::from_millis(800));
                drop(tap);
            }
            return Access::Undetermined;
        };
        let (tx, rx) = mpsc::channel::<bool>();
        let handler = RcBlock::new(move |granted: Bool| {
            let _ = tx.send(granted.as_bool());
        });
        unsafe { request(audio_capture_service().as_concrete_TypeRef() as *const c_void, std::ptr::null(), &handler) };
        match rx.recv_timeout(Duration::from_secs(300)) {
            Ok(true) => Access::Granted,
            Ok(false) => Access::Denied,
            Err(_) => system_audio(),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::Access;
    pub fn microphone() -> Access {
        Access::Granted
    }
    pub fn request_microphone() -> Access {
        Access::Granted
    }
    pub fn screen() -> bool {
        true
    }
    pub fn request_screen() -> bool {
        true
    }
    pub fn system_audio() -> Access {
        Access::Granted
    }
    pub fn request_system_audio() -> Access {
        Access::Granted
    }
}

pub fn status() -> Status {
    Status { microphone: imp::microphone(), system_audio: imp::system_audio(), screen: imp::screen() }
}

#[tauri::command]
pub fn permission_status() -> Status {
    status()
}

/// Asks for the microphone with the system dialog; resolves when the user answers.
#[tauri::command]
pub async fn request_microphone() -> Access {
    tauri::async_runtime::spawn_blocking(imp::request_microphone).await.unwrap_or(Access::Denied)
}

/// Shows macOS's "System audio recording" dialog; resolves when the user answers.
#[tauri::command]
pub async fn request_system_audio() -> Access {
    tauri::async_runtime::spawn_blocking(imp::request_system_audio).await.unwrap_or(Access::Undetermined)
}

/// Screen recording, for the screenshots: the system prompt the first time.
#[tauri::command]
pub fn request_screen() -> bool {
    imp::request_screen()
}

pub fn screen_granted() -> bool {
    imp::screen()
}

/// Opens the right page of System Settings › Privacy & Security.
#[tauri::command]
pub fn open_privacy_settings(pane: String) -> Result<(), String> {
    let anchor = match pane.as_str() {
        "microphone" => "Privacy_Microphone",
        // System audio and screen recording share a page (System audio recording only / Screen).
        "systemAudio" | "screen" => "Privacy_ScreenCapture",
        "calendars" => "Privacy_Calendars",
        _ => return Err(format!("Secció desconeguda: {pane}")),
    };
    std::process::Command::new("open")
        .arg(format!("x-apple.systempreferences:com.apple.preference.security?{anchor}"))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
