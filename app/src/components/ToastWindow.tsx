import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CalendarDays, X } from "lucide-react";

import { LogoIcon } from "@/components/Logo";

/** What Rust shows in the floating alert (shell.rs `Toast`). */
type Toast = { kind: "detected" | "calendar"; title: string; subtitle: string; start: number | null; seconds: number; id: number };

/** "Comença d'aquí a 2 minuts", "Comença ara", "Ha començat". */
function startsIn(start: number, now: number): string {
  const minutes = Math.ceil((start - now) / 60_000);
  if (minutes > 1) return `Comença d'aquí a ${minutes} minuts`;
  if (minutes === 1) return "Comença d'aquí a 1 minut";
  return start - now > -60_000 ? "Comença ara" : "Ha començat";
}

/** The calendar alert's lines: when, then "Títol · 17:00 · Google Meet". */
function calendarLines(toast: Toast, now: number): [string, string] {
  const start = toast.start ?? now;
  const time = new Date(start).toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit" });
  return [startsIn(start, now), [toast.title, time, toast.subtitle].filter(Boolean).join(" · ")];
}

/**
 * The floating alert under the menu bar (its own transparent window, label "toast"): one button,
 * always "Comença a gravar", and a countdown bar after which it goes away on its own.
 */
export function ToastWindow() {
  const [toast, setToast] = useState<Toast | null>(null);
  const [left, setLeft] = useState(1);
  const startedAt = useRef(0);

  useEffect(() => {
    invoke<Toast | null>("current_toast").then(setToast).catch(() => {});
    const unlisten = listen<Toast>("toast", (e) => setToast(e.payload));
    return () => void unlisten.then((u) => u());
  }, []);

  // Countdown: restarts with every new alert.
  useEffect(() => {
    if (!toast) return;
    startedAt.current = Date.now();
    setLeft(1);
    const timer = setInterval(() => {
      const share = 1 - (Date.now() - startedAt.current) / (toast.seconds * 1000);
      setLeft(Math.max(0, share));
      if (share <= 0) {
        clearInterval(timer);
        invoke("dismiss_toast").catch(() => {});
      }
    }, 100);
    return () => clearInterval(timer);
  }, [toast?.id]);

  if (!toast) return null;
  // The countdown re-renders every 100 ms, which also keeps "d'aquí a N minuts" current.
  const [title, subtitle] = toast.kind === "calendar" ? calendarLines(toast, Date.now()) : [toast.title, toast.subtitle];
  return (
    <div className="relative ml-6 mt-3.5 w-[470px]" role="alertdialog" aria-labelledby="toast-title" aria-describedby="toast-text">
      <button
        type="button"
        aria-label="Tanca l'avís"
        onClick={() => invoke("dismiss_toast")}
        className="absolute -left-[9px] -top-[9px] z-10 grid size-6 place-items-center rounded-full bg-mm-toast-background text-mm-toast-text shadow-[0_0_0_1px_var(--mm-toast-border),0_2px_6px_rgb(0_0_0/0.2)]"
      >
        <X className="size-2.5" strokeWidth={3} />
      </button>
      <div className="overflow-hidden rounded-2xl bg-mm-toast-background text-mm-toast-text shadow-[0_8px_24px_rgb(0_0_0/0.22),0_0_0_1px_var(--mm-toast-border)]">
        <div className="flex items-center gap-3.5 py-3.5 pl-[18px] pr-3.5">
          {toast.kind === "calendar" ? (
            <CalendarDays className="size-[22px] shrink-0 text-mm-toast-secondary" strokeWidth={1.7} aria-hidden />
          ) : (
            <span className="grid size-[22px] shrink-0 place-items-center" aria-hidden>
              <span className="mm-rec size-2.5 rounded-full bg-mm-recording-dot" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div id="toast-title" className="text-[15px] font-semibold">
              {title}
            </div>
            <div id="toast-text" className="truncate text-[13px] text-mm-toast-secondary">
              {subtitle}
            </div>
          </div>
          <button
            type="button"
            onClick={() => invoke("toast_start")}
            className="flex h-10 shrink-0 items-center gap-2 rounded-[10px] bg-mm-accent pl-2.5 pr-3.5 text-[14px] font-semibold text-mm-on-accent hover:opacity-90"
          >
            <LogoIcon size={20} />
            Comença a gravar
          </button>
        </div>
        <div className="h-[3px] bg-mm-toast-border" aria-hidden>
          <div className="h-full bg-mm-toast-progress transition-[width] duration-100 ease-linear" style={{ width: `${left * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
