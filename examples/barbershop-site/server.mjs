// Sam's Barbershop: a tiny stand-alone site that takes bookings through the Kitpier Booking API.
// Built from Kitpier's "Use in your app" prompt. No dependencies: `node --env-file=.env server.mjs`.
// The Kitpier key stays on this server; the browser only talks to the three /api routes below.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const PORT = Number(process.env.PORT ?? 3006);
const API_URL = process.env.KITPIER_API_URL;
const API_KEY = process.env.KITPIER_API_KEY;
if (!API_URL || !API_KEY) {
  console.error("Set KITPIER_API_URL and KITPIER_API_KEY in .env (see .env.example).");
  process.exit(1);
}

// Browser route → Kitpier endpoint, with the fields the browser may send.
const ROUTES = {
  "/api/chat": { path: "/v1/booking/converse", fields: ["conversationId", "requestId", "message"] },
  "/api/code": { path: "/v1/booking/code", fields: ["conversationId", "pendingId"] },
  "/api/confirm": { path: "/v1/booking/confirm", fields: ["conversationId", "pendingId", "requestId", "code"] },
};

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 8_000) throw new Error("too large");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/") {
      return send(res, 200, await readFile(new URL("./index.html", import.meta.url)), "text/html; charset=utf-8");
    }
    const route = ROUTES[url.pathname];
    if (!route || req.method !== "POST") return send(res, 404, { error: "Not found" });

    const input = await readJson(req);
    const body = Object.fromEntries(route.fields.filter((f) => input[f] !== undefined).map((f) => [f, input[f]]));
    body.customerIp = (req.headers["x-forwarded-for"]?.split(",")[0] ?? req.socket.remoteAddress ?? "").trim() || undefined;

    const r = await fetch(new URL(route.path, API_URL), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const json = await r.json().catch(() => ({ error: "Booking is unavailable right now." }));
    // Never pass Kitpier's auth errors through as-is: the visitor can't fix the site's key.
    if (r.status === 401) return send(res, 503, { error: "Online booking isn't set up correctly. Please call us instead." });
    return send(res, r.status, json);
  } catch {
    return send(res, 400, { error: "Something went wrong. Please try again." });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Sam's Barbershop on http://localhost:${PORT}`));
