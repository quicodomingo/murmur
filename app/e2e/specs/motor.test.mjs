// Prova e2e del motor, sense interfície: l'app amb `--mcp` (el connector per a Claude) transcriu
// un fitxer d'àudio de veritat amb el model de transcripció, com ho faria Claude. Funciona a
// macOS, Windows i Linux, i comprova el que la interfície no pot: que els models, sherpa-onnx i la
// descodificació de l'àudio funcionen en aquest sistema.
//
//   MURMUR_E2E_MODELS=<carpeta dels models> node --test specs/motor.test.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const exe = process.platform === "win32" ? "transcriptor.exe" : "transcriptor";
// MURMUR_E2E_APP: an installed app (the CI's package test) instead of the one built in target/.
const application = process.env.MURMUR_E2E_APP || resolve(here, "../../src-tauri/target", process.env.MURMUR_E2E_PROFILE ?? "debug", exe);
const fixture = resolve(here, "../fixtures/bon-dia.wav");
const models = process.env.MURMUR_E2E_MODELS && resolve(process.env.MURMUR_E2E_MODELS);
const haveModels = !!models && existsSync(join(models, "conformer-ca-es-sherpa/encoder.onnx"));
// The CI asks for it: a missing model there is an error, not a skip.
if (process.env.MURMUR_E2E_REQUIRE_MODELS && !haveModels) throw new Error(`Falta el model de transcripció a ${models}`);

/** The app as an MCP server, with its data in a folder of its own. */
function server() {
  const home = mkdtempSync(join(tmpdir(), "murmur-e2e-"));
  const env = { ...process.env, TRANSCRIPTOR_MODELS: models ?? "", XDG_DATA_HOME: join(home, "data"), XDG_CONFIG_HOME: join(home, "config") };
  const child = spawn(application, ["--mcp"], { env, stdio: ["pipe", "pipe", "inherit"] });
  const pending = new Map();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const reply = JSON.parse(line);
    pending.get(reply.id)?.(reply);
    pending.delete(reply.id);
  });
  let id = 0;
  const call = (method, params = {}) =>
    new Promise((done, fail) => {
      const n = ++id;
      const timer = setTimeout(() => fail(new Error(`Sense resposta a ${method}`)), 60_000);
      pending.set(n, (reply) => {
        clearTimeout(timer);
        reply.error ? fail(new Error(reply.error.message)) : done(reply.result);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
    });
  const tool = async (name, args) => (await call("tools/call", { name, arguments: args })).content.map((c) => c.text).join("\n");
  return { call, tool, close: () => child.kill() };
}

test("el connector arrenca i llista les eines", async () => {
  assert.ok(existsSync(application), `Falta l'app compilada: ${application}`);
  const mcp = server();
  try {
    const init = await mcp.call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
    assert.equal(init.serverInfo.name, "murmur");
    const { tools } = await mcp.call("tools/list");
    const names = tools.map((t) => t.name);
    for (const name of ["list_meetings", "transcribe_file", "get_transcription"]) assert.ok(names.includes(name), `Falta l'eina ${name}`);
    // Sense reunions, la llista és buida però respon.
    assert.match(await mcp.tool("list_meetings", {}), /\S/);
  } finally {
    mcp.close();
  }
});

test("transcriu un fitxer en català", { skip: !haveModels && "sense el model de transcripció (MURMUR_E2E_MODELS)", timeout: 10 * 60_000 }, async () => {
  const mcp = server();
  try {
    await mcp.call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
    const started = await mcp.tool("transcribe_file", { path: fixture, language: "ca" });
    const job = started.match(/Job id: (\S+)/)?.[1];
    assert.ok(job, started);
    let text = "";
    for (let i = 0; i < 300; i++) {
      text = await mcp.tool("get_transcription", { job_id: job });
      if (!/^(Still working|Queued|Waiting)/.test(text)) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log(text);
    assert.doesNotMatch(text, /failed/i);
    const words = text.toLowerCase();
    // La veu sintètica de la prova diu «Bon dia a tothom. Avui parlarem del pressupost de l'any que
    // ve i de les vacances d'estiu.»: n'hi ha prou que se n'entenguin unes quantes paraules.
    const heard = ["bon dia", "tothom", "avui", "pressupost", "vacances", "estiu"].filter((w) => words.includes(w));
    assert.ok(heard.length >= 3, `Només s'han entès ${heard.length} paraules: ${text}`);
  } finally {
    mcp.close();
  }
});
