import { toast } from "sonner";

import * as backend from "./backend";
import { locale, t, type UiLanguage } from "./i18n";
import type { Meeting } from "./types";

/** Lowercase without accents, to find a term in a text. */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Names the cover's model should spell right: the calendar event's guests, and the glossary's
 * terms that come up in the meeting (`document`, what the model reads). Only those: a list of
 * terms that aren't there can tempt a small model to bring them in.
 */
async function coverTerms(m: Meeting, document: string): Promise<string[]> {
  const glossary = backend.isTauri() ? await backend.getGlossary().catch(() => [] as string[]) : [];
  const text = fold(document);
  // A guest without capitals is the user part of an e-mail, not a name.
  const guests = (m.guests ?? []).filter((g) => /\p{Lu}/u.test(g));
  const terms = [...guests, ...glossary.filter((g) => text.includes(fold(g)))];
  return terms.filter((term, i) => terms.findIndex((x) => x.toLowerCase() === term.toLowerCase()) === i);
}

/** What goes after the cover's general instructions: how to spell those names, if there are any. */
export async function spellingNote(m: Meeting, document: string, lng?: UiLanguage): Promise<string> {
  const terms = await coverTerms(m, document);
  return terms.length ? `\n\n${t("cover:spelling", { terms: terms.join(", "), lng })}` : "";
}

/** A word without the marks around it or an elision in front ("d'AINA," → "AINA"). */
const bare = (word: string) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/^\p{L}{1,2}['’](?=\p{L})/u, "");

/**
 * Names a hand correction brought in: words that weren't there before and have a capital inside
 * ("WordPress", "AINA") or one that doesn't start a sentence ("el Guillem"). Neighbours go
 * together ("Guillem Puig").
 */
export function newNames(before: string, after: string): string[] {
  const old = new Set(before.split(/\s+/).map(bare));
  const words = after.split(/\s+/).filter(Boolean);
  const names: string[] = [];
  let run: string[] = [];
  const close = () => {
    if (run.length) names.push(run.join(" "));
    run = [];
  };
  words.forEach((raw, i) => {
    const word = bare(raw);
    const startsSentence = i === 0 || /[.!?…:]\P{L}*$/u.test(words[i - 1]);
    const name = word.length >= 2 && !old.has(word) && (/\p{Lu}/u.test(word.slice(1)) || (/^\p{Lu}/u.test(word) && !startsSentence));
    if (!name) return close();
    // A name heard as two words doesn't cross punctuation.
    if (run.length && /[^\p{L}\p{N}]$/u.test(words[i - 1])) close();
    run.push(word);
  });
  close();
  return [...new Set(names)];
}

/** After a hand correction: offer to add the names it brought in to the glossary. */
export async function offerGlossary(before: string, after: string) {
  if (!backend.isTauri()) return;
  const names = newNames(before, after);
  if (!names.length) return;
  const known = new Set((await backend.getGlossary().catch(() => [] as string[])).map((g) => g.toLowerCase()));
  const fresh = names.filter((n) => !known.has(n.toLowerCase()));
  if (!fresh.length) return;
  const words = new Intl.ListFormat(locale(), { type: "conjunction" }).format(fresh);
  toast(t("app:glossaryOffer", { words }), {
    action: {
      label: t("app:glossaryAdd"),
      onClick: () =>
        backend
          .getGlossary()
          .then((glossary) => backend.setGlossary([...glossary, ...fresh]))
          .catch((e) => toast.error(String(e))),
    },
  });
}
