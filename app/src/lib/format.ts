import { docToMarkdown, notesDoc } from "./notes";
import { SYSTEM_SPEAKER_BASE, type Meeting } from "./types";

/** 0:42, 4:37, 1:04:22 — the transcript's timestamp style. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "52 min", "1 h 04 min" — the sidebar's duration style. */
export function duration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export function longDate(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString("ca-ES", { day: "numeric", month: "long", year: "numeric" });
  const time = d.toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time}`;
}

export function dayGroup(ms: number, now = Date.now()): string {
  const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86_400_000);
  if (days <= 0) return "Avui";
  if (days === 1) return "Ahir";
  if (days < 7) return "Aquesta setmana";
  return "Anteriors";
}

export function speakerName(meeting: Meeting, speaker: number): string {
  const named = meeting.speakerNames[speaker];
  if (named) return named;
  if (speaker >= SYSTEM_SPEAKER_BASE) return `Parlant ${speaker - SYSTEM_SPEAKER_BASE + 1}`;
  // In a call the microphone is the local side: first voice is you, others are in the room.
  if (meeting.sources?.mic && meeting.sources.system) return speaker === 0 ? "Tu" : `Sala ${speaker + 1}`;
  return `Parlant ${speaker + 1}`;
}

export function speakerIds(meeting: Meeting): number[] {
  const ids = new Set<number>(meeting.utterances.map((u) => u.speaker));
  Object.keys(meeting.speakerNames).forEach((k) => ids.add(Number(k)));
  return [...ids].sort((a, b) => a - b);
}

export function toMarkdown(meeting: Meeting): string {
  const lines = [`# ${meeting.title}`, "", longDate(meeting.createdAt), ""];
  // Same order as the Word export: notes first, then the transcript.
  const notes = docToMarkdown(notesDoc(meeting), 2);
  if (notes) lines.push("## Notes", "", notes, "");
  lines.push("## Transcripció", "");
  for (const u of meeting.utterances) {
    lines.push(`**[${clock(u.start)}] ${speakerName(meeting, u.speaker)}:** ${u.text}`, "");
  }
  return lines.join("\n");
}
