import { toast } from "sonner";

import * as backend from "./backend";
import { t } from "./i18n";

/**
 * Before recording: asks for what's missing, like other apps do (the system's own dialogs).
 * Returns the sources that can be recorded now (null: nothing can, the user has been told why).
 */
export async function ensurePermissions(want: { mic: boolean; system: boolean }): Promise<{ mic: boolean; system: boolean } | null> {
  let status = await backend.permissionStatus();
  let mic = want.mic;
  let system = want.system;

  if (mic && status.microphone === "undetermined") {
    await backend.requestMicrophone();
    status = await backend.permissionStatus();
  }
  if (mic && status.microphone !== "granted") {
    mic = false;
    toast.error(t("permissions:micDenied"), {
      description: t("permissions:micDeniedHelp"),
      action: { label: t("permissions:openSettings"), onClick: () => backend.openPrivacySettings("microphone") },
      duration: 12000,
    });
  }

  if (system && status.systemAudio === "undetermined") {
    status = { ...status, systemAudio: await backend.requestSystemAudio() };
  }
  if (system && status.systemAudio === "denied") {
    system = false;
    toast.error(t("permissions:systemAudioDenied"), {
      description: mic ? t("permissions:systemAudioDeniedHelpMic") : t("permissions:systemAudioDeniedHelp"),
      action: { label: t("permissions:openSettings"), onClick: () => backend.openPrivacySettings("systemAudio") },
      duration: 12000,
    });
  }

  return mic || system ? { mic, system } : null;
}
