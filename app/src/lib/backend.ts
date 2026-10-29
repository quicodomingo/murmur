import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { JSONContent } from "@tiptap/core";

import type {
  CloudEngine,
  CloudModel,
  CloudProvider,
  Cover,
  EngineEvent,
  FinalPassDone,
  FinalPassSpeakers,
  FinalPassStarted,
  FinalPassText,
  Language,
  LlmProgress,
  LlmResult,
  LlmTask,
  Meeting,
  MeetingSummary,
  ModelId,
  ModelStatus,
  SearchHit,
  Screen,
  ShareLink,
  Utterance,
} from "./types";

export const isTauri = () => "__TAURI_INTERNALS__" in window;

export const prepare = (language: Language) => invoke<void>("prepare", { language });

/** Native menus, tray and alerts in the interface language (i18n.rs). */
export const setUiLanguage = (language: string) => invoke<void>("set_ui_language", { language });

export const startRecording = (opts: {
  meetingId: string;
  mic: boolean;
  micDevice: string | null;
  system: boolean;
  saveAudio: boolean;
  recordingsDir: string | null;
  maxSpeakers: number;
  threshold: number;
  verifySpeakers: boolean;
  roomSpeakers: boolean;
  language: Language;
  /** Whisper writes the text again after stopping (single-language meetings). */
  finalText: boolean;
  /** An audio file instead of the microphone (File › Open Audio…): one channel, as fast as it goes. */
  file?: string;
}) => invoke<string | null>("start_recording", { file: null, ...opts });

/** Audio files File › Open Audio… offers (import.rs EXTENSIONS). */
export const AUDIO_EXTENSIONS = ["mp3", "m4a", "aac", "wav", "aif", "aiff", "caf", "flac", "ogg", "opus", "mp4", "mov"];
/** The language of an audio file, by listening to a few moments of it; null if it isn't clear. */
export const detectLanguage = (path: string) => invoke<{ language: Language | null; windows: number }>("detect_language", { path });
/** Settings › Claude: the connector (mcp.rs). `command`: what Claude runs, with `--mcp`. */
export type ClaudeStatus = { command: string; desktopInstalled: boolean; desktopConnected: boolean };
export const claudeStatus = () => invoke<ClaudeStatus>("claude_status");
export const claudeDesktopConnect = (on: boolean) => invoke<ClaudeStatus>("claude_desktop_connect", { on });
/** File › Open Audio… (⌘O). */
export const onOpenAudio = (fn: () => void) => listen("open-audio", () => fn());
/** How far an opened file has gone through the engine, in seconds. */
export const onImportProgress = (fn: (e: { done: number; total: number }) => void) =>
  listen<{ done: number; total: number }>("import-progress", (e) => fn(e.payload));

export const stopRecording = () => invoke<void>("stop_recording");

/** One batch of edits to a meeting (db.rs `Changes`). */
export type Changes = {
  meta?: Partial<Pick<Meeting, "title" | "duration" | "status" | "speakerNames" | "sources" | "language" | "tags">> & { audioPath?: string | null; cover?: Cover | null; guests?: string[]; screens?: Screen[]; shares?: ShareLink[] };
  utterances?: Utterance[];
  notes?: { doc: JSONContent; blocks: { t: number; text: string }[] };
};

export const listMeetings = () => invoke<MeetingSummary[]>("list_meetings");
export const getMeeting = (id: string) => invoke<Meeting | null>("get_meeting", { id });
export const putMeeting = (meeting: Meeting) => invoke<void>("put_meeting", { meeting });
export const applyChanges = (id: string, changes: Changes) => invoke<void>("apply_changes", { id, changes });
export const searchMeetings = (query: string) => invoke<SearchHit[]>("search_meetings", { query });
/** Renames a tag in every meeting; onto an existing name, the two become one. */
export const renameTag = (from: string, to: string) => invoke<void>("rename_tag", { from, to });
/** Removes a tag from every meeting. */
export const deleteTag = (name: string) => invoke<void>("delete_tag", { name });
export const deleteMeeting = (id: string, audioPath: string | null) =>
  invoke<void>("delete_meeting", { id, audioPath });
export const startMicMonitor = (device: string | null) => invoke<void>("start_mic_monitor", { device });
export const stopMicMonitor = () => invoke<void>("stop_mic_monitor");
export const onMicLevel = (fn: (rms: number) => void) => listen<{ rms: number }>("mic-level", (e) => fn(e.payload.rms));
/** "Configuració…" in the app menu (⌘,) or the menu bar icon. */
export const onOpenSettings = (fn: () => void) => listen("open-settings", () => fn());
/** "Quant a Murmur" in the app menu. */
export const onOpenAbout = (fn: () => void) => listen("open-about", () => fn());
/** View › Amplia el text / Redueix el text / Mida real: 1, -1, 0. */
export const onTextZoom = (fn: (direction: -1 | 0 | 1) => void) => listen<-1 | 0 | 1>("text-zoom", (e) => fn(e.payload));
/** The menu bar icon or the floating alert asks to start or stop recording. */
export const onRecordRequest = (fn: (start: boolean, choice?: { language: Language; roomSpeakers: boolean }) => void) =>
  Promise.all([
    listen<{ language: Language; roomSpeakers: boolean } | null>("start-recording", (e) => fn(true, e.payload ?? undefined)),
    listen("stop-recording", () => fn(false)),
  ]).then(
    (u) => () => u.forEach((f) => f()),
  );
/** macOS privacy permissions (permissions.rs). */
export type Access = "undetermined" | "granted" | "denied";
/** `systemAudio`: the Core Audio tap ("undetermined" also when macOS doesn't say). `screen`: only for screenshots. */
export type Permissions = { microphone: Access; systemAudio: Access; screen: boolean };
export const permissionStatus = () => invoke<Permissions>("permission_status");
/** Shows the system's microphone dialog (only the first time) and resolves with the answer. */
export const requestMicrophone = () => invoke<Access>("request_microphone");
/** Shows macOS's "System audio recording" dialog (only the first time) and resolves with the answer. */
export const requestSystemAudio = () => invoke<Access>("request_system_audio");
/** Screen recording (screenshots): the first time, macOS adds Murmur to the list and shows a prompt. */
export const requestScreen = () => invoke<boolean>("request_screen");
export const openPrivacySettings = (pane: "microphone" | "systemAudio" | "screen" | "calendars") => invoke<void>("open_privacy_settings", { pane });

/** The macOS calendar (calendar.rs): every account added to the system. */
export type CalendarInfo = { id: string; title: string; account: string; color: string };
export type CalendarEvent = {
  id: string;
  calendarId: string;
  title: string;
  /** ms since 1970 */
  start: number;
  end: number;
  attendees: { name: string | null; email: string | null; me: boolean }[];
  platform: string | null;
};
export const calendarAccess = () => invoke<Access>("calendar_access");
/** Shows the system's calendar dialog (only the first time) and resolves with the answer. */
export const requestCalendarAccess = () => invoke<Access>("request_calendar_access");
export const listCalendars = () => invoke<CalendarInfo[]>("list_calendars");
export const calendarEvents = (from: number, to: number, calendarIds: string[] | null) =>
  invoke<CalendarEvent[]>("calendar_events", { from, to, calendarIds });
/** "Comença d'aquí a 2 minuts": which calendars the alert watches. */
export const setCalendarWatch = (watch: { enabled: boolean; calendarIds: string[] | null; includeNoGuests: boolean }) =>
  invoke<void>("set_calendar_watch", { watch });

/** The pill on the right edge of the screen while recording. */
export const setIndicator = (enabled: boolean, compact: boolean) => invoke<void>("set_indicator", { enabled, compact });
/** Compact mode: the main window narrows to the notes, beside the call (shell.rs set_compact). */
export const setCompact = (on: boolean) => invoke<void>("set_compact", { on });
export const onCompact = (fn: (on: boolean) => void) => listen<boolean>("compact", (e) => fn(e.payload));
/** "Reunió detectada": offer to record when another app starts using the microphone. */
export const setMeetingDetection = (enabled: boolean) => invoke<void>("set_meeting_detection", { enabled });
/** A screenshot of the call at `t` seconds (capture.rs); resolves with the file's path. */
export const captureScreen = (meetingId: string, t: number) => invoke<string>("capture_screen", { meetingId, t });
/** The recording as an .m4a anyone can play (playback.rs), made once and kept in the cache. */
export const playbackAudio = (meetingId: string, audioPath: string) => invoke<string>("playback_audio", { meetingId, audioPath });
export const exportAudio = (meetingId: string, audioPath: string, dest: string) => invoke<void>("export_audio", { meetingId, audioPath, dest });
export const deleteScreen = (path: string) => invoke<void>("delete_screen", { path });
/** The work after a recording waits while Murmur records or another app uses the mic (gate.rs). */
export const onPostPaused = (fn: (busy: { recording: boolean; call: boolean }) => void) =>
  listen<{ recording: boolean; call: boolean }>("post-paused", (e) => fn(e.payload));
/** "Som més a la sala" changed while recording: the microphone's voices are told apart from now on. */
export const setRoomSpeakers = (on: boolean) => invoke<void>("set_room_speakers", { on });
/** Copies a meeting's screenshots to `dest` (a new folder), named `names`. */
export const exportScreens = (meetingId: string, paths: string[], names: string[], dest: string) =>
  invoke<void>("export_screens", { meetingId, paths, names, dest });
/** The indicator's camera button asks the main window for a screenshot. */
export const onCaptureRequest = (fn: () => void) => listen("capture-request", () => fn());

/** The system print panel for this window (the cover; index.css hides the rest on paper). */
export const printPage = () => invoke<void>("print_page");
export const listMicrophones = () => invoke<string[]>("list_microphones");
export const writeExport = (path: string, contents: Uint8Array) =>
  invoke<void>("write_export", { path, contents: Array.from(contents) });

export const modelStatus = () => invoke<ModelStatus[]>("model_status");
export const downloadModel = (id: ModelId) => invoke<void>("download_model", { id });
export const cancelModelDownload = (id: ModelId) => invoke<void>("cancel_model_download", { id });
export const deleteModel = (id: ModelId) => invoke<void>("delete_model", { id });
/** Installed models with a newer version in the catalog (models.rs CATALOG_URL). */
export type ModelUpdate = { id: ModelId; version: number; notes: string; bytes: number };
export const modelUpdates = () => invoke<ModelUpdate[]>("model_updates");
/** Installs the catalog's version: same progress events as a download. */
export const updateModel = (id: ModelId) => invoke<void>("update_model", { id });
export const onModelDownload = (fn: (e: { id: ModelId; done: number; total: number }) => void) =>
  listen<{ id: ModelId; done: number; total: number }>("model-download", (e) => fn(e.payload));
export const onModelDownloadDone = (fn: (e: { id: ModelId; error: string | null; cancelled: boolean }) => void) =>
  listen<{ id: ModelId; error: string | null; cancelled: boolean }>("model-download-done", (e) => fn(e.payload));

/** Punctuation and capitals for consecutive utterances; returns their new texts. */
export const punctuate = (texts: string[], speakers: number[]) => invoke<string[]>("punctuate", { texts, speakers });

/**
 * Reads `document` once with the local language model and answers each task about it; with an
 * `engine`, Claude or OpenAI answer instead (cloud.rs).
 */
export const runLlm = (opts: { job: string; system: string; document: string; tasks: LlmTask[]; keepLoaded: boolean; engine: CloudEngine | null }) =>
  invoke<LlmResult[]>("run_llm", opts);
export const releaseLlm = () => invoke<void>("release_llm");

/** The saved API keys' last characters (the keys stay in the keychain); null = not connected. */
export const cloudStatus = () => invoke<Record<CloudProvider, string | null>>("cloud_status");
/** Checks the key, saves it to the keychain and returns the models it can use. */
export const cloudConnect = (provider: CloudProvider, key: string) => invoke<CloudModel[]>("cloud_connect", { provider, key });
export const cloudDisconnect = (provider: CloudProvider) => invoke<void>("cloud_disconnect", { provider });
export const cloudModels = (provider: CloudProvider) => invoke<CloudModel[]>("cloud_models", { provider });
/** The Worker for shared links (share.rs): its address and the API key's last characters. */
export type ShareStatus = { url: string; hint: string; managed: boolean };
export const shareStatus = () => invoke<ShareStatus | null>("share_status");
/** Checks the Worker's address and API key, and saves them to the keychain. */
export const shareConnect = (url: string, key: string) => invoke<ShareStatus>("share_connect", { url, key });
export const shareDisconnect = () => invoke<void>("share_disconnect");
/** Uploads an encrypted meeting; `ttl` in seconds, null = it never expires. */
export const sharePublish = (envelope: string, ttl: number | null) =>
  invoke<{ id: string; url: string; expiresAt: number | null }>("share_publish", { envelope, ttl });
export const shareRevoke = (id: string) => invoke<void>("share_revoke", { id });
/** A screenshot, or the audio as .m4a, as bytes to encrypt (share.rs keeps it to the meeting's files). */
export const shareReadFile = (meetingId: string, kind: "audio" | "screen", path: string) =>
  invoke<ArrayBuffer>("share_read_file", { meetingId, kind, path });
/** One encrypted file of a shared meeting, sent as raw bytes. */
export const shareUploadFile = (id: string, name: string, ttl: number | null, bytes: Uint8Array) =>
  invoke<void>("share_upload_file", bytes, { headers: { "x-share-id": id, "x-share-file": name, "x-share-ttl": ttl ? String(ttl) : "" } });
/**
 * "Torna a transcriure en…": Whisper writes each utterance again from the saved audio (lib.rs
 * retranscribe_meeting); the result comes as a final pass ("final-pass", "final-pass-text"…).
 */
export const retranscribeMeeting = (meetingId: string, audioPath: string, language: Language, channels: { base: number; spans: [number, number][] }[]) =>
  invoke<void>("retranscribe_meeting", { meetingId, audioPath, language, channels });
/** Cloudflare's token form, filled in with the permissions Murmur needs. */
export const shareTokenUrl = () => invoke<string>("share_token_url");
export type CfAccount = { id: string; name: string };
export const shareCfAccounts = (token: string) => invoke<CfAccount[]>("share_cf_accounts", { token });
/** Publishes the Worker on the user's account; `ready`: its address answers already. */
export const shareSetup = (token: string, account: CfAccount) => invoke<{ status: ShareStatus; ready: boolean }>("share_setup", { token, account });
export type ShareSetupStep = "storage" | "worker" | "address" | "check";
export const onShareSetup = (fn: (step: ShareSetupStep) => void) => listen<ShareSetupStep>("share-setup", (e) => fn(e.payload));
export const onLlmProgress = (fn: (e: LlmProgress) => void) => listen<LlmProgress>("llm-progress", (e) => fn(e.payload));

export async function subscribe(handlers: {
  onEvent: (e: EngineEvent) => void;
  onLevel: (rms: number) => void;
  onDone: () => void;
  onError: (message: string) => void;
  onFinalPass: (e: FinalPassStarted) => void;
  onFinalPassSpeakers: (e: FinalPassSpeakers) => void;
  onFinalPassText: (e: FinalPassText) => void;
  onFinalPassDone: (e: FinalPassDone) => void;
}): Promise<UnlistenFn> {
  const unlisten = await Promise.all([
    listen<EngineEvent>("transcript", (e) => handlers.onEvent(e.payload)),
    listen<{ rms: number }>("level", (e) => handlers.onLevel(e.payload.rms)),
    listen("transcript-done", () => handlers.onDone()),
    listen<string>("transcript-error", (e) => handlers.onError(e.payload)),
    listen<FinalPassStarted>("final-pass", (e) => handlers.onFinalPass(e.payload)),
    listen<FinalPassSpeakers>("final-pass-speakers", (e) => handlers.onFinalPassSpeakers(e.payload)),
    listen<FinalPassText>("final-pass-text", (e) => handlers.onFinalPassText(e.payload)),
    listen<FinalPassDone>("final-pass-done", (e) => handlers.onFinalPassDone(e.payload)),
  ]);
  return () => unlisten.forEach((u) => u());
}
