import { clock, defaultSpeakerNames, duration, longDate, speakerIds, speakerName } from "./format";
import { locale, t, UI_LANGUAGES, uiLanguage, type UiLanguage } from "./i18n";
import { notesDoc, notesFromDoc } from "./notes";
import type { Cover, LlmResult, LlmTask, Meeting } from "./types";

// The cover is written by the local language model (Gemma 4 E4B, lib.rs run_llm): it reads the
// transcript once and answers one prompt per part. Every answer is JSON constrained by a schema,
// so the prompts can be edited in the settings without breaking the parsing; the schemas can't.

export type PromptId = "system" | "title" | "tone" | "summary" | "decisions" | "tasks" | "parts";

/** `label` and `text` are read in the interface language each time they're used (cover.json). */
type PromptDef = {
  id: PromptId;
  readonly label: string;
  readonly text: string;
  maxTokens: number;
  readonly schema: object | null;
};

const str = { type: "string" };
const minute = { type: "string", description: "m:ss" };

/**
 * The meeting's tone, as stored in the cover (`tone.label`): a fixed id, shown translated
 * (toneLabel). The model chooses among the labels of the interface language (toneId maps back).
 */
export const TONES = ["constructive", "relaxed", "neutral", "formal", "tense", "conflictive"] as const;
export type Tone = (typeof TONES)[number];

const toneLabels = (lng?: UiLanguage) => TONES.map((id) => t(`cover:tones.${id}`, { lng }));

/** A tone id from what the model answered or an older cover saved (a label in any language). */
export function toneId(value: string): Tone | null {
  const key = value.trim().toLocaleLowerCase();
  if ((TONES as readonly string[]).includes(key)) return key as Tone;
  for (const lng of UI_LANGUAGES) {
    const i = toneLabels(lng).findIndex((label) => label.toLocaleLowerCase() === key);
    if (i >= 0) return TONES[i];
  }
  return null;
}

/** What to show for a cover's tone: its name in the interface language. */
export function toneLabel(value: string): string {
  const id = toneId(value);
  return id ? t(`cover:tones.${id}`) : value;
}

type Schema = object | null;
const SCHEMAS: Record<PromptId, { maxTokens: number; schema: () => Schema }> = {
  system: { maxTokens: 0, schema: () => null },
  title: {
    maxTokens: 220,
    schema: () => ({ type: "object", properties: { title: str, excerpt: str }, required: ["title", "excerpt"] }),
  },
  tone: {
    maxTokens: 140,
    schema: () => ({ type: "object", properties: { tone: { type: "string", enum: toneLabels() }, reason: str }, required: ["tone", "reason"] }),
  },
  summary: {
    maxTokens: 550,
    schema: () => ({
      type: "object",
      properties: { paragraphs: { type: "array", items: str, minItems: 1, maxItems: 3 } },
      required: ["paragraphs"],
    }),
  },
  decisions: {
    maxTokens: 450,
    schema: () => ({
      type: "object",
      properties: {
        decisions: {
          type: "array",
          maxItems: 6,
          items: { type: "object", properties: { text: str, minute }, required: ["text", "minute"] },
        },
      },
      required: ["decisions"],
    }),
  },
  tasks: {
    maxTokens: 650,
    schema: () => ({
      type: "object",
      properties: {
        tasks: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            properties: { task: str, owner: str, when: str, minute },
            required: ["task", "owner", "when", "minute"],
          },
        },
      },
      required: ["tasks"],
    }),
  },
  parts: {
    maxTokens: 1000,
    schema: () => ({
      type: "object",
      properties: {
        parts: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            properties: { minute, title: str, points: { type: "array", items: str, minItems: 1, maxItems: 3 } },
            required: ["minute", "title", "points"],
          },
        },
      },
      required: ["parts"],
    }),
  },
};

const PROMPT_IDS: PromptId[] = ["system", "title", "tone", "summary", "decisions", "tasks", "parts"];

export const PROMPTS: PromptDef[] = PROMPT_IDS.map((id) => ({
  id,
  maxTokens: SCHEMAS[id].maxTokens,
  get label() {
    return t(`cover:promptLabels.${id}`);
  },
  get text() {
    return t(`cover:prompts.${id}`, { tones: toneLabels().join(", ") });
  },
  get schema() {
    return SCHEMAS[id].schema();
  },
}));

export const promptText = (id: PromptId, overrides: Record<string, string>) =>
  overrides[id]?.trim() || PROMPTS.find((p) => p.id === id)!.text;

export function llmTasks(overrides: Record<string, string>, only?: PromptId[]): LlmTask[] {
  return PROMPTS.filter((p) => p.schema && (!only || only.includes(p.id))).map((p) => ({
    id: p.id,
    prompt: promptText(p.id, overrides),
    maxTokens: p.maxTokens,
    schema: JSON.stringify(p.schema),
  }));
}

/**
 * What the model reads: a short header and one line per speaker turn, in the interface language
 * (`lng`: another one, to check a cover written in it, see coverLanguage).
 */
export function coverDocument(m: Meeting, lng?: UiLanguage): string {
  const names = [...new Set(m.utterances.map((u) => speakerName(m, u.speaker, lng)))];
  const lines = [
    t("cover:header", { date: longDate(m.createdAt, lng), duration: duration(m.duration, lng), names: names.join(", "), lng }),
    "",
  ];
  const turns: { speaker: number; start: number; text: string[] }[] = [];
  for (const u of m.utterances) {
    const last = turns.at(-1);
    if (last?.speaker === u.speaker) last.text.push(u.text);
    else turns.push({ speaker: u.speaker, start: u.start, text: [u.text] });
  }
  for (const turn of turns) lines.push(`[${clock(turn.start)}] ${speakerName(m, turn.speaker, lng)}: ${turn.text.join(" ")}`);
  // The user's notes, with the minute each one was written: what they found worth keeping.
  const notes = notesFromDoc(notesDoc(m)).filter((n) => n.text.trim());
  if (notes.length) {
    lines.push("", t("cover:notesHeading", { lng }));
    for (const n of notes) lines.push(`[${clock(n.t)}] ${n.text.trim()}`);
  }
  return lines.join("\n");
}

/**
 * A short fingerprint of what the model reads (names, text, notes): saved with the cover, so a
 * change made afterwards, or while it was being written, shows it's out of date.
 */
export function coverBasis(document: string): string {
  let h = 5381;
  for (let i = 0; i < document.length; i++) h = ((h << 5) + h + document.charCodeAt(i)) | 0;
  return `${document.length}:${(h >>> 0).toString(36)}`;
}

/** The language a cover was written in (and its `basis` computed in): covers before i18n are Catalan. */
export const coverLanguage = (cover: Cover): UiLanguage => cover.lang ?? "ca";

/** The fingerprint of the meeting as a cover in `lng` reads it. */
export const meetingBasis = (m: Meeting, lng: UiLanguage = uiLanguage()) => coverBasis(coverDocument(m, lng));

/**
 * The cover no longer matches the meeting (only covers that saved what they read). Compared in
 * the cover's language, so switching the interface language doesn't make it look outdated.
 */
export const coverOutdated = (m: Meeting) => !!m.cover?.basis && m.cover.basis !== meetingBasis(m, coverLanguage(m.cover));

/**
 * Speakers called differently in `after` than in `before`: [old name, new name]. A speaker
 * who had no name yet may appear in a cover under the default name of any language.
 */
export function renamedSpeakers(before: Meeting, after: Meeting): [string, string][] {
  return speakerIds(after).flatMap((id) => {
    const now = speakerName(after, id);
    if (!now || speakerName(before, id) === now) return [];
    const olds = before.speakerNames[id] ? [before.speakerNames[id]] : defaultSpeakerNames(before, id);
    return olds.filter((old) => old && old !== now).map((old) => [old, now] as [string, string]);
  });
}

/**
 * What the cover calls each speaker by default ("Parlant 1", "Tu", in any language) → how the
 * meeting calls them now: the name the user gave, or the default in the interface language.
 */
export function namedSpeakers(m: Meeting): [string, string][] {
  return speakerIds(m).flatMap((id) => {
    const now = speakerName(m, id);
    return defaultSpeakerNames(m, id)
      .filter((old) => old !== now)
      .map((old) => [old, now] as [string, string]);
  });
}

/**
 * The cover with the speakers' new names in its text ("Parlant 1 diu…" → "M. Àngels diu…"), so
 * renaming doesn't need a new cover. Whole words only, as written.
 */
export function renameInCover(cover: Cover, renames: [string, string][]): Cover {
  if (!renames.length) return cover;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = renames.map(([old, now]) => [new RegExp(`(?<![\\p{L}\\p{N}])${escape(old)}(?![\\p{L}\\p{N}])`, "gu"), now] as const);
  const fix = (s: string) => patterns.reduce((text, [re, now]) => text.replace(re, now), s);
  return {
    ...cover,
    excerpt: cover.excerpt && fix(cover.excerpt),
    tone: cover.tone && { ...cover.tone, reason: fix(cover.tone.reason) },
    summary: cover.summary?.map(fix),
    decisions: cover.decisions?.map((d) => ({ ...d, text: fix(d.text) })),
    tasks: cover.tasks?.map((t) => ({ ...t, text: fix(t.text), owner: t.owner && fix(t.owner) })),
    parts: cover.parts?.map((p) => ({ ...p, title: fix(p.title), points: p.points.map(fix) })),
  };
}

/**
 * Generating again keeps what the user did on the cover: tasks added by hand, and the ticks of
 * tasks that come back with the same text.
 */
export function keepTaskEdits(next: Cover, previous: Cover | null | undefined): Cover {
  if (!previous?.tasks?.length || !next.tasks) return next;
  const key = (text: string) => text.trim().toLocaleLowerCase(locale());
  const done = new Set(previous.tasks.filter((t) => t.done).map((t) => key(t.text)));
  const tasks = next.tasks.map((t) => (done.has(key(t.text)) ? { ...t, done: true } : t));
  const known = new Set(tasks.map((t) => key(t.text)));
  return { ...next, tasks: [...tasks, ...previous.tasks.filter((t) => t.manual && !known.has(key(t.text)))] };
}

/** Rough time for the whole cover, measured on an M4 (20 min meeting: 6,500 tokens read in 41 s, 6 parts in 100 s). */
export function coverEstimate(document: string, parts: number, loaded = false): number {
  const tokens = document.length / 3.2;
  return (loaded ? 0 : 10) + tokens / 160 + parts * 17;
}

/** "4:18" or "1:04:18" → seconds; null for anything else or beyond the meeting. */
export function parseMinute(value: unknown, max: number): number | null {
  if (typeof value !== "string") return null;
  const parts = value.trim().replace(/[[\]]/g, "").split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const seconds = parts.reduce((acc, n) => acc * 60 + n, 0);
  return seconds <= max + 1 ? seconds : null;
}

const clean = (s: unknown) => (typeof s === "string" ? s.trim() : "");
/** Small models sometimes write "buit" or "no es diu" instead of leaving a field empty (in any language). */
const EMPTY_WORDS =
  /^(buit|buida|cap|ningú|no es diu|no s'especifica|desconegut|sense data|vacío|vacía|ninguno|nadie|no se dice|no se especifica|desconocido|sin fecha|empty|none|nobody|no one|not specified|unknown|no date|-|—|n\/a)\.?$/i;
const optional = (s: unknown) => {
  const v = clean(s);
  return EMPTY_WORDS.test(v) ? null : v || null;
};

/** Turns the model's answers into a cover (and the title it proposed, if any). */
export function buildCover(results: LlmResult[], meeting: Meeting): { cover: Cover; title: string | null } {
  const cover: Cover = { generatedAt: Date.now(), lang: uiLanguage() };
  let title: string | null = null;
  const errors: Record<string, string> = {};
  const max = meeting.duration;
  for (const r of results) {
    let data: Record<string, unknown>;
    try {
      if (r.error || !r.text) throw new Error(r.error ?? t("cover:emptyAnswer"));
      data = JSON.parse(r.text);
    } catch (e) {
      errors[r.id] = e instanceof Error ? e.message : String(e);
      continue;
    }
    switch (r.id as PromptId) {
      case "title":
        title = clean(data.title).replace(/[.。]+$/, "") || null;
        cover.excerpt = clean(data.excerpt) || undefined;
        break;
      case "tone":
        // Stored as an id; an unexpected answer is kept as written.
        if (clean(data.tone)) cover.tone = { label: toneId(clean(data.tone)) ?? clean(data.tone), reason: clean(data.reason) };
        break;
      case "summary":
        cover.summary = ((data.paragraphs as unknown[]) ?? []).map(clean).filter(Boolean);
        break;
      case "decisions":
        cover.decisions = ((data.decisions as Record<string, unknown>[]) ?? [])
          .map((d) => ({ text: clean(d.text), t: parseMinute(d.minute, max) }))
          .filter((d) => d.text);
        break;
      case "tasks":
        cover.tasks = ((data.tasks as Record<string, unknown>[]) ?? [])
          .map((d) => ({ text: clean(d.task), owner: optional(d.owner), when: optional(d.when), t: parseMinute(d.minute, max) }))
          .filter((d) => d.text);
        break;
      case "parts": {
        const parts = ((data.parts as Record<string, unknown>[]) ?? [])
          .map((d) => ({
            t: parseMinute(d.minute, max),
            title: clean(d.title),
            points: ((d.points as unknown[]) ?? []).map(clean).filter(Boolean),
          }))
          .filter((p): p is { t: number; title: string; points: string[] } => p.t !== null && !!p.title)
          .sort((a, b) => a.t - b.t);
        if (parts.length) parts[0].t = Math.min(parts[0].t, meeting.utterances[0]?.start ?? 0);
        cover.parts = parts;
        break;
      }
    }
  }
  if (Object.keys(errors).length) cover.errors = errors;
  return { cover, title };
}

/** Who spoke and for how long, from the utterances' times (no model involved). */
export function talkTime(m: Meeting): { speaker: number; name: string; seconds: number; share: number }[] {
  const totals = new Map<number, number>();
  for (const u of m.utterances) totals.set(u.speaker, (totals.get(u.speaker) ?? 0) + Math.max(0, u.end - u.start));
  const all = [...totals.values()].reduce((a, b) => a + b, 0) || 1;
  return [...totals.entries()]
    .map(([speaker, seconds]) => ({ speaker, name: speakerName(m, speaker), seconds, share: seconds / all }))
    .sort((a, b) => b.seconds - a.seconds);
}

/** The title a new recording gets ("Reunió de les 17:05"), `time` as the interface writes it. */
export const defaultTitle = (time: string) => t("cover:defaultTitle", { time });

/**
 * The default title given when recording starts, in any language: replaced by the model's
 * unless the user changed it.
 */
export function isDefaultTitle(title: string): boolean {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // "17:05", "05:05 PM" (with the narrow space some browsers put before PM).
  const time = "\\d{1,2}:\\d{2}(?:[\\s\\u202f]?[AaPp]\\.?\\s?[Mm]\\.?)?";
  return UI_LANGUAGES.some((lng) => {
    const [before, after = ""] = t("cover:defaultTitle", { lng, time: "\u0000" }).split("\u0000");
    return new RegExp(`^${escape(before)}${time}${escape(after)}$`).test(title);
  });
}
