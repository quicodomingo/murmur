import { invoke } from "@tauri-apps/api/core";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * The system Murmur runs on. The webview's user agent says it at once (WKWebView on macOS,
 * WebView2 on Windows, WebKitGTK on Linux), before anything asks the backend.
 */
export type Os = "macos" | "windows" | "linux";

const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
export const OS: Os = /Mac/.test(agent) ? "macos" : /Windows/.test(agent) ? "windows" : "linux";
export const isMac = OS === "macos";

/** ⌘ on the Mac, Ctrl elsewhere: the modifier of the app's shortcuts. */
export const hasMod = (e: KeyboardEvent | ReactKeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey);

/**
 * A shortcut written the Mac way ("⌘⇧S", "⌘⌫"), as this system writes it: unchanged on the Mac,
 * "Ctrl+Shift+S" or "Ctrl+Backspace" elsewhere.
 */
export function shortcut(mac: string): string {
  if (isMac) return mac;
  const names: Record<string, string> = { "⌘": "Ctrl", "⇧": "Shift", "⌥": "Alt", "⌃": "Ctrl", "⌫": "Backspace", "↩": "Enter" };
  const keys = [...mac].map((c) => names[c] ?? c.toUpperCase());
  return keys.join("+");
}

/** What this system can do (lib.rs › platform), so the UI only offers what works here. */
export interface Capabilities {
  os: Os;
  systemAudio: boolean;
  screenshots: boolean;
  calendar: boolean;
  meetingDetection: boolean;
  /** The extension of the audio to listen to or export: "m4a" on the Mac, "ogg" elsewhere. */
  audioExtension: string;
}

/** Until the backend answers (or in a browser), what this OS can do in this version. */
export let capabilities: Capabilities = {
  os: OS,
  systemAudio: OS !== "linux",
  screenshots: isMac,
  calendar: isMac,
  meetingDetection: isMac,
  audioExtension: isMac ? "m4a" : "ogg",
};

/** Asks the backend once, at startup; the defaults above already match it. */
export async function loadCapabilities() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  try {
    capabilities = await invoke<Capabilities>("platform");
  } catch {
    // An older backend: keep the defaults.
  }
}

/** Marks <html> with the OS (`data-os`), for the styles that differ (the Mac's traffic lights). */
export function markOs() {
  document.documentElement.dataset.os = OS;
}
