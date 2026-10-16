import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Plus } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const HUES = 6;
/** System-channel speakers start on the second hue so "Tu" (mic 0) and "Parlant 1" differ. */
export const speakerColor = (speaker: number) => {
  const i = speaker >= 100 ? speaker - 100 + 1 : speaker;
  return `var(--spk-${(i % HUES) + 1})`;
};

/** Small colored name tag, like the collaborator flags in a shared document. */
export function Flag({ speaker, name, className }: { speaker: number; name: string; className?: string }) {
  return (
    <span
      className={cn("inline-flex h-[18px] items-center rounded-[4px] px-1.5 text-[11px] font-semibold text-white", className)}
      style={{ background: speakerColor(speaker) }}
    >
      {name}
    </span>
  );
}

type Props = {
  speaker: number;
  speakers: { id: number; name: string }[];
  onReassign: (speaker: number) => void;
  onRename: (speaker: number, name: string) => void;
};

/** Speaker flag that opens a native-style menu to reassign the utterance or rename the speaker. */
export function SpeakerFlag({ speaker, speakers, onReassign, onRename }: Props) {
  const name = speakers.find((s) => s.id === speaker)?.name ?? `Parlant ${speaker + 1}`;
  const [renaming, setRenaming] = useState<number | null>(null);

  if (renaming !== null) {
    const current = speakers.find((s) => s.id === renaming)?.name ?? `Parlant ${renaming + 1}`;
    return (
      <RenameInput
        speaker={renaming}
        initial={current}
        onDone={(value) => {
          if (value && value !== current) onRename(renaming, value);
          setRenaming(null);
        }}
      />
    );
  }

  const nextId = Math.max(-1, ...speakers.map((s) => s.id)) + 1;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rounded-[4px] focus-visible:outline-2 focus-visible:outline-ring" aria-label={`${name}: canvia el parlant`}>
          <Flag speaker={speaker} name={name} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {speakers.map((s) => (
          <DropdownMenuItem key={s.id} onSelect={() => s.id !== speaker && onReassign(s.id)}>
            <span className="size-2 rounded-full" style={{ background: speakerColor(s.id) }} />
            <span className="flex-1">{s.name}</span>
            {s.id === speaker && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setRenaming(speaker)}>
          <Pencil className="size-3.5" />
          Reanomena «{name}»…
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            onReassign(nextId);
            setRenaming(nextId);
          }}
        >
          <Plus className="size-3.5" />
          Nou parlant…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RenameInput({ speaker, initial, onDone }: { speaker: number; initial: string; onDone: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  useEffect(() => {
    // Wait for the menu to finish closing before taking focus.
    const t = setTimeout(() => ref.current?.select(), 30);
    return () => clearTimeout(t);
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      aria-label="Nom del parlant"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(value.trim());
        if (e.key === "Escape") onDone("");
      }}
      className="h-[18px] w-36 rounded-[4px] px-1.5 text-[11px] font-semibold text-white outline-none ring-2 ring-ring"
      style={{ background: speakerColor(speaker) }}
    />
  );
}
