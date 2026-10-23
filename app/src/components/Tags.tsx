import { useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { MeetingSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export type TagCount = { name: string; count: number };

/** Every tag with how many meetings have it, the most used first. */
export function tagCounts(meetings: MeetingSummary[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const m of meetings) for (const t of m.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export const hasTag = (m: MeetingSummary, tag: string) => (m.tags ?? []).some((t) => t.toLocaleLowerCase() === tag.toLocaleLowerCase());

/** Lowercase and without accents, so "fundacio" finds "Fundació". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();

const chip = "inline-flex h-[22px] items-center gap-1 rounded-[5px] px-[7px] text-[12px]";

/**
 * A meeting's tags, under its date: a click on one shows the meetings that have it, the cross
 * removes it, and "+ Tag" finds or creates one.
 */
export function MeetingTags({
  tags,
  all,
  onChange,
  onOpen,
  className,
}: {
  tags: string[];
  /** Every tag in use, to offer them. */
  all: TagCount[];
  onChange: (tags: string[]) => void;
  onOpen: (tag: string) => void;
  className?: string;
}) {
  const { t } = useTranslation("tags");
  return (
    <ul className={cn("flex flex-wrap items-center gap-1.5", className)} aria-label={t("meetingTags")}>
      {tags.map((tag) => (
        <li key={tag} className={cn(chip, "bg-mm-fill-subtle pr-[3px] font-medium")}>
          <button type="button" onClick={() => onOpen(tag)} title={t("open", { tag })} className="rounded-[3px] focus-visible:outline-2 focus-visible:outline-ring">
            {tag}
          </button>
          <button
            type="button"
            onClick={() => onChange(tags.filter((x) => x !== tag))}
            aria-label={t("remove", { tag })}
            className="grid size-4 place-items-center rounded-[3px] text-mm-text-tertiary hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10"
          >
            <X className="size-3" />
          </button>
        </li>
      ))}
      <li>
        <AddTag tags={tags} all={all} onAdd={(tag) => onChange([...tags, tag])} />
      </li>
    </ul>
  );
}

function AddTag({ tags, all, onAdd }: { tags: string[]; all: TagCount[]; onAdd: (tag: string) => void }) {
  const { t } = useTranslation("tags");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const q = query.trim();
  const options = useMemo(() => {
    const mine = new Set(tags.map(fold));
    const found = all.filter((x) => !mine.has(fold(x.name)) && fold(x.name).includes(fold(q)));
    const exists = all.some((x) => fold(x.name) === fold(q)) || mine.has(fold(q));
    return [...found.map((x) => ({ name: x.name, count: x.count as number | null })), ...(q && !exists ? [{ name: q, count: null }] : [])];
  }, [all, tags, q]);

  const pick = (name: string) => {
    onAdd(name);
    setQuery("");
    setActive(0);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
        setActive(0);
      }}
    >
      <PopoverTrigger
        className={cn(chip, "px-[5px] text-text-secondary hover:bg-mm-fill-subtle hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-mm-fill-subtle data-[state=open]:text-foreground")}
        aria-label={t("addLabel")}
      >
        <Plus className="size-3" />
        {t("add")}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 gap-0 p-1"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          input.current?.focus();
        }}
      >
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, options.length - 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
            else if (e.key === "Enter" && options[active]) pick(options[active].name);
            else return;
            e.preventDefault();
          }}
          placeholder={t("find")}
          aria-label={t("find")}
          role="combobox"
          aria-expanded
          aria-controls="tag-options"
          aria-activedescendant={options[active] ? `tag-option-${active}` : undefined}
          className="-mx-1 -mt-1 mb-1 h-8 border-b border-border bg-transparent px-2.5 text-[13px] outline-none placeholder:text-muted-foreground"
        />
        {options.length > 0 && (
          <ul id="tag-options" role="listbox" className="max-h-60 overflow-y-auto">
            {options.map((o, i) => (
              <li
                key={o.count === null ? "new" : o.name}
                id={`tag-option-${i}`}
                role="option"
                aria-selected={i === active}
                onPointerMove={() => setActive(i)}
                onClick={() => pick(o.name)}
                className={cn("flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-[13px]", i === active && "bg-mm-fill-subtle")}
              >
                {o.count === null ? (
                  <>
                    <Plus className="size-3.5 shrink-0" />
                    <span className="truncate">{t("create", { tag: o.name })}</span>
                  </>
                ) : (
                  <>
                    <span className="flex-1 truncate">{o.name}</span>
                    <span className="text-[11px] tabular-nums text-text-secondary">{o.count}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
