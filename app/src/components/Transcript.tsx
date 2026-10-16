import { useEffect, useRef, useState } from "react";
import { Copy, StickyNote } from "lucide-react";
import { toast } from "sonner";

import { Flag, SpeakerFlag } from "@/components/SpeakerFlag";
import { clock, longDate, speakerIds, speakerName } from "@/lib/format";
import { notesDoc, notesFromDoc } from "@/lib/notes";
import type { Jump } from "@/lib/store";
import { SYSTEM_SPEAKER_BASE, type Channel, type Meeting, type Utterance } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  meeting: Meeting;
  /** Scroll to (and briefly highlight) a search result. */
  jump: Jump | null;
  partial: Record<Channel, string>;
  hoveredNote: string | null;
  onHoverNote: (id: string | null) => void;
  onTitle: (title: string) => void;
  onReassign: (utteranceId: string, speaker: number) => void;
  onRename: (speaker: number, name: string) => void;
  onEdit: (utteranceId: string, text: string) => void;
};

/** Which utterance each note belongs to: the last one that started before the note was written. */
function noteAnchors(meeting: Meeting): Map<string, string[]> {
  const anchors = new Map<string, string[]>();
  for (const note of notesFromDoc(notesDoc(meeting))) {
    const target = [...meeting.utterances].reverse().find((u) => u.start <= note.t) ?? meeting.utterances[0];
    if (target) anchors.set(target.id, [...(anchors.get(target.id) ?? []), note.id]);
  }
  return anchors;
}

export function Transcript(props: Props) {
  const { meeting, partial } = props;
  const live = (Object.entries(partial) as [Channel, string][]).filter(([, text]) => text);
  const speakers = speakerIds(meeting).map((id) => ({ id, name: speakerName(meeting, id) }));
  const anchors = noteAnchors(meeting);
  const bottom = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const recording = meeting.status === "recording";
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!props.jump) return;
    const { utteranceId, t } = props.jump;
    // Note hits carry only a time: go to what was being said then.
    const target =
      meeting.utterances.find((u) => u.id === utteranceId) ??
      [...meeting.utterances].reverse().find((u) => u.start <= t) ??
      meeting.utterances[0];
    if (!target) return;
    following.current = false;
    requestAnimationFrame(() =>
      scroller.current?.querySelector(`[data-utterance-id="${target.id}"]`)?.scrollIntoView({ block: "center" }),
    );
    setFlash(target.id);
    const timer = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(timer);
    // Re-run for every new jump (nonce) and once the meeting's content has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.jump?.nonce, meeting.utterances.length > 0]);

  useEffect(() => {
    if (recording && following.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [meeting.utterances.length, partial.mic, partial.system, recording]);

  return (
    <div
      ref={scroller}
      className="h-full overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget;
        following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <article className="mx-auto max-w-[680px] px-10 pb-24 pt-14">
        <TitleInput title={meeting.title} onChange={props.onTitle} />
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          {longDate(meeting.createdAt)}
          {speakers.length > 0 && ` · ${speakers.length} ${speakers.length === 1 ? "participant" : "participants"}`}
        </p>

        {meeting.utterances.length === 0 && live.length === 0 && (
          <p className="mt-12 text-[15px] text-text-secondary">
            {recording ? "Escoltant… La transcripció apareixerà aquí quan algú parli." : "Aquesta reunió no té transcripció."}
          </p>
        )}

        <div className="mt-10 flex flex-col gap-1">
          {meeting.utterances.map((u, i) => (
            <UtteranceRow
              key={u.id}
              utterance={u}
              flash={flash === u.id}
              showFlag={i === 0 || meeting.utterances[i - 1].speaker !== u.speaker}
              notes={anchors.get(u.id) ?? []}
              hoveredNote={props.hoveredNote}
              onHoverNote={props.onHoverNote}
              flag={
                <SpeakerFlag
                  speaker={u.speaker}
                  speakers={speakers}
                  onReassign={(s) => props.onReassign(u.id, s)}
                  onRename={props.onRename}
                />
              }
              onEdit={(text) => props.onEdit(u.id, text)}
            />
          ))}

          {live.map(([channel, text]) => {
            const speaker = channel === "mic" ? 0 : SYSTEM_SPEAKER_BASE;
            return (
              <div key={channel} className="mt-3 px-3">
                <Flag speaker={speaker} name={channel === "mic" ? speakerName(meeting, 0) : "…"} className="opacity-60" />
                <p className="mt-1 text-[15px] leading-relaxed text-text-secondary" aria-live="off">
                  {text}
                  <span className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] animate-pulse bg-text-secondary" />
                </p>
              </div>
            );
          })}
          <div ref={bottom} />
        </div>
      </article>
    </div>
  );
}

function TitleInput({ title, onChange }: { title: string; onChange: (t: string) => void }) {
  const [value, setValue] = useState(title);
  useEffect(() => setValue(title), [title]);
  return (
    <input
      value={value}
      aria-label="Títol de la reunió"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onChange(value.trim() || title)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className="w-full bg-transparent text-[28px] font-bold tracking-[-0.01em] outline-none"
    />
  );
}

type RowProps = {
  utterance: Utterance;
  flash: boolean;
  showFlag: boolean;
  notes: string[];
  hoveredNote: string | null;
  onHoverNote: (id: string | null) => void;
  flag: React.ReactNode;
  onEdit: (text: string) => void;
};

function UtteranceRow({ utterance: u, flash, showFlag, notes, hoveredNote, onHoverNote, flag, onEdit }: RowProps) {
  const [editing, setEditing] = useState(false);
  const linked = notes.includes(hoveredNote ?? "");

  const finish = (value: string | null) => {
    if (value) onEdit(value);
    setEditing(false);
  };

  return (
    <div
      data-utterance-id={u.id}
      className={cn(
        "group relative rounded-lg px-3 py-1.5 transition-colors duration-700 hover:bg-[#f7f7f8] dark:hover:bg-white/5",
        showFlag && "mt-3",
        linked && "bg-[#f7f7f8] dark:bg-white/5",
        flash && "bg-yellow-100 duration-150 dark:bg-yellow-500/20",
      )}
    >
      {notes.length > 0 && (
        <button
          type="button"
          aria-label="Nota associada"
          onMouseEnter={() => onHoverNote(notes[0])}
          onMouseLeave={() => onHoverNote(null)}
          className={cn("absolute -left-6 top-2 text-primary transition-transform", linked && "scale-125")}
        >
          <StickyNote className="size-3.5" />
        </button>
      )}
      {showFlag && (
        <div className="mb-1 flex items-center gap-2">
          {flag}
          <span className="text-[12px] tabular-nums text-text-secondary">{clock(u.start)}</span>
          {u.edited && <span className="text-[11px] text-text-secondary">editat</span>}
        </div>
      )}
      {editing ? (
        <EditBox text={u.text} onDone={finish} />
      ) : (
        <p onClick={() => setEditing(true)} className="selectable -mx-1.5 cursor-text rounded-md px-1.5 text-[15px] leading-relaxed">
          {u.text}
        </p>
      )}
      <button
        type="button"
        aria-label="Copia"
        onClick={() => navigator.clipboard.writeText(u.text).then(() => toast("Copiat"))}
        className="absolute right-2 top-2 hidden rounded-md p-1 text-muted-foreground hover:bg-black/5 group-hover:block"
      >
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}

/** In-place editor that looks like the paragraph it replaces (a textarea that grows with its text). */
function EditBox({ text, onDone }: { text: string; onDone: (value: string | null) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const fit = () => {
    const el = ref.current;
    if (el) {
      el.style.height = "0px";
      el.style.height = `${el.scrollHeight}px`;
    }
  };
  useEffect(() => {
    fit();
    const el = ref.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const value = ref.current?.value.replace(/\s+/g, " ").trim() ?? "";
    onDone(save && value ? value : null);
  };
  return (
    <textarea
      ref={ref}
      defaultValue={text}
      aria-label="Edita la frase"
      rows={1}
      onInput={fit}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          finish(true);
        }
        if (e.key === "Escape") finish(false);
      }}
      className="-mx-1.5 block w-[calc(100%+12px)] resize-none overflow-hidden rounded-md bg-transparent px-1.5 text-[15px] leading-relaxed outline-none ring-2 ring-ring"
    />
  );
}
