import { useEffect, useState } from "react";

export type Settings = {
  mic: boolean;
  /** Input device name; null = the system default. */
  micDevice: string | null;
  system: boolean;
  saveAudio: boolean;
  maxSpeakers: number;
  threshold: number;
};

export const DEFAULT_SETTINGS: Settings = {
  mic: true,
  micDevice: null,
  system: true,
  saveAudio: false,
  maxSpeakers: 5,
  threshold: 0.65,
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
