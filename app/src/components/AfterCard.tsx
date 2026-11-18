import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { AfterStep } from "@/lib/postprocess";
import type { PostStage } from "@/lib/types";
import { cn } from "@/lib/utils";

/** With nothing touched, it starts by itself after this long. */
export const AFTER_COUNTDOWN_MS = 10_000;

const ORDER: PostStage[] = ["speakers", "text", "punctuation", "cover"];

/**
 * "Què en faig ara?" (docs/mockups/passades.html): when a meeting ends, the four steps it can go
 * through, ticked as the user left them last time (recordings and files apart), each with what
 * it's for and how long it'll take here. With nothing touched it starts after 10 s (the window
 * keeps the time, so it starts even if another meeting is open); touching it stops the countdown.
 * Opened again later ("Acaba de processar…"), the steps done show as done and there's no
 * countdown. The whole row is the checkbox's label.
 */
export function AfterCard({
  steps,
  chosen,
  deadline,
  later,
  done,
  noAudio,
  engineName,
  file,
  onToggle,
  onStart,
  onSkip,
}: {
  steps: AfterStep[];
  /** Ticked now. */
  chosen: Set<PostStage>;
  /** When it starts by itself (epoch ms); null = it waits for the user. */
  deadline: number | null;
  /** Opened from the menu, for what was left: no countdown. */
  later?: boolean;
  /** Steps already done (later). */
  done?: Set<PostStage>;
  /** The audio isn't saved: the speaker check and Whisper can only be done now. */
  noAudio?: boolean;
  /** Who writes the cover: "Gemma, en aquest ordinador" or the cloud model. */
  engineName: string;
  file?: boolean;
  /** Ticking or unticking one also stops the countdown. */
  onToggle: (stage: PostStage) => void;
  onStart: () => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation("app");
  const counting = deadline != null;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [counting]);
  const left = counting ? Math.max(0, deadline - now) : 0;

  const minutes = (seconds: number) => (seconds < 60 ? t("after.seconds", { count: Math.max(5, Math.round(seconds / 5) * 5) }) : t("after.minutes", { count: Math.round(seconds / 60) }));
  const why = (s: AfterStep) => {
    if (!s.possible) return t(`after.why.${s.stage}.${s.reason ?? "model"}`);
    return s.stage === "cover" ? t("after.what.cover", { engine: engineName }) : t(`after.what.${s.stage}`);
  };

  return (
    <section
      aria-labelledby="after-title"
      className="overflow-hidden rounded-xl bg-background shadow-[0_0_0_1px_var(--mm-separator),0_16px_40px_-12px_rgb(0_0_0/0.3)]"
    >
      <h2 id="after-title" className="px-4 pt-3.5 pb-1.5 text-[14px] font-semibold">
        {later ? t("after.laterTitle") : t("after.title")}
      </h2>
      <div className="px-2 pb-1.5">
        {ORDER.map((stage) => {
          const s = steps.find((x) => x.stage === stage);
          if (!s) return null;
          const isDone = !!done?.has(stage);
          const off = !s.possible || isDone;
          const on = chosen.has(stage) && !off;
          return (
            <label
              key={stage}
              className={cn(
                "flex select-none items-start gap-2.5 rounded-lg px-2 py-[7px]",
                off ? "opacity-50" : "cursor-default hover:bg-mm-fill-subtle",
              )}
            >
              {isDone ? (
                <span className="mt-px grid size-4 shrink-0 place-items-center text-muted-foreground" aria-hidden>
                  <Check className="size-3.5" strokeWidth={2.6} />
                </span>
              ) : (
                <>
                  <input type="checkbox" className="peer sr-only" checked={on} disabled={off} onChange={() => onToggle(stage)} />
                  <span
                    aria-hidden
                    className={cn(
                      "mt-px grid size-4 shrink-0 place-items-center rounded-[4px] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
                      on ? "bg-foreground text-background" : "shadow-[inset_0_0_0_1.5px_var(--mm-separator)]",
                    )}
                  >
                    {on && <Check className="size-[11px]" strokeWidth={3.2} />}
                  </span>
                </>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{t(`after.name.${stage}`)}</span>
                <span className="block text-[12px] leading-snug text-muted-foreground">{why(s)}</span>
              </span>
              <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                {isDone ? t("after.done") : s.possible ? minutes(s.seconds) : ""}
              </span>
            </label>
          );
        })}
      </div>
      {noAudio && !later && (
        <p className="mx-4 mb-2 rounded-[7px] bg-mm-fill-subtle px-2.5 py-1.5 text-[12px] leading-snug text-muted-foreground">{t("after.noAudio")}</p>
      )}
      <div className="flex items-center gap-2.5 border-t border-border px-4 py-2.5">
        <span className="flex-1 text-[12px] leading-snug text-muted-foreground" aria-live="polite">
          {later ? "" : counting ? t("after.countdown", { count: Math.ceil(left / 1000) }) : t(file ? "after.rememberFile" : "after.rememberRecording")}
        </span>
        <button type="button" onClick={onSkip} className="h-7 rounded-[7px] px-2.5 text-[13px] text-muted-foreground hover:bg-mm-fill-subtle hover:text-foreground">
          {later ? t("common:cancel") : t("after.skip")}
        </button>
        <button
          type="button"
          onClick={onStart}
          disabled={later && !chosen.size}
          className="h-7 rounded-[7px] bg-mm-accent px-3 text-[13px] font-semibold text-mm-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {later ? t("after.doIt") : t("after.startNow")}
        </button>
      </div>
      {counting && (
        <div className="h-[3px] bg-mm-separator" aria-hidden>
          <div className="h-full bg-mm-text-tertiary transition-[width] duration-100 ease-linear" style={{ width: `${(left / AFTER_COUNTDOWN_MS) * 100}%` }} />
        </div>
      )}
    </section>
  );
}
