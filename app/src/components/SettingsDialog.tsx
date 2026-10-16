import { useEffect, useState } from "react";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AudioLines, CalendarDays, Mic, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import * as backend from "@/lib/backend";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  recording: boolean;
};

const TABS = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "audio", label: "Àudio", icon: Mic },
  { id: "transcription", label: "Transcripció", icon: AudioLines },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** Native-style Preferences window: icon tabs on top, grouped rows below. */
export function SettingsDialog({ open, onOpenChange, settings, onChange, recording }: Props) {
  const [tab, setTab] = useState<Tab>("general");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[620px]" showCloseButton={false}>
        <div className="border-b border-border px-4 pb-2 pt-3">
          <DialogTitle className="text-center text-[13px] font-semibold">Configuració</DialogTitle>
          <DialogDescription className="sr-only">Preferències de l'app</DialogDescription>
          <div className="mt-2 flex justify-center gap-1" role="tablist">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn("flex w-24 flex-col items-center gap-1 rounded-md py-1.5 text-[11px] text-muted-foreground", tab === id && "bg-black/[0.06] text-foreground dark:bg-white/10")}
              >
                <Icon className="size-5" strokeWidth={1.5} />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-[min(62vh,520px)] overflow-y-auto bg-[#f5f5f7] px-8 py-5 dark:bg-[#232325]">
          {recording && tab !== "general" && <p className="mb-3 text-[12px] text-muted-foreground">Els canvis s'aplicaran a la propera gravació.</p>}
          {tab === "general" && <GeneralTab settings={settings} onChange={onChange} />}
          {tab === "audio" && <AudioTab open={open} settings={settings} onChange={onChange} recording={recording} />}
          {tab === "transcription" && <TranscriptionTab settings={settings} onChange={onChange} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- General -------------------------------------------------------------------------------

function GeneralTab({ settings, onChange }: { settings: Settings; onChange: Props["onChange"] }) {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  useEffect(() => {
    if (backend.isTauri()) autostartEnabled().then(setAutostart).catch(() => setAutostart(null));
  }, []);
  const toggleAutostart = async (on: boolean) => {
    try {
      await (on ? enableAutostart() : disableAutostart());
      setAutostart(await autostartEnabled());
    } catch (e) {
      toast.error(String(e));
    }
  };
  return (
    <>
      <Group title="Inici">
        <Row label="Obre Transcriptor en iniciar la sessió" hint="L'app s'obrirà sola quan engeguis l'ordinador.">
          <Switch checked={!!autostart} disabled={autostart === null} onCheckedChange={toggleAutostart} />
        </Row>
      </Group>
      <Group title="Interfície">
        <Row label="Panell principal" hint="L'altre es mostra al costat i es pot amagar des de la barra d'eines.">
          <Segmented
            value={settings.primaryPanel}
            options={[
              { value: "transcript", label: "Transcripció" },
              { value: "notes", label: "Notes" },
            ]}
            onChange={(primaryPanel) => onChange({ primaryPanel })}
          />
        </Row>
      </Group>
      <Group title="Calendaris">
        <CalendarRow name="Google Calendar" />
        <CalendarRow name="Apple Calendar" />
      </Group>
      <p className="px-1 text-[11px] leading-snug text-muted-foreground">
        Amb un calendari connectat, les reunions agafaran el títol de l'esdeveniment i els noms dels convidats per anomenar els parlants.
      </p>
    </>
  );
}

function CalendarRow({ name }: { name: string }) {
  return (
    <Row label={name} hint="Encara no disponible">
      <span className="flex items-center gap-2">
        <CalendarDays className="size-4 text-muted-foreground" />
        <button type="button" disabled className="h-6 rounded-md border border-input bg-background px-2.5 text-[13px] opacity-50">
          Connecta
        </button>
      </span>
    </Row>
  );
}

// --- Àudio ---------------------------------------------------------------------------------

function AudioTab({ open, settings, onChange, recording }: { open: boolean; settings: Settings; onChange: Props["onChange"]; recording: boolean }) {
  const [microphones, setMicrophones] = useState<string[]>([]);
  useEffect(() => {
    // Refresh every time the window opens: devices come and go (AirPods, USB mics…).
    if (open && backend.isTauri()) backend.listMicrophones().then(setMicrophones).catch(() => setMicrophones([]));
  }, [open]);
  const missing = settings.micDevice && !microphones.includes(settings.micDevice);

  const chooseFolder = async () => {
    const dir = await openDialog({ directory: true, defaultPath: settings.recordingsDir ?? undefined, title: "Carpeta per a l'àudio de les reunions" });
    if (typeof dir === "string") onChange({ recordingsDir: dir });
  };

  return (
    <>
      <Group title="Fonts d'àudio">
        <Row label="Micròfon" hint="La teva veu i la de la sala. En una trucada, apareix com a «Tu».">
          <Switch checked={settings.mic} onCheckedChange={(mic) => onChange({ mic })} />
        </Row>
        {settings.mic && (
          <>
            <Row label="Dispositiu" hint={missing ? "No està connectat: es farà servir el del sistema." : undefined}>
              <select
                value={settings.micDevice ?? ""}
                onChange={(e) => onChange({ micDevice: e.target.value || null })}
                aria-label="Micròfon"
                className="h-6 max-w-56 truncate rounded-md border border-input bg-background px-1.5 text-[13px]"
              >
                <option value="">El del sistema{microphones[0] ? ` (${microphones[0]})` : ""}</option>
                {microphones.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                {missing && <option value={settings.micDevice!}>{settings.micDevice} (desconnectat)</option>}
              </select>
            </Row>
            <Row label="Nivell d'entrada" hint={recording ? "Ara mateix el micròfon s'està fent servir per gravar." : "Parla per comprovar que el micròfon funciona."}>
              {recording ? <span className="text-[12px] text-muted-foreground">En ús</span> : <InputLevel device={settings.micDevice} />}
            </Row>
          </>
        )}
        <Row label="Àudio del sistema" hint="Zoom, Meet, Teams… Es transcriu a part del micròfon i se n'elimina l'eco, també amb altaveus. Cal permís de «Gravació de pantalla i àudio del sistema».">
          <Switch checked={settings.system} onCheckedChange={(system) => onChange({ system })} />
        </Row>
      </Group>
      <Group title="Gravació">
        <Row label="Desa l'àudio de les reunions" hint="Comprimit en Opus, un canal per font (uns 11 MB per hora).">
          <Switch checked={settings.saveAudio} onCheckedChange={(saveAudio) => onChange({ saveAudio })} />
        </Row>
        <Row label="Carpeta" hint={settings.recordingsDir ?? "La carpeta de dades de l'app"}>
          <span className="flex shrink-0 gap-1.5">
            {settings.recordingsDir && (
              <button type="button" onClick={() => onChange({ recordingsDir: null })} className="h-6 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10">
                Per defecte
              </button>
            )}
            <button
              type="button"
              onClick={chooseFolder}
              disabled={!backend.isTauri()}
              className="h-6 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted disabled:opacity-50"
            >
              Tria…
            </button>
          </span>
        </Row>
      </Group>
    </>
  );
}

/** Live level of the selected microphone, like macOS's Sound › Input settings. */
function InputLevel({ device }: { device: string | null }) {
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!backend.isTauri()) return;
    let unlisten: (() => void) | undefined;
    let active = true;
    setError(null);
    backend.onMicLevel((rms) => active && setLevel(rms)).then((u) => (unlisten = u));
    backend.startMicMonitor(device).catch((e) => active && setError(String(e)));
    return () => {
      active = false;
      unlisten?.();
      backend.stopMicMonitor().catch(() => {});
      setLevel(0);
    };
  }, [device]);
  if (error) return <span className="max-w-48 text-right text-[11px] text-destructive">{error}</span>;
  // Speech sits around rms 0.01–0.1: map on a log scale to 12 segments.
  const lit = level <= 0 ? 0 : Math.round(Math.max(0, Math.min(1, (Math.log10(level) + 3) / 2.5)) * 12);
  return (
    <div className="flex items-center gap-[3px]" role="meter" aria-label="Nivell d'entrada" aria-valuemin={0} aria-valuemax={12} aria-valuenow={lit}>
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} className={cn("h-3.5 w-[7px] rounded-[2px] transition-colors duration-75", i < lit ? (i < 9 ? "bg-[#34c759]" : i < 11 ? "bg-[#ffcc00]" : "bg-[#ff3b30]") : "bg-black/10 dark:bg-white/15")} />
      ))}
    </div>
  );
}

// --- Transcripció --------------------------------------------------------------------------

function TranscriptionTab({ settings, onChange }: { settings: Settings; onChange: Props["onChange"] }) {
  return (
    <>
      <Group title="Parlants en directe">
        <Row label="Nombre màxim de parlants">
          <input
            type="number"
            min={1}
            max={10}
            value={settings.maxSpeakers}
            onChange={(e) => onChange({ maxSpeakers: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
            aria-label="Nombre màxim de parlants"
            className="h-6 w-14 rounded-md border border-input bg-background px-2 text-right text-[13px] tabular-nums"
          />
        </Row>
        <Row label="Separació de veus" hint="Més alt separa més les veus; més baix les agrupa.">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0.4}
              max={0.85}
              step={0.05}
              value={settings.threshold}
              onChange={(e) => onChange({ threshold: Number(e.target.value) })}
              className="w-32 accent-primary"
              aria-label="Separació de veus"
            />
            <span className="w-8 text-right text-[12px] tabular-nums text-muted-foreground">{settings.threshold.toFixed(2).replace(".", ",")}</span>
            <button
              type="button"
              onClick={() => onChange({ threshold: DEFAULT_SETTINGS.threshold })}
              disabled={settings.threshold === DEFAULT_SETTINGS.threshold}
              title={`Torna al valor per defecte (${DEFAULT_SETTINGS.threshold.toFixed(2).replace(".", ",")})`}
              className="h-6 rounded-md px-2 text-[12px] text-primary hover:bg-black/5 disabled:invisible dark:hover:bg-white/10"
            >
              Restableix
            </button>
          </div>
        </Row>
      </Group>
      <Group title="En acabar la gravació">
        <Row
          label="Verificació de parlants"
          hint="Torna a analitzar tota la reunió per separar millor les veus. Pot trigar uns minuts (unes 2–4 per hora de reunió), però pots continuar treballant mentrestant. Encara l'estem ajustant."
        >
          <Switch checked={settings.verifySpeakers} onCheckedChange={(verifySpeakers) => onChange({ verifySpeakers })} />
        </Row>
      </Group>
      <p className="px-1 text-[11px] leading-snug text-muted-foreground">Aviat: resum, acords i tasques amb un model local o la teva clau d'API.</p>
    </>
  );
}

// --- Building blocks -----------------------------------------------------------------------

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" className="flex shrink-0 rounded-[7px] bg-black/[0.06] p-0.5 dark:bg-white/10">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("h-6 rounded-[5px] px-3 text-[12px]", value === o.value ? "bg-background font-medium shadow-[0_1px_2px_rgb(0_0_0/0.15)]" : "text-muted-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-1.5 px-1 text-[12px] font-semibold text-muted-foreground">{title}</h3>
      <div className="divide-y divide-border rounded-[10px] border border-border bg-background">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-4 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[13px]">{label}</div>
        {hint && <div className="mt-0.5 break-words text-[11px] leading-snug text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
