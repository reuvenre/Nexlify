# NEXUS — Production Deployment

NEXUS deploys as two pieces: the **frontend** on Vercel and the **backend** (NestJS + Postgres + Redis) on Render. The repo ships turnkey config for both.

```
┌─────────────┐      HTTPS       ┌──────────────────────────────┐
│   Vercel    │  ───────────────▶│           Render             │
│  (frontend) │   NEXT_PUBLIC_   │  nexus-backend (NestJS :3001)│
│             │     API_URL      │  nexus-db (Postgres)         │
└─────────────┘                  │  nexus-redis (Key Value)     │
                                 └──────────────────────────────┘
```

## 1. Backend → Render (Blueprint)

1. Push this repo to GitHub (already connected: `reuvenre/AliBot-PRO`).
2. In Render: **New → Blueprint**, select this repo. Render reads [`render.yaml`](render.yaml) and provisions the API, Postgres, and Redis together.
3. After the first apply, fill the secrets marked `sync: false` in the service's **Environment** tab:
   - `ENCRYPTION_KEY` — generate with `openssl rand -hex 32` (must be 32-byte hex, or the app fail-fasts in production).
   - `ANTHROPIC_API_KEY` — your Anthropic key (global fallback for users without their own).
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — for Google OAuth (optional).
   - `FRONTEND_URL` — your Vercel URL, e.g. `https://nexus.vercel.app`.
   - `BACKEND_URL` — this service's URL, e.g. `https://nexus-backend.onrender.com`.
4. Deploy. `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET` are wired/generated automatically.

**Migrations:** in production (`NODE_ENV=production`) the app runs migrations from `dist/migrations/` on boot (`migrationsRun: true`). The repo migrations are idempotent, so they no-op against an already-provisioned schema.

### Option B — use the existing Supabase database (already provisioned)

A Supabase project **`alibot-pro`** (`pyppovzopxleknwmgdiu`, region ap-northeast-1) already has the **full production schema provisioned** (all 10 tables). To use it instead of Render's Postgres:

1. In `render.yaml`, remove the `nexus-db` database block and the `fromDatabase` wiring, and set `DATABASE_URL` to `sync: false`.
2. In Render's Environment tab set `DATABASE_URL` to the Supabase connection string:
   `postgresql://postgres:[DB-PASSWORD]@db.pyppovzopxleknwmgdiu.supabase.co:5432/postgres`
   (DB password: Supabase dashboard → Project Settings → Database). Keep `DATABASE_SSL=true`.
3. **Security — enable RLS** (see the RLS note below) before going live, since the tables are otherwise reachable via the Supabase anon key.

## 2. Frontend → Vercel

Already auto-deploys on push to `main` (root [`vercel.json`](vercel.json)). Set two env vars in the Vercel project (**Settings → Environment Variables**), then redeploy:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | your Render backend URL, e.g. `https://nexus-backend.onrender.com` |
| `NEXT_PUBLIC_SITE_URL` | your Vercel URL (used by `robots.ts` / `sitemap.ts` / OG tags) |

## 3. Verify

```bash
curl https://nexus-backend.onrender.com/health        # {"status":"ok",...}
# then open the Vercel URL → landing page → register → Settings → save credentials
```

## Local full stack

```bash
docker compose up postgres redis -d        # or have them on :5432 / :6379
cd backend  && npm run start:dev           # API on :3001
cd frontend && npm run dev                 # web on :3000
```

Required env (root `.env`): `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_API_URL`. See [CLAUDE.md](CLAUDE.md) for the full list.
