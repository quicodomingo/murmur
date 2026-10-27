import type { JSONContent } from "@tiptap/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { HeadingLevel as HeadingLevelT, Paragraph as ParagraphT, TextRun as TextRunT } from "docx";

import * as backend from "./backend";
import { namedSpeakers, renameInCover, talkTime, toneLabel } from "./cover";
import { clock, longDate, speakerName } from "./format";
import { t } from "./i18n";
import { docToMarkdown, notesDoc } from "./notes";
import type { Meeting } from "./types";

export type ExportFormat = "md" | "docx";

const filter = (format: ExportFormat): { name: string; extensions: string[] } =>
  format === "md" ? { name: "Markdown", extensions: ["md"] } : { name: t("export:wordDocument"), extensions: ["docx"] };

const safeName = (title: string) => title.replace(/[/\\?%*:|"<>]/g, "-").trim() || "Murmur";

/** Asks where to save, then writes the file. Returns false if the user cancelled. */
export async function exportMeeting(meeting: Meeting, format: ExportFormat): Promise<boolean> {
  const bytes =
    format === "md" ? new TextEncoder().encode(toMarkdown(meeting)) : new Uint8Array(await toDocx(meeting));
  const fileName = `${safeName(meeting.title)}.${format}`;

  if (!backend.isTauri()) {
    // UI development in a plain browser: download instead.
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes]));
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
    return true;
  }
  const path = await save({ defaultPath: fileName, filters: [filter(format)] });
  if (!path) return false;
  await backend.writeExport(path, bytes);
  return true;
}

/**
 * "Desa en Markdown": the meeting written to the chosen folder once it's done, named
 * "2026-10-27 Title.md" so the folder sorts by date. Saving again replaces the file.
 */
export async function saveMarkdown(meeting: Meeting, dir: string): Promise<string> {
  const d = new Date(meeting.createdAt);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const path = `${dir.replace(/\/+$/, "")}/${day} ${safeName(meeting.title)}.md`;
  await backend.writeExport(path, new TextEncoder().encode(toMarkdown(meeting)));
  return path;
}

// --- Markdown ------------------------------------------------------------------------------

/** The summary (the cover, with the speakers' current names), the notes and the transcript. */
export function toMarkdown(meeting: Meeting): string {
  const lines = [`# ${meeting.title}`, "", longDate(meeting.createdAt), ""];
  const c = meeting.cover && renameInCover(meeting.cover, namedSpeakers(meeting));
  if (c) {
    lines.push(`## ${t("app:viewCover")}`, "");
    if (c.excerpt) lines.push(c.excerpt, "");
    if (c.tone) lines.push(`**${t("cover:tone")}:** ${toneLabel(c.tone.label)}. ${c.tone.reason}`.trim(), "");
    const talk = talkTime(meeting);
    if (talk.length > 1) {
      lines.push(`**${t("cover:talk")}:** ${talk.map((s) => `${s.name} ${s.share < 0.01 ? "<1" : Math.round(s.share * 100)}%`).join(", ")}`, "");
    }
    if (c.summary?.length) lines.push(`### ${t("cover:summary")}`, "", ...c.summary.map((s) => `- ${s}`), "");
    if (c.decisions?.length) lines.push(`### ${t("cover:decisions")}`, "", ...c.decisions.map((d) => `- ${d.t != null ? `[${clock(d.t)}] ` : ""}${d.text}`), "");
    if (c.tasks?.length) {
      const who = (task: (typeof c.tasks)[number]) => [task.owner, task.when].filter(Boolean).join(", ");
      lines.push(`### ${t("cover:tasks")}`, "", ...c.tasks.map((task) => `- [${task.done ? "x" : " "}] ${task.text}${who(task) ? ` (${who(task)})` : ""}`), "");
    }
    if (c.parts?.length) {
      lines.push(`### ${t("cover:parts")}`, "");
      for (const p of c.parts) lines.push(`**[${clock(p.t)}] ${p.title}**`, ...p.points.map((x) => `- ${x}`), "");
    }
  }
  const notes = docToMarkdown(notesDoc(meeting), 2);
  if (notes) lines.push(`## ${t("export:notes")}`, "", notes, "");
  lines.push(`## ${t("export:transcript")}`, "");
  for (const u of meeting.utterances) {
    lines.push(`**[${clock(u.start)}] ${speakerName(meeting, u.speaker)}:** ${u.text}`, "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

// --- Word ----------------------------------------------------------------------------------
// `docx` is large: it's loaded only when a Word export is requested.

type Docx = typeof import("docx");

function runs(d: Docx, nodes: JSONContent[] = []): TextRunT[] {
  const { TextRun } = d;
  return nodes.map((n) => {
    if (n.type === "hardBreak") return new TextRun({ text: "", break: 1 });
    const marks = new Set((n.marks ?? []).map((m) => m.type));
    return new TextRun({
      text: n.text ?? "",
      bold: marks.has("bold"),
      italics: marks.has("italic"),
      underline: marks.has("underline") ? {} : undefined,
      strike: marks.has("strike"),
    });
  });
}

function notesParagraphs(d: Docx, node: JSONContent, level = 0): ParagraphT[] {
  const { Paragraph, TextRun, HeadingLevel } = d;
  const headings: (typeof HeadingLevelT)[keyof typeof HeadingLevelT][] = [HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
  switch (node.type) {
    case "heading":
      return [new Paragraph({ heading: headings[(node.attrs?.level ?? 1) - 1], children: runs(d, node.content) })];
    case "paragraph":
      return node.content?.length ? [new Paragraph({ children: runs(d, node.content) })] : [];
    case "bulletList":
    case "orderedList":
    case "taskList":
      return (node.content ?? []).flatMap((item, i) => {
        const [first, ...rest] = item.content ?? [];
        const prefix =
          node.type === "orderedList" ? `${i + 1}. ` : node.type === "taskList" ? (item.attrs?.checked ? "☑ " : "☐ ") : "";
        const head = new Paragraph({
          children: [new TextRun(prefix), ...runs(d, first?.content)],
          ...(node.type === "orderedList" || node.type === "taskList" ? { indent: { left: 360 * (level + 1) } } : { bullet: { level } }),
        });
        return [head, ...rest.flatMap((child) => notesParagraphs(d, child, level + 1))];
      });
    default:
      return (node.content ?? []).flatMap((c) => notesParagraphs(d, c, level));
  }
}

export async function toDocx(meeting: Meeting): Promise<ArrayBuffer> {
  const d = await import("docx");
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = d;
  const transcript = meeting.utterances.map(
    (u) =>
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({ text: `[${clock(u.start)}] ${speakerName(meeting, u.speaker)}: `, bold: true }),
          new TextRun(u.text),
        ],
      }),
  );
  const notes = notesParagraphs(d, notesDoc(meeting));
  const doc = new Document({
    creator: "Murmur",
    title: meeting.title,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(meeting.title)] }),
          new Paragraph({ children: [new TextRun({ text: longDate(meeting.createdAt), color: "6E6E73" })] }),
          ...(notes.length ? [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t("export:notes"))] }), ...notes] : []),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t("export:transcript"))] }),
          ...transcript,
        ],
      },
    ],
  });
  return (await Packer.toBlob(doc)).arrayBuffer();
}
