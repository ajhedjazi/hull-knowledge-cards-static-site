import { useEffect, useState } from "react";
import RevisionApp from "./RevisionApp";
import { PRODUCT } from "./config/product";
import "./App.css";

const FREE_VALIDATION_MODE = true;

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  let body = {};
  try {
    body = await response.json();
  } catch {
    // Keep a generic error if the server did not return JSON.
  }

  return { response, body };
}

function formatAccessDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export default function App() {
  const [screen, setScreen] = useState("loading");
  const [user, setUser] = useState(null);
  const [checkoutMessage, setCheckoutMessage] = useState("");

  useEffect(() => {
    if (FREE_VALIDATION_MODE) {
      setScreen("app");
      return undefined;
    }

    let cancelled = false;

    apiRequest("/api/auth/session", { method: "GET", headers: {} })
      .then(({ response, body }) => {
        if (cancelled) return;
        if (response.ok && body?.user) {
          setUser(body.user);
          setScreen("app");
          return;
        }
        if (response.status === 403 && body?.authenticated) {
          setUser(body.accessExpiresAt ? { accessExpiresAt: body.accessExpiresAt } : null);
          setScreen("expired");
          return;
        }
        setUser(null);
        setScreen("landing");
      })
      .catch(() => {
        if (!cancelled) setScreen("landing");
      });

    return () => {
      cancelled = true;
    };
  }, []);

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

  async function logout() {
    try {
      await apiRequest("/api/auth/logout", { method: "POST", body: "{}" });
    } finally {
      setUser(null);
      setScreen("landing");
    }
  }

  if (FREE_VALIDATION_MODE) {
    return <RevisionApp />;
  }

  if (screen === "loading") {
    return (
      <div className="commercial-shell centred-shell">
        <main className="access-card">
          <p className="eyebrow">Hull Knowledge Cards</p>
          <h1>Checking access…</h1>
        </main>
      </div>
    );
  }

  if (screen === "app" && user) {
    return (
      <>
        <div
          aria-label="Account controls"
          style={{
            position: "fixed",
            right: "12px",
            bottom: "12px",
            zIndex: 30,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            maxWidth: "calc(100vw - 24px)",
            padding: "9px 11px",
            color: "#173f3c",
            background: "rgba(255,253,248,.96)",
            border: "1px solid #cbdad5",
            borderRadius: "12px",
            boxShadow: "0 8px 24px #1432301c",
            fontSize: ".76rem",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user.email} · until {formatAccessDate(user.accessExpiresAt)}
          </span>
          <button className="text-button" onClick={logout} type="button">Sign out</button>
        </div>
        <RevisionApp
          accessExpiresAt={user.accessExpiresAt}
          onHome={() => setScreen("landing")}
        />
      </>
    );
  }

  if (screen === "access-choice") {
    return (
      <AccessChoiceScreen
        onBack={() => setScreen("landing")}
        onRedeem={() => setScreen("redeem")}
        onSignIn={() => setScreen("login")}
      />
    );
  }

  if (screen === "redeem") {
    return (
      <RedeemScreen
        onBack={() => setScreen("access-choice")}
        onSignedIn={(nextUser) => {
          setUser(nextUser);
          setScreen("app");
        }}
        onSignIn={() => setScreen("login")}
      />
    );
  }

  if (screen === "login") {
    return (
      <LoginScreen
        onBack={() => setScreen("access-choice")}
        onSignedIn={(nextUser) => {
          setUser(nextUser);
          setScreen("app");
        }}
        onExpired={(accessExpiresAt) => {
          setUser({ accessExpiresAt });
          setScreen("expired");
        }}
      />
    );
  }

  if (screen === "expired") {
    return <ExpiredScreen onCheckout={openCheckout} checkoutMessage={checkoutMessage} />;
  }

  return (
    <LandingScreen
      hasAccess={Boolean(user?.email)}
      onCheckout={openCheckout}
      onExistingAccess={() => {
        if (user?.email) setScreen("app");
        else setScreen("access-choice");
      }}
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

function AccessChoiceScreen({ onBack, onRedeem, onSignIn }) {
  return (
    <div className="commercial-shell centred-shell">
      <main className="access-card">
        <button className="text-button back-link" onClick={onBack} type="button">← Back</button>
        <p className="eyebrow">Existing customer</p>
        <h1>Access your revision</h1>
        <p className="access-copy">Activate a new purchase once, or sign in to an account you have already created.</p>
        <div className="access-form">
          <button className="primary commercial-cta" onClick={onRedeem} type="button">Redeem access code</button>
          <button className="secondary-cta" onClick={onSignIn} type="button">Sign in</button>
        </div>
        <p className="commercial-disclaimer compact-disclaimer">{PRODUCT.disclaimer}</p>
      </main>
    </div>
  );
}

function RedeemScreen({ onBack, onSignedIn, onSignIn }) {
  const [step, setStep] = useState("code");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function validateCode(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { response, body } = await apiRequest("/api/access-codes/validate", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      if (response.ok) {
        setStep("account");
        return;
      }
      setError(body.message || "That access code could not be validated.");
    } catch {
      setError("We could not check that code. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function createAccount(event) {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const { response, body } = await apiRequest("/api/auth/redeem", {
        method: "POST",
        body: JSON.stringify({ code, email, password }),
      });
      if (response.ok && body.user) {
        onSignedIn(body.user);
        return;
      }
      setError(body.message || "We could not activate your access. Please try again.");
    } catch {
      setError("We could not activate your access. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="commercial-shell centred-shell">
      <main className="access-card">
        <button className="text-button back-link" onClick={onBack} type="button">← Back</button>
        <p className="eyebrow">Activate access</p>
        <h1>{step === "code" ? "Enter your access code" : "Create your account"}</h1>
        <p className="access-copy">
          {step === "code"
            ? "Enter the code you were given after purchase. Each code can be activated once."
            : `Your ${PRODUCT.accessDays}-day access period starts when this account is created.`}
        </p>

        {step === "code" ? (
          <form className="access-form" onSubmit={validateCode}>
            <label htmlFor="access-code">Access code</label>
            <input
              id="access-code"
              value={code}
              onChange={(event) => { setCode(event.target.value); setError(""); }}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck="false"
              placeholder="Enter code"
              required
              autoFocus
            />
            {error && <p className="access-error" role="alert">{error}</p>}
            <button className="primary commercial-cta" disabled={busy} type="submit">
              {busy ? "Checking…" : "Continue"}
            </button>
            <button className="text-button" onClick={onSignIn} type="button">Already activated? Sign in</button>
          </form>
        ) : (
          <form className="access-form" onSubmit={createAccount}>
            <label htmlFor="redeem-email">Email</label>
            <input id="redeem-email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} autoComplete="email" required autoFocus />
            <label htmlFor="redeem-password">Password</label>
            <input id="redeem-password" type="password" value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} autoComplete="new-password" minLength="8" required />
            <label htmlFor="redeem-confirm">Confirm password</label>
            <input id="redeem-confirm" type="password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError(""); }} autoComplete="new-password" minLength="8" required />
            {error && <p className="access-error" role="alert">{error}</p>}
            <button className="primary commercial-cta" disabled={busy} type="submit">
              {busy ? "Creating account…" : "Create account & start access"}
            </button>
          </form>
        )}

        <p className="commercial-disclaimer compact-disclaimer">{PRODUCT.disclaimer}</p>
      </main>
    </div>
  );
}

function LoginScreen({ onBack, onSignedIn, onExpired }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { response, body } = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (response.ok && body.user) {
        onSignedIn(body.user);
        return;
      }
      if (response.status === 403 && body.code === "ACCESS_EXPIRED") {
        onExpired(body.accessExpiresAt);
        return;
      }
      setError(body.message || "Email or password is incorrect.");
    } catch {
      setError("We could not sign you in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="commercial-shell centred-shell">
      <main className="access-card">
        <button className="text-button back-link" onClick={onBack} type="button">← Back</button>
        <p className="eyebrow">Customer account</p>
        <h1>Sign in</h1>
        <p className="access-copy">Use the email and password you set when you activated your access code.</p>
        <form className="access-form" onSubmit={submit}>
          <label htmlFor="login-email">Email</label>
          <input id="login-email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} autoComplete="email" required autoFocus />
          <label htmlFor="login-password">Password</label>
          <input id="login-password" type="password" value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} autoComplete="current-password" required />
          {error && <p className="access-error" role="alert">{error}</p>}
          <button className="primary commercial-cta" disabled={busy} type="submit">{busy ? "Signing in…" : "Sign in"}</button>
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
        <p className="access-copy">Your {PRODUCT.accessDays}-day access window has finished.</p>
        <button className="primary commercial-cta" onClick={onCheckout} type="button">Get Access</button>
        {checkoutMessage && <p className="checkout-message" role="status">{checkoutMessage}</p>}
        <p className="commercial-disclaimer compact-disclaimer">{PRODUCT.disclaimer}</p>
      </main>
    </div>
  );
}
