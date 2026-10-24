import { useSyncExternalStore } from "react";

import * as backend from "./backend";
import { modelInstalled } from "./models";
import type { Settings } from "./settings";
import type { CloudEngine, CloudModel, CloudProvider } from "./types";

// The cover can be written by Claude or OpenAI instead of the local model, with the user's own
// API key (cloud.rs). The key goes straight to the keychain: the interface only knows whether
// there is one and its last characters.

export const PROVIDERS: CloudProvider[] = ["anthropic", "openai"];

/** Where each provider's API keys are made. */
export const KEYS_URL: Record<CloudProvider, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
};

/** The model used until the user picks another, if the account has it (else its newest). */
const DEFAULT_MODEL: Record<CloudProvider, string> = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-6.1-sol",
};

export type CloudState = {
  /** The saved key's last characters; null = not connected. */
  status: Record<CloudProvider, string | null>;
  /** The models each connected account can use, newest first (once asked). */
  models: Partial<Record<CloudProvider, CloudModel[]>>;
  errors: Partial<Record<CloudProvider, string>>;
};

let state: CloudState = { status: { anthropic: null, openai: null }, models: {}, errors: {} };
const listeners = new Set<() => void>();
const set = (next: Partial<CloudState>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

export async function refreshCloud() {
  if (!backend.isTauri()) return;
  set({ status: await backend.cloudStatus() });
}

let started = false;
export function useCloud(): CloudState {
  if (!started) {
    started = true;
    refreshCloud().catch((e) => console.error(e));
  }
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Checks the key with the provider and saves it; throws the provider's error otherwise. */
export async function connectCloud(provider: CloudProvider, key: string) {
  const models = await backend.cloudConnect(provider, key);
  set({ models: { ...state.models, [provider]: models }, errors: { ...state.errors, [provider]: undefined } });
  await refreshCloud();
}

export async function disconnectCloud(provider: CloudProvider) {
  await backend.cloudDisconnect(provider);
  const { [provider]: _gone, ...models } = state.models;
  set({ models });
  await refreshCloud();
}

/** The account's models, asked once per session. */
export async function loadCloudModels(provider: CloudProvider) {
  if (state.models[provider] || !state.status[provider]) return;
  try {
    set({ models: { ...state.models, [provider]: await backend.cloudModels(provider) } });
  } catch (e) {
    set({ errors: { ...state.errors, [provider]: String(e) } });
  }
}

/** The model a provider would use: the chosen one, else the default, else the account's newest. */
export function cloudModel(provider: CloudProvider, settings: Settings): string {
  const chosen = settings.cloudModels[provider];
  if (chosen) return chosen;
  const list = state.models[provider];
  if (list?.length && !list.some((m) => m.id === DEFAULT_MODEL[provider])) return list[0].id;
  return DEFAULT_MODEL[provider];
}

/** Who writes the cover; null = the local model. */
export function coverEngine(settings: Settings): CloudEngine | null {
  const provider = settings.coverEngine;
  return provider === "local" ? null : { provider, model: cloudModel(provider, settings) };
}

/** A model's name as the provider gives it ("Claude Sonnet 5.5"), or its id. */
export function cloudModelName(engine: CloudEngine): string {
  return state.models[engine.provider]?.find((m) => m.id === engine.model)?.name ?? engine.model;
}

/** The cover can be written: the local model is downloaded, or the chosen account is connected. */
export function coverReady(settings: Settings): boolean {
  const engine = coverEngine(settings);
  return engine ? !!state.status[engine.provider] : modelInstalled("llm");
}
