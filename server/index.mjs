import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { openDatabase, normaliseCode, normaliseEmail } from "./db.mjs";
import { PRODUCT } from "../src/config/product.js";

const scrypt = promisify(scryptCallback);
const PORT = Number(process.env.PORT || 3000);
const SESSION_COOKIE = "hkc_session";
const SESSION_DAYS = 30;
const MAX_ACTIVE_SESSIONS = 2;
const ACCESS_MS = PRODUCT.accessDays * 24 * 60 * 60 * 1000;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const production = process.env.NODE_ENV === "production";
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const staticRoot = resolve(projectRoot, "dist");
const db = openDatabase();
const attempts = new Map();

const ANALYTICS_EVENTS = new Set([
  "visit",
  "feature_opened",
  "flashcard_marked",
  "practice_started",
  "practice_answered",
  "practice_completed",
  "mock_started",
  "mock_completed",
  "feedback_submitted",
]);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function json(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders });
  res.end(JSON.stringify(payload));
}

function requestIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function rateLimited(req, bucket, limit = 10, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const key = `${bucket}:${requestIp(req)}`;
  const recent = (attempts.get(key) || []).filter((time) => now - time < windowMs);
  recent.push(now);
  attempts.set(key, recent);
  return recent.length > limit;
}

function pruneRateLimits() {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, times] of attempts.entries()) {
    const recent = times.filter((time) => time >= cutoff);
    if (recent.length) attempts.set(key, recent);
    else attempts.delete(key);
  }
}
setInterval(pruneRateLimits, 10 * 60 * 1000).unref();

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("INVALID_JSON"); }
}

function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254; }
function validAnalyticsId(value, prefix) { return new RegExp(`^${prefix}_[A-Za-z0-9_-]{6,100}$`).test(String(value || "")); }
function normaliseRef(value) {
  const cleaned = String(value || "direct").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 64);
  return cleaned || "direct";
}
function rating(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 5 ? number : null;
}
function cleanProperties(value) {
  const properties = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const encoded = JSON.stringify(properties);
  if (encoded.length > 4096) throw new Error("ANALYTICS_PROPERTIES_TOO_LARGE");
  return encoded;
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("hex")}$${Buffer.from(derived).toString("hex")}`;
}

async function verifyPassword(password, encoded) {
  try {
    const [algorithm, n, r, p, saltHex, hashHex] = String(encoded).split("$");
    if (algorithm !== "scrypt") return false;
    const expected = Buffer.from(hashHex, "hex");
    const derived = Buffer.from(await scrypt(password, Buffer.from(saltHex, "hex"), expected.length, { N: Number(n), r: Number(r), p: Number(p) }));
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  } catch { return false; }
}

function tokenHash(token) { return createHash("sha256").update(token).digest("hex"); }

function cookies(req) {
  return String(req.headers.cookie || "").split(";").map((part) => part.trim()).filter(Boolean).reduce((acc, part) => {
    const index = part.indexOf("=");
    if (index > 0) acc[part.slice(0, index)] = decodeURIComponent(part.slice(index + 1));
    return acc;
  }, {});
}

function cookieHeader(token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${production ? "; Secure" : ""}`;
}
function clearCookieHeader() { return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${production ? "; Secure" : ""}`; }

function createSession(user) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const nowIso = now.toISOString();
  const sessionExpiry = new Date(Math.min(now.getTime() + SESSION_MS, new Date(user.access_expires_at).getTime()));

  db.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?").run(user.id, nowIso);
  const activeSessions = db.prepare("SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at ASC").all(user.id);
  const sessionsToRemove = Math.max(0, activeSessions.length - (MAX_ACTIVE_SESSIONS - 1));
  for (const oldSession of activeSessions.slice(0, sessionsToRemove)) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(oldSession.token_hash);
  }

  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(tokenHash(token), user.id, nowIso, sessionExpiry.toISOString());
  return { token, expiresAt: sessionExpiry.toISOString() };
}

function getSessionUser(req) {
  const token = cookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const row = db.prepare(`SELECT users.id, users.email, users.access_expires_at, sessions.expires_at AS session_expires_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?`).get(tokenHash(token));
  if (!row) return null;
  if (new Date(row.session_expires_at).getTime() <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
    return null;
  }
  return row;
}

function activeUserPayload(user) { return { email: user.email, accessExpiresAt: user.access_expires_at }; }

async function handleApi(req, res, pathname) {
  if (pathname === "/api/health" && req.method === "GET") return json(res, 200, { ok: true });

  if (pathname === "/api/analytics/events" && req.method === "POST") {
    if (rateLimited(req, "analytics", 2000)) return json(res, 429, { message: "Too many analytics events." });
    const body = await readJson(req);
    const eventName = String(body.eventName || "");
    if (!ANALYTICS_EVENTS.has(eventName)) return json(res, 400, { message: "Invalid analytics event." });
    if (!validAnalyticsId(body.visitorId, "v") || !validAnalyticsId(body.sessionId, "s")) return json(res, 400, { message: "Invalid analytics identifiers." });
    let propertiesJson;
    try { propertiesJson = cleanProperties(body.properties); }
    catch { return json(res, 400, { message: "Analytics properties are too large." }); }
    db.prepare("INSERT INTO analytics_events (visitor_id, session_id, first_ref, event_name, properties_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(String(body.visitorId), String(body.sessionId), normaliseRef(body.firstRef), eventName, propertiesJson, new Date().toISOString());
    return json(res, 202, { ok: true });
  }

  if (pathname === "/api/feedback" && req.method === "POST") {
    if (rateLimited(req, "feedback", 100)) return json(res, 429, { message: "Too many feedback submissions." });
    const body = await readJson(req);
    if (!validAnalyticsId(body.visitorId, "v") || !validAnalyticsId(body.sessionId, "s")) return json(res, 400, { message: "Invalid feedback identifiers." });
    const mostUseful = ["flashcards", "practice", "mock", "other", ""].includes(String(body.mostUseful || "")) ? String(body.mostUseful || "") : "";
    const outcome = ["not-yet", "passed", "not-passed", "prefer-not-to-say", ""].includes(String(body.outcome || "")) ? String(body.outcome || "") : "";
    const missingText = String(body.missingText || "").trim().slice(0, 1000);
    db.prepare("INSERT INTO candidate_feedback (visitor_id, session_id, first_ref, helpful_rating, ease_rating, most_useful, missing_text, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(String(body.visitorId), String(body.sessionId), normaliseRef(body.firstRef), rating(body.helpfulRating), rating(body.easeRating), mostUseful || null, missingText || null, outcome || null, new Date().toISOString());
    return json(res, 201, { ok: true });
  }

  if (pathname === "/api/auth/session" && req.method === "GET") {
    const user = getSessionUser(req);
    if (!user) return json(res, 401, { authenticated: false });
    if (new Date(user.access_expires_at).getTime() <= Date.now()) return json(res, 403, { authenticated: true, active: false, accessExpiresAt: user.access_expires_at });
    return json(res, 200, { authenticated: true, active: true, user: activeUserPayload(user) });
  }

  if (pathname === "/api/access-codes/validate" && req.method === "POST") {
    if (rateLimited(req, "validate", 20)) return json(res, 429, { message: "Too many attempts. Please try again shortly." });
    const body = await readJson(req);
    const code = normaliseCode(body.code);
    const row = db.prepare("SELECT redeemed, revoked_at FROM access_codes WHERE code = ?").get(code);
    if (!row || row.revoked_at) return json(res, 404, { status: "invalid", message: "That access code was not recognised. Check it and try again." });
    if (row.redeemed) return json(res, 409, { status: "redeemed", message: "This access code has already been activated. If this is your account, sign in instead." });
    return json(res, 200, { status: "unused" });
  }

  if (pathname === "/api/auth/redeem" && req.method === "POST") {
    if (rateLimited(req, "redeem", 10)) return json(res, 429, { message: "Too many attempts. Please try again shortly." });
    const body = await readJson(req);
    const code = normaliseCode(body.code);
    const email = normaliseEmail(body.email);
    const password = String(body.password || "");
    if (!isValidEmail(email)) return json(res, 400, { message: "Enter a valid email address." });
    if (password.length < 8) return json(res, 400, { message: "Password must be at least 8 characters." });
    if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) return json(res, 409, { code: "EMAIL_EXISTS", message: "An account already exists with this email. Please sign in." });

    const passwordHash = await hashPassword(password);
    const now = new Date();
    const accessExpiresAt = new Date(now.getTime() + ACCESS_MS).toISOString();
    try {
      db.exec("BEGIN IMMEDIATE;");
      const accessCode = db.prepare("SELECT id, redeemed, revoked_at FROM access_codes WHERE code = ?").get(code);
      if (!accessCode || accessCode.revoked_at) { db.exec("ROLLBACK;"); return json(res, 404, { message: "That access code was not recognised. Check it and try again." }); }
      if (accessCode.redeemed) { db.exec("ROLLBACK;"); return json(res, 409, { message: "This access code has already been activated. If this is your account, sign in instead." }); }
      if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) { db.exec("ROLLBACK;"); return json(res, 409, { code: "EMAIL_EXISTS", message: "An account already exists with this email. Please sign in." }); }
      const userResult = db.prepare("INSERT INTO users (email, password_hash, created_at, access_expires_at) VALUES (?, ?, ?, ?)").run(email, passwordHash, now.toISOString(), accessExpiresAt);
      const userId = Number(userResult.lastInsertRowid);
      const redeemed = db.prepare("UPDATE access_codes SET redeemed = 1, redeemed_by_user_id = ?, redeemed_at = ? WHERE id = ? AND redeemed = 0 AND revoked_at IS NULL").run(userId, now.toISOString(), accessCode.id);
      if (redeemed.changes !== 1) throw new Error("CODE_REDEMPTION_RACE");
      db.exec("COMMIT;");
      const user = { id: userId, email, access_expires_at: accessExpiresAt };
      const session = createSession(user);
      return json(res, 201, { user: activeUserPayload(user) }, { "Set-Cookie": cookieHeader(session.token, session.expiresAt) });
    } catch (error) {
      try { db.exec("ROLLBACK;"); } catch { /* transaction already closed */ }
      console.error("Redemption failed:", error?.message || error);
      return json(res, 500, { message: "We could not activate your access. Please try again." });
    }
  }

  if (pathname === "/api/auth/login" && req.method === "POST") {
    if (rateLimited(req, "login", 10)) return json(res, 429, { message: "Too many sign-in attempts. Please try again shortly." });
    const body = await readJson(req);
    const email = normaliseEmail(body.email);
    const password = String(body.password || "");
    const user = db.prepare("SELECT id, email, password_hash, access_expires_at FROM users WHERE email = ?").get(email);
    const valid = user ? await verifyPassword(password, user.password_hash) : false;
    if (!valid) return json(res, 401, { message: "Email or password is incorrect." });
    if (new Date(user.access_expires_at).getTime() <= Date.now()) return json(res, 403, { code: "ACCESS_EXPIRED", message: "Your access period has ended.", accessExpiresAt: user.access_expires_at });
    const session = createSession(user);
    return json(res, 200, { user: activeUserPayload(user) }, { "Set-Cookie": cookieHeader(session.token, session.expiresAt) });
  }

  if (pathname === "/api/auth/logout" && req.method === "POST") {
    const token = cookies(req)[SESSION_COOKIE];
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
    return json(res, 200, { ok: true }, { "Set-Cookie": clearCookieHeader() });
  }
  return json(res, 404, { message: "Not found." });
}

function serveStatic(res, pathname) {
  if (!existsSync(staticRoot)) return json(res, 503, { message: "Frontend build is not available." });
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const normalisedPath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  let filePath = resolve(join(staticRoot, normalisedPath));
  if (!filePath.startsWith(staticRoot)) return json(res, 404, { message: "Not found." });
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = resolve(join(staticRoot, "index.html"));
  const extension = extname(filePath).toLowerCase();
  const cacheControl = extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable";
  res.writeHead(200, { "Content-Type": MIME_TYPES[extension] || "application/octet-stream", "Cache-Control": cacheControl, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "DENY" });
  res.end(readFileSync(filePath));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url.pathname);
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { message: "Method not allowed." });
    return serveStatic(res, url.pathname);
  } catch (error) {
    if (error?.message === "BODY_TOO_LARGE") return json(res, 413, { message: "Request is too large." });
    if (error?.message === "INVALID_JSON") return json(res, 400, { message: "Invalid request." });
    console.error("Request failed:", error?.message || error);
    return json(res, 500, { message: "Something went wrong. Please try again." });
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`Hull Knowledge Cards server listening on port ${PORT}`));
