//! Keeps the computer awake while a meeting is recorded. Nobody touches it during a meeting, so
//! after a while the system would sleep or, on Windows laptops with Modern Standby, turn the
//! screen off and pause desktop apps: the microphone goes quiet and the rest of the meeting is
//! lost. Held from the start of a recording until its last sentence is written.
//!
//! - Windows: a power request for the system and the screen (`PowerSetRequest`), as video calls
//!   do; the screen staying on is what keeps Modern Standby away. `powercfg /requests` lists it.
//! - macOS: an IOKit assertion against idle sleep (the screen can still turn off: recording goes on).
//! - Linux: `systemd-inhibit` against idle and sleep, for as long as Murmur runs, if it's there.

use crate::i18n::tr;

/// Lets the computer sleep again when dropped.
pub struct Awake(#[allow(dead_code)] imp::Guard);

/// None if the system wouldn't take it: recording goes on all the same.
pub fn keep() -> Option<Awake> {
    match imp::Guard::new(&tr!("awake_reason")) {
        Ok(g) => Some(Awake(g)),
        Err(e) => {
            log::warn!("keep awake: {e:#}");
            None
        }
    }
}

#[cfg(windows)]
mod imp {
    use anyhow::{Result, anyhow};
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Power::{PowerClearRequest, PowerCreateRequest, PowerRequestDisplayRequired, PowerRequestSystemRequired, PowerSetRequest};
    use windows_sys::Win32::System::Threading::{POWER_REQUEST_CONTEXT_SIMPLE_STRING, REASON_CONTEXT, REASON_CONTEXT_0};

    pub struct Guard {
        handle: HANDLE,
        // The reason Windows shows in `powercfg /requests`: kept alive with the request.
        _reason: Vec<u16>,
    }

    // The handle is only used to clear the request, from whichever thread drops it.
    unsafe impl Send for Guard {}

    impl Guard {
        pub fn new(reason: &str) -> Result<Self> {
            let mut wide: Vec<u16> = reason.encode_utf16().chain(Some(0)).collect();
            let context = REASON_CONTEXT {
                Version: 0, // POWER_REQUEST_CONTEXT_VERSION
                Flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING,
                Reason: REASON_CONTEXT_0 { SimpleReasonString: wide.as_mut_ptr() },
            };
            let handle = unsafe { PowerCreateRequest(&context) };
            if handle.is_null() || handle == INVALID_HANDLE_VALUE {
                return Err(anyhow!("PowerCreateRequest: {}", std::io::Error::last_os_error()));
            }
            unsafe {
                PowerSetRequest(handle, PowerRequestSystemRequired);
                PowerSetRequest(handle, PowerRequestDisplayRequired);
            }
            Ok(Self { handle, _reason: wide })
        }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            unsafe {
                PowerClearRequest(self.handle, PowerRequestDisplayRequired);
                PowerClearRequest(self.handle, PowerRequestSystemRequired);
                CloseHandle(self.handle);
            }
        }
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use anyhow::{Result, anyhow};
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};

    #[link(name = "IOKit", kind = "framework")]
    unsafe extern "C" {
        fn IOPMAssertionCreateWithName(kind: CFStringRef, level: u32, name: CFStringRef, id: *mut u32) -> i32;
        fn IOPMAssertionRelease(id: u32) -> i32;
    }

    const LEVEL_ON: u32 = 255;

    pub struct Guard(u32);

    impl Guard {
        pub fn new(reason: &str) -> Result<Self> {
            let kind = CFString::new("PreventUserIdleSystemSleep");
            let name = CFString::new(reason);
            let mut id = 0u32;
            let status = unsafe { IOPMAssertionCreateWithName(kind.as_concrete_TypeRef(), LEVEL_ON, name.as_concrete_TypeRef(), &mut id) };
            if status != 0 {
                return Err(anyhow!("IOPMAssertionCreateWithName: {status:#x}"));
            }
            Ok(Self(id))
        }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            unsafe { IOPMAssertionRelease(self.0) };
        }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod imp {
    use std::process::{Child, Command, Stdio};

    use anyhow::{Context, Result};

    /// `systemd-inhibit` holding a command that ends with Murmur, so a crash doesn't leave the
    /// computer unable to sleep.
    pub struct Guard(Child);

    impl Guard {
        pub fn new(reason: &str) -> Result<Self> {
            let child = Command::new("systemd-inhibit")
                .args(["--what=idle:sleep", "--who=Murmur", "--mode=block"])
                .arg(format!("--why={reason}"))
                .args(["tail", &format!("--pid={}", std::process::id()), "-f", "/dev/null"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .context("systemd-inhibit")?;
            Ok(Self(child))
        }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}
