import { dateOnly } from "./format";
import i18n, { t } from "./i18n";

/**
 * "Novetats de Murmur": what each version brings, shown once after updating. The dates live
 * here; the text, in every language, in `locales/<language>/whatsnew.json` (`releases.<version>`).
 * A version with no notes shows nothing.
 */
export const RELEASES: { version: string; date: string }[] = [
  { version: "0.4.0", date: "2026-10-26" },
  { version: "0.3.0", date: "2026-10-21" },
];

/** Where a note's link goes: a tab of the settings. */
export type WhatsNewLink = "general" | "appearance" | "calendar" | "audio" | "transcription" | "intelligence";
export type WhatsNewItem = { title: string; text: string; link?: WhatsNewLink; linkLabel?: string };
export type WhatsNewRelease = { version: string; date: string; items: WhatsNewItem[] };

/** The last version whose notes were shown (or skipped), so they show once. */
const SEEN_KEY = "murmur.whatsnew.seen.v1";

const parts = (v: string) => v.split(".").map((n) => parseInt(n, 10) || 0);
/** Semver order, enough for x.y.z. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

function items(version: string): WhatsNewItem[] {
  // Read the whole map: versions have dots, which i18next takes as key separators.
  const read = (lng: string) => (t("whatsnew:releases", { lng, returnObjects: true }) as Record<string, WhatsNewItem[]> | string)?.[version as never];
  const notes = read(i18n.resolvedLanguage ?? "ca") ?? read("ca");
  return Array.isArray(notes) ? notes : [];
}

const formatDate = (iso: string) => dateOnly(Date.parse(`${iso}T12:00:00`));

/** The notes of the versions after `after` (exclusive) up to `upTo`, newest first. */
export function releasesBetween(after: string | null, upTo: string): WhatsNewRelease[] {
  return RELEASES.filter((r) => compareVersions(r.version, upTo) <= 0 && (!after || compareVersions(r.version, after) > 0))
    .sort((a, b) => compareVersions(b.version, a.version))
    .map((r) => ({ version: r.version, date: formatDate(r.date), items: items(r.version) }))
    .filter((r) => r.items.length);
}

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

export function markSeen(version: string) {
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    /* shows again next time */
  }
}

/**
 * What to show when Murmur opens at `current`. A new install (`firstRun`) shows nothing: it has
 * the welcome screens. An install from before this screen existed (no record, but onboarded)
 * gets the current version's notes only.
 */
export function pendingReleases(current: string, firstRun: boolean): WhatsNewRelease[] {
  const seen = readSeen();
  if (firstRun) {
    markSeen(current);
    return [];
  }
  if (seen && compareVersions(seen, current) >= 0) return [];
  const pending = seen ? releasesBetween(seen, current) : releasesBetween(null, current).slice(0, 1);
  if (!pending.length) markSeen(current);
  return pending;
}
