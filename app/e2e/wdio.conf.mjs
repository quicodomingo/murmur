// Proves e2e de l'app compilada, amb tauri-driver (WebDriver de WebKitGTK a Linux, d'Edge a
// Windows). tauri-driver no funciona a macOS.
//
//   cd app && npm run tauri build -- --debug --no-bundle
//   cd e2e && npm ci && npm test            (a Linux, sota xvfb-run)
//
// Dues sessions de l'app: «interficie» la fa servir com qui l'obre per primer cop, i «importa»
// l'obre amb un fitxer d'àudio, com «Obre amb…», i n'espera la transcripció. Aquesta necessita
// el model de transcripció a MURMUR_E2E_MODELS (si no hi és, se salta).
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const exe = process.platform === "win32" ? "transcriptor.exe" : "transcriptor";
const application = resolve(here, "../src-tauri/target/debug", exe);
const suite = globalThis.MURMUR_E2E_SUITE ?? "interficie";
const models = process.env.MURMUR_E2E_MODELS ? resolve(process.env.MURMUR_E2E_MODELS) : null;
export const fixture = resolve(here, "fixtures/bon-dia.wav");

let driver;

export const config = {
  runner: "local",
  hostname: "127.0.0.1",
  port: 4444,
  specs: [`./specs/${suite}.e2e.mjs`],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": {
        application,
        args: suite === "importa" ? [fixture] : [],
      },
    },
  ],
  logLevel: "warn",
  bail: 0,
  waitforTimeout: 20_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 10 * 60_000 },

  onPrepare() {
    mkdirSync(join(here, "captures"), { recursive: true });
    if (!existsSync(application)) throw new Error(`Falta l'app compilada: ${application}`);
    if (suite === "importa" && !(models && existsSync(join(models, "conformer-ca-es-sherpa/encoder.onnx")))) {
      console.log("Sense el model de transcripció (MURMUR_E2E_MODELS): la prova d'importar se salta.");
    }
  },

  // tauri-driver fa de pont entre WebDriver i el WebDriver natiu de cada sistema. A Linux l'app
  // n'hereta l'entorn (TRANSCRIPTOR_MODELS: on són els models), però a Windows msedgedriver
  // l'obre sense: allà els models s'enllacen a la carpeta de dades de l'app, on els buscaria.
  beforeSession() {
    if (models) {
      const data = process.platform === "win32" ? process.env.APPDATA : process.env.XDG_DATA_HOME || join(homedir(), ".local/share");
      // The app may have made the folder already: what's missing goes in, nothing is removed.
      const linked = join(data, "com.quicodomingo.murmur", "models");
      mkdirSync(linked, { recursive: true });
      for (const name of readdirSync(models)) {
        const from = join(models, name);
        const to = join(linked, name);
        if (existsSync(to)) continue;
        // Folders as junctions (no administrator needed on Windows), files copied.
        if (statSync(from).isDirectory()) symlinkSync(from, to, "junction");
        else copyFileSync(from, to);
      }
      console.log(`Models a ${linked}: ${readdirSync(linked).join(", ")}`);
    }
    const env = { ...process.env };
    if (models) env.TRANSCRIPTOR_MODELS = models;
    driver = spawn(process.env.TAURI_DRIVER ?? "tauri-driver", [], { stdio: [null, process.stdout, process.stderr], env });
  },

  afterSession() {
    driver?.kill();
  },

  async afterTest(test, _context, { passed }) {
    if (!passed) {
      const name = test.title.replace(/[^\w-]+/g, "_");
      await browser.saveScreenshot(join(here, "captures", `${suite}-${name}.png`)).catch(() => {});
    }
  },
};
