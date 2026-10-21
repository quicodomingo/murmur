import i18n from "i18next";
import { initReactI18next } from "react-i18next";

/**
 * Interface languages (docs/TRADUCCIONS.md). Catalan is the source: every key exists in
 * `locales/ca/`, and a key missing from another language falls back to it.
 *
 * Strings live in `src/locales/<language>/<namespace>.json`, one namespace per component or
 * module; this file picks them all up, so adding a namespace needs no registration.
 */
export const UI_LANGUAGES = ["ca", "es", "en"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];
/** The setting: a language, or "system" to follow macOS. */
export type UiLanguagePref = UiLanguage | "system";

/** Each language's own name, for the selector. */
export const UI_LANGUAGE_NAMES: Record<UiLanguage, string> = { ca: "Català", es: "Español", en: "English" };

const files = import.meta.glob<Record<string, unknown>>("../locales/*/*.json", { eager: true, import: "default" });
const resources: Record<string, Record<string, Record<string, unknown>>> = {};
for (const [path, strings] of Object.entries(files)) {
  const [, lang, ns] = path.match(/locales\/([^/]+)\/([^/]+)\.json$/)!;
  (resources[lang] ??= {})[ns] = strings;
}

const SETTINGS_KEY = "transcriptor.settings.v1";

/** The language macOS prefers among Murmur's; English for any other. */
export function systemLanguage(): UiLanguage {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split("-")[0];
    if ((UI_LANGUAGES as readonly string[]).includes(base)) return base as UiLanguage;
  }
  return "en";
}

export const resolveLanguage = (pref: UiLanguagePref | undefined): UiLanguage =>
  !pref || pref === "system" ? systemLanguage() : pref;

/** The current interface language. */
export const uiLanguage = (): UiLanguage => (i18n.resolvedLanguage ?? "ca") as UiLanguage;

/** BCP 47 tag for dates and numbers (Intl, toLocale…). */
export const locale = (): string => ({ ca: "ca-ES", es: "es-ES", en: "en-US" })[uiLanguage()];

/** For code outside React (lib/*.ts): `t("export:notes")`. Components use `useTranslation`. */
export const t = i18n.t.bind(i18n);

function savedPref(): UiLanguagePref | undefined {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}").uiLanguage;
  } catch {
    return undefined;
  }
}

/** Switches the interface (this window) to a language. */
export function applyLanguage(pref: UiLanguagePref | undefined) {
  const lang = resolveLanguage(pref);
  document.documentElement.lang = lang;
  if (i18n.language !== lang) void i18n.changeLanguage(lang);
}

/** Before the first render, like initAppearance: the saved language, kept in step across windows. */
export function initI18n() {
  const lang = resolveLanguage(savedPref());
  void i18n.use(initReactI18next).init({
    resources,
    lng: lang,
    fallbackLng: "ca",
    supportedLngs: [...UI_LANGUAGES],
    defaultNS: "common",
    ns: Object.keys(resources.ca ?? {}),
    // React escapes already.
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  document.documentElement.lang = lang;
  // The floating alert and the indicator follow a change made in the settings.
  window.addEventListener("storage", (e) => {
    if (e.key === SETTINGS_KEY) applyLanguage(savedPref());
  });
}

export default i18n;
