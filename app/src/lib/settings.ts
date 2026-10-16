import { useEffect, useState } from "react";

export type Settings = {
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
};

export const DEFAULT_SETTINGS: Settings = {
  mic: true,
  micDevice: null,
  system: true,
  saveAudio: false,
  recordingsDir: null,
  maxSpeakers: 5,
  threshold: 0.65,
  verifySpeakers: false,
  primaryPanel: "transcript",
};

const KEY = "transcriptor.settings.v1";

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
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
