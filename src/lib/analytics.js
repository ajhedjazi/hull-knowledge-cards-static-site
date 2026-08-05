const VISITOR_KEY = "hkc-analytics-visitor-v1";
const ATTRIBUTION_KEY = "hkc-first-ref-v1";
const SESSION_KEY = "hkc-analytics-session-v1";
const CONSENT_KEY = "hkc-analytics-consent-v1";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

function randomId(prefix) {
  try {
    return `${prefix}_${crypto.randomUUID()}`;
  } catch {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  }
}

function safeGet(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}

function safeSet(storage, key, value) {
  try { storage.setItem(key, value); } catch { /* Never block revision. */ }
}

function safeRemove(storage, key) {
  try { storage.removeItem(key); } catch { /* Never block revision. */ }
}

function normaliseRef(value) {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64);
  return cleaned || "direct";
}

export function getAnalyticsConsent() {
  if (typeof window === "undefined") return null;
  const stored = safeGet(window.localStorage, CONSENT_KEY);
  if (stored === "yes") return true;
  if (stored === "no") return false;
  return null;
}

export function setAnalyticsConsent(allowed) {
  if (typeof window === "undefined") return;
  safeSet(window.localStorage, CONSENT_KEY, allowed ? "yes" : "no");
  if (!allowed) {
    safeRemove(window.localStorage, VISITOR_KEY);
    safeRemove(window.localStorage, ATTRIBUTION_KEY);
    safeRemove(window.sessionStorage, SESSION_KEY);
  }
}

export function getAnalyticsContext({ ephemeral = false } = {}) {
  if (typeof window === "undefined") {
    return { visitorId: "v_server000", sessionId: "s_server000", firstRef: "direct" };
  }

  const queryRef = normaliseRef(new URLSearchParams(window.location.search).get("ref"));
  if (getAnalyticsConsent() !== true) {
    return {
      visitorId: randomId("v"),
      sessionId: randomId("s"),
      firstRef: queryRef,
      ephemeral: true,
    };
  }

  let visitorId = safeGet(window.localStorage, VISITOR_KEY);
  if (!visitorId) {
    visitorId = randomId("v");
    safeSet(window.localStorage, VISITOR_KEY, visitorId);
  }

  let firstRef = safeGet(window.localStorage, ATTRIBUTION_KEY);
  if (!firstRef) {
    firstRef = queryRef;
    safeSet(window.localStorage, ATTRIBUTION_KEY, firstRef);
  }

  const now = Date.now();
  let sessionRecord = null;
  try { sessionRecord = JSON.parse(safeGet(window.sessionStorage, SESSION_KEY) || "null"); } catch { sessionRecord = null; }
  if (!sessionRecord?.id || !sessionRecord?.lastSeen || now - sessionRecord.lastSeen > SESSION_TIMEOUT_MS) {
    sessionRecord = { id: randomId("s"), lastSeen: now };
  } else {
    sessionRecord.lastSeen = now;
  }
  safeSet(window.sessionStorage, SESSION_KEY, JSON.stringify(sessionRecord));

  return { visitorId, sessionId: sessionRecord.id, firstRef, ephemeral };
}

export function trackEvent(eventName, properties = {}) {
  if (typeof window === "undefined" || getAnalyticsConsent() !== true) return;
  const context = getAnalyticsContext();

  fetch("/api/analytics/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ eventName, ...context, properties }),
  }).catch(() => {
    // Analytics failures must never interrupt revision.
  });
}

export async function submitFeedback(feedback) {
  const context = getAnalyticsContext({ ephemeral: getAnalyticsConsent() !== true });
  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...context, ...feedback }),
  });

  if (!response.ok) throw new Error("FEEDBACK_FAILED");

  trackEvent("feedback_submitted", {
    helpfulRating: feedback.helpfulRating || null,
    easeRating: feedback.easeRating || null,
    mostUseful: feedback.mostUseful || null,
    outcome: feedback.outcome || null,
  });
}
