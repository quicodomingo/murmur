import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AudioLines, CalendarDays, Check, ChevronRight, CloudUpload, Contrast, Copy, FileOutput, Link2, Lock, Mic, Plug, SlidersHorizontal, Smartphone, Sparkles, Wifi, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { THEMES, type Theme } from "@/lib/appearance";
import * as backend from "@/lib/backend";
import type { CfAccount, ShareSetupStep } from "@/lib/backend";
import { locale, systemLanguage, UI_LANGUAGE_NAMES, UI_LANGUAGES, type UiLanguagePref } from "@/lib/i18n";
import { ModelPicker } from "@/components/ModelPicker";
import { cloudModel, connectCloud, KEY_PLACEHOLDER, coverEngine, disconnectCloud, KEYS_URL, loadCloudModels, PROVIDERS, useCloud } from "@/lib/cloud";
import { coverDocument, llmTasks, PROMPTS, promptText, type PromptId } from "@/lib/cover";
import { syncCalendars, useCalendarSync } from "@/lib/calendar";
import { spellingNote } from "@/lib/glossary";
import { bytes, deleteModel, downloadModel, useModels } from "@/lib/models";
import { DEFAULT_SETTINGS, type AfterSteps, type Settings } from "@/lib/settings";
import { connectShare, disconnectShare, setupShare, useShareStatus } from "@/lib/share";
import type { CloudProvider, Language, LlmProgress, LlmResult, Meeting, ModelId } from "@/lib/types";
import { finalModels } from "@/lib/finalpass";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/clipboard";
import { MarkerBackground, useMarker } from "@/lib/motion";
import { MEETING_LANGUAGES } from "./StartOptions";
import { capabilities, isMac, OS } from "@/lib/platform";
import { ago } from "@/lib/format";
import { VoicePrivacy, VoiceRecorder } from "@/components/VoiceRecorder";
import { PHONE_APP } from "@/lib/features";
import { feedbackAvailable, openFeedback } from "@/lib/feedback";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  recording: boolean;
  /** The open meeting, to try prompts on (only a finished one with a transcript). */
  meeting: Meeting | null;
  /** "Comprova ara": the updates window (UpdatesDialog). */
  onCheckUpdates: () => void;
  /** "Mostra-les": this version's notes (WhatsNewDialog). */
  onShowWhatsNew: () => void;
  /** The tab to show when it opens (a link from the version notes). */
  initialTab?: Tab;
};

const TABS = [
  { id: "general", icon: SlidersHorizontal },
  { id: "appearance", icon: Contrast },
  { id: "calendar", icon: CalendarDays },
  { id: "audio", icon: Mic },
  { id: "transcription", icon: AudioLines },
  { id: "intelligence", icon: Sparkles },
  { id: "export", icon: FileOutput },
  { id: "share", icon: Link2 },
  { id: "claude", icon: Plug },
  { id: "mobile", icon: Smartphone },
] as const;


/** A decimal in the interface language: 0,65 in Catalan and Spanish, 0.65 in English. */
const decimal = (n: number, digits: number) => n.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
export type Tab = (typeof TABS)[number]["id"];

/** Native-style Preferences window: icon tabs on top, grouped rows below. */
export function SettingsDialog({ open, onOpenChange, settings, onChange, recording, meeting, onCheckUpdates, onShowWhatsNew, initialTab }: Props) {
  const { t } = useTranslation("settings");
  const [tab, setTab] = useState<Tab>("general");
  // Settings apply and are kept as soon as they change: a word in the title bar says so.
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | undefined>(undefined);
  const change: Props["onChange"] = (patch) => {
    onChange(patch);
    setSaved(true);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), 1800);
  };
  useEffect(() => () => window.clearTimeout(savedTimer.current), []);
  useEffect(() => {
    if (open && initialTab) setTab(initialTab);
  }, [open, initialTab]);
  // The selection's background slides to the section chosen (lib/motion.tsx).
  const navRef = useRef<HTMLElement>(null);
  const marker = useMarker(navRef, open ? tab : null, [open]);
  // Trying prompts keeps the language model loaded; free its memory when the window closes.
  const llmLoaded = useRef(false);
  useEffect(() => {
    if (!open && llmLoaded.current) {
      llmLoaded.current = false;
      backend.releaseLlm().catch(() => {});
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[820px]" showCloseButton={false}>
        <div className="relative border-b border-border px-4 pb-2 pt-3">
          <DialogTitle className="text-center text-[13px] font-semibold">{t("title")}</DialogTitle>
          <span
            role="status"
            aria-live="polite"
            className={cn("absolute left-4 top-3 flex items-center gap-1 text-[11px] text-muted-foreground transition-opacity duration-300", saved ? "opacity-100" : "opacity-0")}
          >
            {saved && (
              <>
                <Check className="size-3" aria-hidden /> {t("saved")}
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label={t("close")}
            title={t("close")}
            className="absolute right-3 top-2.5 grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-mm-fill-subtle hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            <X className="size-4" />
          </button>
          <DialogDescription className="sr-only">{t("description")}</DialogDescription>
        </div>

        <div className="flex h-[min(70vh,580px)]">
          {/* The sections in a column, as in the system's settings: they all fit, however many. */}
          <nav ref={navRef} className="relative w-[184px] shrink-0 overflow-y-auto border-r border-border bg-mm-sidebar p-2" role="tablist" aria-orientation="vertical">
            {/* The selection's background slides to the section chosen (not on opening; motion-reduce: jumps). */}
            <MarkerBackground marker={marker} className="rounded-md bg-mm-sidebar-selection" />
            {TABS.filter(({ id }) => (id !== "calendar" || capabilities.calendar) && (id !== "mobile" || PHONE_APP)).map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                data-marker={id}
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  "relative flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                  tab === id && "font-medium text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="truncate">{t(`tabs.${id}`)}</span>
              </button>
            ))}
          </nav>

        <div className="min-w-0 flex-1 overflow-y-auto bg-mm-settings-background px-7 py-5" role="tabpanel">
          {recording && ["audio", "transcription", "intelligence"].includes(tab) && <p className="mb-3 text-[12px] text-muted-foreground">{t("nextRecording")}</p>}
          {tab === "general" && <GeneralTab settings={settings} onChange={change} onGoTo={setTab} onCheckUpdates={onCheckUpdates} onShowWhatsNew={onShowWhatsNew} />}
          {tab === "appearance" && <AppearanceTab settings={settings} onChange={change} />}
          {tab === "calendar" && <CalendarSettings settings={settings} onChange={change} />}
          {tab === "audio" && <AudioTab open={open} settings={settings} onChange={change} recording={recording} />}
          {tab === "transcription" && <TranscriptionTab settings={settings} onChange={change} recording={recording} />}
          {tab === "intelligence" && <IntelligenceTab settings={settings} onChange={change} meeting={meeting} onLlmLoaded={() => (llmLoaded.current = true)} />}
          {tab === "export" && <ExportTab settings={settings} onChange={change} />}
          {tab === "share" && <ShareTab />}
          {tab === "claude" && <ClaudeTab open={open} />}
          {tab === "mobile" && <MobileTab open={open} />}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- General -------------------------------------------------------------------------------

/** How Murmur behaves: when it opens, how it invites you to record, what shows while recording. */
function GeneralTab({
  settings,
  onChange,
  onGoTo,
  onCheckUpdates,
  onShowWhatsNew,
}: {
  settings: Settings;
  onChange: Props["onChange"];
  onGoTo: (tab: Tab) => void;
  onCheckUpdates: () => void;
  onShowWhatsNew: () => void;
}) {
  const { t } = useTranslation("settings");
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<backend.Access | null>(null);
  const [links, setLinks] = useState(0);
  const [google, setGoogle] = useState(false);
  useEffect(() => {
    if (!backend.isTauri()) return;
    autostartEnabled().then(setAutostart).catch(() => setAutostart(null));
    getVersion().then(setVersion).catch(() => {});
    if (capabilities.systemCalendar) backend.calendarAccess().then(setCalendar).catch(() => {});
    backend.icalFeeds().then((f) => setLinks(f.length)).catch(() => {});
    if (capabilities.googleCalendar) backend.googleStatus().then((g) => setGoogle(g.connected)).catch(() => {});
  }, []);
  const toggleAutostart = async (on: boolean) => {
    try {
      await (on ? enableAutostart() : disableAutostart());
      setAutostart(await autostartEnabled());
    } catch (e) {
      toast.error(String(e));
    }
  };
  // Some calendar to read: the system's (macOS), Google or an iCal link.
  const connected = (capabilities.systemCalendar && calendar === "granted" && settings.calendarEnabled) || google || links > 0;
  return (
    <>
      <Group title={t("general.languageGroup")}>
        <Row label={t("general.uiLanguage")} hint={t("general.uiLanguageHint")}>
          <select
            value={settings.uiLanguage}
            onChange={(e) => onChange({ uiLanguage: e.target.value as UiLanguagePref })}
            aria-label={t("general.uiLanguage")}
            className="h-6 max-w-56 truncate rounded-md border border-input bg-background px-1.5 text-[13px]"
          >
            <option value="system">{t("general.systemLanguage", { name: UI_LANGUAGE_NAMES[systemLanguage()] })}</option>
            {UI_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {UI_LANGUAGE_NAMES[lang]}
              </option>
            ))}
          </select>
        </Row>
      </Group>
      <Group title={t("general.startup")}>
        <Row label={t("general.autostart")} hint={t("general.autostartHint")}>
          <Switch checked={!!autostart} disabled={autostart === null} onCheckedChange={toggleAutostart} />
        </Row>
      </Group>
      <Group title={t("general.updates")}>
        <Row label={version ? t("general.version", { version }) : "Murmur"} hint={t("general.updatesHint")}>
          <button type="button" onClick={onCheckUpdates} disabled={!backend.isTauri()} className="h-6 shrink-0 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted disabled:opacity-50">
            {t("general.checkNow")}
          </button>
        </Row>
        <Row
          label={t("general.checkOnOpen")}
          hint={t("general.checkOnOpenHint")}
        >
          <Switch checked={settings.checkUpdates} onCheckedChange={(checkUpdates) => onChange({ checkUpdates })} />
        </Row>
        <Row label={t("general.showWhatsNew")} hint={t("general.showWhatsNewHint")}>
          <div className="flex shrink-0 items-center gap-3">
            <button type="button" onClick={onShowWhatsNew} className="text-[12px] text-mm-link hover:underline">
              {t("general.showWhatsNewNow")}
            </button>
            <Switch checked={settings.showWhatsNew} onCheckedChange={(showWhatsNew) => onChange({ showWhatsNew })} />
          </div>
        </Row>
      </Group>
      {(capabilities.meetingDetection || capabilities.calendar) && (
        <Group title={t("general.beforeMeeting")}>
          <Row label={t("general.detectMeetings")} hint={t("general.detectMeetingsHint")}>
            <Switch checked={settings.detectMeetings} onCheckedChange={(detectMeetings) => onChange({ detectMeetings })} />
          </Row>
          <div className="flex min-h-11 items-center gap-4 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-[13px]">{t("general.calendarAlerts")}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                {connected ? (
                  t("general.calendarAlertsHint")
                ) : (
                  <>
                    {t("general.calendarNeeded")}{" "}
                    <button type="button" className="text-mm-link hover:underline" onClick={() => onGoTo("calendar")}>
                      {t("general.goToCalendar")}
                    </button>
                  </>
                )}
              </div>
            </div>
            <Switch checked={connected && settings.calendarAlerts} disabled={!connected} onCheckedChange={(calendarAlerts) => onChange({ calendarAlerts })} />
          </div>
        </Group>
      )}
      <Group title={t("general.duringRecording")}>
        <Row label={t("general.indicator")} hint={t("general.indicatorHint")}>
          <Switch checked={settings.recordingIndicator} onCheckedChange={(recordingIndicator) => onChange({ recordingIndicator })} />
        </Row>
        <div className={cn(!settings.recordingIndicator && "opacity-50")}>
          <Row label={t("general.compact")} hint={t("general.compactHint")}>
            <Switch checked={settings.compactNotes} disabled={!settings.recordingIndicator} onCheckedChange={(compactNotes) => onChange({ compactNotes })} />
          </Row>
        </div>
      </Group>
      <Group title={t("general.privacy")}>
        <Row label={t("general.analytics")} hint={t("general.analyticsHint")}>
          <Switch checked={settings.analytics} onCheckedChange={(analytics) => onChange({ analytics })} />
        </Row>
        <Row label={t("general.log")} hint={t("general.logHint")}>
          <button
            type="button"
            disabled={!backend.isTauri()}
            onClick={() => backend.showLog().catch((e) => toast.error(String(e)))}
            className="h-6 shrink-0 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted disabled:opacity-50"
          >
            {t("general.showLog")}
          </button>
        </Row>
      </Group>
      {feedbackAvailable() && (
        <Group title={t("general.help")}>
          <Row label={t("general.feedback")} hint={t("general.feedbackHint")}>
            <button
              type="button"
              onClick={() => openFeedback()}
              className="h-6 shrink-0 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted"
            >
              {t("general.feedbackButton")}
            </button>
          </Row>
        </Group>
      )}
    </>
  );
}

/**
 * Calendari tab (docs/mockups/calendari.html): the connections (the macOS calendar, with every
 * account added to the system; Google, signing in in the browser; and iCal links on every system:
 * Outlook, iCloud…), then which calendars and events Murmur watches. The alert itself is in General.
 */
function CalendarSettings({ settings, onChange }: { settings: Settings; onChange: Props["onChange"] }) {
  const { t } = useTranslation("settings");
  const mac = capabilities.systemCalendar;
  const [access, setAccess] = useState<backend.Access | null>(null);
  const [calendars, setCalendars] = useState<backend.CalendarInfo[]>([]);
  const [feeds, setFeeds] = useState<backend.IcalFeed[]>([]);
  const [google, setGoogle] = useState<backend.GoogleStatus | null>(null);
  /** Just connected: macOS is still loading the accounts, so the list may come empty at first. */
  const sync = useCalendarSync();
  const alive = useRef(true);
  const enabled = useRef(settings.calendarEnabled);
  enabled.current = settings.calendarEnabled;
  const systemOn = mac && access === "granted" && settings.calendarEnabled;

  const refresh = async () => {
    if (!backend.isTauri()) return;
    const a = mac ? await backend.calendarAccess().catch(() => null) : null;
    const f = await backend.icalFeeds().catch(() => []);
    const list = await backend.listCalendars(mac && a === "granted" && enabled.current).catch(() => []);
    // After the list: reading it is what finds out the session ended.
    const g = capabilities.googleCalendar ? await backend.googleStatus().catch(() => null) : null;
    if (!alive.current) return;
    if (a) setAccess(a);
    setGoogle(g);
    setFeeds(f);
    setCalendars(list);
  };
  // The background sync found them (maybe while this window was closed).
  useEffect(() => {
    if (sync.calendars?.length) void refresh();
  }, [sync.calendars]);
  useEffect(() => {
    void refresh();
  }, [settings.calendarEnabled]);
  const connect = async () => {
    onChange({ calendarEnabled: true });
    const a = await backend.requestCalendarAccess().catch(() => "denied" as const);
    if (alive.current) setAccess(a);
    if (a === "granted") syncCalendars();
  };
  useEffect(() => {
    alive.current = true;
    // Coming back from System Settings.
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      alive.current = false;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const button = "h-6 shrink-0 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted disabled:opacity-50";
  const ids = calendars.map((c) => c.id);
  const watched = (id: string) => settings.calendarIds === null || settings.calendarIds.includes(id);
  const toggle = (id: string, on: boolean) => {
    const next = (settings.calendarIds ?? ids).filter((c) => c !== id && ids.includes(c));
    if (on) next.push(id);
    onChange({ calendarIds: next.length === ids.length ? null : next });
  };
  const remove = async (feed: backend.IcalFeed) => {
    const message = t("calendar.icalRemoveMessage", { name: feed.name });
    const confirmed = backend.isTauri()
      ? await ask(message, { title: t("calendar.icalRemoveTitle"), kind: "warning", okLabel: t("calendar.icalRemove"), cancelLabel: t("common:cancel") })
      : window.confirm(message);
    if (!confirmed) return;
    await backend.icalRemove(feed.id).catch((e) => toast.error(String(e)));
    void refresh();
  };

  return (
    <>
      <Group title={t("calendar.connection")}>
        {mac && (
          <Row
            label={t("calendar.macCalendar")}
            hint={
              access === "denied"
                ? t("calendar.denied")
                : systemOn
                  ? t("calendar.connected")
                  : access === "granted"
                    ? t("calendar.disconnected")
                    : t("calendar.notConnected")
            }
          >
            <span className="flex shrink-0 items-center gap-2">
              {access === "denied" ? (
                <button type="button" className={button} onClick={() => backend.openPrivacySettings("calendars")}>
                  {t("calendar.openSettings")}
                </button>
              ) : systemOn ? (
                <>
                  <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                    <Check className="size-3.5" aria-hidden /> {t("calendar.allowed")}
                  </span>
                  <button type="button" className={button} onClick={() => onChange({ calendarEnabled: false })}>
                    {t("calendar.disconnect")}
                  </button>
                </>
              ) : (
                <>
                  {/* Disconnected: Murmur can't remove its own permission; System Settings can. */}
                  {access === "granted" && (
                    <button type="button" className={button} onClick={() => backend.openPrivacySettings("calendars")}>
                      {t("calendar.revoke")}
                    </button>
                  )}
                  <button type="button" className={button} disabled={access === null} onClick={connect}>
                    {t("calendar.connect")}
                  </button>
                </>
              )}
            </span>
          </Row>
        )}
        {capabilities.googleCalendar && <GoogleRow status={google} onChange={() => void refresh()} />}
        <IcalRows feeds={feeds} onAdded={() => void refresh()} onRemove={(f) => void remove(f)} />
      </Group>
      <p className="-mt-3 mb-5 flex gap-1.5 px-1 text-[11px] leading-snug text-muted-foreground">
        <Lock className="mt-px size-3 shrink-0" aria-hidden />
        <span>{mac ? t("calendar.privacyMac") : t("calendar.privacy")}</span>
      </p>
      {(systemOn || google?.connected || feeds.length > 0) && (
        <>
          <Group title={t("calendar.events")}>
            <Row label={t("calendar.noGuests")} hint={t("calendar.noGuestsHint")}>
              <Switch checked={settings.calendarNoGuests} onCheckedChange={(calendarNoGuests) => onChange({ calendarNoGuests })} />
            </Row>
          </Group>
          <section className="mb-5">
            <div className="mb-1.5 flex items-baseline justify-between px-1">
              <h3 className="text-[12px] font-semibold text-muted-foreground">{t("calendar.watched")}</h3>
              {settings.calendarIds !== null && (
                <button type="button" className="text-[12px] text-mm-link hover:underline" onClick={() => onChange({ calendarIds: null })}>
                  {t("calendar.all")}
                </button>
              )}
            </div>
            <div className="divide-y divide-border rounded-[10px] border border-border bg-background">
              {calendars.length === 0 &&
                (sync.syncing ? (
                  <div className="flex min-h-11 items-center gap-2.5 px-3 py-2 text-[13px] text-muted-foreground" role="status">
                    <span className="size-3.5 animate-spin rounded-full border-2 border-primary/25 border-t-primary motion-reduce:animate-none" aria-hidden />
                    {t("calendar.syncing")}
                  </div>
                ) : (
                  <Row label={t("calendar.empty")} hint={t("calendar.emptyHint")}>{null}</Row>
                ))}
              {calendars.map((c) => (
                <div key={c.id} className="flex min-h-11 items-center gap-3 px-3 py-2">
                  {/* The calendar's own colour, as macOS shows it; the links get one of ours. */}
                  <span className="size-3 shrink-0 rounded-[3px]" style={{ backgroundColor: c.color }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">{c.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {c.id.startsWith("ics:")
                        ? t("calendar.fromLink", { host: c.account })
                        : c.id.startsWith("google:")
                          ? t("calendar.fromGoogle", { email: c.account })
                          : c.account !== c.title
                            ? c.account
                            : ""}
                    </div>
                  </div>
                  <Switch checked={watched(c.id)} onCheckedChange={(on) => toggle(c.id, on)} aria-label={t("calendar.watch", { name: c.title })} />
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}

/**
 * Google Calendar: "Inicia la sessió…" opens the browser and waits for it (with Cancel'la while
 * it does); connected, the account's address and Desconnecta. A session that ended says so.
 */
function GoogleRow({ status, onChange }: { status: backend.GoogleStatus | null; onChange: () => void }) {
  const { t } = useTranslation("settings");
  const [waiting, setWaiting] = useState(false);
  const button = "h-6 shrink-0 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted disabled:opacity-50";

  const connect = async () => {
    setWaiting(true);
    try {
      const email = await backend.googleConnect();
      toast(t("calendar.googleConnectedToast", { email }));
      onChange();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setWaiting(false);
    }
  };
  const disconnect = async () => {
    const message = t("calendar.googleDisconnectMessage");
    const confirmed = backend.isTauri()
      ? await ask(message, { title: t("calendar.googleDisconnectTitle"), kind: "warning", okLabel: t("calendar.disconnect"), cancelLabel: t("common:cancel") })
      : window.confirm(message);
    if (!confirmed) return;
    await backend.googleDisconnect().catch((e) => toast.error(String(e)));
    onChange();
  };

  const connected = !!status?.connected;
  const hint = waiting ? t("calendar.googleWaiting") : connected ? (status?.email ?? "") : t("calendar.googleHint");
  return (
    <Row label={t("calendar.google")} hint={hint}>
      <span className="flex shrink-0 items-center gap-2">
        {status?.error && <span className="max-w-56 truncate text-[12px] text-destructive" title={status.error}>{status.error}</span>}
        {waiting ? (
          <button type="button" className={button} onClick={() => void backend.googleCancel()}>
            {t("common:cancel")}
          </button>
        ) : connected ? (
          <>
            {!status?.error && (
              <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                <Check className="size-3.5" aria-hidden /> {t("calendar.googleConnected")}
              </span>
            )}
            <button type="button" className={cn(button, "text-destructive")} onClick={() => void disconnect()}>
              {t("calendar.disconnect")}
            </button>
          </>
        ) : (
          <button type="button" className={button} disabled={!backend.isTauri() || status === null} onClick={() => void connect()}>
            {t("calendar.googleSignIn")}
          </button>
        )}
      </span>
    </Row>
  );
}

const ICAL_HELP = ["google", "outlook", "icloud"] as const;

/**
 * The iCal links: "Afegeix un enllaç…" opens a field in place, with how to find the link in
 * Google, Outlook and iCloud; each saved one says where it's from and when it was last read.
 */
function IcalRows({ feeds, onAdded, onRemove }: { feeds: backend.IcalFeed[]; onAdded: () => void; onRemove: (f: backend.IcalFeed) => void }) {
  const { t } = useTranslation("settings");
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState<(typeof ICAL_HELP)[number]>("google");
  const button = "h-6 shrink-0 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted disabled:opacity-50";

  const add = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const feed = await backend.icalAdd(url.trim());
      toast(t("calendar.icalAdded", { name: feed.name }));
      setUrl("");
      setAdding(false);
      onAdded();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Row label={t("calendar.ical")} hint={t("calendar.icalHint")}>
        {!adding && (
          <button type="button" className={button} onClick={() => setAdding(true)}>
            {t("calendar.icalAdd")}
          </button>
        )}
      </Row>
      {adding && (
        <div className="bg-black/[0.015] py-2.5 pl-6 pr-3 dark:bg-white/[0.02]">
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <input
              autoFocus
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
              aria-label={t("calendar.icalLabel")}
              aria-invalid={!!error}
              aria-describedby={error ? "ical-error" : undefined}
              autoComplete="off"
              spellCheck={false}
              className="h-6 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive"
            />
            <button type="submit" className={button} disabled={busy || !url.trim()}>
              {busy ? t("calendar.icalChecking") : t("calendar.icalAddButton")}
            </button>
            <button
              type="button"
              className={button}
              onClick={() => {
                setAdding(false);
                setError(null);
                setUrl("");
              }}
            >
              {t("common:cancel")}
            </button>
          </form>
          {error && (
            <p id="ical-error" role="alert" className="mt-1 text-[11px] text-destructive">
              {error}
            </p>
          )}
          <div className="mt-2.5 text-[12px] text-muted-foreground">
            <div className="font-medium text-foreground">{t("calendar.icalWhere")}</div>
            <div role="tablist" className="mt-1 flex gap-3.5">
              {ICAL_HELP.map((h) => (
                <button
                  key={h}
                  type="button"
                  role="tab"
                  aria-selected={help === h}
                  onClick={() => setHelp(h)}
                  className={cn("pb-0.5 text-[12px]", help === h ? "font-semibold text-foreground shadow-[inset_0_-2px_0_currentColor]" : "hover:text-foreground")}
                >
                  {t(`calendar.icalHelp.${h}.name`)}
                </button>
              ))}
            </div>
            <ol role="tabpanel" className="mt-1.5 list-decimal space-y-0.5 pl-4 leading-snug">
              {(t(`calendar.icalHelp.${help}.steps`, { returnObjects: true }) as string[]).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
      {feeds.map((f) => (
        <div key={f.id} className="flex min-h-11 items-center gap-4 py-2 pl-6 pr-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px]">{f.name}</div>
            <div className={cn("truncate text-[11px]", f.error ? "text-destructive" : "text-muted-foreground")}>
              {f.error ? f.error : f.readAt ? t("calendar.icalRead", { host: f.host, when: ago(f.readAt) }) : f.host}
            </div>
          </div>
          <button type="button" className={cn(button, "text-destructive")} onClick={() => onRemove(f)}>
            {t("calendar.icalRemove")}
          </button>
        </div>
      ))}
    </>
  );
}

// --- Aparença ------------------------------------------------------------------------------

function AppearanceTab({ settings, onChange }: { settings: Settings; onChange: Props["onChange"] }) {
  const { t } = useTranslation("settings");
  return (
    <>
      <h3 className="mb-1.5 px-1 text-[12px] font-semibold text-muted-foreground">{t("appearance.theme")}</h3>
      <div role="radiogroup" aria-label={t("appearance.theme")} className="grid grid-cols-3 gap-3">
        {THEMES.map((theme) => {
          const selected = settings.theme === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange({ theme: theme.id })}
              className={cn(
                "flex flex-col gap-2 rounded-[10px] bg-background p-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                selected ? "shadow-[0_0_0_2px_var(--mm-text-primary)]" : "shadow-[0_0_0_1px_var(--mm-separator)] hover:shadow-[0_0_0_1px_var(--mm-text-tertiary)]",
              )}
            >
              <div className="flex h-[88px] overflow-hidden rounded-md shadow-[0_0_0_1px_rgb(127_127_127/0.25)]">
                <ThemePreview theme={theme.id} mode="light" />
                <ThemePreview theme={theme.id} mode="dark" />
              </div>
              <div className="flex items-center gap-1.5 px-0.5">
                <span className="flex-1 text-[13px] font-medium">{theme.label}</span>
                {selected && (
                  <span className="grid size-4 place-items-center rounded-full bg-foreground text-background" aria-hidden>
                    <Check className="size-2.5" strokeWidth={3.5} />
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <p className="mb-5 mt-1.5 px-1 text-[11px] leading-snug text-muted-foreground">{t("appearance.themeHint")}</p>
      <Group title={t("appearance.mode")}>
        <Row label={t("appearance.appearance")} hint={t("appearance.appearanceHint")}>
          <Segmented
            value={settings.mode}
            options={[
              { value: "system", label: t("appearance.system") },
              { value: "light", label: t("appearance.light") },
              { value: "dark", label: t("appearance.dark") },
            ]}
            onChange={(mode) => onChange({ mode })}
          />
        </Row>
      </Group>
      <Group title={t("appearance.layout")}>
        <Row label={t("appearance.primaryPanel")} hint={t("appearance.primaryPanelHint")}>
          <Segmented
            value={settings.primaryPanel}
            options={[
              { value: "notes", label: t("appearance.notes") },
              { value: "transcript", label: t("appearance.transcript") },
            ]}
            onChange={(primaryPanel) => onChange({ primaryPanel })}
          />
        </Row>
      </Group>
    </>
  );
}

/** Half of a theme card: a tiny window drawn with that theme's own tokens. */
function ThemePreview({ theme, mode }: { theme: Theme; mode: "light" | "dark" }) {
  const line = mode === "light" ? "bg-black/[0.12]" : "bg-white/[0.12]";
  return (
    <div data-theme={theme} data-mode={mode} className="flex flex-1 bg-mm-background">
      <div className="flex w-5 flex-col gap-1 bg-mm-sidebar px-[3px] py-2">
        <span className="h-1 rounded-[2px] bg-mm-sidebar-selection-bar" />
        <span className={cn("h-1 rounded-[2px]", line)} />
        <span className={cn("h-1 rounded-[2px]", line)} />
      </div>
      <div className="flex flex-1 flex-col gap-[5px] px-1.5 py-2">
        <span className="h-1.5 w-4 self-end rounded-[3px] bg-mm-accent" />
        <span className={cn("h-1 w-4/5 rounded-[2px]", line)} />
        <span className={cn("h-1 w-3/5 rounded-[2px]", line)} />
        <span className={cn("h-1 w-[70%] rounded-[2px]", line)} />
      </div>
    </div>
  );
}

// --- Àudio ---------------------------------------------------------------------------------

function AudioTab({ open, settings, onChange, recording }: { open: boolean; settings: Settings; onChange: Props["onChange"]; recording: boolean }) {
  const { t } = useTranslation("settings");
  const [microphones, setMicrophones] = useState<string[]>([]);
  useEffect(() => {
    // Refresh every time the window opens: devices come and go (AirPods, USB mics…).
    if (open && backend.isTauri()) backend.listMicrophones().then(setMicrophones).catch(() => setMicrophones([]));
  }, [open]);
  const missing = settings.micDevice && !microphones.includes(settings.micDevice);

  const chooseFolder = async () => {
    const dir = await openDialog({ directory: true, defaultPath: settings.recordingsDir ?? undefined, title: t("audio.folderDialog") });
    if (typeof dir === "string") onChange({ recordingsDir: dir });
  };

  return (
    <>
      {isMac && <PermissionsGroup open={open} />}
      <Group title={t("audio.sources")}>
        <Row label={t("audio.mic")} hint={t("audio.micHint")}>
          <Switch checked={settings.mic} onCheckedChange={(mic) => onChange({ mic })} />
        </Row>
        {settings.mic && (
          <>
            <Row label={t("audio.device")} hint={missing ? t("audio.deviceMissing") : undefined}>
              <select
                value={settings.micDevice ?? ""}
                onChange={(e) => onChange({ micDevice: e.target.value || null })}
                aria-label={t("audio.mic")}
                className="h-6 max-w-56 truncate rounded-md border border-input bg-background px-1.5 text-[13px]"
              >
                <option value="">{microphones[0] ? t("audio.systemDeviceNamed", { name: microphones[0] }) : t("audio.systemDevice")}</option>
                {microphones.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                {missing && <option value={settings.micDevice!}>{t("audio.disconnectedDevice", { name: settings.micDevice })}</option>}
              </select>
            </Row>
            <Row label={t("audio.inputLevel")} hint={recording ? t("audio.inputLevelInUse") : t("audio.inputLevelHint")}>
              {recording ? <span className="text-[12px] text-muted-foreground">{t("audio.inUse")}</span> : <InputLevel device={settings.micDevice} />}
            </Row>
          </>
        )}
        {capabilities.systemAudio && (
          <Row label={t("audio.system")} hint={t("audio.systemHint")}>
            <Switch checked={settings.system} onCheckedChange={(system) => onChange({ system })} />
          </Row>
        )}
      </Group>
      <Group title={t("audio.recording")}>
        <Row label={t("audio.saveAudio")} hint={t("audio.saveAudioHint")}>
          <Switch checked={settings.saveAudio} onCheckedChange={(saveAudio) => onChange({ saveAudio })} />
        </Row>
        <Row label={t("audio.folder")} hint={settings.recordingsDir ?? t("audio.defaultFolder")}>
          <span className="flex shrink-0 gap-1.5">
            {settings.recordingsDir && (
              <button type="button" onClick={() => onChange({ recordingsDir: null })} className="h-6 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10">
                {t("audio.resetFolder")}
              </button>
            )}
            <button
              type="button"
              onClick={chooseFolder}
              disabled={!backend.isTauri()}
              className="h-6 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted disabled:opacity-50"
            >
              {t("audio.choose")}
            </button>
          </span>
        </Row>
      </Group>
    </>
  );
}

/** "La teva veu" (voice.rs): saved or not, record it (again), delete it. */
function VoiceRow({ open, device, recording }: { open: boolean; device: string | null; recording: boolean }) {
  const { t } = useTranslation("settings");
  const [at, setAt] = useState<number | null>(null);
  const [recorder, setRecorder] = useState(false);
  useEffect(() => {
    if (open && backend.isTauri()) backend.voiceStatus().then(setAt).catch(() => setAt(null));
  }, [open]);
  const remove = async () => {
    const confirmed = backend.isTauri()
      ? await ask(t("transcription.voiceDeleteMessage"), { title: t("transcription.voiceDeleteTitle"), kind: "warning", okLabel: t("transcription.voiceDeleteConfirm"), cancelLabel: t("common:cancel") })
      : window.confirm(t("transcription.voiceDeleteMessage"));
    if (!confirmed) return;
    await backend.deleteVoice().catch((e) => toast.error(String(e)));
    setAt(null);
  };
  const date = at ? new Date(at * 1000).toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric" }) : "";
  const button = "h-6 shrink-0 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted disabled:opacity-50";
  return (
    <>
      <Row label={t("transcription.voice")} hint={at ? t("transcription.voiceSaved", { date }) : t("transcription.voiceNone")}>
        <span className="flex shrink-0 gap-1.5">
          <button type="button" className={button} disabled={recording || !backend.isTauri()} onClick={() => setRecorder(true)}>
            {at ? t("transcription.voiceAgain") : t("transcription.voiceRecord")}
          </button>
          {at && (
            <button type="button" className={cn(button, "text-destructive")} onClick={remove}>
              {t("transcription.voiceDelete")}
            </button>
          )}
        </span>
      </Row>
      <Dialog open={recorder} onOpenChange={setRecorder}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogTitle>{t("onboarding:voice.title")}</DialogTitle>
          <DialogDescription>{t("onboarding:voice.intro")}</DialogDescription>
          <VoiceRecorder device={device} saved={false} onSaved={(when) => setAt(when)} />
          <VoicePrivacy />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** What macOS lets Murmur record, with the way to fix it right there. */
function PermissionsGroup({ open }: { open: boolean }) {
  const { t } = useTranslation("settings");
  const [status, setStatus] = useState<backend.Permissions | null>(null);
  const refresh = () => {
    if (backend.isTauri()) backend.permissionStatus().then(setStatus).catch(() => {});
  };
  useEffect(() => {
    if (!open) return;
    refresh();
    // Coming back from System Settings.
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [open]);
  if (!status) return null;

  const button = "h-6 shrink-0 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted";
  const granted = (
    <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground">
      <Check className="size-3.5" aria-hidden /> {t("permissions.allowed")}
    </span>
  );
  return (
    <Group title={t("permissions.title")}>
      <Row
        label={t("permissions.mic")}
        hint={
          status.microphone === "denied"
            ? t("permissions.micDenied")
            : status.microphone === "undetermined"
              ? t("permissions.micUndetermined")
              : undefined
        }
      >
        {status.microphone === "granted" ? (
          granted
        ) : status.microphone === "undetermined" ? (
          <button type="button" className={button} onClick={() => backend.requestMicrophone().then(refresh)}>
            {t("permissions.allow")}
          </button>
        ) : (
          <button type="button" className={button} onClick={() => backend.openPrivacySettings("microphone")}>
            {t("permissions.openSettings")}
          </button>
        )}
      </Row>
      <Row
        label={t("permissions.systemAudio")}
        hint={
          status.systemAudio === "denied"
            ? t("permissions.systemAudioDenied")
            : status.systemAudio === "undetermined"
              ? t("permissions.systemAudioUndetermined")
              : t("permissions.systemAudioGranted")
        }
      >
        {status.systemAudio === "granted" ? (
          granted
        ) : status.systemAudio === "undetermined" ? (
          <button type="button" className={button} onClick={() => backend.requestSystemAudio().then(refresh)}>
            {t("permissions.allow")}
          </button>
        ) : (
          <button type="button" className={button} onClick={() => backend.openPrivacySettings("systemAudio")}>
            {t("permissions.openSettings")}
          </button>
        )}
      </Row>
      <Row label={t("permissions.screen")} hint={t("permissions.screenHint")}>
        {status.screen ? (
          granted
        ) : (
          <button type="button" className={button} onClick={() => backend.requestScreen().then(refresh)}>
            {t("permissions.allow")}
          </button>
        )}
      </Row>
    </Group>
  );
}

/** Live level of the selected microphone, like macOS's Sound › Input settings. */
function InputLevel({ device }: { device: string | null }) {
  const { t } = useTranslation("settings");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!backend.isTauri()) return;
    let unlisten: (() => void) | undefined;
    let active = true;
    setError(null);
    backend.onMicLevel((rms) => active && setLevel(rms)).then((u) => (unlisten = u));
    backend.startMicMonitor(device).catch((e) => active && setError(String(e)));
    return () => {
      active = false;
      unlisten?.();
      backend.stopMicMonitor().catch(() => {});
      setLevel(0);
    };
  }, [device]);
  if (error) return <span className="max-w-48 text-right text-[11px] text-destructive">{error}</span>;
  // Speech sits around rms 0.01–0.1: map on a log scale to 12 segments.
  const lit = level <= 0 ? 0 : Math.round(Math.max(0, Math.min(1, (Math.log10(level) + 3) / 2.5)) * 12);
  return (
    <div className="flex items-center gap-[3px]" role="meter" aria-label={t("audio.inputLevel")} aria-valuemin={0} aria-valuemax={12} aria-valuenow={lit}>
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} className={cn("h-3.5 w-[7px] rounded-[2px] transition-colors duration-75", i < lit ? (i < 11 ? "bg-mm-toggle-on" : "bg-mm-recording-dot") : "bg-mm-meter-off")} />
      ))}
    </div>
  );
}

// --- Transcripció --------------------------------------------------------------------------

/** Meeting languages, in the order shown; `key` names their strings under transcription.languages. */
const LANGUAGES = MEETING_LANGUAGES;

function TranscriptionTab({ settings, onChange, recording }: { settings: Settings; onChange: Props["onChange"]; recording: boolean }) {
  const { t } = useTranslation("settings");
  const models = useModels();
  const language = LANGUAGES.find((l) => l.value === settings.language) ?? LANGUAGES[2];
  /** A language that needs a model fetches it straight away. */
  const setLanguage = (value: Language) => {
    onChange({ language: value });
    // Catalan: the BSC's Whisper, which writes without punctuation, so the punctuation model too.
    const final = settings.finalPass ? finalModels(value) : [];
    const needed: ModelId[] = [...(value === "en" ? (["english"] as const) : []), ...final, ...(value === "ca" ? (["punctuation"] as const) : [])];
    for (const id of needed) enableWithModel(models, id, true, () => {});
  };
  return (
    <>
      <Group title={t("transcription.languageGroup")}>
        <div className="px-3 py-2.5">
          <div className="text-[13px]" id="language-label">
            {t("transcription.meetingLanguage")}
          </div>
          <div className="mt-2 flex">
            <Segmented
              value={settings.language}
              options={LANGUAGES.map(({ value, key }) => ({ value, label: t(`transcription.languages.${key}`) }))}
              onChange={setLanguage}
              labelledBy="language-label"
            />
          </div>
          <div className="mt-1.5 break-words text-[11px] leading-snug text-muted-foreground">{t(`transcription.languages.${language.key}Hint`)}</div>
        </div>
        {settings.language === "en" && (
          <ModelRow id="english" name={t("transcription.parakeetModel")} enabled onDisable={() => onChange({ language: "ca-es" })} />
        )}
      </Group>
      <GlossaryGroup />
      <Group title={t("transcription.liveSpeakers")}>
        <VoiceRow open device={settings.micDevice} recording={recording} />
        <Row
          label={t("transcription.roomSpeakers")}
          hint={t("transcription.roomSpeakersHint")}
        >
          <Switch checked={settings.roomSpeakers} onCheckedChange={(roomSpeakers) => onChange({ roomSpeakers })} />
        </Row>
        <Row label={t("transcription.maxSpeakers")}>
          <input
            type="number"
            min={1}
            max={10}
            value={settings.maxSpeakers}
            onChange={(e) => onChange({ maxSpeakers: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
            aria-label={t("transcription.maxSpeakers")}
            className="h-6 w-14 rounded-md border border-input bg-background px-2 text-right text-[13px] tabular-nums"
          />
        </Row>
        <Row label={t("transcription.threshold")} hint={t("transcription.thresholdHint")}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0.4}
              max={0.85}
              step={0.05}
              value={settings.threshold}
              onChange={(e) => onChange({ threshold: Number(e.target.value) })}
              className="w-32 accent-primary"
              aria-label={t("transcription.threshold")}
            />
            <span className="w-8 text-right text-[12px] tabular-nums text-muted-foreground">{decimal(settings.threshold, 2)}</span>
            <button
              type="button"
              onClick={() => onChange({ threshold: DEFAULT_SETTINGS.threshold })}
              disabled={settings.threshold === DEFAULT_SETTINGS.threshold}
              title={t("transcription.thresholdDefault", { value: decimal(DEFAULT_SETTINGS.threshold, 2) })}
              className="h-6 rounded-md px-2 text-[12px] text-mm-link hover:bg-black/5 disabled:invisible dark:hover:bg-white/10"
            >
              {t("transcription.reset")}
            </button>
          </div>
        </Row>
      </Group>
      <Group title={t("transcription.afterRecording")}>
        <Row label={t("transcription.askAfter")} hint={t("transcription.askAfterHint")}>
          <Switch checked={settings.askAfter} onCheckedChange={(askAfter) => onChange({ askAfter })} />
        </Row>
        <AfterTable settings={settings} onChange={onChange} />
        <ModelRow id="whisper-ca" name={t("transcription.whisperCaModel")} purpose={t("transcription.whisperCaPurpose")} enabled={settings.finalPass} onDisable={() => {}} />
        <ModelRow id="whisper" name={t("transcription.whisperModel")} purpose={t("transcription.whisperPurpose")} enabled={settings.finalPass} onDisable={() => {}} />
        <Row label={t("transcription.punctuate")} hint={t("transcription.punctuateHint")}>
          <Switch checked={settings.punctuate} onCheckedChange={(on) => enableWithModel(models, "punctuation", on, () => onChange({ punctuate: on }))} />
        </Row>
        <ModelRow id="punctuation" name={t("transcription.punctuationModel")} enabled={settings.punctuate || settings.fileSteps.punctuate} onDisable={() => onChange({ punctuate: false, fileSteps: { ...settings.fileSteps, punctuate: false } })} />
      </Group>
    </>
  );
}

/**
 * What's done when a meeting ends, for recordings (and phones) and for files: what the card
 * "Què en faig ara?" starts ticked, and what's done without asking if it's off. The card changes
 * it each time. Turning on a step that needs a model downloads it.
 */
function AfterTable({ settings, onChange }: { settings: Settings; onChange: Props["onChange"] }) {
  const { t } = useTranslation("settings");
  const models = useModels();
  const rows: { key: keyof AfterSteps; name: string; hint: string; models: () => ModelId[] }[] = [
    { key: "verifySpeakers", name: t("transcription.verifySpeakers"), hint: t("transcription.verifySpeakersHint"), models: () => [] },
    { key: "finalPass", name: t("transcription.finalPass"), hint: t("transcription.finalPassHint"), models: () => finalModels(settings.language) },
    { key: "punctuate", name: t("transcription.punctuate"), hint: t("transcription.punctuateHint"), models: () => ["punctuation"] },
    { key: "summarize", name: t("transcription.summarize"), hint: t("transcription.summarizeHint"), models: () => (settings.coverEngine === "local" ? ["llm"] : []) },
  ];
  const set = (key: keyof AfterSteps, file: boolean, on: boolean) => {
    const apply = () => onChange(file ? { fileSteps: { ...settings.fileSteps, [key]: on } } : { [key]: on });
    const ids = on ? rows.find((r) => r.key === key)!.models() : [];
    if (!ids.length) return apply();
    ids.forEach((id, i) => enableWithModel(models, id, true, i === 0 ? apply : () => {}));
  };
  const box = (key: keyof AfterSteps, file: boolean, label: string) => {
    const on = file ? settings.fileSteps[key] : settings[key];
    return (
      <label className="grid size-6 cursor-default place-items-center">
        <input type="checkbox" className="peer sr-only" checked={on} aria-label={label} onChange={(e) => set(key, file, e.target.checked)} />
        <span
          aria-hidden
          className={cn(
            "grid size-4 place-items-center rounded-[4px] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
            on ? "bg-foreground text-background" : "shadow-[inset_0_0_0_1.5px_var(--mm-separator)]",
          )}
        >
          {on && <Check className="size-[11px]" strokeWidth={3.2} />}
        </span>
      </label>
    );
  };
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="text-[11px] font-semibold text-muted-foreground">
          <th className="py-1.5 pl-3 text-left font-semibold">{t("transcription.afterWhat")}</th>
          <th className="w-24 py-1.5 font-semibold">{t("transcription.afterRecordings")}</th>
          <th className="w-20 py-1.5 pr-2 font-semibold">{t("transcription.afterFiles")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-border">
            <td className="py-2 pl-3 pr-2">
              <div className="text-[13px]">{r.name}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{r.hint}</div>
            </td>
            <td className="text-center align-middle">
              <div className="inline-grid">{box(r.key, false, t("transcription.afterFor", { step: r.name, kind: t("transcription.afterRecordings") }))}</div>
            </td>
            <td className="pr-2 text-center align-middle">
              <div className="inline-grid">{box(r.key, true, t("transcription.afterFor", { step: r.name, kind: t("transcription.afterFiles") }))}</div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Names and brands the transcription spells as written here (glossary.rs). Saved as it changes. */
function GlossaryGroup() {
  const { t } = useTranslation("settings");
  const [terms, setTerms] = useState<string[] | null>(null);
  const [hits, setHits] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (backend.isTauri()) {
      backend.getGlossary().then(setTerms).catch(() => setTerms([]));
      backend.glossaryHits().then(setHits).catch(() => {});
    } else setTerms([]);
  }, []);
  const save = (next: string[]) => {
    setTerms(next);
    if (backend.isTauri()) backend.setGlossary(next).catch((e) => toast.error(String(e)));
  };
  /** Several at once, separated by commas or lines (pasted from a list). */
  const add = () => {
    const next = [...(terms ?? [])];
    for (const term of draft.split(/[,\n]/).map((x) => x.trim().replace(/\s+/g, " "))) {
      if (term && !next.some((x) => x.toLowerCase() === term.toLowerCase())) next.push(term);
    }
    if (next.length !== terms?.length) save(next);
    setDraft("");
  };
  return (
    <Group title={t("transcription.glossary")}>
      <div className="px-3 py-2.5">
        <div className="text-[11px] leading-snug text-muted-foreground">{t("transcription.glossaryHint")}</div>
        <form
          className="mt-2.5 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("transcription.glossaryPlaceholder")}
            aria-label={t("transcription.glossaryNew")}
            className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[13px] placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="h-7 shrink-0 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted disabled:opacity-50"
          >
            {t("transcription.glossaryAdd")}
          </button>
        </form>
        {terms && terms.length > 0 ? (
          <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label={t("transcription.glossary")}>
            {terms.map((term) => (
              <li
                key={term}
                title={hits[term] ? t("transcription.glossaryHits", { count: hits[term] }) : undefined}
                className="inline-flex h-[22px] items-center gap-1 rounded-[5px] bg-mm-fill-subtle pl-[7px] pr-[3px] text-[12px] font-medium"
              >
                {term}
                {/* How many times it was corrected: the words that earn their place. */}
                {!!hits[term] && <span className="text-[11px] font-normal tabular-nums text-mm-text-tertiary">{hits[term]}</span>}
                <button
                  type="button"
                  onClick={() => save(terms.filter((x) => x !== term))}
                  aria-label={t("transcription.glossaryRemove", { term })}
                  className="grid size-4 place-items-center rounded-[3px] text-mm-text-tertiary hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          terms && <div className="mt-2.5 text-[12px] text-muted-foreground">{t("transcription.glossaryEmpty")}</div>
        )}
      </div>
    </Group>
  );
}

// --- Intel·ligència ------------------------------------------------------------------------

function IntelligenceTab({
  settings,
  onChange,
  meeting,
  onLlmLoaded,
}: {
  settings: Settings;
  onChange: Props["onChange"];
  meeting: Meeting | null;
  onLlmLoaded: () => void;
}) {
  const { t } = useTranslation("settings");
  const models = useModels();
  const cloud = useCloud();
  const provider = settings.coverEngine === "local" ? null : settings.coverEngine;
  const ready = provider ? !!cloud.status[provider] : !!models.status.llm?.installed;
  return (
    <>
      <Group title={t("intelligence.cover")}>
        <Row
          label={t("intelligence.summarize")}
          hint={t("intelligence.summarizeHint")}
        >
          <Switch
            checked={settings.summarize}
            onCheckedChange={(on) => (provider ? onChange({ summarize: on }) : enableWithModel(models, "llm", on, () => onChange({ summarize: on })))}
          />
        </Row>
        <Row
          label={<span id="cover-engine-label">{t("intelligence.engine")}</span>}
          hint={provider ? t("intelligence.engineCloudHint", { provider: t(`intelligence.companies.${provider}`) }) : t("intelligence.engineLocalHint")}
        >
          {/* A native menu, not a segmented control: the providers don't fit side by side. */}
          <select
            value={settings.coverEngine}
            onChange={(e) => {
              const coverEngine = e.target.value as Settings["coverEngine"];
              onChange({ coverEngine });
              // Back to the local model: fetch it if the cover is on and it isn't there.
              if (coverEngine === "local" && settings.summarize) enableWithModel(models, "llm", true, () => {});
            }}
            aria-labelledby="cover-engine-label"
            className="h-6 max-w-56 shrink-0 truncate rounded-md border border-input bg-background px-1.5 text-[13px]"
          >
            <option value="local">{t("intelligence.engineLocal")}</option>
            <optgroup label={t("intelligence.engineCloud")}>
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {t(`intelligence.providers.${p}`)}
                </option>
              ))}
            </optgroup>
          </select>
        </Row>
        {provider ? (
          <CloudRow key={provider} provider={provider} settings={settings} onChange={onChange} />
        ) : (
          <ModelRow id="llm" name={t("intelligence.gemmaModel")} enabled={settings.summarize} onDisable={() => onChange({ summarize: false })} />
        )}
        <Row label={<span id="cover-language-label">{t("intelligence.coverLanguage")}</span>} hint={t("intelligence.coverLanguageHint")}>
          <Segmented
            value={settings.coverLanguage}
            options={[
              { value: "interface", label: t("intelligence.coverLanguageInterface") },
              { value: "meeting", label: t("intelligence.coverLanguageMeeting") },
            ]}
            onChange={(coverLanguage) => onChange({ coverLanguage })}
            labelledBy="cover-language-label"
          />
        </Row>
      </Group>
      <p className="-mt-3 mb-5 flex gap-1.5 px-1 text-[11px] leading-snug text-muted-foreground">
        {provider ? <CloudUpload className="mt-px size-3 shrink-0" aria-hidden /> : <Lock className="mt-px size-3 shrink-0" aria-hidden />}
        <span>
          {provider === "openrouter"
            ? t("intelligence.privacyRouter")
            : provider
              ? t("intelligence.privacyCloud", { provider: t(`intelligence.companies.${provider}`) })
              : t("intelligence.privacy")}
        </span>
      </p>
      <PromptsEditor
        settings={settings}
        onChange={onChange}
        meeting={meeting}
        ready={ready}
        blockedHint={provider ? t("prompts.needKey") : t("prompts.needModel")}
        onLlmLoaded={onLlmLoaded}
      />
    </>
  );
}

/**
 * Claude, OpenAI, Gemini or OpenRouter under "Qui l'escriu": the API key (checked, then saved to the keychain; it
 * never comes back here) and, once connected, the model.
 */
function CloudRow({ provider, settings, onChange }: { provider: CloudProvider; settings: Settings; onChange: Props["onChange"] }) {
  const { t } = useTranslation("settings");
  const cloud = useCloud();
  const hint = cloud.status[provider];
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const company = t(`intelligence.companies.${provider}`);

  useEffect(() => {
    if (hint) loadCloudModels(provider);
  }, [hint, provider]);

  const connect = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await connectCloud(provider, key);
      setKey("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    const message = t("cloud.disconnectMessage", { company });
    const confirmed = backend.isTauri()
      ? await ask(message, { title: t("cloud.disconnectTitle"), kind: "warning", okLabel: t("cloud.disconnect"), cancelLabel: t("common:cancel") })
      : window.confirm(message);
    if (confirmed) await disconnectCloud(provider).catch((e) => toast.error(String(e)));
  };

  const sub = "bg-black/[0.015] py-2 pl-6 pr-3 dark:bg-white/[0.02]";
  const button = "h-6 shrink-0 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted disabled:opacity-50";

  if (!hint) {
    return (
      <div className={sub}>
        <label htmlFor="cloud-key" className="text-[12px]">
          {t("cloud.keyLabel", { company })}
        </label>
        <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {t(`cloud.keyHints.${provider}`)}{" "}
          <button type="button" onClick={() => openLink(KEYS_URL[provider])} className="text-mm-link hover:underline">
            {t("cloud.createKey", { site: new URL(KEYS_URL[provider]).host })}
          </button>
        </div>
        <form
          className="mt-1.5 flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            connect();
          }}
        >
          <input
            id="cloud-key"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={KEY_PLACEHOLDER[provider]}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!error}
            aria-describedby={error ? "cloud-key-error" : undefined}
            className="h-6 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive"
          />
          <button type="submit" className={button} disabled={busy || !key.trim()}>
            {busy ? t("cloud.checking") : t("cloud.connect")}
          </button>
        </form>
        {error && (
          <p id="cloud-key-error" role="alert" className="mt-1 text-[11px] text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  const list = cloud.models[provider];
  const model = cloudModel(provider, settings);
  return (
    <>
      <div className={cn(sub, "flex items-center gap-4")}>
        <div className="min-w-0 flex-1">
          <div className="text-[12px]">{t("cloud.connected", { company })}</div>
          <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{t("cloud.keySaved", { hint })}</div>
        </div>
        <button type="button" className={cn(button, "text-destructive")} onClick={disconnect}>
          {t("cloud.disconnect")}
        </button>
      </div>
      <Row label={<span id="cloud-model-label">{t("cloud.model")}</span>} hint={cloud.errors[provider] ?? t("cloud.modelHint")}>
        <ModelPicker
          provider={provider}
          value={model}
          models={list}
          onChange={(id) => onChange({ cloudModels: { ...settings.cloudModels, [provider]: id } })}
          labelledBy="cloud-model-label"
        />
      </Row>
    </>
  );
}

// --- Exportar ------------------------------------------------------------------------------

/**
 * Where meetings go besides Murmur: Markdown files in a folder, and an Obsidian vault (found from
 * Obsidian's own list, lib/obsidian.ts). Each can take every meeting on its own when it's done.
 */
function ExportTab({ settings, onChange }: { settings: Settings; onChange: Props["onChange"] }) {
  const { t } = useTranslation("settings");
  const [vaults, setVaults] = useState<backend.ObsidianVault[] | null>(null);
  useEffect(() => {
    if (backend.isTauri()) backend.obsidianVaults().then(setVaults).catch(() => setVaults([]));
    else setVaults([]);
  }, []);
  const chooseMarkdownFolder = async () => {
    const dir = await openDialog({ directory: true, defaultPath: settings.markdownDir ?? undefined, title: t("transcription.markdownFolderDialog") });
    if (typeof dir !== "string") return false;
    onChange({ markdownDir: dir });
    return true;
  };
  const chooseVaultFolder = async () => {
    const dir = await openDialog({ directory: true, defaultPath: settings.obsidianVault ?? undefined, title: t("export.vaultDialog") });
    if (typeof dir !== "string") return false;
    onChange({ obsidianVault: dir });
    return true;
  };
  const vaultName = (path: string) => vaults?.find((v) => v.path === path)?.name ?? path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  // Obsidian shows only if it's installed (it has a list of vaults) or a vault was chosen by hand.
  const obsidian = !!vaults?.length || !!settings.obsidianVault;
  return (
    <>
      <p className="mb-4 px-1 text-[12px] leading-snug text-muted-foreground">{t("export.intro")}</p>
      <Group title={t("transcription.markdownGroup")}>
        <Row label={t("transcription.saveMarkdown")} hint={t("transcription.saveMarkdownHint")}>
          <Switch
            checked={settings.saveMarkdown && !!settings.markdownDir}
            onCheckedChange={async (on) => {
              if (on && !settings.markdownDir && !(await chooseMarkdownFolder())) return;
              onChange({ saveMarkdown: on });
            }}
          />
        </Row>
        <div className="px-3 py-2.5">
          <div className="text-[13px]" id="markdown-content-label">
            {t("transcription.markdownContent")}
          </div>
          <div className="mt-2 flex">
            <Segmented
              value={settings.markdownContent}
              options={(["all", "summary", "transcript"] as const).map((value) => ({ value, label: t(`transcription.markdownContents.${value}`) }))}
              onChange={(markdownContent) => onChange({ markdownContent })}
              labelledBy="markdown-content-label"
            />
          </div>
          <div className="mt-1.5 break-words text-[11px] leading-snug text-muted-foreground">{t("transcription.markdownContentHint")}</div>
        </div>
        <Row label={t("transcription.markdownFolder")} hint={settings.markdownDir ?? t("transcription.markdownNoFolder")}>
          <button
            type="button"
            onClick={chooseMarkdownFolder}
            disabled={!backend.isTauri()}
            className="h-6 shrink-0 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted disabled:opacity-50"
          >
            {t("audio.choose")}
          </button>
        </Row>
      </Group>
      {obsidian && (
        <Group title="Obsidian">
          <Row label={t("export.vault")} hint={settings.obsidianVault ?? t("export.noVault")}>
            <select
              aria-label={t("export.vault")}
              value={settings.obsidianVault ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__other") void chooseVaultFolder();
                else onChange({ obsidianVault: v || null });
              }}
              className="h-6 max-w-[200px] shrink-0 truncate rounded-md border border-input bg-background px-1.5 text-[13px]"
            >
              <option value="">{t("export.chooseVault")}</option>
              {vaults?.map((v) => (
                <option key={v.path} value={v.path}>
                  {v.name}
                </option>
              ))}
              {settings.obsidianVault && !vaults?.some((v) => v.path === settings.obsidianVault) && <option value={settings.obsidianVault}>{vaultName(settings.obsidianVault)}</option>}
              <option value="__other">{t("export.otherFolder")}</option>
            </select>
          </Row>
          <Row label={t("export.folder")} hint={t("export.folderHint")}>
            <input
              type="text"
              aria-label={t("export.folder")}
              value={settings.obsidianFolder}
              placeholder={t("export.folderRoot")}
              onChange={(e) => onChange({ obsidianFolder: e.target.value })}
              className="h-6 w-[160px] shrink-0 rounded-md border border-input bg-background px-2 text-[13px]"
            />
          </Row>
          <Row label={t("export.obsidianAuto")} hint={t("export.obsidianAutoHint")}>
            <Switch checked={settings.obsidianAuto && !!settings.obsidianVault} disabled={!settings.obsidianVault} onCheckedChange={(on) => onChange({ obsidianAuto: on })} aria-label={t("export.obsidianAuto")} />
          </Row>
          <Row label={t("export.people")} hint={t("export.peopleHint")}>
            <Switch checked={settings.obsidianPeople} onCheckedChange={(on) => onChange({ obsidianPeople: on })} aria-label={t("export.people")} />
          </Row>
        </Group>
      )}
      <p className="-mt-3 mb-5 flex gap-1.5 px-1 text-[11px] leading-snug text-muted-foreground">
        <Lock className="mt-px size-3 shrink-0" aria-hidden />
        <span>{t("export.privacy")}</span>
      </p>
      <NotionGroup settings={settings} onChange={onChange} />
    </>
  );
}

/**
 * Notion (notion.rs): "Connecta amb Notion" signs in in the browser, with nothing to create or
 * paste; then the page meetings go under, found as you type, and whether each one goes on its own.
 */
function NotionGroup({ settings, onChange }: { settings: Settings; onChange: Props["onChange"] }) {
  const { t } = useTranslation("settings");
  const [status, setStatus] = useState<backend.NotionStatus | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<backend.NotionPlace[] | null>(null);
  useEffect(() => {
    if (backend.isTauri()) backend.notionStatus().then(setStatus).catch(() => {});
  }, []);
  // The picker: recent pages at first, then what matches as you type.
  useEffect(() => {
    if (!picking) return;
    let current = true;
    setPlaces(null);
    const timer = window.setTimeout(() => {
      backend
        .notionFind(query)
        .then((p) => current && setPlaces(p))
        .catch((e) => {
          if (current) setPlaces([]);
          toast.error(String(e));
        });
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [picking, query]);

  const connect = async () => {
    setWaiting(true);
    try {
      const workspace = await backend.notionConnect();
      setStatus({ connected: true, workspace });
      toast(t("export.notionConnected", { workspace }));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setWaiting(false);
    }
  };
  const disconnect = async () => {
    const confirmed = await ask(t("export.notionDisconnectMessage"), { title: t("export.notionDisconnectTitle"), kind: "warning", okLabel: t("export.notionDisconnect"), cancelLabel: t("common:cancel") });
    if (!confirmed) return;
    await backend.notionDisconnect().catch((e) => toast.error(String(e)));
    setStatus({ connected: false, workspace: null });
    onChange({ notionAuto: false });
  };

  return (
    <>
      <Group title="Notion">
        {status?.connected ? (
          <Row label={t("export.notionWorkspace", { workspace: status.workspace ?? "Notion" })} hint={t("export.notionConnectedHint")}>
            <button type="button" className={cn(SMALL_BUTTON, "text-destructive")} onClick={() => void disconnect()}>
              {t("export.notionDisconnect")}
            </button>
          </Row>
        ) : (
          <Row label={t("export.notionConnect")} hint={waiting ? t("export.notionWaiting") : t("export.notionConnectHint")}>
            {waiting ? (
              <button type="button" className={SMALL_BUTTON} onClick={() => void backend.notionCancel()}>
                {t("common:cancel")}
              </button>
            ) : (
              <button type="button" className={SMALL_BUTTON} disabled={!backend.isTauri()} onClick={() => void connect()}>
                {t("export.notionConnectButton")}
              </button>
            )}
          </Row>
        )}
        {status?.connected && (
          <>
            <Row label={t("export.notionPage")} hint={settings.notionPage?.title ?? t("export.notionPrivate")}>
              <button type="button" className={SMALL_BUTTON} aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
                {picking ? t("common:cancel") : t("export.chooseVault")}
              </button>
            </Row>
            {picking && (
              <div className="px-3 py-2.5">
                <input
                  type="search"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("export.notionSearch")}
                  aria-label={t("export.notionSearch")}
                  className="h-7 w-full rounded-md border border-input bg-background px-2 text-[13px]"
                />
                <ul className="mt-2 max-h-48 overflow-y-auto" aria-busy={places === null}>
                  {places === null ? (
                    <li className="px-2 py-1.5 text-[12px] text-muted-foreground">{t("export.notionSearching")}</li>
                  ) : places.length ? (
                    places.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onChange({ notionPage: { id: p.id, title: p.title } });
                            setPicking(false);
                          }}
                          className="w-full truncate rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
                        >
                          {p.title}
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className="px-2 py-1.5 text-[12px] text-muted-foreground">{t("export.notionNothing")}</li>
                  )}
                </ul>
                {settings.notionPage && (
                  <button type="button" className="mt-1 px-2 text-[12px] text-mm-link hover:underline" onClick={() => (onChange({ notionPage: null }), setPicking(false))}>
                    {t("export.notionUsePrivate")}
                  </button>
                )}
              </div>
            )}
            <Row label={t("export.notionAuto")} hint={t("export.obsidianAutoHint")}>
              <Switch checked={settings.notionAuto} onCheckedChange={(on) => onChange({ notionAuto: on })} aria-label={t("export.notionAuto")} />
            </Row>
          </>
        )}
      </Group>
      <p className="-mt-3 mb-5 flex gap-1.5 px-1 text-[11px] leading-snug text-muted-foreground">
        <CloudUpload className="mt-px size-3 shrink-0" aria-hidden />
        <span>{t("export.notionPrivacy")}</span>
      </p>
    </>
  );
}

// --- Compartir -----------------------------------------------------------------------------

/**
 * Where shared links are published: Murmur sets up a Worker on the user's Cloudflare account
 * from an API token (share.rs `setup`), or connects to one published with share/setup.sh.
 */
function ShareTab() {
  const { t } = useTranslation("settings");
  const status = useShareStatus();
  const [manual, setManual] = useState(false);
  const [notReady, setNotReady] = useState(false);

  const disconnect = async () => {
    const message = t("share.disconnectMessage");
    const confirmed = backend.isTauri()
      ? await ask(message, { title: t("share.disconnectTitle"), kind: "warning", okLabel: t("share.disconnect"), cancelLabel: t("common:cancel") })
      : window.confirm(message);
    if (confirmed) await disconnectShare().catch((e) => toast.error(String(e)));
  };

  return (
    <>
      <p className="mb-4 px-1 text-[12px] leading-snug text-muted-foreground">{t("share.intro")}</p>
      <Group title={t("share.group")}>
        {status ? (
          <div className="flex min-h-11 items-center gap-4 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px]">{status.managed ? t("share.published", { host: new URL(status.url).host }) : t("share.connected", { host: new URL(status.url).host })}</div>
              <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                {notReady ? t("share.notReadyYet") : status.managed ? t("share.publishedHint") : t("share.keySaved", { hint: status.hint })}
              </div>
            </div>
            <button type="button" className={cn(SMALL_BUTTON, "text-destructive")} onClick={disconnect}>
              {t("share.disconnect")}
            </button>
          </div>
        ) : manual ? (
          <ManualWorker onBack={() => setManual(false)} />
        ) : (
          <CloudflareSetup onDone={(ready) => setNotReady(!ready)} onManual={() => setManual(true)} />
        )}
      </Group>
      <p className="-mt-3 mb-5 flex gap-1.5 px-1 text-[11px] leading-snug text-muted-foreground">
        <Lock className="mt-px size-3 shrink-0" aria-hidden />
        <span>{t("share.privacy")}</span>
      </p>
    </>
  );
}

// --- Claude --------------------------------------------------------------------------------

/**
 * The Claude connector (mcp.rs): Claude Desktop and Claude Code start Murmur with `--mcp` to read
 * and search the meetings and transcribe files on this Mac. Off until the user adds it.
 */
function ClaudeTab({ open }: { open: boolean }) {
  const { t } = useTranslation("settings");
  const [status, setStatus] = useState<backend.ClaudeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  useEffect(() => {
    if (open && backend.isTauri()) backend.claudeStatus().then(setStatus).catch(() => {});
  }, [open]);
  // Outside the app (UI work), the path the installed app has.
  const command = status?.command ?? "/Applications/Murmur.app/Contents/MacOS/transcriptor";
  const codeCommand = `claude mcp add murmur --scope user -- "${command}" --mcp`;
  const desktopJson = JSON.stringify({ mcpServers: { murmur: { command, args: ["--mcp"] } } }, null, 2);

  const toggleDesktop = async (on: boolean) => {
    setBusy(true);
    try {
      setStatus(await backend.claudeDesktopConnect(on));
      toast(on ? t("claude.desktopAdded") : t("claude.desktopRemoved"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = (text: string) => copyText(text).then(() => toast(t("claude.copied")));

  return (
    <>
      <p className="mb-4 px-1 text-[12px] leading-snug text-muted-foreground">{t("claude.intro")}</p>
      <Group title={t("claude.desktop")}>
        <Row
          label={t("claude.desktopToggle")}
          hint={status && !status.desktopInstalled ? t("claude.desktopMissing") : status?.desktopConnected ? t("claude.desktopOnHint") : t("claude.desktopHint")}
        >
          <Switch
            checked={!!status?.desktopConnected}
            disabled={busy || !status || !status.desktopInstalled}
            onCheckedChange={toggleDesktop}
            aria-label={t("claude.desktopToggle")}
          />
        </Row>
        <div className="px-3 py-2">
          <button type="button" className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground" aria-expanded={manual} onClick={() => setManual((m) => !m)}>
            <ChevronRight className={cn("size-3.5 transition-transform", manual && "rotate-90")} aria-hidden /> {t("claude.manual")}
          </button>
          {manual && (
            <div className="mt-2">
              <p className="text-[11px] leading-snug text-muted-foreground">{t("claude.manualHint")}</p>
              <CodeBlock text={desktopJson} onCopy={() => copy(desktopJson)} label={t("claude.copy")} />
            </div>
          )}
        </div>
      </Group>
      <Group title={t("claude.code")}>
        <div className="px-3 py-2.5">
          <p className="text-[12px] leading-snug">{t("claude.codeHint")}</p>
          <CodeBlock text={codeCommand} onCopy={() => copy(codeCommand)} label={t("claude.copy")} />
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{t("claude.codeCheck")}</p>
        </div>
      </Group>
      <Group title={t("claude.ask")}>
        <ul className="space-y-1.5 px-3 py-2.5 text-[12px] leading-snug">
          {(["ask1", "ask2", "ask3", "ask4"] as const).map((k) => (
            <li key={k} className="text-foreground">
              {t(`claude.${k}`)}
            </li>
          ))}
        </ul>
        <p className="px-3 py-2 text-[11px] leading-snug text-muted-foreground">{t("claude.tools")}</p>
      </Group>
      <p className="-mt-3 mb-5 flex gap-1.5 px-1 text-[11px] leading-snug text-muted-foreground">
        <Lock className="mt-px size-3 shrink-0" aria-hidden />
        <span>{t("claude.privacy")}</span>
      </p>
    </>
  );
}

// --- Mòbil ---------------------------------------------------------------------------------

/**
 * Phones paired with this computer (mobile.rs, docs/EMPARELLAR.md): the list, "Connecta un mòbil"
 * with the one-time QR, and unpairing. Nothing listens on the network until a phone is paired.
 */
function MobileTab({ open }: { open: boolean }) {
  const { t } = useTranslation("settings");
  const [status, setStatus] = useState<backend.MobileStatus | null>(null);
  const [code, setCode] = useState<backend.PairingCode | null>(null);
  const [left, setLeft] = useState(0);
  const refresh = () => backend.mobileStatus().then(setStatus).catch(() => {});
  useEffect(() => {
    if (open && backend.isTauri()) void refresh();
  }, [open]);
  // A phone read the code: show it in the list and put the code away.
  useEffect(() => {
    if (!backend.isTauri()) return;
    const unlisten = backend.onMobilePaired((phone) => {
      setCode(null);
      toast(t("mobile.paired", { name: phone.name }));
      void refresh();
    });
    // A phone synced: its "Sincronitzat el…" moves on with the tab open.
    const unlistenStatus = backend.onMobileStatus(setStatus);
    return () => {
      void unlisten.then((f) => f());
      void unlistenStatus.then((f) => f());
    };
  }, []);
  // The code's countdown; it goes away when it expires.
  useEffect(() => {
    if (!code) return;
    const until = Date.now() + code.expiresIn * 1000;
    const tick = () => {
      const s = Math.max(0, Math.round((until - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) setCode(null);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [code]);
  // Closing the settings with a code on screen withdraws it.
  useEffect(() => {
    if (!open && code) {
      setCode(null);
      backend.mobileCancelPairing().catch(() => {});
    }
  }, [open]);

  const connect = async () => {
    try {
      setCode(await backend.mobileStartPairing());
    } catch (e) {
      toast.error(String(e));
    }
  };
  const cancel = () => {
    setCode(null);
    backend.mobileCancelPairing().catch(() => {});
  };
  const unpair = async (phone: backend.Phone) => {
    const message = t("mobile.unpairMessage", { name: phone.name });
    const confirmed = backend.isTauri()
      ? await ask(message, { title: t("mobile.unpairTitle", { name: phone.name }), kind: "warning", okLabel: t("mobile.unpair"), cancelLabel: t("common:cancel") })
      : false;
    if (!confirmed) return;
    await backend.mobileUnpair(phone.id).catch((e) => toast.error(String(e)));
    void refresh();
  };
  const when = (s: number) => new Date(s * 1000).toLocaleString(locale(), { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <p className="mb-4 px-1 text-[12px] leading-snug text-muted-foreground">{t("mobile.intro")}</p>
      <Group title={t("mobile.group")}>
        {status?.phones.length ? (
          status.phones.map((phone) => (
            <Row key={phone.id} label={phone.name} hint={phone.lastSeen ? t("mobile.lastSeen", { when: when(phone.lastSeen) }) : t("mobile.pairedOn", { when: when(phone.pairedAt) })}>
              <button type="button" className={cn(SMALL_BUTTON, "text-destructive")} onClick={() => void unpair(phone)}>
                {t("mobile.unpair")}
              </button>
            </Row>
          ))
        ) : (
          <div className="px-3 py-2.5 text-[12px] text-muted-foreground">{t("mobile.none")}</div>
        )}
        {status?.phones.length ? (
          <Row label={<span id="mobile-history-label">{t("mobile.history")}</span>} hint={t("mobile.historyHint")}>
            <select
              value={status.history}
              onChange={(e) => {
                const history = e.target.value as backend.MobileHistory;
                setStatus({ ...status, history });
                backend.mobileSetHistory(history).catch((err) => toast.error(String(err)));
              }}
              aria-labelledby="mobile-history-label"
              className="h-6 max-w-56 shrink-0 truncate rounded-md border border-input bg-background px-1.5 text-[13px]"
            >
              {(["none", "week", "month", "quarter", "all"] as const).map((h) => (
                <option key={h} value={h}>
                  {t(`mobile.historyOptions.${h}`)}
                </option>
              ))}
            </select>
          </Row>
        ) : null}
        {code ? (
          <div className="flex items-center gap-5 px-3 py-4">
            <div
              role="img"
              aria-label={t("mobile.qrLabel")}
              className="size-[168px] shrink-0 rounded-[10px] bg-mm-qr-light p-3 text-mm-qr-dark [&>svg]:size-full"
              dangerouslySetInnerHTML={{ __html: code.svg }}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{t("mobile.scanTitle")}</div>
              <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{t("mobile.scanHint", { computer: status?.computer ?? "" })}</p>
              <p className="mt-2 text-[11px] tabular-nums text-muted-foreground">{t("mobile.expires", { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` })}</p>
              <div className="mt-3 flex gap-2">
                <button type="button" className={SMALL_BUTTON} onClick={cancel}>
                  {t("common:cancel")}
                </button>
                {import.meta.env.DEV && (
                  <button type="button" className={SMALL_BUTTON} onClick={() => copyText(code.uri).then(() => toast(t("claude.copied")), () => toast.error(t("mobile.copyFailed")))}>
                    {t("mobile.copyCode")}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="px-3 py-2.5">
            <button type="button" className={SMALL_BUTTON} onClick={() => void connect()}>
              {t("mobile.connect")}
            </button>
          </div>
        )}
      </Group>
      <p className="-mt-3 mb-5 flex gap-1.5 px-1 text-[11px] leading-snug text-muted-foreground">
        <Lock className="mt-px size-3 shrink-0" aria-hidden />
        <span>{t("mobile.privacy")}</span>
      </p>
      {/* Windows asks before letting the phone in, and blocks it on a "public" network. */}
      {OS === "windows" && (
        <p className="-mt-3 mb-5 flex gap-1.5 px-1 text-[11px] leading-snug text-muted-foreground">
          <Wifi className="mt-px size-3 shrink-0" aria-hidden />
          <span>{t("mobile.windowsNetwork")}</span>
        </p>
      )}
    </>
  );
}

/** A command or a piece of configuration to copy, as it has to be typed. */
function CodeBlock({ text, onCopy, label }: { text: string; onCopy: () => void; label: string }) {
  return (
    <div className="relative mt-2 rounded-md border border-border bg-mm-fill-subtle">
      <pre className="whitespace-pre-wrap break-all px-2.5 py-2 pr-10 font-mono text-[11px] leading-relaxed">{text}</pre>
      <button
        type="button"
        onClick={onCopy}
        aria-label={label}
        title={label}
        className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
      >
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}

const SMALL_BUTTON = "h-6 shrink-0 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted disabled:opacity-50";
const FIELD =
  "mt-1 h-6 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive";
const SETUP_STEPS: ShareSetupStep[] = ["storage", "worker", "address", "check"];

/** Two steps: create a token on Cloudflare (the form comes filled in), then paste it here. */
function CloudflareSetup({ onDone, onManual }: { onDone: (ready: boolean) => void; onManual: () => void }) {
  const { t } = useTranslation("settings");
  const [token, setToken] = useState("");
  const [accounts, setAccounts] = useState<CfAccount[] | null>(null);
  const [account, setAccount] = useState("");
  const [step, setStep] = useState<ShareSetupStep | "token" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!backend.isTauri()) return;
    const off = backend.onShareSetup(setStep);
    return () => {
      off.then((f) => f());
    };
  }, []);

  const openCloudflare = () => {
    if (backend.isTauri()) backend.shareTokenUrl().then(openLink).catch(() => {});
  };

  const publish = async (on: CfAccount) => {
    try {
      const done = await setupShare(token, on);
      setToken("");
      onDone(done.ready);
    } catch (e) {
      setError(String(e));
    } finally {
      setStep(null);
    }
  };

  const start = async () => {
    if (!token.trim()) return;
    setError(null);
    // Which account: asked only when the token can use more than one.
    if (accounts && account) return publish(accounts.find((a) => a.id === account)!);
    setStep("token");
    try {
      const list = await backend.shareCfAccounts(token);
      if (list.length === 1) return await publish(list[0]);
      setAccounts(list);
      setAccount(list[0].id);
      setStep(null);
    } catch (e) {
      setError(String(e));
      setStep(null);
    }
  };

  const busy = step !== null;
  const index = step && step !== "token" ? SETUP_STEPS.indexOf(step) : -1;
  return (
    <div className="px-3 py-2.5">
      <ol className="space-y-3">
        <li className="flex gap-2.5">
          <span className="mt-px grid size-[18px] shrink-0 place-items-center rounded-full bg-mm-fill-subtle text-[11px] font-semibold tabular-nums">1</span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px]">{t("share.step1")}</div>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t("share.step1Hint")}</p>
            <button type="button" onClick={openCloudflare} className={cn(SMALL_BUTTON, "mt-1.5")}>
              {t("share.openCloudflare")}
            </button>
          </div>
        </li>
        <li className="flex gap-2.5">
          <span className="mt-px grid size-[18px] shrink-0 place-items-center rounded-full bg-mm-fill-subtle text-[11px] font-semibold tabular-nums">2</span>
          <form
            className="min-w-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              start();
            }}
          >
            <label htmlFor="cf-token" className="text-[13px]">
              {t("share.step2")}
            </label>
            <div className="mt-1 flex items-center gap-1.5">
              <input
                id="cf-token"
                type="password"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setAccounts(null);
                }}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                aria-invalid={!!error}
                aria-describedby={error ? "cf-error" : "cf-token-hint"}
                className={cn(FIELD, "mt-0 flex-1 font-mono")}
              />
              <button type="submit" className={SMALL_BUTTON} disabled={busy || !token.trim()}>
                {busy ? t("share.settingUp") : t("share.setUp")}
              </button>
            </div>
            {accounts && !busy && (
              <label className="mt-2 flex items-center gap-2 text-[12px]">
                {t("share.account")}
                <select value={account} onChange={(e) => setAccount(e.target.value)} className="h-6 min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 text-[13px]">
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name || a.id}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p id="cf-token-hint" className="mt-1 text-[11px] leading-snug text-muted-foreground">
              {t("share.tokenHint")}
            </p>
            {busy && (
              <ul className="mt-2 space-y-1" aria-live="polite">
                {(["token", ...SETUP_STEPS] as const).map((s, i) => {
                  const done = s === "token" ? step !== "token" : i - 1 < index;
                  const active = s === step;
                  return (
                    <li key={s} className={cn("flex items-center gap-2 text-[12px]", !done && !active && "text-muted-foreground")}>
                      {done ? (
                        <Check className="size-3 text-foreground" aria-hidden />
                      ) : active ? (
                        <span className="size-3 animate-spin rounded-full border-[1.5px] border-primary/25 border-t-primary motion-reduce:animate-none" aria-hidden />
                      ) : (
                        <span className="size-3 rounded-full border border-dashed border-mm-text-tertiary" aria-hidden />
                      )}
                      {t(`share.steps.${s}`)}
                    </li>
                  );
                })}
              </ul>
            )}
            {error && (
              <p id="cf-error" role="alert" className="mt-1.5 text-[11px] text-destructive">
                {error}
              </p>
            )}
          </form>
        </li>
      </ol>
      <button type="button" onClick={onManual} className="mt-3 text-[11px] text-mm-link hover:underline">
        {t("share.manual")}
      </button>
    </div>
  );
}

/** A Worker published with share/setup.sh: its address and API key. */
function ManualWorker({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation("settings");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    if (!url.trim() || !key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await connectShare(url, key);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        connect();
      }}
    >
      <label className="block text-[12px]">
        {t("share.url")}
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("share.urlPlaceholder")} autoComplete="off" spellCheck={false} aria-invalid={!!error} className={FIELD} />
      </label>
      <label className="mt-2 block text-[12px]">
        {t("share.key")}
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="mm_…"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!error}
          aria-describedby={error ? "share-error" : undefined}
          className={cn(FIELD, "font-mono")}
        />
      </label>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" onClick={onBack} className="min-w-0 flex-1 text-left text-[11px] text-mm-link hover:underline">
          {t("share.back")}
        </button>
        <button type="submit" className={SMALL_BUTTON} disabled={busy || !url.trim() || !key.trim()}>
          {busy ? t("share.checking") : t("share.connect")}
        </button>
      </div>
      {error && (
        <p id="share-error" role="alert" className="mt-1.5 text-[11px] text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

const openLink = (url: string) => (backend.isTauri() ? openUrl(url) : Promise.resolve(window.open(url, "_blank"))).catch(() => {});

/** Turning a feature on fetches its model if it isn't there yet. */
function enableWithModel(models: ReturnType<typeof useModels>, id: ModelId, on: boolean, apply: () => void) {
  apply();
  const status = models.status[id];
  if (on && status && !status.installed && status.downloadable && !models.downloading[id]) downloadModel(id);
}

/** A model's state under its feature: size, download progress, download/stop/delete. */
function ModelRow({ id, name, purpose, enabled, onDisable }: { id: ModelId; name: string; purpose?: string; enabled: boolean; onDisable: () => void }) {
  const { t } = useTranslation("settings");
  const { status: all, downloading: active } = useModels();
  const status = all[id];
  const downloading = active[id];
  if (!status) return null;

  const remove = async () => {
    const message = t("model.deleteMessage", { name, size: bytes(status.bytes) });
    const confirmed = backend.isTauri()
      ? await ask(message, { title: t("model.deleteTitle"), kind: "warning", okLabel: t("model.deleteConfirm"), cancelLabel: t("common:cancel") })
      : window.confirm(message);
    if (!confirmed) return;
    await deleteModel(id);
    if (enabled) onDisable();
  };

  const button = "h-6 shrink-0 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted disabled:opacity-50";
  let text: string;
  let action: React.ReactNode = null;
  if (downloading) {
    const share = downloading.total ? downloading.done / downloading.total : 0;
    text = t("model.downloading", { percent: Math.floor(share * 100), done: bytes(downloading.done), total: bytes(downloading.total || status.bytes) });
    action = (
      <button type="button" className={button} onClick={() => backend.cancelModelDownload(id)}>
        {t("model.stop")}
      </button>
    );
  } else if (status.installed) {
    text = t("model.downloaded", { size: bytes(status.bytes) });
    action = (
      <button type="button" className={cn(button, "text-destructive")} onClick={remove}>
        {t("model.delete")}
      </button>
    );
  } else if (!status.downloadable) {
    text = t("model.notDownloadable", { size: bytes(status.bytes) });
  } else {
    text = status.downloaded
      ? t("model.paused", { done: bytes(status.downloaded), total: bytes(status.bytes) })
      : t("model.notDownloaded", { size: bytes(status.bytes) });
    action = (
      <span className="flex shrink-0 gap-1.5">
        {status.downloaded > 0 && (
          <button type="button" className="h-6 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10" onClick={remove}>
            {t("model.discard")}
          </button>
        )}
        <button type="button" className={button} onClick={() => downloadModel(id)}>
          {status.downloaded ? t("model.resume") : t("model.download")}
        </button>
      </span>
    );
  }
  return (
    <div className="flex items-center gap-4 bg-black/[0.015] py-2 pl-6 pr-3 dark:bg-white/[0.02]">
      <div className="min-w-0 flex-1">
        <div className="text-[12px]">{name}</div>
        <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
          {purpose && `${purpose} · `}
          {text}
        </div>
        {downloading && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-mm-meter-off" role="progressbar" aria-label={t("model.progress", { name })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor((downloading.done / (downloading.total || 1)) * 100)}>
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${(downloading.done / (downloading.total || 1)) * 100}%` }} />
          </div>
        )}
      </div>
      {action}
    </div>
  );
}

/** Edit the prompt behind each part of the cover and try it on the open meeting. */
function PromptsEditor({
  settings,
  onChange,
  meeting,
  ready,
  blockedHint,
  onLlmLoaded,
}: {
  settings: Settings;
  onChange: Props["onChange"];
  meeting: Meeting | null;
  /** The chosen engine can answer: local model downloaded, or account connected. */
  ready: boolean;
  /** What to do first when it can't. */
  blockedHint: string;
  onLlmLoaded: () => void;
}) {
  const { t } = useTranslation("settings");
  const [openId, setOpenId] = useState<PromptId | null>(null);
  return (
    <section className="mb-5">
      <h3 className="mb-1.5 px-1 text-[12px] font-semibold text-muted-foreground">{t("prompts.title")}</h3>
      <div className="divide-y divide-border rounded-[10px] border border-border bg-background">
        {PROMPTS.map((p) => {
          const edited = !!settings.prompts[p.id]?.trim() && settings.prompts[p.id] !== p.text;
          const expanded = openId === p.id;
          return (
            <div key={p.id}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpenId(expanded ? null : p.id)}
                className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
              >
                <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", expanded && "rotate-90")} aria-hidden />
                <span className="flex-1">{p.label}</span>
                {edited && <span className="rounded bg-mm-fill-subtle px-1.5 py-px text-[11px] font-medium text-foreground">{t("prompts.edited")}</span>}
              </button>
              {expanded && <PromptEditor id={p.id} settings={settings} onChange={onChange} meeting={meeting} ready={ready} blockedHint={blockedHint} onLlmLoaded={onLlmLoaded} />}
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 px-1 text-[11px] leading-snug text-muted-foreground">
        {t("prompts.footnote")}
      </p>
    </section>
  );
}

function PromptEditor({
  id,
  settings,
  onChange,
  meeting,
  ready,
  blockedHint,
  onLlmLoaded,
}: {
  id: PromptId;
  settings: Settings;
  onChange: Props["onChange"];
  meeting: Meeting | null;
  ready: boolean;
  blockedHint: string;
  onLlmLoaded: () => void;
}) {
  const { t } = useTranslation("settings");
  const def = PROMPTS.find((p) => p.id === id)!;
  const value = settings.prompts[id] ?? def.text;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<LlmProgress | null>(null);
  const [result, setResult] = useState<{ answer: LlmResult; readSeconds: number | null; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (text: string) => {
    const { [id]: _old, ...rest } = settings.prompts;
    onChange({ prompts: text === def.text ? rest : { ...rest, [id]: text } });
  };

  const test = async () => {
    if (!meeting) return;
    setBusy(true);
    setResult(null);
    setError(null);
    setProgress(null);
    const job = `prompt-${crypto.randomUUID()}`;
    const unlisten = await backend.onLlmProgress((e) => e.job === job && setProgress(e));
    const started = Date.now();
    try {
      const engine = coverEngine(settings);
      if (!engine) onLlmLoaded();
      // The general instructions are tried with the title (the quickest part).
      const document = coverDocument(meeting);
      const [answer] = await backend.runLlm({
        job,
        system: promptText("system", settings.prompts) + (await spellingNote(meeting, document)),
        document,
        tasks: llmTasks(settings.prompts, [id === "system" ? "title" : id]),
        keepLoaded: true,
        engine,
      });
      setResult({ answer, readSeconds: null, total: (Date.now() - started) / 1000 });
    } catch (e) {
      setError(String(e));
    } finally {
      unlisten();
      setBusy(false);
    }
  };

  const pretty = (text: string) => {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  };
  const status = !progress
    ? t("prompts.preparing")
    : progress.step === "loading"
      ? t("prompts.loading")
      : progress.step === "reading"
        ? t("prompts.reading")
        : t("prompts.writing");
  const blocked = !ready ? blockedHint : !meeting ? t("prompts.needMeeting") : null;

  return (
    <div className="px-3 pb-3">
      <textarea
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-label={t("prompts.editorLabel", { name: def.label })}
        rows={id === "system" ? 5 : 4}
        className="block w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-[12px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={test}
          disabled={busy || !!blocked}
          title={blocked ?? undefined}
          className="h-6 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted disabled:opacity-50"
        >
          {busy ? status : t("prompts.test")}
        </button>
        <button
          type="button"
          onClick={() => set(def.text)}
          disabled={value === def.text}
          className="h-6 rounded-md px-2 text-[12px] text-mm-link hover:bg-black/5 disabled:invisible dark:hover:bg-white/10"
        >
          {t("prompts.reset")}
        </button>
        {blocked && <span className="text-[11px] text-muted-foreground">{blocked}</span>}
        {!blocked && meeting && !busy && !result && <span className="truncate text-[11px] text-muted-foreground">{t("prompts.meetingTitle", { title: meeting.title })}</span>}
      </div>
      {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
      {result && (
        <div className="mt-2">
          <div className="mb-1 text-[11px] tabular-nums text-muted-foreground">
            {result.answer.error
              ? t("prompts.errorTime", { total: decimal(result.total, 0) })
              : t("prompts.resultTime", { seconds: decimal(result.answer.seconds, 1), tokens: result.answer.tokens, total: decimal(result.total, 0) })}
          </div>
          <pre className="selectable max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-muted px-2 py-1.5 text-[11px] leading-relaxed">
            {result.answer.error ?? pretty(result.answer.text ?? "")}
          </pre>
        </div>
      )}
    </div>
  );
}

// --- Building blocks -----------------------------------------------------------------------

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  labelledBy,
  wide,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  labelledBy?: string;
  /** The whole width, the options sharing it. */
  wide?: boolean;
}) {
  // The white thumb slides to the option chosen (lib/motion.tsx).
  const track = useRef<HTMLDivElement>(null);
  const marker = useMarker(track, value, [options.map((o) => o.label).join("|")]);
  return (
    <div ref={track} role="radiogroup" aria-labelledby={labelledBy} className={cn("relative flex shrink-0 rounded-[7px] bg-mm-segmented-track p-0.5", wide && "w-full")}>
      <MarkerBackground marker={marker} className="rounded-[5px] bg-mm-segmented-selected shadow-[0_1px_2px_rgb(0_0_0/0.15)]" />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          data-marker={o.value}
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("relative h-6 rounded-[5px] px-3 text-[12px] transition-colors duration-200", wide && "flex-1", value === o.value ? "font-medium" : "text-muted-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-1.5 px-1 text-[12px] font-semibold text-muted-foreground">{title}</h3>
      <div className="divide-y divide-border rounded-[10px] border border-border bg-background">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-4 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[13px]">{label}</div>
        {hint && <div className="mt-0.5 break-words text-[11px] leading-snug text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
