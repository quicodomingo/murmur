import { useEffect, useReducer, useRef } from "react";

import type { JSONContent } from "@tiptap/core";

import * as backend from "./backend";
import type { Channel, Meeting, Utterance } from "./types";

// In the app, meetings are JSON files written by Rust (storage.rs). In a plain browser (UI
// development) and for migrating older data, the webview's localStorage is used.
const STORAGE_KEY = "transcriptor.meetings.v1";

export type State = {
  meetings: Meeting[];
  selectedId: string | null;
  partial: Record<Channel, string>;
  loaded: boolean;
};

export type Action =
  | { type: "loaded"; meetings: Meeting[] }
  | { type: "delete"; id: string }
  | { type: "new"; meeting: Meeting }
  | { type: "select"; id: string }
  | { type: "partial"; channel: Channel; text: string }
  | { type: "final"; utterance: Utterance }
  | { type: "tick"; duration: number }
  | { type: "stopped" }
  | { type: "title"; id: string; title: string }
  | { type: "rename"; id: string; speaker: number; name: string }
  | { type: "reassign"; id: string; utteranceId: string; speaker: number }
  | { type: "edit"; id: string; utteranceId: string; text: string }
  | { type: "notes"; id: string; doc: JSONContent }
  | { type: "audio"; id: string; path: string | null };

const updateMeeting = (state: State, id: string, fn: (m: Meeting) => Meeting): State => ({
  ...state,
  meetings: state.meetings.map((m) => (m.id === id ? fn(m) : m)),
});

const NO_PARTIAL: Record<Channel, string> = { mic: "", system: "" };

const recording = (state: State) => state.meetings.find((m) => m.status === "recording");

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "loaded":
      return { ...state, meetings: action.meetings, selectedId: action.meetings[0]?.id ?? null, loaded: true };
    case "delete": {
      const meetings = state.meetings.filter((m) => m.id !== action.id);
      const selectedId = state.selectedId === action.id ? (meetings[0]?.id ?? null) : state.selectedId;
      return { ...state, meetings, selectedId };
    }
    case "new":
      return { ...state, meetings: [action.meeting, ...state.meetings], selectedId: action.meeting.id };
    case "select":
      return { ...state, selectedId: action.id };
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
    case "title":
      return updateMeeting(state, action.id, (m) => ({ ...m, title: action.title }));
    case "rename":
      return updateMeeting(state, action.id, (m) => ({
        ...m,
        speakerNames: { ...m.speakerNames, [action.speaker]: action.name },
      }));
    case "reassign":
      return updateMeeting(state, action.id, (m) => ({
        ...m,
        utterances: m.utterances.map((u) =>
          u.id === action.utteranceId ? { ...u, speaker: action.speaker } : u,
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

function loadLocal(): Meeting[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

const EMPTY: State = { meetings: [], selectedId: null, partial: NO_PARTIAL, loaded: false };
/** Recording state changes save right away; everything else is batched. */
const SAVE_DELAY_MS = 1500;

export function useMeetings() {
  const [state, dispatch] = useReducer(reducer, EMPTY);
  const saved = useRef(new Map<string, Meeting>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    (async () => {
      let meetings: Meeting[];
      if (backend.isTauri()) {
        meetings = await backend.listMeetings();
        const legacy = loadLocal();
        if (legacy.length) {
          // One-time move from the webview's storage to files.
          const known = new Set(meetings.map((m) => m.id));
          for (const m of legacy.filter((m) => !known.has(m.id))) await backend.saveMeeting(m);
          meetings = await backend.listMeetings();
          localStorage.removeItem(STORAGE_KEY);
        }
      } else {
        meetings = loadLocal();
      }
      // A recording can't survive an app restart.
      meetings.forEach((m) => (m.status = "done"));
      meetings.forEach((m) => saved.current.set(m.id, m));
      dispatch({ type: "loaded", meetings });
    })().catch((e) => {
      console.error(e);
      dispatch({ type: "loaded", meetings: [] });
    });
  }, []);

  useEffect(() => {
    if (!state.loaded) return;
    if (!backend.isTauri()) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.meetings));
      } catch {
        /* storage full or unavailable: keep working in memory */
      }
      return;
    }
    // The reducer only creates a new object for meetings that changed.
    for (const m of state.meetings) {
      const previous = saved.current.get(m.id);
      if (previous === m) continue;
      clearTimeout(timers.current.get(m.id));
      const write = () => {
        timers.current.delete(m.id);
        saved.current.set(m.id, m);
        backend.saveMeeting(m).catch((e) => console.error("save failed", e));
      };
      if (!previous || previous.status !== m.status) write();
      else timers.current.set(m.id, setTimeout(write, SAVE_DELAY_MS));
    }
  }, [state.meetings, state.loaded]);

  return [state, dispatch] as const;
}
