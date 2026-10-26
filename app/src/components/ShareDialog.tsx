import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { Check, Copy, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Segmented } from "@/components/SettingsDialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import * as backend from "@/lib/backend";
import { dateOnly } from "@/lib/format";
import type { Settings } from "@/lib/settings";
import { expired, revokeShare, SHARE_EXPIRIES, shareableParts, shareMeeting, useShareStatus, type ShareExpiry } from "@/lib/share";
import type { Meeting, ShareLink, SharePart } from "@/lib/types";
import { cn } from "@/lib/utils";

const ALL_PARTS: SharePart[] = ["cover", "notes", "transcript"];

/**
 * "Comparteix un enllaç…": what goes in, how long it lasts and an optional password; then the
 * link, copied already. Below, the meeting's earlier links, to copy or withdraw.
 */
export function ShareDialog({
  meeting,
  open,
  onOpenChange,
  settings,
  onChange,
  onShares,
  onSetUp,
}: {
  meeting: Meeting;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  /** The meeting's links changed (one created or withdrawn). */
  onShares: (shares: ShareLink[]) => void;
  /** "Configura-ho": Settings › Compartir. */
  onSetUp: () => void;
}) {
  const { t } = useTranslation("share");
  const status = useShareStatus();
  const available = shareableParts(meeting);
  const [parts, setParts] = useState<SharePart[]>(available);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<ShareLink | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Fresh each time it opens, for the meeting open then.
  useEffect(() => {
    if (!open) return;
    setParts(shareableParts(meeting));
    setUsePassword(false);
    setPassword("");
    setCreated(null);
    setCopied(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, meeting.id]);

  const shares = meeting.shares ?? [];
  const ready = parts.length > 0 && (!usePassword || password.length > 0) && !busy;

  const copy = (link: ShareLink) =>
    navigator.clipboard
      .writeText(link.url)
      .then(() => setCopied(link.id))
      .catch(() => {});

  const create = async () => {
    setBusy(true);
    try {
      const link = await shareMeeting(meeting, parts, settings.shareExpiry, usePassword ? password : null);
      onShares([link, ...shares]);
      setCreated(link);
      setPassword("");
      await copy(link);
    } catch (e) {
      toast.error(t("failed", { error: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (link: ShareLink) => {
    if (!expired(link)) {
      const message = t("revokeMessage");
      const confirmed = backend.isTauri()
        ? await ask(message, { title: t("revokeTitle"), kind: "warning", okLabel: t("revoke"), cancelLabel: t("common:cancel") })
        : window.confirm(message);
      if (!confirmed) return;
    }
    try {
      await revokeShare(link.id);
      onShares(shares.filter((s) => s.id !== link.id));
      if (created?.id === link.id) setCreated(null);
    } catch (e) {
      toast.error(t("revokeFailed", { error: String(e) }));
    }
  };

  const details = (link: ShareLink) =>
    [
      link.expiresAt === null ? t("neverExpires") : expired(link) ? t("expiredOn", { date: dateOnly(link.expiresAt) }) : t("expiresOn", { date: dateOnly(link.expiresAt) }),
      link.password && t("withPassword"),
    ]
      .filter(Boolean)
      .join(" · ");

  const button = "inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-input bg-background px-2.5 text-[13px] hover:bg-muted disabled:opacity-50";
  const earlier = shares.filter((s) => s.id !== created?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 sm:max-w-[460px]">
        <DialogTitle className="text-[15px] font-semibold">{t("title")}</DialogTitle>
        <DialogDescription className="mt-1 text-[12px] text-muted-foreground">{t("description")}</DialogDescription>

        {status === null ? (
          <div className="mt-4 rounded-[10px] border border-border px-3.5 py-3">
            <p className="text-[13px] leading-snug">{t("notConnected")}</p>
            <button
              type="button"
              onClick={onSetUp}
              className="mt-2.5 h-7 rounded-[7px] bg-mm-accent px-3 text-[13px] font-semibold text-mm-on-accent hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {t("setUp")}
            </button>
          </div>
        ) : created ? (
          <div className="mt-4 min-w-0 rounded-[10px] border border-border px-3.5 py-3">
            <label htmlFor="share-link" className="text-[12px] font-semibold text-muted-foreground">
              {t("link")}
            </label>
            <div className="mt-1 flex items-center gap-1.5">
              <input
                id="share-link"
                readOnly
                value={created.url}
                onFocus={(e) => e.currentTarget.select()}
                className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button type="button" className={cn(button, "h-7")} onClick={() => copy(created)}>
                {copied === created.id ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied === created.id ? t("copied") : t("copy")}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">{details(created)}</p>
          </div>
        ) : (
          <form
            className="mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) create();
            }}
          >
            <div className="divide-y divide-border rounded-[10px] border border-border">
              <fieldset className="px-3 py-2.5">
                <legend className="float-left mb-1.5 w-full text-[13px]">{t("what")}</legend>
                <div className="clear-both flex flex-wrap gap-x-4 gap-y-1.5">
                  {ALL_PARTS.map((part) => (
                    <label key={part} className={cn("flex items-center gap-1.5 text-[13px]", !available.includes(part) && "opacity-50")}>
                      <input
                        type="checkbox"
                        checked={parts.includes(part)}
                        disabled={!available.includes(part)}
                        onChange={(e) => setParts((list) => (e.target.checked ? ALL_PARTS.filter((p) => p === part || list.includes(p)) : list.filter((p) => p !== part)))}
                        className="size-3.5 accent-[var(--mm-toggle-on)]"
                      />
                      {t(`parts.${part}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex min-h-11 items-center gap-4 px-3 py-2">
                <span id="share-expiry" className="min-w-0 flex-1 text-[13px]">
                  {t("expiry")}
                </span>
                <Segmented<ShareExpiry>
                  value={settings.shareExpiry}
                  options={SHARE_EXPIRIES.map((e) => ({ value: e, label: t(`expiries.${e}`) }))}
                  onChange={(shareExpiry) => onChange({ shareExpiry })}
                  labelledBy="share-expiry"
                />
              </div>
              <div className="px-3 py-2">
                <div className="flex min-h-7 items-center gap-4">
                  <label htmlFor="share-use-password" className="min-w-0 flex-1 text-[13px]">
                    {t("password")}
                  </label>
                  <Switch id="share-use-password" checked={usePassword} onCheckedChange={setUsePassword} />
                </div>
                {usePassword && (
                  <>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t("passwordPlaceholder")}
                      aria-label={t("password")}
                      aria-describedby="share-password-hint"
                      autoComplete="new-password"
                      autoFocus
                      className="mt-1.5 h-7 w-full rounded-md border border-input bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <p id="share-password-hint" className="mt-1 text-[11px] leading-snug text-muted-foreground">
                      {t("passwordHint")}
                    </p>
                  </>
                )}
              </div>
            </div>
            <p className="mt-2.5 flex gap-1.5 px-1 text-[11px] leading-snug text-muted-foreground">
              <Lock className="mt-px size-3 shrink-0" aria-hidden />
              <span>
                {usePassword ? t("privacyPassword") : t("privacy")} {t("consent")}
              </span>
            </p>
            <div className="mt-3 flex justify-end">
              <button
                type="submit"
                disabled={!ready || status === undefined}
                className="h-7 rounded-[7px] bg-mm-accent px-3 text-[13px] font-semibold text-mm-on-accent hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
              >
                {busy ? t("creating") : t("create")}
              </button>
            </div>
          </form>
        )}

        {earlier.length > 0 && status !== null && (
          <section className="mt-5 min-w-0">
            <h3 className="mb-1.5 px-1 text-[12px] font-semibold text-muted-foreground">{t("links")}</h3>
            <ul className="divide-y divide-border rounded-[10px] border border-border">
              {earlier.map((link) => (
                <li key={link.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">
                      {t("sharedOn", { date: dateOnly(link.createdAt) })} · {link.parts.map((p) => t(`parts.${p}`)).join(", ")}
                    </div>
                    <div className={cn("text-[11px] text-muted-foreground", expired(link) && "text-mm-text-tertiary")}>{details(link)}</div>
                  </div>
                  {!expired(link) && (
                    <button type="button" className={button} onClick={() => copy(link)}>
                      {copied === link.id ? t("copied") : t("copy")}
                    </button>
                  )}
                  <button
                    type="button"
                    className={cn(button, "text-destructive")}
                    onClick={() => revoke(link)}
                    aria-label={t("revokeLabel", { date: dateOnly(link.createdAt) })}
                  >
                    {t("revoke")}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
