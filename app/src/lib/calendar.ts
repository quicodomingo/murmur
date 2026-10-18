import * as backend from "./backend";
import type { Settings } from "./settings";

/** A meeting rather than a reminder or a block of time: other people or a video call. */
export const isMeeting = (e: backend.CalendarEvent) => !!e.platform || e.attendees.some((a) => !a.me);

/** The other people invited, by name (or the e-mail's user part when there's no name). */
export const guestNames = (e: backend.CalendarEvent) => [
  ...new Set(e.attendees.filter((a) => !a.me).map((a) => (a.name ?? a.email?.split("@")[0] ?? "").trim()).filter(Boolean)),
];

/**
 * The calendar meeting going on now (or starting within 5 minutes), to name a new recording.
 * With several, the one that starts closest to now.
 */
export async function currentEvent(settings: Settings): Promise<backend.CalendarEvent | null> {
  if (!backend.isTauri() || !settings.calendarEnabled || (await backend.calendarAccess()) !== "granted") return null;
  const now = Date.now();
  const events = await backend.calendarEvents(now, now + 5 * 60_000, settings.calendarIds);
  const candidates = events.filter((e) => e.end > now && (settings.calendarNoGuests || isMeeting(e)));
  candidates.sort((a, b) => Math.abs(a.start - now) - Math.abs(b.start - now));
  return candidates[0] ?? null;
}
