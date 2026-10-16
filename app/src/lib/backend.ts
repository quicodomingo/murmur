import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { JSONContent } from "@tiptap/core";

import type { EngineEvent, Meeting, MeetingSummary, SearchHit, Utterance } from "./types";

export const isTauri = () => "__TAURI_INTERNALS__" in window;

export const prepare = () => invoke<void>("prepare");

export const startRecording = (opts: {
  meetingId: string;
  mic: boolean;
  micDevice: string | null;
  system: boolean;
  saveAudio: boolean;
  maxSpeakers: number;
  threshold: number;
}) => invoke<string | null>("start_recording", opts);

export const stopRecording = () => invoke<void>("stop_recording");

/** One batch of edits to a meeting (db.rs `Changes`). */
export type Changes = {
  meta?: Partial<Pick<Meeting, "title" | "duration" | "status" | "speakerNames" | "sources">> & { audioPath?: string | null };
  utterances?: Utterance[];
  notes?: { doc: JSONContent; blocks: { t: number; text: string }[] };
};

export const listMeetings = () => invoke<MeetingSummary[]>("list_meetings");
export const getMeeting = (id: string) => invoke<Meeting | null>("get_meeting", { id });
export const putMeeting = (meeting: Meeting) => invoke<void>("put_meeting", { meeting });
export const applyChanges = (id: string, changes: Changes) => invoke<void>("apply_changes", { id, changes });
export const searchMeetings = (query: string) => invoke<SearchHit[]>("search_meetings", { query });
export const deleteMeeting = (id: string) => invoke<void>("delete_meeting", { id });
export const listMicrophones = () => invoke<string[]>("list_microphones");
export const writeExport = (path: string, contents: Uint8Array) =>
  invoke<void>("write_export", { path, contents: Array.from(contents) });

export async function subscribe(handlers: {
  onEvent: (e: EngineEvent) => void;
  onLevel: (rms: number) => void;
  onDone: () => void;
  onError: (message: string) => void;
}): Promise<UnlistenFn> {
  const unlisten = await Promise.all([
    listen<EngineEvent>("transcript", (e) => handlers.onEvent(e.payload)),
    listen<{ rms: number }>("level", (e) => handlers.onLevel(e.payload.rms)),
    listen("transcript-done", () => handlers.onDone()),
    listen<string>("transcript-error", (e) => handlers.onError(e.payload)),
  ]);
  return () => unlisten.forEach((u) => u());
}
