import { useEffect, useRef, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { Check, X } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LogoIcon } from "@/components/Logo";
import * as backend from "@/lib/backend";
import { bytes, updateModel, useModels } from "@/lib/models";
import type { ModelId } from "@/lib/types";
import { cn } from "@/lib/utils";

const MODEL_LABELS: Record<ModelId, string> = {
  transcription: "Model de transcripció",
  punctuation: "Model de puntuació",
  llm: "Model de llenguatge",
  english: "Model d'anglès",
  whisper: "Whisper",
};

type Item = {
  key: string;
  label: string;
  detail: string;
  state: "waiting" | "active" | "done" | "error";
  error?: string;
};

type Phase = "checking" | "uptodate" | "updating" | "restarting" | "done" | "failed";

/**
 * "Actualitzant Murmur": when Murmur opens (or from Configuració › General), it looks for a new
 * version of the app and of the installed models and installs everything pending in one go:
 * models first (the longest), then the app, which restarts. Opened by hand, it also says when
 * everything is up to date; on its own it only shows up when there's something to install.
 */
export function UpdatesDialog({ run, manual, onClose }: { run: number; manual: boolean; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("checking");
  const [items, setItems] = useState<Item[]>([]);
  const [appProgress, setAppProgress] = useState<number | null>(null);
  const models = useModels();
  const cancelled = useRef(false);

  const patch = (key: string, change: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...change } : i)));

  useEffect(() => {
    if (!run || !backend.isTauri()) return;
    cancelled.current = false;
    setPhase("checking");
    setItems([]);
    setAppProgress(null);
    if (manual) setOpen(true);
    (async () => {
      const [app, modelList] = await Promise.all([
        check().catch((e) => {
          console.warn(e);
          return null;
        }),
        backend.modelUpdates().catch(() => []),
      ]);
      const pending: Item[] = [
        ...modelList.map((m) => ({
          key: m.id,
          label: MODEL_LABELS[m.id],
          detail: [m.notes, bytes(m.bytes)].filter(Boolean).join(" · "),
          state: "waiting" as const,
        })),
        ...(app ? [{ key: "app", label: `Murmur ${app.version}`, detail: app.body?.split("\n")[0] ?? "Versió nova de l'app", state: "waiting" as const }] : []),
      ];
      if (!pending.length) {
        setPhase("uptodate");
        return;
      }
      setItems(pending);
      setOpen(true);
      setPhase("updating");
      let failed = false;
      for (const m of modelList) {
        if (cancelled.current) return;
        patch(m.id, { state: "active" });
        const ok = await updateModel(m.id);
        patch(m.id, ok ? { state: "done" } : { state: "error", error: "No s'ha pogut actualitzar" });
        failed ||= !ok;
      }
      if (app && !cancelled.current) {
        const ok = await installApp(app);
        if (ok) {
          setPhase("restarting");
          await relaunch();
          return;
        }
        failed = true;
      }
      setPhase(failed ? "failed" : "done");
    })();

    async function installApp(app: Update): Promise<boolean> {
      patch("app", { state: "active" });
      let total = 0;
      let got = 0;
      try {
        await app.downloadAndInstall((e) => {
          if (e.event === "Started") total = e.data.contentLength ?? 0;
          if (e.event === "Progress") {
            got += e.data.chunkLength;
            if (total) setAppProgress(got / total);
          }
        });
        patch("app", { state: "done" });
        return true;
      } catch (e) {
        patch("app", { state: "error", error: String(e) });
        return false;
      }
    }
    // A new check every time `run` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const close = () => {
    if (phase === "updating") {
      cancelled.current = true;
      for (const i of items) if (i.state === "active" && i.key !== "app") backend.cancelModelDownload(i.key as ModelId).catch(() => {});
    }
    setOpen(false);
    onClose();
  };

  const progressOf = (item: Item) => {
    if (item.key === "app") return appProgress;
    const d = models.downloading[item.key as ModelId];
    return d && d.total ? d.done / d.total : null;
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && phase !== "restarting" && close()}>
      <DialogContent className="sm:max-w-[440px]" showCloseButton={false}>
        <div className="flex items-center gap-3">
          <LogoIcon size={36} />
          <div>
            <DialogTitle className="text-[15px] font-semibold">
              {phase === "checking"
                ? "Buscant actualitzacions…"
                : phase === "uptodate"
                  ? "Murmur està al dia"
                  : phase === "restarting"
                    ? "Reiniciant Murmur…"
                    : phase === "done"
                      ? "Tot actualitzat"
                      : phase === "failed"
                        ? "No s'ha pogut actualitzar tot"
                        : "Actualitzant Murmur"}
            </DialogTitle>
            <DialogDescription className="text-[12px] text-muted-foreground">
              {phase === "uptodate"
                ? `Tens la darrera versió de l'app i dels models.`
                : phase === "updating"
                  ? "Pots continuar treballant. Si s'actualitza l'app, es reiniciarà sola en acabar."
                  : phase === "failed"
                    ? "El que no s'ha actualitzat es tornarà a provar la propera vegada que obris Murmur."
                    : " "}
            </DialogDescription>
          </div>
        </div>

        {items.length > 0 && (
          <ul className="mt-1 divide-y divide-border rounded-[10px] border border-border">
            {items.map((item) => {
              const progress = progressOf(item);
              return (
                <li key={item.key} className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    {item.state === "done" ? (
                      <span className="grid size-4 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground" aria-label="Fet">
                        <Check className="size-2.5" strokeWidth={3} />
                      </span>
                    ) : item.state === "error" ? (
                      <span className="grid size-4 shrink-0 place-items-center rounded-full bg-destructive text-white" aria-label="Error">
                        <X className="size-2.5" strokeWidth={3} />
                      </span>
                    ) : item.state === "active" ? (
                      <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary motion-reduce:animate-none" aria-hidden />
                    ) : (
                      <span className="size-4 shrink-0 rounded-full border-[1.5px] border-dashed border-mm-text-tertiary" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium">{item.label}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{item.state === "error" ? item.error : item.detail}</div>
                    </div>
                    {item.state === "active" && progress !== null && (
                      <span className="text-[11px] tabular-nums text-muted-foreground">{Math.floor(progress * 100)} %</span>
                    )}
                  </div>
                  {item.state === "active" && (
                    <div className="ml-[26px] mt-1.5 h-[3px] overflow-hidden rounded-full bg-mm-meter-off">
                      <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${(progress ?? 0) * 100}%` }} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-1 flex justify-end">
          {phase !== "restarting" && (
            <button
              type="button"
              onClick={close}
              className={cn(
                "h-7 rounded-[7px] px-3 text-[13px]",
                phase === "updating" ? "text-muted-foreground hover:bg-mm-fill-subtle" : "bg-mm-accent font-semibold text-mm-on-accent hover:opacity-90",
              )}
            >
              {phase === "updating" ? "Fes-ho més tard" : phase === "checking" ? "Cancel·la" : "D'acord"}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
