import { ChevronDown, FileText, User, Users } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Language } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The meeting languages, in the order they're offered (settings.json `transcription.languages`). */
export const MEETING_LANGUAGES: { value: Language; key: string }[] = [
  { value: "ca", key: "ca" },
  { value: "es", key: "es" },
  { value: "ca-es", key: "caEs" },
  { value: "en", key: "en" },
];

/** What can be chosen right before recording; it also becomes the default (Settings). */
export type StartChoice = { language: Language; roomSpeakers: boolean };

const chip =
  "inline-flex h-6 min-w-0 items-center gap-1 rounded-md px-1.5 text-[12px] text-text-secondary hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-muted";

/**
 * Where there's little room (the sidebar): one line, "Català + castellà · Només jo", opening one
 * menu with both choices.
 */
export function StartOptionsCompact({
  value,
  onChange,
  englishReady,
  className,
}: {
  value: StartChoice;
  onChange: (change: Partial<StartChoice>) => void;
  englishReady: boolean;
  className?: string;
}) {
  const { t } = useTranslation("start");
  const { t: ts } = useTranslation("settings");
  const language = ts(`transcription.languages.${(MEETING_LANGUAGES.find((l) => l.value === value.language) ?? MEETING_LANGUAGES[2]).key}`);
  const room = value.roomSpeakers ? t("room") : t("alone");
  const Icon = value.roomSpeakers ? Users : User;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(chip, "w-full justify-start", className)} aria-label={`${t("languageLabel", { language })}. ${t("roomLabel", { value: room })}`}>
        <span className="truncate">{language}</span>
        <span className="text-mm-text-tertiary" aria-hidden>
          ·
        </span>
        <Icon className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{room}</span>
        <ChevronDown className="ml-auto size-3 shrink-0 opacity-60" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">{t("languageGroup")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value.language} onValueChange={(v) => onChange({ language: v as Language })}>
          {MEETING_LANGUAGES.map((l) => {
            const disabled = l.value === "en" && !englishReady;
            return (
              <DropdownMenuRadioItem key={l.value} value={l.value} disabled={disabled} className="text-[13px]">
                <span className="flex flex-col">
                  {ts(`transcription.languages.${l.key}`)}
                  {disabled && <span className="text-[11px] text-muted-foreground">{t("englishMissing")}</span>}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">{t("roomGroup")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value.roomSpeakers ? "room" : "alone"} onValueChange={(v) => onChange({ roomSpeakers: v === "room" })}>
          {(["alone", "room"] as const).map((v) => (
            <DropdownMenuRadioItem key={v} value={v} className="text-[13px]">
              <span className="flex flex-col">
                {t(`${v}Title`)}
                <span className="text-[11px] text-muted-foreground">{t(`${v}Hint`)}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Two small menus under a "start recording" button: the meeting's language, and whether there
 * are more people in the room on the same microphone. One click still starts with the last ones.
 */
export function StartOptions({
  value,
  onChange,
  englishReady,
  className,
}: {
  value: StartChoice;
  onChange: (change: Partial<StartChoice>) => void;
  /** The English live model is downloaded; otherwise English can't be chosen here. */
  englishReady: boolean;
  className?: string;
}) {
  const { t } = useTranslation("start");
  return (
    <div className={cn("flex min-w-0 items-center gap-0.5", className)}>
      <LanguageMenu value={value.language} onChange={(language) => onChange({ language })} englishReady={englishReady} />
      <span className="text-[12px] text-mm-text-tertiary" aria-hidden>
        ·
      </span>
      <RoomMenu value={value.roomSpeakers} onChange={(roomSpeakers) => onChange({ roomSpeakers })} />
      <span className="sr-only">{t("hint")}</span>
    </div>
  );
}

export function LanguageMenu({ value, onChange, englishReady }: { value: Language; onChange: (l: Language) => void; englishReady: boolean }) {
  const { t } = useTranslation("start");
  const { t: ts } = useTranslation("settings");
  const current = MEETING_LANGUAGES.find((l) => l.value === value) ?? MEETING_LANGUAGES[2];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={chip} aria-label={t("languageLabel", { language: ts(`transcription.languages.${current.key}`) })}>
        <span className="truncate">{ts(`transcription.languages.${current.key}`)}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as Language)}>
          {MEETING_LANGUAGES.map((l) => {
            const disabled = l.value === "en" && !englishReady;
            return (
              <DropdownMenuRadioItem key={l.value} value={l.value} disabled={disabled} className="text-[13px]">
                <span className="flex flex-col">
                  {ts(`transcription.languages.${l.key}`)}
                  {disabled && <span className="text-[11px] text-muted-foreground">{t("englishMissing")}</span>}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RoomMenu({ value, onChange, className }: { value: boolean; onChange: (room: boolean) => void; className?: string }) {
  const { t } = useTranslation("start");
  const Icon = value ? Users : User;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(chip, className)} aria-label={t("roomLabel", { value: value ? t("room") : t("alone") })}>
        <Icon className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{value ? t("room") : t("alone")}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuRadioGroup value={value ? "room" : "alone"} onValueChange={(v) => onChange(v === "room")}>
          {(["alone", "room"] as const).map((v) => (
            <DropdownMenuRadioItem key={v} value={v} className="text-[13px]">
              <span className="flex flex-col">
                {t(`${v}Title`)}
                <span className="text-[11px] text-muted-foreground">{t(`${v}Hint`)}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** While recording: save this meeting as Markdown once it's done (Settings › Transcripció). */
export function MarkdownSwitch({ value, onChange, className }: { value: boolean; onChange: (on: boolean) => void; className?: string }) {
  const { t } = useTranslation("start");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <label className={cn(chip, "cursor-pointer gap-1.5", className)}>
          <FileText className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{t("markdown")}</span>
          <Switch size="sm" checked={value} onCheckedChange={onChange} aria-label={t("markdownLabel")} />
        </label>
      </TooltipTrigger>
      <TooltipContent>{t("markdownHint")}</TooltipContent>
    </Tooltip>
  );
}
