import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AudioLines, Camera, Check, Lock, Sparkles, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Flag, speakerTone } from "@/components/SpeakerFlag";
import { LogoIcon, LogoMark, Wordmark } from "@/components/Logo";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/SettingsDialog";
import * as backend from "@/lib/backend";
import { connectCloud, KEYS_URL, useCloud } from "@/lib/cloud";
import { bytes, downloadQueue, useModels } from "@/lib/models";
import type { Settings } from "@/lib/settings";
import type { CloudProvider, ModelId } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  /** Closed with Esc, "Tanca" or "Continua en segon pla". */
  onClose: () => void;
  onChange: (patch: Partial<Settings>) => void;
  /** Jump straight to the models (e.g. from the empty screen when the model is missing). */
  startAtModels?: boolean;
};

const STEPS = 7;

/** Who writes the summaries, chosen on the last step: the local model, Claude, ChatGPT or nobody yet. */
type Writer = "local" | CloudProvider | "none";

/** First-run screens (docs/design/DESIGN.md › Onboarding): six steps, then the models. */
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

// --- 2–6. What Murmur does --------------------------------------------------------------

/** Each feature step's strings, under `features.<key>` in the onboarding namespace. */
const FEATURES: Record<number, "live" | "speakers" | "cover" | "indicator" | "alerts"> = { 1: "live", 2: "speakers", 3: "cover", 4: "indicator", 5: "alerts" };

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
        {step === 4 && <IndicatorIllustration />}
        {step === 5 && <AlertIllustration />}
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

/** A call with a shared slide, the recording pill on the screen's edge, and the screenshot it just took. */
function IndicatorIllustration() {
  const { t } = useTranslation("onboarding");
  return (
    <div className="flex w-[560px] items-center gap-5">
      <div className="relative h-[176px] flex-1 overflow-hidden rounded-[10px] bg-mm-background shadow-[0_0_0_1px_var(--mm-separator)]">
        <div className="flex h-5 items-center gap-1 border-b border-border px-2">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1.5 rounded-full bg-mm-separator" />
          ))}
        </div>
        <div className="flex h-[155px] gap-2 p-2">
          <div className="flex-1 rounded-md bg-mm-fill-subtle px-3 py-2.5">
            <div className="text-[11px] font-bold">{t("demo.slideTitle")}</div>
            <div className="mt-2 h-1.5 w-4/5 rounded-full bg-mm-separator" />
            <div className="mt-1.5 h-1.5 w-3/5 rounded-full bg-mm-separator" />
            <div className="mt-1.5 h-1.5 w-2/3 rounded-full bg-mm-separator" />
          </div>
          <div className="flex w-[64px] flex-col gap-2">
            {[0, 1].map((i) => (
              <span key={i} className="flex-1 rounded-md bg-mm-fill-subtle" />
            ))}
          </div>
        </div>
        {/* The pill, on the right edge of the screen (IndicatorWindow), smaller. */}
        <div className="absolute right-2 top-1/2 flex w-9 -translate-y-1/2 flex-col items-center gap-1.5 rounded-[18px] bg-mm-recording-pill py-1.5 text-mm-on-recording-pill shadow-[0_0_0_1px_var(--mm-recording-pill-border),0_4px_14px_rgb(0_0_0/0.3)]">
          <span className="mm-rec mt-1 size-2 rounded-full bg-mm-recording-dot" />
          <span className="flex h-3 items-center gap-[2px]">
            <span className="mm-bar h-3 w-[3px] rounded-[2px] bg-mm-recording-level" />
            <span className="mm-bar mm-bar-2 h-3 w-[3px] rounded-[2px] bg-mm-recording-level" />
          </span>
          <span className="grid size-7 place-items-center rounded-full bg-mm-recording-level text-mm-recording-pill">
            <Camera className="size-3.5" strokeWidth={2} />
          </span>
          <span className="grid size-5 place-items-center">
            <Square className="size-2" fill="currentColor" strokeWidth={0} />
          </span>
        </div>
      </div>
      <div className={cn(card, "w-[170px] px-3 py-2.5")}>
        <div className="text-[11px] font-semibold text-muted-foreground">{t("demo.screensPart")}</div>
        <div className="mt-2 rounded-md bg-mm-fill-subtle px-2 py-1.5 shadow-[0_0_0_1px_var(--mm-separator)]">
          <div className="text-[9px] font-bold">{t("demo.slideTitle")}</div>
          <div className="mt-1 h-1 w-4/5 rounded-full bg-mm-separator" />
          <div className="mt-1 h-1 w-3/5 rounded-full bg-mm-separator" />
        </div>
        <div className="mt-1 text-[10px] tabular-nums text-mm-timestamp">14:32</div>
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

// --- 7. Models -----------------------------------------------------------------------------

function Models({ step, onBack, onClose, onChange }: { step: number; onBack: () => void; onClose: () => void; onChange: Props["onChange"] }) {
  const { t } = useTranslation("onboarding");
  const models = useModels();
  const cloud = useCloud();
  const [writer, setWriter] = useState<Writer>("local");
  const [started, setStarted] = useState(false);
  const status = (id: ModelId) => models.status[id];
  const installed = (ids: ModelId[]) => ids.every((id) => status(id)?.installed);
  const remote = writer === "anthropic" || writer === "openai" ? writer : null;
  // Punctuation isn't published yet: leave out what can't be downloaded.
  const toolIds = (writer === "none" ? [] : writer === "local" ? (["punctuation", "llm"] as ModelId[]) : (["punctuation"] as ModelId[])).filter(
    (id) => status(id)?.downloadable !== false,
  );
  const wanted: ModelId[] = ["transcription", ...toolIds];
  const busy = wanted.some((id) => models.downloading[id] || models.queued.includes(id));
  const ready = started && installed(wanted);
  const failed = wanted.map((id) => models.errors[id]).find(Boolean);
  const phase = ready ? "ready" : started && (busy || !failed) ? "downloading" : "choose";
  // Claude or ChatGPT: the account must be connected before going on.
  const waitingForKey = !!remote && !cloud.status[remote];

  const start = () => {
    if (writer !== "none") onChange({ punctuate: toolIds.includes("punctuation"), summarize: true, coverEngine: writer });
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
    if (!ids.length) return "idle";
    if (installed(ids)) return started ? "done" : "idle";
    if (!started) return "idle";
    return ids.some((id) => models.downloading[id]) ? "active" : "waiting";
  };

  const title = phase === "ready" ? t("models.titleReady") : phase === "downloading" ? t("models.titleDownloading") : t("models.titleChoose");
  const intro =
    phase === "ready" ? t("models.introReady") : phase === "downloading" ? t("models.introDownloading") : t("models.introChoose");
  const size = (ids: ModelId[]) => bytes(ids.reduce((n, id) => n + (status(id)?.bytes ?? 0), 0));
  const writers: { value: Writer; label: string }[] = [
    { value: "local", label: t("models.writers.local") },
    { value: "anthropic", label: t("models.writers.anthropic") },
    { value: "openai", label: t("models.writers.openai") },
    { value: "none", label: t("models.writers.none") },
  ];

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
            name={t("models.summaryName")}
            badge={t("models.optional")}
            size={writer === "local" ? size(toolIds) : ""}
            text={t("models.summaryText")}
            state={rowState(toolIds)}
            progress={progress(toolIds)}
            error={toolIds.map((id) => models.errors[id]).find(Boolean)}
            last
          >
            <div className={cn("mt-2.5 flex", phase !== "choose" && "pointer-events-none opacity-60")}>
              <Segmented<Writer> value={writer} options={writers} onChange={setWriter} labelledBy="onboarding-summary" />
            </div>
            <div id="onboarding-summary" className="mt-2 text-[12px] leading-normal text-muted-foreground">
              {writer === "local" && t("models.localText", { size: size(["llm"]) })}
              {writer === "none" && t("models.noneText")}
              {remote && <CloudKey provider={remote} connected={cloud.status[remote]} locked={phase !== "choose"} />}
            </div>
          </ModelRow>
        </div>
        <div className="mt-3 flex items-start gap-2.5 text-[12px] leading-normal text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{remote ? t("models.offlineCloud") : t("models.offline")}</span>
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
          disabled={waitingForKey}
        />
      )}
    </>
  );
}

/** Claude or ChatGPT on the models step: the API key, checked and saved to the keychain (lib/cloud.ts). */
function CloudKey({ provider, connected, locked }: { provider: CloudProvider; connected: string | null; locked: boolean }) {
  const { t } = useTranslation("onboarding");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = t(`models.writers.${provider}`);

  if (connected)
    return (
      <span className="flex items-center gap-1.5 text-foreground">
        <Check className="size-3.5 text-mm-toggle-on" strokeWidth={3} aria-hidden />
        {t("models.cloudConnected", { name, hint: connected })}
      </span>
    );

  const connect = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await connectCloud(provider, key);
      setKey("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const site = new URL(KEYS_URL[provider]).host;
  return (
    <>
      <p>
        {t("models.cloudText", { name })}{" "}
        <button
          type="button"
          onClick={() => (backend.isTauri() ? openUrl(KEYS_URL[provider]) : Promise.resolve(window.open(KEYS_URL[provider], "_blank"))).catch(() => {})}
          className="text-mm-link hover:underline"
        >
          {t("models.cloudCreateKey", { site })}
        </button>
      </p>
      <form
        className="mt-1.5 flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          connect();
        }}
      >
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          disabled={locked}
          placeholder={provider === "anthropic" ? "sk-ant-…" : "sk-…"}
          aria-label={t("models.cloudKey", { name })}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!error}
          className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive"
        />
        <button
          type="submit"
          disabled={busy || locked || !key.trim()}
          className="h-7 shrink-0 rounded-md border border-input bg-background px-2.5 text-[12px] text-foreground hover:bg-muted disabled:opacity-50"
        >
          {busy ? t("models.cloudChecking") : t("models.cloudConnect")}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-1 text-destructive">
          {error}
        </p>
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
  children,
}: {
  icon: React.ReactNode;
  name: string;
  badge: string;
  size: string;
  text: string;
  state: "idle" | "waiting" | "active" | "done";
  progress: number;
  error?: string;
  control?: React.ReactNode;
  last?: boolean;
  /** Extra content under the text (the summary writer choice). */
  children?: React.ReactNode;
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
        {children}
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
