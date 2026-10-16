//! macOS privacy permissions, asked the way other apps do: the system's own dialog for the
//! microphone, and for "Gravació de pantalla i àudio del sistema" (needed by ScreenCaptureKit)
//! the system prompt that adds Murmur to the list and links to the right settings pane.

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
    /// Screen and system audio recording. macOS doesn't say whether it was never asked or
    /// refused, so this is only granted or not.
    pub system_audio: bool,
}

#[cfg(target_os = "macos")]
mod imp {
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
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

    pub fn system_audio() -> bool {
        unsafe { CGPreflightScreenCaptureAccess() }
    }

    /// The first time, macOS adds Murmur to the list and shows a prompt that opens the settings.
    /// Once granted, macOS asks to reopen the app.
    pub fn request_system_audio() -> bool {
        unsafe { CGRequestScreenCaptureAccess() }
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
    pub fn system_audio() -> bool {
        true
    }
    pub fn request_system_audio() -> bool {
        true
    }
}

pub fn status() -> Status {
    Status { microphone: imp::microphone(), system_audio: imp::system_audio() }
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

#[tauri::command]
pub fn request_system_audio() -> bool {
    imp::request_system_audio()
}

/// Opens the right page of System Settings › Privacy & Security.
#[tauri::command]
pub fn open_privacy_settings(pane: String) -> Result<(), String> {
    let anchor = match pane.as_str() {
        "microphone" => "Privacy_Microphone",
        "systemAudio" => "Privacy_ScreenCapture",
        _ => return Err(format!("Secció desconeguda: {pane}")),
    };
    std::process::Command::new("open")
        .arg(format!("x-apple.systempreferences:com.apple.preference.security?{anchor}"))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
