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

/** How far a paragraph or heading can be indented with Tab. */
export const MAX_INDENT = 6;
const INDENTED = ["paragraph", "heading"];

/**
 * Tab indents and Shift-Tab outdents. In a list it nests the item (or un-nests it); elsewhere it
 * indents the selected paragraphs and headings, one step per press. Backspace at the start of an
 * indented line outdents it first. Tab never leaves the editor; Shift-Tab does when there's nothing
 * left to outdent, so the keyboard can still get out.
 */
export const Indent = Extension.create({
  name: "indent",
  // Before the editor's own Backspace (which would join the line with the one above).
  priority: 200,
  addGlobalAttributes() {
    return [
      {
        types: INDENTED,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => Math.min(MAX_INDENT, Number(el.getAttribute("data-indent")) || 0),
            renderHTML: (attrs) => (attrs.indent ? { "data-indent": attrs.indent } : {}),
          },
        },
      },
    ];
  },
  addKeyboardShortcuts() {
    const shift = (by: number) => {
      const { state, view } = this.editor;
      const { from, to } = state.selection;
      const tr = state.tr;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!INDENTED.includes(node.type.name)) return;
        // Paragraphs inside list items move with their item.
        if (state.doc.resolve(pos).depth > 0) return false;
        const indent = Math.max(0, Math.min(MAX_INDENT, (node.attrs.indent ?? 0) + by));
        if (indent !== node.attrs.indent) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent });
        return false;
      });
      if (!tr.docChanged) return false;
      view.dispatch(tr);
      return true;
    };
    const item = () => (this.editor.isActive("taskItem") ? "taskItem" : this.editor.isActive("listItem") ? "listItem" : null);
    const inList = () => item() != null;
    return {
      Tab: () => {
        const type = item();
        if (type) this.editor.commands.sinkListItem(type);
        else shift(1);
        return true;
      },
      // In a list, the list's own Shift-Tab lifts the item.
      "Shift-Tab": () => (inList() ? false : shift(-1)),
      Backspace: () => {
        const { selection } = this.editor.state;
        const parent = selection.$from.parent;
        if (!selection.empty || selection.$from.parentOffset > 0 || !parent.attrs.indent || inList()) return false;
        return shift(-1);
      },
    };
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
/** Markdown has no indented paragraphs (leading spaces make code): non-breaking spaces show it. */
const indentPad = (node: JSONContent) => "\u00a0".repeat(4 * (node.attrs?.indent ?? 0));

function block(node: JSONContent, depth = 0, headingOffset = 0): string[] {
  const pad = "  ".repeat(depth);
  switch (node.type) {
    case "heading":
      return [`${"#".repeat((node.attrs?.level ?? 1) + headingOffset)} ${inline(node.content)}`, ""];
    case "paragraph":
      return node.content?.length ? [`${indentPad(node)}${stamp(node)}${inline(node.content)}`, ""] : [];
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
