import { getCurrentWindow } from "@tauri-apps/api/window";

/** Murmur themes (docs/design/DESIGN.md › Temes i modes); colours live in murmur-theme.css. */
export type Theme = "acid" | "mono" | "formigo";
export type Mode = "system" | "light" | "dark";

export const THEMES: { id: Theme; label: string }[] = [
  { id: "acid", label: "Negre i àcid" },
  { id: "mono", label: "Monocrom" },
  { id: "formigo", label: "Formigó i vermell" },
];

const SETTINGS_KEY = "transcriptor.settings.v1";
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
let current: { theme: Theme; mode: Mode } = { theme: "acid", mode: "system" };

function paint() {
  const dark = current.mode === "dark" || (current.mode === "system" && systemDark.matches);
  const root = document.documentElement;
  root.dataset.theme = current.theme;
  root.dataset.mode = dark ? "dark" : "light";
  // shadcn's `dark:` variants follow this class.
  root.classList.toggle("dark", dark);
}

/** Applies a theme and mode to this window (and its native title bar). */
export function applyAppearance(theme: Theme, mode: Mode) {
  const modeChanged = mode !== current.mode;
  current = { theme, mode };
  paint();
  if (modeChanged && "__TAURI_INTERNALS__" in window) {
    getCurrentWindow()
      .setTheme(mode === "system" ? null : mode)
      .catch(() => {});
  }
}

/** First paint, before React: read the saved choice so the window never flashes another theme. */
export function initAppearance() {
  let saved: { theme?: Theme; mode?: Mode } = {};
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
  } catch {
    /* defaults */
  }
  current = { theme: saved.theme ?? "acid", mode: "system" };
  applyAppearance(saved.theme ?? "acid", saved.mode ?? "system");
  systemDark.addEventListener("change", paint);
  // Other windows (the floating alerts) follow changes made in the settings.
  window.addEventListener("storage", (e) => {
    if (e.key !== SETTINGS_KEY || !e.newValue) return;
    try {
      const s = JSON.parse(e.newValue);
      applyAppearance(s.theme ?? "acid", s.mode ?? "system");
    } catch {
      /* ignore */
    }
  });
}
