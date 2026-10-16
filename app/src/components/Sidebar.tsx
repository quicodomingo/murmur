import { useEffect, useState } from "react";
import { Plus, Search, Settings, X } from "lucide-react";

import { clock, dayGroup, duration } from "@/lib/format";
import type { MeetingSummary, SearchHit } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  meetings: MeetingSummary[];
  selectedId: string | null;
  canCreate: boolean;
  search: (query: string) => Promise<SearchHit[]>;
  onSelect: (id: string) => void;
  onOpenHit: (hit: SearchHit) => void;
  onNew: () => void;
  onSettings: () => void;
};

const GROUPS = ["Avui", "Ahir", "Aquesta setmana", "Anteriors"];
const HITS_PER_MEETING = 3;

export function Sidebar({ meetings, selectedId, canCreate, search, onSelect, onOpenHit, onNew, onSettings }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const searching = query.trim().length > 0;

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      search(q)
        .then((h) => current && setHits(h))
        .catch(() => current && setHits([]));
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, search]);

  return (
    <nav className="flex h-full w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar" aria-label="Reunions">
      {/* Room for the traffic lights; the strip also drags the window. */}
      <div data-tauri-drag-region className="h-[52px] shrink-0" />
      <div className="px-3">
        <label className="flex h-7 items-center gap-1.5 rounded-md bg-black/5 px-2 text-muted-foreground dark:bg-white/10">
          <Search className="size-3.5 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder="Cerca a totes les reunions"
            aria-label="Cerca a totes les reunions"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          {searching && (
            <button type="button" onClick={() => setQuery("")} aria-label="Esborra la cerca" className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10">
              <X className="size-3" />
            </button>
          )}
        </label>
      </div>
      <div className="mt-3 flex-1 overflow-y-auto px-2">
        {searching ? (
          <Results hits={hits} selectedId={selectedId} onSelect={onSelect} onOpenHit={onOpenHit} />
        ) : (
          GROUPS.map((group) => {
            const items = meetings.filter((m) => dayGroup(m.createdAt) === group);
            if (!items.length) return null;
            return (
              <section key={group} className="mb-3">
                <h3 className="px-2 pb-1 text-[11px] font-semibold text-text-secondary">{group}</h3>
                {items.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onSelect(m.id)}
                    className={cn(
                      "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]",
                      m.id === selectedId ? "bg-sidebar-accent" : "hover:bg-black/5 dark:hover:bg-white/5",
                    )}
                  >
                    <span className="flex-1 truncate">{m.title}</span>
                    {m.status === "recording" ? (
                      <span className="size-1.5 animate-pulse rounded-full bg-record" aria-label="En directe" />
                    ) : (
                      <span className="text-[11px] tabular-nums text-text-secondary">{duration(m.duration)}</span>
                    )}
                  </button>
                ))}
              </section>
            );
          })
        )}
      </div>
      <div className="flex h-10 items-center border-t border-sidebar-border pl-4 pr-2">
        <button
          type="button"
          onClick={onNew}
          disabled={!canCreate}
          className="flex flex-1 items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          <Plus className="size-4" />
          Nova reunió
        </button>
        <button type="button" onClick={onSettings} aria-label="Configuració" title="Configuració (⌘,)" className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10">
          <Settings className="size-4" />
        </button>
      </div>
    </nav>
  );
}

function Results({
  hits,
  selectedId,
  onSelect,
  onOpenHit,
}: {
  hits: SearchHit[] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenHit: (hit: SearchHit) => void;
}) {
  if (hits === null) return <p className="px-2 text-[13px] text-text-secondary">Cercant…</p>;
  if (!hits.length) return <p className="px-2 text-[13px] text-text-secondary">Cap resultat.</p>;

  // Group by meeting, keeping the ranking order of each meeting's best hit.
  const groups = new Map<string, SearchHit[]>();
  for (const h of hits) groups.set(h.meetingId, [...(groups.get(h.meetingId) ?? []), h]);

  return (
    <div className="flex flex-col gap-2" role="list" aria-label="Resultats de la cerca">
      {[...groups.values()].map((group) => {
        const first = group[0];
        const passages = group.filter((h) => h.kind !== "title");
        return (
          <section key={first.meetingId} role="listitem" className={cn("rounded-md", first.meetingId === selectedId && "bg-sidebar-accent")}>
            <button type="button" onClick={() => onSelect(first.meetingId)} className="flex w-full items-baseline gap-2 rounded-md px-2 pb-0.5 pt-1.5 text-left hover:bg-black/5 dark:hover:bg-white/5">
              <span className="flex-1 truncate text-[13px] font-medium">{first.title}</span>
              <span className="shrink-0 text-[11px] text-text-secondary">{dayGroup(first.createdAt)}</span>
            </button>
            {passages.slice(0, HITS_PER_MEETING).map((h) => (
              <button
                key={`${h.kind}-${h.ref}`}
                type="button"
                onClick={() => onOpenHit(h)}
                className="flex w-full gap-2 rounded-md px-2 py-1 text-left hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span className="w-9 shrink-0 pt-px text-right text-[11px] tabular-nums text-text-secondary">
                  {h.kind === "note" ? "nota" : clock(h.t)}
                </span>
                <Snippet text={h.snippet} />
              </button>
            ))}
            {passages.length > HITS_PER_MEETING && (
              <p className="px-2 pb-1 pl-[52px] text-[11px] text-text-secondary">i {passages.length - HITS_PER_MEETING} més</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Renders the database snippet, whose matches are wrapped in \u0002 … \u0003 (never HTML). */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0002[^\u0003]*\u0003)/);
  return (
    <span className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">
      {parts.map((p, i) =>
        p.startsWith("\u0002") ? (
          <mark key={i} className="rounded-[3px] bg-yellow-200/80 px-px text-foreground dark:bg-yellow-500/40">
            {p.slice(1, -1)}
          </mark>
        ) : (
          p
        ),
      )}
    </span>
  );
}
