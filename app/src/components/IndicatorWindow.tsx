import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * The recording indicator (its own transparent window, label "indicator", shell.rs): a pill on
 * the right edge of the screen while recording, over the call. The red dot and the level bars
 * bring Murmur back; the square stops. It can be dragged anywhere by its edges.
 */
export function IndicatorWindow() {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const unlisten = listen<{ rms: number }>("level", (e) => setLevel(e.payload.rms));
    return () => void unlisten.then((u) => u());
  }, []);
  const sound = level > 0.003;
  const open = () => invoke("indicator_open").catch(() => {});

  return (
    <div className="grid h-screen place-items-center">
      <div
        data-tauri-drag-region
        className="flex w-10 flex-col items-center gap-1.5 rounded-[20px] bg-mm-recording-pill py-1.5 text-mm-on-recording-pill shadow-[0_0_0_1px_var(--mm-recording-pill-border),0_4px_14px_rgb(0_0_0/0.3)]"
      >
        <button type="button" onClick={open} title="Murmur està gravant. Obre Murmur" aria-label="Obre Murmur" className="flex flex-col items-center gap-2.5 rounded-full px-2 py-2 hover:bg-white/[0.14]">
          <span className="mm-rec size-2.5 rounded-full bg-mm-recording-dot" aria-hidden />
          {/* Level bars, half a cycle apart; they only move while there's sound. */}
          <span className="flex h-3.5 items-center gap-[3px]" aria-hidden>
            {[0, 1].map((i) => (
              <span
                key={i}
                className={`h-3.5 w-1 rounded-[2px] bg-mm-recording-level ${sound ? `mm-bar${i === 1 ? " mm-bar-2" : ""}` : ""}`}
                style={sound ? undefined : { transform: "scaleY(0.45)" }}
              />
            ))}
          </span>
        </button>
        <button
          type="button"
          onClick={() => invoke("indicator_stop").catch(() => {})}
          title="Atura la gravació"
          aria-label="Atura la gravació"
          className="grid size-7 place-items-center rounded-full bg-white/[0.14] hover:bg-white/25"
        >
          <span className="size-2 rounded-[2px] bg-current" />
        </button>
      </div>
    </div>
  );
}
