import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { join } from "@tauri-apps/api/path";
import { ask, open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Camera, ChevronDown, FileAudio, Copy, FileDown, FileText, FolderOpen, Images, Languages, Link2, Maximize2, Mic, PanelLeft, PanelRight, Share, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { AboutDialog } from "@/components/AboutDialog";
import { LogoIcon } from "@/components/Logo";
import { Onboarding } from "@/components/Onboarding";
import { Cover } from "@/components/Cover";
import { NotesPanel } from "@/components/NotesPanel";
import { SIDE_WIDTH, SidePanel } from "@/components/SidePanel";
import { PlayerBar } from "@/components/PlayerBar";
import { SettingsDialog, type Tab as SettingsTab } from "@/components/SettingsDialog";
import { ShareDialog } from "@/components/ShareDialog";
import { UpdatesDialog } from "@/components/UpdatesDialog";
import { WhatsNewDialog } from "@/components/WhatsNewDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sidebar } from "@/components/Sidebar";
import { MeetingTags, tagCounts } from "@/components/Tags";
import { Transcript } from "@/components/Transcript";
import { Toaster } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import * as backend from "@/lib/backend";
import { currentEvent, guestNames } from "@/lib/calendar";
import { clock, duration } from "@/lib/format";
import { exportMeeting, saveMarkdown, toMarkdown, type ExportFormat } from "@/lib/export";
import { defaultTitle } from "@/lib/cover";
import { locale, t as translate } from "@/lib/i18n";
import { cloudModelName, coverEngine, loadCloudModels, useCloud } from "@/lib/cloud";
import { downloadModel, modelInstalled, useModels } from "@/lib/models";
import { ensurePermissions } from "@/lib/permissions";
import { usePostProcess } from "@/lib/postprocess";
import { MarkdownSwitch, RoomMenu, StartOptions, type StartChoice } from "@/components/StartOptions";
import { hasAudio, playAt, stopUnless } from "@/lib/player";
import { stepTextZoom, useSettings } from "@/lib/settings";
import { activeShares, expired, revokeShare } from "@/lib/share";
import { notesDoc } from "@/lib/notes";
import { useMeetings } from "@/lib/store";
import { SYSTEM_SPEAKER_BASE, type Language, type Meeting, type ModelId, type SearchHit } from "@/lib/types";
import { cn } from "@/lib/utils";
import { markSeen, pendingReleases, releasesBetween, type WhatsNewRelease } from "@/lib/whatsnew";

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

function newMeeting(sources: { mic: boolean; system: boolean }, language: Language, title?: string, guests?: string[]): Meeting {
  const now = new Date();
  const time = now.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  return {
    id: crypto.randomUUID(),
    // Stored as is: in the interface language at the time it's created.
    title: title || defaultTitle(time),
    createdAt: now.getTime(),
    duration: 0,
    status: "recording",
    utterances: [],
    speakerNames: {},
    notes: [],
    sources,
    guests: guests?.length ? guests : undefined,
    language,
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
  const { t } = useTranslation("app");
  const [state, dispatch, forget] = useMeetings();
  const [settings, updateSettings] = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>();
  const [whatsNew, setWhatsNew] = useState<{ releases: WhatsNewRelease[]; manual: boolean; version: string } | null>(null);
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
  const cloud = useCloud();
  // The models' names, for the cover ("Generat amb Claude Opus 5.5").
  const cloudProvider = settings.coverEngine === "local" ? null : settings.coverEngine;
  const cloudConnected = !!cloudProvider && !!cloud.status[cloudProvider];
  useEffect(() => {
    if (cloudProvider && cloudConnected) loadCloudModels(cloudProvider);
  }, [cloudProvider, cloudConnected]);
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
    // After an update: what the new version brings (a new install has the welcome screens).
    getVersion()
      .then((version) => {
        const releases = pendingReleases(version, !onboarded);
        if (!releases.length) return;
        if (settings.showWhatsNew) setWhatsNew({ releases, manual: false, version });
        else markSeen(version);
      })
      .catch(() => {});
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
  /** "Desa en Markdown", chosen for each meeting while it records; written once it's done. */
  const [markdown, setMarkdown] = useState<Record<string, boolean>>({});
  const startedAt = useRef(0);

  const meeting = (state.selectedId && state.open[state.selectedId]) || null;
  const recording = Object.values(state.open).find((m) => m.status === "recording") ?? null;

  // The sidebar can show only the meetings with one tag. A new recording isn't tagged yet, so
  // starting one shows them all again.
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const allTags = useMemo(() => tagCounts(state.summaries), [state.summaries]);
  useEffect(() => {
    if (recording) setTagFilter(null);
  }, [recording?.id]);
  useEffect(() => {
    if (tagFilter && !allTags.some((x) => x.name === tagFilter)) setTagFilter(null);
  }, [allTags, tagFilter]);
  const renameTag = (from: string, to: string) => {
    if (backend.isTauri()) backend.renameTag(from, to).catch((e) => toast.error(String(e)));
    dispatch({ type: "renameTag", from, to });
    if (tagFilter === from) setTagFilter(allTags.find((x) => x.name.toLocaleLowerCase() === to.trim().toLocaleLowerCase() && x.name !== from)?.name ?? to.trim());
  };
  const deleteTag = async (name: string) => {
    const count = allTags.find((x) => x.name === name)?.count ?? 0;
    const message = t("tags:deleteMessage", { tag: name, count });
    const confirmed = backend.isTauri()
      ? await ask(message, { title: t("tags:deleteTitle"), kind: "warning", okLabel: t("common:delete"), cancelLabel: t("common:cancel") })
      : window.confirm(message);
    if (!confirmed) return;
    try {
      if (backend.isTauri()) await backend.deleteTag(name);
      dispatch({ type: "deleteTag", name });
    } catch (e) {
      toast.error(String(e));
    }
  };

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
      onFinalPass: (e) => post.rustStageStarted(e.meetingId, e.stage, e.estimateSeconds),
      onFinalPassSpeakers: (e) => {
        dispatch({ type: "speakersVerified", id: e.meetingId, base: e.base, assignments: e.assignments });
        // The module-level t: this listener outlives a language change.
        toast(translate("app:speakersVerified"));
      },
      onFinalPassText: (e) => dispatch({ type: "retranscribed", id: e.meetingId, base: e.base, texts: e.texts }),
      onFinalPassDone: (e) => {
        if (e.error) toast.error(e.error);
        post.rustDone(e.meetingId);
      },
    });
    return () => void unlisten.then((u) => u());
  }, [dispatch, post.rustStageStarted, post.rustDone]);

  // "Configuració…" and "Quant a Murmur" in the app menu; start/stop from the menu bar or an alert.
  const stopRef = useRef<() => void>(() => {});
  // A screenshot of the call (indicator or compact mode), stored with the meeting being recorded.
  const captureRef = useRef<() => void>(() => {});
  captureRef.current = async () => {
    if (!recording) return;
    const t = recording.duration;
    try {
      const path = await backend.captureScreen(recording.id, t);
      dispatch({ type: "screen", id: recording.id, screen: { t, path } });
    } catch (e) {
      toast.error(String(e));
    }
  };
  useEffect(() => {
    if (!backend.isTauri()) return;
    const unlisten = [
      backend.onOpenSettings(() => setShowSettings(true)),
      backend.onOpenAbout(() => setShowAbout(true)),
      backend.onRecordRequest((start, choice) => (start ? startRef.current(choice) : stopRef.current())),
      backend.onCaptureRequest(() => captureRef.current()),
      backend.onPostPaused((busy) => dispatch({ type: "postPaused", reason: busy.recording ? "recording" : busy.call ? "call" : null })),
    ];
    return () => unlisten.forEach((u) => void u.then((f) => f()));
  }, []);

  useEffect(() => {
    if (backend.isTauri()) backend.setMeetingDetection(settings.detectMeetings).catch(() => {});
  }, [settings.detectMeetings]);

  useEffect(() => {
    if (backend.isTauri()) backend.setIndicator(settings.recordingIndicator, settings.compactNotes).catch(() => {});
  }, [settings.recordingIndicator, settings.compactNotes]);

  // Compact mode (from the indicator): only the notes, until the user leaves it or stops.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (!backend.isTauri()) return;
    const unlisten = backend.onCompact(setCompact);
    return () => void unlisten.then((u) => u());
  }, []);

  useEffect(() => {
    if (!backend.isTauri()) return;
    backend
      .setCalendarWatch({ enabled: settings.calendarEnabled && settings.calendarAlerts, calendarIds: settings.calendarIds, includeNoGuests: settings.calendarNoGuests })
      .catch(() => {});
  }, [settings.calendarEnabled, settings.calendarAlerts, settings.calendarIds, settings.calendarNoGuests]);

  // Load the live models ahead of time (once they're on disk) so recording starts at once.
  const liveModel: ModelId = settings.language === "en" ? "english" : "transcription";
  const liveModelReady = !!models.status[liveModel]?.installed;
  const englishReady = !!models.status.english?.installed;
  const startChoice: StartChoice = { language: settings.language, roomSpeakers: settings.roomSpeakers };
  useEffect(() => {
    if (backend.isTauri() && models.status.transcription?.installed && liveModelReady)
      backend.prepare(settings.language).catch((e) => toast.error(String(e)));
  }, [models.status.transcription?.installed, liveModelReady, settings.language]);

  // ⌘N: new meeting (the sidebar button shows the shortcut).
  const startRef = useRef<(choice?: Partial<StartChoice>) => void>(() => {});
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

  // ⌘+ / ⌘− / ⌘0: the reading text's size. The View menu has them too; with a keyboard where
  // "+" isn't on the "=" key, the menu doesn't catch it and it arrives here.
  // The size it's going to, ahead of the render: a held key repeats faster than the settings update.
  const textZoom = useRef(settings.textZoom);
  const textZoomRef = useRef((_direction: -1 | 0 | 1) => {});
  textZoomRef.current = (direction) => {
    textZoom.current = stepTextZoom(textZoom.current, direction);
    updateSettings({ textZoom: textZoom.current });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey) return;
      const direction = e.key === "+" || e.key === "=" ? 1 : e.key === "-" ? -1 : e.key === "0" ? 0 : null;
      if (direction === null) return;
      e.preventDefault();
      textZoomRef.current(direction);
    };
    window.addEventListener("keydown", onKey);
    const off = backend.isTauri() ? backend.onTextZoom((direction) => textZoomRef.current(direction)) : null;
    return () => {
      window.removeEventListener("keydown", onKey);
      off?.then((f) => f());
    };
  }, []);
  useEffect(() => {
    textZoom.current = settings.textZoom;
    document.documentElement.style.setProperty("--mm-reading-zoom", String(settings.textZoom));
  }, [settings.textZoom]);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => dispatch({ type: "tick", duration: (Date.now() - startedAt.current) / 1000 }), 500);
    return () => clearInterval(id);
  }, [recording, dispatch]);

  /** `choice`: language and people in the room picked right before starting (StartOptions); it becomes the default. */
  const start = useCallback(async (choice?: Partial<StartChoice>) => {
    const language = choice?.language ?? settings.language;
    const roomSpeakers = choice?.roomSpeakers ?? settings.roomSpeakers;
    if (choice) updateSettings(choice);
    if (!backend.isTauri()) {
      toast.error(t("openAsApp"));
      return;
    }
    if (!transcriptionReady) {
      setOnboarding({ open: true, atModels: true });
      return;
    }
    if (!models.status[language === "en" ? "english" : "transcription"]?.installed) {
      toast.error(t("englishModelMissing"), { action: { label: t("settings"), onClick: () => setShowSettings(true) } });
      return;
    }
    setBusy(true);
    // Ask for the microphone and system audio like other apps do; record what's allowed.
    const sources = await ensurePermissions({ mic: settings.mic, system: settings.system }).catch(() => ({ mic: settings.mic, system: settings.system }));
    if (!sources) {
      setBusy(false);
      return;
    }
    // Named after the calendar event going on now, if there's one.
    const event = await currentEvent(settings).catch(() => null);
    const m = newMeeting(sources, language, event?.title.trim(), event ? guestNames(event) : undefined);
    dispatch({ type: "new", meeting: m });
    setMarkdown((list) => ({ ...list, [m.id]: settings.saveMarkdown && !!settings.markdownDir }));
    // Whisper only for a single language (told "Catalan", it would turn Spanish into Catalan).
    const finalText = language !== "ca-es" && modelInstalled("whisper");
    post.planRecording(m.id, { verifySpeakers: settings.verifySpeakers, finalText, language });
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
        roomSpeakers,
        language,
        finalText,
      });
      if (path) dispatch({ type: "audio", id: m.id, path });
    } catch (e) {
      dispatch({ type: "stopped" });
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }, [dispatch, settings, updateSettings, post.planRecording, transcriptionReady, models.status, t]);
  startRef.current = (choice) => {
    if (!recording && !busy) start(choice);
  };

  /** The switch beside the recording pill. The first time, it asks for the folder; the choice is
   * also the default for the next meetings. */
  const toggleMarkdown = async (id: string, on: boolean) => {
    if (on && !settings.markdownDir) {
      const dir = await openDialog({ directory: true, title: t("settings:transcription.markdownFolderDialog") });
      if (typeof dir !== "string") return;
      updateSettings({ markdownDir: dir });
    }
    updateSettings({ saveMarkdown: on });
    setMarkdown((list) => ({ ...list, [id]: on }));
  };

  // A meeting with the switch on is written once it's done: after the final pass and the summary.
  useEffect(() => {
    const dir = settings.markdownDir;
    for (const [id, on] of Object.entries(markdown)) {
      const m = state.open[id];
      if (!on || !m || m.status !== "done" || state.finalPass[id]) continue;
      setMarkdown(({ [id]: _done, ...rest }) => rest);
      if (!dir || !m.utterances.length) continue;
      saveMarkdown(m, dir)
        .then((path) => toast(t("markdownSaved"), { action: { label: t("showInFinder"), onClick: () => revealItemInDir(path).catch(() => {}) } }))
        .catch((e) => toast.error(t("markdownFailed", { error: String(e) })));
    }
  }, [markdown, state.open, state.finalPass, settings.markdownDir, t]);

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
      .then((done) => done && toast(t("exported")))
      .catch((e) => toast.error(String(e)));

  const copyMarkdown = (m: Meeting) =>
    navigator.clipboard.writeText(toMarkdown(m)).then(() => toast(t("copiedMarkdown")));

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
      ? t("deleteMessageWithAudio", { title: m.title })
      : t("deleteMessage", { title: m.title });
    const confirmed = backend.isTauri()
      ? await ask(message, { title: t("deleteTitle"), kind: "warning", okLabel: t("common:delete"), cancelLabel: t("common:cancel") })
      : window.confirm(message);
    if (!confirmed) return;
    // Its shared links stop working too (best effort: offline, they expire on their own).
    for (const link of m.shares ?? []) if (!expired(link)) revokeShare(link.id).catch(() => {});
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
  const engine = coverEngine(settings);
  const coverBlocked = (engine ? !cloud.status[engine.provider] : !models.status.llm?.installed)
    ? t(engine ? "coverNeedsKey" : "coverNeedsModel")
    : recording
      ? t("coverAfterRecording")
      : meeting?.status === "processing"
        ? t("coverAfterProcessing")
        : null;
  /**
   * "PDF o envia…": macOS's print panel has Save as PDF and sharing (Mail, Messages). Paper is
   * light, so the page switches to light mode until the user is back in the window.
   */
  const printCover = async () => {
    const html = document.documentElement;
    const previous = { mode: html.dataset.mode, dark: html.classList.contains("dark") };
    html.dataset.mode = "light";
    html.classList.remove("dark");
    const restore = () => {
      if (previous.mode) html.dataset.mode = previous.mode;
      html.classList.toggle("dark", previous.dark);
    };
    await new Promise((r) => requestAnimationFrame(r));
    if (!backend.isTauri()) {
      window.print();
      restore();
      return;
    }
    try {
      await backend.printPage();
    } catch (e) {
      toast.error(String(e));
      restore();
      return;
    }
    // The panel is a sheet: the page gets no events until it's closed.
    const back = () => {
      restore();
      window.removeEventListener("pointermove", back);
      window.removeEventListener("keydown", back);
    };
    window.addEventListener("pointermove", back);
    window.addEventListener("keydown", back);
  };
  /** A minute on the cover: to that point of the transcript, and the audio plays from there. */
  const jumpTo = (t: number) => {
    if (!meeting) return;
    setView({ cover: false });
    dispatch({ type: "jump", meetingId: meeting.id, t });
    if (hasAudio(meeting)) void playAt(meeting, t);
  };
  /** "Exporta l'àudio…": an .m4a anyone can play. */
  const exportAudio = async (m: Meeting) => {
    if (!m.audioPath) return;
    const dest = await save({ title: t("exportAudioTitle"), defaultPath: `${m.title.replace(/[/:]/g, "-")}.m4a`, filters: [{ name: t("audioFilter"), extensions: ["m4a"] }] });
    if (!dest) return;
    try {
      await backend.exportAudio(m.id, m.audioPath, dest);
      toast(t("audioExported"));
    } catch (e) {
      toast.error(String(e));
    }
  };
  /**
   * "Torna a transcriure en…": recorded in the wrong language, Whisper listens to the saved audio
   * again in the right one, line by line (speakers and times stay). Then the cover, if it's on.
   */
  const retranscribe = async (m: Meeting, language: Language) => {
    if (!m.audioPath) return;
    if (!modelInstalled("whisper")) {
      toast(t("retranscribeNeedsWhisper"), { action: { label: t("settings:model.download"), onClick: () => downloadModel("whisper") } });
      return;
    }
    const name = t(`settings:transcription.languages.${language}`);
    const speech = m.utterances.reduce((n, u) => n + Math.max(0, u.end - u.start), 0);
    const message = t("retranscribeMessage", { language: name, minutes: Math.max(1, Math.round((speech * 0.15) / 60)) });
    const confirmed = backend.isTauri()
      ? await ask(message, { title: t("retranscribeTitle", { language: name }), okLabel: t("retranscribeOk"), cancelLabel: t("common:cancel") })
      : window.confirm(message);
    if (!confirmed) return;
    const channels = [0, SYSTEM_SPEAKER_BASE]
      .map((base) => ({
        base,
        spans: m.utterances.filter((u) => (u.speaker >= SYSTEM_SPEAKER_BASE) === (base >= SYSTEM_SPEAKER_BASE)).map((u) => [u.start, u.end] as [number, number]),
      }))
      .filter((c) => c.spans.length);
    post.planRetranscribe(m.id, language);
    dispatch({ type: "language", id: m.id, language });
    try {
      await backend.retranscribeMeeting(m.id, m.audioPath, language, channels);
    } catch (e) {
      toast.error(String(e));
      dispatch({ type: "postDone", id: m.id });
    }
  };
  /** "Exporta les captures…": every screenshot, in a new folder named after the meeting, in time order. */
  const exportScreens = async (m: Meeting) => {
    const screens = [...(m.screens ?? [])].sort((a, b) => a.t - b.t);
    if (!screens.length) return;
    const dir = await openDialog({ title: t("exportScreensTitle"), directory: true, canCreateDirectories: true });
    if (typeof dir !== "string") return;
    const safe = (name: string) => name.replace(/[/\\:]/g, "-").replace(/^\.+/, "").trim();
    const dest = await join(dir, safe(t("screensFolder", { title: m.title })));
    const width = String(screens.length).length;
    const names = screens.map((sc, i) => {
      const ext = sc.path.split(".").pop() ?? "png";
      const time = clock(sc.t).replace(/:/g, ".");
      return safe(t("screenFile", { n: String(i + 1).padStart(Math.max(2, width), "0"), time })) + "." + ext;
    });
    try {
      await backend.exportScreens(m.id, screens.map((sc) => sc.path), names, dest);
      toast(t("screensExported", { count: screens.length }), { action: { label: t("showInFinder"), onClick: () => revealItemInDir(dest).catch(() => {}) } });
    } catch (e) {
      toast.error(String(e));
    }
  };
  const tagsOf = (m: Meeting, className: string) => (
    <MeetingTags
      tags={m.tags ?? []}
      all={allTags}
      onChange={(tags) => dispatch({ type: "tags", id: m.id, tags })}
      onOpen={(tag) => {
        setTagFilter(tag);
        setShowSidebar(true);
      }}
      className={className}
    />
  );
  const renderCover = () =>
    meeting && (
      <Cover
        meeting={meeting}
        run={run}
        blocked={coverBlocked}
        writer={engine ? cloudModelName(engine) : null}
        onGenerate={() => post.generateCover(meeting.id)}
        onJump={jumpTo}
        onShowTranscript={() => setView({ cover: false })}
        onTitle={(title) => dispatch({ type: "title", id: meeting.id, title })}
        onTasks={(tasks) => dispatch({ type: "coverTasks", id: meeting.id, tasks })}
        onPrint={printCover}
        tags={tagsOf(meeting, "mt-2")}
      />
    );
  const renderTranscript = (compact: boolean) =>
    meeting && (
      <Transcript
        meeting={meeting}
        compact={compact}
        jump={state.jump?.meetingId === meeting.id ? state.jump : null}
        finalPass={state.finalPass[meeting.id] ?? null}
        postPause={state.postPause}
        partial={meeting.status === "recording" ? state.partial : { mic: "", system: "" }}
        hoveredNote={hoveredNote}
        onHoverNote={setHoveredNote}
        onTitle={(title) => dispatch({ type: "title", id: meeting.id, title })}
        onReassign={(utteranceId, speaker, version) => dispatch({ type: "reassign", id: meeting.id, utteranceId, speaker, version })}
        onRename={(speaker, name, version) => dispatch({ type: "rename", id: meeting.id, speaker, name, version })}
        onEdit={(utteranceId, text) => dispatch({ type: "edit", id: meeting.id, utteranceId, text })}
        tags={showCover ? undefined : tagsOf(meeting, "mt-2.5")}
        onRemoveScreen={(s) =>
          backend
            .deleteScreen(s.path)
            .catch(() => {})
            .finally(() => dispatch({ type: "removeScreen", id: meeting.id, path: s.path }))
        }
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

  // The player follows the open meeting: opening another one stops it.
  useEffect(() => stopUnless(state.selectedId), [state.selectedId]);

  // Updates: once when Murmur opens (after the first-run screens), and from the settings.
  const [updates, setUpdates] = useState({ run: 0, manual: false });
  const checkedOnOpen = useRef(false);
  useEffect(() => {
    if (checkedOnOpen.current || !state.loaded || onboarding.open || !transcriptionReady || !settings.checkUpdates) return;
    checkedOnOpen.current = true;
    setUpdates({ run: 1, manual: false });
  }, [state.loaded, onboarding.open, transcriptionReady, settings.checkUpdates]);

  // Recording stopped: back to the full window, where the cover and processing show.
  useEffect(() => {
    if (compact && !recording) backend.setCompact(false).catch(() => {});
  }, [compact, recording]);

  if (compact && meeting) {
    const last = meeting.utterances.at(-1);
    const live = state.partial.system || state.partial.mic;
    return (
      <TooltipProvider delayDuration={600}>
        <div className="flex h-screen flex-col overflow-hidden bg-background">
          <header data-tauri-drag-region className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border pl-[84px] pr-2">
            <span data-tauri-drag-region className="min-w-0 flex-1 truncate text-[13px] font-semibold">
              {meeting.title}
            </span>
            {recording && (
              <>
                <span className="text-[12px] tabular-nums text-muted-foreground" aria-label={t("recordingTime")}>
                  {clock(recording.duration)}
                </span>
                <ToolbarButton label={t("captureScreen")} onClick={() => captureRef.current()}>
                  <Camera className="size-4" />
                </ToolbarButton>
                <ToolbarButton label={t("stopRecording")} onClick={stop}>
                  <span className="size-2.5 rounded-[2px] bg-mm-recording-dot" />
                </ToolbarButton>
              </>
            )}
            <ToolbarButton label={t("exitCompact")} onClick={() => backend.setCompact(false).catch(() => {})}>
              <Maximize2 className="size-4" />
            </ToolbarButton>
          </header>
          <div className="min-h-0 flex-1">{renderNotes("full")}</div>
          {(live || last) && (
            <p className="line-clamp-2 shrink-0 border-t border-border px-4 py-2 text-[12px] leading-snug text-muted-foreground" aria-live="off">
              {live || last?.text}
            </p>
          )}
        </div>
        <Toaster position="bottom-center" />
      </TooltipProvider>
    );
  }

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
            onNew={() => start()}
            startChoice={startChoice}
            onStartChoice={updateSettings}
            englishReady={englishReady}
            onSettings={() => setShowSettings(true)}
            onDelete={removeById}
            tagFilter={tagFilter}
            onTagFilter={setTagFilter}
            onRenameTag={renameTag}
            onDeleteTag={deleteTag}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header data-tauri-drag-region className={cn("flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3", !showSidebar && "pl-[84px]")}>
            <ToolbarButton label={showSidebar ? t("hideSidebar") : t("showSidebar")} onClick={() => setShowSidebar((v) => !v)}>
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
                    <Copy className="size-3.5" /> {t("copyMarkdown")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!meeting.audioPath}
                    onSelect={() => meeting.audioPath && revealItemInDir(meeting.audioPath).catch((e) => toast.error(String(e)))}
                  >
                    <FolderOpen className="size-3.5" /> {meeting.audioPath ? t("showAudioInFinder") : t("audioNotSaved")}
                  </DropdownMenuItem>
                  {hasAudio(meeting) && (
                    <DropdownMenuItem onSelect={() => exportAudio(meeting)}>
                      <FileAudio className="size-3.5" /> {t("exportAudio")}
                    </DropdownMenuItem>
                  )}
                  {meeting.audioPath && meeting.utterances.length > 0 && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger disabled={meeting.status !== "done" || !!state.finalPass[meeting.id]}>
                        <Languages className="size-3.5" /> {t("retranscribe")}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="min-w-48">
                        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">{t("retranscribeLabel")}</DropdownMenuLabel>
                        {(["ca", "es", "en"] as const).map((l) => (
                          <DropdownMenuItem key={l} disabled={meeting.language === l} onSelect={() => retranscribe(meeting, l)}>
                            {t(`settings:transcription.languages.${l}`)}
                            {meeting.language === l && <span className="ml-auto pl-4 text-[11px] opacity-60">{t("currentLanguage")}</span>}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" disabled={meeting.status === "recording"} onSelect={() => remove(meeting)}>
                    <Trash2 className="size-3.5" /> {t("deleteMeeting")}
                    <span className="ml-auto pl-4 text-[11px] opacity-60">⌘⌫</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {coverAvailable && (
              <div role="radiogroup" aria-label={t("view")} className="ml-1 flex shrink-0 rounded-[7px] bg-mm-segmented-track p-0.5">
                {[
                  { cover: true, label: t("viewCover") },
                  { cover: false, label: notesPrimary ? t("viewNotes") : t("viewTranscript") },
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

            {recording && <MarkdownSwitch value={!!markdown[recording.id]} onChange={(on) => toggleMarkdown(recording.id, on)} className="mr-1" />}
            {recording?.sources?.mic && recording.sources.system && (
              <RoomMenu
                value={settings.roomSpeakers}
                onChange={(roomSpeakers) => {
                  updateSettings({ roomSpeakers });
                  backend.setRoomSpeakers(roomSpeakers).catch((e) => toast.error(String(e)));
                }}
                className="mr-1"
              />
            )}
            {recording ? (
              <div className="flex h-[30px] items-center gap-2.5 rounded-[15px] bg-mm-recording-pill pl-3 pr-[3px] text-mm-on-recording-pill shadow-[0_0_0_1px_var(--mm-recording-pill-border)]">
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
                <span className="text-[13px] font-medium">{t("recording")}</span>
                <span className="text-[13px] tabular-nums opacity-70" aria-label={t("recordingTime")}>
                  {clock(recording.duration)}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={stop}
                      disabled={busy}
                      aria-label={t("stopRecording")}
                      className="grid size-6 place-items-center rounded-full bg-white/20 hover:bg-white/30 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current disabled:opacity-40"
                    >
                      <span className="size-2.5 rounded-[2px] bg-current" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t("stop")}</TooltipContent>
                </Tooltip>
              </div>
            ) : (
              meeting && (
                <>
                  <span className="text-[13px] text-text-secondary">{t("durationValue", { duration: duration(meeting.duration) })}</span>
                  {activeShares(meeting).length > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setShowShare(true)}
                          className="inline-flex h-7 items-center gap-1.5 rounded-[7px] border border-border px-2.5 text-[13px] hover:bg-mm-fill-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          <Link2 className="size-[13px]" /> {t("share:shared")}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t("share:sharedHint", { count: activeShares(meeting).length })}</TooltipContent>
                    </Tooltip>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-7 items-center gap-1.5 rounded-[7px] bg-mm-accent px-3 text-[13px] font-semibold text-mm-on-accent transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {t("export")} <Share className="size-[13px]" strokeWidth={2} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-52">
                      <DropdownMenuItem onSelect={() => setShowShare(true)}>
                        <Link2 className="size-3.5" /> {t("share:menu")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => doExport(meeting, "docx")}>
                        <FileDown className="size-3.5" /> {t("exportDocx")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => doExport(meeting, "md")}>
                        <FileText className="size-3.5" /> {t("exportMarkdown")}
                      </DropdownMenuItem>
                      {!!meeting.screens?.length && (
                        <DropdownMenuItem onSelect={() => exportScreens(meeting)}>
                          <Images className="size-3.5" /> {t("exportScreens", { count: meeting.screens.length })}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => copyMarkdown(meeting)}>
                        <Copy className="size-3.5" /> {t("copyMarkdown")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )
            )}
            {meeting && (
              <ToolbarButton label={notesPrimary ? (showNotes ? t("hideTranscript") : t("showTranscript")) : showNotes ? t("hideNotes") : t("showNotes")} onClick={() => setNotes((n) => ({ ...n, visible: !n.visible }))} active={showNotes}>
                <PanelRight className="size-4" />
              </ToolbarButton>
            )}
          </header>

          <div className="flex min-h-0 flex-1">
            {!meeting ? (
              <main className="min-w-0 flex-1">
                {state.loaded && (
                  <Welcome
                    onStart={() => start()}
                    startChoice={startChoice}
                    onStartChoice={updateSettings}
                    englishReady={englishReady}
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
          {meeting && hasAudio(meeting) && <PlayerBar meeting={meeting} />}
        </div>
      </div>
      <SettingsDialog
        open={showSettings}
        onOpenChange={(open) => {
          setShowSettings(open);
          if (!open) setSettingsTab(undefined);
        }}
        settings={settings}
        onChange={updateSettings}
        recording={!!recording}
        onCheckUpdates={() => {
          setShowSettings(false);
          setUpdates((u) => ({ run: u.run + 1, manual: true }));
        }}
        onShowWhatsNew={() => {
          getVersion()
            .then((version) => {
              const releases = releasesBetween(null, version);
              if (!releases.length) return;
              setShowSettings(false);
              setWhatsNew({ releases, manual: true, version });
            })
            .catch(() => {});
        }}
        initialTab={settingsTab}
        meeting={meeting && meeting.status === "done" && meeting.utterances.length ? meeting : null}
      />
      {meeting && (
        <ShareDialog
          meeting={meeting}
          open={showShare}
          onOpenChange={setShowShare}
          settings={settings}
          onChange={updateSettings}
          onShares={(shares) => dispatch({ type: "shares", id: meeting.id, shares })}
          onSetUp={() => {
            setShowShare(false);
            setSettingsTab("share");
            setShowSettings(true);
          }}
        />
      )}
      <AboutDialog open={showAbout} onOpenChange={setShowAbout} />
      {whatsNew && !onboarding.open && (
        <WhatsNewDialog
          releases={whatsNew.releases}
          manual={whatsNew.manual}
          onLink={(tab) => {
            markSeen(whatsNew.version);
            setWhatsNew(null);
            setSettingsTab(tab);
            setShowSettings(true);
          }}
          onClose={(dontShowAgain) => {
            markSeen(whatsNew.version);
            if (dontShowAgain) updateSettings({ showWhatsNew: false });
            setWhatsNew(null);
          }}
        />
      )}
      {!recording && <UpdatesDialog run={updates.run} manual={updates.manual} onClose={() => {}} />}
      {onboarding.open && <Onboarding open onClose={closeOnboarding} onChange={updateSettings} startAtModels={onboarding.atModels} />}
      <Toaster position="bottom-center" />
    </TooltipProvider>
  );
}

function Welcome({
  onStart,
  startChoice,
  onStartChoice,
  englishReady,
  busy,
  missingModel,
  downloading,
  onDownload,
}: {
  onStart: () => void;
  startChoice: StartChoice;
  onStartChoice: (change: Partial<StartChoice>) => void;
  englishReady: boolean;
  busy: boolean;
  missingModel: boolean;
  downloading?: { done: number; total: number };
  onDownload: () => void;
}) {
  const { t } = useTranslation("app");
  if (missingModel) {
    const share = downloading ? downloading.done / (downloading.total || 1) : 0;
    return (
      <div className="grid h-full place-items-center">
        <div className="flex w-80 flex-col items-center text-center">
          <LogoIcon size={56} />
          <h1 className="mt-4 text-[22px] font-bold">{downloading ? t("downloadingModel") : t("missingModel")}</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {t("missingModelBody")}
          </p>
          {downloading ? (
            <div className="mt-5 flex w-full items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-mm-separator">
                <div className="h-full rounded-[3px] bg-mm-toggle-on transition-[width] duration-300" style={{ width: `${share * 100}%` }} />
              </div>
              <span className="text-[12px] tabular-nums text-muted-foreground">{t("progress", { percent: Math.floor(share * 100) })}</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={onDownload}
              className="mt-5 flex h-8 items-center gap-2 rounded-lg bg-mm-new-meeting px-3 text-[13px] font-semibold text-mm-on-new-meeting hover:opacity-90"
            >
              {t("downloadModel")}
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
        <h1 className="mt-4 text-[22px] font-bold">{t("emptyTitle")}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {t("emptyBody")}
        </p>
        <button
          type="button"
          onClick={onStart}
          disabled={busy}
          className="mt-5 flex h-8 items-center gap-2 rounded-lg bg-mm-new-meeting px-3 text-[13px] font-semibold text-mm-on-new-meeting hover:opacity-90 disabled:opacity-40"
        >
          <Mic className="size-3.5" /> {t("startRecording")}
        </button>
        <StartOptions value={startChoice} onChange={onStartChoice} englishReady={englishReady} className="mt-2" />
        <p className="mt-3 text-[12px] text-text-secondary">{t("consentReminder")}</p>
      </div>
    </div>
  );
}
