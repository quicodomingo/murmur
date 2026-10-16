import { useEffect, useState } from "react";

import { applyAppearance, type Mode, type Theme } from "./appearance";

export type Settings = {
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
  /** Final pass: re-check speakers over the whole meeting after stopping (experimental). */
  verifySpeakers: boolean;
  /** What takes the main area; the other one goes in the side panel. */
  primaryPanel: "transcript" | "notes";
  /** After a recording: punctuation and capitals (optional model, models.rs PUNCTUATION). */
  punctuate: boolean;
  /** After a recording: the cover, written by the local language model (models.rs LLM). */
  summarize: boolean;
  /** Edited prompts, by id (lib/cover.ts PROMPTS); missing ones use the default text. */
  prompts: Record<string, string>;
  /** Offer to record when another app starts using the microphone (meeting detection). */
  detectMeetings: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
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
  primaryPanel: "transcript",
  // Both need a download, so they're off until the user turns them on.
  punctuate: false,
  summarize: false,
  prompts: {},
  detectMeetings: true,
};

const KEY = "transcriptor.settings.v1";

const VERSION = 2;

/** Settings saved by older versions: move untouched old defaults to the new ones. */
function migrate(s: Settings & { version?: number }): Settings {
  if ((s.version ?? 1) < 2) {
    // v2: live speakers use TitaNet (best at 0.7, was 0.65 with 3D-Speaker) and the final
    // speaker check is tuned, so it's on by default.
    if (s.threshold === 0.65) s.threshold = DEFAULT_SETTINGS.threshold;
    s.verifySpeakers = true;
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
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* keep in memory */
    }
  }, [settings]);
  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  return [settings, update] as const;
}
