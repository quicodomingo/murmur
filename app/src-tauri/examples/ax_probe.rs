//! Speaker tags spike: dumps the accessibility tree of a meeting app (Chrome with Meet, Zoom,
//! Teams) to see how it shows who is talking. Needs the Accessibility permission for the app
//! that runs it (the terminal): System Settings › Privacy & Security › Accessibility.
//!     cargo run --release --example ax_probe -- "Google Chrome" > meet-ax.txt
//! Run it during a call, while someone is talking; run it again while someone else talks.
#![allow(non_upper_case_globals)]

use std::ffi::c_void;

use core_foundation::array::{CFArray, CFArrayRef};
use core_foundation::base::{CFType, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::string::{CFString, CFStringRef};

type AXUIElementRef = *const c_void;

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(element: AXUIElementRef, attribute: CFStringRef, value: *mut CFTypeRef) -> i32;
    fn AXUIElementSetAttributeValue(element: AXUIElementRef, attribute: CFStringRef, value: CFTypeRef) -> i32;
}

fn attr(element: AXUIElementRef, name: &str) -> Option<CFType> {
    let mut value: CFTypeRef = std::ptr::null();
    let err = unsafe { AXUIElementCopyAttributeValue(element, CFString::new(name).as_concrete_TypeRef(), &mut value) };
    (err == 0 && !value.is_null()).then(|| unsafe { CFType::wrap_under_create_rule(value) })
}

fn text(element: AXUIElementRef, name: &str) -> String {
    attr(element, name)
        .and_then(|v| v.downcast::<CFString>().map(|s| s.to_string()).or_else(|| Some(format!("{v:?}"))))
        .unwrap_or_default()
}

fn children(element: AXUIElementRef) -> Vec<AXUIElementRef> {
    let Some(v) = attr(element, "AXChildren") else { return vec![] };
    let array: CFArray<*const c_void> = unsafe { CFArray::wrap_under_get_rule(v.as_CFTypeRef() as CFArrayRef) };
    // Keep the elements alive while we walk (the CFType above owns the array).
    std::mem::forget(v);
    array.iter().map(|e| *e).collect()
}

fn walk(element: AXUIElementRef, depth: usize, count: &mut usize) {
    if depth > 60 || *count > 20_000 {
        return;
    }
    *count += 1;
    let role = text(element, "AXRole");
    let fields: Vec<String> = [
        ("sub", "AXSubrole"),
        ("title", "AXTitle"),
        ("desc", "AXDescription"),
        ("value", "AXValue"),
        ("help", "AXHelp"),
        ("id", "AXDOMIdentifier"),
        ("class", "AXDOMClassList"),
    ]
    .iter()
    .filter_map(|(k, a)| {
        let v = text(element, a);
        (!v.is_empty()).then(|| format!("{k}={:?}", v.chars().take(120).collect::<String>()))
    })
    .collect();
    println!("{}{role} {}", "  ".repeat(depth), fields.join(" "));
    for child in children(element) {
        walk(child, depth + 1, count);
    }
}

fn main() {
    let app = std::env::args().nth(1).unwrap_or_else(|| "Google Chrome".into());
    // Asks macOS to show its prompt and add this terminal to the Accessibility list.
    let prompt = core_foundation::dictionary::CFDictionary::from_CFType_pairs(&[(
        CFString::new("AXTrustedCheckOptionPrompt"),
        CFBoolean::true_value(),
    )]);
    if !unsafe { AXIsProcessTrustedWithOptions(prompt.as_concrete_TypeRef() as *const c_void) } {
        eprintln!("Falta el permís d'Accessibilitat per a aquest terminal (Configuració del Sistema › Privadesa i seguretat › Accessibilitat).");
        std::process::exit(1);
    }
    let out = std::process::Command::new("pgrep").args(["-xo", &app]).output().expect("pgrep");
    let Ok(pid) = String::from_utf8_lossy(&out.stdout).trim().parse::<i32>() else {
        eprintln!("No trobo l'app «{app}».");
        std::process::exit(1);
    };
    let root = unsafe { AXUIElementCreateApplication(pid) };
    // Chrome only builds the tree of web pages when an assistive app asks for it.
    unsafe {
        AXUIElementSetAttributeValue(root, CFString::new("AXManualAccessibility").as_concrete_TypeRef(), CFBoolean::true_value().as_CFTypeRef());
        AXUIElementSetAttributeValue(root, CFString::new("AXEnhancedUserInterface").as_concrete_TypeRef(), CFBoolean::true_value().as_CFTypeRef());
    }
    std::thread::sleep(std::time::Duration::from_millis(1500));
    let mut count = 0;
    walk(root, 0, &mut count);
    eprintln!("{count} elements de «{app}» (pid {pid})");
}
