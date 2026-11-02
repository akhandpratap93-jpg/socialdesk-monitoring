/**
 * SocialDesk Admin API — Cloudflare Worker
 *
 * Required Worker bindings/secrets:
 *   KV namespace binding: SOCIALDESK_KV
 *   Secret: ADMIN_PASSWORD
 *   Secret: SESSION_SECRET (32+ random characters)
 *
 * Routes:
 *   GET  /public/config   public preset keyword/category data only
 *   POST /admin/login     password -> HttpOnly session cookie
 *   POST /admin/logout    clears session
 *   GET  /admin/data      authenticated full portal data
 *   PUT  /admin/data      authenticated full portal data update
 *
 * Configure ALLOWED_ORIGIN as a Worker variable:
 *   https://akhandpratap93-jpg.github.io
 */
const COOKIE = "socialdesk_admin";
const SESSION_SECONDS = 8 * 60 * 60;
const DATA_KEY = "portal:data:v1";

function response(body, status, cors, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...cors,
      ...extra
    }
  });
}
function json(data, status, cors, extra) {
  return response(JSON.stringify(data), status, cors, extra);
}
function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function sha256(value) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return bytesToHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function cookieValue(request) {
  const raw = request.headers.get("Cookie") || "";
  const part = raw.split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE + "="));
  return part ? decodeURIComponent(part.slice(COOKIE.length + 1)) : "";
}
async function makeSession(secret) {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS }));
  return payload + "." + await sign(payload, secret);
}
async function validSession(request, secret) {
  const token = cookieValue(request);
  const split = token.lastIndexOf(".");
  if (split < 1) return false;
  const payload = token.slice(0, split);
  const signature = token.slice(split + 1);
  if (!safeEqual(signature, await sign(payload, secret))) return false;
  try {
    const data = JSON.parse(atob(payload));
    return Number.isFinite(data.exp) && data.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "https://akhandpratap93-jpg.github.io";
    const cors = {
      "Access-Control-Allow-Origin": origin === allowed ? allowed : "null",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };
    if (origin && origin !== allowed) return json({ error: "Origin not allowed" }, 403, cors);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (!env.SOCIALDESK_KV || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
      return json({ error: "Worker is not fully configured. Check KV binding and required secrets." }, 503, cors);
    }

    if (request.method === "GET" && path === "/public/config") {
      const saved = await env.SOCIALDESK_KV.get(DATA_KEY, "json");
      const keywords = Array.isArray(saved?.keywords) ? saved.keywords : [];
      return json({ keywords }, 200, cors);
    }

    if (request.method === "POST" && path === "/admin/login") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
      const supplied = typeof body.password === "string" ? body.password : "";
      if (!safeEqual(await sha256(supplied), await sha256(env.ADMIN_PASSWORD))) {
        return json({ error: "Invalid password" }, 401, cors);
      }
      const token = await makeSession(env.SESSION_SECRET);
      return json({ ok: true, expiresIn: SESSION_SECONDS }, 200, cors, {
        "Set-Cookie": COOKIE + "=" + encodeURIComponent(token) + "; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=" + SESSION_SECONDS
      });
    }

    if (path === "/admin/logout" && request.method === "POST") {
      return json({ ok: true }, 200, cors, {
        "Set-Cookie": COOKIE + "=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0"
      });
    }

    if (path.startsWith("/admin/")) {
      if (!(await validSession(request, env.SESSION_SECRET))) {
        return json({ error: "Admin login required" }, 401, cors);
      }
      if (request.method === "GET" && path === "/admin/data") {
        const data = await env.SOCIALDESK_KV.get(DATA_KEY, "json");
        return json(data || { keywords: [], posts: [], settings: {} }, 200, cors);
      }
      if (request.method === "PUT" && path === "/admin/data") {
        let data;
        try { data = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
        if (!data || !Array.isArray(data.keywords) || !Array.isArray(data.posts) ||
            typeof data.settings !== "object" || data.settings === null || Array.isArray(data.settings)) {
          return json({ error: "Expected keywords[], posts[] and settings{}" }, 400, cors);
        }
        if (JSON.stringify(data).length > 4_500_000) return json({ error: "Data exceeds 4.5 MB limit" }, 413, cors);
        await env.SOCIALDESK_KV.put(DATA_KEY, JSON.stringify({
          keywords: data.keywords, posts: data.posts, settings: data.settings,
          updatedAt: new Date().toISOString()
        }));
        return json({ ok: true, updatedAt: new Date().toISOString() }, 200, cors);
      }
      return json({ error: "Not found" }, 404, cors);
    }

    return json({ error: "Not found" }, 404, cors);
  }
};
