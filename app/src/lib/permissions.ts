import { toast } from "sonner";

import * as backend from "./backend";

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
    toast.error("Murmur no té accés al micròfon", {
      description: "Activa Murmur a Configuració del Sistema › Privadesa i seguretat › Micròfon.",
      action: { label: "Obre Configuració", onClick: () => backend.openPrivacySettings("microphone") },
      duration: 12000,
    });
  }

  if (system && status.systemAudio === "undetermined") {
    status = { ...status, systemAudio: await backend.requestSystemAudio() };
  }
  if (system && status.systemAudio === "denied") {
    system = false;
    toast.error("Murmur no pot escoltar l'àudio del sistema", {
      description:
        "Activa Murmur a Configuració del Sistema › Gravació de pantalla i àudio del sistema › Només àudio del sistema." +
        (mic ? " Mentrestant, aquesta reunió es grava només amb el micròfon." : ""),
      action: { label: "Obre Configuració", onClick: () => backend.openPrivacySettings("systemAudio") },
      duration: 12000,
    });
  }

  return mic || system ? { mic, system } : null;
}
