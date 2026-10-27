import { locale, t, UI_LANGUAGES, uiLanguage, type UiLanguage } from "./i18n";
import { SYSTEM_SPEAKER_BASE, type Meeting } from "./types";

/** 0:42, 4:37, 1:04:22 — the transcript's timestamp style. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** BCP 47 tag of a language other than the interface's (`locale()` is the interface's). */
const tagOf = (lng?: UiLanguage) => (lng ? { ca: "ca-ES", es: "es-ES", en: "en-US" }[lng] : locale());

/**
 * "52 min", "1 h 04 min" — the sidebar's duration style. `lng`: another language than the
 * interface's (the cover's document is written in the language it was generated in).
 */
export function duration(seconds: number, lng?: UiLanguage): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return t("format:minutes", { m, lng });
  return t("format:hoursMinutes", { h: Math.floor(m / 60), m: String(m % 60).padStart(2, "0"), lng });
}

/** "16 d'octubre de 2026", "16 de octubre de 2026", "October 16, 2026". */
export function dateOnly(ms: number, lng?: UiLanguage): string {
  const tag = tagOf(lng);
  const date = new Date(ms).toLocaleDateString(tag, { day: "numeric", month: "long", year: "numeric" });
  // The browser writes "16 d’octubre del 2026"; Murmur's style is "16 d'octubre de 2026".
  return tag === "ca-ES" ? date.replace(/’/g, "'").replace(/ del (\d{4})$/, " de $1") : date;
}

export function longDate(ms: number, lng?: UiLanguage): string {
  const time = new Date(ms).toLocaleTimeString(tagOf(lng), { hour: "2-digit", minute: "2-digit" });
  return t("format:dateTime", { date: dateOnly(ms, lng), time, lng });
}

export type DayGroup = "today" | "yesterday" | "thisWeek" | "earlier";
/** The sidebar's groups, in order. */
export const DAY_GROUPS: DayGroup[] = ["today", "yesterday", "thisWeek", "earlier"];

export function dayGroupId(ms: number, now = Date.now()): DayGroup {
  const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "thisWeek";
  return "earlier";
}

/** A group's name in the interface language ("Avui", "Ahir"…). */
export const dayGroupLabel = (group: DayGroup) => t(`format:dayGroups.${group}`);

/** The group's name: "Avui", "Ahir", "Aquesta setmana", "Anteriors". */
export const dayGroup = (ms: number, now = Date.now()): string => dayGroupLabel(dayGroupId(ms, now));

/** The name a speaker has when nobody has named them, in one language. */
function defaultName(meeting: Meeting, speaker: number, lng?: UiLanguage): string {
  if (speaker >= SYSTEM_SPEAKER_BASE) return t("format:speaker", { n: speaker - SYSTEM_SPEAKER_BASE + 1, lng });
  // In a call the microphone is the local side: first voice is you, others are in the room.
  if (meeting.sources?.mic && meeting.sources.system)
    return speaker === 0 ? t("format:you", { lng }) : t("format:room", { n: speaker + 1, lng });
  return t("format:speaker", { n: speaker + 1, lng });
}

/**
 * A speaker's default name in every interface language, the current one first: text written in
 * another language (a cover) may use any of them.
 */
export function defaultSpeakerNames(meeting: Meeting, speaker: number): string[] {
  const current = uiLanguage();
  const others = UI_LANGUAGES.filter((l) => l !== current);
  return [...new Set([current, ...others].map((lng) => defaultName(meeting, speaker, lng)))];
}

export function speakerName(meeting: Meeting, speaker: number, lng?: UiLanguage): string {
  return meeting.speakerNames[speaker] || defaultName(meeting, speaker, lng);
}

export function speakerIds(meeting: Meeting): number[] {
  const ids = new Set<number>(meeting.utterances.map((u) => u.speaker));
  Object.keys(meeting.speakerNames).forEach((k) => ids.add(Number(k)));
  return [...ids].sort((a, b) => a - b);
}
