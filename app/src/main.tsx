import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";

import App from "./App";
import { ErrorScreen } from "./components/ErrorScreen";
import { ToastWindow } from "./components/ToastWindow";
import "./index.css";
import { initAppearance } from "./lib/appearance";

// Theme and mode from the settings (Aparença), applied before the first render.
initAppearance();

// A web page's right-click menu ("Reload", "Inspect Element") feels out of place in a native app.
// Keep it for editable text (copy/paste) and in dev builds (inspector).
if (!import.meta.env.DEV) {
  document.addEventListener("contextmenu", (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest("input, textarea, [contenteditable='true'], .selectable")) e.preventDefault();
  });
}

// The same page also runs the floating alert window (shell.rs), transparent around its card.
const isToast = "__TAURI_INTERNALS__" in window && getCurrentWindow().label === "toast";
if (isToast) document.documentElement.classList.add("toast-window");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isToast ? (
      <ToastWindow />
    ) : (
      <ErrorScreen>
        <App />
      </ErrorScreen>
    )}
  </React.StrictMode>,
);
