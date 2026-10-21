import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";

import App from "./App";
import { ErrorScreen } from "./components/ErrorScreen";
import { IndicatorWindow } from "./components/IndicatorWindow";
import { ToastWindow } from "./components/ToastWindow";
import { WhatsNewDialog } from "./components/WhatsNewDialog";
import { releasesBetween } from "./lib/whatsnew";
import "./index.css";
import { initAppearance } from "./lib/appearance";
import { initI18n } from "./lib/i18n";

// Theme and mode from the settings (Aparença), applied before the first render.
initAppearance();
// Interface language, likewise before the first render.
initI18n();

// A web page's right-click menu ("Reload", "Inspect Element") feels out of place in a native app.
// Keep it for editable text (copy/paste) and in dev builds (inspector).
if (!import.meta.env.DEV) {
  document.addEventListener("contextmenu", (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest("input, textarea, [contenteditable='true'], .selectable")) e.preventDefault();
  });
}

// The same page also runs the floating alert and the recording indicator (shell.rs), both
// transparent around their content.
// In a browser during development, "?window=indicator" or "?window=toast" shows that window on its own
// ("?window=whatsnew": the version notes).
const devLabel = import.meta.env.DEV ? new URLSearchParams(location.search).get("window") : null;
const label = "__TAURI_INTERNALS__" in window ? getCurrentWindow().label : (devLabel ?? "main");
const isToast = label === "toast";
const isIndicator = label === "indicator";
if (isToast || isIndicator) document.documentElement.classList.add("toast-window");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {devLabel === "whatsnew" ? (
      <WhatsNewDialog releases={releasesBetween(null, "999.0.0")} manual={false} onLink={() => {}} onClose={() => {}} />
    ) : isToast ? (
      <ToastWindow />
    ) : isIndicator ? (
      <IndicatorWindow />
    ) : (
      <ErrorScreen>
        <App />
      </ErrorScreen>
    )}
  </React.StrictMode>,
);
