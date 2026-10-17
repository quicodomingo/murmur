import { clock, duration, longDate, speakerName } from "./format";
import { notesDoc, notesFromDoc } from "./notes";
import type { Cover, LlmResult, LlmTask, Meeting } from "./types";

// The cover is written by the local language model (Gemma 4 E4B, lib.rs run_llm): it reads the
// transcript once and answers one prompt per part. Every answer is JSON constrained by a schema,
// so the prompts can be edited in the settings without breaking the parsing; the schemas can't.

export type PromptId = "system" | "title" | "tone" | "summary" | "decisions" | "tasks" | "parts";

type PromptDef = {
  id: PromptId;
  label: string;
  text: string;
  maxTokens: number;
  schema: object | null;
};

const str = { type: "string" };
const minute = { type: "string", description: "m:ss" };

export const TONES = ["Constructiu", "Distès", "Neutre", "Formal", "Tens", "Conflictiu"] as const;

export const PROMPTS: PromptDef[] = [
  {
    id: "system",
    label: "Instruccions generals",
    text:
      "Ets un assistent que treballa amb transcripcions de reunions en català. La transcripció s'ha fet automàticament: " +
      "pot tenir paraules mal reconegudes (sobretot noms i marques) i fragments en castellà. Cada línia comença amb el minut " +
      "entre claudàtors i el nom de qui parla. Al final hi pot haver les notes que ha pres l'usuari durant la reunió, amb el " +
      "minut en què les va escriure: mostren què li ha semblat important, i el que hi digui (una tasca, una decisió) també " +
      "compta. Respon sempre en català correcte i natural, sense castellanismes. No t'inventis res que no surti a la " +
      "transcripció o a les notes.",
    maxTokens: 0,
    schema: null,
  },
  {
    id: "title",
    label: "Títol i entradeta",
    text:
      "Escriu un títol breu per a aquesta reunió (màxim 8 paraules, sense punt final) i una entradeta de dues frases: " +
      "de què va la reunió i què s'hi decideix.",
    maxTokens: 220,
    schema: { type: "object", properties: { title: str, excerpt: str }, required: ["title", "excerpt"] },
  },
  {
    id: "tone",
    label: "To",
    text: `Quin és el to general de la reunió? Tria una d'aquestes etiquetes: ${TONES.join(", ")}. Afegeix una frase breu que ho justifiqui.`,
    maxTokens: 140,
    schema: { type: "object", properties: { tone: { type: "string", enum: TONES }, reason: str }, required: ["tone", "reason"] },
  },
  {
    id: "summary",
    label: "Resum",
    text: "Resumeix la reunió en dos paràgrafs breus (tres o quatre frases cadascun): els temes principals i les conclusions.",
    maxTokens: 550,
    schema: {
      type: "object",
      properties: { paragraphs: { type: "array", items: str, minItems: 1, maxItems: 3 } },
      required: ["paragraphs"],
    },
  },
  {
    id: "decisions",
    label: "Decisions",
    text:
      "Fes la llista de les decisions que s'hi prenen (com a màxim 6). Escriu cada decisió en una frase breu i directa (màxim 20 " +
      "paraules), sense començar per «S'ha decidit» ni «S'ha acordat». Per a cada decisió, indica el minut on es pren, en format " +
      "m:ss tal com surt entre claudàtors. Si no es pren cap decisió, deixa la llista buida.",
    maxTokens: 450,
    schema: {
      type: "object",
      properties: {
        decisions: {
          type: "array",
          maxItems: 6,
          items: { type: "object", properties: { text: str, minute }, required: ["text", "minute"] },
        },
      },
      required: ["decisions"],
    },
  },
  {
    id: "tasks",
    label: "Tasques",
    text:
      "Fes la llista de les tasques que s'han encarregat a la reunió (com a màxim 8). Una tasca és una acció concreta que " +
      "algú ha dit que s'ha de fer: quan algú la demana («caldria enviar-los el pressupost», «Pere, ho pots mirar?»), s'hi " +
      "compromet («ho preparo jo») o queda apuntada a les notes. No són tasques els temes de conversa, les opinions, les " +
      "idees ni les decisions que no demanen a ningú que faci res. Per a cada una: què s'ha de fer, en poques paraules i " +
      "començant per un infinitiu (per exemple «Preparar el vídeo de demostració»); qui se n'encarrega, amb el nom tal com " +
      "surt a la transcripció; per a quan, i el minut on surt, en format m:ss. Si no es diu qui o quan, deixa aquell camp " +
      'com a text buit (""). Si a la reunió no s\'ha encarregat cap tasca, deixa la llista buida: val més no posar-ne cap ' +
      "que inventar-ne.",
    maxTokens: 650,
    schema: {
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
    },
  },
  {
    id: "parts",
    label: "Parts de la reunió",
    text:
      "Divideix tota la reunió, de l'inici al final, en parts segons els temes que es tracten (entre 3 i 8, en ordre). Per a " +
      "cada part, dona el minut on comença (format m:ss, tal com surt a la transcripció), un títol curt (màxim 6 paraules) i " +
      "d'un a tres punts breus (màxim 15 paraules cadascun) amb el que s'hi diu o s'hi decideix. L'última part ha d'arribar " +
      "fins al final de la reunió.",
    maxTokens: 1000,
    schema: {
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
    },
  },
];

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

/** What the model reads: a short header and one line per speaker turn. */
export function coverDocument(m: Meeting): string {
  const names = [...new Set(m.utterances.map((u) => speakerName(m, u.speaker)))];
  const lines = [
    `Reunió del ${longDate(m.createdAt)}. Durada: ${duration(m.duration)}. Participants: ${names.join(", ")}.`,
    "",
  ];
  const turns: { speaker: number; start: number; text: string[] }[] = [];
  for (const u of m.utterances) {
    const last = turns.at(-1);
    if (last?.speaker === u.speaker) last.text.push(u.text);
    else turns.push({ speaker: u.speaker, start: u.start, text: [u.text] });
  }
  for (const t of turns) lines.push(`[${clock(t.start)}] ${speakerName(m, t.speaker)}: ${t.text.join(" ")}`);
  // The user's notes, with the minute each one was written: what they found worth keeping.
  const notes = notesFromDoc(notesDoc(m)).filter((n) => n.text.trim());
  if (notes.length) {
    lines.push("", "Notes preses durant la reunió:");
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

/** The cover no longer matches the meeting (only covers that saved what they read). */
export const coverOutdated = (m: Meeting) => !!m.cover?.basis && m.cover.basis !== coverBasis(coverDocument(m));

/**
 * Generating again keeps what the user did on the cover: tasks added by hand, and the ticks of
 * tasks that come back with the same text.
 */
export function keepTaskEdits(next: Cover, previous: Cover | null | undefined): Cover {
  if (!previous?.tasks?.length || !next.tasks) return next;
  const key = (t: string) => t.trim().toLocaleLowerCase("ca");
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
/** Small models sometimes write "buit" or "no es diu" instead of leaving a field empty. */
const optional = (s: unknown) => {
  const v = clean(s);
  return /^(buit|buida|cap|ningú|no es diu|no s'especifica|desconegut|sense data|-|—|n\/a)\.?$/i.test(v) ? null : v || null;
};

/** Turns the model's answers into a cover (and the title it proposed, if any). */
export function buildCover(results: LlmResult[], meeting: Meeting): { cover: Cover; title: string | null } {
  const cover: Cover = { generatedAt: Date.now() };
  let title: string | null = null;
  const errors: Record<string, string> = {};
  const max = meeting.duration;
  for (const r of results) {
    let data: Record<string, unknown>;
    try {
      if (r.error || !r.text) throw new Error(r.error ?? "Resposta buida");
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
        if (clean(data.tone)) cover.tone = { label: clean(data.tone), reason: clean(data.reason) };
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

/** The default title given when recording starts: replaced by the model's unless the user changed it. */
export const isDefaultTitle = (title: string) => /^Reunió de les \d{1,2}:\d{2}$/.test(title);
