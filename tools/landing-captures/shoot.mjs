// Screenshots of the real interface (Vite dev server in browser mode) with sample meetings, for the
// landing page (docs/LANDING.md). With the dev server on 8766 (cd app && npx vite --port 8766):
//   node tools/landing-captures/shoot.mjs data/captures-landing [only-names-containing]
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { seed, slideHtml } from "./seed.mjs";
const [OUT, ONLY] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const prof = mkdtempSync(`${tmpdir()}/murmur-captures-`);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--remote-debugging-port=9334", `--user-data-dir=${prof}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 40 && !targets; i++) { await wait(500); targets = await fetch("http://127.0.0.1:9334/json").then((r) => r.json()).catch(() => undefined); }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;
const size = (w, h) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: false });
await send("Page.enable"); await send("Runtime.enable");

// Shared-screen slides, rendered here and stored as data URLs.
const slides = {};
await size(1280, 720);
for (const lang of ["ca", "es", "en"]) {
  slides[lang] = [];
  for (const i of [0, 1]) {
    await send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(slideHtml(lang, i)) });
    await wait(400);
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    slides[lang].push("data:image/jpeg;base64," + s.data);
  }
}

const W = 1440, H = 900;
const shot = async (name, clip) => {
  const s = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(s.data, "base64"));
  console.log("·", name);
};
const clickText = (text, sel = "*") => ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.offsetParent!==null); e?.click(); return !!e})()`);

async function open(lang, { theme = "acid", mode = "light", cover = false, notes = true, w = W, h = H } = {}) {
  await size(w, h);
  const d = seed(lang, slides[lang]);
  await send("Page.navigate", { url: "http://localhost:8766/" });
  await wait(1500);
  await ev(`localStorage.clear();
    localStorage.setItem("transcriptor.settings.v1", ${JSON.stringify(JSON.stringify({ uiLanguage: lang, theme, mode, calendarEnabled: true, language: lang === "en" ? "en" : "ca-es" }))});
    localStorage.setItem("transcriptor.meetings.v1", ${JSON.stringify(JSON.stringify(d.meetings))});
    localStorage.setItem("transcriptor.view.v1", ${JSON.stringify(JSON.stringify({ cover }))});
    localStorage.setItem("transcriptor.notesLayout.v1", ${JSON.stringify(JSON.stringify({ visible: notes, full: false, width: 340 }))});`);
  await send("Page.reload"); await wait(2500);
  await clickText(d.title);
  await wait(1200);
  return d;
}
const want = (n) => !ONLY || n.includes(ONLY);

for (const lang of ["ca", "es", "en"]) {
  const p = `${lang}-`;
  if (want(p + "01-reunio")) { await open(lang); await shot(p + "01-reunio"); }
  if (want(p + "02-reunio-fosc")) { await open(lang, { mode: "dark" }); await shot(p + "02-reunio-fosc"); }
  if (want(p + "05-resum-sencer")) { await open(lang, { cover: true, notes: false, h: 2000 }); await shot(p + "05-resum-sencer"); }
  if (want(p + "03-resum")) { await open(lang, { cover: true, notes: false }); await shot(p + "03-resum"); }
  if (want(p + "04-resum-fosc")) { await open(lang, { cover: true, notes: false, mode: "dark" }); await shot(p + "04-resum-fosc"); }
  if (lang !== "ca") continue;
  if (want(p + "06-tema-mono")) { await open(lang, { theme: "mono" }); await shot(p + "06-tema-mono"); }
  if (want(p + "07-tema-formigo")) { await open(lang, { theme: "formigo" }); await shot(p + "07-tema-formigo"); }
  if (want(p + "08-tema-formigo-fosc")) { await open(lang, { theme: "formigo", mode: "dark" }); await shot(p + "08-tema-formigo-fosc"); }
  if (want(p + "09-exportar")) {
    await open(lang);
    await ev(`[...document.querySelectorAll('header button')].find(b=>/Exporta/.test(b.textContent))?.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,pointerType:"mouse"}))`);
    await wait(500);
    await ev(`(()=>{const el=[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.includes("Word")); el?.focus(); el?.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))})()`);
    await wait(500);
    await shot(p + "09-exportar");
  }
  if (want(p + "10-cerca")) {
    const d = await open(lang);
    await ev(`(()=>{const i=document.querySelector('nav input'); i.focus(); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(i,${JSON.stringify(d.search)}); i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await wait(1200);
    await shot(p + "10-cerca");
  }
  for (const [tab, label] of [["general", "General"], ["calendar", "Calendari"], ["transcription", "Transcripció"], ["intelligence", "Intel·ligència"], ["share", "Compartir"], ["appearance", "Aparença"]]) {
    const n = `${p}11-configuracio-${tab}`;
    if (!want(n)) continue;
    await open(lang);
    await ev(`document.querySelector('nav button[title]')?.click()`);
    await wait(600);
    await clickText(label, '[role=dialog] button');
    await wait(600);
    await shot(n);
  }
  if (want(p + "12-benvinguda")) {
    await size(W, H);
    await send("Page.navigate", { url: "http://localhost:8766/?window=onboarding" });
    await wait(2500);
    await shot(p + "12-benvinguda");
  }
}
ws.close(); chrome.kill();
await wait(500);
rmSync(prof, { recursive: true, force: true });
