import { useSyncExternalStore } from "react";
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

// --- Syncing ---------------------------------------------------------------------------------

/**
 * Right after connecting, macOS is still loading the accounts, so the calendar list may come empty
 * for a while. The wait lives here, not in the settings window, so closing it doesn't stop it: the
 * app shows a small indicator meanwhile, and the window picks the state up again when it reopens.
 */
export type CalendarSync = { syncing: boolean; calendars: backend.CalendarInfo[] | null };
let sync: CalendarSync = { syncing: false, calendars: null };
const listeners = new Set<() => void>();
const setSync = (next: Partial<CalendarSync>) => {
  sync = { ...sync, ...next };
  listeners.forEach((l) => l());
};

export function useCalendarSync(): CalendarSync {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sync,
  );
}

/** Asks for the calendars every second until they show up (a minute at most). */
export async function syncCalendars(): Promise<backend.CalendarInfo[]> {
  if (sync.syncing) return [];
  setSync({ syncing: true });
  let list: backend.CalendarInfo[] = [];
  for (let i = 0; i < 60; i++) {
    list = await backend.listCalendars().catch(() => []);
    if (list.length) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  setSync({ syncing: false, calendars: list });
  return list;
}
