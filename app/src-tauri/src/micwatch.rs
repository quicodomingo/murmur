//! Which other apps are using the microphone right now (macOS 14.2+ CoreAudio process objects).
//! Drives "Reunió detectada": when Zoom, Teams or a browser starts capturing, offer to record.

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct MicUser {
    pub pid: i32,
    /// What the user knows the app as ("Zoom", "Google Chrome").
    pub name: String,
}

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::c_void;
    use std::os::raw::c_char;

    use super::MicUser;

    type AudioObjectID = u32;
    type OSStatus = i32;

    #[repr(C)]
    struct PropertyAddress {
        selector: u32,
        scope: u32,
        element: u32,
    }

    const SYSTEM_OBJECT: AudioObjectID = 1;
    const SCOPE_GLOBAL: u32 = u32::from_be_bytes(*b"glob");
    const ELEMENT_MAIN: u32 = 0;
    const PROCESS_OBJECT_LIST: u32 = u32::from_be_bytes(*b"prs#");
    const PROCESS_PID: u32 = u32::from_be_bytes(*b"ppid");
    const PROCESS_IS_RUNNING_INPUT: u32 = u32::from_be_bytes(*b"piri");

    #[link(name = "CoreAudio", kind = "framework")]
    unsafe extern "C" {
        fn AudioObjectGetPropertyDataSize(
            id: AudioObjectID,
            address: *const PropertyAddress,
            qualifier_size: u32,
            qualifier: *const c_void,
            size: *mut u32,
        ) -> OSStatus;
        fn AudioObjectGetPropertyData(
            id: AudioObjectID,
            address: *const PropertyAddress,
            qualifier_size: u32,
            qualifier: *const c_void,
            size: *mut u32,
            data: *mut c_void,
        ) -> OSStatus;
    }

    unsafe extern "C" {
        fn proc_pidpath(pid: i32, buffer: *mut c_char, size: u32) -> i32;
    }

    fn address(selector: u32) -> PropertyAddress {
        PropertyAddress { selector, scope: SCOPE_GLOBAL, element: ELEMENT_MAIN }
    }

    fn get<T: Copy + Default>(id: AudioObjectID, selector: u32) -> Option<T> {
        let mut value = T::default();
        let mut size = std::mem::size_of::<T>() as u32;
        let status = unsafe {
            AudioObjectGetPropertyData(id, &address(selector), 0, std::ptr::null(), &mut size, &mut value as *mut T as *mut c_void)
        };
        (status == 0).then_some(value)
    }

    fn processes() -> Vec<AudioObjectID> {
        let addr = address(PROCESS_OBJECT_LIST);
        let mut size = 0u32;
        if unsafe { AudioObjectGetPropertyDataSize(SYSTEM_OBJECT, &addr, 0, std::ptr::null(), &mut size) } != 0 {
            return vec![]; // before macOS 14.2
        }
        let mut ids = vec![0 as AudioObjectID; size as usize / std::mem::size_of::<AudioObjectID>()];
        let status = unsafe {
            AudioObjectGetPropertyData(SYSTEM_OBJECT, &addr, 0, std::ptr::null(), &mut size, ids.as_mut_ptr() as *mut c_void)
        };
        if status != 0 {
            return vec![];
        }
        ids.truncate(size as usize / std::mem::size_of::<AudioObjectID>());
        ids
    }

    fn executable(pid: i32) -> Option<String> {
        let mut buf = vec![0 as c_char; 4096];
        let n = unsafe { proc_pidpath(pid, buf.as_mut_ptr(), buf.len() as u32) };
        if n <= 0 {
            return None;
        }
        let bytes: Vec<u8> = buf[..n as usize].iter().map(|&c| c as u8).collect();
        Some(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// The outermost app bundle in the path, so a browser's helper process reads as the browser.
    fn app_name(path: &str) -> Option<String> {
        let bundle = path.split('/').find(|part| part.ends_with(".app"))?;
        let name = bundle.trim_end_matches(".app");
        Some(
            match name {
                "zoom.us" => "Zoom",
                "Microsoft Teams" | "Microsoft Teams (work or school)" | "Microsoft Teams classic" => "Microsoft Teams",
                other => other,
            }
            .to_string(),
        )
    }

    /// Every other process capturing audio input, with its executable.
    pub fn mic_processes() -> Vec<(i32, String)> {
        let own = std::process::id() as i32;
        processes()
            .into_iter()
            .filter(|&p| get::<u32>(p, PROCESS_IS_RUNNING_INPUT).unwrap_or(0) != 0)
            .filter_map(|p| get::<i32>(p, PROCESS_PID))
            .filter(|&pid| pid != own)
            .filter_map(|pid| Some((pid, executable(pid)?)))
            .collect()
    }

    pub fn mic_users() -> Vec<MicUser> {
        let mut users: Vec<MicUser> = mic_processes()
            .into_iter()
            .filter_map(|(pid, path)| {
                // System services (dictation, Siri, the audio server) aren't meetings; FaceTime,
                // in /System/Applications, is.
                if path.starts_with("/System/Library/") || path.starts_with("/usr/") {
                    return None;
                }
                Some(MicUser { pid, name: app_name(&path)? })
            })
            .collect();
        users.sort_by(|a, b| a.name.cmp(&b.name));
        users.dedup_by(|a, b| a.name == b.name);
        users
    }

    #[cfg(test)]
    mod tests {
        use super::app_name;

        #[test]
        fn names_come_from_the_outer_bundle() {
            assert_eq!(app_name("/Applications/zoom.us.app/Contents/MacOS/zoom.us").as_deref(), Some("Zoom"));
            assert_eq!(
                app_name("/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/1/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper")
                    .as_deref(),
                Some("Google Chrome")
            );
            assert_eq!(app_name("/usr/local/bin/sox"), None);
        }
    }
}

#[cfg(target_os = "macos")]
pub use imp::{mic_processes, mic_users};

#[cfg(not(target_os = "macos"))]
pub fn mic_users() -> Vec<MicUser> {
    vec![]
}

#[cfg(not(target_os = "macos"))]
pub fn mic_processes() -> Vec<(i32, String)> {
    vec![]
}
