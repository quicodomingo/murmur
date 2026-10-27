import { useEffect, useRef } from "react";
import type { JSONContent } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useTranslation } from "react-i18next";
import { Bold, Heading1, Heading2, Heading3, Italic, List, ListChecks, ListOrdered, Maximize2, Minimize2, Pilcrow, Strikethrough, Underline } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t as translate } from "@/lib/i18n";
import { BlockTime } from "@/lib/notes";
import { ResizeHandle } from "@/components/SidePanel";
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
  /** Absent when the notes are the main panel (nothing to expand to). */
  onToggleFull?: () => void;
};


export function NotesPanel(props: Props) {
  const { meetingId, doc, now, hoveredNote, onHoverNote, onChange, mode, width, onResize, onToggleFull } = props;
  const { t } = useTranslation("notes");
  const nowRef = useRef(now);
  nowRef.current = now;
  const container = useRef<HTMLDivElement>(null);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
        TaskList,
        TaskItem.configure({ nested: true }),
        // A function, so it follows a language change without recreating the editor.
        Placeholder.configure({ placeholder: () => translate("notes:placeholder") }),
        BlockTime.configure({ now: () => nowRef.current }),
      ],
      content: doc,
      onUpdate: ({ editor }) => onChange(editor.getJSON()),
      editorProps: { attributes: { class: "notes-editor selectable outline-none", "aria-label": t("editorLabel") } },
    },
    [meetingId], // a new editor per meeting; within a meeting the editor owns its content
  );

  // The editor's label follows the interface language.
  useEffect(() => {
    editor?.setOptions({ editorProps: { attributes: { class: "notes-editor selectable outline-none", "aria-label": t("editorLabel") } } });
  }, [editor, t]);

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
          <h2 className="text-[13px] font-semibold">{t("title")}</h2>
          {onToggleFull && <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleFull}
                aria-label={full ? t("showTranscript") : t("expand")}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              >
                {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>{full ? t("showTranscript") : t("expand")}</TooltipContent>
          </Tooltip>}
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
          <EditorContent editor={editor} className="mm-reading" />
        </div>
      </div>
    </aside>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const { t } = useTranslation("notes");
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
      { label: t("paragraph"), key: "", icon: Pilcrow, active: s.paragraph, run: () => chain().setParagraph().run() },
      { label: t("heading1"), key: "#", icon: Heading1, active: s.h1, run: () => chain().toggleHeading({ level: 1 }).run() },
      { label: t("heading2"), key: "##", icon: Heading2, active: s.h2, run: () => chain().toggleHeading({ level: 2 }).run() },
      { label: t("heading3"), key: "###", icon: Heading3, active: s.h3, run: () => chain().toggleHeading({ level: 3 }).run() },
    ],
    [
      { label: t("bold"), key: "⌘B", icon: Bold, active: s.bold, run: () => chain().toggleBold().run() },
      { label: t("italic"), key: "⌘I", icon: Italic, active: s.italic, run: () => chain().toggleItalic().run() },
      { label: t("underline"), key: "⌘U", icon: Underline, active: s.underline, run: () => chain().toggleUnderline().run() },
      { label: t("strike"), key: "⌘⇧S", icon: Strikethrough, active: s.strike, run: () => chain().toggleStrike().run() },
    ],
    [
      { label: t("bulletList"), key: "-", icon: List, active: s.bullet, run: () => chain().toggleBulletList().run() },
      { label: t("orderedList"), key: "1.", icon: ListOrdered, active: s.ordered, run: () => chain().toggleOrderedList().run() },
      { label: t("taskList"), key: "[ ]", icon: ListChecks, active: s.task, run: () => chain().toggleTaskList().run() },
    ],
  ];
  return (
    <div className="flex items-center gap-1 border-b border-border px-3 pb-2" role="toolbar" aria-label={t("toolbar")}>
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
