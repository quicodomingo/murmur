import { useCallback, useRef, type Dispatch } from "react";
import { toast } from "sonner";

import * as backend from "./backend";
import { buildCover, coverDocument, coverEstimate, isDefaultTitle, llmTasks, PROMPTS, promptText } from "./cover";
import { modelInstalled } from "./models";
import type { Settings } from "./settings";
import type { Action, State } from "./store";
import type { Meeting, PostStage } from "./types";

/**
 * What runs after a recording, in order: the speaker check (started by Rust on its own, see
 * lib.rs final_pass), then punctuation and the cover, driven from here because they work on the
 * transcript as the user sees it (names, edits). Each optional stage runs only if it's turned on
 * and its model is downloaded.
 */
export function usePostProcess(state: State, dispatch: Dispatch<Action>, settings: Settings) {
  const latest = useRef(state);
  latest.current = state;
  const config = useRef(settings);
  config.current = settings;
  /** Stages planned for each meeting, decided when its recording starts. */
  const plans = useRef(new Map<string, PostStage[]>());

  const optionalStages = (): PostStage[] => {
    const s = config.current;
    const stages: PostStage[] = [];
    if (s.punctuate && modelInstalled("punctuation")) stages.push("punctuation");
    if (s.summarize && modelInstalled("llm")) stages.push("cover");
    return stages;
  };

  /** A recording starts: remember whether Rust will check its speakers when it stops. */
  const planRecording = useCallback((id: string, verifySpeakers: boolean) => {
    plans.current.set(id, [...(verifySpeakers ? (["speakers"] as const) : []), ...optionalStages()]);
  }, []);

  const speakersStarted = useCallback(
    (id: string, estimateSeconds: number) => {
      const steps = plans.current.get(id) ?? ["speakers"];
      dispatch({ type: "postStage", id, stage: "speakers", steps, estimateSeconds });
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
            toast.error(`No s'ha pogut puntuar la transcripció: ${e}`);
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
            const { cover, title } = buildCover(results, meeting);
            // The model's title replaces the automatic one, never one the user wrote.
            const current = latest.current.open[id]?.title ?? meeting.title;
            dispatch({ type: "cover", id, cover, title: title && isDefaultTitle(current) ? title : null });
            const failed = Object.keys(cover.errors ?? {});
            if (failed.length) {
              const names = failed.map((f) => PROMPTS.find((p) => p.id === f)?.label.toLowerCase() ?? f);
              toast.error(`No s'ha pogut generar: ${names.join(", ")}`);
            }
          } catch (e) {
            toast.error(`No s'ha pogut generar la portada: ${e}`);
          }
        }
      }
      dispatch({ type: "postDone", id });
    },
    [dispatch],
  );

  /** Rust finished (or skipped) the speaker check: go on with the rest. */
  const speakersDone = useCallback(
    (id: string) => {
      const planned = plans.current.get(id);
      plans.current.delete(id);
      // Settings or models may have changed while recording: check again.
      const rest = optionalStages();
      const steps = [...(planned?.includes("speakers") ? (["speakers"] as const) : []), ...rest];
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

  return { planRecording, speakersStarted, speakersDone, generateCover };
}
