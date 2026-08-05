# Hull Knowledge Cards — commercial MVP

This branch keeps the normal £19.99 / 90-day public commercial journey and also supports reusable, time-limited cohort access codes for classroom candidates.

## Architecture

- Vite/React frontend
- Minimal Node HTTP server using Node built-ins
- SQLite via `node:sqlite`
- Existing paid single-use access codes and account login
- Reusable cohort codes with fixed cohort expiry dates
- First-party consent-based analytics and lightweight candidate feedback
- One Render Web Service serves both `/api/*` and the built frontend
- SQLite database stored on a Render persistent disk

## Required environment

- `DATABASE_PATH` — SQLite path. Local default is `./data/hkc.sqlite`; on Render use `/var/data/hkc.sqlite`.
- `ACCESS_CODE_SEED` — comma-separated paid single-use access codes.
- `COHORT_ACCESS_SEED` — reusable cohort access records.
- `PORT` — supplied automatically by Render; local default is `3000`.
- `NODE_ENV=production` — enables the Secure flag on session cookies.

Node 22.5+ is required because the MVP uses the built-in `node:sqlite` module.

## Cohort access

Cohort records use this configuration format:

```text
CODE|cohort-key|source|ISO-expiry
```

Multiple monthly cohorts can be configured without application-code changes by separating records with semicolons, for example:

```text
RUTH-AUG26|aug-2026|ruth-hull|2026-09-30T23:59:59.000Z;RUTH-SEP26|sep-2026|ruth-hull|2026-10-31T23:59:59.000Z
```

Each cohort code is reusable by multiple candidates. Each candidate creates an individual account, but all accounts created from that cohort code inherit the same fixed cohort expiry date. The referral URL does not grant access by itself; possession of a valid cohort code does.

The startup seed is safe to rerun. Existing non-revoked cohort records are updated to the configured cohort/source/expiry values.

## Public access

Public, direct and search visitors see the normal £19.99 / 90-day commercial journey. Existing paid access-code behaviour remains single-use and unchanged.

## Render deployment

1. Deploy only the `commercial-mvp` branch.
2. Build command: `npm ci && npm run build`.
3. Start command: `npm start`.
4. Persistent disk mount: `/var/data`.
5. Set `DATABASE_PATH=/var/data/hkc.sqlite` and `NODE_ENV=production`.
6. Set `COHORT_ACCESS_SEED` privately in Render. Do not place real access codes in frontend source or any `VITE_*` variable.
7. Deploy/restart. `npm start` runs the startup seed before starting the server.

## Product disclaimer

Hull Knowledge Cards is an independent revision resource. It is not affiliated with or endorsed by Hull City Council. Questions are provided for revision purposes and are not official council examination questions.
