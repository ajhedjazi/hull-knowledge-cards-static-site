const VISITOR_KEY = "hkc-analytics-visitor-v1";
const ATTRIBUTION_KEY = "hkc-first-ref-v1";
const SESSION_KEY = "hkc-analytics-session-v1";

function randomId(prefix) {
  try {
    return `${prefix}_${crypto.randomUUID()}`;
  } catch {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  }
}

function safeGet(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch {
    // Analytics must never block revision if browser storage is unavailable.
  }
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

export function getAnalyticsContext() {
  if (typeof window === "undefined") {
    return { visitorId: "server", sessionId: "server", firstRef: "direct" };
  }

  let visitorId = safeGet(window.localStorage, VISITOR_KEY);
  if (!visitorId) {
    visitorId = randomId("v");
    safeSet(window.localStorage, VISITOR_KEY, visitorId);
  }

  let firstRef = safeGet(window.localStorage, ATTRIBUTION_KEY);
  if (!firstRef) {
    const queryRef = new URLSearchParams(window.location.search).get("ref");
    firstRef = normaliseRef(queryRef);
    safeSet(window.localStorage, ATTRIBUTION_KEY, firstRef);
  }

  let sessionId = safeGet(window.sessionStorage, SESSION_KEY);
  if (!sessionId) {
    sessionId = randomId("s");
    safeSet(window.sessionStorage, SESSION_KEY, sessionId);
  }

  return { visitorId, sessionId, firstRef };
}

export function trackEvent(eventName, properties = {}) {
  if (typeof window === "undefined") return;
  const context = getAnalyticsContext();

  fetch("/api/analytics/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      eventName,
      ...context,
      properties,
    }),
  }).catch(() => {
    // Analytics failures must never interrupt revision.
  });
}

export async function submitFeedback(feedback) {
  const context = getAnalyticsContext();
  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...context, ...feedback }),
  });

  if (!response.ok) {
    throw new Error("FEEDBACK_FAILED");
  }

  trackEvent("feedback_submitted", {
    helpfulRating: feedback.helpfulRating || null,
    easeRating: feedback.easeRating || null,
    mostUseful: feedback.mostUseful || null,
    outcome: feedback.outcome || null,
  });
}
