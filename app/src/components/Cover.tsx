import { useEffect, useState } from "react";
import { AlignLeft, Check, Cpu, RefreshCw, Sparkles } from "lucide-react";

import { Flag, speakerColor } from "@/components/SpeakerFlag";
import { TitleInput } from "@/components/Transcript";
import { Button } from "@/components/ui/button";
import * as backend from "@/lib/backend";
import { talkTime } from "@/lib/cover";
import { clock, duration, longDate, speakerIds } from "@/lib/format";
import type { PostProcess } from "@/lib/store";
import type { LlmProgress, Meeting, PostStage } from "@/lib/types";
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
  onToggleTask: (index: number, done: boolean) => void;
};

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
      className="rounded-sm text-primary tabular-nums hover:underline focus-visible:outline-2 focus-visible:outline-ring"
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

const TONE_COLORS: Record<string, string> = {
  Constructiu: "var(--spk-4)",
  Distès: "var(--spk-4)",
  Neutre: "var(--text-secondary)",
  Formal: "var(--spk-1)",
  Tens: "var(--spk-3)",
  Conflictiu: "var(--destructive)",
};

function Ready({ meeting, blocked, onGenerate, onJump, onShowTranscript, onToggleTask }: Props) {
  const cover = meeting.cover!;
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
          <Cpu className="size-3.5" aria-hidden />
          Generat en aquest ordinador · Pot tenir errors: cada punt enllaça al moment d'on surt
        </span>
        <button
          type="button"
          onClick={onGenerate}
          disabled={!!blocked}
          title={blocked ?? undefined}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-primary hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
        >
          <RefreshCw className="size-3" aria-hidden /> Torna a generar
        </button>
      </div>

      <div className="mt-7 grid gap-3.5 md:grid-cols-[1fr_1.35fr]">
        {cover.tone && (
          <section aria-labelledby="tone-h" className="rounded-[10px] border border-border px-4 py-3.5">
            <SectionTitle id="tone-h">To</SectionTitle>
            <div className="flex items-center gap-1.5 text-[15px] font-semibold">
              <i className="block size-2 rounded-full" style={{ background: TONE_COLORS[cover.tone.label] ?? "var(--text-secondary)" }} aria-hidden />
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
                <span key={s.speaker} className="h-full" style={{ width: `${s.share * 100}%`, background: speakerColor(s.speaker) }} />
              ))}
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
              {talk.map((s) => (
                <li key={s.speaker} className="flex items-center gap-2 text-[13px]">
                  <i className="block size-2 shrink-0 rounded-[2px]" style={{ background: speakerColor(s.speaker) }} aria-hidden />
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
          {cover.tasks.length ? (
            <ul className="grid gap-x-7 md:grid-cols-2">
              {cover.tasks.map((task, i) => {
                const owner = task.owner ? ownerSpeaker(task.owner) : undefined;
                return (
                  <li key={i} className="grid grid-cols-[18px_1fr] gap-2.5 border-b border-border py-2">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={!!task.done}
                      aria-label={`Fet: ${task.text}`}
                      onClick={() => onToggleTask(i, !task.done)}
                      className={cn(
                        "mt-0.5 grid size-4 place-items-center rounded-full border-[1.5px] border-[#c7c7cc] transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                        task.done && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      {task.done && <Check className="size-2.5" strokeWidth={3} />}
                    </button>
                    <div className="min-w-0">
                      <div className={cn("text-[14px]", task.done && "text-text-secondary line-through")}>{task.text}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                        {task.owner &&
                          (owner !== undefined ? (
                            <Flag speaker={owner} name={task.owner} />
                          ) : (
                            <span className="inline-flex h-[18px] items-center rounded-[4px] bg-muted px-1.5 text-[11px] font-semibold text-foreground">{task.owner}</span>
                          ))}
                        {task.when && <span>{task.when}</span>}
                        {task.t !== null && <TimeLink t={task.t} onJump={onJump} />}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[14px] text-text-secondary">No s'hi ha encarregat cap tasca.</p>
          )}
        </section>
      )}

      {!!cover.parts?.length && (
        <section aria-labelledby="parts-h" className="mt-8">
          <SectionTitle id="parts-h">Parts de la reunió</SectionTitle>
          <ol>
            {cover.parts.map((p, i) => {
              const end = cover.parts![i + 1]?.t ?? meeting.duration;
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
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <div className="mt-9 flex justify-center">
        <Button variant="outline" className="h-8 rounded-lg px-3.5 text-[14px]" onClick={onShowTranscript}>
          <AlignLeft className="size-4" /> Veure la transcripció completa
        </Button>
      </div>
    </>
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
                <span className="grid size-4 place-items-center rounded-full bg-[#34c759] text-white" aria-label="Fet">
                  <Check className="size-2.5" strokeWidth={3} />
                </span>
              ) : row.state === "active" ? (
                <span className="size-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary motion-reduce:animate-none" aria-hidden />
              ) : (
                <span className="size-4 rounded-full border-[1.5px] border-dashed border-[#c7c7cc]" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                {row.label}
                {row.state === "active" && detail && <span className="ml-2 text-[12px] text-muted-foreground">{detail}</span>}
              </span>
              <small className="text-[12px] tabular-nums text-muted-foreground">{row.note}</small>
            </div>
            {row.state === "active" && i > 0 && (
              <div className="ml-10 mr-3.5 h-[3px] overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/10">
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
