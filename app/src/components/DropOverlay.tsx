import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FileAudio, FileX } from "lucide-react";
import { useTranslation } from "react-i18next";

import * as backend from "@/lib/backend";

const isAudio = (path: string) => backend.AUDIO_EXTENSIONS.includes(path.split(".").pop()?.toLowerCase() ?? "");

/**
 * Files dragged over the window: the whole window dims, with a dashed frame and what will happen.
 * Dropped audio goes to `onDrop`; anything else is ignored. `later`: something is being recorded
 * or transcribed, so the file will wait its turn.
 */
export function DropOverlay({ later, onDrop }: { later: boolean; onDrop: (paths: string[]) => void }) {
  const { t } = useTranslation("app");
  const [dragging, setDragging] = useState<"audio" | "other" | null>(null);
  const drop = useRef(onDrop);
  drop.current = onDrop;

  useEffect(() => {
    if (!backend.isTauri()) return;
    const off = getCurrentWebview().onDragDropEvent(({ payload }) => {
      // Text dragged inside the window comes without paths.
      if (payload.type === "enter") setDragging(!payload.paths.length ? null : payload.paths.some(isAudio) ? "audio" : "other");
      else if (payload.type === "leave") setDragging(null);
      else if (payload.type === "drop") {
        setDragging(null);
        const audio = payload.paths.filter(isAudio);
        if (audio.length) drop.current(audio);
      }
    });
    return () => void off.then((f) => f());
  }, []);

  if (!dragging) return null;
  const Icon = dragging === "audio" ? FileAudio : FileX;
  return (
    <div className="pointer-events-none fixed inset-0 z-[1000] bg-mm-background/85 p-3 backdrop-blur-sm duration-150 animate-in fade-in-0 motion-reduce:animate-none">
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-mm-text-tertiary text-center">
        <Icon className="size-10 text-mm-text-secondary" strokeWidth={1.5} />
        <div className="text-[17px] font-semibold text-mm-text-primary">{dragging === "audio" ? t("dropTitle") : t("dropNotAudio")}</div>
        <div className="max-w-md text-[13px] text-mm-text-secondary">{dragging === "audio" && later ? t("dropLater") : t("dropFormats")}</div>
      </div>
    </div>
  );
}
