import { modelInstalled } from "./models";
import type { Language, ModelId } from "./types";

/**
 * Which Whisper writes a meeting again after recording (retranscribe.rs model_for). In Catalan, the
 * BSC's (whisper-3cat-balearic, the best for every variety we measured: bench/dialects.py); in
 * Spanish and English, large-v3-turbo. Mixed meetings ("ca-es") go sentence by sentence: the turbo
 * tells each one's language and writes the Spanish ones, so it's the one they need; the BSC's
 * writes the Catalan ones if it's there (`finalModels`).
 */
export function preferredFinalModel(language: Language): ModelId {
  return language === "ca" ? "whisper-ca" : "whisper";
}

/** Every Whisper worth having for meetings in `language`, to download together. */
export function finalModels(language: Language): ModelId[] {
  return language === "ca-es" ? ["whisper", "whisper-ca"] : [preferredFinalModel(language)];
}

/** The one that will run now: in Catalan without the BSC's model yet, the turbo, as before. */
export function finalPassModel(language: Language): ModelId {
  const preferred = preferredFinalModel(language);
  if (preferred === "whisper-ca" && !modelInstalled("whisper-ca")) return "whisper";
  return preferred;
}

/** Whether the text Whisper writes comes punctuated: the turbo's does, the BSC's doesn't (and in a
 * mixed meeting, its Catalan sentences). */
export function whisperPunctuates(language: Language): boolean {
  return finalPassModel(language) === "whisper" && !(language === "ca-es" && modelInstalled("whisper-ca"));
}

/** Seconds of work per second of speech (retranscribe.rs rtf_estimate), for the estimates shown. */
export function finalPassRtf(language: Language): number {
  if (language === "ca-es") return 0.35;
  return finalPassModel(language) === "whisper-ca" ? 0.25 : 0.15;
}
