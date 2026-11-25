// Murmur's feedback (docs/COMENTARIS.md): the app sends here what the person writes in "Envia un
// comentari", only when they press "Envia". It's kept in D1 and forwarded by email.
//
// What arrives: the kind, the message, the email if they left one, the error it came from, the
// app's version, the system (os, version, machine, memory, interface language) and, if they
// ticked it, Murmur's log. Never anything from the meetings: the app doesn't send it. The IP is
// only used, hashed with a secret salt, to limit how many messages one sender can send.

import { EmailMessage } from "cloudflare:email";
import { MAX_LOG, mime, validate } from "./message.js";

const PER_HOUR = 5;
const PER_DAY_ALL = 500;

async function sha256(s) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/feedback") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (Number(request.headers.get("content-length") ?? 0) > MAX_LOG + 64 * 1024) return json(413, { error: "too large" });

    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: "bad json" });
    }
    const fb = validate(body);
    if (fb.error) return json(400, { error: fb.error });

    const now = Date.now();
    const sender = await sha256(`${env.SALT ?? "murmur"}:${request.headers.get("cf-connecting-ip") ?? ""}`);
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE sender = ?1 AND created_at > ?2").bind(sender, now - 3600_000).first();
    const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE created_at > ?1").bind(now - 86_400_000).first();
    if ((recent?.n ?? 0) >= PER_HOUR || (today?.n ?? 0) >= PER_DAY_ALL) return json(429, { error: "too many" });

    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO feedback (id, created_at, kind, message, email, context, app, system, log, sender) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )
      .bind(id, now, fb.kind, fb.message, fb.email, fb.context, fb.app, JSON.stringify(fb.system), fb.log, sender)
      .run();

    // Kept already: if the email fails, the message isn't lost.
    if (env.MAIL && env.FROM && env.TO) {
      try {
        await env.MAIL.send(new EmailMessage(env.FROM, env.TO, mime(fb, { id, from: env.FROM, to: env.TO })));
      } catch (e) {
        console.error(`email ${id}: ${e}`);
      }
    }
    return json(200, { ok: true, id });
  },
};
