import { useCallback, useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ChevronDown, Copy, FileDown, FileText, FolderOpen, Mic, PanelLeft, PanelRight, Share, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AboutDialog } from "@/components/AboutDialog";
import { LogoIcon } from "@/components/Logo";
import { Onboarding } from "@/components/Onboarding";
import { Cover } from "@/components/Cover";
import { NotesPanel } from "@/components/NotesPanel";
import { SIDE_WIDTH, SidePanel } from "@/components/SidePanel";
import { SettingsDialog } from "@/components/SettingsDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sidebar } from "@/components/Sidebar";
import { Transcript } from "@/components/Transcript";
import { Toaster } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import * as backend from "@/lib/backend";
import { clock, duration, toMarkdown } from "@/lib/format";
import { exportMeeting, type ExportFormat } from "@/lib/export";
import { useModels } from "@/lib/models";
import { ensurePermissions } from "@/lib/permissions";
import { usePostProcess } from "@/lib/postprocess";
import { useSettings } from "@/lib/settings";
import { notesDoc } from "@/lib/notes";
import { useMeetings } from "@/lib/store";
import type { Meeting, SearchHit } from "@/lib/types";
import { cn } from "@/lib/utils";

const ONBOARDED_KEY = "murmur.onboarded.v1";

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
  const [showAbout, setShowAbout] = useState(false);
  // First-run screens: once, and whenever the transcription model is missing.
  const [onboarding, setOnboarding] = useState<{ open: boolean; atModels: boolean }>({ open: false, atModels: false });
  const [showSidebar, setShowSidebar] = useState(true);
  const [notes, setNotes] = useStoredState("transcriptor.notesLayout.v1", {
    visible: true,
    full: false,
    width: SIDE_WIDTH.default,
  });
  const showNotes = notes.visible;
  const [hoveredNote, setHoveredNote] = useState<string | null>(null);
  // Cover or transcript in the main area (the cover only exists after a recording).
  const [view, setView] = useStoredState("transcriptor.view.v1", { cover: true });
  const models = useModels();
  // Until the status is read, assume it's there (no flash of "Falta el model").
  const transcriptionReady = !backend.isTauri() || !models.loaded || !!models.status.transcription?.installed;
  useEffect(() => {
    if (!models.loaded || !backend.isTauri()) return;
    let onboarded = false;
    try {
      onboarded = localStorage.getItem(ONBOARDED_KEY) === "1";
    } catch {
      /* show it */
    }
    if (!onboarded || !models.status.transcription?.installed) setOnboarding({ open: true, atModels: onboarded });
    // Only on start-up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models.loaded]);
  const closeOnboarding = () => {
    try {
      localStorage.setItem(ONBOARDED_KEY, "1");
    } catch {
      /* ignore */
    }
    setOnboarding({ open: false, atModels: false });
  };
  const post = usePostProcess(state, dispatch, settings);
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
      onFinalPass: (e) => post.speakersStarted(e.meetingId, e.estimateSeconds),
      onFinalPassSpeakers: (e) => {
        dispatch({ type: "speakersVerified", id: e.meetingId, base: e.base, assignments: e.assignments });
        toast("Parlants verificats");
      },
      onFinalPassDone: (e) => {
        if (e.error) toast.error(`No s'han pogut verificar els parlants: ${e.error}`);
        post.speakersDone(e.meetingId);
      },
    });
    return () => void unlisten.then((u) => u());
  }, [dispatch, post.speakersStarted, post.speakersDone]);

  // "Configuració…" and "Quant a Murmur" in the app menu; start/stop from the menu bar or an alert.
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!backend.isTauri()) return;
    const unlisten = [
      backend.onOpenSettings(() => setShowSettings(true)),
      backend.onOpenAbout(() => setShowAbout(true)),
      backend.onRecordRequest((start) => (start ? startRef.current() : stopRef.current())),
    ];
    return () => unlisten.forEach((u) => void u.then((f) => f()));
  }, []);

  useEffect(() => {
    if (backend.isTauri()) backend.setMeetingDetection(settings.detectMeetings).catch(() => {});
  }, [settings.detectMeetings]);

  // Load the live models ahead of time (once they're on disk) so recording starts at once.
  useEffect(() => {
    if (backend.isTauri() && models.status.transcription?.installed) backend.prepare().catch((e) => toast.error(String(e)));
  }, [models.status.transcription?.installed]);

  // ⌘N: new meeting (the sidebar button shows the shortcut).
  const startRef = useRef<() => void>(() => {});
  const removeRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
      }
      // ⌘⌫: delete the selected meeting (not while typing).
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable='true']");
      if (e.metaKey && e.key === "Backspace" && !typing) {
        e.preventDefault();
        removeRef.current();
      }
      if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        startRef.current();
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
      toast.error("Obre Murmur com a app (npm run tauri dev) per gravar.");
      return;
    }
    if (!transcriptionReady) {
      setOnboarding({ open: true, atModels: true });
      return;
    }
    setBusy(true);
    // Ask for the microphone and system audio like other apps do; record what's allowed.
    const sources = await ensurePermissions({ mic: settings.mic, system: settings.system }).catch(() => ({ mic: settings.mic, system: settings.system }));
    if (!sources) {
      setBusy(false);
      return;
    }
    const m = newMeeting(sources);
    dispatch({ type: "new", meeting: m });
    post.planRecording(m.id, settings.verifySpeakers);
    startedAt.current = Date.now();
    try {
      const path = await backend.startRecording({
        meetingId: m.id,
        mic: sources.mic,
        micDevice: settings.micDevice,
        system: sources.system,
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
  }, [dispatch, settings, post.planRecording, transcriptionReady]);
  startRef.current = () => {
    if (!recording && !busy) start();
  };

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

  stopRef.current = () => {
    if (recording && !busy) stop();
  };

  const doExport = (m: Meeting, format: ExportFormat) =>
    exportMeeting(m, format)
      .then((done) => done && toast("Reunió exportada"))
      .catch((e) => toast.error(String(e)));

  const copyMarkdown = (m: Meeting) =>
    navigator.clipboard.writeText(toMarkdown(m)).then(() => toast("Transcripció copiada en Markdown"));

  /** From the sidebar (right click) or ⌘⌫: the meeting may not be loaded yet. */
  const removeById = async (id: string) => {
    const m = state.open[id] ?? (backend.isTauri() ? await backend.getMeeting(id).catch(() => null) : null);
    if (m && m.status !== "recording") remove(m);
  };
  removeRef.current = () => {
    if (state.selectedId) removeById(state.selectedId);
  };

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

  const run = meeting ? (state.finalPass[meeting.id] ?? null) : null;
  const coverAvailable =
    !!meeting && meeting.status !== "recording" && (!!meeting.cover || !!run?.steps.includes("cover") || settings.summarize);
  const showCover = coverAvailable && view.cover;
  const coverBlocked = !models.status.llm?.installed
    ? "Activa la portada a Configuració › Intel·ligència i descarrega el model."
    : recording
      ? "Es podrà generar quan acabi la gravació."
      : meeting?.status === "processing"
        ? "Espera que acabi el processament."
        : null;
  const jumpTo = (t: number) => {
    if (!meeting) return;
    setView({ cover: false });
    dispatch({ type: "jump", meetingId: meeting.id, t });
  };
  const renderCover = () =>
    meeting && (
      <Cover
        meeting={meeting}
        run={run}
        blocked={coverBlocked}
        onGenerate={() => post.generateCover(meeting.id)}
        onJump={jumpTo}
        onShowTranscript={() => setView({ cover: false })}
        onTitle={(title) => dispatch({ type: "title", id: meeting.id, title })}
        onToggleTask={(index, done) => dispatch({ type: "coverTask", id: meeting.id, index, done })}
      />
    );
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
            onDelete={removeById}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header data-tauri-drag-region className={cn("flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3", !showSidebar && "pl-[84px]")}>
            <ToolbarButton label={showSidebar ? "Amaga la barra lateral" : "Mostra la barra lateral"} onClick={() => setShowSidebar((v) => !v)}>
              <PanelLeft className="size-4" />
            </ToolbarButton>
            {meeting && (
              <DropdownMenu>
                <DropdownMenuTrigger className="ml-1 flex items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[14px] font-semibold hover:bg-black/5 dark:hover:bg-white/10">
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
                    <span className="ml-auto pl-4 text-[11px] opacity-60">⌘⌫</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {coverAvailable && (
              <div role="radiogroup" aria-label="Vista" className="ml-1 flex shrink-0 rounded-[7px] bg-mm-segmented-track p-0.5">
                {[
                  { cover: true, label: "Portada" },
                  { cover: false, label: "Transcripció" },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    role="radio"
                    aria-checked={view.cover === o.cover}
                    onClick={() => setView({ cover: o.cover })}
                    className={cn(
                      "h-[22px] rounded-[5px] px-3 text-[12px]",
                      view.cover === o.cover ? "bg-mm-segmented-selected font-medium shadow-[0_1px_2px_rgb(0_0_0/0.15)]" : "text-muted-foreground",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
            <div data-tauri-drag-region className="flex-1" />

            {recording ? (
              <div className="flex h-[30px] items-center gap-2.5 rounded-[15px] bg-mm-recording-pill pl-3 pr-1.5 text-mm-on-recording-pill shadow-[0_0_0_1px_var(--mm-recording-pill-border)]">
                {/* Two level bars, half a cycle apart; they only move while there's sound. */}
                <span className="flex h-3.5 items-center gap-[3px]" aria-hidden>
                  {[0, 1].map((i) => (
                    <span
                      key={i}
                      className={cn("h-3.5 w-1 rounded-[2px] bg-mm-recording-level", level > 0.003 && "mm-bar", i === 1 && "mm-bar-2")}
                      style={level > 0.003 ? undefined : { transform: "scaleY(0.45)" }}
                    />
                  ))}
                </span>
                <span className="text-[13px] font-medium">Gravant</span>
                <span className="text-[13px] tabular-nums opacity-70" aria-label="Temps de gravació">
                  {clock(recording.duration)}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={stop}
                      disabled={busy}
                      aria-label="Atura la gravació"
                      className="grid size-[22px] place-items-center rounded-full bg-white/[0.14] hover:bg-white/25 disabled:opacity-40"
                    >
                      <span className="size-2 rounded-[2px] bg-current" />
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
                      <button
                        type="button"
                        className="inline-flex h-7 items-center gap-1.5 rounded-[7px] bg-mm-accent px-3 text-[13px] font-semibold text-mm-on-accent transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        Exporta <Share className="size-[13px]" strokeWidth={2} />
                      </button>
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
              <main className="min-w-0 flex-1">
                {state.loaded && (
                  <Welcome
                    onStart={start}
                    busy={busy}
                    missingModel={!transcriptionReady}
                    downloading={models.downloading.transcription}
                    onDownload={() => setOnboarding({ open: true, atModels: true })}
                  />
                )}
              </main>
            ) : showCover ? (
              <>
                <main className="min-w-0 flex-1">{renderCover()}</main>
                {showNotes &&
                  (notesPrimary ? (
                    <SidePanel width={notes.width} onResize={(width) => setNotes((n) => ({ ...n, width }))}>
                      {renderTranscript(true)}
                    </SidePanel>
                  ) : (
                    renderNotes("side")
                  ))}
              </>
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
      <SettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        settings={settings}
        onChange={updateSettings}
        recording={!!recording}
        meeting={meeting && meeting.status === "done" && meeting.utterances.length ? meeting : null}
      />
      <AboutDialog open={showAbout} onOpenChange={setShowAbout} />
      {onboarding.open && <Onboarding open onClose={closeOnboarding} onChange={updateSettings} startAtModels={onboarding.atModels} />}
      <Toaster position="bottom-center" />
    </TooltipProvider>
  );
}

function Welcome({
  onStart,
  busy,
  missingModel,
  downloading,
  onDownload,
}: {
  onStart: () => void;
  busy: boolean;
  missingModel: boolean;
  downloading?: { done: number; total: number };
  onDownload: () => void;
}) {
  if (missingModel) {
    const share = downloading ? downloading.done / (downloading.total || 1) : 0;
    return (
      <div className="grid h-full place-items-center">
        <div className="flex w-80 flex-col items-center text-center">
          <LogoIcon size={56} />
          <h1 className="mt-4 text-[22px] font-bold">{downloading ? "Descarregant el model" : "Falta el model de transcripció"}</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Murmur transcriu amb un model que funciona en aquest Mac. Només cal descarregar-lo un cop.
          </p>
          {downloading ? (
            <div className="mt-5 flex w-full items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-mm-separator">
                <div className="h-full rounded-[3px] bg-mm-toggle-on transition-[width] duration-300" style={{ width: `${share * 100}%` }} />
              </div>
              <span className="text-[12px] tabular-nums text-muted-foreground">{Math.floor(share * 100)} %</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={onDownload}
              className="mt-5 flex h-8 items-center gap-2 rounded-lg bg-mm-new-meeting px-3 text-[13px] font-semibold text-mm-on-new-meeting hover:opacity-90"
            >
              Descarrega el model
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="grid h-full place-items-center">
      <div className="flex max-w-sm flex-col items-center text-center">
        <LogoIcon size={56} />
        <h1 className="mt-4 text-[22px] font-bold">Cap reunió encara</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Grava una reunió i la transcripció apareixerà en directe, separada per parlants. Tot es processa en aquest Mac: local vol dir privat.
        </p>
        <button
          type="button"
          onClick={onStart}
          disabled={busy}
          className="mt-5 flex h-8 items-center gap-2 rounded-lg bg-mm-new-meeting px-3 text-[13px] font-semibold text-mm-on-new-meeting hover:opacity-90 disabled:opacity-40"
        >
          <Mic className="size-3.5" /> Comença a gravar
        </button>
        <p className="mt-3 text-[12px] text-text-secondary">Recorda demanar el consentiment dels participants.</p>
      </div>
    </div>
  );
}
