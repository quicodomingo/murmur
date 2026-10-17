import type { JSONContent } from "@tiptap/core";

export type Utterance = {
  id: string;
  start: number; // seconds since the recording started
  end: number;
  speaker: number;
  text: string;
  edited?: boolean;
  /** Speaker set by hand: the final pass leaves it alone. */
  speakerLocked?: boolean;
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
  /** "processing": the final pass (speaker check) is running after the recording. */
  status: "recording" | "processing" | "done";
  utterances: Utterance[];
  speakerNames: Record<number, string>;
  /** Legacy single-line notes; new meetings use notesDoc. */
  notes: Note[];
  /** Rich notes (Tiptap JSON); blocks carry `attrs.t`, the meeting time they were written at. */
  notesDoc?: JSONContent;
  audioPath?: string | null;
  /**
   * Bumped each time the final pass renumbers speakers; `speakerRemap` maps the previous numbers
   * to the new ones, so an action started on the old numbering (a menu left open) still hits the
   * right person.
   */
  speakersVersion?: number;
  speakerRemap?: Record<number, number>;
  /** Which inputs were recorded; decides default speaker names ("Tu" for the mic in a call). */
  sources?: { mic: boolean; system: boolean };
  /** Written by the local language model after the recording (lib/cover.ts). */
  cover?: Cover | null;
  /** Guests of the calendar event it was recorded for: names offered for the speakers. */
  guests?: string[];
};

/** The meeting's cover. Times are seconds into the meeting (null: the model gave none or a bad one). */
export type Cover = {
  generatedAt: number;
  /** What the model read (lib/cover.ts coverBasis): when it differs, the cover is out of date. */
  basis?: string;
  excerpt?: string;
  tone?: { label: string; reason: string };
  summary?: string[];
  decisions?: { text: string; t: number | null }[];
  /** `manual`: added by hand on the cover (kept when the cover is generated again). */
  tasks?: { text: string; owner: string | null; when: string | null; t: number | null; done?: boolean; manual?: boolean }[];
  parts?: { t: number; title: string; points: string[] }[];
  /** Parts that could not be generated, by prompt id. */
  errors?: Record<string, string>;
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

/** What runs after a recording, in this order. */
export type PostStage = "speakers" | "punctuation" | "cover";

/** Final pass events (lib.rs final_pass). */
export type FinalPassStarted = { meetingId: string; stage: "speakers"; estimateSeconds: number };
export type Assignment = { start: number; speaker: number };
export type FinalPassSpeakers = { meetingId: string; base: number; assignments: Assignment[] };
export type FinalPassDone = { meetingId: string; error: string | null };

/** Optional models (models.rs). */
export type ModelId = "transcription" | "punctuation" | "llm";
export type ModelStatus = { id: ModelId; installed: boolean; bytes: number; downloaded: number; downloadable: boolean; required: boolean };

/** What the local language model is doing (lib.rs run_llm). */
export type LlmProgress = { job: string; step: string; done: number; total: number; readSeconds: number | null };
export type LlmTask = { id: string; prompt: string; maxTokens: number; schema: string | null };
export type LlmResult = { id: string; text: string | null; error: string | null; seconds: number; tokens: number };
