import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Link2, Plus, Search, Settings, Tag, Trash2, X } from "lucide-react";
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { ContextMenu } from "radix-ui";
import { useTranslation } from "react-i18next";

import { clock, DAY_GROUPS, dayGroupId, dayGroupLabel, duration } from "@/lib/format";
import type { MeetingSummary, SearchHit } from "@/lib/types";
import { LogoIcon } from "@/components/Logo";
import { isTauri } from "@/lib/backend";
import { t as translate } from "@/lib/i18n";
import { activeShares } from "@/lib/share";
import { cn } from "@/lib/utils";
import { StartOptionsCompact, type StartChoice } from "./StartOptions";
import { hasTag, tagCounts, type TagCount } from "./Tags";

type Props = {
  meetings: MeetingSummary[];
  selectedId: string | null;
  canCreate: boolean;
  search: (query: string) => Promise<SearchHit[]>;
  onSelect: (id: string) => void;
  onOpenHit: (hit: SearchHit) => void;
  onNew: () => void;
  /** Language and people in the room for the next meeting (StartOptions). */
  startChoice: StartChoice;
  onStartChoice: (change: Partial<StartChoice>) => void;
  englishReady: boolean;
  onSettings: () => void;
  /** Right click › Delete meeting… (asks for confirmation). */
  onDelete: (id: string) => void;
  /** Only the meetings with this tag (list and search). */
  tagFilter: string | null;
  onTagFilter: (tag: string | null) => void;
  /** Renames a tag everywhere; onto another tag's name, merges them. */
  onRenameTag: (from: string, to: string) => void;
  /** Asks for confirmation. */
  onDeleteTag: (tag: string) => void;
};

/** Right click on a meeting in the app: a native menu, like Finder or Notes. */
async function showRowMenu(m: MeetingSummary, onDelete: (id: string) => void) {
  const menu = await Menu.new({
    items: [await MenuItem.new({ text: translate("sidebar:deleteMeeting"), enabled: m.status !== "recording", action: () => onDelete(m.id) })],
  });
  await menu.popup();
}
const HITS_PER_MEETING = 3;
/** Tags shown before "Show n more" (the most used ones). */
const TAGS_SHOWN = 5;
const TAGS_OPEN_KEY = "murmur.sidebar.tagsOpen";

export function Sidebar({ meetings, selectedId, canCreate, search, onSelect, onOpenHit, onNew, startChoice, onStartChoice, englishReady, onSettings, onDelete, tagFilter, onTagFilter, onRenameTag, onDeleteTag }: Props) {
  const { t } = useTranslation("sidebar");
  const { t: tt } = useTranslation("tags");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const searching = query.trim().length > 0;
  const tags = useMemo(() => tagCounts(meetings), [meetings]);
  const shown = tagFilter ? meetings.filter((m) => hasTag(m, tagFilter)) : meetings;
  const shownIds = useMemo(() => new Set(shown.map((m) => m.id)), [shown]);

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
      <div className="-mt-1.5 mb-2 px-2">
        <StartOptionsCompact value={startChoice} onChange={onStartChoice} englishReady={englishReady} />
      </div>
      <div className="px-3">
        <label className="flex h-7 items-center gap-1.5 rounded-md bg-mm-search-field px-2 text-muted-foreground">
          <Search className="size-3.5 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder={tagFilter ? tt("searchIn", { tag: tagFilter }) : t("search")}
            aria-label={tagFilter ? tt("searchIn", { tag: tagFilter }) : t("search")}
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
        {tags.length > 0 && (
          <TagSection tags={tags} filter={tagFilter} onFilter={onTagFilter} onRename={onRenameTag} onDelete={onDeleteTag} total={meetings.length} />
        )}
        {searching ? (
          <Results hits={hits && (tagFilter ? hits.filter((h) => shownIds.has(h.meetingId)) : hits)} selectedId={selectedId} onSelect={onSelect} onOpenHit={onOpenHit} />
        ) : tagFilter && !shown.length ? (
          <p className="px-2 text-[13px] text-text-secondary">{tt("empty")}</p>
        ) : (
          DAY_GROUPS.map((group) => {
            const items = shown.filter((m) => dayGroupId(m.createdAt) === group);
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
                        {activeShares(m).length > 0 && <Link2 className="size-3 shrink-0 text-text-secondary" aria-label={translate("share:shared")} />}
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

/** Right click on a tag in the app: a native menu. */
async function showTagMenu(others: string[], actions: { rename: () => void; merge: (into: string) => void; remove: () => void }) {
  const merge = await Submenu.new({
    text: translate("tags:merge"),
    enabled: others.length > 0,
    items: await Promise.all(others.map((o) => MenuItem.new({ text: o, action: () => actions.merge(o) }))),
  });
  const menu = await Menu.new({
    items: [
      await MenuItem.new({ text: translate("tags:rename"), action: actions.rename }),
      merge,
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({ text: translate("tags:delete"), action: actions.remove }),
    ],
  });
  await menu.popup();
}

const readTagsOpen = () => {
  try {
    return localStorage.getItem(TAGS_OPEN_KEY) !== "0";
  } catch {
    return true;
  }
};

/**
 * The tags, as places: a click shows only the meetings with that tag. The most used first, the
 * rest behind "Show n more"; right click renames, merges or deletes one.
 */
function TagSection({
  tags,
  total,
  filter,
  onFilter,
  onRename,
  onDelete,
}: {
  tags: TagCount[];
  total: number;
  filter: string | null;
  onFilter: (tag: string | null) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (tag: string) => void;
}) {
  const { t } = useTranslation("tags");
  const [open, setOpen] = useState(readTagsOpen);
  const [more, setMore] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);

  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(TAGS_OPEN_KEY, o ? "0" : "1");
      } catch {
        /* only a convenience */
      }
      return !o;
    });
  };
  // The tag being filtered always shows, even among the hidden ones.
  const visible = more ? tags : tags.filter((x, i) => i < TAGS_SHOWN || x.name === filter);
  const hidden = tags.length - visible.length;
  const row = "relative flex h-[26px] w-full items-center gap-2 rounded-md pl-2.5 pr-2 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-ring";

  const actions = (name: string) => ({
    rename: () => setRenaming(name),
    merge: (into: string) => onRename(name, into),
    remove: () => onDelete(name),
  });

  return (
    <section className="mb-3">
      <h3 className="pb-1">
        <button type="button" onClick={toggle} aria-expanded={open} aria-label={t("toggleSection")} className="flex w-full items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-text-secondary hover:text-foreground">
          {t("section")}
          <ChevronDown className={cn("ml-auto size-3 transition-transform duration-150", !open && "-rotate-90")} aria-hidden />
        </button>
      </h3>
      {open && (
        <>
          <button type="button" onClick={() => onFilter(null)} aria-current={filter === null ? "true" : undefined} className={cn(row, filter === null ? "bg-mm-sidebar-selection font-medium" : "hover:bg-black/5 dark:hover:bg-white/5")}>
            <span className="flex-1 truncate">{t("all")}</span>
            <span className="text-[11px] tabular-nums text-text-secondary">{total}</span>
          </button>
          {visible.map((x) =>
            renaming === x.name ? (
              <RenameTag key={x.name} name={x.name} onDone={(to) => {
                setRenaming(null);
                if (to && to !== x.name) onRename(x.name, to);
              }} />
            ) : (
              <ContextMenu.Root key={x.name}>
                <ContextMenu.Trigger asChild>
                  <button
                    type="button"
                    onClick={() => onFilter(filter === x.name ? null : x.name)}
                    onContextMenu={(e) => {
                      if (!isTauri()) return;
                      e.preventDefault();
                      showTagMenu(tags.map((o) => o.name).filter((o) => o !== x.name), actions(x.name));
                    }}
                    aria-current={filter === x.name ? "true" : undefined}
                    aria-label={t("filterLabel", { tag: x.name })}
                    className={cn(row, filter === x.name ? "bg-mm-sidebar-selection font-medium" : "hover:bg-black/5 dark:hover:bg-white/5")}
                  >
                    <Tag className="size-3.5 shrink-0 text-text-secondary" aria-hidden />
                    <span className="flex-1 truncate">{x.name}</span>
                    <span className="text-[11px] tabular-nums text-text-secondary">{x.count}</span>
                  </button>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content className={menuContent}>
                    <ContextMenu.Item onSelect={actions(x.name).rename} className={menuItem}>
                      {t("rename")}
                    </ContextMenu.Item>
                    <ContextMenu.Sub>
                      <ContextMenu.SubTrigger disabled={tags.length < 2} className={menuItem}>
                        {t("merge")}
                      </ContextMenu.SubTrigger>
                      <ContextMenu.Portal>
                        <ContextMenu.SubContent className={menuContent}>
                          {tags
                            .filter((o) => o.name !== x.name)
                            .map((o) => (
                              <ContextMenu.Item key={o.name} onSelect={() => onRename(x.name, o.name)} className={menuItem}>
                                {o.name}
                              </ContextMenu.Item>
                            ))}
                        </ContextMenu.SubContent>
                      </ContextMenu.Portal>
                    </ContextMenu.Sub>
                    <ContextMenu.Separator className="my-1 h-px bg-border" />
                    <ContextMenu.Item onSelect={actions(x.name).remove} className={cn(menuItem, "text-destructive focus:bg-destructive/10")}>
                      {t("delete")}
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            ),
          )}
          {(hidden > 0 || more) && tags.length > TAGS_SHOWN && (
            <button type="button" onClick={() => setMore((m) => !m)} className="h-6 rounded-md px-2.5 text-[12px] text-text-secondary hover:text-foreground">
              {more ? t("showFewer") : t("showMore", { count: hidden })}
            </button>
          )}
        </>
      )}
    </section>
  );
}

const menuContent = "z-50 min-w-44 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10";
const menuItem = "flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] outline-hidden select-none focus:bg-accent data-disabled:opacity-50 data-[state=open]:bg-accent";

/** The tag's row while renaming it: Enter or leaving it keeps the new name, Esc cancels. */
function RenameTag({ name, onDone }: { name: string; onDone: (to: string | null) => void }) {
  const { t } = useTranslation("tags");
  const [value, setValue] = useState(name);
  const done = useRef(false);
  const finish = (to: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(to?.trim() || null);
  };
  return (
    <div className="flex h-[26px] items-center gap-2 rounded-md bg-mm-field pl-2.5 pr-2 ring-1 ring-ring">
      <Tag className="size-3.5 shrink-0 text-text-secondary" aria-hidden />
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(value);
          else if (e.key === "Escape") finish(null);
        }}
        onBlur={() => finish(value)}
        aria-label={t("renameLabel", { tag: name })}
        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
      />
    </div>
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
