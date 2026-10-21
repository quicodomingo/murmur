import { Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";

import { clock } from "@/lib/format";
import { locale } from "@/lib/i18n";
import { nextRate, seek, toggle, usePlayer } from "@/lib/player";
import type { Meeting } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 1,5 in Catalan and Spanish, 1.5 in English. */
const formatRate = (rate: number) => rate.toLocaleString(locale());

/**
 * The meeting's audio, under the cover, transcript or notes: play/pause, time, a scrubber and the
 * speed. Clicking a minute in the transcript or the cover plays from there (lib/player.ts).
 */
export function PlayerBar({ meeting }: { meeting: Meeting }) {
  const { t } = useTranslation("player");
  const player = usePlayer();
  const mine = player.meetingId === meeting.id;
  const duration = mine && player.duration ? player.duration : meeting.duration;
  const time = mine ? player.time : 0;
  const playing = mine && player.playing;
  const loading = mine && player.loading;

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-t border-border bg-background px-4" role="region" aria-label={t("region")}>
      <button
        type="button"
        onClick={() => toggle(meeting)}
        disabled={loading}
        aria-label={playing ? t("pause") : t("listen")}
        className="grid size-8 shrink-0 place-items-center rounded-full bg-mm-new-meeting text-mm-on-new-meeting transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
      >
        {loading ? (
          <span className="size-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current motion-reduce:animate-none" aria-hidden />
        ) : playing ? (
          <Pause className="size-3.5" fill="currentColor" strokeWidth={0} />
        ) : (
          <Play className="ml-0.5 size-3.5" fill="currentColor" strokeWidth={0} />
        )}
      </button>
      {mine ? (
        <>
          <span className="w-12 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{clock(time)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, duration)}
            step={1}
            value={Math.min(time, duration)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label={t("position")}
            aria-valuetext={t("positionValue", { time: clock(time), duration: clock(duration) })}
            className="min-w-0 flex-1 accent-primary"
          />
          <span className="w-12 shrink-0 text-[12px] tabular-nums text-muted-foreground">{clock(duration)}</span>
          <button
            type="button"
            onClick={nextRate}
            aria-label={t("speed", { rate: formatRate(player.rate) })}
            className={cn("h-6 w-11 shrink-0 rounded-md text-[12px] font-medium tabular-nums hover:bg-mm-fill-subtle", player.rate !== 1 && "bg-mm-fill-subtle")}
          >
            {formatRate(player.rate)}×
          </button>
        </>
      ) : (
        <span className="text-[13px] text-muted-foreground">
          {loading ? t("preparing") : t("listen")} <span className="tabular-nums">· {clock(meeting.duration)}</span>
        </span>
      )}
    </div>
  );
}
