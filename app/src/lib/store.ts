import { useEffect, useReducer, useRef } from "react";

import type { JSONContent } from "@tiptap/core";

import * as backend from "./backend";
import { coverLanguage, coverOutdated, meetingBasis, renamedSpeakers, renameInCover } from "./cover";
import { notesFromDoc } from "./notes";
import {
  SYSTEM_SPEAKER_BASE,
  type Assignment,
  type Channel,
  type Cover,
  type Meeting,
  type MeetingSummary,
  type PostStage,
  type Screen,
  type ShareLink,
  type Utterance,
} from "./types";

// In the app, meetings live in SQLite (db.rs): the sidebar loads summaries, a meeting's content
// is loaded when opened, and edits are saved as small changes. In a plain browser (UI
// development) everything lives in localStorage; that key is also migrated into SQLite once.
const STORAGE_KEY = "transcriptor.meetings.v1";

/** Where search results ask the transcript to scroll to. `nonce` re-triggers the same target. */
export type Jump = { meetingId: string; utteranceId?: string; t: number; nonce: number };

export type State = {
  summaries: MeetingSummary[];
  /** Meetings whose content is loaded (the selected one, the one recording…). */
  open: Record<string, Meeting>;
  selectedId: string | null;
  partial: Record<Channel, string>;
  loaded: boolean;
  jump: Jump | null;
  /** What runs after a recording (speakers, punctuation, cover), by meeting id. */
  finalPass: Record<string, PostProcess>;
  /** Why that work is waiting now, if it is: Murmur is recording, or a call uses the mic (gate.rs). */
  postPause: PauseReason | null;
};

export type PauseReason = "recording" | "call";

export type PostProcess = {
  stage: PostStage;
  /** Every stage this run goes through, in order; the ones before `stage` are done. */
  steps: PostStage[];
  estimateSeconds: number;
  startedAt: number;
  /** How long each finished stage took, in seconds. */
  took: Partial<Record<PostStage, number>>;
  /** Set while the work waits (`State.postPause`): the clock stops. */
  pausedAt?: number;
};

export type Action =
  | { type: "loaded"; summaries: MeetingSummary[]; open?: Record<string, Meeting> }
  | { type: "opened"; meeting: Meeting }
  | { type: "delete"; id: string }
  | { type: "new"; meeting: Meeting }
  | { type: "select"; id: string }
  | { type: "jump"; meetingId: string; utteranceId?: string; t: number }
  | { type: "partial"; channel: Channel; text: string }
  | { type: "final"; utterance: Utterance }
  | { type: "tick"; duration: number }
  | { type: "stopped" }
  | { type: "title"; id: string; title: string }
  /** `version`: the meeting's `speakersVersion` the user saw when they started the action. */
  | { type: "rename"; id: string; speaker: number; name: string; version: number }
  | { type: "reassign"; id: string; utteranceId: string; speaker: number; version: number }
  | { type: "edit"; id: string; utteranceId: string; text: string }
  | { type: "notes"; id: string; doc: JSONContent }
  | { type: "audio"; id: string; path: string | null }
  | { type: "postStage"; id: string; stage: PostStage; steps: PostStage[]; estimateSeconds: number }
  /** The work after a recording started or stopped waiting. */
  | { type: "postPaused"; reason: PauseReason | null }
  | { type: "speakersVerified"; id: string; base: number; assignments: Assignment[] }
  /** Whisper's text for one channel (`base`), keyed by each utterance's start. */
  | { type: "retranscribed"; id: string; base: number; texts: { start: number; text: string }[] }
  /** Texts sent to the punctuation model (`from`) and what came back; edited meanwhile = skipped. */
  | { type: "punctuated"; id: string; changes: { utteranceId: string; from: string; to: string }[] }
  | { type: "cover"; id: string; cover: Cover | null; title: string | null }
  | { type: "coverTasks"; id: string; tasks: NonNullable<Cover["tasks"]> }
  | { type: "tags"; id: string; tags: string[] }
  /** A tag renamed (or merged into another, `to` already existing) or removed, in every meeting. */
  | { type: "renameTag"; from: string; to: string }
  | { type: "deleteTag"; name: string }
  | { type: "screen"; id: string; screen: Screen }
  | { type: "shares"; id: string; shares: ShareLink[] }
  | { type: "removeScreen"; id: string; path: string }
  | { type: "postDone"; id: string };

const summaryOf = (m: Meeting): MeetingSummary => ({
  id: m.id,
  title: m.title,
  createdAt: m.createdAt,
  duration: m.duration,
  status: m.status,
  tags: m.tags,
});

/** Tag names ignore capitals: the first spelling of each one stays. */
export function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  return tags
    .map((t) => t.trim())
    .filter((t) => {
      const key = t.toLocaleLowerCase();
      if (!t || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const sameTag = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** `fn` over the tags of every meeting, open or only listed. */
const retag = (state: State, fn: (tags: string[]) => string[]): State => {
  const apply = <T extends { tags?: string[] }>(m: T): T => {
    if (!m.tags?.length) return m;
    const tags = uniqueTags(fn(m.tags));
    return tags.length === m.tags.length && tags.every((t, i) => t === m.tags![i]) ? m : { ...m, tags };
  };
  return {
    ...state,
    summaries: state.summaries.map(apply),
    open: Object.fromEntries(Object.entries(state.open).map(([id, m]) => [id, apply(m)])),
  };
};

/** Applies `fn` to an open meeting and keeps its sidebar summary in sync. */
const updateMeeting = (state: State, id: string, fn: (m: Meeting) => Meeting): State => {
  const current = state.open[id];
  if (!current) return state;
  const next = fn(current);
  const summary = summaryOf(next);
  return {
    ...state,
    open: { ...state.open, [id]: next },
    summaries: state.summaries.map((s) => (s.id === id ? summary : s)),
  };
};

const NO_PARTIAL: Record<Channel, string> = { mic: "", system: "" };

const recording = (state: State) => Object.values(state.open).find((m) => m.status === "recording");

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "loaded":
      return {
        ...state,
        summaries: action.summaries,
        open: action.open ?? {},
        selectedId: action.summaries[0]?.id ?? null,
        loaded: true,
      };
    case "opened":
      return { ...state, open: { ...state.open, [action.meeting.id]: action.meeting } };
    case "delete": {
      const summaries = state.summaries.filter((m) => m.id !== action.id);
      const { [action.id]: _removed, ...open } = state.open;
      const selectedId = state.selectedId === action.id ? (summaries[0]?.id ?? null) : state.selectedId;
      return { ...state, summaries, open, selectedId };
    }
    case "new":
      return {
        ...state,
        summaries: [summaryOf(action.meeting), ...state.summaries],
        open: { ...state.open, [action.meeting.id]: action.meeting },
        selectedId: action.meeting.id,
      };
    case "select":
      return { ...state, selectedId: action.id };
    case "jump":
      return {
        ...state,
        selectedId: action.meetingId,
        jump: { meetingId: action.meetingId, utteranceId: action.utteranceId, t: action.t, nonce: (state.jump?.nonce ?? 0) + 1 },
      };
    case "partial":
      return { ...state, partial: { ...state.partial, [action.channel]: action.text } };
    case "final": {
      const rec = recording(state);
      if (!rec) return state;
      // Finals from the two channels can arrive slightly out of order: keep the transcript sorted.
      return updateMeeting(state, rec.id, (m) => ({
        ...m,
        utterances: [...m.utterances, action.utterance].sort((a, b) => a.start - b.start),
      }));
    }
    case "tick": {
      const rec = recording(state);
      return rec ? updateMeeting(state, rec.id, (m) => ({ ...m, duration: action.duration })) : state;
    }
    case "stopped": {
      const rec = recording(state);
      return rec
        ? updateMeeting({ ...state, partial: NO_PARTIAL }, rec.id, (m) => ({ ...m, status: "done" }))
        : state;
    }
    case "postStage": {
      const previous = state.finalPass[action.id];
      const took = { ...previous?.took };
      if (previous && previous.stage !== action.stage) took[previous.stage] = (Date.now() - previous.startedAt) / 1000;
      const run: PostProcess = { stage: action.stage, steps: action.steps, estimateSeconds: action.estimateSeconds, startedAt: Date.now(), took, pausedAt: state.postPause ? Date.now() : undefined };
      return updateMeeting({ ...state, finalPass: { ...state.finalPass, [action.id]: run } }, action.id, (m) => ({ ...m, status: "processing" }));
    }
    case "postPaused": {
      const now = Date.now();
      const finalPass = Object.fromEntries(
        Object.entries(state.finalPass).map(([id, run]) => {
          if (action.reason) return [id, run.pausedAt ? run : { ...run, pausedAt: now }];
          // The time spent waiting doesn't count towards the estimate.
          return [id, run.pausedAt ? { ...run, startedAt: run.startedAt + (now - run.pausedAt), pausedAt: undefined } : run];
        }),
      );
      return { ...state, finalPass, postPause: action.reason };
    }
    case "speakersVerified":
      return updateMeeting(state, action.id, (m) => relabel(m, action.base, action.assignments));
    case "retranscribed": {
      const byStart = new Map(action.texts.map((t) => [t.start.toFixed(2), t.text]));
      const inChannel = (speaker: number) => (action.base >= SYSTEM_SPEAKER_BASE) === (speaker >= SYSTEM_SPEAKER_BASE);
      return updateMeeting(state, action.id, (m) => ({
        ...m,
        // Lines the user corrected keep their text.
        utterances: m.utterances.map((u) => {
          const text = inChannel(u.speaker) && !u.edited ? byStart.get(u.start.toFixed(2)) : undefined;
          return text && text !== u.text ? { ...u, text } : u;
        }),
      }));
    }
    case "punctuated": {
      const byId = new Map(action.changes.map((c) => [c.utteranceId, c]));
      return updateMeeting(state, action.id, (m) => ({
        ...m,
        utterances: m.utterances.map((u) => {
          const c = byId.get(u.id);
          return c && !u.edited && u.text === c.from && c.to !== u.text ? { ...u, text: c.to } : u;
        }),
      }));
    }
    case "cover":
      return updateMeeting(state, action.id, (m) => ({ ...m, cover: action.cover, title: action.title ?? m.title }));
    case "tags":
      return updateMeeting(state, action.id, (m) => ({ ...m, tags: uniqueTags(action.tags) }));
    case "renameTag": {
      // Onto an existing tag, take its spelling.
      const existing = state.summaries.flatMap((s) => s.tags ?? []).find((t) => sameTag(t, action.to) && !sameTag(t, action.from));
      const to = existing ?? action.to.trim();
      return retag(state, (tags) => tags.map((t) => (sameTag(t, action.from) ? to : t)));
    }
    case "deleteTag":
      return retag(state, (tags) => tags.filter((t) => !sameTag(t, action.name)));
    case "screen":
      return updateMeeting(state, action.id, (m) => ({ ...m, screens: [...(m.screens ?? []), action.screen] }));
    case "shares":
      return updateMeeting(state, action.id, (m) => ({ ...m, shares: action.shares }));
    case "removeScreen":
      return updateMeeting(state, action.id, (m) => ({ ...m, screens: (m.screens ?? []).filter((s) => s.path !== action.path) }));
    case "coverTasks":
      return updateMeeting(state, action.id, (m) => (m.cover ? { ...m, cover: { ...m.cover, tasks: action.tasks } } : m));
    case "postDone": {
      const { [action.id]: _done, ...finalPass } = state.finalPass;
      return updateMeeting({ ...state, finalPass }, action.id, (m) =>
        m.status === "processing" ? { ...m, status: "done" } : m,
      );
    }
    case "title":
      return updateMeeting(state, action.id, (m) => ({ ...m, title: action.title }));
    case "rename":
      return updateMeeting(state, action.id, (m) => {
        const next = { ...m, speakerNames: { ...m.speakerNames, [currentSpeaker(m, action.speaker, action.version)]: action.name } };
        if (!m.cover) return next;
        // The cover takes the new name too; if it was up to date, it still is.
        const cover = renameInCover(m.cover, renamedSpeakers(m, next));
        const basis = m.cover.basis && !coverOutdated(m) ? meetingBasis(next, coverLanguage(m.cover)) : m.cover.basis;
        return { ...next, cover: { ...cover, basis } };
      });
    case "reassign":
      return updateMeeting(state, action.id, (m) => ({
        ...m,
        utterances: m.utterances.map((u) =>
          u.id === action.utteranceId
            ? { ...u, speaker: currentSpeaker(m, action.speaker, action.version), speakerLocked: true }
            : u,
        ),
      }));
    case "edit":
      return updateMeeting(state, action.id, (m) => ({
        ...m,
        utterances: m.utterances.map((u) =>
          u.id === action.utteranceId && u.text !== action.text
            ? { ...u, text: action.text, edited: true }
            : u,
        ),
      }));
    case "audio":
      return updateMeeting(state, action.id, (m) => ({ ...m, audioPath: action.path }));
    case "notes":
      return updateMeeting(state, action.id, (m) => ({ ...m, notesDoc: action.doc }));
  }
}

/**
 * Applies the final pass' speakers to the utterances of one channel (`base` 0 = mic,
 * SYSTEM_SPEAKER_BASE = system). Every speaker of the meeting follows the verified speaker that
 * took over most of their lines: their name moves with them, and so do the lines set by hand
 * (`speakerLocked`), which otherwise keep their person.
 */
export function relabel(m: Meeting, base: number, assignments: Assignment[]): Meeting {
  const inChannel = (speaker: number) => (base >= SYSTEM_SPEAKER_BASE ? speaker >= SYSTEM_SPEAKER_BASE : speaker < SYSTEM_SPEAKER_BASE);
  const byStart = new Map(assignments.map((a) => [a.start.toFixed(2), a.speaker]));
  const verified = (u: Utterance) => (!inChannel(u.speaker) || u.speakerLocked ? undefined : byStart.get(u.start.toFixed(2)));

  // old speaker → new speaker → number of lines
  const votes = new Map<number, Map<number, number>>();
  for (const u of m.utterances) {
    const next = verified(u);
    if (next === undefined) continue;
    const v = votes.get(u.speaker) ?? new Map<number, number>();
    v.set(next, (v.get(next) ?? 0) + 1);
    votes.set(u.speaker, v);
  }
  // Each old speaker maps to its majority new speaker (one old speaker per new one, strongest first).
  const follow = new Map<number, number>();
  const taken = new Set<number>();
  const ranked = [...votes.entries()]
    .flatMap(([old, v]) => [...v.entries()].map(([next, n]) => ({ old, next, n })))
    .sort((a, b) => b.n - a.n);
  for (const { old, next } of ranked) {
    if (follow.has(old) || taken.has(next)) continue;
    follow.set(old, next);
    taken.add(next);
  }
  // Old speakers that lost every line (e.g. only hand-set lines left) get an unused id.
  const ids = [...m.utterances.map((u) => u.speaker), ...assignments.map((a) => a.speaker)];
  let fresh = Math.max(base, ...ids) + 1;
  const verifiedIds = new Set(assignments.map((a) => a.speaker));
  const target = (old: number) => {
    if (!follow.has(old)) follow.set(old, taken.has(old) || verifiedIds.has(old) ? fresh++ : old);
    taken.add(follow.get(old)!);
    return follow.get(old)!;
  };

  const utterances = m.utterances.map((u) => {
    if (!inChannel(u.speaker)) return u;
    const next = u.speakerLocked ? target(u.speaker) : (verified(u) ?? target(u.speaker));
    return next === u.speaker ? u : { ...u, speaker: next };
  });
  const speakerNames: Record<number, string> = {};
  for (const [id, name] of Object.entries(m.speakerNames)) {
    const old = Number(id);
    speakerNames[inChannel(old) ? target(old) : old] = name;
  }
  // Every old number of this channel → its new number (for actions started before this point).
  const speakerRemap: Record<number, number> = {};
  for (const old of new Set([...m.utterances.map((u) => u.speaker), ...Object.keys(m.speakerNames).map(Number)])) {
    if (inChannel(old)) speakerRemap[old] = target(old);
  }
  return { ...m, utterances, speakerNames, speakersVersion: (m.speakersVersion ?? 0) + 1, speakerRemap };
}

/** A speaker number chosen on an older numbering, translated to the current one. */
function currentSpeaker(m: Meeting, speaker: number, version: number): number {
  return version < (m.speakersVersion ?? 0) ? (m.speakerRemap?.[speaker] ?? speaker) : speaker;
}

/** The smallest set of changes that turns `saved` into `next` (objects are compared by identity). */
function diff(saved: Meeting, next: Meeting): backend.Changes | null {
  const changes: backend.Changes = {};
  const meta: backend.Changes["meta"] = {};
  if (saved.title !== next.title) meta.title = next.title;
  if (saved.duration !== next.duration) meta.duration = next.duration;
  if (saved.status !== next.status) meta.status = next.status;
  if (saved.speakerNames !== next.speakerNames) meta.speakerNames = next.speakerNames;
  if (saved.sources !== next.sources) meta.sources = next.sources;
  if (saved.language !== next.language && next.language) meta.language = next.language;
  if (saved.audioPath !== next.audioPath) meta.audioPath = next.audioPath ?? null;
  if (saved.cover !== next.cover) meta.cover = next.cover ?? null;
  if (saved.guests !== next.guests && next.guests) meta.guests = next.guests;
  if (saved.screens !== next.screens && next.screens) meta.screens = next.screens;
  if (saved.tags !== next.tags && next.tags) meta.tags = next.tags;
  if (saved.shares !== next.shares && next.shares) meta.shares = next.shares;
  if (Object.keys(meta).length) changes.meta = meta;
  if (saved.utterances !== next.utterances) {
    const before = new Map(saved.utterances.map((u) => [u.id, u]));
    const changed = next.utterances.filter((u) => before.get(u.id) !== u);
    if (changed.length) changes.utterances = changed;
  }
  if (saved.notesDoc !== next.notesDoc && next.notesDoc) {
    changes.notes = { doc: next.notesDoc, blocks: notesFromDoc(next.notesDoc).map(({ t, text }) => ({ t, text })) };
  }
  return Object.keys(changes).length ? changes : null;
}

function loadLocal(): Meeting[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

const EMPTY: State = { summaries: [], open: {}, selectedId: null, partial: NO_PARTIAL, loaded: false, jump: null, finalPass: {}, postPause: null };
/** Status changes save right away; everything else (ticks, typing) is batched. */
const SAVE_DELAY_MS = 1500;

export function useMeetings() {
  const [state, dispatch] = useReducer(reducer, EMPTY);
  /** Last version of each open meeting known to be in the database. */
  const saved = useRef(new Map<string, Meeting>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const latest = useRef(state);
  latest.current = state;

  // Load summaries (or, in a plain browser, every meeting from localStorage).
  useEffect(() => {
    (async () => {
      if (!backend.isTauri()) {
        const meetings = loadLocal().map((m) => ({ ...m, status: "done" as const }));
        dispatch({ type: "loaded", summaries: meetings.map(summaryOf), open: Object.fromEntries(meetings.map((m) => [m.id, m])) });
        return;
      }
      const legacy = loadLocal();
      if (legacy.length) {
        // One-time move from the webview's storage into the database.
        for (const m of legacy) await backend.putMeeting(m);
        localStorage.removeItem(STORAGE_KEY);
      }
      const summaries = await backend.listMeetings();
      // A recording or final pass can't survive an app restart (or a crash).
      for (const s of summaries.filter((s) => s.status !== "done")) {
        s.status = "done";
        await backend.applyChanges(s.id, { meta: { status: "done" } });
      }
      dispatch({ type: "loaded", summaries });
    })().catch((e) => {
      console.error(e);
      dispatch({ type: "loaded", summaries: [] });
    });
  }, []);

  // Open the selected meeting's content when needed.
  useEffect(() => {
    const id = state.selectedId;
    if (!id || state.open[id] || !backend.isTauri()) return;
    backend
      .getMeeting(id)
      .then((m) => {
        if (!m) return;
        saved.current.set(m.id, m);
        dispatch({ type: "opened", meeting: m });
      })
      .catch((e) => console.error("open failed", e));
  }, [state.selectedId, state.open]);

  // Persist changes.
  useEffect(() => {
    if (!state.loaded) return;
    if (!backend.isTauri()) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.values(state.open)));
      } catch {
        /* storage full or unavailable: keep working in memory */
      }
      return;
    }
    const flush = (id: string) => {
      timers.current.delete(id);
      const next = latest.current.open[id];
      const before = saved.current.get(id);
      if (!next || !before) return;
      const changes = diff(before, next);
      saved.current.set(id, next);
      if (changes) backend.applyChanges(id, changes).catch((e) => console.error("save failed", e));
    };
    for (const m of Object.values(state.open)) {
      const before = saved.current.get(m.id);
      if (before === m) continue;
      if (!before) {
        // A new meeting (just started recording): create it whole.
        saved.current.set(m.id, m);
        backend.putMeeting(m).catch((e) => console.error("save failed", e));
        continue;
      }
      clearTimeout(timers.current.get(m.id));
      if (before.status !== m.status) flush(m.id);
      else timers.current.set(m.id, setTimeout(() => flush(m.id), SAVE_DELAY_MS));
    }
  }, [state.open, state.loaded]);

  const forget = (id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    saved.current.delete(id);
  };

  return [state, dispatch, forget] as const;
}
