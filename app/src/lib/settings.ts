import { useEffect, useState } from "react";

import { applyAppearance, type Mode, type Theme } from "./appearance";
import { isTauri, setUiLanguage } from "./backend";
import type { CoverLanguagePref } from "./cover";
import { applyLanguage, resolveLanguage, type UiLanguagePref } from "./i18n";
import type { Language } from "./types";

export type Settings = {
  /** Interface language; "system" follows macOS (lib/i18n.ts). Not the meetings' `language`. */
  uiLanguage: UiLanguagePref;
  /** What the meetings are spoken in: the live model, and Whisper after stopping in a single language. */
  language: Language;
  /** Aparença: colour theme and light/dark mode ("system" follows macOS). */
  theme: Theme;
  mode: Mode;
  mic: boolean;
  /** Input device name; null = the system default. */
  micDevice: string | null;
  system: boolean;
  saveAudio: boolean;
  /** Folder for saved recordings; null = the app's data folder. */
  recordingsDir: string | null;
  maxSpeakers: number;
  threshold: number;
  /** In a call, more than one person speaks into the microphone (otherwise it's just "Tu"). */
  roomSpeakers: boolean;
  /** Final pass: re-check speakers over the whole meeting after stopping (experimental). */
  verifySpeakers: boolean;
  /** What takes the main area; the other one goes in the side panel. */
  primaryPanel: "transcript" | "notes";
  /** After a recording: punctuation and capitals (optional model, models.rs PUNCTUATION). */
  punctuate: boolean;
  /** After a recording: the cover, written by the local language model (models.rs LLM). */
  summarize: boolean;
  /** The cover's language: the interface's, or the one the meeting was recorded in (lib/cover.ts). */
  coverLanguage: CoverLanguagePref;
  /** Edited prompts, by id (lib/cover.ts PROMPTS); missing ones use the default text. */
  prompts: Record<string, string>;
  /** Offer to record when another app starts using the microphone (meeting detection). */
  detectMeetings: boolean;
  /** A pill on the right edge of the screen while recording (open Murmur, stop). */
  recordingIndicator: boolean;
  /** Clicking the indicator turns Murmur into a narrow notes window beside the call. */
  compactNotes: boolean;
  /** "Comença d'aquí a 2 minuts" for meetings in the calendar (once access is granted). */
  calendarAlerts: boolean;
  /** Look for a new version of Murmur and its models when it opens. */
  checkUpdates: boolean;
  /** After an update, show what the new version brings (lib/whatsnew.ts). */
  showWhatsNew: boolean;
  /** "Desconnecta": Murmur stops reading the calendar (macOS keeps the permission until the user removes it). */
  calendarEnabled: boolean;
  /** Calendars to watch; null = all of them. */
  calendarIds: string[] | null;
  /** Also alert for events with no guests and no video call link. */
  calendarNoGuests: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  uiLanguage: "system",
  language: "ca-es",
  theme: "acid",
  mode: "system",
  mic: true,
  micDevice: null,
  system: true,
  saveAudio: false,
  recordingsDir: null,
  maxSpeakers: 5,
  // Tuned for TitaNet on a hand-labelled meeting (see engine.rs embedding_model).
  threshold: 0.7,
  verifySpeakers: true,
  roomSpeakers: false,
  // Notes in the middle, transcript on the right (v3).
  primaryPanel: "notes",
  // Both need a download, so they're off until the user turns them on.
  punctuate: false,
  summarize: false,
  coverLanguage: "interface",
  prompts: {},
  detectMeetings: true,
  recordingIndicator: true,
  compactNotes: true,
  calendarAlerts: true,
  calendarEnabled: true,
  checkUpdates: true,
  showWhatsNew: true,
  calendarIds: null,
  calendarNoGuests: false,
};

const KEY = "transcriptor.settings.v1";

const VERSION = 3;

/** Settings saved by older versions: move untouched old defaults to the new ones. */
function migrate(s: Settings & { version?: number }): Settings {
  if ((s.version ?? 1) < 2) {
    // v2: live speakers use TitaNet (best at 0.7, was 0.65 with 3D-Speaker) and the final
    // speaker check is tuned, so it's on by default.
    if (s.threshold === 0.65) s.threshold = DEFAULT_SETTINGS.threshold;
    s.verifySpeakers = true;
  }
  if ((s.version ?? 1) < 3) {
    // v3: notes are the main panel by default.
    s.primaryPanel = "notes";
  }
  return { ...s, version: VERSION } as Settings;
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      return migrate({ ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") });
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  useEffect(() => applyAppearance(settings.theme, settings.mode), [settings.theme, settings.mode]);
  useEffect(() => {
    applyLanguage(settings.uiLanguage);
    if (isTauri()) setUiLanguage(resolveLanguage(settings.uiLanguage)).catch(() => {});
  }, [settings.uiLanguage]);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* keep in memory */
    }
  }, [settings]);
  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  return [settings, update] as const;
}
