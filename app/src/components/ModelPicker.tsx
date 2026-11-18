import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RECOMMENDED } from "@/lib/cloud";
import type { CloudModel, CloudProvider } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Past this many models, the list gets a search field. */
const SEARCH_FROM = 12;

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const isFree = (m: CloudModel) => m.id.endsWith(":free");
/** OpenRouter says "(free)" in the name; the tag says it instead. */
const label = (m: CloudModel) => m.name.replace(/\s*\(free\)$/i, "");

type Row = { kind: "head"; text: string; count?: number } | { kind: "item"; model: CloudModel; company?: string };

/**
 * The cloud model under Settings › Intel·ligència and on the onboarding (docs/mockups/proveidors.html):
 * a button that opens the provider's models, with a search field when there are many (OpenRouter
 * has hundreds), the recommended ones first and the rest by company. Arrows, Enter and Esc.
 */
export function ModelPicker({
  provider,
  value,
  models,
  onChange,
  labelledBy,
  align = "end",
}: {
  provider: CloudProvider;
  value: string;
  /** undefined while they load: the button shows the id and can't open. */
  models: CloudModel[] | undefined;
  onChange: (id: string) => void;
  labelledBy?: string;
  /** Which edge of the button the list lines up with. */
  align?: "start" | "end";
}) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = models?.find((m) => m.id === value);
  const searchable = (models?.length ?? 0) > SEARCH_FROM;

  const rows = useMemo<Row[]>(() => {
    if (!models) return [];
    const words = fold(query).split(/\s+/).filter(Boolean);
    const shown = words.length
      ? models.filter((m) => {
          const hay = fold(`${m.name} ${m.group ?? ""} ${m.id}`);
          return words.every((w) => hay.includes(w));
        })
      : models;
    const out: Row[] = [];
    if (!words.length) {
      const picks = RECOMMENDED[provider].map((r) => models.find((m) => m.id === r)).filter((m): m is CloudModel => !!m);
      if (picks.length) {
        out.push({ kind: "head", text: t("modelPicker.recommended") });
        picks.forEach((m) => out.push({ kind: "item", model: m, company: m.group }));
      }
    }
    if (!shown.some((m) => m.group)) {
      shown.forEach((m) => out.push({ kind: "item", model: m }));
      return out;
    }
    const groups = new Map<string, CloudModel[]>();
    for (const m of shown) groups.set(m.group ?? "", [...(groups.get(m.group ?? "") ?? []), m]);
    for (const [group, list] of groups) {
      out.push({ kind: "head", text: group, count: list.length });
      list.forEach((m) => out.push({ kind: "item", model: m }));
    }
    return out;
  }, [models, query, provider, t]);

  const items = rows.flatMap((r, i) => (r.kind === "item" ? [i] : []));
  const matches = new Set(rows.flatMap((r) => (r.kind === "item" ? [r.model.id] : []))).size;

  // On opening, the chosen model is the active one; while typing, the first match.
  useEffect(() => {
    if (!open) return;
    const at = rows.findIndex((r) => r.kind === "item" && r.model.id === value);
    setActive(query || at < 0 ? (items[0] ?? 0) : at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (m: CloudModel) => {
    onChange(m.id);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const pos = items.indexOf(active);
    const go = (i: number) => {
      e.preventDefault();
      if (items.length) setActive(items[Math.max(0, Math.min(items.length - 1, i))]);
    };
    if (e.key === "ArrowDown") go(pos + 1);
    else if (e.key === "ArrowUp") go(pos - 1);
    else if (e.key === "Home" && !searchable) go(0);
    else if (e.key === "End" && !searchable) go(items.length - 1);
    else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row?.kind === "item") choose(row.model);
    }
  };

  const highlight = (text: string) => {
    const q = query.trim();
    const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
    if (at < 0) return text;
    return (
      <>
        {text.slice(0, at)}
        <span className="font-semibold">{text.slice(at, at + q.length)}</span>
        {text.slice(at + q.length)}
      </>
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!models}
          aria-labelledby={labelledBy}
          aria-haspopup="listbox"
          className="flex h-6 max-w-64 shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-[13px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60 data-[state=open]:ring-2 data-[state=open]:ring-ring/30"
        >
          <span className="truncate">{current ? label(current) : value}</span>
          {current?.group && <span className="shrink-0 text-[12px] text-muted-foreground">{current.group}</span>}
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} collisionPadding={8} className="w-[340px] gap-0 overflow-hidden p-0" onKeyDown={onKey} onOpenAutoFocus={(e) => {
          // A short list has no search field: the list itself takes the keys.
          if (searchable) return;
          e.preventDefault();
          listRef.current?.focus();
        }}>
        {searchable && (
          <div className="flex h-9 items-center gap-2 border-b border-border px-2.5">
            <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("modelPicker.search", { count: models?.length ?? 0 })}
              role="combobox"
              aria-expanded
              aria-controls={`${id}-list`}
              aria-activedescendant={rows[active]?.kind === "item" ? `${id}-${active}` : undefined}
              aria-autocomplete="list"
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
            />
          </div>
        )}
        <div ref={listRef} id={`${id}-list`} role="listbox" tabIndex={searchable ? -1 : 0} className="max-h-[min(18rem,max(10rem,calc(var(--radix-popover-content-available-height)-5.5rem)))] overflow-y-auto p-1 outline-none">
          {matches === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-muted-foreground" role="status">
              <div className="mb-0.5 text-[13px] font-medium text-foreground">{t("modelPicker.none", { query: query.trim() })}</div>
              {t("modelPicker.noneHint")}
            </div>
          ) : (
            rows.map((r, i) =>
              r.kind === "head" ? (
                <div key={`h${i}`} role="presentation" className="flex px-2 pt-2 pb-0.5 text-[11px] font-semibold text-muted-foreground">
                  {r.text}
                  {r.count != null && <span className="ml-auto font-normal tabular-nums">{r.count}</span>}
                </div>
              ) : (
                <div
                  key={`${i}-${r.model.id}`}
                  id={`${id}-${i}`}
                  data-row={i}
                  role="option"
                  aria-selected={r.model.id === value}
                  onMouseMove={() => active !== i && setActive(i)}
                  onClick={() => choose(r.model)}
                  className={cn("flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-[13px]", active === i && "bg-mm-sidebar-selection")}
                >
                  <span className="w-3.5 shrink-0">{r.model.id === value && <Check className="size-3.5" strokeWidth={2.4} aria-hidden />}</span>
                  <span className="min-w-0 flex-1 truncate">{highlight(label(r.model))}</span>
                  {isFree(r.model) && (
                    <span className="shrink-0 rounded bg-mm-fill-subtle px-1.5 text-[10px] font-semibold text-muted-foreground">{t("modelPicker.free")}</span>
                  )}
                  {r.company && <span className="shrink-0 text-[11px] text-muted-foreground">{r.company}</span>}
                </div>
              ),
            )
          )}
        </div>
        {searchable && (
          <div className="flex justify-between border-t border-border px-2.5 py-1.5 text-[11px] text-muted-foreground">
            <span className="tabular-nums">
              {query.trim() ? t("modelPicker.matches", { shown: matches, count: models?.length ?? 0 }) : t("modelPicker.count", { count: models?.length ?? 0 })}
            </span>
            <span>{t("modelPicker.escape")}</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
