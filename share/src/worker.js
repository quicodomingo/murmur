// Murmur's shared links (docs/COMPARTIR.md). Murmur encrypts a meeting on the Mac and uploads
// the result here; this Worker keeps it in KV (which deletes it when it expires) and serves the
// page that decrypts it in the browser. The key travels in the link's #fragment, or comes from a
// password, so neither this Worker nor Cloudflare can read what it stores.
//
//   GET    /api/ping          checks the API key (Murmur, when connecting)
//   POST   /api/shares?ttl=s  stores an encrypted meeting; ttl in seconds, none = never expires
//   DELETE /api/shares/:id    withdraws it
//   GET    /:id               the viewer page
//   GET    /:id.json          the encrypted meeting

/** KV takes values up to 25 MiB. */
const MAX_BYTES = 20 * 1024 * 1024;
/** KV's shortest expiry. */
const MIN_TTL = 60;

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
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return api(request, env, url);

    const match = url.pathname.match(/^\/([A-Za-z0-9]{12})(\.json)?$/);
    if (match && request.method === "GET") {
      const [, id, json] = match;
      if (json) {
        const data = await env.SHARES.get(id);
        if (data === null) return reply({ error: "not_found" }, 404);
        return new Response(data, { headers: { ...SECURITY, "content-type": "application/json", "cache-control": "no-store" } });
      }
      const page = await env.ASSETS.fetch(new Request(new URL("/viewer.html", url)));
      return new Response(page.body, {
        headers: { ...SECURITY, "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", "content-security-policy": VIEWER_CSP },
      });
    }
    return new Response("Murmur", { status: 404, headers: { ...SECURITY, "content-type": "text/plain; charset=utf-8" } });
  },
};

async function api(request, env, url) {
  if (!env.API_KEY) return reply({ error: "no_api_key" }, 500);
  if (!(await authorized(request, env.API_KEY))) return reply({ error: "unauthorized" }, 401);

  if (url.pathname === "/api/ping" && request.method === "GET") return reply({ ok: true, v: 1 });

  if (url.pathname === "/api/shares" && request.method === "POST") {
    const ttl = url.searchParams.has("ttl") ? Number(url.searchParams.get("ttl")) : null;
    if (ttl !== null && (!Number.isInteger(ttl) || ttl < MIN_TTL)) return reply({ error: "bad_ttl" }, 400);
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return reply({ error: "too_large" }, 413);
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
    await env.SHARES.put(id, body, ttl ? { expirationTtl: ttl } : {});
    return reply({ id, url: `${url.origin}/${id}`, expiresAt: ttl ? Date.now() + ttl * 1000 : null }, 201);
  }

  const del = url.pathname.match(/^\/api\/shares\/([A-Za-z0-9]{12})$/);
  if (del && request.method === "DELETE") {
    await env.SHARES.delete(del[1]);
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

const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...SECURITY, "content-type": "application/json", "cache-control": "no-store" } });

