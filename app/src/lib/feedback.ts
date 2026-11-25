import { toast } from "sonner";

import * as backend from "./backend";
import i18n from "./i18n";

/**
 * "Envia un comentari" (FeedbackDialog, feedback.rs, docs/COMENTARIS.md), from anywhere: the Help
 * menu, Settings › General, and every error notice, which gets a second, quieter action,
 * "Explica'ns què ha passat", that opens it with the error already in.
 */

const OPEN = "murmur:open-feedback";

/** Whether this build can send it: known once, at startup (`initFeedback`). */
let available = false;

export const feedbackAvailable = () => available;

/** Opens the window; `context` is the error it came from. */
export function openFeedback(context?: string) {
  window.dispatchEvent(new CustomEvent<string | undefined>(OPEN, { detail: context }));
}

export function onOpenFeedback(fn: (context: string | undefined) => void) {
  const listener = (e: Event) => fn((e as CustomEvent<string | undefined>).detail);
  window.addEventListener(OPEN, listener);
  return () => window.removeEventListener(OPEN, listener);
}

/** The text of an error notice, to go with the message. */
const plain = (message: unknown) => (typeof message === "string" ? message : message instanceof Error ? message.message : "");

/**
 * Once, at startup: if this build can send feedback, every `toast.error` gets "Explica'ns què ha
 * passat" as its second button (sonner's `cancel`), unless it already has one.
 */
export async function initFeedback() {
  available = await backend.feedbackAvailable().catch(() => false);
  if (!available) return;
  const original = toast.error;
  const withFeedback: typeof toast.error = (message, data) => {
    if (data?.cancel) return original(message, data);
    const text = [plain(message), typeof data?.description === "string" ? data.description : ""].filter(Boolean).join(" ");
    return original(message, { ...data, cancel: { label: i18n.t("feedback:explain"), onClick: () => openFeedback(text || undefined) } });
  };
  toast.error = withFeedback;
}
