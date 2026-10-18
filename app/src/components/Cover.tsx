import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlignLeft, Check, Plus, Printer, RefreshCw, Sparkles, X } from "lucide-react";

import { LogoMark } from "@/components/Logo";

import { ScreenThumbs } from "@/components/Screens";
import { Flag, isYou, speakerTone } from "@/components/SpeakerFlag";
import { TitleInput } from "@/components/Transcript";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import * as backend from "@/lib/backend";
import { coverOutdated, namedSpeakers, renameInCover, talkTime } from "@/lib/cover";
import { clock, duration, longDate, speakerIds } from "@/lib/format";
import type { PostProcess } from "@/lib/store";
import type { Cover as CoverData, LlmProgress, Meeting, PostStage } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  meeting: Meeting;
  run: PostProcess | null;
  /** Why a cover can't be generated now (model missing, recording…); null = it can. */
  blocked: string | null;
  onGenerate: () => void;
  onJump: (t: number) => void;
  onShowTranscript: () => void;
  onTitle: (title: string) => void;
  /** The tasks after a change made by hand (tick, edit, add, remove). */
  onTasks: (tasks: Task[]) => void;
  /** "PDF o envia…": the system print panel (Save as PDF, Mail, Messages). */
  onPrint: () => void;
};

type Task = NonNullable<CoverData["tasks"]>[number];

/** The meeting at a glance: title, tone, who spoke, summary, decisions, tasks and parts. */
export function Cover(props: Props) {
  const { meeting, run } = props;
  const generating = !!run && run.steps.includes("cover");
  return (
    <div className="h-full overflow-y-auto">
      <article className="mx-auto max-w-[760px] px-10 pb-20 pt-11">
        <p className="text-[13px] text-muted-foreground">{meta(meeting)}</p>
        <TitleInput title={meeting.title} onChange={props.onTitle} />
        {generating ? (
          <Processing {...props} run={run!} />
        ) : meeting.cover ? (
          <Ready {...props} />
        ) : (
          <Empty {...props} />
        )}
      </article>
      {/* What "PDF o envia…" prints: the app is hidden on paper (index.css), this copy isn't. */}
      {!generating &&
        meeting.cover &&
        createPortal(
          <div className="mm-print hidden print:block">
            <article className="px-2">
              <p className="text-[12px] text-muted-foreground">{meta(meeting)}</p>
              <h1 className="mt-1 text-[26px] font-bold leading-tight">{meeting.title}</h1>
              <Ready {...props} />
            </article>
          </div>,
          document.body,
        )}
    </div>
  );
}

function meta(m: Meeting): string {
  const weekday = new Date(m.createdAt).toLocaleDateString("ca-ES", { weekday: "long" });
  const people = speakerIds(m).filter((id) => m.utterances.some((u) => u.speaker === id)).length;
  const parts = [`${weekday[0].toUpperCase()}${weekday.slice(1)}, ${longDate(m.createdAt)}`, duration(m.duration)];
  if (people) parts.push(`${people} ${people === 1 ? "participant" : "participants"}`);
  return parts.join(" · ");
}

function TimeLink({ t, onJump }: { t: number; onJump: (t: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onJump(t)}
      aria-label={`Ves al minut ${clock(t)} de la transcripció`}
      className="rounded-sm text-mm-timestamp tabular-nums hover:underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      {clock(t)}
    </button>
  );
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-2 text-[13px] font-semibold text-muted-foreground">
      {children}
    </h2>
  );
}

// --- Ready ---------------------------------------------------------------------------------

function Ready({ meeting, blocked, onGenerate, onJump, onShowTranscript, onTasks, onPrint }: Props) {
  // Covers written before a speaker was named still say "Parlant 1": show the name.
  const cover = renameInCover(meeting.cover!, namedSpeakers(meeting));
  const talk = talkTime(meeting);
  // Owners are names the model read in the transcript: match them to speakers for the colour.
  const ownerSpeaker = (owner: string) => {
    const key = owner.toLocaleLowerCase("ca");
    return talk.find((s) => s.name.toLocaleLowerCase("ca") === key || s.name.toLocaleLowerCase("ca").split(" ")[0] === key.split(" ")[0])?.speaker;
  };
  const minutes = (s: number) => (s < 60 ? "<1 min" : `${Math.round(s / 60)} min`);

  return (
    <>
      {cover.excerpt && <p className="mt-3.5 max-w-[64ch] text-[18px] leading-[1.55]">{cover.excerpt}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-secondary">
        <span className="flex items-center gap-1.5">
          <LogoMark size={13} />
          Generat en aquest ordinador. Cada punt enllaça al moment de la reunió d'on surt.
        </span>
        <span className="flex items-center gap-1 print:hidden">
          <button
            type="button"
            onClick={onGenerate}
            disabled={!!blocked}
            title={blocked ?? undefined}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-mm-link hover:bg-mm-fill-subtle disabled:opacity-40"
          >
            <RefreshCw className="size-3" aria-hidden /> Torna a generar
          </button>
          <button type="button" onClick={onPrint} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-mm-link hover:bg-mm-fill-subtle">
            <Printer className="size-3" aria-hidden /> PDF o envia…
          </button>
        </span>
      </div>
      {coverOutdated(meeting) && (
        <div role="status" className="mt-4 flex items-center gap-3 rounded-[10px] border border-border bg-mm-fill-subtle px-3.5 py-2.5 text-[13px] print:hidden">
          <span className="min-w-0 flex-1">La transcripció o les notes han canviat des que es va generar la portada.</span>
          <Button variant="outline" className="h-7 shrink-0 rounded-md px-3 text-[13px]" onClick={onGenerate} disabled={!!blocked} title={blocked ?? undefined}>
            <RefreshCw className="size-3.5" /> Torna a generar
          </Button>
        </div>
      )}

      <div className="mt-7 grid gap-3.5 md:grid-cols-[1fr_1.35fr]">
        {cover.tone && (
          <section aria-labelledby="tone-h" className="rounded-[10px] border border-border px-4 py-3.5">
            <SectionTitle id="tone-h">To</SectionTitle>
            <div className="flex items-center gap-1.5 text-[15px] font-semibold">
              {/* DESIGN.md: the text colour in light mode, the accent in dark. */}
              <i className="block size-2 rounded-full bg-foreground dark:bg-mm-accent" aria-hidden />
              {cover.tone.label}
            </div>
            {cover.tone.reason && <p className="mt-1.5 text-[13px] text-muted-foreground">{cover.tone.reason}</p>}
          </section>
        )}
        {talk.length > 0 && (
          <section aria-labelledby="talk-h" className={cn("rounded-[10px] border border-border px-4 py-3.5", !cover.tone && "md:col-span-2")}>
            <SectionTitle id="talk-h">Qui ha parlat</SectionTitle>
            <div
              className="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
              role="img"
              aria-label={talk.map((s) => `${s.name} ${s.share < 0.01 ? "menys de l'1" : Math.round(s.share * 100)}%`).join(", ")}
            >
              {talk.map((s) => (
                <span key={s.speaker} className="h-full" style={{ width: `${s.share * 100}%`, background: speakerTone(s.speaker, isYou(meeting, s.speaker)).solid }} />
              ))}
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
              {talk.map((s) => (
                <li key={s.speaker} className="flex items-center gap-2 text-[13px]">
                  <i className="block size-2 shrink-0 rounded-[2px]" style={{ background: speakerTone(s.speaker, isYou(meeting, s.speaker)).solid }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                  <small className="text-[12px] tabular-nums text-muted-foreground">
                    {s.share < 0.01 ? "<1" : Math.round(s.share * 100)}% · {minutes(s.seconds)}
                  </small>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {(cover.summary?.length || cover.decisions) && (
        <section aria-labelledby="sum-h" className="mt-8">
          {!!cover.summary?.length && (
            <>
              <SectionTitle id="sum-h">Resum</SectionTitle>
              {cover.summary.map((p, i) => (
                <p key={i} className="mb-2.5 max-w-[68ch] text-[15px] leading-[1.65]">
                  {p}
                </p>
              ))}
            </>
          )}
          {cover.decisions && (
            <>
              <h2 className="mb-2 mt-5 text-[13px] font-semibold text-muted-foreground">Decisions</h2>
              {cover.decisions.length ? (
                <ul className="mt-1">
                  {cover.decisions.map((d, i) => (
                    <li key={i} className="flex gap-2.5 py-1 text-[14px]">
                      <span className="mt-2 size-[5px] shrink-0 rounded-full bg-foreground" aria-hidden />
                      <span>
                        {d.text} {d.t !== null && <TimeLink t={d.t} onJump={onJump} />}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[14px] text-text-secondary">No s'hi ha pres cap decisió explícita.</p>
              )}
            </>
          )}
        </section>
      )}

      {cover.tasks && (
        <section aria-labelledby="task-h" className="mt-8">
          <SectionTitle id="task-h">Tasques</SectionTitle>
          <TaskList meeting={meeting} tasks={cover.tasks} ownerSpeaker={ownerSpeaker} onJump={onJump} onChange={onTasks} />
        </section>
      )}

      {!!cover.parts?.length && (
        <section aria-labelledby="parts-h" className="mt-8">
          <SectionTitle id="parts-h">Parts de la reunió</SectionTitle>
          <ol>
            {cover.parts.map((p, i) => {
              const end = cover.parts![i + 1]?.t ?? meeting.duration;
              // Screenshots taken during this part (the first part also gets any taken before it).
              const shots = (meeting.screens ?? []).filter((s) => (i === 0 || s.t >= p.t) && (i === cover.parts!.length - 1 || s.t < end));
              return (
                <li key={i} className="relative grid grid-cols-[52px_1fr] gap-x-3.5 pb-[18px]">
                  {i < cover.parts!.length - 1 && <span className="absolute bottom-0 left-[63px] top-[22px] w-px bg-border" aria-hidden />}
                  <div className="pt-0.5 text-right text-[13px]">
                    <TimeLink t={p.t} onJump={onJump} />
                  </div>
                  <div className="relative pl-[18px]">
                    <span className="absolute -left-[3px] top-2 size-[7px] rounded-full border-[1.5px] border-primary bg-background" aria-hidden />
                    <h3 className="text-[15px] font-semibold">
                      {p.title}
                      <small className="ml-1.5 text-[12px] font-normal text-text-secondary">{span(end - p.t)}</small>
                    </h3>
                    {p.points.length > 0 && (
                      <ul className="mt-1.5 list-disc pl-4 marker:text-text-secondary">
                        {p.points.map((point, j) => (
                          <li key={j} className="my-0.5 text-[14px] leading-[1.55]">
                            {point}
                          </li>
                        ))}
                      </ul>
                    )}
                    {shots.length > 0 && <ScreenThumbs screens={shots} onJump={onJump} className="mt-2" />}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {!!meeting.screens?.length && (
        <section aria-labelledby="screens-h" className="mt-8">
          <SectionTitle id="screens-h">Totes les pantalles</SectionTitle>
          <ScreenThumbs screens={meeting.screens} onJump={onJump} />
        </section>
      )}

      <div className="mt-9 flex justify-center print:hidden">
        <Button variant="outline" className="h-8 rounded-lg px-3.5 text-[14px]" onClick={onShowTranscript}>
          <AlignLeft className="size-4" /> Veure la transcripció completa
        </Button>
      </div>
    </>
  );
}

/**
 * The cover's tasks, editable by hand: tick, change the text or who does it, remove, add.
 * Tasks added here are kept when the cover is generated again (lib/cover.ts keepTaskEdits).
 */
function TaskList({
  meeting,
  tasks,
  ownerSpeaker,
  onJump,
  onChange,
}: {
  meeting: Meeting;
  tasks: Task[];
  ownerSpeaker: (owner: string) => number | undefined;
  onJump: (t: number) => void;
  onChange: (tasks: Task[]) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const update = (i: number, patch: Partial<Task>) => onChange(tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const remove = (i: number) => onChange(tasks.filter((_, j) => j !== i));
  // People to give a task to: who spoke, then the calendar's guests.
  const people = [...new Set([...talkTime(meeting).map((s) => s.name), ...(meeting.guests ?? [])])];

  return (
    <>
      {tasks.length ? (
        <ul className="grid gap-x-7 md:grid-cols-2">
          {tasks.map((task, i) => {
            const owner = task.owner ? ownerSpeaker(task.owner) : undefined;
            return (
              <li key={i} className="group grid grid-cols-[18px_1fr_auto] gap-2.5 border-b border-border py-2">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={!!task.done}
                  aria-label={`Fet: ${task.text}`}
                  onClick={() => update(i, { done: !task.done })}
                  className={cn(
                    "mt-0.5 grid size-4 place-items-center rounded-full border-[1.5px] border-mm-text-tertiary transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                    task.done && "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {task.done && <Check className="size-2.5" strokeWidth={3} />}
                </button>
                <div className="min-w-0">
                  {editing === i ? (
                    <TaskInput
                      initial={task.text}
                      onDone={(text) => {
                        setEditing(null);
                        if (text) update(i, { text });
                        else if (!task.text) remove(i);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditing(i)}
                      title="Edita la tasca"
                      className={cn("block w-full cursor-text rounded-sm text-left text-[14px] focus-visible:outline-2 focus-visible:outline-ring", task.done && "text-text-secondary line-through")}
                    >
                      {task.text}
                    </button>
                  )}
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" className="rounded-[4px] focus-visible:outline-2 focus-visible:outline-ring" aria-label={task.owner ? `${task.owner}: canvia qui se n'encarrega` : "Assigna la tasca"}>
                          {task.owner ? (
                            owner !== undefined ? (
                              <Flag speaker={owner} you={isYou(meeting, owner)} name={task.owner} />
                            ) : (
                              <span className="inline-flex h-5 items-center rounded-[5px] bg-mm-fill-subtle px-1.5 text-[12px] font-semibold text-foreground">{task.owner}</span>
                            )
                          ) : (
                            <span className="inline-flex h-5 items-center rounded-[5px] px-1 text-[12px] text-text-secondary hover:bg-mm-fill-subtle print:hidden">Assigna…</span>
                          )}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-48">
                        {people.map((name) => (
                          <DropdownMenuItem key={name} onSelect={() => update(i, { owner: name })}>
                            <span className="flex-1">{name}</span>
                            {task.owner === name && <Check className="size-3.5" />}
                          </DropdownMenuItem>
                        ))}
                        {people.length > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuItem onSelect={() => update(i, { owner: null })}>Ningú en concret</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {task.when && <span>{task.when}</span>}
                    {task.t !== null && <TimeLink t={task.t} onJump={onJump} />}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Elimina la tasca: ${task.text}`}
                  className="mt-0.5 grid size-5 place-items-center rounded-md text-text-secondary opacity-0 hover:bg-mm-fill-subtle hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 print:hidden"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[14px] text-text-secondary">En aquesta reunió no s'han demanat tasques.</p>
      )}
      <button
        type="button"
        onClick={() => {
          onChange([...tasks, { text: "", owner: null, when: null, t: null, manual: true }]);
          setEditing(tasks.length);
        }}
        className="mt-2 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] text-mm-link hover:bg-mm-fill-subtle print:hidden"
      >
        <Plus className="size-3.5" aria-hidden /> Afegeix una tasca
      </button>
    </>
  );
}

function TaskInput({ initial, onDone }: { initial: string; onDone: (text: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (text: string) => {
    if (done.current) return;
    done.current = true;
    onDone(text);
  };
  useEffect(() => ref.current?.focus(), []);
  return (
    <input
      ref={ref}
      value={value}
      aria-label="Tasca"
      placeholder="Què s'ha de fer?"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value.trim());
        if (e.key === "Escape") finish(initial);
      }}
      className="-mx-1 w-[calc(100%+8px)] rounded-md bg-transparent px-1 text-[14px] outline-none ring-2 ring-ring"
    />
  );
}

/** "1 min 40 s", "4 min", "45 s". */
function span(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  if (!m) return `${s} s`;
  return s % 60 && m < 10 ? `${m} min ${s % 60} s` : `${m} min`;
}

// --- Processing ----------------------------------------------------------------------------

const STAGE_LABELS: Record<PostStage, string> = {
  speakers: "Verificació de parlants",
  punctuation: "Puntuació i majúscules",
  cover: "Títol, resum, tasques i parts",
};

const PART_LABELS: Record<string, string> = {
  title: "el títol",
  tone: "el to",
  summary: "el resum",
  decisions: "les decisions",
  tasks: "les tasques",
  parts: "les parts",
};

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function Processing({ meeting, run, onShowTranscript }: Props & { run: PostProcess }) {
  const now = useNow(true);
  const [llm, setLlm] = useState<LlmProgress | null>(null);
  useEffect(() => {
    if (!backend.isTauri()) return;
    const unlisten = backend.onLlmProgress((e) => e.job === meeting.id && setLlm(e));
    return () => void unlisten.then((u) => u());
  }, [meeting.id]);

  const current = run.steps.indexOf(run.stage);
  const elapsed = (now - run.startedAt) / 1000;
  const progress = Math.min(0.95, elapsed / Math.max(run.estimateSeconds, 1));
  const left = Math.max(0, run.estimateSeconds - elapsed);
  const remaining = left < 45 ? "falta poc" : `uns ${Math.round(left / 60) || 1} min`;
  const detail =
    run.stage !== "cover" || !llm
      ? null
      : llm.step === "loading"
        ? "Carregant el model…"
        : llm.step === "reading"
          ? "Llegint la transcripció…"
          : PART_LABELS[llm.step]
            ? `Escrivint ${PART_LABELS[llm.step]} (${llm.done + 1} de ${llm.total})`
            : null;

  const rows: { label: string; state: "done" | "active" | "wait"; note: string }[] = [
    { label: "Transcripció", state: "done", note: "Fet" },
    ...run.steps.map((stage, i) => {
      const took = run.took[stage];
      return {
        label: STAGE_LABELS[stage],
        state: i < current ? ("done" as const) : i === current ? ("active" as const) : ("wait" as const),
        note: i < current ? (took !== undefined ? `Fet · ${took < 60 ? `${Math.max(1, Math.round(took))} s` : `${Math.round(took / 60)} min`}` : "Fet") : i === current ? remaining : "Després",
      };
    }),
  ];

  return (
    <>
      <p className="mt-3.5 max-w-[64ch] text-[18px] leading-[1.55] text-muted-foreground">
        S'està preparant la portada. Mentrestant pots llegir i editar la transcripció.
      </p>
      <ul className="mt-5 rounded-[10px] border border-border" aria-label="Processament">
        {rows.map((row, i) => (
          <li key={row.label} className={cn("border-b border-border last:border-b-0", row.state === "active" && "pb-3")}>
            <div className="flex items-center gap-2.5 px-3.5 py-[11px] text-[14px]" aria-current={row.state === "active" ? "step" : undefined}>
              {row.state === "done" ? (
                <span className="grid size-4 place-items-center rounded-full bg-primary text-primary-foreground" aria-label="Fet">
                  <Check className="size-2.5" strokeWidth={3} />
                </span>
              ) : row.state === "active" ? (
                <span className="size-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary motion-reduce:animate-none" aria-hidden />
              ) : (
                <span className="size-4 rounded-full border-[1.5px] border-dashed border-mm-text-tertiary" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                {row.label}
                {row.state === "active" && detail && <span className="ml-2 text-[12px] text-muted-foreground">{detail}</span>}
              </span>
              <small className="text-[12px] tabular-nums text-muted-foreground">{row.note}</small>
            </div>
            {row.state === "active" && i > 0 && (
              <div className="ml-10 mr-3.5 h-[3px] overflow-hidden rounded-full bg-mm-meter-off">
                <div className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear" style={{ width: `${progress * 100}%` }} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-6 opacity-55" aria-hidden>
        <div className="grid gap-3.5 md:grid-cols-[1fr_1.35fr]">
          {[0, 1].map((k) => (
            <div key={k} className="rounded-[10px] border border-border px-4 py-3.5">
              <div className="my-2.5 h-3 w-2/5 rounded-full bg-muted" />
              <div className="my-2.5 h-3 rounded-full bg-muted" />
            </div>
          ))}
        </div>
        <div className="mt-8">
          <div className="my-2.5 h-3 w-1/5 rounded-full bg-muted" />
          <div className="my-2.5 h-3 rounded-full bg-muted" />
          <div className="my-2.5 h-3 w-4/5 rounded-full bg-muted" />
        </div>
      </div>
      <div className="mt-9 flex justify-center">
        <Button variant="outline" className="h-8 rounded-lg px-3.5 text-[14px]" onClick={onShowTranscript}>
          <AlignLeft className="size-4" /> Llegeix la transcripció mentrestant
        </Button>
      </div>
    </>
  );
}

// --- Empty ---------------------------------------------------------------------------------

function Empty({ meeting, blocked, onGenerate, onShowTranscript }: Props) {
  const hasText = meeting.utterances.length > 0;
  return (
    <div className="mt-8 rounded-[10px] border border-dashed border-border px-6 py-8 text-center">
      <Sparkles className="mx-auto size-6 text-text-secondary" strokeWidth={1.5} aria-hidden />
      <h2 className="mt-2 text-[15px] font-semibold">Aquesta reunió encara no té portada</h2>
      <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">
        {hasText
          ? "El model de llenguatge local llegirà la transcripció i en farà el títol, el resum, les decisions, les tasques i les parts."
          : "Cal una transcripció per poder fer-ne la portada."}
      </p>
      {blocked && hasText && <p className="mx-auto mt-2 max-w-sm text-[12px] text-text-secondary">{blocked}</p>}
      <div className="mt-4 flex justify-center gap-2">
        <Button className="h-7 rounded-md px-3 text-[13px]" onClick={onGenerate} disabled={!!blocked || !hasText}>
          <Sparkles className="size-3.5" /> Genera la portada
        </Button>
        <Button variant="outline" className="h-7 rounded-md px-3 text-[13px]" onClick={onShowTranscript}>
          Veure la transcripció
        </Button>
      </div>
    </div>
  );
}
