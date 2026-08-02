# Hull Knowledge Cards — commercial MVP

This branch is the five-customer validation build. It keeps the existing Stripe Payment Link and revision product, but replaces reusable client-side access codes with server-backed accounts and single-use code redemption.

## Architecture

- Vite/React frontend (existing product UI and revision logic)
- Minimal Node HTTP server using only Node built-ins
- SQLite via `node:sqlite`
- Passwords hashed with Node `crypto.scrypt` and unique random salts
- Random authenticated sessions stored server-side; browser receives only an HTTP-only session cookie
- One Render Web Service serves both `/api/*` and the built frontend
- SQLite database stored on a Render persistent disk

The server imports `PRODUCT.accessDays` from `src/config/product.js`, so the 90-day duration has one central product configuration value. Stripe remains the existing Payment Link; there is no Stripe API/webhook integration in this MVP.

## Required environment

Copy `.env.example` for local reference. The server reads environment variables directly; no dotenv package is required.

- `DATABASE_PATH` — SQLite path. Local default is `./data/hkc.sqlite`; on Render use `/var/data/hkc.sqlite`.
- `ACCESS_CODE_SEED` — comma-separated codes used only when running the seed command. Do **not** put this in a `VITE_*` variable or commit real codes.
- `PORT` — supplied automatically by Render; local default is `3000`.
- `NODE_ENV=production` — enables the Secure flag on session cookies.

Node 22.5+ is required because this MVP uses the built-in `node:sqlite` module.

## Local setup

```bash
npm ci
npm run build
ACCESS_CODE_SEED="CODE-ONE,CODE-TWO" npm run codes -- seed
npm start
```

Open `http://localhost:3000`. The database schema is initialised automatically on server start or whenever the access-code CLI opens the database.

## Access-code operations

Real access codes are intentionally **not** stored in frontend JavaScript or committed source. For the current launch, configure `ACCESS_CODE_SEED` privately with the existing ten validation codes and run the seed command once against the production database.

Seed codes (safe to re-run; existing rows are unchanged):

```bash
ACCESS_CODE_SEED="code1,code2,..." npm run codes -- seed
```

Add a new code:

```bash
npm run codes -- add HKC-EXAMPLE-1234
```

Inspect all codes and redemption state:

```bash
npm run codes -- status
```

Inspect one code:

```bash
npm run codes -- status HKC-EXAMPLE-1234
```

Revoke an **unused** code:

```bash
npm run codes -- revoke HKC-EXAMPLE-1234
```

The revoke command refuses to revoke an already redeemed code. These commands should be run from a Render Shell so they operate on the persistent production database at `DATABASE_PATH`.

## Render deployment

This branch includes `render.yaml` for one Node Web Service with a 1 GB persistent disk.

1. Deploy **only** the `commercial-mvp` branch. Do not merge it into `main` for this validation.
2. Create/use the service from `render.yaml`, or configure equivalent settings manually.
3. Build command: `npm ci && npm run build`.
4. Start command: `npm start`.
5. Persistent disk mount: `/var/data`.
6. Set `DATABASE_PATH=/var/data/hkc.sqlite` and `NODE_ENV=production`.
7. Deploy once. The server creates the database/tables automatically.
8. Open a Render Shell for the service, set `ACCESS_CODE_SEED` privately to the ten existing validation codes, and run `npm run codes -- seed` once.
9. Run `npm run codes -- status` and confirm ten unused codes are present before sending any to customers.

Do not place real access codes in `render.yaml`, `.env.example`, frontend source, or any `VITE_*` environment variable.

## Authentication behaviour

- A customer chooses **I already have access → Redeem access code**.
- The backend validates that the code exists, is unused and is not revoked.
- The customer sets email + password (8+ characters).
- User creation and code redemption happen in one SQLite `BEGIN IMMEDIATE` transaction.
- `access_expires_at` is set by the server to redemption time + 90 days.
- The customer receives an HTTP-only `SameSite=Lax` session cookie; production cookies are also `Secure`.
- Future sign-in uses email/password; invalid sign-in always returns `Email or password is incorrect.`
- Expired accounts are blocked server-side regardless of cookies, localStorage or the device clock.
- Flashcard progress remains local-only and unchanged.

## Security scope and known MVP limitations

Implemented: salted scrypt password hashing, unique normalised emails, parameterised SQLite statements, atomic one-time redemption, server-side sessions, HTTP-only/SameSite cookies, production Secure cookies, server-authoritative expiry, generic user-facing errors, basic in-memory rate limiting, and protected session checks.

Deliberately not implemented for the five-customer validation: password reset, email verification, OAuth/social login, Stripe webhooks, subscriptions, admin UI, device fingerprinting, concurrent-session controls, analytics, or sophisticated distributed rate limiting. If a customer forgets a password during validation, recovery is a manual operator issue; no reset flow exists yet.

## Pre-payment manual checks

Before accepting the first live payment, manually verify on the deployed Render service:

1. The Stripe button still opens the existing live Payment Link.
2. An unused code redeems once and creates an account.
3. The same code is rejected on a second activation attempt.
4. The new account can sign out and sign back in.
5. A wrong password receives the generic login error.
6. `npm run codes -- status CODE` shows the code as redeemed and linked to the expected account.
7. The database password value starts with `scrypt$` and is not plaintext.
8. An expired test account is blocked and sees `Your access period has ended.`
9. Flashcards, practice, the 30-question mock and results still behave as before.
10. Browser dev tools / built frontend assets contain no real access codes.

## Product disclaimer

Hull Knowledge Cards is an independent revision resource. It is not affiliated with or endorsed by Hull City Council. Questions are provided for revision purposes and are not official council examination questions.
