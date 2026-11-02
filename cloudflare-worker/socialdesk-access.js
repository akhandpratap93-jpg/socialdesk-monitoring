// SocialDesk secure backend — Cloudflare Worker
// Required bindings:
//   KV namespace binding: SOCIALDESK_KV
// Required secrets:
//   ADMIN_PASSWORD  (strong unique password)
//   AUTH_SECRET     (random secret, at least 32 characters)
// Configure ALLOWED_ORIGIN as a Worker environment variable, e.g.
//   https://akhandpratap93-jpg.github.io

const DATA_KEY = "socialdesk:portal:data";
const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const MAX_BODY_BYTES = 2_000_000;

function cors(origin, env) {
  const allowed = env.ALLOWED_ORIGIN || "";
  const ok = origin === allowed;
  return {
    "Access-Control-Allow-Origin": ok ? allowed : "null",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function response(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}
function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function fromB64url(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  s += "=".repeat((4 - s.length % 4) % 4);
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
async function hmac(value, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}
function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
async function issueToken(env) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ role: "admin", exp: Math.floor(Date.now()/1000) + TOKEN_TTL_SECONDS })));
  return payload + "." + b64url(await hmac(payload, env.AUTH_SECRET));
}
async function isAdmin(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const expected = b64url(await hmac(parts[0], env.AUTH_SECRET));
  if (!safeEqual(parts[1], expected)) return false;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    return p.role === "admin" && p.exp > Math.floor(Date.now()/1000);
  } catch { return false; }
}
async function readBody(request) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > MAX_BODY_BYTES) throw new Error("Payload too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new Error("Payload too large");
  return JSON.parse(text);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = cors(origin, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (origin !== (env.ALLOWED_ORIGIN || "")) return response({ error: "Origin not allowed" }, 403, headers);
    if (!env.SOCIALDESK_KV || !env.ADMIN_PASSWORD || !env.AUTH_SECRET || !env.ALLOWED_ORIGIN) {
      return response({ error: "Worker configuration incomplete" }, 500, headers);
    }

    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") {
      return response({ ok: true, service: "SocialDesk secure storage" }, 200, headers);
    }

    if (url.pathname === "/api/login" && request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const failKey = "login-fail:" + ip;
      const failures = Number(await env.SOCIALDESK_KV.get(failKey) || 0);
      if (failures >= 8) return response({ error: "Too many attempts. Try again in 15 minutes." }, 429, headers);
      let body;
      try { body = await readBody(request); } catch { return response({ error: "Invalid request" }, 400, headers); }
      if (!safeEqual(body.password || "", env.ADMIN_PASSWORD)) {
        await env.SOCIALDESK_KV.put(failKey, String(failures + 1), { expirationTtl: 900 });
        return response({ error: "Incorrect admin password" }, 401, headers);
      }
      await env.SOCIALDESK_KV.delete(failKey);
      return response({ token: await issueToken(env), expiresIn: TOKEN_TTL_SECONDS }, 200, headers);
    }

    if (url.pathname === "/api/public" && request.method === "GET") {
      const raw = await env.SOCIALDESK_KV.get(DATA_KEY);
      let data = { keywords: [] };
      if (raw) {
        try { data = JSON.parse(raw); } catch {}
      }
      return response({ keywords: Array.isArray(data.keywords) ? data.keywords : [] }, 200, headers);
    }

    if (url.pathname === "/api/data" && (request.method === "GET" || request.method === "PUT")) {
      if (!(await isAdmin(request, env))) return response({ error: "Admin login required" }, 401, headers);
      if (request.method === "GET") {
        const raw = await env.SOCIALDESK_KV.get(DATA_KEY);
        return response(raw ? JSON.parse(raw) : { keywords: [], posts: [] }, 200, headers);
      }
      let body;
      try { body = await readBody(request); } catch { return response({ error: "Invalid or oversized request" }, 400, headers); }
      if (!body || !Array.isArray(body.keywords) || !Array.isArray(body.posts)) {
        return response({ error: "Expected keywords and posts arrays" }, 400, headers);
      }
      if (body.keywords.length > 5000 || body.posts.length > 50000) return response({ error: "Data limit exceeded" }, 413, headers);
      await env.SOCIALDESK_KV.put(DATA_KEY, JSON.stringify({ keywords: body.keywords, posts: body.posts, updatedAt: new Date().toISOString() }));
      return response({ ok: true, updatedAt: new Date().toISOString() }, 200, headers);
    }

    return response({ error: "Not found" }, 404, headers);
  }
};
