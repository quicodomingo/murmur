import { useState } from "react";
import { AudioLines, Check, Lock, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Flag, speakerTone } from "@/components/SpeakerFlag";
import { LogoIcon, LogoMark, Wordmark } from "@/components/Logo";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { bytes, downloadQueue, useModels } from "@/lib/models";
import type { Settings } from "@/lib/settings";
import type { ModelId } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  /** Closed with Esc, "Tanca" or "Continua en segon pla". */
  onClose: () => void;
  onChange: (patch: Partial<Settings>) => void;
  /** Jump straight to the models (e.g. from the empty screen when the model is missing). */
  startAtModels?: boolean;
};

const STEPS = 6;
const TOOLS: ModelId[] = ["punctuation", "llm"];

/** First-run screens (docs/design/DESIGN.md › Onboarding): five steps, then the models. */
export function Onboarding({ open, onClose, onChange, startAtModels }: Props) {
  const { t } = useTranslation("onboarding");
  const [step, setStep] = useState(startAtModels ? STEPS - 1 : 0);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        className="flex h-[540px] max-h-[94vh] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[720px]"
      >
        <DialogTitle className="sr-only">{t("dialogTitle")}</DialogTitle>
        <DialogDescription className="sr-only">{t("dialogDescription")}</DialogDescription>
        <div className="h-10 shrink-0" />
        {step === 0 && <Welcome />}
        {step > 0 && step < STEPS - 1 && <Feature step={step} />}
        {step === STEPS - 1 ? (
          <Models step={step} onBack={() => setStep(step - 1)} onClose={onClose} onChange={onChange} />
        ) : (
          <Footer step={step} onBack={step > 0 ? () => setStep(step - 1) : undefined} primary={step === 0 ? t("start") : t("continue")} onNext={() => setStep(step + 1)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Dots({ step }: { step: number }) {
  const { t } = useTranslation("onboarding");
  return (
    <div className="flex flex-1 items-center gap-1.5" aria-label={t("stepOf", { step: step + 1, total: STEPS })}>
      {Array.from({ length: STEPS }, (_, i) => (
        <span key={i} className={cn("h-1.5 rounded-[3px] transition-[width]", i === step ? "w-[18px] bg-foreground" : "w-1.5 bg-mm-separator")} />
      ))}
    </div>
  );
}

const primaryButton =
  "h-[34px] rounded-lg bg-mm-accent px-4 text-[14px] font-semibold text-mm-on-accent hover:opacity-90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const secondaryButton = "h-[34px] rounded-lg px-3.5 text-[14px] text-muted-foreground hover:text-foreground";

function Footer({
  step,
  onBack,
  back,
  primary,
  onNext,
  disabled,
}: {
  step: number;
  onBack?: () => void;
  back?: string;
  primary: string;
  onNext: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("onboarding");
  return (
    <div className="flex h-[68px] shrink-0 items-center gap-2.5 pl-12 pr-6">
      <Dots step={step} />
      {onBack && (
        <button type="button" className={secondaryButton} onClick={onBack}>
          {back ?? t("back")}
        </button>
      )}
      <button type="button" className={primaryButton} onClick={onNext} disabled={disabled} autoFocus>
        {primary}
      </button>
    </div>
  );
}

// --- 1. Welcome -----------------------------------------------------------------------------

function Welcome() {
  const { t } = useTranslation("onboarding");
  return (
    <div className="flex flex-1 flex-col items-center justify-center pb-6 text-center">
      <LogoIcon size={112} shadow />
      <Wordmark className="mt-5" />
      <p className="mt-4 max-w-[400px] text-[15px] leading-normal">{t("welcomeTagline")}</p>
      <p className="mt-2 text-[15px] font-semibold">{t("welcomePrivate")}</p>
    </div>
  );
}

// --- 2–5. What Murmur does --------------------------------------------------------------

/** Each feature step's strings, under `features.<key>` in the onboarding namespace. */
const FEATURES: Record<number, "live" | "speakers" | "cover" | "alerts"> = { 1: "live", 2: "speakers", 3: "cover", 4: "alerts" };

function Feature({ step }: { step: number }) {
  const { t } = useTranslation("onboarding");
  const key = FEATURES[step];
  const f = { kicker: t(`features.${key}.kicker`), title: t(`features.${key}.title`), text: t(`features.${key}.text`) };
  return (
    <>
      {/* Real pieces of the interface, in the active theme. */}
      <div className="relative mx-6 flex h-[236px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-mm-fill-subtle" aria-hidden>
        {step === 1 && <LiveIllustration />}
        {step === 2 && <SpeakersIllustration />}
        {step === 3 && <CoverIllustration />}
        {step === 4 && <AlertIllustration />}
      </div>
      <div className="flex-1 px-12 pt-[26px]">
        <div className="text-[12px] font-semibold text-muted-foreground">{f.kicker}</div>
        <h1 className="mt-1 text-[24px] font-bold leading-tight tracking-[-0.015em]">{f.title}</h1>
        <p className="mt-2 max-w-[560px] text-[15px] leading-[1.55] text-foreground/80">{f.text}</p>
      </div>
    </>
  );
}

const card = "rounded-[10px] bg-mm-background shadow-[0_0_0_1px_var(--mm-separator)]";

function LiveIllustration() {
  const { t } = useTranslation("onboarding");
  return (
    <div className="flex w-[520px] flex-col gap-3">
      <div className="flex h-[26px] items-center gap-2 self-end rounded-[13px] bg-mm-recording-pill px-2.5 text-[12px] font-medium text-mm-on-recording-pill">
        <span className="flex gap-0.5">
          <span className="mm-bar h-3 w-[3px] rounded-[2px] bg-mm-recording-level" />
          <span className="mm-bar mm-bar-2 h-3 w-[3px] rounded-[2px] bg-mm-recording-level" />
        </span>
        {t("demo.recording")} <span className="tabular-nums opacity-70">03:12</span>
      </div>
      <div className={cn(card, "px-4 py-3.5")}>
        <div className="mb-1 flex items-center gap-2">
          <Flag speaker={0} name={t("demo.anna")} className="h-[18px] text-[11px]" />
          <span className="text-[11px] tabular-nums text-mm-timestamp">2:58</span>
        </div>
        <div className="text-[14px] leading-[1.55]">
          {t("demo.liveText")}
          <span className="text-muted-foreground">{t("demo.livePartial")}</span>
          <span className="mm-caret ml-0.5 inline-block h-[15px] w-[2px] translate-y-[2px] bg-mm-caret" />
        </div>
      </div>
    </div>
  );
}

function SpeakersIllustration() {
  const { t } = useTranslation("onboarding");
  const people = [
    { name: t("demo.anna"), speaker: 0, share: 38 },
    { name: t("demo.jordi"), speaker: 1, share: 26 },
    { name: t("demo.marta"), speaker: 2, share: 22 },
    { name: t("demo.you"), speaker: 0, share: 14, you: true },
  ];
  return (
    <div className="grid w-[520px] grid-cols-[1.2fr_1fr] gap-3">
      <div className={cn(card, "px-4 py-3.5")}>
        <div className="mb-2 text-[11px] font-semibold text-muted-foreground">{t("demo.whoSpoke")}</div>
        <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
          {people.map((p) => (
            <span key={p.name} style={{ width: `${p.share}%`, background: speakerTone(p.speaker, p.you).solid }} />
          ))}
        </div>
        <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1">
          {people.map((p) => (
            <li key={p.name} className="flex items-center gap-1.5 text-[11px]">
              <i className="block size-2 rounded-[2px]" style={{ background: speakerTone(p.speaker, p.you).solid }} />
              {p.name}
            </li>
          ))}
        </ul>
      </div>
      <div className={cn(card, "px-4 py-3.5")}>
        <div className="mb-2 text-[11px] font-semibold text-muted-foreground">{t("demo.notes")}</div>
        {[
          ["2:58", t("demo.note1")],
          ["7:40", t("demo.note2")],
        ].map(([time, text]) => (
          <div key={time} className="flex gap-2.5 py-0.5 text-[11px]">
            <span className="tabular-nums text-mm-timestamp">{time}</span>
            {text}
          </div>
        ))}
      </div>
    </div>
  );
}

function CoverIllustration() {
  const { t } = useTranslation("onboarding");
  return (
    <div className={cn(card, "w-[540px] px-5 py-4")}>
      <div className="text-[14px] font-bold">{t("demo.coverTitle")}</div>
      <div className="mt-2 h-1.5 w-11/12 rounded-full bg-mm-separator" />
      <div className="mt-1.5 h-1.5 w-2/3 rounded-full bg-mm-separator" />
      <div className="mt-4 grid grid-cols-2 gap-5 text-[11px]">
        <div>
          <div className="mb-1 font-semibold text-muted-foreground">{t("demo.decisions")}</div>
          {[
            [t("demo.decision1"), "2:58"],
            [t("demo.decision2"), "9:12"],
          ].map(([text, time]) => (
            <div key={time} className="flex items-center gap-1.5 py-0.5">
              <span className="size-1 rounded-full bg-foreground" />
              {text} <span className="tabular-nums text-mm-timestamp">{time}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="mb-1 font-semibold text-muted-foreground">{t("demo.tasks")}</div>
          {[
            { text: t("demo.task1"), flag: <Flag speaker={0} name={t("demo.anna")} className="h-4 px-1 text-[10px]" /> },
            { text: t("demo.task2"), flag: <Flag speaker={0} you name={t("demo.you")} className="h-4 px-1 text-[10px]" /> },
          ].map((task) => (
            <div key={task.text} className="flex items-center gap-1.5 py-0.5">
              <span className="size-2.5 rounded-full border border-mm-text-tertiary" />
              {task.text} {task.flag}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AlertIllustration() {
  const { t } = useTranslation("onboarding");
  return (
    <>
      <div className="absolute inset-x-0 top-0 flex h-[30px] items-center justify-end gap-3 bg-mm-background/70 px-4 text-[11px] font-medium">
        <span className="grid h-5 w-7 place-items-center rounded-[5px] bg-black/10 dark:bg-white/15">
          <LogoMark size={15} />
        </span>
        {t("demo.menuBarClock")}
      </div>
      <div className="mt-6 w-[400px] overflow-hidden rounded-2xl bg-mm-toast-background text-mm-toast-text shadow-[0_8px_24px_rgb(0_0_0/0.18),0_0_0_1px_var(--mm-toast-border)]">
        <div className="flex items-center gap-3 py-3 pl-4 pr-3">
          <span className="grid size-5 place-items-center">
            <span className="mm-rec size-2 rounded-full bg-mm-recording-dot" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">{t("demo.alertTitle")}</div>
            <div className="text-[11px] text-mm-toast-secondary">{t("demo.alertText")}</div>
          </div>
          <span className="flex h-8 items-center gap-1.5 rounded-lg bg-mm-accent px-2.5 text-[12px] font-semibold text-mm-on-accent">
            <LogoIcon size={16} /> {t("demo.alertAction")}
          </span>
        </div>
      </div>
    </>
  );
}

// --- 6. Models -----------------------------------------------------------------------------

function Models({ step, onBack, onClose, onChange }: { step: number; onBack: () => void; onClose: () => void; onChange: Props["onChange"] }) {
  const { t } = useTranslation("onboarding");
  const models = useModels();
  const [tools, setTools] = useState(true);
  const [started, setStarted] = useState(false);
  const status = (id: ModelId) => models.status[id];
  const installed = (ids: ModelId[]) => ids.every((id) => status(id)?.installed);
  const wanted: ModelId[] = ["transcription", ...(tools ? TOOLS : [])];
  const busy = wanted.some((id) => models.downloading[id] || models.queued.includes(id));
  const ready = started && installed(wanted);
  const failed = wanted.map((id) => models.errors[id]).find(Boolean);
  const phase = ready ? "ready" : started && (busy || !failed) ? "downloading" : "choose";

  const start = () => {
    if (tools) onChange({ punctuate: true, summarize: true });
    setStarted(true);
    downloadQueue(wanted);
  };

  // Progress of a row: bytes on disk (or downloading) over the total of its models.
  const progress = (ids: ModelId[]) => {
    const total = ids.reduce((n, id) => n + (status(id)?.bytes ?? 0), 0) || 1;
    const done = ids.reduce((n, id) => n + (status(id)?.installed ? (status(id)?.bytes ?? 0) : (models.downloading[id]?.done ?? 0)), 0);
    return done / total;
  };
  const rowState = (ids: ModelId[]): "idle" | "waiting" | "active" | "done" => {
    if (installed(ids)) return started ? "done" : "idle";
    if (!started) return "idle";
    return ids.some((id) => models.downloading[id]) ? "active" : "waiting";
  };

  const title = phase === "ready" ? t("models.titleReady") : phase === "downloading" ? t("models.titleDownloading") : t("models.titleChoose");
  const intro =
    phase === "ready" ? t("models.introReady") : phase === "downloading" ? t("models.introDownloading") : t("models.introChoose");
  const size = (ids: ModelId[]) => bytes(ids.reduce((n, id) => n + (status(id)?.bytes ?? 0), 0));

  return (
    <>
      <div className="flex flex-1 flex-col overflow-y-auto px-12 pt-1">
        <div className="text-[12px] font-semibold text-muted-foreground">{t("models.kicker")}</div>
        <h1 className="mt-1 text-[24px] font-bold leading-tight tracking-[-0.015em]">{title}</h1>
        <p className="mt-1.5 text-[14px] leading-normal text-foreground/80">{intro}</p>
        <div className="mt-4 overflow-hidden rounded-xl border border-border">
          <ModelRow
            icon={<AudioLines className="size-4" />}
            name={t("models.transcriptionName")}
            badge={t("models.required")}
            size={size(["transcription"])}
            text={t("models.transcriptionText")}
            state={rowState(["transcription"])}
            progress={progress(["transcription"])}
            error={models.errors.transcription}
            control={
              <span className="grid size-[22px] shrink-0 place-items-center rounded-md bg-foreground text-background opacity-50" aria-label={t("models.alwaysIncluded")}>
                <Check className="size-3.5" strokeWidth={3} />
              </span>
            }
          />
          <ModelRow
            icon={<Sparkles className="size-4" />}
            name={t("models.toolsName")}
            badge={t("models.optional")}
            size={size(TOOLS)}
            text={t("models.toolsText")}
            state={tools ? rowState(TOOLS) : "idle"}
            progress={progress(TOOLS)}
            error={tools ? (models.errors.punctuation ?? models.errors.llm) : undefined}
            last
            control={<Switch checked={tools} disabled={started && phase !== "choose"} onCheckedChange={setTools} aria-label={t("models.toolsName")} />}
          />
        </div>
        <div className="mt-3 flex items-start gap-2.5 text-[12px] leading-normal text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{t("models.offline")}</span>
        </div>
      </div>
      {phase === "ready" ? (
        <Footer step={step} primary={t("models.close")} onNext={onClose} />
      ) : phase === "downloading" ? (
        <Footer step={step} back={t("models.continueInBackground")} onBack={onClose} primary={t("models.downloading")} onNext={() => {}} disabled />
      ) : (
        <Footer
          step={step}
          onBack={onBack}
          primary={failed ? t("models.retry") : installed(wanted) ? t("start") : t("models.downloadAndStart")}
          onNext={start}
        />
      )}
    </>
  );
}

function ModelRow({
  icon,
  name,
  badge,
  size,
  text,
  state,
  progress,
  error,
  control,
  last,
}: {
  icon: React.ReactNode;
  name: string;
  badge: string;
  size: string;
  text: string;
  state: "idle" | "waiting" | "active" | "done";
  progress: number;
  error?: string;
  control: React.ReactNode;
  last?: boolean;
}) {
  const { t } = useTranslation("onboarding");
  return (
    <div className={cn("flex gap-3.5 px-4 py-3.5", !last && "border-b border-border")}>
      <span className="grid size-[34px] shrink-0 place-items-center rounded-[9px] bg-mm-fill-subtle text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold">{name}</span>
          <span className="rounded-[4px] bg-mm-fill-subtle px-1.5 text-[11px] font-semibold text-muted-foreground">{badge}</span>
          <span className="flex-1" />
          <span className="text-[12px] tabular-nums text-muted-foreground">{size}</span>
        </div>
        <div className="mt-0.5 text-[12px] text-muted-foreground">{text}</div>
        {error ? (
          <div className="mt-2 text-[12px] text-destructive">{error}</div>
        ) : (
          state !== "idle" && (
            <div className="mt-2.5 flex items-center gap-3">
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-mm-separator"
                role="progressbar"
                aria-label={name}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.floor(progress * 100)}
              >
                <div className="h-full rounded-[3px] bg-mm-toggle-on transition-[width] duration-300" style={{ width: `${(state === "done" ? 1 : progress) * 100}%` }} />
              </div>
              <span className="w-16 text-right text-[12px] tabular-nums text-muted-foreground">
                {state === "done" ? t("models.done") : state === "waiting" ? t("models.waiting") : t("models.percent", { value: Math.floor(progress * 100) })}
              </span>
            </div>
          )
        )}
      </div>
      {control}
    </div>
  );
}
