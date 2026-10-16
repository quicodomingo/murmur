import { useEffect, useState } from "react";
import { AudioLines, Mic } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import * as backend from "@/lib/backend";
import type { Settings } from "@/lib/settings";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  recording: boolean;
};

const TABS = [
  { id: "audio", label: "Àudio", icon: Mic },
  { id: "transcription", label: "Transcripció", icon: AudioLines },
] as const;

/** Native-style Preferences window: icon tabs on top, grouped rows below. */
export function SettingsDialog({ open, onOpenChange, settings, onChange, recording }: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("audio");
  const [microphones, setMicrophones] = useState<string[]>([]);
  useEffect(() => {
    // Refresh every time the window opens: devices come and go (AirPods, USB mics…).
    if (open && backend.isTauri()) backend.listMicrophones().then(setMicrophones).catch(() => setMicrophones([]));
  }, [open]);
  const missing = settings.micDevice && !microphones.includes(settings.micDevice);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[600px]" showCloseButton={false}>
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

        <div className="max-h-[60vh] overflow-y-auto bg-[#f5f5f7] px-8 py-5 dark:bg-[#232325]">
          {recording && <p className="mb-3 text-[12px] text-muted-foreground">Els canvis s'aplicaran a la propera gravació.</p>}
          {tab === "audio" ? (
            <>
              <Group title="Fonts d'àudio">
                <Row label="Micròfon" hint="La teva veu i la de la sala. En una trucada, apareix com a «Tu».">
                  <Switch checked={settings.mic} onCheckedChange={(mic) => onChange({ mic })} />
                </Row>
                {settings.mic && (
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
                )}
                <Row label="Àudio del sistema" hint="Zoom, Meet, Teams… Es transcriu a part del micròfon i se n'elimina l'eco, també amb altaveus. Cal permís de «Gravació de pantalla i àudio del sistema».">
                  <Switch checked={settings.system} onCheckedChange={(system) => onChange({ system })} />
                </Row>
              </Group>
              <Group title="Gravació">
                <Row label="Desa l'àudio de les reunions" hint="Comprimit en Opus, un canal per font (uns 11 MB per hora). Es guarda en aquest ordinador.">
                  <Switch checked={settings.saveAudio} onCheckedChange={(saveAudio) => onChange({ saveAudio })} />
                </Row>
              </Group>
            </>
          ) : (
            <Group title="Parlants">
              <Row label="Nombre màxim de parlants">
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={settings.maxSpeakers}
                  onChange={(e) => onChange({ maxSpeakers: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
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
                </div>
              </Row>
            </Group>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
      <div className="flex-1">
        <div className="text-[13px]">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
