import { useSyncExternalStore } from "react";
import { toast } from "sonner";

import * as backend from "./backend";
import type { ModelId, ModelStatus } from "./types";

/** Downloadable models (transcription, punctuation, language model): on disk and downloading. */
export type ModelsState = {
  status: Partial<Record<ModelId, ModelStatus>>;
  /** Downloads in progress: bytes done of total. */
  downloading: Partial<Record<ModelId, { done: number; total: number }>>;
  /** Why the last download of a model failed. */
  errors: Partial<Record<ModelId, string>>;
  /** Models waiting their turn in a download queue. */
  queued: ModelId[];
  /** The status has been read from disk at least once. */
  loaded: boolean;
};

export const MODEL_NAMES: Record<ModelId, string> = {
  transcription: "El model de transcripció",
  punctuation: "El model de puntuació",
  llm: "El model de llenguatge",
  english: "El model d'anglès",
  whisper: "Whisper",
};

let state: ModelsState = { status: {}, downloading: {}, errors: {}, queued: [], loaded: !backend.isTauri() };
/** Callbacks waiting for a download to end (true: the model is there now). */
const waiters = new Map<ModelId, ((ok: boolean) => void)[]>();
const listeners = new Set<() => void>();
const set = (next: ModelsState) => {
  state = next;
  listeners.forEach((l) => l());
};

export async function refreshModels() {
  if (!backend.isTauri()) return;
  const list = await backend.modelStatus();
  set({ ...state, status: Object.fromEntries(list.map((m) => [m.id, m])), loaded: true });
}

let started = false;
function start() {
  if (started || !backend.isTauri()) return;
  started = true;
  refreshModels().catch((e) => console.error(e));
  backend.onModelDownload(({ id, done, total }) => set({ ...state, downloading: { ...state.downloading, [id]: { done, total } } }));
  backend.onModelDownloadDone(({ id, error, cancelled }) => {
    const { [id]: _done, ...downloading } = state.downloading;
    set({ ...state, downloading, errors: { ...state.errors, [id]: error ?? undefined } });
    waiters.get(id)?.forEach((w) => w(!error && !cancelled));
    waiters.delete(id);
    if (error) toast.error(`No s'ha pogut descarregar: ${error}`);
    else if (!cancelled) toast(`${MODEL_NAMES[id]} ja és a punt`);
    refreshModels().catch((e) => console.error(e));
  });
}

export function useModels(): ModelsState {
  start();
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const modelInstalled = (id: ModelId) => !!state.status[id]?.installed;

/** Resolves when the download of `id` ends: true if the model is now installed. */
function finished(id: ModelId): Promise<boolean> {
  return new Promise((resolve) => waiters.set(id, [...(waiters.get(id) ?? []), resolve]));
}

/**
 * Downloads models one after the other (the first-run screens). It lives here, not in a
 * component, so it goes on when its window closes ("Continua en segon pla").
 */
export async function downloadQueue(ids: ModelId[]): Promise<boolean> {
  const todo = ids.filter((id) => !state.status[id]?.installed);
  set({ ...state, queued: [...new Set([...state.queued, ...todo])] });
  for (const id of todo) {
    set({ ...state, queued: state.queued.filter((q) => q !== id) });
    if (state.status[id]?.installed) continue;
    const done = finished(id);
    await downloadModel(id);
    if (!(await done)) {
      set({ ...state, queued: [] });
      return false;
    }
  }
  return true;
}

export async function downloadModel(id: ModelId) {
  const total = state.status[id]?.bytes ?? 0;
  set({
    ...state,
    downloading: { ...state.downloading, [id]: { done: state.status[id]?.downloaded ?? 0, total } },
    errors: { ...state.errors, [id]: undefined },
  });
  try {
    await backend.downloadModel(id);
  } catch (e) {
    const { [id]: _failed, ...downloading } = state.downloading;
    set({ ...state, downloading, errors: { ...state.errors, [id]: String(e) } });
    waiters.get(id)?.forEach((w) => w(false));
    waiters.delete(id);
    toast.error(String(e));
  }
}

/** Installs the newer version of a model; resolves true when it's in place. */
export async function updateModel(id: ModelId): Promise<boolean> {
  const done = finished(id);
  set({ ...state, downloading: { ...state.downloading, [id]: { done: 0, total: 0 } }, errors: { ...state.errors, [id]: undefined } });
  try {
    await backend.updateModel(id);
  } catch (e) {
    const { [id]: _failed, ...downloading } = state.downloading;
    set({ ...state, downloading, errors: { ...state.errors, [id]: String(e) } });
    return false;
  }
  return done;
}

export async function deleteModel(id: ModelId) {
  try {
    await backend.deleteModel(id);
  } catch (e) {
    toast.error(String(e));
  }
  await refreshModels();
}

/** "126 MB", "5,2 GB". */
export function bytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(".", ",")} GB`;
  return `${Math.round(n / 1e6)} MB`;
}
