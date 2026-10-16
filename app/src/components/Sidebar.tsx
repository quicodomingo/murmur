import { useState } from "react";
import { Plus, Search, Settings } from "lucide-react";

import { dayGroup, duration } from "@/lib/format";
import type { Meeting } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  meetings: Meeting[];
  selectedId: string | null;
  canCreate: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
};

const GROUPS = ["Avui", "Ahir", "Aquesta setmana", "Anteriors"];

export function Sidebar({ meetings, selectedId, canCreate, onSelect, onNew, onSettings }: Props) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = meetings.filter(
    (m) => !q || m.title.toLowerCase().includes(q) || m.utterances.some((u) => u.text.toLowerCase().includes(q)),
  );

  return (
    <nav className="flex h-full w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar" aria-label="Reunions">
      {/* Room for the traffic lights; the strip also drags the window. */}
      <div data-tauri-drag-region className="h-[52px] shrink-0" />
      <div className="px-3">
        <label className="flex h-7 items-center gap-1.5 rounded-md bg-black/5 px-2 text-muted-foreground dark:bg-white/10">
          <Search className="size-3.5" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca"
            className="flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>
      <div className="mt-3 flex-1 overflow-y-auto px-2">
        {GROUPS.map((group) => {
          const items = visible.filter((m) => dayGroup(m.createdAt) === group);
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
        })}
        {meetings.length > 0 && visible.length === 0 && (
          <p className="px-2 text-[13px] text-text-secondary">Cap reunió coincideix.</p>
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
