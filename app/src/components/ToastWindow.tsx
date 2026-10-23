import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CheckMenuItem, Menu } from "@tauri-apps/api/menu";
import { CalendarDays, ChevronDown, User, Users, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { locale } from "@/lib/i18n";
import { readSettings } from "@/lib/settings";
import type { Language } from "@/lib/types";

import { MEETING_LANGUAGES, type StartChoice } from "./StartOptions";

/** What Rust shows in the floating alert (shell.rs `Toast`). */
type Toast = { kind: "detected" | "calendar"; title: string; subtitle: string; start: number | null; seconds: number; id: number };

/** "Starts in 2 minutes", "Starts now", "Started". */
function startsIn(t: TFunction<"toast">, start: number, now: number): string {
  const minutes = Math.ceil((start - now) / 60_000);
  if (minutes >= 1) return t("startsIn", { count: minutes });
  return start - now > -60_000 ? t("startsNow") : t("started");
}

/** The calendar alert's lines: when, then "Title · 17:00 · Google Meet". */
function calendarLines(t: TFunction<"toast">, toast: Toast, now: number): [string, string] {
  const start = toast.start ?? now;
  const time = new Date(start).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  return [startsIn(t, start, now), [toast.title, time, toast.subtitle].filter(Boolean).join(" · ")];
}

/**
 * The floating alert under the menu bar (its own transparent window, label "toast"): one button,
 * always "Start recording", and a countdown bar after which it goes away on its own.
 */
export function ToastWindow() {
  const { t } = useTranslation("toast");
  const [toast, setToast] = useState<Toast | null>(null);
  const [left, setLeft] = useState(1);
  const startedAt = useRef(0);
  /** Starts from the defaults (shared storage with the main window); a change here becomes the default there. */
  const [choice, setChoice] = useState<StartChoice>(() => {
    const s = readSettings();
    return { language: s.language, roomSpeakers: s.roomSpeakers };
  });
  const [englishReady, setEnglishReady] = useState(false);
  useEffect(() => {
    invoke<{ id: string; installed: boolean }[]>("model_status")
      .then((all) => setEnglishReady(!!all.find((m) => m.id === "english")?.installed))
      .catch(() => {});
  }, []);

  useEffect(() => {
    invoke<Toast | null>("current_toast").then(setToast).catch(() => {});
    const unlisten = listen<Toast>("toast", (e) => setToast(e.payload));
    return () => void unlisten.then((u) => u());
  }, []);

  // Countdown: restarts with every new alert.
  useEffect(() => {
    if (!toast) return;
    const s = readSettings();
    setChoice({ language: s.language, roomSpeakers: s.roomSpeakers });
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
  // The countdown re-renders every 100 ms, which also keeps "in N minutes" current.
  const [title, subtitle] = toast.kind === "calendar" ? calendarLines(t, toast, Date.now()) : [toast.title, toast.subtitle];
  return (
    <div className="relative ml-6 mt-3.5 w-[470px]" role="alertdialog" aria-labelledby="toast-title" aria-describedby="toast-text">
      <button
        type="button"
        aria-label={t("close")}
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
            <ToastChoice value={choice} onChange={(c) => setChoice((v) => ({ ...v, ...c }))} englishReady={englishReady} />
          </div>
          <button
            type="button"
            onClick={() => invoke("toast_start", { choice })}
            className="flex h-10 shrink-0 items-center gap-2 rounded-[10px] bg-mm-accent pl-2.5 pr-3.5 text-[14px] font-semibold text-mm-on-accent hover:opacity-90"
          >
            {/* A record dot: the logo's two bars read as "pause" on a button. */}
            <span className="size-3 rounded-full bg-mm-recording-dot" aria-hidden />
            {t("startRecording")}
          </button>
        </div>
        <div className="h-[3px] bg-mm-toast-border" aria-hidden>
          <div className="h-full bg-mm-toast-progress transition-[width] duration-100 ease-linear" style={{ width: `${left * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

const chip = "-ml-1 inline-flex h-6 items-center gap-1 rounded-md px-1 text-[12px] text-mm-toast-secondary hover:bg-mm-toast-border hover:text-mm-toast-text";

/**
 * The meeting's language and people in the room, under the alert's text. The window is small,
 * so the choices open as native menus, which can go past its edges.
 */
function ToastChoice({ value, onChange, englishReady }: { value: StartChoice; onChange: (c: Partial<StartChoice>) => void; englishReady: boolean }) {
  const { t } = useTranslation("start");
  const { t: ts } = useTranslation("settings");
  const languageName = (l: Language) => ts(`transcription.languages.${MEETING_LANGUAGES.find((m) => m.value === l)?.key ?? "caEs"}`);
  const popup = async (items: Promise<CheckMenuItem>[]) => (await Menu.new({ items: await Promise.all(items) })).popup();
  const languages = () =>
    popup(
      MEETING_LANGUAGES.map((l) =>
        CheckMenuItem.new({
          text: l.value === "en" && !englishReady ? `${languageName(l.value)} (${t("englishMissingShort")})` : languageName(l.value),
          checked: l.value === value.language,
          enabled: l.value !== "en" || englishReady,
          action: () => onChange({ language: l.value }),
        }),
      ),
    );
  const room = () =>
    popup(
      ([false, true] as const).map((on) =>
        CheckMenuItem.new({ text: t(on ? "roomTitle" : "aloneTitle"), checked: value.roomSpeakers === on, action: () => onChange({ roomSpeakers: on }) }),
      ),
    );
  const Icon = value.roomSpeakers ? Users : User;
  return (
    <div className="mt-0.5 flex items-center gap-1">
      <button type="button" className={chip} onClick={() => void languages()} aria-label={t("languageLabel", { language: languageName(value.language) })}>
        {languageName(value.language)}
        <ChevronDown className="size-3 opacity-60" aria-hidden />
      </button>
      <span className="text-[12px] text-mm-toast-secondary" aria-hidden>
        ·
      </span>
      <button type="button" className={chip} onClick={() => void room()} aria-label={t("roomLabel", { value: value.roomSpeakers ? t("room") : t("alone") })}>
        <Icon className="size-3" aria-hidden />
        {value.roomSpeakers ? t("room") : t("alone")}
        <ChevronDown className="size-3 opacity-60" aria-hidden />
      </button>
    </div>
  );
}
