// Utilitats de les proves: els textos surten dels fitxers de traducció (el català, que és la
// font), perquè les proves no es trenquin quan canvia una frase.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const locales = fileURLToPath(new URL("../../src/locales/ca/", import.meta.url));
const cache = {};

/** El text de `ns:key.sub` en català, amb els textos de PC aplicats (pc.json), com a Windows i Linux. */
export function ca(id) {
  const [ns, key] = id.split(":");
  const load = (name) => (cache[name] ??= JSON.parse(readFileSync(`${locales}${name}.json`, "utf8")));
  const get = (obj) => key.split(".").reduce((o, k) => o?.[k], obj);
  return get(load("pc")[ns]) ?? get(load(ns)) ?? (() => { throw new Error(`No hi ha el text ${id}`); })();
}

export const SETTINGS_KEY = "transcriptor.settings.v1";
export const ONBOARDED_KEY = "murmur.onboarded.v1";

/** La interfície en català i sense la benvinguda, i l'app tornada a carregar. */
export async function catalanAndOnboarded() {
  await browser.execute(
    (settingsKey, onboardedKey) => {
      const saved = JSON.parse(localStorage.getItem(settingsKey) ?? "{}");
      localStorage.setItem(settingsKey, JSON.stringify({ ...saved, uiLanguage: "ca" }));
      localStorage.setItem(onboardedKey, "1");
    },
    SETTINGS_KEY,
    ONBOARDED_KEY,
  );
  await browser.refresh();
  await waitForApp();
}

/** Fins que la finestra principal ha carregat React. */
export async function waitForApp() {
  await browser.waitUntil(async () => (await browser.execute(() => document.getElementById("root")?.childElementCount ?? 0)) > 0, {
    timeout: 60_000,
    timeoutMsg: "L'app no ha carregat la interfície",
  });
}

/** Prem una drecera amb Ctrl, com a Windows i Linux (⌘ a macOS). */
export async function ctrl(key) {
  await browser.keys(["Control", key]);
  await browser.keys(["Control"]);
}

/** El text visible de tota la finestra. */
export const pageText = () => browser.execute(() => document.body.innerText);
