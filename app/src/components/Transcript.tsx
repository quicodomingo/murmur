import { useEffect, useRef, useState } from "react";
import { ArrowDown, Copy, StickyNote } from "lucide-react";
import { toast } from "sonner";

import { Flag, isYou, SpeakerFlag } from "@/components/SpeakerFlag";
import { clock, longDate, speakerIds, speakerName } from "@/lib/format";
import { notesDoc, notesFromDoc } from "@/lib/notes";
import type { Jump, State } from "@/lib/store";
import { SYSTEM_SPEAKER_BASE, type Channel, type Meeting, type PostStage, type Utterance } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  meeting: Meeting;
  /** In the side panel (notes are the main panel): tighter layout. */
  compact?: boolean;
  /** Scroll to (and briefly highlight) a search result. */
  jump: Jump | null;
  finalPass: State["finalPass"][string] | null;
  partial: Record<Channel, string>;
  hoveredNote: string | null;
  onHoverNote: (id: string | null) => void;
  onTitle: (title: string) => void;
  onReassign: (utteranceId: string, speaker: number, version: number) => void;
  onRename: (speaker: number, name: string, version: number) => void;
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
  const speakers = speakerIds(meeting).map((id) => ({ id, name: speakerName(meeting, id), you: isYou(meeting, id) }));
  const anchors = noteAnchors(meeting);
  const scroller = useRef<HTMLDivElement>(null);
  // Follow the live text until the user scrolls up; "Torna al directe" brings it back.
  const following = useRef(true);
  const [detached, setDetached] = useState(false);
  /** A scroll we started (smooth): ignore its intermediate positions. */
  const programmatic = useRef(false);
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
    setDetached(true);
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
    const el = scroller.current;
    if (recording && following.current && el) el.scrollTop = el.scrollHeight;
  }, [meeting.utterances.length, partial.mic, partial.system, recording]);

  const backToLive = () => {
    const el = scroller.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    programmatic.current = !reduce;
    following.current = true;
    setDetached(false);
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <div className="relative h-full">
      <div
        ref={scroller}
        className="h-full overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (programmatic.current) {
            if (atBottom) programmatic.current = false;
            return;
          }
          following.current = atBottom;
          setDetached(!atBottom);
        }}
        onWheel={() => (programmatic.current = false)}
      >
        <article className={cn("mx-auto max-w-[680px]", props.compact ? "pb-16 pl-8 pr-4 pt-4" : "px-10 pb-24 pt-14")}>
          <TitleInput title={meeting.title} onChange={props.onTitle} compact={props.compact} />
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {longDate(meeting.createdAt)}
            {speakers.length > 0 && ` · ${speakers.length} ${speakers.length === 1 ? "participant" : "participants"}`}
          </p>

          {props.finalPass && <FinalPassBanner {...props.finalPass} />}

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
                    guests={meeting.guests}
                    version={meeting.speakersVersion ?? 0}
                    onReassign={(s, version) => props.onReassign(u.id, s, version)}
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
                  <Flag speaker={speaker} you={channel === "mic" && isYou(meeting, 0)} name={channel === "mic" ? speakerName(meeting, 0) : "…"} className="opacity-60" />
                  <p className="mt-1 text-[16px] leading-[1.65] text-muted-foreground" aria-live="off">
                    {text}
                    <span className="mm-caret ml-0.5 inline-block h-[18px] w-[2px] translate-y-[3px] bg-mm-caret" />
                  </p>
                </div>
              );
            })}
            </div>
        </article>
      </div>
      {recording && detached && (
        <button
          type="button"
          onClick={backToLive}
          className="absolute bottom-5 left-1/2 inline-flex h-[30px] -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-[15px] border border-mm-recording-pill-border bg-mm-recording-pill pl-3 pr-3.5 text-[13px] font-medium text-mm-on-recording-pill shadow-[0_2px_8px_rgb(0_0_0/0.18)] transition-transform duration-150 animate-in fade-in slide-in-from-bottom-1 hover:scale-[1.03] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:animate-none motion-reduce:transition-none"
        >
          <ArrowDown className="size-3.5" aria-hidden />
          Torna al directe
        </button>
      )}
    </div>
  );
}

/** The meeting's title, editable in place. Long titles wrap (a textarea that grows, one paragraph). */
export function TitleInput({ title, onChange, compact }: { title: string; onChange: (t: string) => void; compact?: boolean }) {
  const [value, setValue] = useState(title);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setValue(title), [title]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, compact]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      aria-label="Títol de la reunió"
      onChange={(e) => setValue(e.target.value.replace(/\n/g, " "))}
      onBlur={() => onChange(value.trim() || title)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "block w-full resize-none overflow-hidden bg-transparent font-bold leading-tight tracking-[-0.01em] outline-none",
        compact ? "text-[17px]" : "text-[30px] tracking-[-0.015em]",
      )}
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
        "group relative rounded-lg px-3 py-1.5 transition-colors duration-700 hover:bg-mm-fill-subtle",
        showFlag && "mt-3",
        linked && "bg-mm-fill-subtle",
        flash && "bg-yellow-100 duration-150 dark:bg-yellow-500/20",
      )}
    >
      {notes.length > 0 && (
        <button
          type="button"
          aria-label="Nota associada"
          onMouseEnter={() => onHoverNote(notes[0])}
          onMouseLeave={() => onHoverNote(null)}
          className={cn("absolute -left-6 top-2 text-mm-timestamp transition-transform", linked && "scale-125")}
        >
          <StickyNote className="size-3.5" />
        </button>
      )}
      {showFlag && (
        <div className="mb-1 flex items-center gap-2">
          {flag}
          <span className="text-[12px] tabular-nums text-mm-timestamp">{clock(u.start)}</span>
          {u.edited && <span className="text-[11px] text-text-secondary">editat</span>}
        </div>
      )}
      {editing ? (
        <EditBox text={u.text} onDone={finish} />
      ) : (
        <p onClick={() => setEditing(true)} className="selectable -mx-1.5 cursor-text rounded-md px-1.5 text-[16px] leading-[1.65]">
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
      className="-mx-1.5 block w-[calc(100%+12px)] resize-none overflow-hidden rounded-md bg-transparent px-1.5 text-[16px] leading-[1.65] outline-none ring-2 ring-ring"
    />
  );
}

const BANNER: Record<PostStage, { title: string; hint: string }> = {
  speakers: { title: "Verificant parlants…", hint: "Es torna a analitzar tota la reunió per separar millor les veus. Pots continuar llegint i editant." },
  punctuation: { title: "Posant puntuació…", hint: "Punts, comes i majúscules. Les frases que hagis corregit no es toquen." },
  cover: { title: "Preparant la portada…", hint: "El model de llenguatge local llegeix la transcripció. Pots continuar llegint i editant." },
};

/**
 * Shown while the recording is processed (speakers, punctuation, cover). The stages report no
 * progress, so the bar follows the measured speed and waits at 95% until the stage really ends.
 */
function FinalPassBanner({ stage, estimateSeconds, startedAt }: { stage: PostStage; estimateSeconds: number; startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = (now - startedAt) / 1000;
  const progress = Math.min(0.95, elapsed / Math.max(estimateSeconds, 1));
  const left = Math.max(0, estimateSeconds - elapsed);
  const remaining = left < 45 ? "falta poc" : `uns ${Math.round(left / 60) || 1} min`;
  return (
    <div role="status" className="mt-5 rounded-lg bg-muted px-3.5 py-3">
      <div className="flex items-center gap-2 text-[13px]">
        <span className="size-3.5 animate-spin rounded-full border-2 border-text-secondary/30 border-t-text-secondary" aria-hidden />
        <span className="font-medium">{BANNER[stage].title}</span>
        <span className="text-muted-foreground">{remaining}</span>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">{BANNER[stage].hint}</p>
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-mm-meter-off">
        <div className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}
