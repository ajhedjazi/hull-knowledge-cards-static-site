const VISITOR_KEY = "hkc-analytics-visitor-v1";
const ATTRIBUTION_KEY = "hkc-first-ref-v1";
const COHORT_KEY = "hkc-analytics-cohort-v1";
const SESSION_KEY = "hkc-analytics-session-v1";
const CONSENT_KEY = "hkc-analytics-consent-v1";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const pendingEvents = [];
let controlsReady = false;
let pendingCohortKey = null;

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

function normaliseCohort(value) {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64);
  return cleaned || null;
}

export function getAnalyticsConsent() {
  if (typeof window === "undefined") return null;
  const stored = safeGet(window.localStorage, CONSENT_KEY);
  if (stored === "yes") return true;
  if (stored === "no") return false;
  return null;
}

export function setCohortAttribution(cohortKey) {
  pendingCohortKey = normaliseCohort(cohortKey);
  if (typeof window !== "undefined" && getAnalyticsConsent() === true && pendingCohortKey) {
    safeSet(window.localStorage, COHORT_KEY, pendingCohortKey);
  }
}

export function setAnalyticsConsent(allowed) {
  if (typeof window === "undefined") return;
  safeSet(window.localStorage, CONSENT_KEY, allowed ? "yes" : "no");
  if (allowed && pendingCohortKey) {
    safeSet(window.localStorage, COHORT_KEY, pendingCohortKey);
  }
  if (!allowed) {
    safeRemove(window.localStorage, VISITOR_KEY);
    safeRemove(window.localStorage, ATTRIBUTION_KEY);
    safeRemove(window.localStorage, COHORT_KEY);
    safeRemove(window.sessionStorage, SESSION_KEY);
  }
}

export function getAnalyticsContext({ ephemeral = false } = {}) {
  if (typeof window === "undefined") {
    return { visitorId: "v_server000", sessionId: "s_server000", firstRef: "direct", cohortKey: null };
  }

  const queryRef = normaliseRef(new URLSearchParams(window.location.search).get("ref"));
  const currentCohort = pendingCohortKey || normaliseCohort(safeGet(window.localStorage, COHORT_KEY));
  if (getAnalyticsConsent() !== true) {
    return {
      visitorId: randomId("v"),
      sessionId: randomId("s"),
      firstRef: queryRef,
      cohortKey: currentCohort,
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

  if (currentCohort) safeSet(window.localStorage, COHORT_KEY, currentCohort);

  const now = Date.now();
  let sessionRecord = null;
  try { sessionRecord = JSON.parse(safeGet(window.sessionStorage, SESSION_KEY) || "null"); } catch { sessionRecord = null; }
  if (!sessionRecord?.id || !sessionRecord?.lastSeen || now - sessionRecord.lastSeen > SESSION_TIMEOUT_MS) {
    sessionRecord = { id: randomId("s"), lastSeen: now };
  } else {
    sessionRecord.lastSeen = now;
  }
  safeSet(window.sessionStorage, SESSION_KEY, JSON.stringify(sessionRecord));

  return { visitorId, sessionId: sessionRecord.id, firstRef, cohortKey: currentCohort, ephemeral };
}

function sendEvent(eventName, properties) {
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

function flushPendingEvents() {
  const queued = pendingEvents.splice(0, pendingEvents.length);
  queued.forEach(({ eventName, properties }) => sendEvent(eventName, properties));
}

function ensureAnalyticsControls() {
  if (typeof document === "undefined" || controlsReady) return;
  controlsReady = true;

  const choiceButton = document.createElement("button");
  choiceButton.type = "button";
  choiceButton.textContent = "Analytics choices";
  Object.assign(choiceButton.style, {
    position: "fixed",
    left: "10px",
    bottom: "10px",
    zIndex: "90",
    padding: "8px 10px",
    border: "1px solid #bed0cb",
    borderRadius: "10px",
    background: "#fffdf8",
    color: "#315a56",
    font: "600 12px system-ui, sans-serif",
    cursor: "pointer",
    boxShadow: "0 5px 18px #1432301a",
  });

  const panel = document.createElement("div");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Analytics choices");
  Object.assign(panel.style, {
    position: "fixed",
    left: "12px",
    right: "12px",
    bottom: "12px",
    zIndex: "100",
    maxWidth: "680px",
    margin: "0 auto",
    padding: "14px",
    border: "1px solid #cbdad5",
    borderRadius: "14px",
    background: "#fffdf8",
    color: "#173f3c",
    boxShadow: "0 16px 40px #1432302c",
    font: "14px/1.45 system-ui, sans-serif",
  });

  const copy = document.createElement("p");
  copy.style.margin = "0 0 12px";
  copy.textContent = "Optional analytics help improve this revision tool. If allowed, a pseudonymous visitor ID, first referral source, cohort identifier where relevant, and learning events are stored so repeat use can be measured. No name or email is collected for analytics.";

  const actions = document.createElement("div");
  Object.assign(actions.style, { display: "flex", gap: "8px", flexWrap: "wrap" });

  const allowButton = document.createElement("button");
  allowButton.type = "button";
  allowButton.textContent = "Allow analytics";
  Object.assign(allowButton.style, {
    padding: "9px 12px",
    border: "1px solid #073b3a",
    borderRadius: "10px",
    background: "#073b3a",
    color: "white",
    font: "700 13px system-ui, sans-serif",
    cursor: "pointer",
  });

  const declineButton = document.createElement("button");
  declineButton.type = "button";
  declineButton.textContent = "Do not allow";
  Object.assign(declineButton.style, {
    padding: "9px 12px",
    border: "1px solid #bed0cb",
    borderRadius: "10px",
    background: "white",
    color: "#173f3c",
    font: "700 13px system-ui, sans-serif",
    cursor: "pointer",
  });

  function closePanel() {
    panel.style.display = "none";
    choiceButton.style.display = "block";
  }

  allowButton.addEventListener("click", () => {
    setAnalyticsConsent(true);
    closePanel();
    flushPendingEvents();
  });

  declineButton.addEventListener("click", () => {
    setAnalyticsConsent(false);
    pendingEvents.splice(0, pendingEvents.length);
    closePanel();
  });

  choiceButton.addEventListener("click", () => {
    panel.style.display = "block";
    choiceButton.style.display = "none";
  });

  actions.append(allowButton, declineButton);
  panel.append(copy, actions);
  document.body.append(choiceButton, panel);

  if (getAnalyticsConsent() === null) {
    choiceButton.style.display = "none";
    panel.style.display = "block";
  } else {
    choiceButton.style.display = "block";
    panel.style.display = "none";
  }
}

export function trackEvent(eventName, properties = {}) {
  if (typeof window === "undefined") return;
  ensureAnalyticsControls();
  const consent = getAnalyticsConsent();
  if (consent === true) {
    sendEvent(eventName, properties);
    return;
  }
  if (consent === null) {
    pendingEvents.push({ eventName, properties });
  }
}

export async function submitFeedback(feedback) {
  ensureAnalyticsControls();
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
