import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LogoIcon } from "@/components/Logo";
import { cn } from "@/lib/utils";
import type { WhatsNewItem, WhatsNewLink, WhatsNewRelease } from "@/lib/whatsnew";

/**
 * "Novetats de Murmur" (lib/whatsnew.ts): after an update, what the new version brings. The
 * newest version is shown in full; versions skipped in between fold under it. Opened from the
 * settings (`manual`), it has no "don't show again": that switch is right there.
 */
export function WhatsNewDialog({
  releases,
  manual,
  onLink,
  onClose,
}: {
  releases: WhatsNewRelease[];
  manual: boolean;
  onLink: (tab: WhatsNewLink) => void;
  onClose: (dontShowAgain: boolean) => void;
}) {
  const { t } = useTranslation("whatsnew");
  const [dontShow, setDontShow] = useState(false);
  const [latest, ...older] = releases;
  if (!latest) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose(dontShow)}>
      <DialogContent showCloseButton={false} className="gap-0 p-0 sm:max-w-[480px]">
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          <LogoIcon size={44} className="shrink-0" />
          <div className="min-w-0">
            <DialogTitle className="text-[15px] font-semibold">{t("title", { version: latest.version })}</DialogTitle>
            <DialogDescription className="text-[12px] text-muted-foreground">{t("released", { date: latest.date })}</DialogDescription>
          </div>
        </div>

        <div className="max-h-[420px] overflow-y-auto px-5">
          <ReleaseItems items={latest.items} onLink={onLink} />
          {older.map((r) => (
            <details key={r.version} className="group mt-3 rounded-[10px] border border-border">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[12px] text-muted-foreground hover:text-foreground">
                <span>{t("alsoIn", { version: r.version, date: r.date })}</span>
                <span className="transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden>
                  ›
                </span>
              </summary>
              <div className="px-3 pb-1">
                <ReleaseItems items={r.items} onLink={onLink} compact />
              </div>
            </details>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3 border-t border-border px-5 py-3.5">
          {manual ? (
            <span className="flex-1" />
          ) : (
            <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
              <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} className="mt-0.5 size-3.5 accent-primary" />
              <span className="min-w-0">
                <span className="block text-[12px]">{t("dontShow")}</span>
                <span className="block text-[11px] leading-snug text-muted-foreground">{t("dontShowHint")}</span>
              </span>
            </label>
          )}
          <button type="button" onClick={() => onClose(dontShow)} className="h-7 shrink-0 rounded-[7px] bg-mm-accent px-3.5 text-[13px] font-semibold text-mm-on-accent hover:opacity-90">
            {t("ok")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseItems({ items, onLink, compact }: { items: WhatsNewItem[]; onLink: (tab: WhatsNewLink) => void; compact?: boolean }) {
  return (
    <ul className={cn("divide-y divide-border", compact && "pt-1")}>
      {items.map(({ title, text, link, linkLabel }) => (
        <li key={title} className={compact ? "py-2" : "py-3 first:pt-0"}>
          <div className={cn("font-medium", compact ? "text-[12px]" : "text-[13px]")}>{title}</div>
          <p className={cn("mt-0.5 leading-snug text-muted-foreground", compact ? "text-[11px]" : "text-[12px]")}>{text}</p>
          {link && linkLabel && (
            <button type="button" onClick={() => onLink(link)} className="mt-1 text-[12px] text-mm-link hover:underline">
              {linkLabel}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
