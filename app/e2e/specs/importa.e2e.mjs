// «Obre amb… › Murmur» a Windows i Linux: l'app rep el fitxer com a argument, en fa una reunió
// i en mostra la transcripció. Necessita el model de transcripció (MURMUR_E2E_MODELS).
import { existsSync } from "node:fs";
import { join } from "node:path";

import { pageText, waitForApp } from "./helpers.mjs";

const models = process.env.MURMUR_E2E_MODELS;
const haveModels = !!models && existsSync(join(models, "conformer-ca-es-sherpa/encoder.onnx"));

describe("Obrir un àudio amb Murmur", function () {
  before(function () {
    if (!haveModels) this.skip();
  });

  it("en fa una reunió amb la transcripció", async () => {
    await waitForApp();
    // Els avisos (sonner) s'esvaeixen sols: es van recollint, per si un explica un error.
    const toasts = new Set();
    const collect = setInterval(async () => {
      const seen = await browser.execute(() => [...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.innerText.trim())).catch(() => []);
      seen.forEach((t) => toasts.add(t));
    }, 300);
    // La reunió es diu com el fitxer (sense la carpeta, també amb les barres de Windows).
    await browser.waitUntil(async () => (await pageText()).includes("bon-dia"), { timeout: 120_000, timeoutMsg: "No s'ha creat la reunió" });
    const heard = async () => {
      const text = (await pageText()).toLowerCase();
      return ["tothom", "pressupost", "vacances", "estiu"].filter((w) => text.includes(w)).length >= 2;
    };
    try {
      await browser.waitUntil(heard, { timeout: 4 * 60_000, interval: 1000 });
      clearInterval(collect);
    } catch {
      clearInterval(collect);
      // El que diu la finestra (un avís d'error, la barra de progrés) explica per què.
      const status = await browser.executeAsync((done) =>
        window.__TAURI_INTERNALS__.invoke("model_status").then((s) => done(JSON.stringify(s.map((m) => [m.id, m.installed])))).catch((e) => done(String(e))),
      );
      throw new Error(`No ha aparegut la transcripció. Models: ${status}. Avisos: ${JSON.stringify([...toasts])}. La finestra diu:\n${await pageText()}`);
    }
  });
});
