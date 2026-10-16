import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Follow the system appearance (shadcn's tokens switch on the .dark class).
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches);
applyTheme();
dark.addEventListener("change", applyTheme);

// A web page's right-click menu ("Reload", "Inspect Element") feels out of place in a native app.
// Keep it for editable text (copy/paste) and in dev builds (inspector).
if (!import.meta.env.DEV) {
  document.addEventListener("contextmenu", (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest("input, textarea, [contenteditable='true'], .selectable")) e.preventDefault();
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
