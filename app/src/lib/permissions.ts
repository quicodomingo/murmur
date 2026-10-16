import { toast } from "sonner";

import * as backend from "./backend";

const ASKED_KEY = "murmur.systemAudioAsked";

/** macOS only shows its system audio prompt once; after that, the way in is System Settings. */
export function systemAudioAsked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Asks for system audio: the system prompt the first time, the settings page afterwards. */
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
  let system = want.system;

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

  if (system && !status.systemAudio) {
    system = false;
    const first = !systemAudioAsked();
    await askSystemAudio();
    toast(first ? "Cal permís per a l'àudio del sistema" : "Falta el permís per a l'àudio del sistema", {
      description:
        "Activa Murmur a «Gravació de pantalla i àudio del sistema» i torna-la a obrir. " +
        (mic ? "Mentrestant, aquesta reunió es grava només amb el micròfon." : ""),
      action: first ? undefined : { label: "Obre Configuració", onClick: () => backend.openPrivacySettings("systemAudio") },
      duration: 12000,
    });
  }

  return mic || system ? { mic, system } : null;
}
