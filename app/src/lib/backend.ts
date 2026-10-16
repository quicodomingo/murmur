import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { EngineEvent, Meeting } from "./types";

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

export const listMeetings = () => invoke<Meeting[]>("list_meetings");
export const saveMeeting = (meeting: Meeting) => invoke<void>("save_meeting", { meeting });
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
