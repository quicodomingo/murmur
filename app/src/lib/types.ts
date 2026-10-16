import type { JSONContent } from "@tiptap/core";

export type Utterance = {
  id: string;
  start: number; // seconds since the recording started
  end: number;
  speaker: number;
  text: string;
  edited?: boolean;
};

export type Note = {
  id: string;
  t: number; // seconds since the recording started
  text: string;
};

export type Meeting = {
  id: string;
  title: string;
  createdAt: number; // epoch ms
  duration: number; // seconds
  status: "recording" | "done";
  utterances: Utterance[];
  speakerNames: Record<number, string>;
  /** Legacy single-line notes; new meetings use notesDoc. */
  notes: Note[];
  /** Rich notes (Tiptap JSON); blocks carry `attrs.t`, the meeting time they were written at. */
  notesDoc?: JSONContent;
  audioPath?: string | null;
  /** Which inputs were recorded; decides default speaker names ("Tu" for the mic in a call). */
  sources?: { mic: boolean; system: boolean };
};

/** What the sidebar shows; the full meeting is loaded when opened. */
export type MeetingSummary = Pick<Meeting, "id" | "title" | "createdAt" | "duration" | "status">;

/** A full-text search result (db.rs `Hit`). Matches are wrapped in \u0002 … \u0003. */
export type SearchHit = {
  meetingId: string;
  title: string;
  createdAt: number;
  kind: "title" | "utterance" | "note";
  ref: string;
  t: number;
  snippet: string;
};

/** Events emitted by the Rust engine on the "transcript" channel. */
export type Channel = "mic" | "system";

/** Speaker ids heard on the system channel start here (see engine.rs SYSTEM_SPEAKER_BASE). */
export const SYSTEM_SPEAKER_BASE = 100;

export type EngineEvent =
  | { type: "partial"; channel: Channel; text: string }
  | { type: "final"; id: number; channel: Channel; start: number; end: number; speaker: number; text: string };
