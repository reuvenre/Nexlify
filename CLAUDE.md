# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

```
AliBot-PRO/              ← repo root (monorepo)
├── backend/             ← NestJS API (port 3001)
├── frontend/            ← Next.js 14 app (port 3000)
├── nginx/               ← reverse-proxy config (prod only)
├── .env                 ← single env file shared by both apps
└── docker-compose.yml
```

All `npm` commands below are run from their respective subdirectory (`backend/` or `frontend/`).

## Development Commands

### Backend (NestJS)
```bash
npm run start:dev       # hot-reload dev server
npm run build           # compile to dist/
npm run test            # Jest (once)
npm run test:watch      # Jest watch

# TypeORM migrations (requires DATABASE_URL in env)
npm run migration:generate -- src/migrations/<Name>   # diff entities → new migration file
npm run migration:run       # apply pending migrations
npm run migration:revert    # roll back last migration
npm run migration:show      # list applied / pending
```

### Frontend (Next.js)
```bash
npm run dev             # dev server on port 3000
npm run build           # production build
npm run lint            # ESLint
```

### Full stack via Docker
```bash
# Start only Postgres + Redis (recommended for local dev)
docker compose up postgres redis -d

# Full stack
docker compose up -d

# Prod profile (adds Nginx)
docker compose --profile prod up -d
```

## Environment

One `.env` lives at the repo root (not inside `backend/` or `frontend/`). Both the backend and the frontend Dockerfile read it. The backend `ConfigModule` looks for it at `../.env` (repo root) when running from `backend/`, falling back to a local `.env`.

Required variables: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BACKEND_URL`, `FRONTEND_URL`, `NEXT_PUBLIC_API_URL`, `ANTHROPIC_API_KEY`.

`REDIS_URL` is **optional and not set in production**. Without it `CacheModule` falls back to a per-process in-memory store — see *Caching vs. persistence* below before writing anything that depends on a cache TTL.

In **development**, TypeORM uses `synchronize: true` (auto-DDL). In **production** it runs migrations from `dist/migrations/` on startup. The standalone migration CLI (`data-source.ts`) always uses `synchronize: false`.

## Backend Architecture

### Module pattern
Every feature follows: `{name}.entity.ts` → `{name}.service.ts` → `{name}.controller.ts` → `{name}.module.ts` → exported `{Name}Service`. To use a service from another module, import that module and inject the service.

### Auth
- Guards: `@UseGuards(JwtAuthGuard)` — standard Passport JWT guard.
- `req.user` is the full `User` entity inside guarded routes (the JWT strategy returns it); use `req.user.id` for the authenticated user ID.
- Access tokens expire in 15 min; refresh tokens in 30 days and are persisted in DB + `refresh_token` cookie.

### Caching vs. persistence
`REDIS_URL` is not set in production, so `CacheModule` is a **per-process in-memory store**. A long TTL there means "until the next deploy", and there are several deploys on a working day. This has already caused real bugs: the watchdog re-raised findings whose issues had been fixed and closed, and the last known-good exchange rate — written with a 30-day TTL precisely to survive an upstream outage — was gone after every deploy.

The rule that follows:

- **`CacheModule` (via `common/safe-cache.ts`)** — only for saving a repeat of work that can simply be done again. A miss must cost nothing but a recomputation. `cacheGet`/`cacheSet` race a 1200 ms timeout and never hang or throw.
- **`PersistentValueModule` (`common/persistent-value.store.ts`)** — for anything that must outlive the process. Global, so `PersistentValueStore` can be injected anywhere with no wiring. `load(key)` / `save(key, value, ttlMs)` against the `persistent_values` table; expiry is enforced on read, so no cleanup job. Neither call ever throws — a failed read returns `null`, and every caller must already have a correct answer for "no value".
- Real domain data belongs in a real table. `persistent_values` expires silently, so only put re-derivable state in it.

When restoring a map from the store, **merge, never assign**: an empty answer must leave the live in-process memory alone. Assigning wipes it on every tick and is strictly worse than not persisting at all.

### Credentials & encryption
Per-user secrets (AliExpress, Telegram, OpenAI keys) are AES-256 encrypted in the DB. `CredentialsService.getRaw(userId)` returns the decrypted `DecryptedCredentials` object. The `ENCRYPTION_KEY` env var is the 32-byte hex key.

### Scheduler
Four `@Cron` jobs in `CampaignSchedulerService` run every minute: send scheduled posts, process auto-send queue, run active campaigns, clean up stuck posts. A campaign with `use_agents: true` routes through `OrchestratorAgent` instead of `PostsService.runCampaign`.

### Multi-agent system (`src/agents/`)
- `ProductAgent` — Claude tool-use to find & rank AliExpress products.
- `ContentAgent` — Claude tool-use to write optimised Telegram copy (learns from recent sent posts).
- `CampaignAgent` — Claude tool-use to evaluate health, auto-pause on high failure rates, refresh dead keywords.
- `OrchestratorAgent` — Runs the three agents in sequence; logs results to `agent_runs` table.
- Triggered manually via `POST /api/agents/run { campaign_id }` or automatically by the scheduler.

### RatesService
Fetches live USD exchange rates. Always use `RatesService.getRate(currencyPair)` — never hardcode rates.

Three layers, deliberately in different stores:
1. **Hot cache** (`CacheModule`, 1 h) — saves a repeated HTTP call. A miss costs one fetch, which is what a cache is for.
2. **Last known-good** (`PersistentValueStore`, 30 d) — what an upstream outage falls back to. In the database, because the cache cannot hold it across a deploy.
3. **Hardcoded floor** — only when there has never been a good rate. Its `updated_at` is the day the numbers were written, not the moment they are served.

Fetched rates are range-checked (`rates/rate-sanity.ts`) before being trusted. Every published price is multiplied by this number, so an error body inside a 200, a changed base currency or an inverted quote would reprice the whole catalogue while the posts still look normal. A set that fails falls back to the last known-good — **all three pairs together**, since those failures corrupt every pair at once.

### Watchdog (`src/watchdog/`)
Scans every 15 min for anomalies (stuck posts, failure spikes, silent campaigns, cadence drift, partial publishes, CTR regressions) and reports them as `[watchdog]`-prefixed GitHub issues + owner Telegram alerts. A daily digest goes out at 06:00 Israel time, including week-on-week clicks per campaign (`campaign-trend.ts`) — the only instrument that can read a deliberate change, since the regression check is an alarm that only fires on a 40 % fall and stays silent when something helps.

Three suppression memories decide whether the owner hears something twice, all held in `persistent_values` so a deploy cannot reset them:

| memory | key | window |
|---|---|---|
| per-anomaly-key throttle (`throttle-memory.ts`) | `watchdog:throttle` | 6 h |
| reported post ids (`partial-alerts.ts`) | `watchdog:partials_reported` | 24 h |
| reported CTR drops (`regression-memory.ts`) | `watchdog:regressions_reported` | 7 d |

A finding is remembered **when the alert actually goes out**, not when it is composed — one dropped by the throttle must stay reportable later.

### Publishing pipeline
`PostsService.buildPostBody` is the single choke point every platform (Telegram, Facebook, Instagram, WhatsApp, Pinterest) builds its message from. Anything that must apply to *published text* belongs there, at the end — after the footer, coupon, store and trust lines have been appended, so nothing added later can slip past it.

Two paths bypass it and need covering separately: the **Pinterest AI rewrite** (its own draft) and the **pin frame's title band** (`pin-frame.ts`), which is burned into an image where no downstream text filter can reach it.

Two guards sit on generated copy, and they do different jobs:
- **`copy-guard.ts` (`copyDefect`)** — *rejects* a draft so it regenerates. Only for defect shapes that can never be real copy (prompt leaks, model deliberation, unfilled placeholders). A false positive silently downgrades good AI copy, so each pattern is deliberately narrow.
- **`word-policy.ts` (`applyWordPolicy`)** — *rewrites* the finished body to enforce the owner's vocabulary (currently: ציד/hunting → טקטי/tactical). The same rule is appended to every copy brief (`WORD_POLICY_BRIEF`) so the model phrases it naturally and the filter has nothing left to do.

When adding a Hebrew word rule, two things are not optional:
- **Match whole words.** JavaScript's `\b` is ASCII and is meaningless between Hebrew letters — the boundary is written as explicit Hebrew-letter lookarounds. `ציד` is a substring of צידו/צידה/מצידי/הצידה (inflections of `צד`, "side"); a naive replace publishes gibberish. The one-letter prefixes (ה ו ב ל מ ש כ) are consumed and handed back.
- **Step over URLs and HTML.** The affiliate link is inside the body by then, and a supplier URL can legitimately read `/1005006-hunting-knife.html`. Rewriting inside it breaks the link and loses the commission.

## Frontend Architecture

### Auth flow
`middleware.ts` only redirects unauthenticated users (no API calls, to avoid ISR cache invalidation). Real session validation happens inside the dashboard layout via the `useAuth` hook.

### API client
`frontend/src/lib/api-client.ts` is the shared Axios instance. It attaches the JWT access token from `localStorage` and handles 401 → token refresh automatically. Always use this instance, never create raw `axios` calls.

### Route groups
- `(auth)/` — public pages (login, register, password reset, Google callback)
- `(dashboard)/` — all protected pages; the layout enforces authentication

### Path alias
`@/` resolves to `frontend/src/` — use it for all internal imports.
