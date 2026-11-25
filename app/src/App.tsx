import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { join } from "@tauri-apps/api/path";
import { ask, open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { Camera, Captions, Copy, FileAudio, MoreHorizontal, FileDown, FileText, FolderOpen, Gem, Globe, NotebookText, Images, Languages, Link2, ListChecks, Sparkles, Maximize2, Mic, PanelLeft, PanelRight, Share, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { AboutDialog } from "@/components/AboutDialog";
import { LogoIcon } from "@/components/Logo";
import { Onboarding } from "@/components/Onboarding";
import { Cover } from "@/components/Cover";
import { DropOverlay } from "@/components/DropOverlay";
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
  DropdownMenuCheckboxItem,
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
import { currentEvent, guestNames, systemCalendarOn, useCalendarSync } from "@/lib/calendar";
import { clock, duration, speakerIds, speakerName } from "@/lib/format";
import { exportMeeting, saveMarkdown, toMarkdown, type ExportContent, type ExportFormat } from "@/lib/export";
import { defaultTitle } from "@/lib/cover";
import { locale, t as translate } from "@/lib/i18n";
import { cloudModelName, coverEngine, coverReady, loadCloudModels, useCloud } from "@/lib/cloud";
import { translateMeeting, useTranslating } from "@/lib/translate";
import { offerGlossary } from "@/lib/glossary";
import { bytes, downloadModel, modelInstalled, useModels } from "@/lib/models";
import { ensurePermissions } from "@/lib/permissions";
import { usePostProcess, type AfterStep } from "@/lib/postprocess";
import { AfterCard, AFTER_COUNTDOWN_MS } from "@/components/AfterCard";
import { MarkdownSwitch, RoomMenu, StartOptions, type StartChoice } from "@/components/StartOptions";
import { countBucket, minutesBucket, setAnalyticsAllowed, track } from "@/lib/analytics";
import { introducedName, matchName } from "@/lib/intro";
import { reveal } from "@/lib/reveal";
import { finalModels, finalPassModel, finalPassRtf } from "@/lib/finalpass";
import { CONTINUE_MS } from "@/lib/parts";
import { hasAudio, playAt, release, stopUnless } from "@/lib/player";
import { afterSteps, rememberSteps, stepTextZoom, useSettings, type AfterSteps } from "@/lib/settings";
import { activeShares, expired, revokeShare } from "@/lib/share";
import { notesDoc } from "@/lib/notes";
import { capabilities, hasMod, isMac, shortcut } from "@/lib/platform";
import { useMeetings } from "@/lib/store";
import { SYSTEM_SPEAKER_BASE, type Language, type Meeting, type ModelId, type PostStage, type SearchHit, type Utterance } from "@/lib/types";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/clipboard";
import { MarkerBackground, useMarker } from "@/lib/motion";
import { openInObsidian, saveToObsidian } from "@/lib/obsidian";
import { saveToNotion } from "@/lib/notion";
import { exportSubtitles, rememberSource, type SubtitleFormat } from "@/lib/subtitles";
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

/** The choices in Export › Word / Markdown, for a meeting with a cover. */
const EXPORT_CONTENTS: ExportContent[] = ["all", "summary", "transcript"];

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
  // Portada / Transcripció: the white thumb slides (lib/motion.tsx).
  const viewTrack = useRef<HTMLDivElement>(null);
  const models = useModels();
  const cloud = useCloud();
  const calendarSync = useCalendarSync();
  // Obsidian (lib/obsidian.ts): shown in Exporta if it's installed or a vault was chosen.
  const [hasObsidian, setHasObsidian] = useState(false);
  useEffect(() => {
    if (backend.isTauri()) backend.obsidianVaults().then((v) => setHasObsidian(v.length > 0)).catch(() => {});
  }, []);
  /** Meetings made in this session (recorded, continued, from the phone) that go to the vault when done. */
  const obsidianPending = useRef(new Set<string>());
  /** Likewise for Notion. */
  const notionPending = useRef(new Set<string>());
  const openCalendarSettings = () => {
    setSettingsTab("calendar");
    setShowSettings(true);
  };
  const openMobileSettings = () => {
    setSettingsTab("mobile");
    setShowSettings(true);
  };
  // The calendar sync went on with the settings closed: say how it ended.
  const wasSyncing = useRef(false);
  useEffect(() => {
    if (wasSyncing.current && !calendarSync.syncing && !showSettings) {
      const count = calendarSync.calendars?.length ?? 0;
      const open = { label: t("settings"), onClick: () => openCalendarSettings() };
      if (count) toast(t("calendarSynced", { count }), { action: open });
      else toast(t("calendarSyncEmpty"), { action: open });
    }
    wasSyncing.current = calendarSync.syncing;
  }, [calendarSync.syncing]);
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
  /** A recording is starting (not stopping or importing): the new-meeting button's dot pulses. */
  const [starting, setStarting] = useState(false);
  /** "Desa en Markdown", chosen for each meeting while it records; written once it's done. */
  const [markdown, setMarkdown] = useState<Record<string, boolean>>({});
  const startedAt = useRef(0);
  /** Meeting time the recording started at: 0, or where a meeting that goes on picked up. */
  const startOffset = useRef(0);
  /** A meeting made from an audio file (File › Open Audio…) while it goes through the engine. */
  const [importing, setImporting] = useState<{ id: string; done: number; total: number } | null>(null);
  const importingRef = useRef(importing);
  importingRef.current = importing;

  const meeting = (state.selectedId && state.open[state.selectedId]) || null;
  const recording = Object.values(state.open).find((m) => m.status === "recording") ?? null;
  // For the engine's listeners, set up once.
  const recordingRef = useRef(recording);
  recordingRef.current = recording;

  // "Murmur, sóc la Marta" (lib/intro.ts): the speaker of that line gets the name. The ones heard,
  // by meeting, apply again after the final pass, so the name follows the person.
  const intros = useRef(new Map<string, { utteranceId: string; name: string }[]>());
  const glossaryTerms = useRef<string[]>([]);
  const introduceRef = useRef<(u: Utterance) => void>(() => {});
  introduceRef.current = (u) => {
    const heard = introducedName(u.text);
    const m = recordingRef.current;
    if (!heard || !m) return;
    const name = matchName(heard, [...(m.guests ?? []), ...Object.values(m.speakerNames), ...glossaryTerms.current]);
    const before = speakerName(m, u.speaker);
    intros.current.set(m.id, [...(intros.current.get(m.id) ?? []), { utteranceId: u.id, name }]);
    dispatch({ type: "introduce", id: m.id, utteranceId: u.id, name });
    track("speaker_introduced", { guest: (m.guests ?? []).includes(name) });
    if (before === name) return;
    // Another speaker with that name: the two are joined, which can't be undone from here.
    const joined = speakerIds(m).some((id) => id !== u.speaker && speakerName(m, id).toLocaleLowerCase() === name.toLocaleLowerCase());
    const undo = () => dispatch({ type: "rename", id: m.id, speaker: u.speaker, name: m.speakerNames[u.speaker] ?? "", version: m.speakersVersion ?? 0 });
    toast(t("introNamed", { speaker: before, name }), joined ? undefined : { action: { label: t("undo"), onClick: undo } });
  };
  /** The meeting stopped last and when: "Continua" stays on its toolbar for a while (CONTINUE_MS). */
  const [stoppedAt, setStoppedAt] = useState<{ id: string; at: number } | null>(null);
  /**
   * "Què en faig ara?" (AfterCard): the steps of a meeting that just ended, or of one opened again
   * from the menu (`later`). `deadline`: when it starts by itself; null once touched.
   */
  const [after, setAfter] = useState<{
    id: string;
    steps: AfterStep[];
    chosen: Set<PostStage>;
    deadline: number | null;
    file: boolean;
    later?: boolean;
    done?: Set<PostStage>;
  } | null>(null);
  /** Stopped from the indicator with Murmur behind: the steps run as last time, without asking. */
  const runUnasked = useRef(new Set<string>());
  useEffect(() => {
    if (!stoppedAt) return;
    const timer = setTimeout(() => setStoppedAt(null), stoppedAt.at + CONTINUE_MS - Date.now());
    return () => clearTimeout(timer);
  }, [stoppedAt]);
  /** The recording being stopped was stopped from the indicator: offer to go on in the floating alert. */
  const stoppedFromIndicator = useRef(false);

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
        else {
          const utterance = { id: crypto.randomUUID(), start: e.start, end: e.end, speaker: e.speaker, text: e.text };
          dispatch({ type: "final", utterance });
          introduceRef.current(utterance);
        }
      },
      onLevel: setLevel,
      onDone: () => {
        const rec = recordingRef.current;
        const imported = importingRef.current?.id === rec?.id;
        dispatch({ type: "stopped" });
        setImporting(null);
        if (rec) track(imported ? "file_transcribed" : "recording_finished", { minutes: minutesBucket(rec.duration), language: rec.language ?? "?", lines: countBucket(rec.utterances.length) });
        if (rec && !imported) {
          setStoppedAt({ id: rec.id, at: Date.now() });
          if (stoppedFromIndicator.current)
            backend.showStoppedToast(rec.id, `${rec.title} · ${duration(rec.duration)}`, CONTINUE_MS / 1000).catch(() => {});
        }
        if (rec && stoppedFromIndicator.current) runUnasked.current.add(rec.id);
        stoppedFromIndicator.current = false;
      },
      onError: (message) => toast.error(message),
      onFinalPass: (e) => post.rustStageStarted(e.meetingId, e.stage, e.estimateSeconds),
      onFinalPassSpeakers: (e) => {
        dispatch({ type: "speakersVerified", id: e.meetingId, base: e.base, assignments: e.assignments });
        for (const intro of intros.current.get(e.meetingId) ?? []) dispatch({ type: "introduce", id: e.meetingId, ...intro });
        // The module-level t: this listener outlives a language change.
        toast(translate("app:speakersVerified"));
      },
      onFinalPassText: (e) => {
        const change = () => dispatch({ type: "retranscribed", id: e.meetingId, base: e.base, texts: e.texts });
        // Whisper's text comes in with the aurora, unless punctuation follows (then that one does).
        if (post.punctuatesAfter(e.meetingId)) change();
        else reveal("transcript", e.meetingId, change);
      },
      onFinalPassDone: (e) => {
        if (e.error) toast.error(e.error);
        post.rustDone(e.meetingId);
      },
    });
    return () => void unlisten.then((u) => u());
  }, [dispatch, post.rustStageStarted, post.rustDone]);

  /** The settings' four steps as stages, and back (for remembering a choice). */
  const STAGE_OF: Record<keyof AfterSteps, PostStage> = { verifySpeakers: "speakers", finalPass: "text", punctuate: "punctuation", summarize: "cover" };
  const stagesOf = (steps: AfterSteps) => new Set((Object.keys(STAGE_OF) as (keyof AfterSteps)[]).filter((k) => steps[k]).map((k) => STAGE_OF[k]));

  /** A meeting ended (lib.rs final-pass-ready): ask what to do, or do what was chosen last time. */
  const readyRef = useRef((_e: backend.FinalPassReady) => {});
  readyRef.current = (e) => {
    const id = e.meetingId;
    const file = post.isFile(id);
    const steps = post.stepsFor(e);
    const chosen = new Set([...stagesOf(afterSteps(settings, file))].filter((s) => steps.find((x) => x.stage === s)?.possible));
    // Another one still waiting (files in a row): it goes with what it has.
    if (after && !after.later) startAfter(after);
    if (!settings.askAfter || runUnasked.current.delete(id)) {
      post.choose(id, steps, chosen);
      return;
    }
    post.remember(id, steps);
    setAfter({ id, steps, chosen, deadline: Date.now() + AFTER_COUNTDOWN_MS, file });
  };

  /** "Comença ara", or the countdown ran out: run the chosen steps and remember them. */
  const startAfter = (a: NonNullable<typeof after>) => {
    setAfter((now) => (now?.id === a.id ? null : now));
    if (a.later) return void finishLater(a.id, a.chosen);
    post.choose(a.id, a.steps, a.chosen);
    const remembered = { ...afterSteps(settings, a.file) };
    for (const k of Object.keys(STAGE_OF) as (keyof AfterSteps)[]) {
      // A step that couldn't be done keeps what was chosen before.
      if (a.steps.find((x) => x.stage === STAGE_OF[k])?.possible) remembered[k] = a.chosen.has(STAGE_OF[k]);
    }
    updateSettings(rememberSteps(remembered, a.file));
  };
  const startAfterRef = useRef(startAfter);
  startAfterRef.current = startAfter;
  useEffect(() => {
    if (!after?.deadline) return;
    const timer = setTimeout(() => startAfterRef.current(after), Math.max(0, after.deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [after]);

  /** "Acaba de processar…": the steps a meeting has left, to do now from its saved transcript and audio. */
  const openLater = (m: Meeting) => {
    const language = m.language ?? settings.language;
    const audio = !!m.audioPath;
    const model = finalPassModel(language);
    const pending = new Set(m.pending ?? []);
    const catalan = language === "ca" || language === "ca-es";
    const words = m.utterances.reduce((n, u) => n + u.text.split(/\s+/).length, 0);
    const steps: AfterStep[] = [
      { stage: "speakers", possible: audio && pending.has("speakers"), reason: "audio", seconds: m.duration * 0.15 },
      { stage: "text", possible: audio && pending.has("text") && !!model && modelInstalled(model), reason: !model ? "mixed" : !audio ? "audio" : "model", seconds: 5 + m.duration * finalPassRtf(language) },
      { stage: "punctuation", possible: pending.has("punctuation") && catalan && modelInstalled("punctuation"), reason: "model", seconds: 2 + words / 800 },
      { stage: "cover", possible: pending.has("cover") && coverReady(settings), reason: "engine", seconds: 60 },
    ];
    // Done: not pending, and something that could ever be done for it (Whisper needs one language).
    const could: Record<PostStage, boolean> = { speakers: true, text: !!model, punctuation: catalan, cover: true };
    const done = new Set(steps.filter((s) => !pending.has(s.stage) && could[s.stage]).map((s) => s.stage));
    setAfter({ id: m.id, steps, chosen: new Set(steps.filter((s) => s.possible).map((s) => s.stage)), deadline: null, file: false, later: true, done });
  };

  const finishLater = async (id: string, chosen: Set<PostStage>) => {
    const m = state.open[id];
    if (!m || !chosen.size) return;
    const language = m.language ?? settings.language;
    const speakers = chosen.has("speakers");
    const text = chosen.has("text");
    post.planLater(id, chosen, language);
    track("after_later", { speakers, text, punctuation: chosen.has("punctuation"), summary: chosen.has("cover") });
    if (!(speakers || text) || !m.audioPath) return void post.finishText(id, [...chosen].filter((s) => s === "punctuation" || s === "cover"));
    const channels = [0, SYSTEM_SPEAKER_BASE]
      .map((base) => ({
        base,
        spans: m.utterances.filter((u) => (u.speaker >= SYSTEM_SPEAKER_BASE) === (base >= SYSTEM_SPEAKER_BASE)).map((u) => [u.start, u.end] as [number, number]),
      }))
      .filter((c) => c.spans.length);
    try {
      await backend.retranscribeMeeting(id, m.audioPath, text ? language : null, channels, m.guests ?? [], speakers ? settings.maxSpeakers : undefined);
    } catch (e) {
      toast.error(String(e));
      dispatch({ type: "postDone", id });
    }
  };

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
  // Files from outside (Open With, the Dock icon, the Share menu), one after another.
  const [opened, setOpened] = useState<string[]>([]);
  const takeOpened = () => void backend.takeOpenedFiles().then((paths) => paths.length && setOpened((q) => [...q, ...paths]));
  useEffect(() => {
    if (!opened.length || !state.loaded || !models.loaded || recording || busy || importing) return;
    const [next, ...rest] = opened;
    setOpened(rest);
    void openAudioRef.current(next);
  }, [opened, state.loaded, models.loaded, recording, busy, importing]);
  useEffect(() => {
    if (!backend.isTauri()) return;
    takeOpened();
    const unlisten = [
      backend.onOpenSettings(() => setShowSettings(true)),
      backend.onOpenAbout(() => setShowAbout(true)),
      backend.onRecordRequest((start, choice, from) => {
        if (start) return startRef.current(choice);
        stoppedFromIndicator.current = from === "indicator";
        stopRef.current();
      }),
      backend.onContinueRequest((id) => continueRef.current(id)),
      backend.onFinalPassReady((e) => readyRef.current(e)),
      // The meeting is being lost: say so until the microphone sends sound again (lib.rs reopens it).
      backend.onMicLost((lost) => {
        if (lost) toast.warning(t("micLost"), { id: "mic-lost", description: t("micLostDetail"), duration: Infinity });
        else {
          toast.dismiss("mic-lost");
          toast.success(t("micBack"));
        }
      }),
      backend.onCaptureRequest(() => captureRef.current()),
      backend.onOpenAudio(() => openAudioRef.current()),
      backend.onOpenedFiles(takeOpened),
      backend.onImportProgress((e) => {
        setImporting((now) => now && { ...now, ...e });
        dispatch({ type: "tick", duration: e.done });
      }),
      backend.onPostPaused((busy) => dispatch({ type: "postPaused", reason: busy.recording ? "recording" : busy.call ? "call" : null })),
      backend.onMobileMeeting((e) => void receivedRef.current(e.meetingId, e.phone)),
      backend.onMobilePaired(() => track("mobile_paired")),
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
      .setCalendarWatch({ enabled: settings.calendarAlerts, system: systemCalendarOn(settings), calendarIds: settings.calendarIds, includeNoGuests: settings.calendarNoGuests })
      .catch(() => {});
  }, [settings.calendarEnabled, settings.calendarAlerts, settings.calendarIds, settings.calendarNoGuests]);

  // Load the live models ahead of time (once they're on disk) so recording starts at once.
  const liveModel: ModelId = settings.language === "en" ? "english" : "transcription";
  const liveModelReady = !!models.status[liveModel]?.installed;
  const englishReady = !!models.status.english?.installed;
  const translating = useTranslating();
  /** The model the summaries use can translate too: Gemma downloaded, or Claude or ChatGPT connected. */
  const translationReady = coverReady(settings);
  const languageName = (l: "ca" | "es" | "en") => t(`settings:transcription.languages.${l}`);
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
      if (hasMod(e) && e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
      }
      // ⌘⌫: delete the selected meeting (not while typing).
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable='true']");
      if (hasMod(e) && e.key === "Backspace" && !typing) {
        e.preventDefault();
        removeRef.current();
      }
      if (hasMod(e) && !e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        startRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ⌘+ / ⌘− / ⌘0: the notes text's size. The View menu has them too; with a keyboard where
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
      if (!hasMod(e) || e.altKey || (isMac ? e.ctrlKey : e.metaKey)) return;
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

  const isImport = !!recording && importing?.id === recording.id;
  useEffect(() => {
    // A file's time comes from how far the engine has gone (import-progress).
    if (!recording || isImport) return;
    const id = setInterval(() => dispatch({ type: "tick", duration: startOffset.current + (Date.now() - startedAt.current) / 1000 }), 500);
    return () => clearInterval(id);
  }, [recording, isImport, dispatch]);

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
    setStarting(true);
    // Ask for the microphone and system audio like other apps do; record what's allowed.
    const sources = await ensurePermissions({ mic: settings.mic, system: settings.system }).catch(() => ({ mic: settings.mic, system: settings.system }));
    if (!sources) {
      setBusy(false);
      setStarting(false);
      return;
    }
    // Named after the calendar event going on now, if there's one.
    const event = await currentEvent(settings).catch(() => null);
    const m = newMeeting(sources, language, event?.title.trim(), event ? guestNames(event) : undefined);
    dispatch({ type: "new", meeting: m });
    setMarkdown((list) => ({ ...list, [m.id]: settings.saveMarkdown && !!settings.markdownDir }));
    obsidianPending.current.add(m.id);
    notionPending.current.add(m.id);
    // Whisper in the meeting's language, or sentence by sentence in Catalan and Spanish.
    // Its audio is kept for whatever can be done, and the steps are chosen when it ends (AfterCard).
    const finalModel = finalPassModel(language);
    const finalText = !!finalModel && modelInstalled(finalModel);
    post.planRecording(m.id, { verifySpeakers: true, finalText, language });
    backend.getGlossary().then((g) => (glossaryTerms.current = g)).catch(() => {});
    track("recording_started", { language, mic: sources.mic, system: sources.system, room: roomSpeakers, whisper: finalText, summary: settings.summarize ? settings.coverEngine : "off" });
    startedAt.current = Date.now();
    startOffset.current = 0;
    try {
      const { audioPath: path } = await backend.startRecording({
        meetingId: m.id,
        mic: sources.mic,
        micDevice: settings.micDevice,
        system: sources.system,
        saveAudio: settings.saveAudio,
        recordingsDir: settings.recordingsDir,
        maxSpeakers: settings.maxSpeakers,
        threshold: settings.threshold,
        verifySpeakers: true,
        roomSpeakers,
        language,
        finalText,
        guests: m.guests,
      });
      if (path) dispatch({ type: "audio", id: m.id, path });
    } catch (e) {
      dispatch({ type: "stopped" });
      toast.error(String(e));
    } finally {
      setBusy(false);
      setStarting(false);
    }
  }, [dispatch, settings, updateSettings, post.planRecording, transcriptionReady, models.status, t]);
  startRef.current = (choice) => {
    if (!recording && !busy) start(choice);
  };

  /** Why "Continua" can't record into `m` now, if it can't: another recording, or this one is still finishing. */
  const continueBlocked = (m: Meeting): string | null =>
    recording && recording.id !== m.id
      ? t("continueBlockedRecording")
      : m.status === "processing" || state.finalPass[m.id]
        ? t("continueBlockedFinishing")
        : null;

  /**
   * "Continua": records again into a stopped meeting, with the same sources and language, from
   * where it ended. The voices heard so far come back with their names, the audio goes on in
   * the same file, and the transcript shows the pause.
   */
  const resume = async (m: Meeting) => {
    if (!backend.isTauri()) {
      toast.error(t("openAsApp"));
      return;
    }
    if (recording || busy || m.status !== "done" || continueBlocked(m)) return;
    const language = m.language ?? settings.language;
    if (!models.status[language === "en" ? "english" : "transcription"]?.installed) {
      toast.error(t("englishModelMissing"), { action: { label: t("settings"), onClick: () => setShowSettings(true) } });
      return;
    }
    setBusy(true);
    setStarting(true);
    const wanted = m.sources ?? { mic: settings.mic, system: settings.system };
    const sources = await ensurePermissions(wanted).catch(() => wanted);
    if (!sources) {
      setBusy(false);
      setStarting(false);
      return;
    }
    setStoppedAt(null);
    // Its audio file is about to grow: the player loads it again afterwards.
    release(m.id);
    const finalModel = finalPassModel(language);
    const finalText = !!finalModel && modelInstalled(finalModel);
    post.planRecording(m.id, { verifySpeakers: true, finalText, language, from: m.duration });
    track("recording_continued", { language, whisper: finalText });
    dispatch({ type: "resumed", id: m.id, part: { startedAt: Date.now(), at: m.duration } });
    setMarkdown((list) => ({ ...list, [m.id]: settings.saveMarkdown && !!settings.markdownDir }));
    obsidianPending.current.add(m.id);
    notionPending.current.add(m.id);
    startedAt.current = Date.now();
    startOffset.current = m.duration;
    try {
      const started = await backend.startRecording({
        meetingId: m.id,
        mic: sources.mic,
        micDevice: settings.micDevice,
        system: sources.system,
        saveAudio: settings.saveAudio,
        recordingsDir: settings.recordingsDir,
        maxSpeakers: settings.maxSpeakers,
        threshold: settings.threshold,
        verifySpeakers: true,
        roomSpeakers: settings.roomSpeakers,
        language,
        finalText,
        guests: m.guests,
        resume: { duration: m.duration, lines: m.utterances.map((u) => [u.start, u.end, u.speaker]), audioPath: m.audioPath ?? null },
      });
      // The engine measures the recording so far: the new part starts exactly after it.
      startOffset.current = started.offset;
      dispatch({ type: "resumedAt", id: m.id, at: started.offset });
    } catch (e) {
      dispatch({ type: "resumeFailed", id: m.id });
      toast.error(String(e));
    } finally {
      setBusy(false);
      setStarting(false);
    }
  };
  const continueRef = useRef((_id: string) => {});
  continueRef.current = async (id) => {
    const m = state.open[id] ?? (await backend.getMeeting(id).catch(() => null));
    if (!m) return;
    if (!state.open[id]) dispatch({ type: "opened", meeting: m });
    dispatch({ type: "select", id });
    const blocked = continueBlocked(m);
    if (blocked) toast(blocked);
    else void resume(m);
  };

  /**
   * File › Open Audio…: a meeting from an audio file, as if it had been recorded, with everyone on
   * one channel. Whisper listens to a few moments to tell its language; if it can't, the
   * meeting's usual one. `given`: a file from outside, instead of asking for one.
   */
  const openAudio = async (given?: string) => {
    if (!backend.isTauri()) return;
    if (recording || busy) {
      toast(t("importWhileRecording"));
      return;
    }
    if (!transcriptionReady) {
      setOnboarding({ open: true, atModels: true });
      return;
    }
    const path = given ?? (await openDialog({ title: t("importDialog"), filters: [{ name: t("importFilter"), extensions: backend.AUDIO_EXTENSIONS }] }));
    if (typeof path !== "string") return;
    setBusy(true);
    const listening = toast.loading(t("importDetecting"));
    const detected = await backend.detectLanguage(path).catch((e) => {
      toast.error(String(e), { id: listening });
      return null;
    });
    if (!detected) {
      setBusy(false);
      return;
    }
    let language = detected.language ?? settings.language;
    if (language === "en" && !models.status.english?.installed) language = settings.language === "en" ? "ca" : settings.language;
    const name = t(`settings:transcription.languages.${language === "ca-es" ? "caEs" : language}`);
    toast(detected.language === language ? t("importLanguage", { language: name }) : t("importLanguageUnclear", { language: name }), { id: listening });
    const title = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
    const m = newMeeting({ mic: true, system: false }, language, title);
    dispatch({ type: "new", meeting: m });
    rememberSource(m.id, path);
    setImporting({ id: m.id, done: 0, total: 0 });
    setMarkdown((list) => ({ ...list, [m.id]: settings.saveMarkdown && !!settings.markdownDir }));
    obsidianPending.current.add(m.id);
    notionPending.current.add(m.id);
    const finalModel = finalPassModel(language);
    const finalText = !!finalModel && modelInstalled(finalModel);
    post.planRecording(m.id, { verifySpeakers: true, finalText, language, file: true });
    track("file_opened", { language, detected: !!detected.language, whisper: finalText });
    try {
      const { audioPath: audio } = await backend.startRecording({
        meetingId: m.id,
        mic: true,
        micDevice: null,
        system: false,
        saveAudio: settings.saveAudio,
        recordingsDir: settings.recordingsDir,
        maxSpeakers: settings.maxSpeakers,
        threshold: settings.threshold,
        verifySpeakers: true,
        roomSpeakers: true,
        language,
        finalText,
        file: path,
      });
      if (audio) dispatch({ type: "audio", id: m.id, path: audio });
    } catch (e) {
      dispatch({ type: "stopped" });
      setImporting(null);
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };
  const openAudioRef = useRef(openAudio);
  openAudioRef.current = openAudio;

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
      saveMarkdown(m, dir, settings.markdownContent)
        .then((paths) => toast(t("markdownSaved", { count: paths.length }), { action: { label: t("showInFinder"), onClick: () => revealItemInDir(paths[0]).catch(() => {}) } }))
        .catch((e) => toast.error(t("markdownFailed", { error: String(e) })));
    }
  }, [markdown, state.open, state.finalPass, settings.markdownDir, settings.markdownContent, t]);

  /** To the Obsidian vault: the note, its screenshots, and a toast to open it there. */
  const toObsidian = (m: Meeting, quiet = false) => {
    if (!settings.obsidianVault) {
      toast(t("obsidianChooseVault"), { action: { label: t("settings"), onClick: () => (setSettingsTab("export"), setShowSettings(true)) } });
      return;
    }
    track("exported", { format: "obsidian" });
    saveToObsidian(m, { vault: settings.obsidianVault, folder: settings.obsidianFolder, people: settings.obsidianPeople })
      .then((path) => toast(t("obsidianSaved"), { action: { label: t("openInObsidian"), onClick: () => void openInObsidian(path).catch((e) => toast.error(String(e))) }, duration: quiet ? 4000 : undefined }))
      .catch((e) => toast.error(String(e)));
  };
  /** To Notion (lib/notion.ts): only the text, under the chosen page; a toast to open it there. */
  const toNotion = async (m: Meeting) => {
    const status = await backend.notionStatus().catch(() => null);
    if (!status?.connected) {
      toast(t("notionConnectFirst"), { action: { label: t("settings"), onClick: () => (setSettingsTab("export"), setShowSettings(true)) } });
      return;
    }
    track("exported", { format: "notion" });
    const saving = toast.loading(t("notionSaving"));
    try {
      const url = await saveToNotion(m, settings.notionPage);
      toast.success(t("notionSaved"), { id: saving, action: url ? { label: t("openInNotion"), onClick: () => void openUrl(url).catch(() => {}) } : undefined });
    } catch (e) {
      toast.error(String(e), { id: saving });
    }
  };
  useEffect(() => {
    if (!settings.notionAuto) return;
    for (const id of [...notionPending.current]) {
      const m = state.open[id];
      if (!m || m.status !== "done" || state.finalPass[id]) continue;
      notionPending.current.delete(id);
      if (m.utterances.length) void toNotion(m);
    }
  }, [state.open, state.finalPass, settings.notionAuto, settings.notionPage]);
  // "Desa-hi cada reunió en acabar": once the final pass and the summary are done.
  useEffect(() => {
    if (!settings.obsidianAuto || !settings.obsidianVault) return;
    for (const id of [...obsidianPending.current]) {
      const m = state.open[id];
      if (!m || m.status !== "done" || state.finalPass[id]) continue;
      obsidianPending.current.delete(id);
      if (m.utterances.length) toObsidian(m, true);
    }
  }, [state.open, state.finalPass, settings.obsidianAuto, settings.obsidianVault]);

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

  const doExport = (m: Meeting, format: ExportFormat, content?: ExportContent) =>
    (track("exported", { format, content: content ?? "all" }), exportMeeting(m, format, content))
      .then((done) => done && toast(t("exported")))
      .catch((e) => toast.error(String(e)));

  /** Exporta › Subtítols (lib/subtitles.ts). */
  const doSubtitles = (m: Meeting, format: SubtitleFormat) =>
    (track("exported", { format }),
    exportSubtitles(m, format, { speakers: settings.subtitleSpeakers, translated: settings.subtitleTranslated && !!m.translation?.done }))
      .then((done) => done && toast(t("exported")))
      .catch((e) => toast.error(String(e)));

  const copyMarkdown = (m: Meeting) =>
    (track("exported", { format: "clipboard" }), copyText(toMarkdown(m)).then(() => toast(t("copiedMarkdown"))));

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

  const run = meeting ? (state.finalPass[meeting.id] ?? null) : null;
  // The Summary tab: the meeting has one, is writing one, or it's ticked on "Què en faig ara?".
  const coverAvailable =
    !!meeting &&
    meeting.status !== "recording" &&
    (!!meeting.cover || !!run?.steps.includes("cover") || (after?.id === meeting.id && !after.later && after.chosen.has("cover")));
  // Settings › General › Panell principal: the other panel goes on the right. A meeting without
  // a summary opens on its transcript, with the notes beside it.
  const notesPrimary = settings.primaryPanel === "notes" && (!meeting || meeting.status === "recording" || coverAvailable);
  const showCover = coverAvailable && view.cover;
  const viewMarker = useMarker(viewTrack, coverAvailable ? (view.cover ? "cover" : "text") : null, [notesPrimary, meeting?.id, settings.uiLanguage]);
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
  /** "Exporta l'àudio…": an .m4a anyone can play (an .ogg on Windows and Linux, playback.rs). */
  const exportAudio = async (m: Meeting) => {
    if (!m.audioPath) return;
    const ext = capabilities.audioExtension;
    const dest = await save({ title: t("exportAudioTitle"), defaultPath: `${m.title.replace(/[/:\\]/g, "-")}.${ext}`, filters: [{ name: t("audioFilter"), extensions: [ext] }] });
    if (!dest) return;
    track("exported", { format: "audio" });
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
    const model = finalPassModel(language);
    if (!modelInstalled(model)) {
      toast(t("retranscribeNeedsWhisper"), { action: { label: t("settings:model.download"), onClick: () => downloadModel(model) } });
      return;
    }
    const name = t(`settings:transcription.languages.${language === "ca-es" ? "caEs" : language}`);
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
    track("retranscribed", { to: language });
    dispatch({ type: "language", id: m.id, language });
    try {
      await backend.retranscribeMeeting(m.id, m.audioPath, language, channels, m.guests ?? []);
    } catch (e) {
      toast.error(String(e));
      dispatch({ type: "postDone", id: m.id });
    }
  };
  /**
   * A meeting recorded on a paired phone (mobile.rs) arrives: into the list, and the same work
   * as after a recording here: the speaker check and Whisper (one language), then punctuation and
   * the cover. The phone picks up the result next time it connects.
   */
  const receivedRef = useRef(async (_id: string, _phone: string) => {});
  receivedRef.current = async (id, phone) => {
    const m = await backend.getMeeting(id).catch(() => null);
    if (!m) return;
    dispatch({ type: "received", meeting: m });
    // "Murmur, sóc la Laia" said on the phone: kept as if heard here, so the speaker check below
    // gives the name back to the person (onFinalPassSpeakers), even if it renumbers them.
    const heard = m.utterances.flatMap((u) => {
      const name = introducedName(u.text);
      return name ? [{ utteranceId: u.id, name: matchName(name, [...(m.guests ?? []), ...Object.values(m.speakerNames), ...glossaryTerms.current]) }] : [];
    });
    if (heard.length) intros.current.set(id, heard);
    obsidianPending.current.add(id);
    notionPending.current.add(id);
    toast(t("mobileReceived", { title: m.title, phone }));
    track("mobile_synced", { minutes: minutesBucket(m.duration / 60) });
    const language = m.language ?? settings.language;
    const finalModel = finalPassModel(language);
    const finalText = settings.finalPass && !!finalModel && modelInstalled(finalModel);
    if (!m.audioPath || (!finalText && !settings.verifySpeakers)) {
      dispatch({ type: "postDone", id });
      return;
    }
    post.planRecording(id, { verifySpeakers: settings.verifySpeakers, finalText, language });
    const spans = m.utterances.map((u) => [u.start, u.end] as [number, number]);
    try {
      await backend.retranscribeMeeting(id, m.audioPath, finalText ? language : null, [{ base: 0, spans }], m.guests ?? [], settings.verifySpeakers ? settings.maxSpeakers : undefined);
    } catch (e) {
      toast.error(String(e));
      dispatch({ type: "postDone", id });
    }
  };
  /** "Exporta les captures…": every screenshot, in a new folder named after the meeting, in time order. */
  const exportScreens = async (m: Meeting) => {
    const screens = [...(m.screens ?? [])].sort((a, b) => a.t - b.t);
    if (!screens.length) return;
    const dir = await openDialog({ title: t("exportScreensTitle"), directory: true, canCreateDirectories: true });
    if (typeof dir !== "string") return;
    track("exported", { format: "screens" });
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
        onGenerate={(lng) => post.generateCover(meeting.id, lng)}
        onJump={jumpTo}
        onShowTranscript={() => setView({ cover: false })}
        onTitle={(title) => dispatch({ type: "title", id: meeting.id, title })}
        onTasks={(tasks) => dispatch({ type: "coverTasks", id: meeting.id, tasks })}
        onPrint={printCover}
        tags={tagsOf(meeting, "mt-2")}
      />
    );
  /** Every line of `from` to `to`, with a notice (the meeting on screen). */
  const mergeSpeakers = (from: number, to: number, version: number) => {
    if (!meeting) return;
    dispatch({ type: "merge", id: meeting.id, from, to, version });
    toast(t("speakersMerged", { from: speakerName(meeting, from), to: speakerName(meeting, to) }));
  };
  const renderTranscript = (compact: boolean) =>
    meeting && (
      <Transcript
        meeting={meeting}
        translating={translating[meeting.id] ?? null}
        languageName={languageName}
        onRemoveTranslation={() => dispatch({ type: "translation", id: meeting.id, translation: null })}
        compact={compact}
        jump={state.jump?.meetingId === meeting.id ? state.jump : null}
        finalPass={state.finalPass[meeting.id] ?? null}
        postPause={state.postPause}
        partial={meeting.status === "recording" ? state.partial : { mic: "", system: "" }}
        hoveredNote={hoveredNote}
        onHoverNote={setHoveredNote}
        onTitle={(title) => dispatch({ type: "title", id: meeting.id, title })}
        onReassign={(utteranceId, speaker, version) => {
          const from = meeting.utterances.find((u) => u.id === utteranceId)?.speaker;
          dispatch({ type: "reassign", id: meeting.id, utteranceId, speaker, version });
          // The detection may have split one person in two: offer to move the rest of their lines.
          const rest = meeting.utterances.filter((u) => u.speaker === from && u.id !== utteranceId).length;
          if (from === undefined || !rest || meeting.status === "recording") return;
          const fromName = speakerName(meeting, from);
          toast(t("speakerReassigned", { name: speakerName(meeting, speaker) }), {
            action: { label: t("speakerMergeRest", { name: fromName, count: rest }), onClick: () => mergeSpeakers(from, speaker, version) },
          });
        }}
        onRename={(speaker, name, version) => {
          // A name another speaker already has: they're the same person.
          const same = speakerIds(meeting).find((id) => id !== speaker && speakerName(meeting, id).toLocaleLowerCase() === name.toLocaleLowerCase());
          if (same !== undefined) mergeSpeakers(speaker, same, version);
          else dispatch({ type: "rename", id: meeting.id, speaker, name, version });
        }}
        onMerge={mergeSpeakers}
        onEdit={(utteranceId, text) => {
          const before = meeting.utterances.find((u) => u.id === utteranceId)?.text ?? "";
          dispatch({ type: "edit", id: meeting.id, utteranceId, text });
          if (text !== before) void offerGlossary(before, text);
        }}
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

  // The Whisper for the meetings' language isn't there (0.12: the BSC's for Catalan; later, the
  // turbo for Spanish and English, which the onboarding didn't download before; both for meetings
  // in two languages): offer each once, never downloading unasked.
  const offeredWhisper = useRef(false);
  useEffect(() => {
    if (offeredWhisper.current || !state.loaded || !models.loaded || onboarding.open || whatsNew) return;
    const id = finalModels(settings.language).find((m) => models.status[m] && !models.status[m].installed && models.status[m].downloadable);
    const status = id && models.status[id];
    if (!id || !settings.finalPass || !status) return;
    offeredWhisper.current = true;
    const key = id === "whisper-ca" ? "murmur.whisperCaOffered.v1" : "murmur.whisperOffered.v1";
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      return;
    }
    toast(t(id === "whisper-ca" ? "whisperCaOffer" : "whisperOffer"), {
      description: t(id === "whisper-ca" ? "whisperCaOfferText" : "whisperOfferText", { size: bytes(status.bytes) }),
      duration: 20_000,
      action: { label: t("settings:model.download"), onClick: () => void downloadModel(id) },
    });
  }, [state.loaded, models.loaded, models.status, onboarding.open, whatsNew, settings.language, settings.finalPass, t]);

  // Statistics follow the setting; one event when Murmur opens, with how it's set up (never content).
  useEffect(() => setAnalyticsAllowed(settings.analytics), [settings.analytics]);
  const openedTracked = useRef(false);
  useEffect(() => {
    if (openedTracked.current || !state.loaded || onboarding.open) return;
    openedTracked.current = true;
    track("app_opened", {
      ui: settings.uiLanguage,
      theme: settings.theme,
      mode: settings.mode,
      language: settings.language,
      whisper: settings.finalPass,
      summary: settings.summarize ? settings.coverEngine : "off",
      markdown: settings.saveMarkdown,
      meetings: countBucket(state.summaries.length),
    });
  }, [state.loaded, onboarding.open]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <header data-tauri-drag-region className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border pl-[84px] pr-2 pc:pl-3">
            <span data-tauri-drag-region className="min-w-0 flex-1 truncate text-[13px] font-semibold">
              {meeting.title}
            </span>
            {recording && (
              <>
                <span className="text-[12px] tabular-nums text-muted-foreground" aria-label={t("recordingTime")}>
                  {clock(recording.duration)}
                </span>
                {capabilities.screenshots && (
                  <ToolbarButton label={t("captureScreen")} onClick={() => captureRef.current()}>
                    <Camera className="size-4" />
                  </ToolbarButton>
                )}
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
      <DropOverlay later={!!recording || busy || !!importing} onDrop={(paths) => setOpened((q) => [...q, ...paths])} />
      <div className="flex h-screen overflow-hidden">
        {showSidebar && (
          <Sidebar
            meetings={state.summaries}
            selectedId={state.selectedId}
            canCreate={!recording && !busy}
            starting={starting}
            importingId={importing?.id}
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
            onCalendarSettings={openCalendarSettings}
            onMobileSettings={openMobileSettings}
            onDelete={removeById}
            tagFilter={tagFilter}
            onTagFilter={setTagFilter}
            onRenameTag={renameTag}
            onDeleteTag={deleteTag}
          />
        )}

        <div className="relative flex min-w-0 flex-1 flex-col">
          <header data-tauri-drag-region className={cn("flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3", !showSidebar && "pl-[84px] pc:pl-3")}>
            <ToolbarButton label={showSidebar ? t("hideSidebar") : t("showSidebar")} onClick={() => setShowSidebar((v) => !v)}>
              <PanelLeft className="size-4" />
            </ToolbarButton>
            {meeting && (
              // The real title is the big one in the cover or the transcript; here, a quiet reminder.
              <span data-tauri-drag-region className="ml-1 min-w-0 truncate px-1.5 text-[14px] font-medium text-text-secondary">
                {meeting.title}
              </span>
            )}
            {coverAvailable && (
              <div ref={viewTrack} role="radiogroup" aria-label={t("view")} className="relative ml-1 flex shrink-0 rounded-[7px] bg-mm-segmented-track p-0.5">
                <MarkerBackground marker={viewMarker} className="rounded-[5px] bg-mm-segmented-selected shadow-[0_1px_2px_rgb(0_0_0/0.15)]" />
                {[
                  { cover: true, label: t("viewCover") },
                  { cover: false, label: notesPrimary ? t("viewNotes") : t("viewTranscript") },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    role="radio"
                    aria-checked={view.cover === o.cover}
                    data-marker={o.cover ? "cover" : "text"}
                    onClick={() => setView({ cover: o.cover })}
                    className={cn("relative h-[22px] rounded-[5px] px-3 text-[12px] transition-colors duration-200", view.cover === o.cover ? "font-medium" : "text-muted-foreground")}
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
                {isImport ? (
                  <span className="size-3 animate-spin rounded-full border-[1.5px] border-current/30 border-t-current" aria-hidden />
                ) : (
                <span className="flex h-3.5 items-center gap-[3px]" aria-hidden>
                  {[0, 1].map((i) => (
                    <span
                      key={i}
                      className={cn("h-3.5 w-1 rounded-[2px] bg-mm-recording-level", level > 0.003 && "mm-bar", i === 1 && "mm-bar-2")}
                      style={level > 0.003 ? undefined : { transform: "scaleY(0.45)" }}
                    />
                  ))}
                </span>
                )}
                <span className="text-[13px] font-medium">{isImport ? t("importing") : t("recording")}</span>
                <span className="text-[13px] tabular-nums opacity-70" aria-label={isImport ? undefined : t("recordingTime")}>
                  {isImport ? t("progress", { percent: Math.floor((importing!.done / (importing!.total || 1)) * 100) }) : clock(recording.duration)}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={stop}
                      disabled={busy}
                      aria-label={isImport ? t("stopImport") : t("stopRecording")}
                      className="grid size-6 place-items-center rounded-full bg-white/20 hover:bg-white/30 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current disabled:opacity-40"
                    >
                      <span className="size-2.5 rounded-[2px] bg-current" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{isImport ? t("stopImport") : t("stop")}</TooltipContent>
                </Tooltip>
              </div>
            ) : (
              meeting && (
                <>
                  {stoppedAt?.id === meeting.id && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        {/* aria-disabled, not disabled: the tooltip says why. */}
                        <button
                          type="button"
                          aria-disabled={!!continueBlocked(meeting) || busy}
                          onClick={() => !continueBlocked(meeting) && void resume(meeting)}
                          className="inline-flex h-7 items-center gap-1.5 rounded-[7px] border border-border px-2.5 text-[13px] hover:bg-mm-fill-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-transparent"
                        >
                          <span className="size-2 rounded-full bg-mm-recording-dot" aria-hidden />
                          {t("continue")}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{continueBlocked(meeting) ?? t("continueHint")}</TooltipContent>
                    </Tooltip>
                  )}
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger
                          aria-label={t("moreActions")}
                          className="grid h-7 w-8 place-items-center rounded-[7px] border border-border hover:bg-mm-fill-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=open]:bg-mm-fill-subtle"
                        >
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent>{t("moreActions")}</TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent align="end" className="min-w-56">
                      {meeting.status !== "recording" && (
                        <>
                          <DropdownMenuItem disabled={!!continueBlocked(meeting) || busy} onSelect={() => void resume(meeting)} className="items-start">
                            <span className="mx-[3px] mt-[5px] size-2 shrink-0 rounded-full bg-mm-recording-dot" aria-hidden />
                            <span className="flex flex-col">
                              {t("continueMeeting")}
                              {continueBlocked(meeting) && <span className="text-[12px] leading-snug text-muted-foreground">{continueBlocked(meeting)}</span>}
                            </span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      )}
                      <DropdownMenuItem
                        disabled={!meeting.audioPath}
                        onSelect={() => meeting.audioPath && revealItemInDir(meeting.audioPath).catch((e) => toast.error(String(e)))}
                      >
                        <FolderOpen className="size-3.5" /> {meeting.audioPath ? t("showAudioInFinder") : t("audioNotSaved")}
                      </DropdownMenuItem>
                      {!meeting.cover && !meeting.pending?.includes("cover") && meeting.status === "done" && meeting.utterances.length > 0 && (
                        <DropdownMenuItem
                          disabled={!!state.finalPass[meeting.id] || !!coverBlocked}
                          onSelect={() => {
                            setView({ cover: true });
                            void post.generateCover(meeting.id);
                          }}
                        >
                          <Sparkles className="size-3.5" /> {t("after.makeSummary")}
                        </DropdownMenuItem>
                      )}
                      {!!meeting.pending?.length && meeting.status === "done" && (
                        <DropdownMenuItem disabled={!!state.finalPass[meeting.id]} onSelect={() => openLater(meeting)}>
                          <ListChecks className="size-3.5" /> {t("after.menu")}
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
                      {meeting.utterances.length > 0 && (
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger disabled={meeting.status !== "done" || !!translating[meeting.id]}>
                            <Globe className="size-3.5" /> {t("translate")}
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="min-w-56">
                            <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">{t("translateLabel")}</DropdownMenuLabel>
                            {(["ca", "es", "en"] as const)
                              .filter((l) => l !== meeting.language)
                              .map((l) => (
                                <DropdownMenuItem key={l} disabled={!translationReady} onSelect={() => void translateMeeting(meeting, l, settings, dispatch)}>
                                  {languageName(l)}
                                  {meeting.translation?.lang === l && <span className="ml-auto pl-4 text-[11px] opacity-60">{t("currentTranslation")}</span>}
                                </DropdownMenuItem>
                              ))}
                            {!translationReady && <p className="max-w-60 px-2 pb-1.5 pt-1 text-[11px] leading-snug text-muted-foreground">{t("translateNeedsModel")}</p>}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" disabled={meeting.status === "recording"} onSelect={() => remove(meeting)}>
                        <Trash2 className="size-3.5" /> {t("deleteMeeting")}
                        <span className="ml-auto pl-4 text-[11px] opacity-60">{shortcut("⌘⌫")}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-7 items-center gap-1.5 rounded-[7px] bg-mm-accent px-3 text-[13px] font-semibold text-mm-on-accent transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {t("export")} <Share className="size-[13px]" strokeWidth={2} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-60">
                      <DropdownMenuItem onSelect={() => setShowShare(true)}>
                        <Link2 className="size-3.5" /> {t("share:menu")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {(["docx", "md"] as const).map((format) => {
                        const Icon = format === "docx" ? FileDown : FileText;
                        const label = t(format === "docx" ? "exportDocx" : "exportMarkdown");
                        // Without a cover there's nothing to summarize: the file has everything.
                        if (!meeting.cover) {
                          return (
                            <DropdownMenuItem key={format} onSelect={() => doExport(meeting, format)}>
                              <Icon className="size-3.5" /> {label}
                            </DropdownMenuItem>
                          );
                        }
                        return (
                          <DropdownMenuSub key={format}>
                            <DropdownMenuSubTrigger>
                              <Icon className="size-3.5" /> {t(format === "docx" ? "exportDocxSub" : "exportMarkdownSub")}
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="min-w-44">
                              {EXPORT_CONTENTS.map((content) => (
                                <DropdownMenuItem key={content} onSelect={() => doExport(meeting, format, content)}>
                                  {t(`exportContent.${content}`)}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        );
                      })}
                      <DropdownMenuItem onSelect={() => void toNotion(meeting)}>
                        <NotebookText className="size-3.5" /> {t("exportNotion")}
                      </DropdownMenuItem>
                      {(hasObsidian || !!settings.obsidianVault) && (
                        <DropdownMenuItem onSelect={() => toObsidian(meeting)}>
                          <Gem className="size-3.5" /> {t("exportObsidian")}
                        </DropdownMenuItem>
                      )}
                      {meeting.utterances.length > 0 && (
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <Captions className="size-3.5" /> {t("exportSubtitles")}
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="min-w-56">
                            {(["srt", "vtt"] as const).map((format) => (
                              <DropdownMenuItem key={format} onSelect={() => doSubtitles(meeting, format)}>
                                {t(format === "srt" ? "exportSrt" : "exportVtt")}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuCheckboxItem
                              checked={settings.subtitleSpeakers}
                              onSelect={(e) => e.preventDefault()}
                              onCheckedChange={(on) => updateSettings({ subtitleSpeakers: on })}
                            >
                              {t("subtitleSpeakers")}
                            </DropdownMenuCheckboxItem>
                            {meeting.translation?.done && (
                              <DropdownMenuCheckboxItem
                                checked={settings.subtitleTranslated}
                                onSelect={(e) => e.preventDefault()}
                                onCheckedChange={(on) => updateSettings({ subtitleTranslated: on })}
                              >
                                {t("subtitleTranslated", { language: t(`settings:transcription.languages.${meeting.translation.lang}`) })}
                              </DropdownMenuCheckboxItem>
                            )}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      )}
                      {!!meeting.screens?.length && (
                        <DropdownMenuItem onSelect={() => exportScreens(meeting)}>
                          <Images className="size-3.5" /> {t("exportScreens", { count: meeting.screens.length })}
                        </DropdownMenuItem>
                      )}
                      {hasAudio(meeting) && (
                        <DropdownMenuItem onSelect={() => exportAudio(meeting)}>
                          <FileAudio className="size-3.5" /> {t("exportAudio", { ext: capabilities.audioExtension })}
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

          {/* Over the meeting, not pushing it down: it's a question, and it goes away. */}
          {meeting && after?.id === meeting.id && (
            <div className="pointer-events-none absolute inset-x-0 top-[52px] z-30 px-6 pt-3">
              <div className="pointer-events-auto mx-auto max-w-[600px] duration-200 animate-in fade-in-0 slide-in-from-top-2 motion-reduce:animate-none">
                <AfterCard
                  steps={after.steps}
                  chosen={after.chosen}
                  deadline={after.deadline}
                  later={after.later}
                  done={after.done}
                  file={after.file}
                  noAudio={!meeting.audioPath}
                  engineName={coverEngine(settings) ? cloudModelName(coverEngine(settings)!) : t("after.engineLocal")}
                  onToggle={(stage) =>
                    setAfter((a) => {
                      if (!a) return a;
                      const chosen = new Set(a.chosen);
                      if (chosen.has(stage)) chosen.delete(stage);
                      else chosen.add(stage);
                      return { ...a, chosen, deadline: null };
                    })
                  }
                  onStart={() => startAfter(after)}
                  onSkip={() => {
                    setAfter(null);
                    if (!after.later) post.choose(after.id, after.steps, new Set());
                  }}
                />
              </div>
            </div>
          )}
          <div className="flex min-h-0 flex-1">
            {!meeting ? (
              <main className="min-w-0 flex-1">
                {state.loaded && (
                  <Welcome
                    onStart={() => start()}
                    onOpenAudio={openAudio}
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
      <UpdatesDialog
        run={updates.run}
        manual={updates.manual}
        idle={!recording && !busy && !importing && !after && !Object.keys(state.finalPass).length}
        hidden={!!recording}
        onClose={() => {}}
      />
      {onboarding.open && <Onboarding open onClose={closeOnboarding} onChange={updateSettings} startAtModels={onboarding.atModels} cloudModels={settings.cloudModels} language={settings.language} />}
      {calendarSync.syncing && !showSettings && !showSidebar && (
        <button
          type="button"
          onClick={openCalendarSettings}
          className="fixed bottom-3 left-3 z-40 flex h-7 items-center gap-2 rounded-full bg-popover px-3 text-[12px] text-muted-foreground shadow-md ring-1 ring-foreground/10 duration-200 animate-in fade-in-0 slide-in-from-bottom-1 hover:text-foreground motion-reduce:animate-none"
          role="status"
        >
          <span className="size-3 animate-spin rounded-full border-2 border-primary/25 border-t-primary motion-reduce:animate-none" aria-hidden />
          {t("settings:calendar.syncing")}
        </button>
      )}
      <Toaster position="bottom-center" />
    </TooltipProvider>
  );
}

function Welcome({
  onStart,
  onOpenAudio,
  startChoice,
  onStartChoice,
  englishReady,
  busy,
  missingModel,
  downloading,
  onDownload,
}: {
  onStart: () => void;
  onOpenAudio: () => void;
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
        {startChoice.roomSpeakers && <p className="mt-1 max-w-xs text-[12px] text-text-secondary">{t("introHint")}</p>}
        <button
          type="button"
          onClick={onOpenAudio}
          disabled={busy}
          className="mt-4 flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-text-secondary hover:bg-mm-fill-subtle hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40"
        >
          <FileAudio className="size-3.5" /> {t("importOpen")}
        </button>
      </div>
    </div>
  );
}
