import { Extension, type JSONContent } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import { clock } from "./format";
import type { Meeting, Note } from "./types";

/** Blocks that carry the meeting time they were written at. */
const STAMPED = ["paragraph", "heading", "listItem", "taskItem"];
/** Paragraphs inside list items are covered by their item's stamp. */
const TOP_LEVEL_ONLY = new Set(["paragraph", "heading"]);

/**
 * Stamps each block with the meeting time (`t`, seconds) when it first gets text. The stamp is
 * not copied when a block is split (Enter), so every new line gets its own time.
 */
export const BlockTime = Extension.create<{ now: () => number }>({
  name: "blockTime",
  addOptions() {
    return { now: () => 0 };
  },
  addGlobalAttributes() {
    return [
      {
        types: STAMPED,
        attributes: {
          t: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => (el.hasAttribute("data-t") ? Number(el.getAttribute("data-t")) : null),
            renderHTML: (attrs) => (attrs.t == null ? {} : { "data-t": attrs.t, "data-time": clock(attrs.t) }),
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    const now = () => this.options.now();
    return [
      new Plugin({
        key: new PluginKey("blockTime"),
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((t) => t.docChanged)) return null;
          let tr = state.tr;
          let changed = false;
          state.doc.descendants((node, pos) => {
            if (!STAMPED.includes(node.type.name) || node.attrs.t != null || !node.textContent.trim()) return;
            if (TOP_LEVEL_ONLY.has(node.type.name) && state.doc.resolve(pos).depth > 0) return;
            tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, t: Math.floor(now()) });
            changed = true;
          });
          return changed ? tr : null;
        },
      }),
    ];
  },
});

const text = (node: JSONContent): string =>
  node.text ?? (node.content ?? []).map(text).join(node.type === "paragraph" ? "" : " ");

/** Flat list of stamped blocks, in document order: drives the transcript's note markers. */
export function notesFromDoc(doc: JSONContent | undefined): Note[] {
  const out: Note[] = [];
  const walk = (node: JSONContent, insideItem: boolean) => {
    // A paragraph stamped before it was turned into a list item: its item's stamp wins.
    const covered = insideItem && TOP_LEVEL_ONLY.has(node.type ?? "");
    if (node.attrs?.t != null && STAMPED.includes(node.type ?? "") && !covered) {
      out.push({ id: `b${out.length}`, t: node.attrs.t, text: text(node).trim() });
    }
    const item = node.type === "listItem" || node.type === "taskItem";
    node.content?.forEach((child) => walk(child, insideItem || item));
  };
  if (doc) walk(doc, false);
  return out;
}

/** Older meetings stored notes as single lines: turn them into a document. */
export function notesDoc(meeting: Meeting): JSONContent {
  if (meeting.notesDoc) return meeting.notesDoc;
  return {
    type: "doc",
    content: meeting.notes.length
      ? meeting.notes.map((n) => ({ type: "paragraph", attrs: { t: n.t }, content: [{ type: "text", text: n.text }] }))
      : [{ type: "paragraph" }],
  };
}

// --- Markdown export -------------------------------------------------------------------------

function inline(nodes: JSONContent[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === "hardBreak") return "  \n";
      let s = n.text ?? "";
      for (const mark of n.marks ?? []) {
        if (mark.type === "bold") s = `**${s}**`;
        else if (mark.type === "italic") s = `*${s}*`;
        else if (mark.type === "underline") s = `<u>${s}</u>`;
        else if (mark.type === "strike") s = `~~${s}~~`;
        else if (mark.type === "code") s = `\`${s}\``;
        else if (mark.type === "link") s = `[${s}](${mark.attrs?.href ?? ""})`;
      }
      return s;
    })
    .join("");
}

const stamp = (node: JSONContent) => (node.attrs?.t != null ? `[${clock(node.attrs.t)}] ` : "");

function block(node: JSONContent, depth = 0, headingOffset = 0): string[] {
  const pad = "  ".repeat(depth);
  switch (node.type) {
    case "heading":
      return [`${"#".repeat((node.attrs?.level ?? 1) + headingOffset)} ${inline(node.content)}`, ""];
    case "paragraph":
      return node.content?.length ? [`${stamp(node)}${inline(node.content)}`, ""] : [];
    case "blockquote":
      return (node.content ?? []).flatMap((c) => block(c, 0, headingOffset)).map((l) => (l ? `> ${l}` : l));
    case "bulletList":
    case "orderedList":
    case "taskList": {
      const lines = (node.content ?? []).flatMap((item, i) => {
        const marker =
          node.type === "orderedList" ? `${i + 1}.` : node.type === "taskList" ? `- [${item.attrs?.checked ? "x" : " "}]` : "-";
        const [first, ...rest] = item.content ?? [];
        return [
          `${pad}${marker} ${stamp(item)}${inline(first?.content)}`,
          ...rest.flatMap((child) => block(child, depth + 1).filter(Boolean)),
        ];
      });
      return depth === 0 ? [...lines, ""] : lines;
    }
    default:
      return (node.content ?? []).flatMap((c) => block(c, depth, headingOffset));
  }
}

/** `headingOffset` demotes headings, e.g. 2 when the notes sit under a "## Notes" section. */
export function docToMarkdown(doc: JSONContent | undefined, headingOffset = 0): string {
  if (!doc) return "";
  return (doc.content ?? []).flatMap((n) => block(n, 0, headingOffset)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
