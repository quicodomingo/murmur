import { useEffect, useState } from "react";
import { Plus, Search, Settings, Trash2, X } from "lucide-react";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { ContextMenu } from "radix-ui";
import { useTranslation } from "react-i18next";

import { clock, DAY_GROUPS, dayGroupId, dayGroupLabel, duration } from "@/lib/format";
import type { MeetingSummary, SearchHit } from "@/lib/types";
import { LogoIcon } from "@/components/Logo";
import { isTauri } from "@/lib/backend";
import { t as translate } from "@/lib/i18n";
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
  /** Right click › Delete meeting… (asks for confirmation). */
  onDelete: (id: string) => void;
};

/** Right click on a meeting in the app: a native menu, like Finder or Notes. */
async function showRowMenu(m: MeetingSummary, onDelete: (id: string) => void) {
  const menu = await Menu.new({
    items: [await MenuItem.new({ text: translate("sidebar:deleteMeeting"), enabled: m.status !== "recording", action: () => onDelete(m.id) })],
  });
  await menu.popup();
}
const HITS_PER_MEETING = 3;

export function Sidebar({ meetings, selectedId, canCreate, search, onSelect, onOpenHit, onNew, onSettings, onDelete }: Props) {
  const { t } = useTranslation("sidebar");
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
    <nav className="flex h-full w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar" aria-label={t("nav")}>
      {/* Traffic lights on the left (native), the brand on the right; the strip drags the window. */}
      <div data-tauri-drag-region className="flex h-[52px] shrink-0 items-center justify-end pr-3.5">
        <span data-tauri-drag-region className="flex items-center gap-1.5 text-[12px] font-bold tracking-[-0.02em]">
          <LogoIcon size={18} />
          murmur
        </span>
      </div>
      <button
        type="button"
        onClick={onNew}
        disabled={!canCreate}
        className="mx-3 mb-2.5 flex h-8 shrink-0 items-center gap-2 rounded-lg bg-mm-new-meeting px-2.5 text-[13px] font-semibold text-mm-on-new-meeting transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40"
      >
        <Plus className="size-3.5" strokeWidth={2.4} aria-hidden />
        <span className="flex-1 text-left">{t("newMeeting")}</span>
        <kbd className="font-sans text-[11px] font-medium opacity-60">⌘N</kbd>
      </button>
      <div className="px-3">
        <label className="flex h-7 items-center gap-1.5 rounded-md bg-mm-search-field px-2 text-muted-foreground">
          <Search className="size-3.5 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder={t("search")}
            aria-label={t("search")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          {searching && (
            <button type="button" onClick={() => setQuery("")} aria-label={t("clearSearch")} className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10">
              <X className="size-3" />
            </button>
          )}
        </label>
      </div>
      <div className="mt-3 flex-1 overflow-y-auto px-2">
        {searching ? (
          <Results hits={hits} selectedId={selectedId} onSelect={onSelect} onOpenHit={onOpenHit} />
        ) : (
          DAY_GROUPS.map((group) => {
            const items = meetings.filter((m) => dayGroupId(m.createdAt) === group);
            if (!items.length) return null;
            return (
              <section key={group} className="mb-3">
                <h3 className="px-2 pb-1 text-[11px] font-semibold text-text-secondary">{dayGroupLabel(group)}</h3>
                {items.map((m) => (
                  <ContextMenu.Root key={m.id}>
                    <ContextMenu.Trigger asChild>
                      <button
                        type="button"
                        onClick={() => onSelect(m.id)}
                        onContextMenu={(e) => {
                          // In the app, the native macOS menu; the web one stays for the browser.
                          if (!isTauri()) return;
                          e.preventDefault();
                          showRowMenu(m, onDelete);
                        }}
                        aria-current={m.id === selectedId ? "page" : undefined}
                        className={cn(
                          "relative flex h-[30px] w-full items-center gap-2 rounded-md pl-2.5 pr-2 text-left text-[13px]",
                          m.id === selectedId ? "bg-mm-sidebar-selection font-medium" : "hover:bg-black/5 dark:hover:bg-white/5",
                        )}
                      >
                        {/* The selected row's bar echoes the logo. */}
                        {m.id === selectedId && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-[2px] bg-mm-sidebar-selection-bar" aria-hidden />}
                        <span className="flex-1 truncate">{m.title}</span>
                        {m.status === "recording" ? (
                          <span className="flex items-center gap-[5px] text-[10px] font-bold tracking-[0.06em] text-mm-recording-label" aria-label={t("recording")}>
                            <span className="mm-rec size-2 rounded-full bg-mm-recording-dot" aria-hidden />
                            REC
                          </span>
                        ) : m.status === "processing" ? (
                          <span className="size-3 animate-spin rounded-full border-[1.5px] border-text-secondary/30 border-t-text-secondary" aria-label={t("verifyingSpeakers")} />
                        ) : (
                          <span className="text-[11px] tabular-nums text-text-secondary">{duration(m.duration)}</span>
                        )}
                      </button>
                    </ContextMenu.Trigger>
                    <ContextMenu.Portal>
                      <ContextMenu.Content className="z-50 min-w-48 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
                        <ContextMenu.Item
                          disabled={m.status === "recording"}
                          onSelect={() => onDelete(m.id)}
                          className="flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] text-destructive outline-hidden select-none focus:bg-destructive/10 data-disabled:opacity-50"
                        >
                          <Trash2 className="size-3.5" /> {t("deleteMeeting")}
                        </ContextMenu.Item>
                      </ContextMenu.Content>
                    </ContextMenu.Portal>
                  </ContextMenu.Root>
                ))}
              </section>
            );
          })
        )}
      </div>
      <div className="flex h-11 items-center border-t border-sidebar-border pl-3.5 pr-2 text-muted-foreground">
        <span className="flex-1 text-[11px]">{t("localOnly")}</span>
        <button type="button" onClick={onSettings} aria-label={t("settings")} title={t("settingsShortcut")} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10">
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
  const { t } = useTranslation("sidebar");
  if (hits === null) return <p className="px-2 text-[13px] text-text-secondary">{t("searching")}</p>;
  if (!hits.length) return <p className="px-2 text-[13px] text-text-secondary">{t("noResults")}</p>;
  const dayLabel = (ms: number) => dayGroupLabel(dayGroupId(ms));

  // Group by meeting, keeping the ranking order of each meeting's best hit.
  const groups = new Map<string, SearchHit[]>();
  for (const h of hits) groups.set(h.meetingId, [...(groups.get(h.meetingId) ?? []), h]);

  return (
    <div className="flex flex-col gap-2" role="list" aria-label={t("results")}>
      {[...groups.values()].map((group) => {
        const first = group[0];
        const passages = group.filter((h) => h.kind !== "title");
        return (
          <section key={first.meetingId} role="listitem" className={cn("rounded-md", first.meetingId === selectedId && "bg-sidebar-accent")}>
            <button type="button" onClick={() => onSelect(first.meetingId)} className="flex w-full items-baseline gap-2 rounded-md px-2 pb-0.5 pt-1.5 text-left hover:bg-black/5 dark:hover:bg-white/5">
              <span className="flex-1 truncate text-[13px] font-medium">{first.title}</span>
              <span className="shrink-0 text-[11px] text-text-secondary">{dayLabel(first.createdAt)}</span>
            </button>
            {passages.slice(0, HITS_PER_MEETING).map((h) => (
              <button
                key={`${h.kind}-${h.ref}`}
                type="button"
                onClick={() => onOpenHit(h)}
                className="flex w-full gap-2 rounded-md px-2 py-1 text-left hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span className="w-9 shrink-0 pt-px text-right text-[11px] tabular-nums text-text-secondary">
                  {h.kind === "note" ? t("note") : clock(h.t)}
                </span>
                <Snippet text={h.snippet} />
              </button>
            ))}
            {passages.length > HITS_PER_MEETING && (
              <p className="px-2 pb-1 pl-[52px] text-[11px] text-text-secondary">{t("moreHits", { count: passages.length - HITS_PER_MEETING })}</p>
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
