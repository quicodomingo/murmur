// What a feedback message must look like, and the email made from it (worker.js). Plain
// JavaScript, so `npm test` runs it with Node.

const KINDS = ["bug", "idea", "other"];
const MAX_MESSAGE = 5000;
export const MAX_LOG = 300 * 1024;

/** The body, checked: what's kept, or an error to answer with. */
export function validate(body) {
  if (!body || typeof body !== "object") return { error: "bad request" };
  const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const kind = KINDS.includes(body.kind) ? body.kind : null;
  const message = text(body.message, MAX_MESSAGE + 1);
  if (!kind) return { error: "kind" };
  if (message.length < 10) return { error: "message too short" };
  if (message.length > MAX_MESSAGE) return { error: "message too long" };
  const email = text(body.email, 201);
  if (email && (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { error: "email" };
  if (typeof body.log === "string" && body.log.length > MAX_LOG) return { error: "log too long" };
  const s = body.system && typeof body.system === "object" ? body.system : {};
  const system = {};
  for (const key of ["os", "osVersion", "arch", "machine", "memory", "language"]) {
    const v = text(String(s[key] ?? ""), 80);
    if (v) system[key] = v;
  }
  const app = text(body.app, 40);
  if (!/^(desktop|iphone|android) \d+\.\d+(\.\d+)?$/.test(app)) return { error: "app" };
  return {
    kind,
    message,
    email: email || null,
    context: text(body.context, 1000) || null,
    app,
    system,
    log: typeof body.log === "string" && body.log.trim() ? body.log : null,
  };
}

const KIND_NAMES = { bug: "Alguna cosa no va", idea: "Una idea", other: "Una altra cosa" };

/** RFC 2047, for a subject with accents. */
const header = (s) => `=?UTF-8?B?${b64(s)}?=`;

function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/.{76}/g, "$&\r\n");
}

/** The email for one message (raw MIME): the text, then the log as an attachment. */
export function mime(fb, { id, from, to, date = new Date() }) {
  const sys = fb.system;
  const subject = `[Murmur] ${KIND_NAMES[fb.kind]} · ${fb.app}${sys.os ? ` · ${sys.os}` : ""}`;
  const lines = [
    fb.message,
    "",
    "--",
    `${KIND_NAMES[fb.kind]} · ${fb.app}`,
    [sys.os, sys.osVersion, sys.arch].filter(Boolean).join(" "),
    [sys.machine, sys.memory].filter(Boolean).join(" · "),
    sys.language ? `Interfície: ${sys.language}` : "",
    fb.context ? `Error: ${fb.context}` : "",
    fb.email ? `Respon a: ${fb.email}` : "Sense correu per respondre",
    `Id: ${id}`,
  ].filter((l, i) => i < 3 || l);
  const boundary = `murmur-${id}`;
  const parts = [
    `From: Murmur <${from}>`,
    `To: ${to}`,
    fb.email ? `Reply-To: ${fb.email}` : null,
    `Subject: ${header(subject)}`,
    `Message-ID: <${id}@${from.split("@")[1]}>`,
    `Date: ${date.toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(lines.join("\n")),
  ].filter((l) => l !== null);
  if (fb.log) {
    parts.push(
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8; name="murmur.log"',
      'Content-Disposition: attachment; filename="murmur.log"',
      "Content-Transfer-Encoding: base64",
      "",
      b64(fb.log),
    );
  }
  parts.push(`--${boundary}--`, "");
  return parts.join("\r\n");
}

