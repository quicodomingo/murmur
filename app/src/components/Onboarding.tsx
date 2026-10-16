import { useState } from "react";
import { AudioLines, Check, Lock, Sparkles } from "lucide-react";

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
  const [step, setStep] = useState(startAtModels ? STEPS - 1 : 0);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        className="flex h-[540px] max-h-[94vh] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[720px]"
      >
        <DialogTitle className="sr-only">Benvinguda a Murmur</DialogTitle>
        <DialogDescription className="sr-only">Primers passos i descàrrega dels models</DialogDescription>
        <div className="h-10 shrink-0" />
        {step === 0 && <Welcome />}
        {step > 0 && step < STEPS - 1 && <Feature step={step} />}
        {step === STEPS - 1 ? (
          <Models step={step} onBack={() => setStep(step - 1)} onClose={onClose} onChange={onChange} />
        ) : (
          <Footer step={step} onBack={step > 0 ? () => setStep(step - 1) : undefined} primary={step === 0 ? "Comença" : "Continua"} onNext={() => setStep(step + 1)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Dots({ step }: { step: number }) {
  return (
    <div className="flex flex-1 items-center gap-1.5" aria-label={`Pas ${step + 1} de ${STEPS}`}>
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
  back = "Enrere",
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
  return (
    <div className="flex h-[68px] shrink-0 items-center gap-2.5 pl-12 pr-6">
      <Dots step={step} />
      {onBack && (
        <button type="button" className={secondaryButton} onClick={onBack}>
          {back}
        </button>
      )}
      <button type="button" className={primaryButton} onClick={onNext} disabled={disabled} autoFocus>
        {primary}
      </button>
    </div>
  );
}

// --- 1. Benvinguda -------------------------------------------------------------------------

function Welcome() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center pb-6 text-center">
      <LogoIcon size={112} shadow />
      <Wordmark className="mt-5" />
      <p className="mt-4 max-w-[400px] text-[15px] leading-normal">Transcriu les teves reunions en directe, amb el català al centre.</p>
      <p className="mt-2 text-[15px] font-semibold">Privat, perquè és local.</p>
    </div>
  );
}

// --- 2–5. Què fa Murmur --------------------------------------------------------------------

const FEATURES: Record<number, { kicker: string; title: string; text: string }> = {
  1: {
    kicker: "Transcripció en directe",
    title: "Veus el text mentre parleu",
    text: "Murmur transcriu la reunió en temps real, amb el català com a llengua principal. La pots seguir, corregir i anotar al moment.",
  },
  2: {
    kicker: "Parlants i notes",
    title: "Qui parla i què hi apuntes",
    text: "Distingeix les veus i et mostra qui ha parlat i quant. Les notes que escrius queden lligades al minut exacte de la reunió.",
  },
  3: {
    kicker: "Portada",
    title: "La reunió, resumida",
    text: "En acabar, Murmur prepara una portada amb el títol, el resum, les decisions i les tasques. Cada punt enllaça al moment on es va dir.",
  },
  4: {
    kicker: "Avisos",
    title: "Cap reunió sense gravar",
    text: "Quan Zoom, Meet o Teams fan servir el micròfon, Murmur t'avisa des de la barra de menús. Un clic i comença a gravar.",
  },
};

function Feature({ step }: { step: number }) {
  const f = FEATURES[step];
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
  return (
    <div className="flex w-[520px] flex-col gap-3">
      <div className="flex h-[26px] items-center gap-2 self-end rounded-[13px] bg-mm-recording-pill px-2.5 text-[12px] font-medium text-mm-on-recording-pill">
        <span className="flex gap-0.5">
          <span className="mm-bar h-3 w-[3px] rounded-[2px] bg-mm-recording-level" />
          <span className="mm-bar mm-bar-2 h-3 w-[3px] rounded-[2px] bg-mm-recording-level" />
        </span>
        Gravant <span className="tabular-nums opacity-70">03:12</span>
      </div>
      <div className={cn(card, "px-4 py-3.5")}>
        <div className="mb-1 flex items-center gap-2">
          <Flag speaker={0} name="Anna" className="h-[18px] text-[11px]" />
          <span className="text-[11px] tabular-nums text-mm-timestamp">2:58</span>
        </div>
        <div className="text-[14px] leading-[1.55]">
          Doncs si us sembla bé, tanquem el pressupost dijous i ho enviem divendres
          <span className="text-muted-foreground"> al client perquè ho</span>
          <span className="mm-caret ml-0.5 inline-block h-[15px] w-[2px] translate-y-[2px] bg-mm-caret" />
        </div>
      </div>
    </div>
  );
}

function SpeakersIllustration() {
  const people = [
    { name: "Anna", speaker: 0, share: 38 },
    { name: "Jordi", speaker: 1, share: 26 },
    { name: "Marta", speaker: 2, share: 22 },
    { name: "Tu", speaker: 0, share: 14, you: true },
  ];
  return (
    <div className="grid w-[520px] grid-cols-[1.2fr_1fr] gap-3">
      <div className={cn(card, "px-4 py-3.5")}>
        <div className="mb-2 text-[11px] font-semibold text-muted-foreground">Qui ha parlat</div>
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
        <div className="mb-2 text-[11px] font-semibold text-muted-foreground">Notes</div>
        {[
          ["2:58", "Pressupost tancat dijous"],
          ["7:40", "Revisar textos legals"],
        ].map(([t, text]) => (
          <div key={t} className="flex gap-2.5 py-0.5 text-[11px]">
            <span className="tabular-nums text-mm-timestamp">{t}</span>
            {text}
          </div>
        ))}
      </div>
    </div>
  );
}

function CoverIllustration() {
  return (
    <div className={cn(card, "w-[540px] px-5 py-4")}>
      <div className="text-[14px] font-bold">Pressupost i calendari del llançament</div>
      <div className="mt-2 h-1.5 w-11/12 rounded-full bg-mm-separator" />
      <div className="mt-1.5 h-1.5 w-2/3 rounded-full bg-mm-separator" />
      <div className="mt-4 grid grid-cols-2 gap-5 text-[11px]">
        <div>
          <div className="mb-1 font-semibold text-muted-foreground">Decisions</div>
          {[
            ["Enviar divendres", "2:58"],
            ["Descompte de llançament", "9:12"],
          ].map(([text, t]) => (
            <div key={t} className="flex items-center gap-1.5 py-0.5">
              <span className="size-1 rounded-full bg-foreground" />
              {text} <span className="tabular-nums text-mm-timestamp">{t}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="mb-1 font-semibold text-muted-foreground">Tasques</div>
          {[
            { text: "Tancar xifres", flag: <Flag speaker={0} name="Anna" className="h-4 px-1 text-[10px]" /> },
            { text: "Textos legals", flag: <Flag speaker={0} you name="Tu" className="h-4 px-1 text-[10px]" /> },
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
  return (
    <>
      <div className="absolute inset-x-0 top-0 flex h-[30px] items-center justify-end gap-3 bg-mm-background/70 px-4 text-[11px] font-medium">
        <span className="grid h-5 w-7 place-items-center rounded-[5px] bg-black/10 dark:bg-white/15">
          <LogoMark size={15} />
        </span>
        dl. 10:58
      </div>
      <div className="mt-6 w-[400px] overflow-hidden rounded-2xl bg-mm-toast-background text-mm-toast-text shadow-[0_8px_24px_rgb(0_0_0/0.18),0_0_0_1px_var(--mm-toast-border)]">
        <div className="flex items-center gap-3 py-3 pl-4 pr-3">
          <span className="grid size-5 place-items-center">
            <span className="mm-rec size-2 rounded-full bg-mm-recording-dot" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">Reunió detectada</div>
            <div className="text-[11px] text-mm-toast-secondary">Meet fa servir el micròfon</div>
          </div>
          <span className="flex h-8 items-center gap-1.5 rounded-lg bg-mm-accent px-2.5 text-[12px] font-semibold text-mm-on-accent">
            <LogoIcon size={16} /> Comença a gravar
          </span>
        </div>
      </div>
    </>
  );
}

// --- 6. Models -----------------------------------------------------------------------------

function Models({ step, onBack, onClose, onChange }: { step: number; onBack: () => void; onClose: () => void; onChange: Props["onChange"] }) {
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

  const title = phase === "ready" ? "Tot a punt" : phase === "downloading" ? "Descarregant els models" : "Descarrega els models";
  const intro =
    phase === "ready"
      ? "Ja pots gravar la teva primera reunió."
      : phase === "downloading"
        ? "La descàrrega continua encara que tanquis aquesta finestra."
        : "Murmur funciona amb models que s'executen en aquest Mac. Només cal descarregar-los un cop.";
  const size = (ids: ModelId[]) => bytes(ids.reduce((n, id) => n + (status(id)?.bytes ?? 0), 0));

  return (
    <>
      <div className="flex flex-1 flex-col overflow-y-auto px-12 pt-1">
        <div className="text-[12px] font-semibold text-muted-foreground">Últim pas</div>
        <h1 className="mt-1 text-[24px] font-bold leading-tight tracking-[-0.015em]">{title}</h1>
        <p className="mt-1.5 text-[14px] leading-normal text-foreground/80">{intro}</p>
        <div className="mt-4 overflow-hidden rounded-xl border border-border">
          <ModelRow
            icon={<AudioLines className="size-4" />}
            name="Model de transcripció"
            badge="Necessari"
            size={size(["transcription"])}
            text="Converteix la veu en text, en català i altres llengües, dins d'aquest Mac."
            state={rowState(["transcription"])}
            progress={progress(["transcription"])}
            error={models.errors.transcription}
            control={
              <span className="grid size-[22px] shrink-0 place-items-center rounded-md bg-foreground text-background opacity-50" aria-label="Sempre inclòs">
                <Check className="size-3.5" strokeWidth={3} />
              </span>
            }
          />
          <ModelRow
            icon={<Sparkles className="size-4" />}
            name="Eines de resum i portada"
            badge="Opcional"
            size={size(TOOLS)}
            text="Puntuació, títol, resum, decisions i tasques de cada reunió. Es pot afegir més endavant des de Configuració."
            state={tools ? rowState(TOOLS) : "idle"}
            progress={progress(TOOLS)}
            error={tools ? (models.errors.punctuation ?? models.errors.llm) : undefined}
            last
            control={<Switch checked={tools} disabled={started && phase !== "choose"} onCheckedChange={setTools} aria-label="Eines de resum i portada" />}
          />
        </div>
        <div className="mt-3 flex items-start gap-2.5 text-[12px] leading-normal text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Un cop descarregats, funcionen sense connexió. L'àudio i el text de les reunions no surten mai d'aquest ordinador: no hi ha núvol ni
            comptes.
          </span>
        </div>
      </div>
      {phase === "ready" ? (
        <Footer step={step} primary="Tanca" onNext={onClose} />
      ) : phase === "downloading" ? (
        <Footer step={step} back="Continua en segon pla" onBack={onClose} primary="Descarregant…" onNext={() => {}} disabled />
      ) : (
        <Footer
          step={step}
          onBack={onBack}
          primary={failed ? "Torna-ho a provar" : installed(wanted) ? "Comença" : "Descarrega i comença"}
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
                {state === "done" ? "Fet" : state === "waiting" ? "En espera" : `${Math.floor(progress * 100)} %`}
              </span>
            </div>
          )
        )}
      </div>
      {control}
    </div>
  );
}
