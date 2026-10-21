import { useCallback, useRef, type Dispatch } from "react";
import { toast } from "sonner";

import * as backend from "./backend";
import {
  buildCover,
  coverDocument,
  coverEstimate,
  isDefaultTitle,
  keepTaskEdits,
  llmTasks,
  meetingBasis,
  PROMPTS,
  promptText,
  renamedSpeakers,
  renameInCover,
} from "./cover";
import { locale, t } from "./i18n";
import { modelInstalled } from "./models";
import type { Settings } from "./settings";
import type { Action, State } from "./store";
import type { Language, Meeting, PostStage } from "./types";

/**
 * What runs after a recording, in order: the speaker check and Whisper's new text (started by
 * Rust on its own, see lib.rs final_pass), then punctuation and the cover, driven from here
 * because they work on the transcript as the user sees it (names, edits). Each optional stage
 * runs only if it's turned on and its model is downloaded.
 */
export function usePostProcess(state: State, dispatch: Dispatch<Action>, settings: Settings) {
  const latest = useRef(state);
  latest.current = state;
  const config = useRef(settings);
  config.current = settings;
  /** Stages planned for each meeting, decided when its recording starts. */
  const plans = useRef(new Map<string, PostStage[]>());

  /** `rustStages`: what Rust does first. Whisper's text and English already come punctuated, and
   * the punctuation model only knows Catalan. */
  const optionalStages = (rustStages: PostStage[], language: Language): PostStage[] => {
    const s = config.current;
    const stages: PostStage[] = [];
    const catalan = language === "ca" || language === "ca-es";
    if (s.punctuate && catalan && !rustStages.includes("text") && modelInstalled("punctuation")) stages.push("punctuation");
    if (s.summarize && modelInstalled("llm")) stages.push("cover");
    return stages;
  };

  /** Language of each meeting being recorded or finished, until its stages are done. */
  const languages = useRef(new Map<string, Language>());

  /** A recording starts: remember what Rust will do when it stops (speakers, Whisper). */
  const planRecording = useCallback((id: string, opts: { verifySpeakers: boolean; finalText: boolean; language: Language }) => {
    const rust: PostStage[] = [...(opts.verifySpeakers ? (["speakers"] as const) : []), ...(opts.finalText ? (["text"] as const) : [])];
    languages.current.set(id, opts.language);
    plans.current.set(id, [...rust, ...optionalStages(rust, opts.language)]);
  }, []);

  /** Rust started one of its stages. */
  const rustStageStarted = useCallback(
    (id: string, stage: "speakers" | "text", estimateSeconds: number) => {
      const steps = plans.current.get(id) ?? [stage];
      dispatch({ type: "postStage", id, stage, steps, estimateSeconds });
    },
    [dispatch],
  );

  const run = useCallback(
    async (id: string, stages: PostStage[], steps: PostStage[]) => {
      let meeting: Meeting | undefined = latest.current.open[id];
      for (const stage of stages) {
        if (!meeting) break;
        if (stage === "punctuation") {
          const words = meeting.utterances.reduce((n, u) => n + u.text.split(/\s+/).length, 0);
          dispatch({ type: "postStage", id, stage, steps, estimateSeconds: 2 + words / 800 });
          try {
            const sent: Meeting["utterances"] = meeting.utterances;
            const texts = await backend.punctuate(
              sent.map((u) => u.text),
              sent.map((u) => u.speaker),
            );
            // Lines the user corrected keep their text (the store also skips lines edited meanwhile).
            const changes = sent.filter((u) => !u.edited).map((u) => ({ utteranceId: u.id, from: u.text, to: texts[sent.indexOf(u)] }));
            dispatch({ type: "punctuated", id, changes });
            // The cover reads the punctuated text.
            const byId = new Map(changes.map((c) => [c.utteranceId, c.to]));
            meeting = { ...meeting, utterances: meeting.utterances.map((u) => ({ ...u, text: byId.get(u.id) ?? u.text })) };
          } catch (e) {
            toast.error(t("cover:punctuationFailed", { error: String(e) }));
          }
        }
        if (stage === "cover") {
          meeting = { ...meeting, ...latest.current.open[id], utterances: meeting.utterances };
          if (!meeting.utterances.length) continue;
          const document = coverDocument(meeting);
          const tasks = llmTasks(config.current.prompts);
          dispatch({ type: "postStage", id, stage, steps, estimateSeconds: coverEstimate(document, tasks.length) });
          try {
            const results = await backend.runLlm({
              job: id,
              system: promptText("system", config.current.prompts),
              document,
              tasks,
              keepLoaded: false,
            });
            const built = buildCover(results, meeting);
            const title = built.title;
            // Speakers renamed while it was being written: the cover gets their new names. Other
            // changes made meanwhile (text, notes, reassigned lines) show it's out of date.
            const now = latest.current.open[id] ?? meeting;
            const renamed = renameInCover(built.cover, renamedSpeakers(meeting, now));
            const basis = meetingBasis({ ...meeting, speakerNames: now.speakerNames }, built.cover.lang);
            const cover = keepTaskEdits({ ...renamed, basis }, now.cover);
            // The model's title replaces the automatic one, never one the user wrote.
            const current = latest.current.open[id]?.title ?? meeting.title;
            dispatch({ type: "cover", id, cover, title: title && isDefaultTitle(current) ? title : null });
            const failed = Object.keys(cover.errors ?? {});
            if (failed.length) {
              const names = failed.map((f) => PROMPTS.find((p) => p.id === f)?.label.toLocaleLowerCase(locale()) ?? f);
              toast.error(t("cover:partsFailed", { parts: names.join(", ") }));
            }
          } catch (e) {
            toast.error(t("cover:coverFailed", { error: String(e) }));
          }
        }
      }
      dispatch({ type: "postDone", id });
    },
    [dispatch],
  );

  /** Rust finished (or skipped) its stages: go on with the rest. */
  const rustDone = useCallback(
    (id: string) => {
      const planned = plans.current.get(id) ?? [];
      const language = languages.current.get(id) ?? config.current.language;
      plans.current.delete(id);
      languages.current.delete(id);
      const rust = planned.filter((s) => s === "speakers" || s === "text");
      // Settings or models may have changed while recording: check again.
      const rest = optionalStages(rust, language);
      const steps = [...rust, ...rest];
      if (!rest.length) {
        dispatch({ type: "postDone", id });
        return;
      }
      run(id, rest, steps);
    },
    [dispatch, run],
  );

  /** "Genera la portada" on an existing meeting. */
  const generateCover = useCallback((id: string) => run(id, ["cover"], ["cover"]), [run]);

  return { planRecording, rustStageStarted, rustDone, generateCover };
}
