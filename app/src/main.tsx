import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";

import App from "./App";
import { ErrorScreen } from "./components/ErrorScreen";
import { IndicatorWindow } from "./components/IndicatorWindow";
import { Onboarding } from "./components/Onboarding";
import { AfterCard, AFTER_COUNTDOWN_MS } from "./components/AfterCard";
import type { AfterStep } from "./lib/postprocess";
import type { PostStage } from "./lib/types";
import { ToastWindow } from "./components/ToastWindow";
import { WhatsNewDialog } from "./components/WhatsNewDialog";
import { releasesBetween } from "./lib/whatsnew";
import "./index.css";
import { initAppearance } from "./lib/appearance";
import { initI18n } from "./lib/i18n";
import { loadCapabilities, markOs } from "./lib/platform";
import { AboutDialog } from "./components/AboutDialog";

// The OS on <html> (styles that differ, like room for the Mac's traffic lights), and what it can do.
markOs();
void loadCapabilities();
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
// ("?window=whatsnew": the version notes; "?window=onboarding": the welcome screens, from the start;
// "?window=about": the About window; "?window=after": "Què en faig ara?", with "&later" as from the menu).
const devLabel = import.meta.env.DEV ? new URLSearchParams(location.search).get("window") : null;
const label = "__TAURI_INTERNALS__" in window ? getCurrentWindow().label : (devLabel ?? "main");
const isToast = label === "toast";
const isIndicator = label === "indicator";
if (isToast || isIndicator) document.documentElement.classList.add("toast-window");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {devLabel === "whatsnew" ? (
      <WhatsNewDialog releases={releasesBetween(null, "999.0.0")} manual={false} onLink={() => {}} onClose={() => {}} />
    ) : devLabel === "about" ? (
      <AboutDialog open onOpenChange={() => {}} />
    ) : devLabel === "after" ? (
      <AfterPreview />
    ) : devLabel === "onboarding" ? (
      <Onboarding open startAtModels={false} onChange={() => {}} onClose={() => location.reload()} />
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

/** "?window=after" in a browser during development: the card with sample steps. */
function AfterPreview() {
  const later = new URLSearchParams(location.search).has("later");
  const steps: AfterStep[] = [
    { stage: "speakers", possible: true, seconds: 300 },
    { stage: "text", possible: !later, reason: "mixed", seconds: 510 },
    { stage: "punctuation", possible: true, seconds: 20 },
    { stage: "cover", possible: true, seconds: 180 },
  ];
  const [chosen, setChosen] = React.useState(new Set<PostStage>(later ? ["speakers", "cover"] : ["speakers", "text", "punctuation", "cover"]));
  const [deadline, setDeadline] = React.useState<number | null>(later ? null : Date.now() + AFTER_COUNTDOWN_MS);
  return (
    <div className="mx-auto mt-10 max-w-[640px] px-6">
      <AfterCard
        steps={steps}
        chosen={chosen}
        deadline={deadline}
        later={later}
        done={later ? new Set<PostStage>(["punctuation"]) : undefined}
        noAudio={!later}
        engineName="Gemma, en aquest ordinador"
        onToggle={(stage) => {
          setDeadline(null);
          setChosen((s) => {
            const next = new Set(s);
            if (next.has(stage)) next.delete(stage);
            else next.add(stage);
            return next;
          });
        }}
        onStart={() => console.log("start", [...chosen])}
        onSkip={() => console.log("skip")}
      />
    </div>
  );
}
