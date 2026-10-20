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

One more way a keyword is dry for a run, and it is deliberate: every product its search found went out in the last `RECYCLE_MIN_GAP_DAYS` (7). The run note says so (`"<kw>": כל N המוצרים שהחיפוש מצא פורסמו ב-7 הימים האחרונים`), and the slot borrows from another keyword.

### Never the same product twice (`posts/product-similarity.ts`, `posts/pool-tiers.ts`)
The owner saw the same product go out again and again. Three causes, all closed:
- **One item, many ids.** AliExpress lists a product once per store, and the de-dup was keyed by `product_id`, so another store's listing of yesterday's product went straight through: same photo, same title, different link. `recentlyPublished(userId, since)` loads everything the account published in the 14-day cooldown (any campaign, any group, plus anything still waiting to go out; failed posts excluded) as a `PublishedProducts` set, which matches by id, by the photo's CDN file name (`imageKey`, size suffix dropped), or by title words (Jaccard ≥ `SAME_TITLE_SHARE` = 0.8 over ≥ 4 meaningful words). A match counts as posted, with that post's date. The same set guards picks within one run.
- **Recycling inside the cooldown.** The tiers recycled the *oldest* post inside the 14 days, which for a keyword with a dozen on-spec results was three days ago. Now `choosePool` recycles only products last posted ≥ 7 days ago, prefers a new lower-rated product to a recent repeat, and otherwise reports the keyword dry. Before settling for any repeat, a keyword searches `EXTRA_SLICES_BEFORE_REPEAT` (2) more (sort, page) slices: the rotation moves only after a full page of posts, and the affiliate API often returns far fewer.
- **The agents path had no de-dup at all.** Same search and same score every run gave the same top products. The orchestrator now hides recently published products from the ProductAgent's search results (`alreadyPublished`), drops any pick that repeats one, and `createAgentPost` records the post's keyword and writes `campaign_posted_products`.

### Searching the FLYLINK catalogs by hand (`suppliers/catalog-search.ts`)
"עיין בקטלוג" in the FLYLINK products tab has a search box. `GET /suppliers/catalogs/search?q=&catalog_id=&page=` runs `YupooService.searchStore`, which is Yupoo's own store search (`/search/album?uid=1&q=`, 120 per page, ranked by Yupoo, so an exact code comes first).
- It searches one catalog, or every enabled catalog with a store when `catalog_id` is omitted («בכל הקטלוגים»).
- Each catalog is searched on its own. A locked or blocked store returns its `error` next to the other catalogs' results.
- A result whose album is already linked carries `linked_product_id` (matched by album id in `yupoo_url`) and shows «כבר במוצרים שלך».
- Album titles are the supplier's codes, English and Chinese, so a Hebrew search finds nothing there. The screen says so and points to "המוצרים שלי", whose filter also matches the Hebrew `store_name` / `store_brand` / `store_category` the enrichment agent wrote.
- Search pages and listing pages share `parseAlbumCards`. `hasMore` reads the pager's next link (`后一页`).

### Videos in the Yupoo albums (`suppliers/yupoo-video.ts`, `supplier_products.videos_json`)
Albums mix photos and videos, and only the photos were read. A video is an `<img data-type="video">` whose src is just the cover (on `uvd.yupoo.com`, which the photo filter never matched). The clip is named by `data-path` and `data-videoformats` (`v1080p,v720p,v480p`, or `transcoding`/`fail`/empty). The playable file is `https://uvd.yupoo.com/<720p>/<path>`, the same URL Yupoo's own player builds.
- **No proxy.** Unlike the photos, uvd is not hotlink-protected (verified with a foreign Referer), so the browser and Telegram load it directly.
- **Storage.** `videos_json` = `[{url, thumb}]`. NULL means never read; `'[]'` means read and empty.
  - Filled on link and by the 6-hourly sync.
  - Products linked before this get theirs the first time their composer opens (`ensureVideos`, alongside the AI call, 20 s cap).
- **Publishing (`posts/album-videos.ts`): a video goes out only when the owner picks it.**
  - Nothing is attached by default, campaigns included. The first version put the album's first video on every post, and the owner asked for a picker that works like the photos.
  - The composer shows the videos in the same numbered gallery as the photos (`▶ סרטון`). The selection (`images`) carries both, in his order.
  - `pickMedia` → `splitSelection` counts a URL as a video only when it is one of the product's own `videos_json`.
  - Videos are kept **out of `gallery_json`**, which Facebook, Instagram, Pinterest, the store, the Reels and the de-dup all read as photos. They go to `posts.album_videos` (`[{url, at}]`, where `at` is the place in his selection).
  - `sendAlbumWithVideos` weaves them back in for Telegram (`mergeAlbum`, ≤ 10). Videos go by URL and photos as URLs or uploaded buffers (collage or enhance). A single video is sent with `sendVideo`. A rejection falls back to the photos-only album.
  - Videos only → `send_as_video`: Telegram sends just the videos, and WhatsApp sends the first one (`product_video`). The cover is still stored for the photo platforms.
  - The first picked video is `product_video`, so the Reels open with it.
  - A recycled post repeats the original's picks.

### A group's core focus (`posts/group-focus.ts`, `channels.core_focus`)
The relevance guard (`product-relevance.ts`) accepts anything plausible and rejects only a clear misfit, so טקטי בקליק still received an ordinary flashlight or general camping gear. A group can now carry a **core focus** in the owner's words (groups screen → edit → «🎯 מיקוד ליבה»). When any target group has one, the question turns strict (`GROUP_FOCUS_SYSTEM`): only a product clearly inside the focus passes, unsure is no, and a parsed reply must say `fits: true` explicitly.
- **Every automatic route** asks it:
  - The AliExpress campaign uses its existing guard in strict mode. Replacements are judged three per call over at most `FOCUS_MAX_DONORS` (4) keywords. A run builds pools only for its own slot keywords, so when those are the campaign's other keywords every donor was outside the focus too, and the run posted nothing («… ולא נמצא תחליף — הפוסט דולג» on both slots). Now a slot still unfilled searches the campaign keywords the focus names (`focusDonorKeywords`, rotation order from the run cursor), at most `FOCUS_EXTRA_SEARCHES` (2) extra searches per run.
  - FLYLINK, the agents (asked for twice the products, then cut back to the plan's count), sales recovery (up to 3 picks) and Amazon go through `PostsService.groupFocusCheck`.
  - A campaign with no targets is checked against the account's default chat.
  - A Pinterest-only campaign is never checked (`focusApplies`), because it never reaches the group. Checking it against the default group's focus once rejected every US Halloween pin (#101).
  - Manual sends are not checked.
- **A focus speaks for its own group only** (`openTargets`). When a campaign feeds several groups and only some have a focus, a product the focus turns down still goes to the others; only the focused group loses it (run note: «… לא נשלח לקבוצה הממוקדת … רק לשאר הקבוצות»). It is dropped, and replaced where it can be, only when every target is focused. The manager's `set_group_focus` refuses a campaign that feeds more than one group, so one group's focus can never be written onto a sister group.
- **The mix** (`channels.core_focus_share`, the «כמה מהפוסטים חייבים להיות מתוך המיקוד» slider): a 100 % focus turned down everything outside it, and the campaign's other keywords stopped mattering. The owner wants 60–70 % tactical and the rest from those keywords. Below 100, a product the focus turns down may still go out while the group's recent posts leave room (`mixAllowsOff`: the last `MIX_WINDOW` = 20 posts of 14 days, counted with the new one). It must still pass the lenient guard, because "outside the focus" is allowed and "wrong audience" never is.
  - The mix lives in `persistent_values` (`group_focus_mix:<user>:<chat>`).
  - It is recorded **once the post exists** (`recordFocusMix`), so a slot skipped by pacing does not tilt it.
  - The run note says «… מחוץ למיקוד, עבר במכסת 35% של מילות המפתח האחרות».
  - Null share = 100. The migration set 65 on the groups that already had a focus.
- **FLYLINK** is judged by the enrichment's `store_name` / `store_brand` / `store_category` and the description (`flylinkFitItem`). An item with only a supplier code is not asked about and goes through.
- **Rejections are remembered** per focus text in `persistent_values` (`group_focus_rejected:<user>:<hash>`, 14 d). This stops a FLYLINK rotation or a repeating search from asking about the same item every run. Rewriting the focus starts fresh.
- **Fail-open stays:** no AI key, a judge error or an unreadable reply accepts everything. A judge outage must never silence a group.
- **Run note:** each rejection appears as «מיקוד הקבוצה (<name>): "<title>" נפסל (<reason>)».

### Never two posts in one chat at once (`posts/chat-collision.ts`)
A group is fed by two clocks that fire in the same second: `sendScheduledPosts` releases campaign posts by `scheduled_at`, and `processQueue` drips the manual queue by the group's `schedule_last_sent_at`. Neither sees the other's send until it has finished. On an ordinary slot the few seconds a send takes kept them apart by accident. When the group's clock is old, as at the 09:00 window opening after a quiet night, both were due at once and the group got two posts together. A fan-out post or a default channel that is also a saved group met a group post the same way.
- Both paths now claim through `claimPacedSend`. Under a per-account `pg_advisory_xact_lock`, it refuses the claim when another post reached one of the same Telegram chats within `chatGapMinutes` (half the group's interval, at most 15 min).
- A held campaign post moves to the blocker's time + interval.
- A held queue post stays queued for the next free slot.
- Manual "send now" is not paced and does not go through it.

### How the season reaches the rotation
Seasonal keywords are **not** weights inside `weightedRotation`. They get a fixed share: `interleaveSeasonal` weaves one in after every `SEASONAL_EVERY - 1` (= 4) positions of the campaign's own rotation. As a weight they were a fixed number of copies per cycle, so their share shrank as the keyword list grew and they clustered into two bursts per cycle. With the cursor stepping one position per run, a long list went 52 runs without a single seasonal slot (#99).

To see what the season actually did, don't read one run. The run note carries `📊 עונתי ב-3 ימים` from the seasonal ledger (`seasonal-ledger.ts`, `persistent_values` key `seasonal_ledger:<id>`): how many seasonal slots came up, how many were published, skipped by pacing, came back from an empty search, or were swapped by the relevance guard. The seasonal-gap alert carries the same line.

### The big sale days (`common/sale-calendar.ts`, `coupons/sale-readiness.ts`)
11.11, Black Friday and Cyber Monday are the year's money. Each has a **warm-up** and a **live** phase, every boundary a Pacific midnight (the portal's clock: 11.11 opens at 10:00 Israel time). Black Friday is computed per year (the day after the fourth Thursday of November). Its live phase runs to Cyber Monday, which is live for one day.
- **Copy by phase** (`saleCopyHint`, through `seasonalCopyHints`' sale line):
  - Before a sale: "save it to the cart, catch it on the day".
  - On the day: "it is on now, until tomorrow 10:00".
  - Every hint ends with: never invent a discount or promise a price drop.
  - It needs the account's seasonal switch on, like every seasonal line.
- **Cadence while live** (`salePeakNow`; off with `SALE_PEAK_BOOST_DISABLED=1` or the account's seasonal switch):
  - `salePostsPerRun` doubles the run (cap 6). It takes the max with the seasonal boost and never writes `posts_per_run`.
  - `saleIntervalMinutes` halves the group interval (floor `MIN_SALE_INTERVAL_MIN` = 20) in `nextGroupSlotRaw`, the snap check and `claimPacedSend`, so the extra posts fit the day.
  - The manual queue's drip is unchanged.
- **Readiness checklist** (`SaleReadinessService`, 09:40 Israel daily; off with `SALE_READINESS_DISABLED=1`):
  - Goes out 7 and 2 days before 11.11 and Black Friday (Cyber Monday rides Black Friday's). It is sent once each, keyed `sale_ready:<user>:<sale>:<year>:<days>` in `persistent_values`.
  - It checks coupons whose window overlaps the sale, campaigns whose last run note names a refused key or empty credit (`aiFailureNote`), posts in the last 24 h, and the seasonal switch.
  - `/sale` in the owner's bot sends it now, for the next sale.

### The commission scout (`products/commission-scout.ts`, `products/commission-scout.service.ts`)
The owner asked for products paying 12 % or more. The rate is not on the AliExpress site at all (only the affiliate API and portal carry it), so scraping the site could not find it, and the affiliate terms forbid scraping. The API cannot list every product, so the scan reads, always at the API's maximum page of 50, within a budget of `maxScanCalls` (300 ≈ 5–6 min, `COMMISSION_SCOUT_MAX_CALLS`):
1. AliExpress's own promotion lists for affiliates (`featuredpromo.get` → `featuredpromo.products.get`, sorted `commissionDesc`, retried unsorted when refused), at most `MAX_SCAN_PROMOS` (20), up to `PROMO_PAGES` (5) each;
2. the hot-products feed overall (`HOT_PAGES` 5). The owner knew of 70–90 % products the first version never reached: the boosted rates sit in this feed (`hot_product_commission_rate`);
3. every active campaign's keywords (`scanKeywords`, at most 20), in both `product.query` and `hotproduct.query`, `KEYWORD_PAGES` (2) each;
4. the hot feed per top-level category (`HOT_CATEGORY_PAGES` 3), starting from a different category each day, so a budget that runs out covers other categories the next day (`budget_hit` on the screen).
- **Price cap ₪350** (`maxPriceIls`, `COMMISSION_SCOUT_MAX_PRICE_ILS`, 0 lifts it). The owner found products at absurd prices: the `SALE_PRICE_DESC` slice of the rotation surfaced generators and tractors. `scoutPriceCapUsd` turns the cap into USD at the live `USD_ILS` rate. It is sent as `max_sale_price` (USD cents, like the campaign search) to `product.query` and `hotproduct.query` (promotion lists take no price parameter). It is also enforced on every result (`withinPrice`), on the earlier finds a scan carries over, and when the screen reads a stored list (`capped`), so a list saved before the cap shows nothing over it. Catalogs carry `max_price_ils`, and the hero states it.
- Paging stops at a short page or one with nothing at the bar (`worthNextPage`). `commission_rate` is in the fields; the rate used is the higher of it and `hot_product_commission_rate`, and a product found twice keeps the best rate quoted.
- Calls are spaced 1.1 s apart (`ApiCallLimit`); five failures in a row (`MAX_FAILS_IN_A_ROW`) stop the scan, since that is the quota or the keys. A refused call is reported, never filled with mock data.

**Ranking (`selectPicks`)**: a high rate alone is not the recommendation. Score = what a sale pays (USD price × rate) × log of recent sales × rating², × `NICHE_BOOST` (1.3) for products found through his own keywords. Floors: `MIN_ORDERS` 10, rating ≥ 4.3 (unrated allowed at a discount), at most `MAX_PER_CATEGORY` 3 per category. Left out: anything he posted in 30 days (failed posts aside) or was recommended in 30 days (`persistent_values` `commission_scout_seen:<user>`, merged, never assigned).

**What his own results change (`products/scout-learning.ts`).** The owner said the picks repeated, were often irrelevant, and were too few. Each cause, closed:
- **Same slice every scan.** Keywords and categories used to read sort `LAST_VOLUME_DESC` from page 1, and the API returns a small fixed slice per query. Each one now reads its own `(sort, page)` (`rotationSlice`: best sellers or `SALE_PRICE_DESC`, page windows 1/3/5), staggered by index and cycling every `ROTATION_CYCLE_DAYS` (6) steps.
  - **The step moves per scan, not per day** (`commission_scout_cursor:<user>`, and `commission_scout_niche_cursor:<user>:<id>` per niche). The first version stepped per day, so ten «סרוק עכשיו» in one day returned the same products; the owner noticed.
  - The promotion lists rotate too: a different set of `MAX_SCAN_PROMOS` each scan, from page 1 or page 6. The overall hot feed alternates sorts and pages 1–5 / 6–10.
  - A rotated slice past the end of a short result set falls back to page 1. Only `SCOUT_SORTS` values are ever sent.
- **The list grows** (`carryOver`, `stampSeen`). A scan used to replace the screen's list. Now every product an earlier scan found in the last `CATALOG_KEEP_MS` (7 d) and this one did not stays. Each item carries `first_seen_at` / `last_seen_at`, and `is_new` marks this scan's first finds («חדש» on the card, «רק חדשים» filter, `new_count` in the hero). A product found again takes this scan's price and rate.
- **Another store's listing of a posted product.** "Already posted" and "already recommended" now go through `PublishedProducts` (id, photo, title), and the seen memory stores each pick's title and photo (old id-only entries still read). No two picks are the same item, and the screen shows one card per photo.
- **Declared rate vs paid rate.** His orders (90 days, cancelled aside, commission + incentive bonus) give a product's own paid rate after 2 orders. Otherwise his category's paid ÷ declared ratio applies after 3 orders, kept across scans in `commission_scout_paid:<user>` (90 d, merged per category). The bar and `earn_per_sale_usd` use this `effective_rate`. Cards and the report say «בפועל כ-X%». The funnel counts products that declare the bar but pay under it (`pays_less`).
- **What sold.** `keywordBoost`: a keyword whose posts brought attributed orders lifts its products (×1.1 per order, up to ×1.5). Clicks without orders (≥ 10 posts, ≥ 20 clicks) lowers them to ×0.8, and posts with no clicks to ×0.85.
- **Relevance** (the owner found tractors on his screen). `relevanceProfile` reads, from the scan's own keyword results (≥ `MIN_NICHE_HITS` 2 hits), his top-level categories and sub-categories (`second_level_category_name` → `subcategory`), plus the distinctive words recurring in his clicked posts. `isRelevant` decides:
  - his keyword's result: always relevant;
  - outside his categories: never, whatever its words;
  - his category but another sub-category: only with ≥ 2 of his distinctive words. «Lights» holds both his flashlights and tractor work lights, and `GENERIC_WORDS` (led, waterproof, rechargeable, …) never count;
  - no categories to go by: the words decide; no signal at all: everything is relevant.
  - Off-niche products score ×`OFF_NICHE_FACTOR` (0.6). They **never enter the Telegram report**; the first version filled up to three, and the owner asked for none. **The screen hides them** unless «הצג גם מחוץ לנישה · N» is on, and every shelf, chip and total counts only what is shown. «רק ממילות המפתח שלי» is origin `niche` only.
  - **The category step reads only his categories** (by top-level name, in both the hot feed and the regular search) once his keywords show any. Reading all ~30 categories spent most of the budget on products the screen then hid. With no keyword results, it reads every category, rotating.
- **Too few.** The report fills in two tiers: relevant at the strict floors, then relevant at `RELAXED_MIN_ORDERS` 3 / `RELAXED_MIN_RATING` 4.0. The header carries the funnel line (`funnelLine`: at the bar, pays less, already posted or recommended, off-niche (not taken), floors), so a short report says why.

**Delivery**: every morning to the owner's chat (`dailyCommissionScout`, once a day via `commission_scout:<date>`), and on demand with `/commission`.
- **It retries** (`products/scout-delivery.ts`). The cron (`'0 */20 8-11 * * *'`, Asia/Jerusalem) tries every 20 minutes from 08:20 to 11:40 (`attemptDue`) until one report goes out. A single 08:20 attempt used to be lost to any deploy, restart, a `/commission` scan still running, or an error in the minutes a scan takes, with nothing to say so.
- **Each failed attempt is recorded** (`commission_scout_fail:<date>`: time, reason, attempts). A scan that could not read AliExpress at all (refused key) is reported once and counts as delivered, since retrying cannot fix it.
- **Watchdog check 13**: from 12:00, a day with no report (`commissionScoutHealth` → `missedReportVerdict`) raises `commission_scout_missed:<date>` once (24 h throttle). It carries the last reason, or says the server never ran an attempt. Only a refused key carries an owner action. Each pick is the usual product card plus «💵 עמלה X% · כ-$Y לכל מכירה» and where it was found, with the usual «📤 פרסם לקבוצה». The picks are kept in `commission_scout_picks:<user>` (3 d), so the button works after a deploy wipes the in-memory cache. The header says the rate is what the API declares; the paid rate can be lower (category caps, new vs returning buyer). The Telegram report is platform owner only. Env: `COMMISSION_SCOUT_MIN` (12), `COMMISSION_SCOUT_PICKS` (10, max 20), `COMMISSION_SCOUT_DISABLED=1`.

**The screen (`/commissions`, «עמלות גבוהות» in the sidebar, `CommissionScoutController`)**: every account can open it. A scan is about a minute of API calls, too long for a page load, so every scan keeps its whole ranked list (`rankCatalog`, up to `CATALOG_MAX` 2000, no per-category cap and no sales or rating floor, since the 50–90 % products are often new listings; posted products marked «פורסם» rather than hidden) in `commission_scout_catalog:<user>` (7 d). The page reads it (`GET /commission-scout`), and «סרוק עכשיו» starts one in the background (`POST /commission-scout/scan`, refused while one runs or within `SCAN_COOLDOWN_MS` 10 min). The page polls every 5 s while it runs. A scan that reads nothing keeps the previous list and stores why (`commission_scout_error:<user>`, shown on the page). Layout: a hero with the totals (count, top rate, how many at 50 %+, most per sale), filters (search, minimum rate 12/20/30/50/70/90, sort, niche only, hide posted, category chips), a «עמלות ענק» shelf of the 50 %+ products, the agent's top picks, then a shelf per category (24 cards each); any filter switches to one grid, 60 at a time with «טען עוד». «צור פוסט» hands the product to the quick-post review through `sessionStorage` `quick_post_catalog_product`, the same way the products screen does.
**Search by niche (`products/scout-niches.ts`)**: the owner can also search one niche he picks from a list (the «חיפוש לפי נישה» card). `GET /commission-scout/niches` gives three groups:
- his own campaign keywords (`kw:<keyword>`); their results keep origin `niche`, so quick post routes them to that campaign's group;
- the ready niches in `PRESET_NICHES` (`preset:<key>`, Hebrew label, English trade keywords);
- AliExpress's top-level categories (`cat:<id>`, Hebrew names from `CATEGORY_HE`).
An id not on the list is refused, so a search can never be steered to free text. `POST /commission-scout/niche/scan` reads deeper than the daily scan: 3 hot + 2 regular pages per keyword, 8 hot + 4 regular pages per category (`search` and `hot` both take a `category_id`), within `NICHE_MAX_CALLS` (60). It runs in the background with a 5 min cooldown, through the same reader as the daily scan (`makeReader`). The result is kept per niche (`commission_scout_niche:<user>:<id>`, 24 h, `GET /commission-scout/niche?id=`) and replaces the daily list on the screen until «חזרה לכל המוצרים».
- **What the scan found** (`SourceStat`, `ScoutCatalog.sources` / `.funnel`). Every scan, the daily one and each niche, counts per kind of source (`promo`, `hot` overall, his `keywords`, `categories`) the calls, products read, products at the bar, and failures with the first one's text. The daily scan also stores the report's `PickFunnel`. The screen shows both in the closed-by-default «מה הסריקה מצאה» panel (`ScanBreakdown`), and the Telegram header carries the same as one line (`sourcesLine`) above the funnel line. This is what tells "only 3 picks" apart: a refused promo list, keywords the API reads nothing for, a budget spent before the categories, or products cut by the dedup and the niche.
- Screenshot it via CDP `Page.captureScreenshot`: Playwright's own viewport screenshot comes out black on the RTL horizontal shelves in headless Chromium.
- **The round trip to quick post** (`lib/commissions-return.ts`): «צור פוסט» saves the view (filters, the niche and whether it is shown, «טען עוד» count, scroll, and the card as `<shelf>:<product_id>`) in sessionStorage `commissions_view` (1 h), and opens `/quick-post?from_catalog=1&back=commissions`. Quick post's «חזרה לרשימת העמלות», the redirect after a send, and the phone's back button all land on the list as he left it, with the card lit for a moment. A product posted on the way is marked «פורסם» at once (`commissions_posted`), before the next scan knows. `back=` is read only through `BACK_TARGETS`, never as a URL.
- **Every shelf row and card is `relative`.** The cards' sr-only text is absolutely positioned. Without a positioned scroller it escaped the row's clipping, and in RTL each shelf leaked its whole scroll width into the page (4,162 px on a 390 px phone): the phone zoomed the screen out to a quarter.

### A hand-picked product finds its own group (`posts/product-routing.ts`, `POST /posts/route`)
The owner asked that every product he picks by hand be placed in its group by the system, asking only when it cannot tell, and written in the template that group's automatic posts use. The answer is a campaign, since that is how automatic posts reach a group. `PostsService.routeProduct` tries, strongest first:
1. the keyword that found it, when exactly one campaign holds it, or several that feed the same groups (`campaignByKeyword`). The high-commission screen passes the scout's `found_by` as `route_keyword`;
2. a campaign that already posted it (`campaign_posted_products`);
3. the smart-intake judge (`SMART_INTAKE_SYSTEM`, one call), now also shown each group's core focus.
Anything less is `confident: false` plus the account's active Telegram groups (`ChannelsService.activeTelegramGroups`), each with the campaign feeding it. It never guesses.
- **The template is the automatic one** (`campaignTemplate`, runCampaign's rule): `campaign.post_template`, else the account default, '' for a Pinterest-only campaign. AliExpress automatic posts never read the group's own body template, so a hand post used to come out differently. A chosen group no campaign feeds keeps the group template, else the account default (`method: 'group'`). `quickPost`/`schedulePost` resolve through the same rule (`autoTemplateForGroup`) when no text is sent.
- **Quick post** (`RouteBanner`): routes on selecting a product, applies the groups, the template («כמו בפוסט האוטומטי») and the campaign language, and shows what it recognised and why, with «קבוצה אחרת». When unsure it shows the group buttons first. Changing the groups by hand re-resolves the template of the first one. `handleGenerate` waits for a pending route and reads the template from a ref.
- **Telegram «📤 פרסם לקבוצה»** publishes straight to the recognised groups (`publishTo`), saying why. It shows the group list only when unsure.
- The FLYLINK composer is unchanged: it already writes in the group's template, which is what FLYLINK's automatic posts use.

### Publishing pipeline
`PostsService.buildPostBody` is the single choke point every platform (Telegram, Facebook, Instagram, WhatsApp, Pinterest) builds its message from. Anything that must apply to *published text* belongs there, at the end — after the footer, coupon, store and trust lines have been appended, so nothing added later can slip past it.

Two paths bypass it and need covering separately: the **Pinterest AI rewrite** (its own draft) and the **pin frame's title band** (`pin-frame.ts`), which is burned into an image where no downstream text filter can reach it.

When every draft fails, the post is not created and the run note says why per provider (`ai/ai-failure.ts`: «anthropic: המפתח נדחה», «נגמר הקרדיט בחשבון», «המודל סירב…»), not only that the providers returned nothing. A refused *account* Anthropic key retries once on the platform's `ANTHROPIC_API_KEY` when that is a different key, as `AgentClient` does; an empty credit balance does not, since that would bill the account's usage to the platform.

### Product Reels (`videos/`, `video-renderer/`, `.github/workflows/render-video.yml`)
A sent post becomes a 12 s vertical video (1080×1920, four scenes: headline, reason, price, call to action) published to **Instagram and Facebook Reels** of the group the post went to — the same IG/Page routing as a normal post (`PostsService.publishReel`).
- **Rendering is not on Render.** It needs headless Chrome + FFmpeg, which the free instance (0.1 CPU, 512 MB, every cron in the same process) cannot carry. The backend writes the spec (`reel-spec.ts`) to `video_jobs` and fires `repository_dispatch` `render-video` at `GITHUB_RENDER_REPO` (default `GITHUB_WATCHDOG_REPO`) with `GITHUB_RENDER_TOKEN` (default `GITHUB_WATCHDOG_TOKEN`; needs Contents: Read and write). The workflow runs `video-renderer/render.mjs` (HyperFrames, Apache-2.0; pinned 0.8.140): it reads `/videos/jobs/<id>/spec?t=`, downloads the photos, renders, and POSTs the MP4 to `/videos/jobs/<id>/result?t=` (or `/failed`). About a minute per Reel.
- **The MP4 lives in `video_jobs.video` (bytea) only until Meta has pulled it** from `/videos/<id>.mp4?t=<media_token>` (range requests supported); cleared 3 days later. Two capability tokens per job: the renderer's (spec, result) and Meta's (the file). The routes are public and `@SkipThrottle`.
- **Burned-in text bypasses `buildPostBody`**, like the pin frame: `reel-spec.ts` takes the words only from our own published copy and the post's own numbers, and applies `stripFenceMarks` and `applyWordPolicy` itself. Hebrew: `dir="rtl"` on the root div and text blocks, never on `<html>` (a silent blank render); numbers inside Hebrew go in `<bdi dir="ltr">`. No audio (licensing; Reels autoplay muted).
- **What opens the Reel** (the first 6.4 s): the **seller's own product video** when the post has one (`product_video`), in a card — real footage first. Without one, and with `REELS_AI_VIDEO=1` and a Gemini key on the account, an **AI clip** (`ai-clip.ts`): Gemini Omni Flash (`REELS_AI_MODEL`, default `gemini-omni-1.1-flash`, paid tier, ≈ $0.10 per second of 720p) turns the product photo into hands unboxing it, full-frame, capped at `REELS_AI_PER_DAY` (2). The backend generates it (status `generating`), keeps it in `video_jobs.clip` for the renderer (`/videos/jobs/<id>/clip.mp4?t=`), then dispatches. An AI opening is labelled on screen («🤖 הדגמה שנוצרה ב-AI») and in both captions (`AI_CAPTION_NOTE`). The renderer trims and re-encodes the clip and reports what the Reel actually opened with (`?clip=seller|ai|none` → `clip_source`); any clip failure falls back to photos — never no Reel, and never an AI label on a Reel that has no AI in it.
- **When:** `/reel` in the owner's bot makes one now, of the most-clicked post of the last 48 h that has none. With `REELS_ENABLED=1` the same pick runs daily at 12:42 Israel time, `REELS_PER_DAY` (default 1, max 5). The owner hears the outcome on Telegram. A render that has not come back in 40 minutes is failed and reported.

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
  - **Bulk changes** (the owner asked for keywords and focus "in one go"):
    - `set_keywords` replaces the whole rotation in one proposal, at most `MAX_KEYWORDS` (30). Words that leave go to `retired_keywords`. It is logged as `keywords`, so the usual undo restores both lists.
    - `set_group_focus` writes the core focus of the campaign's saved target groups (`campaign_details` → `target_groups` shows the current one). It is logged as `group_focus` with each group's previous focus, and undo puts those back.
    - An answer with two or more proposals also gets «✅ אשר את כל ה-N» / «❌ דחה הכל» (callbacks `pb`/`pz`, `persistent_values` `manager_bundle:<12 hex>`, 24 h). Each proposal is still approved on its own, in order, with the usual live re-check: one that no longer applies is reported and the rest go through.
  - **The weekly review** (`weeklyReview`, `WEEKLY_REVIEW_QUESTION`): every Sunday morning the manager runs unasked, in a conversation of its own, and brings at most three proposals. It looks for three things:
    - keywords with clicks but no orders (`keyword_clicks` now carries attributed orders and ₪ commission);
    - reader demand no campaign answers (`top_searches` carries `english_search`, the rewrite that found results, as a ready keyword);
    - a campaign whose clicks fell week on week.
    - The cron (`weeklyManagerReview`, Asia/Jerusalem, every 20 min 09:00–13:40) retries until one gets through. Delivery is remembered in `persistent_values` (`manager_weekly:<date>`), so a deploy neither loses it nor sends it twice. A refused key is reported once, not retried.
    - `/weekly` runs it now. Off with `MANAGER_WEEKLY_DISABLED=1`.
  - **New copy angles** (`posts/copy-variants.ts`):
    - Each campaign post is written in a copy angle picked by a bandit on clicks per post. Built-in: תועלת, מחיר, and ביטחון for FLYLINK.
    - The bandit cannot invent an angle, so the manager proposes one. Its `copy_angles` tool shows each angle's posts, clicks and clicks per post, plus the openings of the most-clicked and zero-click posts (fenced).
    - `add_copy_angle` (one Hebrew instruction, no links, at most `MAX_CUSTOM_ANGLES` = 3 per campaign) and `remove_copy_angle` (custom ids only) go through the usual approval.
    - An approved angle is stored in `campaigns.copy_angles` (jsonb, `c-<id>`) and joins that campaign's pool (`customVariants`). Being under-sampled, it is tried first, then kept or starved by its own clicks.
    - Logged as `copy_angles` in `manager_actions`; undo restores the previous list. Reports label a custom id «סגנון מותאם».
    - The weekly review checks angles too.
- **Anyone else** gets the members' product search (`shopper.ts`):
  - In a private chat any text is a search. In a group only `/find` or `/search` is, and only in the owner's own groups.
  - No model picks products. Results come from a strict search (never mock data) and are ranked by a fixed formula.
  - The channel's own posts are searched first (`channelPostHits`), because AliExpress lists some products (FLYLINK hidden products) under another name and only our Hebrew copy names them.
    - A post must cover `CHANNEL_MATCH_SHARE` (60 %) of the search's letters (`channelSearchTerms` stems: singular and plural meet on one stem, «ידית»/«ידיות» → «ידי», and final letters are normalised on both sides, «סכין»/«סכינים»), not every word. A FLYLINK post's title is a supplier code and its copy is written by the model from the photos, so the reader's «ידיות הסתערות» can be the post's «גריפ הסתערות». The long word carries the match; a short common one alone does not.
    - At most two posts are shown, from those sent in the last 180 days (custom posts included; a post with no stored link sends the reader to the first non-Telegram link in its text, `channelPostLink`), and the API fills the rest of the three. A channel hit links through the post's own short code, so its click counts on that post. A hidden product's result carries the post's instructions (`hiddenProductNotes`: the notice and «בחרו את הקוד XT-5»), or the reader lands on another item's page with no idea what to pick.
    - The posts table is what the system *sent*; a post can be deleted from the posts screen, edited in Telegram afterwards, or written there by hand. So the search also reads **`channel_messages`**, the channel as it actually is (`channel-capture.ts`). The owner's bot is registered for `channel_post` / `edited_channel_post` (`OWNER_BOT_REGISTERED_UPDATES`; the health check still requires only `OWNER_BOT_UPDATES`). Every post in one of the owner's saved channels is upserted by `(chat_id, message_id)`. Telegram gives bots no history, so an **old post gets in when the owner forwards it to the bot**, in either bot. A channel with "Restrict saving content" blocks forwarding: then the owner sends the post's **link** (`parsePostLink`, the message must start with it). The bot tries `forwardMessage` through *his* bot, the channel admin, and deletes the copy. When Telegram refuses that too, the owner pastes the post's text under the link and that is saved. Only his own channels are accepted, since a foreign post carries someone else's affiliate link. Such a result has no photo of its own: it is sent as text with the post's t.me link as a large preview above it, plus «📢 לפוסט המלא בערוץ». A channel that publishes through its *own* bot token delivers nothing here, because only the owner's bot has our webhook.
    - The owner testing the readers' search gets a `🔧 (רק אתה רואה)` line with how many posts matched which stems; when none was shown, `channelSearchFunnel` adds where the matching posts fell out (any user → his → sent → last 180 days, plus their statuses), each stem's count on its own, how many channel posts are saved, and the running build (`RENDER_GIT_COMMIT`).
  - **What counts as an answer** (`titleMatchesSearch`): for a Hebrew search, a title must cover `CHANNEL_MATCH_SHARE` of the search's letters, the bar a channel post meets, not one shared word. «מתפס לטלפון» is not an answer to «מתפס פיקטיני».
    - The results are laid out in this order: channel posts holding every word, then AliExpress results that match, then channel posts that matched only on their long word (a flashlight "for picatinny").
    - Non-matching AliExpress results are shown only when nothing else was found at all. Two right answers beat three with a wrong one.
    - The owner's 🔧 line always names what the rewrite step did, including why it did nothing.
  - **When the reader's words find nothing** (`query-rewrite.ts`): AliExpress cannot read Hebrew slang («ידיות הסתערות», «מד חום לבשר»). When none of its results match the search (`looksUnrelated`), a small model (`claude-haiku-4-5`, via `AgentClient`, platform key on a refused one) rewrites the search into 1–3 English trade-name queries.
    - The model only rewrites the SEARCH: it never sees or picks a product. `parseRewrites` keeps plain words only and drops a query carrying a link or markup.
    - The server searches again, and the rewrite's results go first.
    - Rewrites are remembered in `persistent_values` (`shopper_rewrite:<words>`, 30 d; an empty answer 1 d), so a repeated search costs no model call.
    - «עוד מוצרים» pages on with the rewrite but shows the reader's own words.
    - Each such search is logged with `shopper_searches.rewrite`, and `/searches` lists them under 🪄.
    - Kill switch: `SHOPPER_REWRITE_DISABLED=1`.
  - Links are short links minted with `kind = 'shopper'`, so their clicks are counted in `link_targets.clicks`.
  - Searches are rate-limited per member and per day.
  - In a private chat, «עוד מוצרים» (a reply-keyboard button, or the words) shows the next three results of the reader's last search. The session is kept in memory for 30 minutes, since a reader can simply search again, and a new API page is fetched when the ranked list runs out.
  - Kill switch: set `SHOPPER_BOT_DISABLED=1`.
  - **Price-drop alerts** (`price-alerts.ts`, table `price_alerts`): in a private chat every AliExpress result carries «🔔 תודיע לי כשהמחיר יורד».
    - A tap stores the price the reader saw (one row per chat + product, at most `MAX_ALERTS_PER_READER` = 20 active). 🔕 on the same message, `/stop` or «בטל התראות» switch them off.
    - `checkPriceAlerts` (09:25/13:25/17:25/21:25 Asia/Jerusalem) re-prices them through `refreshPricesBatch`, 20 per call. A drop must be both ≥ 5 % and ≥ ₪2 (`isPriceDrop`) — an alert on noise teaches the reader to ignore the next one.
    - The alert is a private photo card with the buy link (short link, `kind = 'alert'`) and the 🔔 again; it fires once and the row goes inactive.
    - A product missing from the answer counts a miss (4 in a row drop it), but **an API failure or an empty answer counts nothing**: that is the keys or the quota, not every product delisted at once. Alerts also end after 60 days, and every alert of a reader who blocked the bot goes.
    - Unlike `shopper_searches` this is not anonymous — it must message the reader back — so it keeps the private chat id and nothing else about them.
    - The search bot registers `callback_query` for the button (`setupSearchBot`). `/searches` ends with the 🔔 line: watched, sent, clicks.
    - Kill switch: `PRICE_ALERTS_DISABLED=1`.
  - **Parcel tracking** (`parcel-tracking.ts`, `seventeen-track.ts`, table `parcel_tracks`): in a private chat a tracking number (`parseTrackingNumber`: `/track X`, «מעקב X», or a bare token of 10–30 characters with ≥ 8 digits and ≥ 2 letters, so a product search is never taken for one) gets the parcel's free 17TRACK page at once — no key, no quota.
    - With `SEVENTEEN_TRACK_API_KEY` set, the card carries «🔔 עדכנו אותי». The tap **registers** the number with 17TRACK (API v2.4), which is what costs quota: new accounts get 200 numbers once, and nothing refills. So a lookup never registers; a reader may follow `MAX_PARCELS_PER_READER` (5); and registrations are capped per day (`PARCEL_DAILY_REGISTRATIONS`, default 15).
    - `checkParcels` (every 2 h, 08:10–22:10 Asia/Jerusalem) reads every followed number (`gettrackinfo`, 40 per call, no quota) and messages the reader on a new **stage** (`isNewStage`: status or sub-status changed — not every scan), in Hebrew (`statusText`). Delivered, returned, destroyed or cancelled ends it; so do `PARCEL_TTL_DAYS` (75), 🔕, and a reader who blocked the bot. Inactive rows are deleted after 30 days: the number is the reader's data.
    - `/parcels` lists a reader's parcels. `/searches` ends with the 📦 line, including the quota left (`getquota`). Off with `PARCEL_TRACKING_DISABLED=1`.
  - Every reader search is logged anonymously to `shopper_searches`: the normalised words and the result count, never who searched, and never the owner's own tests (his `/find`, and him writing to the readers' bot, recognised by his Telegram id). The owner reads it through `/searches` and the manager's `top_searches` tool. `/resetsearches <word>` clears the log except the first search containing that word; `/resetsearches הכל` clears all of it. Both commands work in either bot when the owner writes them. Bare `/resetsearches` in the owner's bot offers buttons (`rs:<id>` keep that search's first time, `rs:all`), since tapping a command in a message sends it without its argument. Zero-result searches are unmet demand.
- **A dedicated search bot** (`search-bot.ts`, optional): set `SEARCH_BOT_TOKEN` to a second BotFather bot and the readers move to it.
  - It has its own webhook (`/telegram/search-webhook`) and secret, and its replies go out through it via `AsyncLocalStorage` (`replyVia`).
  - The post invite line and the site's `/bot` link (via `GET /telegram/search-bot`) point to it.
  - **Where readers come in from** (`bot-start.ts`, table `bot_starts`, anonymous like the search log): every link to the bot carries a start code, and a /start is counted by it, once per reader per source per day, never the owner's.
    - The invite line under a post rotates evenly (`inviteAngleFor(post.id)`, stable on re-send) between the wordings in `SHOPPER_INVITE_ANGLES`, each with its own code (`inv_alert` price drop, `inv_find`, `inv_words`). A tight caption gets a shorter form of the same angle, then the bare bot name.
    - The site's `/bot?src=pin` (or `news`) passes its code on; a bare `/bot` is `site`, the old bot's forward is `moved`, posts from before this are `post`. An unknown code is counted as `other`, never stored raw.
    - `/searches` ends with the 🚪 line: entries per source over the window. That is how a wording is kept or dropped — compare them after two weeks.
  - A reader who still reaches the owner's bot is forwarded.
  - The watchdog checks its webhook too.

### Every account's own bot (`telegram-bot/tenant-bot.ts`, Settings → «הבוט שלי»)
The bot and the manager above were built for one owner (the first admin, env chat id). Any other account can now run the same thing in a bot of its own, sold by plan: `search_bot` (Growth) and `manager_agent` (Autopilot) in `FEATURE_MIN_PLAN`. The platform owner's bots are unchanged.
- **Connect.** The account pastes a BotFather token in Settings (`POST /telegram/my-bot`). `connectTenantBot` checks the shape (`looksLikeBotToken`), refuses the platform's own tokens and one already used by another account, calls `getMe`, and sets the webhook to `/telegram/tenant/<user_id>` with a secret derived per account (`tenantWebhookSecret`). Only then is the token saved to `credential_sets.search_bot_token_enc`. `onModuleInit` re-points any account webhook that drifted.
- **Routing.** `TelegramWebhookController.tenantWebhook` checks the per-account secret, then `handleTenantUpdate` runs the update inside `replyVia` with `{ token, userId, managerChat }`. In that store `ownerUserId()` returns the account and `isOwner()` matches only its linked chat, so every existing reader path (search, channel posts, price alerts, `/searches`, logs) works for the account unchanged and replies from its bot.
- **The owner's chat.** Settings makes a one-time deep link (`/start link_<12 hex>`, `persistent_values` `tenant_bot_link:<code>`, 30 min, single use). The chat that opens it becomes `credential_sets.manager_chat_id`. In that chat a manager question, `/weekly` and the ✅/❌ of proposals go to the manager when the plan allows it, and `MANAGER_LOCKED` when it does not. Everything else is the readers' search, so the owner sees what readers see.
- **Plan lapse.** Readers get `TENANT_BOT_PAUSED` instead of results.
- **Kept platform-only:**
  - Following a parcel (17TRACK registration spends the platform's one-off quota; `parcelFollowAvailable`). An account's bot gives the free tracking page.
  - The cross-account `channelSearchFunnel` and the 17TRACK quota line.
- **Per account:**
  - `price_alerts` / `parcel_tracks` unique keys now include `user_id`, and every reader query is scoped by it (a reader talks to each bot separately).
  - `ShopperLimiter` has a daily budget per account (`take(member, scope)`).
  - The weekly review runs per account with key `manager_weekly:<user>:<date>`.
  - The price-alert and parcel crons send from the bot each row came through (`readerBotFor`).
- **Invite line.** A non-admin account's posts invite readers to its own bot (`shopperBotUsername`) when it is connected, delivering, and in the plan.

### Where a pin lands (`storefront/`, `app/s/[slug]/p/[id]/`)
Since `c2bb97c` a pin links to the store's product page (`postProductUrl`), not the affiliate redirect. That page is a client component, so its server HTML used to carry the root layout's metadata: the Hebrew Nexlify SaaS title, no product image, no price. The pin's destination looked like a marketing tool to Pinterest. Now:
- `p/[id]/layout.tsx` renders the product's own `<title>`, Open Graph (`og:type` product, `product:price:*` as property= tags) and a schema.org `Product`. It reads `GET /store/:slug/products/:id` server-side, and a Yupoo image goes through `/suppliers/image`.
- **One product reads `pending` posts too.** Pinterest fetches the link the moment the pin is created, which is before the post is `sent`. The shelf still shows `sent` only.
- **Currency.** `price_ils` holds the price in the campaign's currency, so `currency` comes from the campaign's `currency_pair`, else the account's. A US pin no longer reads "₪ 6.4".
- **Attribution.** The pin link carries `?src=pin`, and the page turns it into `/r/<code>?s=pin`, so the store click is recorded as Pinterest's (`ClickSourcesPanel`). Orders are still matched to posts by product id only; there is no per-platform tracking id.

### Model input and output boundaries
- **Third-party text is fenced** (`common/untrusted.ts`). Product titles, categories and supplier notes are a seller's words. They go into a prompt only through `fenceUntrusted()`, which flattens newlines and control characters, caps the length, and wraps the text in `⟦…⟧`. Any brief that carries fenced text also appends `UNTRUSTED_DATA_RULE`. The marks must never be published: `stripFenceMarks` runs on every draft in `generateText`, the content agent, and again in `buildPostBody`.
- **ProductAgent picks; the server supplies the facts** (`agents/product-grounding.ts`). The model returns only product ids. An id that `search_products` never returned this run is dropped. Title, prices, image and the source keyword are read from the search result, never from the model's JSON.
- **Prompt caching** (`ai/anthropic-cache.ts`):
  - `AiService` marks only the *system* block. The user prompt carries per-product facts, so caching it would be a write that is never read.
  - The agent tool loops use a top-level `cache_control`, which moves forward with the conversation.
  - Metering counts `cache_read` + `cache_creation` tokens as input. Keep a system prompt stable across calls (no per-product values in it), or it never gets a cache hit.

## Frontend Architecture

### Live dashboards (`/dashboard`, `/reports`)
Both screens keep themselves current while they are on screen. There is no push channel; they poll through `lib/hooks/useLive.ts`:
- **What it does.** It polls on an interval only while the tab is visible, catches up on focus or tab return, never stacks requests, and keeps the last good data on a failed refresh.
- **One cheap endpoint.** `GET /stats/live` (`StatsService.live`) carries everything that moves during the day:
  - today's clicks, posts, failures and commissions;
  - clicks in the last hour;
  - the queue and the next scheduled send;
  - the last click, post and synced order;
  - 7–60 days of daily clicks, posts and commissions (Israel days).
- **Intervals:** live 20 s, the slower account picture 45 s, monthly overview 60 s, reports 60 s / 30 s. Mind the global throttler (100 requests a minute per IP) before shortening any of them.
- **Commissions arrive in jumps.** They move only when the earnings sync runs: new paid orders hourly (`syncRecentEarnings`, `RECENT_ORDER_STATUSES`, one call per account), every status every 3 h. The screen says so (`NowPanel`) instead of pretending they are live.
- **The commission day is 10:00 to 10:00 Israel time** (`commissionDayNow` in `stats/stats.util.ts`, by payment time), for both the «עמלות היום» tile (`today.*`) and the daily chart (`commission_days`). The owner asked for it after a rolling 24 h tile. It equals the portal's day except in the weeks the two countries change DST on different dates, so it is pinned to the Jerusalem clock, not derived from Pacific. Clicks and posts stay on Israel calendar days.
- **The AliExpress clock is US Pacific** (`earnings/portal-time.ts`, `PORTAL_TZ` = America/Los_Angeles, with DST). The order API's times carry no zone and are Pacific wall time. The portal's day runs 10:00–10:00 Israel time. They were read as GMT+8 for a while. Rows still matched the portal, since both sides read the same wall clock, but every stored moment was 15 h early. So everything measured from *now* was wrong: the sync window, "today", and the 24 h tile, which showed 1 order beside the portal's 21. Parse and format only through `portalWallToDate` / `dateToPortalWall`, never a fixed offset. Every sync rewrites the dates of the rows it sees from the API's own times (`dateMoved`), which is how the old rows were repaired. The portal comparison (`reconcile`) also lists rows it finds but the screen does not count, with the reason (`uncountedReason`). It sets `paid_date` from the export's `CompletedPaymentsTime` wherever the stored one differs or is missing. Without a payment time, "by payment" falls back to the creation time, which put an order placed on Sep 30 and paid on Oct 1 into September.
- **Charts.** One measure per chart (`DailyChart`), never two y-axes. Hues come from `lib/viz.ts`: clicks blue, commissions aqua, posts violet, settled/estimated blue/orange. They were validated per theme with the dataviz palette script.
  - A recharts gradient id must be a plain token (`useId()` stripped). A Hebrew title in the id broke `url(#…)` and the fill fell back to solid black.
- **Count-up.** `useCountUp` glides from the previous value. Counting up from zero on every refresh made every tile flicker.
- **Auth.** `useAuth` no longer logs the owner out on a 429/5xx/network error from `/auth/me`. It retries, and only a refused session ends it.

### One font: Arial
The owner asked for one font across the whole system. `tailwind.config.js` maps `sans`, `serif` and `mono` all to Arial, `globals.css` sets it on `html, body` and the form controls (they do not inherit it on their own), the storefront's `store.css` uses it too (Heebo and the Georgia wordmark are gone), and `next/font` (Inter) is no longer loaded. The emails already used Arial. Burned-in images keep server fonts on purpose: the pin frame (`pin-frame.ts`, DejaVu Sans first) and the Reels (Heebo), because Arial is not installed on the Linux render hosts and a missing font would fall back silently.

### Auth flow
`middleware.ts` only redirects unauthenticated users (no API calls, to avoid ISR cache invalidation). Real session validation happens inside the dashboard layout via the `useAuth` hook.

### API client
`frontend/src/lib/api-client.ts` is the shared Axios instance. It attaches the JWT access token from `localStorage` and handles 401 → token refresh automatically. Always use this instance, never create raw `axios` calls.

### Route groups
- `(auth)/` — public pages (login, register, password reset, Google callback)
- `(dashboard)/` — all protected pages; the layout enforces authentication

### Path alias
`@/` resolves to `frontend/src/` — use it for all internal imports.
