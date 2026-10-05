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

An alert resolved by a business *decision* rather than a code fix sets its own `throttleMs` (the seasonal gap uses 3 days). The 6 h default would otherwise file an issue every six hours for as long as the window stays open — hundreds for one known condition.

### Why a campaign keyword comes back empty
`runCampaign` builds each keyword's pool in **tiers**, and tiers 3–4 relax `min_rating` and `min_discount` automatically once on-spec stock runs out. So **rating and discount can never silence a keyword** — if the search returned anything, the slot is filled. A slot borrows from another keyword only when the *search itself* is empty, and the filters that can do that are the ones sent **to the API**, which no tier relaxes: `category_id` and `min_price`/`max_price`. Diagnose an empty keyword there, and read the run note's `"<kw>": החיפוש לא החזיר מוצרים כלל` line. Telling the owner to lower rating/discount lowers his quality bar for every keyword and fixes nothing — it has happened once already.

### How the season reaches the rotation
Seasonal keywords are **not** weights inside `weightedRotation`. They get a fixed share: `interleaveSeasonal` weaves one in after every `SEASONAL_EVERY - 1` (= 4) positions of the campaign's own rotation. As a weight they were a fixed number of copies per cycle, so their share shrank as the keyword list grew and they clustered into two bursts per cycle. With the cursor stepping one position per run, a long list went 52 runs without a single seasonal slot (#99).

To see what the season actually did, don't read one run. The run note carries `📊 עונתי ב-3 ימים` from the seasonal ledger (`seasonal-ledger.ts`, `persistent_values` key `seasonal_ledger:<id>`): how many seasonal slots came up, how many were published, skipped by pacing, came back from an empty search, or were swapped by the relevance guard. The seasonal-gap alert carries the same line.

### Publishing pipeline
`PostsService.buildPostBody` is the single choke point every platform (Telegram, Facebook, Instagram, WhatsApp, Pinterest) builds its message from. Anything that must apply to *published text* belongs there, at the end — after the footer, coupon, store and trust lines have been appended, so nothing added later can slip past it.

Two paths bypass it and need covering separately: the **Pinterest AI rewrite** (its own draft) and the **pin frame's title band** (`pin-frame.ts`), which is burned into an image where no downstream text filter can reach it.

Two guards sit on generated copy, and they do different jobs:
- **`copy-guard.ts` (`copyDefect`)** — *rejects* a draft so it regenerates. Only for defect shapes that can never be real copy (prompt leaks, model deliberation, unfilled placeholders). A false positive silently downgrades good AI copy, so each pattern is deliberately narrow.
- **`word-policy.ts` (`applyWordPolicy`)** — *rewrites* the finished body to enforce the owner's vocabulary (currently: ציד/hunting → טקטי/tactical). The same rule is appended to every copy brief (`WORD_POLICY_BRIEF`) so the model phrases it naturally and the filter has nothing left to do.

When adding a Hebrew word rule, two things are not optional:
- **Match whole words.** JavaScript's `\b` is ASCII and is meaningless between Hebrew letters — the boundary is written as explicit Hebrew-letter lookarounds. `ציד` is a substring of צידו/צידה/מצידי/הצידה (inflections of `צד`, "side"); a naive replace publishes gibberish. The one-letter prefixes (ה ו ב ל מ ש כ) are consumed and handed back.
- **Step over URLs and HTML.** The affiliate link is inside the body by then, and a supplier URL can legitimately read `/1005006-hunting-knife.html`. Rewriting inside it breaks the link and loses the commission.

### The Telegram bot: owner, manager, members (`telegram-bot/`, `manager/`)
One bot and one webhook (`/telegram/webhook`). The controller sends a *bare* status request (`/status`, or "מה המצב?" in up to 3 words) to the watchdog, and everything else to `TelegramBotService`, which splits by who is writing:
- **Owner chat** (`WATCHDOG_TELEGRAM_CHAT_ID`):
  - A question goes to the manager agent: `managerQuestion` matches `?`, an interrogative or imperative opener, or `/ask`.
  - Anything else is the existing product search with publish buttons.
- **Manager agent** (`ManagerAgentService`):
  - A read-only tool loop over the owner's campaigns, posts, clicks, run notes, seasonal ledger and `manager_actions`.
  - Every `campaign_id` the model passes is resolved against the owner's own campaigns.
  - Its only write path is `propose_change`. This stores a proposal in `persistent_values` (`manager_proposal:<id>`, 24 h) and shows it with ✅/❌ buttons.
  - On approval the proposal is re-validated against the live campaign, applied, and logged to `manager_actions`, so it shows up in the morning report's undo list.
  - Proposals are single-use. Allowed fields are fixed in `manager-proposal.ts`, within the optimizer's bounds.
- **Anyone else** gets the members' product search (`shopper.ts`):
  - In a private chat any text is a search. In a group only `/find` or `/search` is, and only in the owner's own groups.
  - No model picks products. Results come from a strict search (never mock data) and are ranked by a fixed formula.
  - The channel's own posts are searched first (`channelPostHits`), because AliExpress lists some products (FLYLINK hidden products) under another name and only our Hebrew copy names them.
    - A post must cover `CHANNEL_MATCH_SHARE` (60 %) of the search's letters (`channelSearchTerms` stems: singular and plural meet on one stem, «ידית»/«ידיות» → «ידי», and final letters are normalised on both sides, «סכין»/«סכינים»), not every word. A FLYLINK post's title is a supplier code and its copy is written by the model from the photos, so the reader's «ידיות הסתערות» can be the post's «גריפ הסתערות». The long word carries the match; a short common one alone does not.
    - At most two posts are shown, from those sent in the last 180 days (custom posts included; a post with no stored link sends the reader to the first non-Telegram link in its text, `channelPostLink`), and the API fills the rest of the three. A channel hit links through the post's own short code, so its click counts on that post. A hidden product's result carries the post's instructions (`hiddenProductNotes`: the notice and «בחרו את הקוד XT-5»), or the reader lands on another item's page with no idea what to pick.
    - The posts table is what the system *sent*; a post can be deleted from the posts screen, edited in Telegram afterwards, or written there by hand. So the search also reads **`channel_messages`**, the channel as it actually is (`channel-capture.ts`). The owner's bot is registered for `channel_post` / `edited_channel_post` (`OWNER_BOT_REGISTERED_UPDATES`; the health check still requires only `OWNER_BOT_UPDATES`). Every post in one of the owner's saved channels is upserted by `(chat_id, message_id)`. Telegram gives bots no history, so an **old post gets in when the owner forwards it to the bot**, in either bot. A channel with "Restrict saving content" blocks forwarding: then the owner sends the post's **link** (`parsePostLink`, the message must start with it). The bot tries `forwardMessage` through *his* bot, the channel admin, and deletes the copy. When Telegram refuses that too, the owner pastes the post's text under the link and that is saved. Only his own channels are accepted, since a foreign post carries someone else's affiliate link. Such a result has no photo of its own: it is sent as text with the post's t.me link as a large preview above it, plus «📢 לפוסט המלא בערוץ». A channel that publishes through its *own* bot token delivers nothing here, because only the owner's bot has our webhook.
    - The owner testing the readers' search gets a `🔧 (רק אתה רואה)` line with how many posts matched which stems; when none was shown, `channelSearchFunnel` adds where the matching posts fell out (any user → his → sent → last 180 days, plus their statuses), each stem's count on its own, how many channel posts are saved, and the running build (`RENDER_GIT_COMMIT`).
  - Links are short links minted with `kind = 'shopper'`, so their clicks are counted in `link_targets.clicks`.
  - Searches are rate-limited per member and per day.
  - In a private chat, «עוד מוצרים» (a reply-keyboard button, or the words) shows the next three results of the reader's last search. The session is kept in memory for 30 minutes, since a reader can simply search again, and a new API page is fetched when the ranked list runs out.
  - Kill switch: set `SHOPPER_BOT_DISABLED=1`.
  - Every reader search is logged anonymously to `shopper_searches`: the normalised words and the result count, never who searched, and never the owner's own tests (his `/find`, and him writing to the readers' bot, recognised by his Telegram id). The owner reads it through `/searches` and the manager's `top_searches` tool. `/resetsearches <word>` clears the log except the first search containing that word; `/resetsearches הכל` clears all of it. Both commands work in either bot when the owner writes them. Zero-result searches are unmet demand.
- **A dedicated search bot** (`search-bot.ts`, optional): set `SEARCH_BOT_TOKEN` to a second BotFather bot and the readers move to it.
  - It has its own webhook (`/telegram/search-webhook`) and secret, and its replies go out through it via `AsyncLocalStorage` (`replyVia`).
  - The post invite line and the site's `/bot` link (via `GET /telegram/search-bot`) point to it.
  - A reader who still reaches the owner's bot is forwarded.
  - The watchdog checks its webhook too.

### Model input and output boundaries
- **Third-party text is fenced** (`common/untrusted.ts`). Product titles, categories and supplier notes are a seller's words. They go into a prompt only through `fenceUntrusted()`, which flattens newlines and control characters, caps the length, and wraps the text in `⟦…⟧`. Any brief that carries fenced text also appends `UNTRUSTED_DATA_RULE`. The marks must never be published: `stripFenceMarks` runs on every draft in `generateText`, the content agent, and again in `buildPostBody`.
- **ProductAgent picks; the server supplies the facts** (`agents/product-grounding.ts`). The model returns only product ids. An id that `search_products` never returned this run is dropped. Title, prices, image and the source keyword are read from the search result, never from the model's JSON.
- **Prompt caching** (`ai/anthropic-cache.ts`):
  - `AiService` marks only the *system* block. The user prompt carries per-product facts, so caching it would be a write that is never read.
  - The agent tool loops use a top-level `cache_control`, which moves forward with the conversation.
  - Metering counts `cache_read` + `cache_creation` tokens as input. Keep a system prompt stable across calls (no per-product values in it), or it never gets a cache hit.

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
