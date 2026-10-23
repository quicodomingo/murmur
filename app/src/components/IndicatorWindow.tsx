import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Camera, Check, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";

/** How long the stop confirmation waits before going back to normal. */
const CONFIRM_MS = 4000;
/** Clicks this soon after the stop button don't count as confirming (a double click). */
const CONFIRM_GUARD_MS = 350;

/**
 * The recording indicator (its own transparent window, label "indicator", shell.rs): a pill on
 * the right edge of the screen while recording, over the call. The red dot and the level bars
 * bring Murmur back; the big button takes a screenshot of the call; the small square stops,
 * after asking: the camera's place turns into the red "stop" button, the square's into "keep
 * recording". It can be dragged anywhere by its edges.
 */
export function IndicatorWindow() {
  const { t } = useTranslation("indicator");
  const [level, setLevel] = useState(0);
  /** Just took a screenshot: the camera button shows a check for a moment. */
  const [captured, setCaptured] = useState(false);
  /** When the stop button was clicked, while asking to confirm. */
  const [confirming, setConfirming] = useState<number | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const unlisten = [
      listen<{ rms: number }>("level", (e) => setLevel(e.payload.rms)),
      listen("screen-captured", () => {
        setCaptured(true);
        setTimeout(() => setCaptured(false), 900);
      }),
    ];
    return () => unlisten.forEach((u) => void u.then((f) => f()));
  }, []);

  useEffect(() => {
    if (confirming === null) return;
    confirmRef.current?.focus();
    const timer = setTimeout(() => setConfirming(null), CONFIRM_MS);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setConfirming(null);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [confirming]);

  const sound = level > 0.003;
  const open = () => invoke("indicator_open").catch(() => {});
  const stop = () => {
    if (confirming === null || Date.now() - confirming < CONFIRM_GUARD_MS) return;
    setConfirming(null);
    invoke("indicator_stop").catch(() => {});
  };

  return (
    <div className="grid h-screen place-items-center">
      <div
        data-tauri-drag-region
        className="flex w-[52px] flex-col items-center gap-2 rounded-[26px] bg-mm-recording-pill py-1.5 text-mm-on-recording-pill shadow-[0_0_0_1px_var(--mm-recording-pill-border),0_4px_14px_rgb(0_0_0/0.3)]"
      >
        <button type="button" onClick={open} title={t("openTitle")} aria-label={t("open")} className="flex flex-col items-center gap-2.5 rounded-full px-3 py-2.5 hover:bg-white/[0.14]">
          <span className="mm-rec size-3 rounded-full bg-mm-recording-dot" aria-hidden />
          {/* Level bars, half a cycle apart; they only move while there's sound. */}
          <span className="flex h-4 items-center gap-[3px]" aria-hidden>
            {[0, 1].map((i) => (
              <span
                key={i}
                className={`h-4 w-1 rounded-[2px] bg-mm-recording-level ${sound ? `mm-bar${i === 1 ? " mm-bar-2" : ""}` : ""}`}
                style={sound ? undefined : { transform: "scaleY(0.45)" }}
              />
            ))}
          </span>
        </button>

        {confirming === null ? (
          <>
            <button
              type="button"
              onClick={() => invoke("indicator_capture").catch(() => {})}
              title={t("capture")}
              aria-label={t("capture")}
              className="grid size-11 place-items-center rounded-full bg-mm-recording-level text-mm-recording-pill transition-transform duration-150 hover:scale-105 active:scale-95"
            >
              {captured ? <Check className="size-5" strokeWidth={2.5} /> : <Camera className="size-5" strokeWidth={2} />}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(Date.now())}
              title={t("stop")}
              aria-label={t("stop")}
              className="grid size-8 place-items-center rounded-full text-mm-on-recording-pill/70 hover:bg-white/[0.14] hover:text-mm-on-recording-pill"
            >
              <Square className="size-3" fill="currentColor" strokeWidth={0} />
            </button>
          </>
        ) : (
          <>
            <button
              ref={confirmRef}
              type="button"
              onClick={stop}
              title={t("confirmStop")}
              aria-label={t("confirmStop")}
              className="grid size-11 place-items-center rounded-full bg-mm-recording-dot text-mm-on-recording-pill transition-transform duration-150 hover:scale-105 active:scale-95"
            >
              <Square className="size-4" fill="currentColor" strokeWidth={0} />
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              title={t("keepRecording")}
              aria-label={t("keepRecording")}
              className="grid size-8 place-items-center rounded-full bg-white/[0.14] hover:bg-white/25"
            >
              <X className="size-4" strokeWidth={2.25} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
