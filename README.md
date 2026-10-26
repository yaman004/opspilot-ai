# OpsPilot AI — Intelligent Operations & Incident Management

A multi-tenant incident management platform: report incidents, triage them (optionally with an LLM), assign and
resolve them through a server-enforced lifecycle, and watch SLA clocks, analytics and an audit trail update in real time.

Stack: **React + Vite + TypeScript + Tailwind** · **Node + Express + TypeScript** · **MongoDB (Mongoose)** ·
**Redis + BullMQ** · **Socket.IO** · Vitest, Supertest, React Testing Library, Playwright.

All demo data is fictional ("Northwind Ops").

---

## Quick start (local development)

Requirements: Node 20+, a MongoDB 6/7 server and Redis (the easiest way is Docker).

```bash
npm install
cp .env.example .env              # defaults work for local development
npm run services:up               # MongoDB + Redis via docker compose
npm run seed                      # fictional demo organization (45 incidents, 4 teams, 6 users)
npm run dev                       # API :4000, SLA worker, web :5173
```

Open <http://localhost:5173>. API docs (Swagger UI): <http://localhost:4000/api/docs> · OpenAPI JSON: `/api/docs.json`.

No Docker? Point `MONGODB_URI` and `REDIS_URL` in `.env` at any MongoDB and Redis you can reach (Atlas works).
`.env` is git-ignored; never commit it.

### Demo logins

Password for every account: `DemoPassw0rd!`

| Role   | Email                          |
| ------ | ------------------------------ |
| Owner  | `owner@demo.opspilot.test`     |
| Admin  | `admin@demo.opspilot.test`     |
| Agent  | `agent@demo.opspilot.test`     |
| Agent  | `mateo@demo.opspilot.test`, `yuki@demo.opspilot.test` |
| Viewer | `viewer@demo.opspilot.test`    |

`npm run seed` wipes and recreates the demo organization. It refuses to run with `NODE_ENV=production`.

### Run everything in Docker

```bash
docker compose up --build -d
docker compose run --rm api node dist/seed/seed.js
# → http://localhost:8080
```

Services: `web` (nginx serving the SPA and proxying `/api` and `/socket.io`), `api`, `worker`, `mongo`, `redis`, each with a
health check and persistent volumes (`mongo-data`, `redis-data`, `uploads`). This stack runs in development mode so the
seed and mock AI work; see [Production notes](#production-notes).

---

## Features

- **Auth** — register/login, short-lived access JWT (kept in memory) plus a rotating refresh token in an `HttpOnly` cookie with
  CSRF double-submit protection, refresh-token reuse detection, account lockout, password reset, "sign out everywhere".
- **Organizations & roles** — Owner / Admin / Agent / Viewer. Membership and role are re-checked from the database on every
  request; non-members get 404. Invitations (with a development accept link when no SMTP is configured).
- **Incidents** — numbered per organization, tags, assignee, team, priority, comments (public + internal notes), activity
  timeline, attachments, CSV export. Status transitions are validated on the server (resolving needs a summary; reopening is explicit).
- **AI triage** — suggests category, severity, priority, team, diagnostic questions and first steps. Output is validated against
  a schema; nothing changes until the user ticks what to apply. See [AI providers](#ai-providers).
- **SLA monitoring** — per-severity response/resolution targets, escalation rules, a BullMQ job that raises idempotent alerts
  (deterministic notification keys + atomic claim), priority bump on breach, live "SLA clock rail" in the UI.
- **Realtime** — Socket.IO (Redis adapter). Internal notes only reach staff sockets; removed/demoted members are disconnected.
- **Analytics** — KPIs, trend, severity/category distribution, team workload, resolution rates, CSV export.
- **Audit log** — append-only record of every change, filterable by actor and type.
- **Attachments** — local disk or any S3-compatible store; extension + MIME + magic-byte checks, 5 MB limit, server-generated
  keys, authorized downloads served as attachments with `nosniff`.

Pages: Landing, Login/Register (+ forgot/reset/accept-invite), Onboarding, Dashboard, Incident list, Incident detail,
Incident create/edit, Team, SLA policy, AI triage, Analytics, Notifications, Audit log, Settings, 404/403.

---

## Configuration

Every variable is documented in [`.env.example`](.env.example). The ones you will most likely touch:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI`, `REDIS_URL` | Data stores |
| `JWT_ACCESS_SECRET` | **Required**, ≥ 32 chars (`openssl rand -base64 48`). Placeholder values are rejected in production |
| `CLIENT_ORIGINS`, `APP_URL` | CORS / CSRF allow-list and link base |
| `COOKIE_SECURE`, `COOKIE_SAMESITE`, `COOKIE_DOMAIN` | Refresh-cookie behavior |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL` | AI triage |
| `SLA_TIME_SCALE`, `SLA_SCAN_INTERVAL_SECONDS` | SLA timing (keep `1` outside development) |
| `STORAGE_DRIVER`, `S3_*` | Attachment storage |
| `SMTP_URL` | Email delivery |
| `RATE_LIMIT_ENABLED` | Rate limiting (on by default) |

The server validates its environment at startup and exits with a readable message if something is wrong or inconsistent.

### AI providers

| `AI_PROVIDER` | Behavior |
| --- | --- |
| `mock` (default) | A built-in keyword heuristic. **Not an AI model.** Every result is stamped `isMock` and the UI labels it "Mock provider · not an AI model"; confidence is capped at 60%. |
| `anthropic` | Anthropic Messages API. Needs `AI_API_KEY`. |
| `openai` | OpenAI or any OpenAI-compatible endpoint. Needs `AI_API_KEY`, optional `AI_BASE_URL`. |

Provider replies are parsed as JSON and validated with zod; suggested teams are constrained to teams that exist. Timeouts,
rate limits and malformed replies produce typed errors (`AI_TIMEOUT`, `AI_RATE_LIMITED`, `AI_INVALID_RESPONSE`, …), are stored
with the analysis, and are shown to the user. Calls are rate-limited per user. The API key never reaches the browser.

### SLA development time scale

`SLA_TIME_SCALE=60` compresses deadlines 60× (a 15-minute target becomes 15 seconds) so you can watch alerts fire. The UI
shows a banner whenever the scale is not 1. Never use it in production.

---

## Architecture

```
shared/   TypeScript source package: zod schemas, role/permission matrix, status state machine, SLA + analytics math, DTOs
server/   Express API (controllers → services → Mongoose models), Socket.IO, BullMQ worker, seed, OpenAPI
client/   React SPA (TanStack Query for server state, Socket events only invalidate caches)
e2e/      Playwright tests against the real stack
```

Key decisions:

- **One source of truth** for permissions, transitions and SLA math lives in `shared/`, used by both server and client; the
  server is authoritative and the UI only hides what the server would reject.
- **Tenant isolation**: every query is filtered by `organizationId`; org-scoped routes go through `requireOrg`.
- **Idempotent SLA jobs**: the scan can run twice, concurrently or after a crash without duplicating notifications or audit rows.
- **Incident numbers** use a per-org counter with a unique `(organizationId, number)` index and a retry on collision.

---

## Testing

```bash
npm run lint          # ESLint (flat config)
npm run typecheck     # all workspaces
npm test              # shared + server + client unit/integration tests
npm run build         # shared check, server (tsup), client (Vite)
npm run test:e2e      # Playwright; needs MongoDB, Redis, a seeded DB
```

- **Server tests** (Vitest + Supertest) run against a real MongoDB-compatible server and real Redis (including live Socket.IO).
  Set `TEST_MONGODB_URI` to use another database. On a real MongoDB also set `TEST_DB_ATOMIC=true` and `TEST_MONGO_TTL=true`
  to enable the two tests that depend on atomic guarded updates and TTL indexes (CI does this).
- **Client tests** use React Testing Library (login form, incident-form validation, triage panel, SLA rail, permission gating).
- **E2E** (`e2e/incident-lifecycle.spec.ts`): signs in, creates an incident, runs triage, applies it, assigns, comments,
  changes status, resolves, then checks the activity history, audit log and dashboard. Also covers rejected logins,
  route protection and viewer restrictions. Start your own stack with `RATE_LIMIT_ENABLED=false`, or let Playwright start it.
  Set `E2E_CHROMIUM_PATH` to use a system Chromium.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests (against real MongoDB 7 and Redis 7), build, the Playwright
suite, and a Docker image build.

---

## Production notes

- Set `NODE_ENV=production`, a real `JWT_ACCESS_SECRET`, serve over HTTPS (`COOKIE_SECURE` defaults to true), set
  `CLIENT_ORIGINS`/`APP_URL` to your public URL, and `TRUST_PROXY` to the number of proxies in front of the API.
- Run the API and the worker as separate processes (`node dist/server.js`, `node dist/worker.js`); scale the API horizontally
  (Socket.IO uses the Redis adapter). Only one scheduler is needed for the worker, and scans are idempotent anyway.
- Configure `SMTP_URL`; without it, invitation and reset emails are **not delivered**.
- Choose a real AI provider if you want AI triage; the mock provider is a heuristic.
- Use `STORAGE_DRIVER=s3` (or a persistent volume) for attachments.

---

## Known limitations

- **Docker was not run here.** The Dockerfiles and compose file are validated only to the extent possible without a daemon
  (`docker compose config` passes; the production-deps install and the built server were exercised outside Docker).
  The first `docker compose up --build` is the real test; CI also builds the images.
- **Real AI providers (`anthropic`, `openai`) were not tested against live APIs** — only against a stubbed `fetch` in unit tests (request shape, key handling, error mapping).
  The mock provider is what was exercised end to end.
- **Email is not delivered** without `SMTP_URL`; the SMTP path has not been tested against a real server.
- **S3 storage** is implemented but has **no automated test and was never run against a bucket**; only the local driver is tested.
- Local tests ran on **FerretDB** (MongoDB-compatible, SQLite-backed) because `mongod` was unavailable; two atomicity-dependent
  tests are skipped there and are meant to run on real MongoDB (CI configures this, but it has not been run yet).
- ESLint reports 0 errors and some `no-explicit-any` warnings, mostly around Mongoose lean documents.
- Accessibility was designed in (labels, roles, focus handling, contrast tokens) but has had no audit with assistive technology.
- Not implemented: SSO/OAuth, MFA, on-call scheduling, email-to-incident, per-organization custom fields.
