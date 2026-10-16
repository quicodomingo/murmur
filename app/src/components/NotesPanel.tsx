import { useEffect, useRef } from "react";
import type { JSONContent } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading1, Heading2, Heading3, Italic, List, ListChecks, ListOrdered, Maximize2, Minimize2, Pilcrow, Strikethrough, Underline } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BlockTime } from "@/lib/notes";
import { cn } from "@/lib/utils";

/** Stamped blocks as rendered, in the same order as notesFromDoc(). */
const STAMP_SELECTOR = "[data-t]:not(li [data-t]:is(p, h1, h2, h3))";

type Props = {
  meetingId: string;
  doc: JSONContent;
  now: number; // seconds into the meeting, stamped on new blocks
  hoveredNote: string | null;
  onHoverNote: (id: string | null) => void;
  onChange: (doc: JSONContent) => void;
  /** "side": next to the transcript, resizable. "full": takes the whole content area. */
  mode: "side" | "full";
  width: number;
  onResize: (width: number) => void;
  onToggleFull: () => void;
};

export const NOTES_WIDTH = { default: 320, min: 260, maxRatio: 0.6 };

export function NotesPanel(props: Props) {
  const { meetingId, doc, now, hoveredNote, onHoverNote, onChange, mode, width, onResize, onToggleFull } = props;
  const nowRef = useRef(now);
  nowRef.current = now;
  const container = useRef<HTMLDivElement>(null);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({ placeholder: "Escriu notes… Cada línia queda marcada amb el moment de la reunió." }),
        BlockTime.configure({ now: () => nowRef.current }),
      ],
      content: doc,
      onUpdate: ({ editor }) => onChange(editor.getJSON()),
      editorProps: { attributes: { class: "notes-editor selectable outline-none", "aria-label": "Notes de la reunió" } },
    },
    [meetingId], // a new editor per meeting; within a meeting the editor owns its content
  );

  // Link hover between a stamped block and its marker in the transcript (ids follow doc order).
  useEffect(() => {
    const blocks = container.current?.querySelectorAll(STAMP_SELECTOR) ?? [];
    blocks.forEach((el, i) => el.classList.toggle("is-linked", hoveredNote === `b${i}`));
  });

  const onMouseOver = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest(STAMP_SELECTOR);
    const blocks = [...(container.current?.querySelectorAll(STAMP_SELECTOR) ?? [])];
    const i = target ? blocks.indexOf(target) : -1;
    onHoverNote(i >= 0 ? `b${i}` : null);
  };

  const full = mode === "full";
  return (
    <aside
      className={cn("relative flex h-full flex-col bg-background", full ? "min-w-0 flex-1" : "shrink-0 border-l border-border")}
      style={full ? undefined : { width }}
    >
      {!full && <ResizeHandle width={width} onResize={onResize} />}
      <div className={cn("flex w-full flex-col", full && "mx-auto max-w-[760px]")}>
        <div className="flex h-11 items-center justify-between px-4">
          <h2 className="text-[13px] font-semibold">Notes</h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleFull}
                aria-label={full ? "Mostra també la transcripció" : "Amplia les notes"}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              >
                {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>{full ? "Mostra també la transcripció" : "Amplia les notes"}</TooltipContent>
          </Tooltip>
        </div>
        {editor && <Toolbar editor={editor} />}
      </div>
      <div
        ref={container}
        className="flex-1 cursor-text overflow-y-auto"
        onMouseOver={onMouseOver}
        onMouseLeave={() => onHoverNote(null)}
        onClick={() => editor?.commands.focus()}
      >
        <div className={cn("py-3 pl-14 pr-4", full && "mx-auto max-w-[760px] pb-24 pt-6")}>
          <EditorContent editor={editor} />
        </div>
      </div>
    </aside>
  );
}

/** Drag the panel's left edge to resize it; double-click resets; arrow keys nudge. */
function ResizeHandle({ width, onResize }: { width: number; onResize: (w: number) => void }) {
  const clamp = (w: number) =>
    Math.round(Math.min(Math.max(w, NOTES_WIDTH.min), window.innerWidth * NOTES_WIDTH.maxRatio));
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const move = (ev: PointerEvent) => onResize(clamp(startWidth + startX - ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Amplada de les notes"
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onResize(NOTES_WIDTH.default)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onResize(clamp(width + 20));
        if (e.key === "ArrowRight") onResize(clamp(width - 20));
      }}
      className="group absolute inset-y-0 -left-[3px] z-10 w-[6px] cursor-col-resize outline-none"
    >
      <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary group-active:bg-primary" />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      paragraph: e.isActive("paragraph") && !e.isActive("bulletList") && !e.isActive("orderedList") && !e.isActive("taskList"),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
    }),
  });
  const chain = () => editor.chain().focus();
  const groups: { label: string; key: string; icon: typeof Bold; active: boolean; run: () => void }[][] = [
    [
      { label: "Text", key: "", icon: Pilcrow, active: s.paragraph, run: () => chain().setParagraph().run() },
      { label: "Títol 1", key: "#", icon: Heading1, active: s.h1, run: () => chain().toggleHeading({ level: 1 }).run() },
      { label: "Títol 2", key: "##", icon: Heading2, active: s.h2, run: () => chain().toggleHeading({ level: 2 }).run() },
      { label: "Títol 3", key: "###", icon: Heading3, active: s.h3, run: () => chain().toggleHeading({ level: 3 }).run() },
    ],
    [
      { label: "Negreta", key: "⌘B", icon: Bold, active: s.bold, run: () => chain().toggleBold().run() },
      { label: "Cursiva", key: "⌘I", icon: Italic, active: s.italic, run: () => chain().toggleItalic().run() },
      { label: "Subratllat", key: "⌘U", icon: Underline, active: s.underline, run: () => chain().toggleUnderline().run() },
      { label: "Ratllat", key: "⌘⇧S", icon: Strikethrough, active: s.strike, run: () => chain().toggleStrike().run() },
    ],
    [
      { label: "Llista", key: "-", icon: List, active: s.bullet, run: () => chain().toggleBulletList().run() },
      { label: "Llista numerada", key: "1.", icon: ListOrdered, active: s.ordered, run: () => chain().toggleOrderedList().run() },
      { label: "Tasques", key: "[ ]", icon: ListChecks, active: s.task, run: () => chain().toggleTaskList().run() },
    ],
  ];
  return (
    <div className="flex items-center gap-1 border-b border-border px-3 pb-2" role="toolbar" aria-label="Format">
      {groups.map((group, gi) => (
        <div key={gi} className={cn("flex items-center", gi > 0 && "border-l border-border pl-1")}>
          {group.map(({ label, key, icon: Icon, active, run }) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={active}
                  onMouseDown={(e) => e.preventDefault()} // keep the editor's selection
                  onClick={run}
                  className={cn("grid size-6 place-items-center rounded-[5px] text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10", active && "bg-black/[0.08] text-foreground dark:bg-white/15")}
                >
                  <Icon className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {label}
                {key && <span className="ml-2 opacity-60">{key}</span>}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      ))}
    </div>
  );
}
