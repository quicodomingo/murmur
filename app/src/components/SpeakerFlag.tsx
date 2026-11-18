import { useEffect, useRef, useState } from "react";
import { Check, Merge, Pencil, Plus, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { locale } from "@/lib/i18n";
import { SYSTEM_SPEAKER_BASE, type Meeting } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The theme's speaker colours (DESIGN.md › Parlants): four, repeated in order. */
const HUES = 4;

/** In a call, the microphone's first voice is the user ("Tu"), always in the theme's `you` colour. */
export const isYou = (m: Pick<Meeting, "sources">, speaker: number) => !!(m.sources?.mic && m.sources.system) && speaker === 0;

/** Less of the talk than this, and a speaker is more a stray fragment of voice than a person: grey. */
export const MINOR_SHARE = 0.02;

/**
 * A meeting's speakers in colour order, without "Tu". While recording, as they come: the room's
 * voices and then the call's, so a colour never changes under someone talking. Once it's over,
 * who talked most first, so the four colours go to the four main voices; the ones with less than
 * MINOR_SHARE of the talk are left out, and go grey (speakerTone).
 */
export function toneOrder(m: Pick<Meeting, "sources" | "status" | "utterances">, ids: number[]): number[] {
  const others = ids.filter((id) => !isYou(m, id));
  if (m.status === "recording") return others;
  const seconds = new Map<number, number>();
  for (const u of m.utterances) seconds.set(u.speaker, (seconds.get(u.speaker) ?? 0) + Math.max(0, u.end - u.start));
  const all = [...seconds.values()].reduce((a, b) => a + b, 0);
  if (!all) return others;
  const of = (id: number) => seconds.get(id) ?? 0;
  return others.filter((id) => of(id) / all >= MINOR_SHARE).sort((a, b) => of(b) - of(a) || a - b);
}

/** Which of the theme's speaker colours (1 to 4) a speaker gets, by its place in `order`. */
export function speakerHue(speaker: number, order?: number[]): number {
  const slot = order?.indexOf(speaker) ?? -1;
  return ((slot >= 0 ? slot : speaker >= SYSTEM_SPEAKER_BASE ? speaker - SYSTEM_SPEAKER_BASE : speaker) % HUES) + 1;
}

/** Solid colour (charts), tint (tag background) and text colour of a speaker, by its place in
 * `order`; grey if `order` (from toneOrder) leaves it out. */
export function speakerTone(speaker: number, you = false, order?: number[]) {
  if (you) return { solid: "var(--mm-you)", tint: "var(--mm-you)", text: "var(--mm-on-you)" };
  if (order && !order.includes(speaker)) return { solid: "var(--mm-text-tertiary)", tint: "var(--mm-fill-subtle)", text: "var(--mm-text-secondary)" };
  const n = speakerHue(speaker, order);
  return { solid: `var(--mm-speaker-${n})`, tint: `var(--mm-speaker-${n}-tint)`, text: `var(--mm-speaker-${n}-text)` };
}

/** Small tinted name tag, like the collaborator flags in a shared document. */
export function Flag({ speaker, name, you, order, className }: { speaker: number; name: string; you?: boolean; order?: number[]; className?: string }) {
  const tone = speakerTone(speaker, you, order);
  return (
    <span
      className={cn("inline-flex h-5 items-center rounded-[5px] px-1.5 text-[12px] font-semibold", className)}
      style={{ background: tone.tint, color: tone.text }}
    >
      {name}
    </span>
  );
}

type Props = {
  speaker: number;
  speakers: { id: number; name: string; you?: boolean }[];
  /** The meeting's speakersVersion: sent with every action so a stale menu is translated. */
  version: number;
  onReassign: (speaker: number, version: number) => void;
  onRename: (speaker: number, name: string, version: number) => void;
  /** Every line of this speaker belongs to `to`. */
  onMerge: (to: number, version: number) => void;
  /** Guests of the calendar event: picking one names this speaker after them. */
  guests?: string[] | null;
  /** The meeting's colour order (toneOrder). */
  order: number[];
};

/**
 * Speaker flag that opens a native-style menu to reassign the utterance, move all of this
 * speaker's lines to another one, or rename the speaker.
 */
export function SpeakerFlag({ speaker, speakers, version, onReassign, onRename, onMerge, guests: invited, order }: Props) {
  // Meetings saved before calendars had no guests (null from the database).
  const { t } = useTranslation("speakers");
  const guests = invited ?? [];
  const name = speakers.find((s) => s.id === speaker)?.name ?? t("defaultName", { n: speaker + 1 });
  // The numbering version is captured when renaming starts: the final pass may renumber meanwhile.
  const [renaming, setRenaming] = useState<{ id: number; version: number } | null>(null);

  if (renaming !== null) {
    const current = speakers.find((s) => s.id === renaming.id)?.name ?? t("defaultName", { n: renaming.id + 1 });
    return (
      <RenameInput
        speaker={renaming.id}
        you={speakers.find((s) => s.id === renaming.id)?.you}
        order={order}
        initial={current}
        suggestions={guests}
        onDone={(value) => {
          if (value && value !== current) onRename(renaming.id, value, renaming.version);
          setRenaming(null);
        }}
      />
    );
  }

  const nextId = Math.max(-1, ...speakers.map((s) => s.id)) + 1;
  // Guests who aren't a speaker's name yet.
  const taken = new Set(speakers.map((s) => s.name.toLocaleLowerCase(locale())));
  const unnamed = guests.filter((g) => !taken.has(g.toLocaleLowerCase(locale())));
  const others = speakers.filter((s) => s.id !== speaker);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rounded-[4px] focus-visible:outline-2 focus-visible:outline-ring" aria-label={t("changeSpeaker", { name })}>
          <Flag speaker={speaker} name={name} you={speakers.find((s) => s.id === speaker)?.you} order={order} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-64">
        {speakers.map((s) => (
          <DropdownMenuItem key={s.id} onSelect={() => s.id !== speaker && onReassign(s.id, version)}>
            <span className="size-2 rounded-full" style={{ background: speakerTone(s.id, s.you, order).solid }} />
            <span className="flex-1">{s.name}</span>
            {s.id === speaker && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
        {unnamed.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">{t("guestsLabel", { name })}</DropdownMenuLabel>
            {unnamed.map((g) => (
              <DropdownMenuItem key={g} onSelect={() => onRename(speaker, g, version)}>
                <UserRound className="size-3.5" />
                {g}
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        {others.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Merge className="size-3.5" />
              {t("mergeInto", { name })}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-44">
              {others.map((s) => (
                <DropdownMenuItem key={s.id} onSelect={() => onMerge(s.id, version)}>
                  <span className="size-2 rounded-full" style={{ background: speakerTone(s.id, s.you, order).solid }} />
                  {s.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuItem onSelect={() => setRenaming({ id: speaker, version })}>
          <Pencil className="size-3.5" />
          {t("rename", { name })}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            onReassign(nextId, version);
            setRenaming({ id: nextId, version });
          }}
        >
          <Plus className="size-3.5" />
          {t("newSpeaker")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RenameInput({
  speaker,
  you,
  order,
  initial,
  suggestions,
  onDone,
}: {
  speaker: number;
  you?: boolean;
  order: number[];
  initial: string;
  suggestions: string[];
  onDone: (v: string) => void;
}) {
  const { t } = useTranslation("speakers");
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  useEffect(() => {
    // Wait for the menu to finish closing before taking focus.
    const timer = setTimeout(() => ref.current?.select(), 30);
    return () => clearTimeout(timer);
  }, []);
  const listId = `guests-${speaker}`;
  return (
    <>
      <input
        ref={ref}
        list={suggestions.length ? listId : undefined}
        value={value}
        aria-label={t("nameLabel")}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onDone(value.trim())}
        onKeyDown={(e) => {
          if (e.key === "Enter") onDone(value.trim());
          if (e.key === "Escape") onDone("");
        }}
        className="h-5 w-36 rounded-[5px] px-1.5 text-[12px] font-semibold outline-none ring-2 ring-ring"
        style={{ background: speakerTone(speaker, you, order).tint, color: speakerTone(speaker, you, order).text }}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      )}
    </>
  );
}
