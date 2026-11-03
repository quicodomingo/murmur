import { dateOnly, duration, longDate } from "./format";
import { locale, t, type UiLanguage } from "./i18n";
import type { Meeting } from "./types";

// A meeting can be recorded again after stopping ("Continua"): it stays one meeting on one
// timeline, and `meeting.parts` says when each new part started. Between two parts the transcript
// shows the pause, with the clock times; the meeting's length doesn't count it.

/** How long after stopping "Continua" stays on the toolbar (and in the floating alert). */
export const CONTINUE_MS = 10 * 60_000;

/** Each stretch the meeting was recorded in: clock times (epoch ms) and the meeting time it starts at. */
export function partRanges(m: Meeting): { from: number; to: number; at: number }[] {
  const starts = [{ startedAt: m.createdAt, at: 0 }, ...(m.parts ?? [])];
  return starts.map((p, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : m.duration;
    return { from: p.startedAt, to: p.startedAt + Math.max(0, end - p.at) * 1000, at: p.at };
  });
}

/** The pauses between parts: where in the meeting (seconds) and from/to on the clock. */
export function pauses(m: Meeting): { at: number; from: number; to: number }[] {
  const ranges = partRanges(m);
  return ranges.slice(1).map((r, i) => ({ at: r.at, from: ranges[i].to, to: r.from }));
}

const clock = (ms: number, lng?: UiLanguage) =>
  new Date(ms).toLocaleTimeString(lng ? { ca: "ca-ES", es: "es-ES", en: "en-US" }[lng] : locale(), { hour: "2-digit", minute: "2-digit" });

/** "Pausa de 13:05 a 14:10 · 1 h 5 min". */
export function pauseLabel(p: { from: number; to: number }, lng?: UiLanguage): string {
  return t("transcript:pause", { from: clock(p.from, lng), to: clock(p.to, lng), duration: duration((p.to - p.from) / 1000, lng), lng });
}

/**
 * When it was recorded: "3 de novembre de 2026 · 12:23", or with its parts, "3 de novembre de
 * 2026 · 12:23 a 13:05 i 14:10 a 14:40".
 */
export function meetingWhen(m: Meeting, lng?: UiLanguage): string {
  if (!m.parts?.length) return longDate(m.createdAt, lng);
  const ranges = partRanges(m).map((r) => t("format:timeRange", { from: clock(r.from, lng), to: clock(r.to, lng), lng }));
  const list = new Intl.ListFormat(lng ?? locale(), { type: "conjunction" }).format(ranges);
  return t("format:dateTime", { date: dateOnly(m.createdAt, lng), time: list, lng });
}
