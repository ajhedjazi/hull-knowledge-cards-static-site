import { useState } from "react";
import RevisionApp from "./RevisionApp";
import { ACCESS_CODES } from "./config/accessCodes";
import { PRODUCT } from "./config/product";
import "./App.css";

const ACCESS_STORAGE_KEY = "hull-knowledge-access-v1";
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function readAccessRecord() {
  if (typeof window === "undefined") return null;

  try {
    const stored = JSON.parse(window.localStorage.getItem(ACCESS_STORAGE_KEY) || "null");
    if (!stored?.activatedAt || !stored?.expiresAt) return null;
    return stored;
  } catch {
    return null;
  }
}

function getInitialAccessState() {
  const record = readAccessRecord();
  if (!record) return { status: "none", record: null };

  return {
    status: Date.now() < new Date(record.expiresAt).getTime() ? "active" : "expired",
    record,
  };
}

function saveAccessRecord(record) {
  try {
    window.localStorage.setItem(ACCESS_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Access still works for the current session if storage is unavailable.
  }
}

function normaliseCode(value) {
  return value.trim().toUpperCase();
}

export default function App() {
  const [initialAccess] = useState(getInitialAccessState);
  const [screen, setScreen] = useState(
    initialAccess.status === "expired" ? "expired" : initialAccess.status === "active" ? "app" : "landing",
  );
  const [accessRecord, setAccessRecord] = useState(initialAccess.record);
  const [accessCode, setAccessCode] = useState("");
  const [accessError, setAccessError] = useState("");
  const [checkoutMessage, setCheckoutMessage] = useState("");

  function openCheckout() {
    if (PRODUCT.checkoutUrl) {
      window.location.assign(PRODUCT.checkoutUrl);
      return;
    }

    setCheckoutMessage(
      import.meta.env.DEV
        ? "Development: add the Stripe Payment Link in src/config/product.js before testing checkout."
        : "Checkout is not available yet. Please try again shortly.",
    );
  }

  function showAccessScreen() {
    setAccessError("");
    setAccessCode("");
    setScreen("access");
  }

  function continueWithExistingAccess() {
    if (accessRecord && Date.now() < new Date(accessRecord.expiresAt).getTime()) {
      setScreen("app");
      return;
    }

    showAccessScreen();
  }

  function submitAccessCode(event) {
    event.preventDefault();
    const candidate = normaliseCode(accessCode);
    const valid = ACCESS_CODES.some((code) => normaliseCode(code) === candidate);

    if (!valid) {
      setAccessError("That access code was not recognised. Check it and try again.");
      return;
    }

    const activatedAt = new Date();
    const expiresAt = new Date(
      activatedAt.getTime() + PRODUCT.accessDays * DAY_IN_MS,
    );
    const record = {
      activatedAt: activatedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    saveAccessRecord(record);
    setAccessRecord(record);
    setAccessError("");
    setAccessCode("");
    setScreen("app");
  }

  if (screen === "app") {
    const isExpired =
      !accessRecord || Date.now() >= new Date(accessRecord.expiresAt).getTime();

    if (isExpired) {
      return <ExpiredScreen onCheckout={openCheckout} checkoutMessage={checkoutMessage} />;
    }

    return (
      <RevisionApp
        accessExpiresAt={accessRecord.expiresAt}
        onHome={() => setScreen("landing")}
      />
    );
  }

  if (screen === "access") {
    return (
      <AccessScreen
        code={accessCode}
        error={accessError}
        onBack={() => setScreen("landing")}
        onChange={(event) => {
          setAccessCode(event.target.value);
          if (accessError) setAccessError("");
        }}
        onSubmit={submitAccessCode}
      />
    );
  }

  if (screen === "expired") {
    return <ExpiredScreen onCheckout={openCheckout} checkoutMessage={checkoutMessage} />;
  }

  return (
    <LandingScreen
      hasAccess={
        accessRecord && Date.now() < new Date(accessRecord.expiresAt).getTime()
      }
      onCheckout={openCheckout}
      onExistingAccess={continueWithExistingAccess}
      checkoutMessage={checkoutMessage}
    />
  );
}

function LandingScreen({ hasAccess, onCheckout, onExistingAccess, checkoutMessage }) {
  return (
    <div className="commercial-shell">
      <main className="landing-card">
        <section className="landing-hero">
          <p className="eyebrow">Independent Hull taxi knowledge revision</p>
          <h1>{PRODUCT.name}</h1>
          <h2>Prepare for the Hull taxi knowledge test.</h2>
          <p className="landing-intro">
            Revise Hull locations with interactive flashcards, multiple-choice
            practice and 30-question mock tests.
          </p>

          <div className="feature-list" aria-label="Included revision features">
            <div><span aria-hidden="true">✓</span><strong>Interactive flashcards</strong></div>
            <div><span aria-hidden="true">✓</span><strong>Multiple-choice practice</strong></div>
            <div><span aria-hidden="true">✓</span><strong>30-question mock tests</strong></div>
          </div>
        </section>

        <section className="purchase-card" aria-label="Access price">
          <p className="purchase-label">Simple one-off access</p>
          <p className="price-line">
            <strong>{PRODUCT.accessDays} days&apos; access</strong>
            <span>{PRODUCT.priceDisplay}</span>
          </p>
          <button className="primary commercial-cta" onClick={onCheckout} type="button">
            Get {PRODUCT.accessDays}-Day Access
          </button>
          <button className="secondary-cta" onClick={onExistingAccess} type="button">
            {hasAccess ? "Continue revision" : "I already have access"}
          </button>
          {checkoutMessage && (
            <p className="checkout-message" role="status">{checkoutMessage}</p>
          )}
        </section>

        <p className="commercial-disclaimer">{PRODUCT.disclaimer}</p>
      </main>
    </div>
  );
}

function AccessScreen({ code, error, onBack, onChange, onSubmit }) {
  return (
    <div className="commercial-shell centred-shell">
      <main className="access-card">
        <button className="text-button back-link" onClick={onBack} type="button">
          ← Back
        </button>
        <p className="eyebrow">Existing customer</p>
        <h1>Enter your access code</h1>
        <p className="access-copy">
          Enter the code you were given after purchase to open your revision materials on this device.
        </p>

        <form className="access-form" onSubmit={onSubmit}>
          <label htmlFor="access-code">Access code</label>
          <input
            id="access-code"
            name="access-code"
            value={code}
            onChange={onChange}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck="false"
            inputMode="text"
            placeholder="Enter code"
            autoFocus
          />
          {error && <p className="access-error" role="alert">{error}</p>}
          <button className="primary commercial-cta" type="submit">Open revision app</button>
        </form>

        <p className="commercial-disclaimer compact-disclaimer">{PRODUCT.disclaimer}</p>
      </main>
    </div>
  );
}

function ExpiredScreen({ onCheckout, checkoutMessage }) {
  return (
    <div className="commercial-shell centred-shell">
      <main className="access-card expired-card">
        <p className="eyebrow">Hull Knowledge Cards</p>
        <h1>Your access period has ended.</h1>
        <p className="access-copy">
          Your {PRODUCT.accessDays}-day access window has finished.
        </p>
        <button className="primary commercial-cta" onClick={onCheckout} type="button">
          Get Access
        </button>
        {checkoutMessage && <p className="checkout-message" role="status">{checkoutMessage}</p>}
        <p className="commercial-disclaimer compact-disclaimer">{PRODUCT.disclaimer}</p>
      </main>
    </div>
  );
}
