// Builds murmur-whisper (app/whisper) and copies it where Tauri looks for the sidecar:
// src-tauri/binaries/murmur-whisper-<target triple>[.exe] (tauri.conf.json › externalBin).
// `npm run whisper`; MURMUR_TARGET picks another target (e.g. x86_64-apple-darwin).
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const host = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/^host: (\S+)$/m)[1];
const target = process.env.MURMUR_TARGET || process.env.TAURI_ENV_TARGET_TRIPLE || host;
const exe = target.includes("windows") ? ".exe" : "";

// whisper.cpp would build for the CPU it's built on (GGML_NATIVE): on a CI runner, AVX-512 that
// most PCs don't have. The same AVX2 baseline as .cargo/config.toml instead.
const env = { ...process.env };
if (!target.includes("apple") && target.startsWith("x86_64")) {
  Object.assign(env, { GGML_NATIVE: "OFF", GGML_AVX: "ON", GGML_AVX2: "ON", GGML_FMA: "ON", GGML_F16C: "ON" });
}

const args = ["build", "--release"];
if (target !== host) args.push("--target", target);
execFileSync("cargo", args, { cwd: join(app, "whisper"), stdio: "inherit", env });

const built = join(app, "whisper", "target", target !== host ? target : "", "release", `murmur-whisper${exe}`);
const dest = join(app, "src-tauri", "binaries", `murmur-whisper-${target}${exe}`);
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(built, dest);
console.log(`murmur-whisper → ${dest}`);
