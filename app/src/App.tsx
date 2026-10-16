import { useCallback, useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ChevronDown, Copy, FileDown, FileText, FolderOpen, Mic, PanelLeft, PanelRight, Share, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { NotesPanel } from "@/components/NotesPanel";
import { SIDE_WIDTH, SidePanel } from "@/components/SidePanel";
import { SettingsDialog } from "@/components/SettingsDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sidebar } from "@/components/Sidebar";
import { Transcript } from "@/components/Transcript";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import * as backend from "@/lib/backend";
import { clock, duration, toMarkdown } from "@/lib/format";
import { exportMeeting, type ExportFormat } from "@/lib/export";
import { useSettings } from "@/lib/settings";
import { notesDoc } from "@/lib/notes";
import { useMeetings } from "@/lib/store";
import type { Meeting, SearchHit } from "@/lib/types";
import { cn } from "@/lib/utils";

/** useState that survives restarts (per-viewer UI preferences only). */
function useStoredState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      return { ...initial, ...JSON.parse(localStorage.getItem(key) ?? "{}") };
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* keep in memory */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

/** Browser-only fallback for UI development: accent-insensitive substring search. */
function localSearch(meetings: Meeting[], query: string): SearchHit[] {
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const q = fold(query.trim());
  const mark = (text: string) => {
    const i = fold(text).indexOf(q);
    return i < 0 ? text : `${text.slice(0, i)}\u0002${text.slice(i, i + q.length)}\u0003${text.slice(i + q.length)}`;
  };
  return meetings.flatMap((m) => {
    const base = { meetingId: m.id, title: m.title, createdAt: m.createdAt };
    const hits: SearchHit[] = [];
    if (fold(m.title).includes(q)) hits.push({ ...base, kind: "title", ref: m.id, t: 0, snippet: mark(m.title) });
    for (const u of m.utterances) {
      if (fold(u.text).includes(q)) hits.push({ ...base, kind: "utterance", ref: u.id, t: u.start, snippet: mark(u.text) });
    }
    return hits;
  });
}

function newMeeting(sources: { mic: boolean; system: boolean }): Meeting {
  const now = new Date();
  const time = now.toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit" });
  return {
    id: crypto.randomUUID(),
    title: `Reunió de les ${time}`,
    createdAt: now.getTime(),
    duration: 0,
    status: "recording",
    utterances: [],
    speakerNames: {},
    notes: [],
    sources,
  };
}

function ToolbarButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn("grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10", active && "bg-black/[0.07] text-foreground dark:bg-white/10")}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function App() {
  const [state, dispatch, forget] = useMeetings();
  const [settings, updateSettings] = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [notes, setNotes] = useStoredState("transcriptor.notesLayout.v1", {
    visible: true,
    full: false,
    width: SIDE_WIDTH.default,
  });
  const showNotes = notes.visible;
  const [hoveredNote, setHoveredNote] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const startedAt = useRef(0);

  const meeting = (state.selectedId && state.open[state.selectedId]) || null;
  const recording = Object.values(state.open).find((m) => m.status === "recording") ?? null;

  // Full-text search in SQLite; in a plain browser (UI work) a simple scan of what's loaded.
  const openRef = useRef(state.open);
  openRef.current = state.open;
  const search = useCallback(
    (query: string): Promise<SearchHit[]> =>
      backend.isTauri() ? backend.searchMeetings(query) : Promise.resolve(localSearch(Object.values(openRef.current), query)),
    [],
  );

  useEffect(() => {
    if (!backend.isTauri()) return;
    backend.prepare().catch((e) => toast.error(String(e)));
    const unlisten = backend.subscribe({
      onEvent: (e) => {
        if (e.type === "partial") dispatch({ type: "partial", channel: e.channel, text: e.text });
        else
          dispatch({
            type: "final",
            utterance: { id: crypto.randomUUID(), start: e.start, end: e.end, speaker: e.speaker, text: e.text },
          });
      },
      onLevel: setLevel,
      onDone: () => dispatch({ type: "stopped" }),
      onError: (message) => toast.error(message),
      onFinalPass: (e) => dispatch({ type: "finalPassStarted", id: e.meetingId, stage: e.stage, estimateSeconds: e.estimateSeconds }),
      onFinalPassSpeakers: (e) => {
        dispatch({ type: "speakersVerified", id: e.meetingId, base: e.base, assignments: e.assignments });
        toast("Parlants verificats");
      },
      onFinalPassDone: (e) => {
        dispatch({ type: "finalPassDone", id: e.meetingId });
        if (e.error) toast.error(`No s'han pogut verificar els parlants: ${e.error}`);
      },
    });
    return () => void unlisten.then((u) => u());
  }, [dispatch]);

  // "Configuració…" in the app menu.
  useEffect(() => {
    if (!backend.isTauri()) return;
    const unlisten = backend.onOpenSettings(() => setShowSettings(true));
    return () => void unlisten.then((u) => u());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => dispatch({ type: "tick", duration: (Date.now() - startedAt.current) / 1000 }), 500);
    return () => clearInterval(id);
  }, [recording, dispatch]);

  const start = useCallback(async () => {
    if (!backend.isTauri()) {
      toast.error("Obre Transcriptor com a app (npm run tauri dev) per gravar.");
      return;
    }
    setBusy(true);
    const m = newMeeting({ mic: settings.mic, system: settings.system });
    dispatch({ type: "new", meeting: m });
    startedAt.current = Date.now();
    try {
      const path = await backend.startRecording({
        meetingId: m.id,
        mic: settings.mic,
        micDevice: settings.micDevice,
        system: settings.system,
        saveAudio: settings.saveAudio,
        recordingsDir: settings.recordingsDir,
        maxSpeakers: settings.maxSpeakers,
        threshold: settings.threshold,
        verifySpeakers: settings.verifySpeakers,
      });
      if (path) dispatch({ type: "audio", id: m.id, path });
    } catch (e) {
      dispatch({ type: "stopped" });
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }, [dispatch, settings]);

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      await backend.stopRecording(); // the engine flushes the last sentence, then emits "done"
    } catch (e) {
      toast.error(String(e));
      dispatch({ type: "stopped" });
    } finally {
      setBusy(false);
      setLevel(0);
    }
  }, [dispatch]);

  const doExport = (m: Meeting, format: ExportFormat) =>
    exportMeeting(m, format)
      .then((done) => done && toast("Reunió exportada"))
      .catch((e) => toast.error(String(e)));

  const copyMarkdown = (m: Meeting) =>
    navigator.clipboard.writeText(toMarkdown(m)).then(() => toast("Transcripció copiada en Markdown"));

  const remove = async (m: Meeting) => {
    const message = m.audioPath
      ? `S'eliminaran la transcripció, les notes i l'àudio desat de «${m.title}». No es pot desfer.`
      : `S'eliminaran la transcripció i les notes de «${m.title}». No es pot desfer.`;
    const confirmed = backend.isTauri()
      ? await ask(message, { title: "Vols eliminar la reunió?", kind: "warning", okLabel: "Elimina", cancelLabel: "Cancel·la" })
      : window.confirm(message);
    if (!confirmed) return;
    try {
      if (backend.isTauri()) await backend.deleteMeeting(m.id, m.audioPath ?? null);
      forget(m.id);
      dispatch({ type: "delete", id: m.id });
    } catch (e) {
      toast.error(String(e));
    }
  };

  // Settings › General › Panell principal: the other panel goes on the right.
  const notesPrimary = settings.primaryPanel === "notes";
  const renderTranscript = (compact: boolean) =>
    meeting && (
      <Transcript
        meeting={meeting}
        compact={compact}
        jump={state.jump?.meetingId === meeting.id ? state.jump : null}
        finalPass={state.finalPass[meeting.id] ?? null}
        partial={meeting.status === "recording" ? state.partial : { mic: "", system: "" }}
        hoveredNote={hoveredNote}
        onHoverNote={setHoveredNote}
        onTitle={(title) => dispatch({ type: "title", id: meeting.id, title })}
        onReassign={(utteranceId, speaker, version) => dispatch({ type: "reassign", id: meeting.id, utteranceId, speaker, version })}
        onRename={(speaker, name, version) => dispatch({ type: "rename", id: meeting.id, speaker, name, version })}
        onEdit={(utteranceId, text) => dispatch({ type: "edit", id: meeting.id, utteranceId, text })}
      />
    );
  const renderNotes = (mode: "side" | "full") =>
    meeting && (
      <NotesPanel
        meetingId={meeting.id}
        doc={notesDoc(meeting)}
        now={meeting.duration}
        hoveredNote={hoveredNote}
        onHoverNote={setHoveredNote}
        onChange={(doc) => dispatch({ type: "notes", id: meeting.id, doc })}
        mode={mode}
        width={notes.width}
        onResize={(width) => setNotes((n) => ({ ...n, width }))}
        onToggleFull={notesPrimary ? undefined : () => setNotes((n) => ({ ...n, full: !n.full }))}
      />
    );

  return (
    <TooltipProvider delayDuration={600}>
      <div className="flex h-screen overflow-hidden">
        {showSidebar && (
          <Sidebar
            meetings={state.summaries}
            selectedId={state.selectedId}
            canCreate={!recording && !busy}
            search={search}
            onSelect={(id) => dispatch({ type: "select", id })}
            onOpenHit={(hit) =>
              dispatch({ type: "jump", meetingId: hit.meetingId, utteranceId: hit.kind === "utterance" ? hit.ref : undefined, t: hit.t })
            }
            onNew={start}
            onSettings={() => setShowSettings(true)}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header data-tauri-drag-region className={cn("flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3", !showSidebar && "pl-[84px]")}>
            <ToolbarButton label={showSidebar ? "Amaga la barra lateral" : "Mostra la barra lateral"} onClick={() => setShowSidebar((v) => !v)}>
              <PanelLeft className="size-4" />
            </ToolbarButton>
            {meeting && (
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[13px] font-semibold hover:bg-black/5 dark:hover:bg-white/10">
                  {meeting.title}
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-56">
                  <DropdownMenuItem onSelect={() => copyMarkdown(meeting)}>
                    <Copy className="size-3.5" /> Copia en Markdown
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!meeting.audioPath}
                    onSelect={() => meeting.audioPath && revealItemInDir(meeting.audioPath).catch((e) => toast.error(String(e)))}
                  >
                    <FolderOpen className="size-3.5" /> {meeting.audioPath ? "Mostra l'àudio al Finder" : "No s'ha desat l'àudio"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" disabled={meeting.status === "recording"} onSelect={() => remove(meeting)}>
                    <Trash2 className="size-3.5" /> Elimina la reunió…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <div data-tauri-drag-region className="flex-1" />

            {recording ? (
              <div className="flex items-center gap-1 rounded-full bg-muted py-1 pl-3 pr-1">
                <span
                  className="size-2 rounded-full bg-record transition-transform"
                  style={{ transform: `scale(${1 + Math.min(level * 12, 0.8)})` }}
                  aria-hidden
                />
                <span className="ml-1.5 mr-1 text-[13px] font-medium tabular-nums" aria-label="Temps de gravació">
                  {clock(recording.duration)}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={stop}
                      disabled={busy}
                      aria-label="Atura la gravació"
                      className="grid size-6 place-items-center rounded-full text-record hover:bg-black/5 disabled:opacity-40"
                    >
                      <Square className="size-3 fill-current" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Atura</TooltipContent>
                </Tooltip>
              </div>
            ) : (
              meeting && (
                <>
                  <span className="text-[13px] text-text-secondary">Durada {duration(meeting.duration)}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" className="h-6 rounded-md px-2.5 text-[13px]">
                        Exporta <Share className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-52">
                      <DropdownMenuItem onSelect={() => doExport(meeting, "docx")}>
                        <FileDown className="size-3.5" /> Document de Word (.docx)…
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => doExport(meeting, "md")}>
                        <FileText className="size-3.5" /> Markdown (.md)…
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => copyMarkdown(meeting)}>
                        <Copy className="size-3.5" /> Copia en Markdown
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )
            )}
            {meeting && (
              <ToolbarButton label={`${showNotes ? "Amaga" : "Mostra"} ${notesPrimary ? "la transcripció" : "les notes"}`} onClick={() => setNotes((n) => ({ ...n, visible: !n.visible }))} active={showNotes}>
                <PanelRight className="size-4" />
              </ToolbarButton>
            )}
          </header>

          <div className="flex min-h-0 flex-1">
            {!meeting ? (
              <main className="min-w-0 flex-1">{state.loaded && <Welcome onStart={start} busy={busy} />}</main>
            ) : notesPrimary ? (
              <>
                {renderNotes("full")}
                {showNotes && (
                  <SidePanel width={notes.width} onResize={(width) => setNotes((n) => ({ ...n, width }))}>
                    {renderTranscript(true)}
                  </SidePanel>
                )}
              </>
            ) : (
              <>
                <main className={cn("min-w-0 flex-1", showNotes && notes.full && "hidden")}>{renderTranscript(false)}</main>
                {showNotes && renderNotes(notes.full ? "full" : "side")}
              </>
            )}
          </div>
        </div>
      </div>
      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} settings={settings} onChange={updateSettings} recording={!!recording} />
      <Toaster position="bottom-center" />
    </TooltipProvider>
  );
}

function Welcome({ onStart, busy }: { onStart: () => void; busy: boolean }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="max-w-sm text-center">
        <h1 className="text-[22px] font-bold">Cap reunió encara</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Grava una reunió i la transcripció apareixerà en directe, separada per parlants. Tot es processa en aquest ordinador.
        </p>
        <Button className="mt-5 h-7 rounded-md px-3 text-[13px]" onClick={onStart} disabled={busy}>
          <Mic className="size-3.5" /> Comença a gravar
        </Button>
        <p className="mt-3 text-[12px] text-text-secondary">Recorda demanar el consentiment dels participants.</p>
      </div>
    </div>
  );
}
