import { useCallback, useRef, type Dispatch } from "react";
import { toast } from "sonner";

import * as backend from "./backend";
import {
  buildCover,
  coverDocument,
  coverLanguage,
  coverLanguageFor,
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
import { cloudModelName, coverEngine, coverReady } from "./cloud";
import { spellingNote } from "./glossary";
import { locale, t, type UiLanguage } from "./i18n";
import { modelInstalled } from "./models";
import type { Settings } from "./settings";
import type { Action, State } from "./store";
import type { Language, Meeting, PostStage } from "./types";
import { track } from "./analytics";
import { reveal } from "./reveal";
import { finalPassModel } from "./finalpass";

/** The punctuation model only knows Catalan, and has to be downloaded. */
const punctuates = (language: Language) => (language === "ca" || language === "ca-es") && modelInstalled("punctuation");

/** A step after a meeting ends, and whether it can be done now, with why not and how long it takes. */
export type AfterStep = { stage: PostStage; possible: boolean; reason?: "mixed" | "model" | "engine" | "audio"; seconds: number };

/**
 * What runs after a recording, in order: the speaker check and Whisper's new text (lib.rs
 * final_pass, started by `choose` once the user said, "Què en faig ara?"), then punctuation and
 * the cover, driven from here because they work on the transcript as the user sees it (names,
 * edits). Each runs only if chosen and its model is downloaded.
 */
export function usePostProcess(state: State, dispatch: Dispatch<Action>, settings: Settings) {
  const latest = useRef(state);
  latest.current = state;
  const config = useRef(settings);
  config.current = settings;
  /** A cover asked for in a given language ("Torna a generar", its language menu). */
  const coverLangs = useRef(new Map<string, UiLanguage>());
  /** Stages planned for each meeting, decided when its recording starts. */
  const plans = useRef(new Map<string, PostStage[]>());

  /** `rustStages`: what Rust does first. Whisper large-v3-turbo's text and English already come
   * punctuated; the BSC's Catalan Whisper writes without punctuation (lib/finalpass.ts). The
   * punctuation model only knows Catalan. */
  const optionalStages = (rustStages: PostStage[], language: Language, id?: string): PostStage[] => {
    const s = config.current;
    // Chosen for this meeting when it ended; otherwise (a retranscription) as the settings say.
    const want = (id ? wants.current.get(id) : undefined) ?? { punctuation: s.punctuate, cover: s.summarize };
    const stages: PostStage[] = [];
    const punctuated = rustStages.includes("text") && finalPassModel(language) === "whisper";
    if (want.punctuation && punctuates(language) && !punctuated) stages.push("punctuation");
    if (want.cover && coverReady(s)) stages.push("cover");
    return stages;
  };
  /** Punctuation and the cover chosen for a meeting when it ended (`choose`), until they run. */
  const wants = useRef(new Map<string, { punctuation: boolean; cover: boolean }>());
  /** Meetings made from a file: they remember their own steps (settings.fileSteps). */
  const files = useRef(new Set<string>());

  /** Language of each meeting being recorded or finished, until its stages are done. */
  const languages = useRef(new Map<string, Language>());
  /** A meeting that went on ("Continua"): punctuation only from here (seconds); the rest has it. */
  const newFrom = useRef(new Map<string, number>());

  /** A recording starts: remember what Rust will be able to do when it stops (speakers, Whisper). */
  const planRecording = useCallback((id: string, opts: { verifySpeakers: boolean; finalText: boolean; language: Language; from?: number; file?: boolean }) => {
    const rust: PostStage[] = [...(opts.verifySpeakers ? (["speakers"] as const) : []), ...(opts.finalText ? (["text"] as const) : [])];
    languages.current.set(id, opts.language);
    if (opts.from) newFrom.current.set(id, opts.from);
    else newFrom.current.delete(id);
    if (opts.file) files.current.add(id);
    else files.current.delete(id);
    plans.current.set(id, [...rust, ...optionalStages(rust, opts.language)]);
  }, []);

  const isFile = useCallback((id: string) => files.current.has(id), []);

  /** The four steps for a meeting that just ended (Rust said what it can do), for "Què en faig ara?". */
  const stepsFor = useCallback((ready: backend.FinalPassReady): AfterStep[] => {
    const id = ready.meetingId;
    const language = languages.current.get(id) ?? config.current.language;
    const m = latest.current.open[id];
    const words = m?.utterances.reduce((n, u) => n + u.text.split(/\s+/).length, 0) ?? 0;
    const engine = coverEngine(config.current);
    const document = m ? coverDocument(m, coverLanguageFor(m, config.current.coverLanguage)) : "";
    return [
      { stage: "speakers", possible: ready.speakers, seconds: ready.speakersSeconds },
      // Whisper needs one language and its model; told one, it turns the other into it.
      { stage: "text", possible: ready.text, reason: ready.text ? undefined : finalPassModel(language) ? "model" : "mixed", seconds: ready.textSeconds },
      { stage: "punctuation", possible: punctuates(language), reason: punctuates(language) ? undefined : "model", seconds: 2 + words / 800 },
      { stage: "cover", possible: coverReady(config.current), reason: coverReady(config.current) ? undefined : "engine", seconds: coverEstimate(document, llmTasks(config.current.prompts).length, false, !!engine) },
    ];
  }, []);

  /** Every step a meeting that ended could still go through, as `pending`: from the moment it ends,
   * so that "Acaba de processar…" has them even if Murmur closes before the choice. */
  const remember = useCallback(
    (id: string, steps: AfterStep[]) => {
      const audio = !!latest.current.open[id]?.audioPath;
      const left = steps.filter((s) => s.possible && (audio || s.stage === "punctuation" || s.stage === "cover")).map((s) => s.stage);
      dispatch({ type: "pending", id, steps: left });
    },
    [dispatch],
  );

  /**
   * The steps chosen for a meeting that ended: the speaker check and Whisper go to Rust, the rest
   * waits for them. Every step that could be done is remembered on the meeting (`pending`), the
   * chosen ones too until they're done: if Murmur closes or updates halfway, they're still there
   * for "Acaba de processar…". Without its audio saved, the speaker check and Whisper can't.
   */
  const choose = useCallback(
    (id: string, steps: AfterStep[], chosen: Set<PostStage>) => {
      const speakers = chosen.has("speakers");
      const text = chosen.has("text");
      wants.current.set(id, { punctuation: chosen.has("punctuation"), cover: chosen.has("cover") });
      const rust: PostStage[] = [...(speakers ? (["speakers"] as const) : []), ...(text ? (["text"] as const) : [])];
      plans.current.set(id, [...rust, ...optionalStages(rust, languages.current.get(id) ?? config.current.language, id)]);
      remember(id, steps);
      // The banner from now on: Rust may wait (a call, gate.rs) before its first stage starts.
      if (rust.length) dispatch({ type: "postStage", id, stage: rust[0], steps: plans.current.get(id)!, estimateSeconds: steps.find((s) => s.stage === rust[0])?.seconds ?? 60 });
      track("after_chosen", { speakers, text, punctuation: chosen.has("punctuation"), summary: chosen.has("cover"), file: files.current.has(id) });
      backend.runFinalPass(id, speakers, text).catch((e) => {
        dispatch({ type: "postDone", id });
        toast.error(String(e));
      });
    },
    [dispatch],
  );

  /** "Torna a transcriure en…": Whisper's text, then what follows a recording (the cover). */
  const planRetranscribe = useCallback((id: string, language: Language) => {
    languages.current.set(id, language);
    plans.current.set(id, ["text", ...optionalStages(["text"], language)]);
  }, []);

  /** Punctuation still comes after Whisper's text (lib/finalpass.ts): the aurora waits for it. */
  const punctuatesAfter = useCallback((id: string) => !!plans.current.get(id)?.includes("punctuation"), []);

  /** Rust started one of its stages. */
  const rustStageStarted = useCallback(
    (id: string, stage: "speakers" | "text", estimateSeconds: number) => {
      const steps = plans.current.get(id) ?? [stage];
      dispatch({ type: "postStage", id, stage, steps, estimateSeconds });
    },
    [dispatch],
  );

  const run = useCallback(
    /** `from`: punctuate only the lines from here (seconds), the new part of a meeting that went on. */
    async (id: string, stages: PostStage[], steps: PostStage[], from = 0) => {
      let meeting: Meeting | undefined = latest.current.open[id];
      for (const stage of stages) {
        if (!meeting) break;
        if (stage === "punctuation") {
          const words = meeting.utterances.filter((u) => u.start >= from).reduce((n, u) => n + u.text.split(/\s+/).length, 0);
          dispatch({ type: "postStage", id, stage, steps, estimateSeconds: 2 + words / 800 });
          try {
            const sent: Meeting["utterances"] = meeting.utterances.filter((u) => u.start >= from);
            const texts = await backend.punctuate(
              sent.map((u) => u.text),
              sent.map((u) => u.speaker),
            );
            // Lines the user corrected keep their text (the store also skips lines edited meanwhile).
            const changes = sent.filter((u) => !u.edited).map((u) => ({ utteranceId: u.id, from: u.text, to: texts[sent.indexOf(u)] }));
            reveal("transcript", id, () => dispatch({ type: "punctuated", id, changes }));
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
          const lng = coverLangs.current.get(id) ?? coverLanguageFor(meeting, config.current.coverLanguage);
          coverLangs.current.delete(id);
          const document = coverDocument(meeting, lng);
          const tasks = llmTasks(config.current.prompts, undefined, lng);
          const engine = coverEngine(config.current);
          const spelling = await spellingNote(meeting, document, lng);
          dispatch({ type: "postStage", id, stage, steps, estimateSeconds: coverEstimate(document, tasks.length, false, !!engine) });
          try {
            const results = await backend.runLlm({
              job: id,
              system: promptText("system", config.current.prompts, lng) + spelling,
              document,
              tasks,
              keepLoaded: false,
              engine,
            });
            const built = buildCover(results, meeting, lng, engine ? cloudModelName(engine) : undefined);
            const title = built.title;
            // Speakers renamed while it was being written: the cover gets their new names. Other
            // changes made meanwhile (text, notes, reassigned lines) show it's out of date.
            const now = latest.current.open[id] ?? meeting;
            const renamed = renameInCover(built.cover, renamedSpeakers(meeting, now));
            const basis = meetingBasis({ ...meeting, speakerNames: now.speakerNames }, built.cover.lang);
            const cover = keepTaskEdits({ ...renamed, basis }, now.cover);
            // The model's title replaces the automatic one, never one the user wrote.
            const current = latest.current.open[id]?.title ?? meeting.title;
            reveal("cover", id, () => dispatch({ type: "cover", id, cover, title: title && isDefaultTitle(current) ? title : null }));
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
      const from = newFrom.current.get(id) ?? 0;
      newFrom.current.delete(id);
      const rust = planned.filter((s) => s === "speakers" || s === "text");
      // Models may have changed meanwhile: check again.
      const rest = optionalStages(rust, language, id);
      wants.current.delete(id);
      files.current.delete(id);
      const steps = [...rust, ...rest];
      if (!rest.length) {
        dispatch({ type: "postDone", id });
        return;
      }
      run(id, rest, steps, from);
    },
    [dispatch, run],
  );

  /** "Genera la portada" on an existing meeting: in `lng`, or in the language its cover is already in. */
  const generateCover = useCallback(
    (id: string, lng?: UiLanguage) => {
      const current = latest.current.open[id]?.cover;
      const chosen = lng ?? (current ? coverLanguage(current) : undefined);
      if (chosen) coverLangs.current.set(id, chosen);
      track("summary_generated", { language: chosen ?? "default", changed: !!lng && lng !== (current ? coverLanguage(current) : undefined) });
      return run(id, ["cover"], ["cover"]);
    },
    [run],
  );

  /** "Acaba de processar…": what to do after the speaker check and Whisper, if they run (lib.rs retranscribe_meeting). */
  const planLater = useCallback((id: string, chosen: Set<PostStage>, language: Language) => {
    languages.current.set(id, language);
    newFrom.current.delete(id);
    wants.current.set(id, { punctuation: chosen.has("punctuation"), cover: chosen.has("cover") });
    const rust: PostStage[] = [...(chosen.has("speakers") ? (["speakers"] as const) : []), ...(chosen.has("text") ? (["text"] as const) : [])];
    plans.current.set(id, [...rust, ...optionalStages(rust, language, id)]);
  }, []);

  /** "Acaba de processar…" without audio work: punctuation and the cover, from the saved transcript. */
  const finishText = useCallback((id: string, stages: PostStage[]) => run(id, stages, stages), [run]);

  return { planRecording, planRetranscribe, punctuatesAfter, rustStageStarted, rustDone, generateCover, isFile, stepsFor, remember, choose, planLater, finishText };
}
