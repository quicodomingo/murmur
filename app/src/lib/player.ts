import { useSyncExternalStore } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { toast } from "sonner";

import * as backend from "./backend";
import type { Meeting } from "./types";

/**
 * One player for the whole app, so the audio keeps going when switching between the cover and
 * the transcript. It plays the meeting's recording as an .m4a made on the first play
 * (playback.rs), kept in the cache.
 */
export type PlayerState = {
  meetingId: string | null;
  /** Making the .m4a (a few seconds the first time). */
  loading: boolean;
  playing: boolean;
  time: number;
  duration: number;
  rate: number;
};

const audio = typeof Audio !== "undefined" ? new Audio() : null;
let state: PlayerState = { meetingId: null, loading: false, playing: false, time: 0, duration: 0, rate: 1 };
const listeners = new Set<() => void>();
const set = (patch: Partial<PlayerState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

if (audio) {
  audio.preload = "auto";
  audio.addEventListener("timeupdate", () => set({ time: audio.currentTime }));
  audio.addEventListener("durationchange", () => set({ duration: Number.isFinite(audio.duration) ? audio.duration : 0 }));
  audio.addEventListener("play", () => set({ playing: true }));
  audio.addEventListener("pause", () => set({ playing: false }));
  audio.addEventListener("ended", () => set({ playing: false }));
}

export function usePlayer(): PlayerState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** The meeting can be listened to: its audio was saved and it's no longer being recorded. */
export const hasAudio = (m: Meeting) => !!m.audioPath && m.status !== "recording";

/** Loads the meeting's audio if it isn't the one in the player; false if it can't. */
async function load(m: Meeting): Promise<boolean> {
  if (!audio || !m.audioPath) return false;
  if (state.meetingId === m.id && audio.src) return true;
  audio.pause();
  set({ meetingId: m.id, loading: true, playing: false, time: 0, duration: 0 });
  try {
    const path = await backend.playbackAudio(m.id, m.audioPath);
    if (state.meetingId !== m.id) return false;
    // A new query each time: the file may have been remade after the recording changed.
    audio.src = `${convertFileSrc(path)}?v=${Date.now()}`;
    audio.playbackRate = state.rate;
    await new Promise<void>((resolve, reject) => {
      audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
      audio.addEventListener("error", () => reject(new Error("El reproductor no ha pogut obrir l'àudio")), { once: true });
    });
    return true;
  } catch (e) {
    set({ meetingId: null });
    toast.error(String(e));
    return false;
  } finally {
    set({ loading: false });
  }
}

/** Plays the meeting from `t` seconds (or from where it was). */
export async function playAt(m: Meeting, t?: number) {
  if (!(await load(m)) || !audio) return;
  if (t !== undefined) audio.currentTime = Math.max(0, t);
  await audio.play().catch(() => {});
}

export function toggle(m: Meeting) {
  if (!audio) return;
  if (state.meetingId === m.id && state.playing) audio.pause();
  else void playAt(m);
}

export function seek(t: number) {
  if (audio) audio.currentTime = Math.max(0, Math.min(t, state.duration || t));
}

/** 1× → 1,25× → 1,5× → 2× → 1×. */
export function nextRate() {
  const rates = [1, 1.25, 1.5, 2];
  const rate = rates[(rates.indexOf(state.rate) + 1) % rates.length];
  if (audio) audio.playbackRate = rate;
  set({ rate });
}

/** Another meeting was opened, or this one deleted: stop. */
export function stopUnless(meetingId: string | null) {
  if (!audio || state.meetingId === null || state.meetingId === meetingId) return;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  set({ meetingId: null, playing: false, time: 0, duration: 0 });
}
