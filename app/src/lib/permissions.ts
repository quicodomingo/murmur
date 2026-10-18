import { toast } from "sonner";

import * as backend from "./backend";

const ASKED_KEY = "murmur.systemAudioTapAsked";

/**
 * System audio comes from a Core Audio tap (systap.rs). macOS asks for "System audio recording"
 * the first time a tap opens and doesn't tell apps the answer: without it, the tap is silent.
 */
export function systemAudioAsked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

/** The system prompt the first time, the settings page afterwards. */
export async function askSystemAudio() {
  if (systemAudioAsked()) {
    await backend.openPrivacySettings("systemAudio");
    return;
  }
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    /* ignore */
  }
  await backend.requestSystemAudio();
}

/**
 * Before recording: asks for what's missing, like other apps do. Returns the sources that can be
 * recorded now (null: nothing can, the user has been told why).
 */
export async function ensurePermissions(want: { mic: boolean; system: boolean }): Promise<{ mic: boolean; system: boolean } | null> {
  let status = await backend.permissionStatus();
  let mic = want.mic;
  const system = want.system;

  if (mic && status.microphone === "undetermined") {
    await backend.requestMicrophone();
    status = await backend.permissionStatus();
  }
  if (mic && status.microphone !== "granted") {
    mic = false;
    toast.error("Murmur no té accés al micròfon", {
      description: "Activa Murmur a Configuració del Sistema › Privadesa i seguretat › Micròfon.",
      action: { label: "Obre Configuració", onClick: () => backend.openPrivacySettings("microphone") },
      duration: 12000,
    });
  }

  // The first recording with system audio shows macOS's prompt; recording goes on either way.
  if (system && !systemAudioAsked()) {
    await askSystemAudio();
    toast("Permet que Murmur escolti l'àudio del sistema", {
      description: "És l'altra banda de les trucades. Si no surt a la transcripció, revisa-ho a Configuració › Àudio › Permisos.",
      duration: 10000,
    });
  }

  return mic || system ? { mic, system } : null;
}
