import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { clock } from "@/lib/format";
import type { Screen } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The file of a screenshot as the page can show it (Tauri's asset protocol). */
export const screenSrc = (s: Screen) => ("__TAURI_INTERNALS__" in window ? convertFileSrc(s.path) : s.path);

/**
 * Screenshots of the call as thumbnails: click to see one large, × to remove it. `onJump` makes
 * the minute a link (on the cover, to the transcript).
 */
export function ScreenThumbs({
  screens,
  onRemove,
  onJump,
  className,
}: {
  screens: Screen[];
  onRemove?: (s: Screen) => void;
  onJump?: (t: number) => void;
  className?: string;
}) {
  const { t } = useTranslation("screens");
  const [open, setOpen] = useState<Screen | null>(null);
  if (!screens.length) return null;
  return (
    <>
      <div className={cn("flex flex-wrap gap-2.5", className)}>
        {screens.map((s) => (
          <figure key={s.path} className="group relative">
            <button
              type="button"
              onClick={() => setOpen(s)}
              aria-label={t("enlarge", { time: clock(s.t) })}
              className="block overflow-hidden rounded-md border border-border focus-visible:outline-2 focus-visible:outline-ring"
            >
              <img src={screenSrc(s)} alt="" loading="lazy" className="h-24 w-auto max-w-[220px] object-cover" />
            </button>
            <figcaption className="mt-1 text-[11px] tabular-nums text-text-secondary">
              {onJump ? (
                <button type="button" onClick={() => onJump(s.t)} className="text-mm-timestamp hover:underline">
                  {clock(s.t)}
                </button>
              ) : (
                clock(s.t)
              )}
            </figcaption>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(s)}
                aria-label={t("remove", { time: clock(s.t) })}
                className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-mm-recording-pill text-mm-on-recording-pill opacity-0 focus-visible:opacity-100 group-hover:opacity-100 print:hidden"
              >
                <X className="size-3" />
              </button>
            )}
          </figure>
        ))}
      </div>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-[min(92vw,1200px)] p-2 sm:max-w-[min(92vw,1200px)]">
          <DialogTitle className="sr-only">{open && t("title", { time: clock(open.t) })}</DialogTitle>
          <DialogDescription className="sr-only">{t("description")}</DialogDescription>
          {open && <img src={screenSrc(open)} alt={t("alt", { time: clock(open.t) })} className="max-h-[82vh] w-full rounded-md object-contain" />}
        </DialogContent>
      </Dialog>
    </>
  );
}
