import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Cloud, CircleAlert, WifiOff, X } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/SettingsDialog";
import * as backend from "@/lib/backend";
import { copyText } from "@/lib/clipboard";
import { uiLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** "Envia" needs at least this much. */
const MIN_LENGTH = 10;
const MAX_LENGTH = 5000;

type Step = "form" | "sending" | "sent" | "queued";

/**
 * "Envia un comentari" (docs/COMENTARIS.md, mockup docs/mockups/comentaris.html): what isn't
 * working, an idea or anything else, to Murmur's feedback Worker. Only when "Envia" is pressed;
 * the line with the cloud says exactly what goes with it, and the log, unticked, can be read
 * first. Without a connection it's kept and goes next time Murmur opens.
 */
export function FeedbackDialog({ open, context, onOpenChange }: { open: boolean; context?: string; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation("feedback");
  const [kind, setKind] = useState<backend.FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [withError, setWithError] = useState(true);
  const [includeLog, setIncludeLog] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [preview, setPreview] = useState<backend.FeedbackPreview | null>(null);
  const [step, setStep] = useState<Step>("form");

  // Fresh every time it opens: from an error, it's about that error.
  useEffect(() => {
    if (!open) return;
    setKind("bug");
    setMessage("");
    setWithError(true);
    setIncludeLog(false);
    setShowLog(false);
    setStep("form");
    backend.feedbackPreview(uiLanguage()).then(setPreview, () => setPreview(null));
  }, [open, context]);

  const length = message.trim().length;
  const ready = length >= MIN_LENGTH && step === "form";
  const sys = preview?.system;
  const machine = [sys?.machine, sys?.memory].filter(Boolean).join(t("with"));
  const goesWith = sys
    ? t("goesWith", {
        app: preview!.app.replace(/^desktop /, "Murmur "),
        system: [sys.os, sys.osVersion].filter(Boolean).join(" "),
        machine: machine || sys.arch,
        language: t(`languages.${sys.language}`, { defaultValue: sys.language }),
      })
    : "";
  const logLines = preview?.log ? preview.log.split("\n").length : 0;

  const send = async () => {
    if (!ready) return;
    setStep("sending");
    try {
      const outcome = await backend.feedbackSend({
        kind,
        message: message.trim(),
        email: email.trim() || null,
        context: context && withError && kind === "bug" ? context : null,
        includeLog,
        language: uiLanguage(),
      });
      setStep(outcome);
    } catch (e) {
      setStep("form");
      toast.error(String(e) === "tooMany" ? t("tooMany") : t("failed", { error: String(e) }), { cancel: { label: t("close"), onClick: () => {} } });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => step !== "sending" && onOpenChange(o)}>
      <DialogContent showCloseButton={false} className="gap-0 overflow-hidden p-0 sm:max-w-[480px]">
        {step === "sent" || step === "queued" ? (
          <>
            <div className="px-[22px] pt-8 pb-6 text-center">
              <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-mm-fill-subtle">
                {step === "sent" ? <Check className="size-[22px]" strokeWidth={2.2} /> : <WifiOff className="size-5" />}
              </div>
              <DialogTitle className="text-[15px] font-semibold">{t(step === "sent" ? "sentTitle" : "queuedTitle")}</DialogTitle>
              <DialogDescription className="mx-auto mt-1.5 max-w-[340px] text-[12px] text-muted-foreground">
                {t(step === "sent" ? (email.trim() ? "sentWithEmail" : "sentText") : "queuedText")}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2 border-t border-border px-[22px] py-3">
              <span className="flex-1" />
              {step === "queued" && (
                <button type="button" onClick={() => copyText(message).then(() => toast(t("copied")))} className="h-7 rounded-[7px] border border-border px-3 text-[13px] hover:bg-muted">
                  {t("copy")}
                </button>
              )}
              <button type="button" onClick={() => onOpenChange(false)} className="h-7 rounded-[7px] bg-mm-accent px-3.5 text-[13px] font-semibold text-mm-on-accent hover:opacity-90">
                {t("close")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-[22px] pt-5">
              <DialogTitle className="text-[15px] font-semibold">{t("title")}</DialogTitle>
              <DialogDescription className="mt-1 text-[12px] text-muted-foreground">{t("intro")}</DialogDescription>
            </div>
            <div className="flex flex-col gap-3.5 px-[22px] pt-4 pb-[18px]">
              <Segmented
                wide
                value={kind}
                onChange={setKind}
                options={(["bug", "idea", "other"] as const).map((k) => ({ value: k, label: t(`kinds.${k}`) }))}
              />
              {context && withError && kind === "bug" && (
                <div className="flex items-start gap-2 rounded-[7px] bg-mm-fill-subtle px-2.5 py-2 text-[12px] text-muted-foreground">
                  <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1 break-words">
                    <span className="font-medium text-foreground">{t("withError")}</span> {context}
                  </div>
                  <button type="button" aria-label={t("removeError")} onClick={() => setWithError(false)} className="text-mm-text-tertiary hover:text-foreground">
                    <X className="size-3.5" />
                  </button>
                </div>
              )}
              <label className="flex flex-col gap-1.5 text-[12px] font-medium">
                {t(`question.${kind}`)}
                <textarea
                  autoFocus
                  value={message}
                  maxLength={MAX_LENGTH}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
                  }}
                  placeholder={t(`placeholder.${kind}`)}
                  className="h-[120px] resize-none rounded-[7px] border border-border bg-mm-field px-2.5 py-2 text-[13px] leading-normal font-normal outline-none placeholder:text-mm-text-tertiary focus-visible:border-mm-text-secondary focus-visible:ring-[3px] focus-visible:ring-ring/30"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-[12px] font-medium">
                <span>
                  {t("email")} <span className="font-normal text-mm-text-tertiary">{t("optional")}</span>
                </span>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("emailPlaceholder")}
                  className="h-8 rounded-[7px] border border-border bg-mm-field px-2.5 text-[13px] font-normal outline-none placeholder:text-mm-text-tertiary focus-visible:border-mm-text-secondary focus-visible:ring-[3px] focus-visible:ring-ring/30"
                />
                <span className="text-[11px] font-normal text-muted-foreground">{t("emailHint")}</span>
              </label>
              <div>
                <div className="flex items-start gap-2 text-[13px]">
                  <input
                    id="feedback-log"
                    type="checkbox"
                    checked={includeLog}
                    disabled={!logLines}
                    onChange={(e) => setIncludeLog(e.target.checked)}
                    className="mt-0.5 size-3.5 accent-primary"
                  />
                  <label htmlFor="feedback-log" className={cn("cursor-pointer", !logLines && "opacity-50")}>
                    {t("log")}
                  </label>
                  {logLines > 0 && (
                    <button type="button" aria-expanded={showLog} onClick={() => setShowLog((s) => !s)} className="text-[12px] text-mm-link hover:underline">
                      {showLog ? t("hideLog") : t("showLog")}
                    </button>
                  )}
                </div>
                {showLog && preview && (
                  <pre className="mt-2 max-h-32 overflow-auto rounded-[7px] bg-mm-fill-subtle px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre text-muted-foreground">
                    {preview.log}
                  </pre>
                )}
              </div>
              {goesWith && (
                <p className="flex gap-1.5 text-[11px] leading-snug text-muted-foreground">
                  <Cloud className="mt-px size-3 shrink-0" aria-hidden />
                  <span>
                    {goesWith}
                    {includeLog ? t("andLog", { count: logLines }) : ""}. {t("never")}
                  </span>
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 border-t border-border px-[22px] py-3">
              <span className="flex-1 text-[11px] text-mm-text-tertiary">{length > 0 && length < MIN_LENGTH ? t("tooShort") : ""}</span>
              <button type="button" onClick={() => onOpenChange(false)} disabled={step === "sending"} className="h-7 rounded-[7px] border border-border px-3 text-[13px] hover:bg-muted disabled:opacity-50">
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() => void send()}
                disabled={!ready}
                className="h-7 rounded-[7px] bg-mm-accent px-3.5 text-[13px] font-semibold text-mm-on-accent hover:opacity-90 disabled:opacity-45"
              >
                {step === "sending" ? t("sending") : t("send")}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
