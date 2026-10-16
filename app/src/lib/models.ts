import { useSyncExternalStore } from "react";
import { toast } from "sonner";

import * as backend from "./backend";
import type { ModelId, ModelStatus } from "./types";

/** Optional models (punctuation, language model): what's on disk and what's downloading. */
export type ModelsState = {
  status: Partial<Record<ModelId, ModelStatus>>;
  /** Downloads in progress: bytes done of total. */
  downloading: Partial<Record<ModelId, { done: number; total: number }>>;
};

export const MODEL_NAMES: Record<ModelId, string> = {
  punctuation: "El model de puntuació",
  llm: "El model de llenguatge",
};

let state: ModelsState = { status: {}, downloading: {} };
const listeners = new Set<() => void>();
const set = (next: ModelsState) => {
  state = next;
  listeners.forEach((l) => l());
};

export async function refreshModels() {
  if (!backend.isTauri()) return;
  const list = await backend.modelStatus();
  set({ ...state, status: Object.fromEntries(list.map((m) => [m.id, m])) });
}

let started = false;
function start() {
  if (started || !backend.isTauri()) return;
  started = true;
  refreshModels().catch((e) => console.error(e));
  backend.onModelDownload(({ id, done, total }) => set({ ...state, downloading: { ...state.downloading, [id]: { done, total } } }));
  backend.onModelDownloadDone(({ id, error, cancelled }) => {
    const { [id]: _done, ...downloading } = state.downloading;
    set({ ...state, downloading });
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

export async function downloadModel(id: ModelId) {
  const total = state.status[id]?.bytes ?? 0;
  set({ ...state, downloading: { ...state.downloading, [id]: { done: state.status[id]?.downloaded ?? 0, total } } });
  try {
    await backend.downloadModel(id);
  } catch (e) {
    const { [id]: _failed, ...downloading } = state.downloading;
    set({ ...state, downloading });
    toast.error(String(e));
  }
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
