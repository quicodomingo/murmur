import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { AudioLines, CalendarDays, Check, ChevronRight, Contrast, Lock, Mic, SlidersHorizontal, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { THEMES, type Theme } from "@/lib/appearance";
import * as backend from "@/lib/backend";
import { coverDocument, llmTasks, PROMPTS, promptText, type PromptId } from "@/lib/cover";
import { bytes, deleteModel, downloadModel, useModels } from "@/lib/models";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import type { LlmProgress, LlmResult, Meeting, ModelId } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  recording: boolean;
  /** The open meeting, to try prompts on (only a finished one with a transcript). */
  meeting: Meeting | null;
  /** "Comprova ara": the updates window (UpdatesDialog). */
  onCheckUpdates: () => void;
};

const TABS = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "appearance", label: "Aparença", icon: Contrast },
  { id: "calendar", label: "Calendari", icon: CalendarDays },
  { id: "audio", label: "Àudio", icon: Mic },
  { id: "transcription", label: "Transcripció", icon: AudioLines },
  { id: "intelligence", label: "Intel·ligència", icon: Sparkles },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** Native-style Preferences window: icon tabs on top, grouped rows below. */
export function SettingsDialog({ open, onOpenChange, settings, onChange, recording, meeting, onCheckUpdates }: Props) {
  const [tab, setTab] = useState<Tab>("general");
  // Trying prompts keeps the language model loaded; free its memory when the window closes.
  const llmLoaded = useRef(false);
  useEffect(() => {
    if (!open && llmLoaded.current) {
      llmLoaded.current = false;
      backend.releaseLlm().catch(() => {});
    }
  }, [open]);
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
                className={cn("flex w-[88px] flex-col items-center gap-1 rounded-md py-1.5 text-[11px] text-muted-foreground", tab === id && "bg-mm-tab-selected text-foreground")}
              >
                <Icon className="size-5" strokeWidth={1.5} />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-[min(62vh,520px)] overflow-y-auto bg-mm-settings-background px-8 py-5">
          {recording && ["audio", "transcription", "intelligence"].includes(tab) && <p className="mb-3 text-[12px] text-muted-foreground">Els canvis s'aplicaran a la propera gravació.</p>}
          {tab === "general" && <GeneralTab settings={settings} onChange={onChange} onGoTo={setTab} onCheckUpdates={onCheckUpdates} />}
          {tab === "appearance" && <AppearanceTab settings={settings} onChange={onChange} />}
          {tab === "calendar" && <CalendarSettings settings={settings} onChange={onChange} />}
          {tab === "audio" && <AudioTab open={open} settings={settings} onChange={onChange} recording={recording} />}
          {tab === "transcription" && <TranscriptionTab settings={settings} onChange={onChange} />}
          {tab === "intelligence" && <IntelligenceTab settings={settings} onChange={onChange} meeting={meeting} onLlmLoaded={() => (llmLoaded.current = true)} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- General -------------------------------------------------------------------------------

/** How Murmur behaves: when it opens, how it invites you to record, what shows while recording. */
function GeneralTab({
  settings,
  onChange,
  onGoTo,
  onCheckUpdates,
}: {
  settings: Settings;
  onChange: Props["onChange"];
  onGoTo: (tab: Tab) => void;
  onCheckUpdates: () => void;
}) {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<backend.Access | null>(null);
  useEffect(() => {
    if (!backend.isTauri()) return;
    autostartEnabled().then(setAutostart).catch(() => setAutostart(null));
    getVersion().then(setVersion).catch(() => {});
    backend.calendarAccess().then(setCalendar).catch(() => {});
  }, []);
  const toggleAutostart = async (on: boolean) => {
    try {
      await (on ? enableAutostart() : disableAutostart());
      setAutostart(await autostartEnabled());
    } catch (e) {
      toast.error(String(e));
    }
  };
  const connected = calendar === "granted" && settings.calendarEnabled;
  return (
    <>
      <Group title="Inici">
        <Row label="Obre Murmur en iniciar la sessió" hint="L'app s'obrirà sola quan engeguis l'ordinador.">
          <Switch checked={!!autostart} disabled={autostart === null} onCheckedChange={toggleAutostart} />
        </Row>
      </Group>
      <Group title="Actualitzacions">
        <Row label={version ? `Murmur ${version}` : "Murmur"} hint="Busca versions noves de l'app i dels models, i les instal·la totes alhora.">
          <button type="button" onClick={onCheckUpdates} disabled={!backend.isTauri()} className="h-6 shrink-0 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted disabled:opacity-50">
            Comprova ara
          </button>
        </Row>
        <Row
          label="Comprova-ho en obrir Murmur"
          hint="És l'única connexió que Murmur fa per iniciativa pròpia: GitHub veu la teva adreça IP i quina versió tens. No s'hi envia res més."
        >
          <Switch checked={settings.checkUpdates} onCheckedChange={(checkUpdates) => onChange({ checkUpdates })} />
        </Row>
      </Group>
      <Group title="Abans de la reunió">
        <Row label="Reunió detectada" hint="Quan una altra app (Zoom, Meet, Teams…) comença a fer servir el micròfon, Murmur et proposa gravar.">
          <Switch checked={settings.detectMeetings} onCheckedChange={(detectMeetings) => onChange({ detectMeetings })} />
        </Row>
        <div className="flex min-h-11 items-center gap-4 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[13px]">Avisa quan comenci una reunió del calendari</div>
            <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              {connected ? (
                "Uns 2 minuts abans, amb un botó per començar a gravar. La gravació agafa el títol i els convidats de l'esdeveniment."
              ) : (
                <>
                  Cal connectar el calendari.{" "}
                  <button type="button" className="text-mm-link hover:underline" onClick={() => onGoTo("calendar")}>
                    Ves a Calendari
                  </button>
                </>
              )}
            </div>
          </div>
          <Switch checked={connected && settings.calendarAlerts} disabled={!connected} onCheckedChange={(calendarAlerts) => onChange({ calendarAlerts })} />
        </div>
      </Group>
      <Group title="Durant la gravació">
        <Row label="Indicador de gravació" hint="Una píndola a la dreta de la pantalla per tornar a Murmur, fer una captura o aturar la gravació. Es pot arrossegar.">
          <Switch checked={settings.recordingIndicator} onCheckedChange={(recordingIndicator) => onChange({ recordingIndicator })} />
        </Row>
        <div className={cn(!settings.recordingIndicator && "opacity-50")}>
          <Row label="Mode compacte en clicar l'indicador" hint="Murmur es fa estreta, al costat de la trucada i sempre al davant, només amb les notes.">
            <Switch checked={settings.compactNotes} disabled={!settings.recordingIndicator} onCheckedChange={(compactNotes) => onChange({ compactNotes })} />
          </Row>
        </div>
      </Group>
    </>
  );
}

/**
 * Calendari tab: the macOS calendar, with every account added to the system (iCloud, Google,
 * Exchange…), and which calendars and events Murmur watches. The alert itself is in General.
 */
function CalendarSettings({ settings, onChange }: { settings: Settings; onChange: Props["onChange"] }) {
  const [access, setAccess] = useState<backend.Access | null>(null);
  const [calendars, setCalendars] = useState<backend.CalendarInfo[]>([]);
  /** Just connected: macOS is still loading the accounts, so the list may come empty at first. */
  const [syncing, setSyncing] = useState(false);
  const alive = useRef(true);
  const refresh = () => {
    if (!backend.isTauri()) return;
    backend
      .calendarAccess()
      .then(async (a) => {
        setAccess(a);
        if (a === "granted") setCalendars(await backend.listCalendars());
      })
      .catch(() => {});
  };
  const connect = async () => {
    onChange({ calendarEnabled: true });
    const a = await backend.requestCalendarAccess().catch(() => "denied" as const);
    setAccess(a);
    if (a !== "granted") return;
    setSyncing(true);
    // Ask again every second until the calendars show up (20 s at most).
    for (let i = 0; i < 20 && alive.current; i++) {
      const list = await backend.listCalendars().catch(() => []);
      if (list.length) {
        setCalendars(list);
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (alive.current) setSyncing(false);
  };
  useEffect(() => {
    alive.current = true;
    refresh();
    // Coming back from System Settings.
    window.addEventListener("focus", refresh);
    return () => {
      alive.current = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const button = "h-6 shrink-0 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted";
  const footnote = (
    <p className="-mt-3 mb-5 px-1 text-[11px] leading-snug text-muted-foreground">
      Murmur llegeix els calendaris que tens a l'app Calendari de macOS. Per afegir-hi Google Calendar, afegeix el compte a Configuració del Sistema › Comptes d'Internet.
    </p>
  );
  if (access !== "granted" || !settings.calendarEnabled) {
    return (
      <>
        <Group title="Connexió">
          <Row
            label="Calendari de macOS"
            hint={
              access === "denied"
                ? "Denegat. Activa Murmur a Configuració del Sistema › Privadesa i seguretat › Calendaris."
                : access === "granted"
                  ? "Desconnectat: Murmur no el llegeix. macOS encara li dona permís; el pots retirar a Configuració del Sistema."
                  : "Per avisar-te quan comença una reunió i posar-li el títol de l'esdeveniment. Només el llegeix."
            }
          >
            <span className="flex items-center gap-2">
              <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
              {access === "denied" ? (
                <button type="button" className={button} onClick={() => backend.openPrivacySettings("calendars")}>
                  Obre Configuració
                </button>
              ) : (
                <>
                  {/* Disconnected: Murmur can't remove its own permission; System Settings can. */}
                  {access === "granted" && (
                    <button type="button" className={button} onClick={() => backend.openPrivacySettings("calendars")}>
                      Retira el permís…
                    </button>
                  )}
                  <button type="button" className={button} disabled={access === null} onClick={connect}>
                    Connecta…
                  </button>
                </>
              )}
            </span>
          </Row>
        </Group>
        {footnote}
      </>
    );
  }

  const ids = calendars.map((c) => c.id);
  const watched = (id: string) => settings.calendarIds === null || settings.calendarIds.includes(id);
  const toggle = (id: string, on: boolean) => {
    const next = (settings.calendarIds ?? ids).filter((c) => c !== id && ids.includes(c));
    if (on) next.push(id);
    onChange({ calendarIds: next.length === ids.length ? null : next });
  };
  return (
    <>
      <Group title="Connexió">
        <Row label="Calendari de macOS" hint="Connectat. Murmur només el llegeix: no hi crea ni hi canvia res.">
          <span className="flex shrink-0 items-center gap-2">
            <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
              <Check className="size-3.5" aria-hidden /> Permès
            </span>
            <button type="button" className={button} onClick={() => onChange({ calendarEnabled: false })}>
              Desconnecta
            </button>
          </span>
        </Row>

      </Group>
      <Group title="Esdeveniments">
        <Row label="Inclou els esdeveniments sense convidats" hint="Per defecte només compten com a reunions els que tenen convidats o un enllaç de videotrucada.">
          <Switch checked={settings.calendarNoGuests} onCheckedChange={(calendarNoGuests) => onChange({ calendarNoGuests })} />
        </Row>
      </Group>
      <section className="mb-5">
        <div className="mb-1.5 flex items-baseline justify-between px-1">
          <h3 className="text-[12px] font-semibold text-muted-foreground">Calendaris que vigila</h3>
          {settings.calendarIds !== null && (
            <button type="button" className="text-[12px] text-mm-link hover:underline" onClick={() => onChange({ calendarIds: null })}>
              Tots
            </button>
          )}
        </div>
        <div className="divide-y divide-border rounded-[10px] border border-border bg-background">
          {calendars.length === 0 &&
            (syncing ? (
              <div className="flex min-h-11 items-center gap-2.5 px-3 py-2 text-[13px] text-muted-foreground" role="status">
                <span className="size-3.5 animate-spin rounded-full border-2 border-primary/25 border-t-primary motion-reduce:animate-none" aria-hidden />
                Sincronitzant els calendaris…
              </div>
            ) : (
              <Row label="No hi ha cap calendari" hint="Afegeix-ne un a l'app Calendari de macOS.">{null}</Row>
            ))}
          {calendars.map((c) => (
            <div key={c.id} className="flex min-h-11 items-center gap-3 px-3 py-2">
              {/* The calendar's own colour, as macOS shows it. */}
              <span className="size-3 shrink-0 rounded-[3px]" style={{ backgroundColor: c.color }} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">{c.title}</div>
                {c.account && c.account !== c.title && <div className="truncate text-[11px] text-muted-foreground">{c.account}</div>}
              </div>
              <Switch checked={watched(c.id)} onCheckedChange={(on) => toggle(c.id, on)} aria-label={`Vigila ${c.title}`} />
            </div>
          ))}
        </div>
      </section>
      {footnote}
    </>
  );
}

// --- Aparença ------------------------------------------------------------------------------

function AppearanceTab({ settings, onChange }: { settings: Settings; onChange: Props["onChange"] }) {
  return (
    <>
      <h3 className="mb-1.5 px-1 text-[12px] font-semibold text-muted-foreground">Tema</h3>
      <div role="radiogroup" aria-label="Tema" className="grid grid-cols-3 gap-3">
        {THEMES.map((t) => {
          const selected = settings.theme === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange({ theme: t.id })}
              className={cn(
                "flex flex-col gap-2 rounded-[10px] bg-background p-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                selected ? "shadow-[0_0_0_2px_var(--mm-text-primary)]" : "shadow-[0_0_0_1px_var(--mm-separator)] hover:shadow-[0_0_0_1px_var(--mm-text-tertiary)]",
              )}
            >
              <div className="flex h-[88px] overflow-hidden rounded-md shadow-[0_0_0_1px_rgb(127_127_127/0.25)]">
                <ThemePreview theme={t.id} mode="light" />
                <ThemePreview theme={t.id} mode="dark" />
              </div>
              <div className="flex items-center gap-1.5 px-0.5">
                <span className="flex-1 text-[13px] font-medium">{t.label}</span>
                {selected && (
                  <span className="grid size-4 place-items-center rounded-full bg-foreground text-background" aria-hidden>
                    <Check className="size-2.5" strokeWidth={3.5} />
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <p className="mb-5 mt-1.5 px-1 text-[11px] leading-snug text-muted-foreground">Cada tema té versió clara i fosca. La previsualització mostra totes dues.</p>
      <Group title="Mode">
        <Row label="Aparença" hint="Segueix el sistema o fixa el mode clar o fosc.">
          <Segmented
            value={settings.mode}
            options={[
              { value: "system", label: "Sistema" },
              { value: "light", label: "Clar" },
              { value: "dark", label: "Fosc" },
            ]}
            onChange={(mode) => onChange({ mode })}
          />
        </Row>
      </Group>
      <Group title="Disposició">
        <Row label="Panell principal" hint="L'altre es mostra al costat i es pot amagar des de la barra d'eines.">
          <Segmented
            value={settings.primaryPanel}
            options={[
              { value: "notes", label: "Notes" },
              { value: "transcript", label: "Transcripció" },
            ]}
            onChange={(primaryPanel) => onChange({ primaryPanel })}
          />
        </Row>
      </Group>
    </>
  );
}

/** Half of a theme card: a tiny window drawn with that theme's own tokens. */
function ThemePreview({ theme, mode }: { theme: Theme; mode: "light" | "dark" }) {
  const line = mode === "light" ? "bg-black/[0.12]" : "bg-white/[0.12]";
  return (
    <div data-theme={theme} data-mode={mode} className="flex flex-1 bg-mm-background">
      <div className="flex w-5 flex-col gap-1 bg-mm-sidebar px-[3px] py-2">
        <span className="h-1 rounded-[2px] bg-mm-sidebar-selection-bar" />
        <span className={cn("h-1 rounded-[2px]", line)} />
        <span className={cn("h-1 rounded-[2px]", line)} />
      </div>
      <div className="flex flex-1 flex-col gap-[5px] px-1.5 py-2">
        <span className="h-1.5 w-4 self-end rounded-[3px] bg-mm-accent" />
        <span className={cn("h-1 w-4/5 rounded-[2px]", line)} />
        <span className={cn("h-1 w-3/5 rounded-[2px]", line)} />
        <span className={cn("h-1 w-[70%] rounded-[2px]", line)} />
      </div>
    </div>
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
      <PermissionsGroup open={open} />
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
        <Row label="Àudio del sistema" hint="Zoom, Meet, Teams… Es transcriu a part del micròfon i se n'elimina l'eco, també amb altaveus. Només l'àudio: Murmur no veu la pantalla.">
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

/** What macOS lets Murmur record, with the way to fix it right there. */
function PermissionsGroup({ open }: { open: boolean }) {
  const [status, setStatus] = useState<backend.Permissions | null>(null);
  const refresh = () => {
    if (backend.isTauri()) backend.permissionStatus().then(setStatus).catch(() => {});
  };
  useEffect(() => {
    if (!open) return;
    refresh();
    // Coming back from System Settings.
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [open]);
  if (!status) return null;

  const button = "h-6 shrink-0 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted";
  const granted = (
    <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground">
      <Check className="size-3.5" aria-hidden /> Permès
    </span>
  );
  return (
    <Group title="Permisos">
      <Row
        label="Micròfon"
        hint={
          status.microphone === "denied"
            ? "Denegat. Activa Murmur a Configuració del Sistema › Privadesa i seguretat › Micròfon."
            : status.microphone === "undetermined"
              ? "Encara no l'has permès. macOS t'ho preguntarà."
              : undefined
        }
      >
        {status.microphone === "granted" ? (
          granted
        ) : status.microphone === "undetermined" ? (
          <button type="button" className={button} onClick={() => backend.requestMicrophone().then(refresh)}>
            Permet…
          </button>
        ) : (
          <button type="button" className={button} onClick={() => backend.openPrivacySettings("microphone")}>
            Obre Configuració
          </button>
        )}
      </Row>
      <Row
        label="Àudio del sistema"
        hint={
          status.systemAudio === "denied"
            ? "Denegat. Activa Murmur a Configuració del Sistema › Gravació de pantalla i àudio del sistema › Només àudio del sistema."
            : status.systemAudio === "undetermined"
              ? "Per sentir l'altra banda de les trucades. macOS t'ho preguntarà."
              : "Per sentir l'altra banda de les trucades. Només l'àudio: Murmur no veu la pantalla."
        }
      >
        {status.systemAudio === "granted" ? (
          granted
        ) : status.systemAudio === "undetermined" ? (
          <button type="button" className={button} onClick={() => backend.requestSystemAudio().then(refresh)}>
            Permet…
          </button>
        ) : (
          <button type="button" className={button} onClick={() => backend.openPrivacySettings("systemAudio")}>
            Obre Configuració
          </button>
        )}
      </Row>
      <Row label="Gravació de pantalla" hint="Només per a les captures que fas des de l'indicador. Murmur no grava mai la pantalla.">
        {status.screen ? (
          granted
        ) : (
          <button type="button" className={button} onClick={() => backend.requestScreen().then(refresh)}>
            Permet…
          </button>
        )}
      </Row>
    </Group>
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
        <span key={i} className={cn("h-3.5 w-[7px] rounded-[2px] transition-colors duration-75", i < lit ? (i < 11 ? "bg-mm-toggle-on" : "bg-mm-recording-dot") : "bg-mm-meter-off")} />
      ))}
    </div>
  );
}

// --- Transcripció --------------------------------------------------------------------------

function TranscriptionTab({ settings, onChange }: { settings: Settings; onChange: Props["onChange"] }) {
  const models = useModels();
  return (
    <>
      <Group title="Parlants en directe">
        <Row
          label="Hi ha més gent amb mi a la sala"
          hint="En una trucada, tot el que entra pel micròfon és «Tu». Activa-ho si sou més d'una persona davant del mateix ordinador."
        >
          <Switch checked={settings.roomSpeakers} onCheckedChange={(roomSpeakers) => onChange({ roomSpeakers })} />
        </Row>
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
              className="h-6 rounded-md px-2 text-[12px] text-mm-link hover:bg-black/5 disabled:invisible dark:hover:bg-white/10"
            >
              Restableix
            </button>
          </div>
        </Row>
      </Group>
      <Group title="En acabar la gravació">
        <Row
          label="Verificació de parlants"
          hint="Torna a analitzar tota la reunió per separar millor les veus. Pot trigar uns minuts (uns 7 per hora de reunió), però pots continuar treballant mentrestant."
        >
          <Switch checked={settings.verifySpeakers} onCheckedChange={(verifySpeakers) => onChange({ verifySpeakers })} />
        </Row>
        <Row label="Puntuació i majúscules" hint="Posa punts, comes i majúscules a tota la transcripció. Triga uns segons.">
          <Switch checked={settings.punctuate} onCheckedChange={(on) => enableWithModel(models, "punctuation", on, () => onChange({ punctuate: on }))} />
        </Row>
        <ModelRow id="punctuation" name="Model de puntuació de Softcatalà" enabled={settings.punctuate} onDisable={() => onChange({ punctuate: false })} />
      </Group>
    </>
  );
}

// --- Intel·ligència ------------------------------------------------------------------------

function IntelligenceTab({
  settings,
  onChange,
  meeting,
  onLlmLoaded,
}: {
  settings: Settings;
  onChange: Props["onChange"];
  meeting: Meeting | null;
  onLlmLoaded: () => void;
}) {
  const models = useModels();
  return (
    <>
      <Group title="Portada">
        <Row
          label="Genera la portada en acabar la gravació"
          hint="Un model de llenguatge llegeix la transcripció i en fa el títol, el resum, les decisions, les tasques i les parts. Triga uns 2–3 minuts per a una reunió de 20 minuts; pots continuar treballant mentrestant."
        >
          <Switch checked={settings.summarize} onCheckedChange={(on) => enableWithModel(models, "llm", on, () => onChange({ summarize: on }))} />
        </Row>
        <ModelRow id="llm" name="Gemma 4 E4B, de Google" enabled={settings.summarize} onDisable={() => onChange({ summarize: false })} />
      </Group>
      <p className="-mt-3 mb-5 flex gap-1.5 px-1 text-[11px] leading-snug text-muted-foreground">
        <Lock className="mt-px size-3 shrink-0" aria-hidden />
        <span>Tot es fa en aquest ordinador: la transcripció no surt d'aquí. Els models es descarreguen només si actives la funció, i els pots esborrar quan vulguis.</span>
      </p>
      <PromptsEditor settings={settings} onChange={onChange} meeting={meeting} llmReady={!!models.status.llm?.installed} onLlmLoaded={onLlmLoaded} />
    </>
  );
}

/** Turning a feature on fetches its model if it isn't there yet. */
function enableWithModel(models: ReturnType<typeof useModels>, id: ModelId, on: boolean, apply: () => void) {
  apply();
  const status = models.status[id];
  if (on && status && !status.installed && status.downloadable && !models.downloading[id]) downloadModel(id);
}

/** A model's state under its feature: size, download progress, download/stop/delete. */
function ModelRow({ id, name, enabled, onDisable }: { id: ModelId; name: string; enabled: boolean; onDisable: () => void }) {
  const { status: all, downloading: active } = useModels();
  const status = all[id];
  const downloading = active[id];
  if (!status) return null;

  const remove = async () => {
    const message = `S'esborrarà ${name} (${bytes(status.bytes)}). El pots tornar a descarregar quan vulguis.`;
    const confirmed = backend.isTauri()
      ? await ask(message, { title: "Vols esborrar el model?", kind: "warning", okLabel: "Esborra", cancelLabel: "Cancel·la" })
      : window.confirm(message);
    if (!confirmed) return;
    await deleteModel(id);
    if (enabled) onDisable();
  };

  const button = "h-6 shrink-0 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted disabled:opacity-50";
  let text: string;
  let action: React.ReactNode = null;
  if (downloading) {
    const share = downloading.total ? downloading.done / downloading.total : 0;
    text = `Descarregant… ${Math.floor(share * 100)}% · ${bytes(downloading.done)} de ${bytes(downloading.total || status.bytes)}`;
    action = (
      <button type="button" className={button} onClick={() => backend.cancelModelDownload(id)}>
        Atura
      </button>
    );
  } else if (status.installed) {
    text = `Descarregat · ${bytes(status.bytes)}`;
    action = (
      <button type="button" className={cn(button, "text-destructive")} onClick={remove}>
        Esborra…
      </button>
    );
  } else if (!status.downloadable) {
    text = `Encara no es pot descarregar des de l'app · ${bytes(status.bytes)}`;
  } else {
    text = status.downloaded ? `Descàrrega aturada · ${bytes(status.downloaded)} de ${bytes(status.bytes)}` : `No descarregat · ${bytes(status.bytes)}`;
    action = (
      <span className="flex shrink-0 gap-1.5">
        {status.downloaded > 0 && (
          <button type="button" className="h-6 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10" onClick={remove}>
            Esborra
          </button>
        )}
        <button type="button" className={button} onClick={() => downloadModel(id)}>
          {status.downloaded ? "Continua" : "Descarrega"}
        </button>
      </span>
    );
  }
  return (
    <div className="flex items-center gap-4 bg-black/[0.015] py-2 pl-6 pr-3 dark:bg-white/[0.02]">
      <div className="min-w-0 flex-1">
        <div className="text-[12px]">{name}</div>
        <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{text}</div>
        {downloading && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-mm-meter-off" role="progressbar" aria-label={`Descàrrega de ${name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor((downloading.done / (downloading.total || 1)) * 100)}>
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${(downloading.done / (downloading.total || 1)) * 100}%` }} />
          </div>
        )}
      </div>
      {action}
    </div>
  );
}

/** Edit the prompt behind each part of the cover and try it on the open meeting. */
function PromptsEditor({
  settings,
  onChange,
  meeting,
  llmReady,
  onLlmLoaded,
}: {
  settings: Settings;
  onChange: Props["onChange"];
  meeting: Meeting | null;
  llmReady: boolean;
  onLlmLoaded: () => void;
}) {
  const [openId, setOpenId] = useState<PromptId | null>(null);
  return (
    <section className="mb-5">
      <h3 className="mb-1.5 px-1 text-[12px] font-semibold text-muted-foreground">Prompts de la portada</h3>
      <div className="divide-y divide-border rounded-[10px] border border-border bg-background">
        {PROMPTS.map((p) => {
          const edited = !!settings.prompts[p.id]?.trim() && settings.prompts[p.id] !== p.text;
          const expanded = openId === p.id;
          return (
            <div key={p.id}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpenId(expanded ? null : p.id)}
                className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
              >
                <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", expanded && "rotate-90")} aria-hidden />
                <span className="flex-1">{p.label}</span>
                {edited && <span className="rounded bg-mm-fill-subtle px-1.5 py-px text-[11px] font-medium text-foreground">Modificat</span>}
              </button>
              {expanded && <PromptEditor id={p.id} settings={settings} onChange={onChange} meeting={meeting} llmReady={llmReady} onLlmLoaded={onLlmLoaded} />}
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 px-1 text-[11px] leading-snug text-muted-foreground">
        Les respostes sempre segueixen el mateix format (JSON), així que pots canviar el text sense trencar la portada. Els canvis s'apliquen a les properes portades.
      </p>
    </section>
  );
}

function PromptEditor({
  id,
  settings,
  onChange,
  meeting,
  llmReady,
  onLlmLoaded,
}: {
  id: PromptId;
  settings: Settings;
  onChange: Props["onChange"];
  meeting: Meeting | null;
  llmReady: boolean;
  onLlmLoaded: () => void;
}) {
  const def = PROMPTS.find((p) => p.id === id)!;
  const value = settings.prompts[id] ?? def.text;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<LlmProgress | null>(null);
  const [result, setResult] = useState<{ answer: LlmResult; readSeconds: number | null; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (text: string) => {
    const { [id]: _old, ...rest } = settings.prompts;
    onChange({ prompts: text === def.text ? rest : { ...rest, [id]: text } });
  };

  const test = async () => {
    if (!meeting) return;
    setBusy(true);
    setResult(null);
    setError(null);
    setProgress(null);
    const job = `prompt-${crypto.randomUUID()}`;
    const unlisten = await backend.onLlmProgress((e) => e.job === job && setProgress(e));
    const started = Date.now();
    try {
      onLlmLoaded();
      // The general instructions are tried with the title (the quickest part).
      const [answer] = await backend.runLlm({
        job,
        system: promptText("system", settings.prompts),
        document: coverDocument(meeting),
        tasks: llmTasks(settings.prompts, [id === "system" ? "title" : id]),
        keepLoaded: true,
      });
      setResult({ answer, readSeconds: null, total: (Date.now() - started) / 1000 });
    } catch (e) {
      setError(String(e));
    } finally {
      unlisten();
      setBusy(false);
    }
  };

  const pretty = (text: string) => {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  };
  const status = !progress
    ? "Preparant…"
    : progress.step === "loading"
      ? "Carregant el model…"
      : progress.step === "reading"
        ? "Llegint la transcripció…"
        : "Escrivint la resposta…";
  const blocked = !llmReady ? "Primer descarrega el model de llenguatge." : !meeting ? "Obre una reunió acabada per provar-hi el prompt." : null;

  return (
    <div className="px-3 pb-3">
      <textarea
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-label={`Prompt: ${def.label}`}
        rows={id === "system" ? 5 : 4}
        className="block w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-[12px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={test}
          disabled={busy || !!blocked}
          title={blocked ?? undefined}
          className="h-6 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted disabled:opacity-50"
        >
          {busy ? status : "Prova amb aquesta reunió"}
        </button>
        <button
          type="button"
          onClick={() => set(def.text)}
          disabled={value === def.text}
          className="h-6 rounded-md px-2 text-[12px] text-mm-link hover:bg-black/5 disabled:invisible dark:hover:bg-white/10"
        >
          Restableix
        </button>
        {blocked && <span className="text-[11px] text-muted-foreground">{blocked}</span>}
        {!blocked && meeting && !busy && !result && <span className="truncate text-[11px] text-muted-foreground">«{meeting.title}»</span>}
      </div>
      {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
      {result && (
        <div className="mt-2">
          <div className="mb-1 text-[11px] tabular-nums text-muted-foreground">
            {result.answer.error ? "Error" : `Resposta en ${result.answer.seconds.toFixed(1).replace(".", ",")} s · ${result.answer.tokens} tokens`} · total{" "}
            {result.total.toFixed(0)} s amb la lectura
          </div>
          <pre className="selectable max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-muted px-2 py-1.5 text-[11px] leading-relaxed">
            {result.answer.error ?? pretty(result.answer.text ?? "")}
          </pre>
        </div>
      )}
    </div>
  );
}

// --- Building blocks -----------------------------------------------------------------------

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" className="flex shrink-0 rounded-[7px] bg-mm-segmented-track p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("h-6 rounded-[5px] px-3 text-[12px]", value === o.value ? "bg-mm-segmented-selected font-medium shadow-[0_1px_2px_rgb(0_0_0/0.15)]" : "text-muted-foreground")}
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
