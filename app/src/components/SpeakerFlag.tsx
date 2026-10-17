import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Plus, UserRound } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SYSTEM_SPEAKER_BASE, type Meeting } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The theme's speaker colours (DESIGN.md › Parlants): four, repeated in order. */
const HUES = 4;

/** In a call, the microphone's first voice is the user ("Tu"), always in the theme's `you` colour. */
export const isYou = (m: Pick<Meeting, "sources">, speaker: number) => !!(m.sources?.mic && m.sources.system) && speaker === 0;

/** Solid colour (charts), tint (tag background) and text colour of a speaker. */
export function speakerTone(speaker: number, you = false) {
  if (you) return { solid: "var(--mm-you)", tint: "var(--mm-you)", text: "var(--mm-on-you)" };
  const n = ((speaker >= SYSTEM_SPEAKER_BASE ? speaker - SYSTEM_SPEAKER_BASE : speaker) % HUES) + 1;
  return { solid: `var(--mm-speaker-${n})`, tint: `var(--mm-speaker-${n}-tint)`, text: `var(--mm-speaker-${n}-text)` };
}

/** Small tinted name tag, like the collaborator flags in a shared document. */
export function Flag({ speaker, name, you, className }: { speaker: number; name: string; you?: boolean; className?: string }) {
  const tone = speakerTone(speaker, you);
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
  /** Guests of the calendar event: picking one names this speaker after them. */
  guests?: string[];
};

/** Speaker flag that opens a native-style menu to reassign the utterance or rename the speaker. */
export function SpeakerFlag({ speaker, speakers, version, onReassign, onRename, guests = [] }: Props) {
  const name = speakers.find((s) => s.id === speaker)?.name ?? `Parlant ${speaker + 1}`;
  // The numbering version is captured when renaming starts: the final pass may renumber meanwhile.
  const [renaming, setRenaming] = useState<{ id: number; version: number } | null>(null);

  if (renaming !== null) {
    const current = speakers.find((s) => s.id === renaming.id)?.name ?? `Parlant ${renaming.id + 1}`;
    return (
      <RenameInput
        speaker={renaming.id}
        you={speakers.find((s) => s.id === renaming.id)?.you}
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
  const taken = new Set(speakers.map((s) => s.name.toLocaleLowerCase("ca")));
  const unnamed = guests.filter((g) => !taken.has(g.toLocaleLowerCase("ca")));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rounded-[4px] focus-visible:outline-2 focus-visible:outline-ring" aria-label={`${name}: canvia el parlant`}>
          <Flag speaker={speaker} name={name} you={speakers.find((s) => s.id === speaker)?.you} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {speakers.map((s) => (
          <DropdownMenuItem key={s.id} onSelect={() => s.id !== speaker && onReassign(s.id, version)}>
            <span className="size-2 rounded-full" style={{ background: speakerTone(s.id, s.you).solid }} />
            <span className="flex-1">{s.name}</span>
            {s.id === speaker && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
        {unnamed.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Convidats: «{name}» és…</DropdownMenuLabel>
            {unnamed.map((g) => (
              <DropdownMenuItem key={g} onSelect={() => onRename(speaker, g, version)}>
                <UserRound className="size-3.5" />
                {g}
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setRenaming({ id: speaker, version })}>
          <Pencil className="size-3.5" />
          Reanomena «{name}»…
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            onReassign(nextId, version);
            setRenaming({ id: nextId, version });
          }}
        >
          <Plus className="size-3.5" />
          Nou parlant…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RenameInput({
  speaker,
  you,
  initial,
  suggestions,
  onDone,
}: {
  speaker: number;
  you?: boolean;
  initial: string;
  suggestions: string[];
  onDone: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  useEffect(() => {
    // Wait for the menu to finish closing before taking focus.
    const t = setTimeout(() => ref.current?.select(), 30);
    return () => clearTimeout(t);
  }, []);
  const listId = `guests-${speaker}`;
  return (
    <>
      <input
        ref={ref}
        list={suggestions.length ? listId : undefined}
        value={value}
        aria-label="Nom del parlant"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onDone(value.trim())}
        onKeyDown={(e) => {
          if (e.key === "Enter") onDone(value.trim());
          if (e.key === "Escape") onDone("");
        }}
        className="h-5 w-36 rounded-[5px] px-1.5 text-[12px] font-semibold outline-none ring-2 ring-ring"
        style={{ background: speakerTone(speaker, you).tint, color: speakerTone(speaker, you).text }}
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
