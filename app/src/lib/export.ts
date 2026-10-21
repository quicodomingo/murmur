import type { JSONContent } from "@tiptap/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { HeadingLevel as HeadingLevelT, Paragraph as ParagraphT, TextRun as TextRunT } from "docx";

import * as backend from "./backend";
import { clock, longDate, speakerName, toMarkdown } from "./format";
import { t } from "./i18n";
import { notesDoc } from "./notes";
import type { Meeting } from "./types";

export type ExportFormat = "md" | "docx";

const filter = (format: ExportFormat): { name: string; extensions: string[] } =>
  format === "md" ? { name: "Markdown", extensions: ["md"] } : { name: t("export:wordDocument"), extensions: ["docx"] };

/** Asks where to save, then writes the file. Returns false if the user cancelled. */
export async function exportMeeting(meeting: Meeting, format: ExportFormat): Promise<boolean> {
  const bytes =
    format === "md" ? new TextEncoder().encode(toMarkdown(meeting)) : new Uint8Array(await toDocx(meeting));
  const fileName = `${meeting.title.replace(/[/\\?%*:|"<>]/g, "-")}.${format}`;

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
