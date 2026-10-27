// Murmur's shared links (docs/COMPARTIR.md). Murmur encrypts a meeting on the Mac and uploads
// the result here; this Worker keeps it in KV (which deletes it when it expires) and serves the
// page that decrypts it in the browser. The key travels in the link's #fragment, or comes from a
// password, so neither this Worker nor Cloudflare can read what it stores.
//
//   GET    /api/ping                     checks the API key; says which version this is
//   POST   /api/shares?ttl=s             stores an encrypted meeting; ttl in seconds, none = never
//   PUT    /api/shares/:id/:file?ttl=s   one of its encrypted files (screenshot, piece of audio)
//   DELETE /api/shares/:id               withdraws it, files included
//   GET    /:id                          the viewer page
//   GET    /:id.json                     the encrypted meeting
//   GET    /:id/:file                    one of its encrypted files
//
// Murmur publishes this same code from Settings › Compartir (share.rs), or `./setup.sh` does.

import VIEWER_HTML from "./viewer.html";
import VIEWER_CSS from "./viewer.css";
import VIEWER_JS from "./viewer-script.js";

/** Bumped when the Worker changes: Murmur republishes it when it finds an older one. */
const VERSION = 4;

/** KV takes values up to 25 MiB. */
const MAX_BYTES = 20 * 1024 * 1024;
/** KV's shortest expiry. */
const MIN_TTL = 60;
const ID = "[A-Za-z0-9]{12}";
const FILE = "[a-z0-9]{1,16}(?:\\.[0-9]{1,4})?";

const SECURITY = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
};

const VIEWER_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self' blob: data:",
  "media-src blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.startsWith("/api/")) return api(request, env, url);
    if (request.method !== "GET") return notFound();

    if (path === "/viewer.css") return text(VIEWER_CSS, "text/css; charset=utf-8");
    if (path === "/viewer.js") return text(VIEWER_JS, "text/javascript; charset=utf-8");

    let match = path.match(new RegExp(`^/(${ID})(\\.json)?$`));
    if (match) {
      const [, id, json] = match;
      if (!json) return text(VIEWER_HTML, "text/html; charset=utf-8", { "content-security-policy": VIEWER_CSP, "cache-control": "no-cache" });
      const data = await env.SHARES.get(id);
      if (data === null) return reply({ error: "not_found" }, 404);
      return new Response(data, { headers: { ...SECURITY, "content-type": "application/json", "cache-control": "no-store" } });
    }
    match = path.match(new RegExp(`^/(${ID})/(${FILE})$`));
    if (match) {
      const data = await env.SHARES.get(`${match[1]}/${match[2]}`, "arrayBuffer");
      if (data === null) return reply({ error: "not_found" }, 404);
      return new Response(data, { headers: { ...SECURITY, "content-type": "application/octet-stream", "cache-control": "private, max-age=3600" } });
    }
    return notFound();
  },
};

async function api(request, env, url) {
  if (!env.API_KEY) return reply({ error: "no_api_key" }, 500);
  if (!(await authorized(request, env.API_KEY))) return reply({ error: "unauthorized" }, 401);
  const path = url.pathname;

  if (path === "/api/ping" && request.method === "GET") return reply({ ok: true, v: 1, version: VERSION });

  const ttl = url.searchParams.has("ttl") ? Number(url.searchParams.get("ttl")) : null;
  if (ttl !== null && (!Number.isInteger(ttl) || ttl < MIN_TTL)) return reply({ error: "bad_ttl" }, 400);
  const expiry = ttl ? { expirationTtl: ttl } : {};
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return reply({ error: "too_large" }, 413);

  if (path === "/api/shares" && request.method === "POST") {
    const body = await request.text();
    if (body.length > MAX_BYTES) return reply({ error: "too_large" }, 413);
    // Only Murmur's encrypted envelopes: this is not a place to host anything else.
    let envelope;
    try {
      envelope = JSON.parse(body);
    } catch {
      return reply({ error: "bad_envelope" }, 400);
    }
    if (envelope?.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.data !== "string") return reply({ error: "bad_envelope" }, 400);

    const id = newId();
    await env.SHARES.put(id, body, expiry);
    return reply({ id, url: `${url.origin}/${id}`, expiresAt: ttl ? Date.now() + ttl * 1000 : null }, 201);
  }

  let match = path.match(new RegExp(`^/api/shares/(${ID})/(${FILE})$`));
  if (match && request.method === "PUT") {
    // A file only goes with a meeting that is there.
    if ((await env.SHARES.get(match[1])) === null) return reply({ error: "not_found" }, 404);
    const data = await request.arrayBuffer();
    if (data.byteLength > MAX_BYTES) return reply({ error: "too_large" }, 413);
    await env.SHARES.put(`${match[1]}/${match[2]}`, data, expiry);
    return new Response(null, { status: 204, headers: SECURITY });
  }

  match = path.match(new RegExp(`^/api/shares/(${ID})$`));
  if (match && request.method === "DELETE") {
    const id = match[1];
    let cursor;
    do {
      const page = await env.SHARES.list({ prefix: `${id}/`, cursor });
      await Promise.all(page.keys.map((k) => env.SHARES.delete(k.name)));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    await env.SHARES.delete(id);
    return new Response(null, { status: 204, headers: SECURITY });
  }
  return reply({ error: "not_found" }, 404);
}

/** "Authorization: Bearer <API_KEY>", compared in constant time. */
async function authorized(request, key) {
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const enc = new TextEncoder();
  // Hashing first gives both sides the same length, which timingSafeEqual needs.
  const [a, b] = await Promise.all([given, key].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))));
  return crypto.subtle.timingSafeEqual(a, b);
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function newId() {
  // 248 = 4 × 62: dropping bytes above it keeps every letter equally likely.
  let id = "";
  while (id.length < 12) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < 248 && id.length < 12) id += ALPHABET[byte % 62];
    }
  }
  return id;
}

const text = (body, type, headers = {}) => new Response(body, { headers: { ...SECURITY, "content-type": type, "cache-control": "public, max-age=300", ...headers } });

const notFound = () => new Response("Murmur", { status: 404, headers: { ...SECURITY, "content-type": "text/plain; charset=utf-8" } });

const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...SECURITY, "content-type": "application/json", "cache-control": "no-store" } });
