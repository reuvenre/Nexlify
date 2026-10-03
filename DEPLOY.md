# Nexlify — Production Deployment

Nexlify deploys as two pieces: the **frontend** on Vercel and the **backend** (NestJS) on Render, with the database on Supabase Postgres. There is **no Redis in production**. The repo ships turnkey config for both.

```
┌─────────────┐      HTTPS       ┌──────────────────────────────┐      ┌────────────────────┐
│   Vercel    │  ───────────────▶│           Render             │─────▶│      Supabase      │
│  (frontend) │   NEXT_PUBLIC_   │  nexus-backend (NestJS :3001)│      │     (Postgres)     │
│             │     API_URL      │  in-memory cache, no Redis   │      │                    │
└─────────────┘                  └──────────────────────────────┘      └────────────────────┘
```

## 1. Backend → Render (Blueprint)

1. In Render: **New → Blueprint**, select `reuvenre/Nexlify`, branch `main`. Render reads [`render.yaml`](render.yaml) and creates one web service, `nexus-backend`. It does not create a database or a Redis instance.
2. After the first apply, fill the secrets marked `sync: false` in the service's **Environment** tab:
   - `DATABASE_URL` — the Supabase connection string:
     `postgresql://postgres:[DB-PASSWORD]@db.pyppovzopxleknwmgdiu.supabase.co:5432/postgres`
     (DB password: Supabase dashboard → Project Settings → Database). `DATABASE_SSL=true` is already set.
   - `ENCRYPTION_KEY` — generate with `openssl rand -hex 32` (must be 32-byte hex, or the app fail-fasts in production).
   - `ANTHROPIC_API_KEY` — your Anthropic key (global fallback for users without their own).
   - `FRONTEND_URL` — your Vercel URL.
   - `BACKEND_URL` — this service's URL, e.g. `https://nexus-backend.onrender.com`.
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — optional, for Google OAuth.
3. Deploy. `JWT_SECRET` and `JWT_REFRESH_SECRET` are generated automatically.

**No `REDIS_URL`.** Leave it unset. Without it `CacheModule` falls back to a per-process in-memory store that empties on every deploy, so anything that must survive a deploy belongs in the database, not the cache. See *Caching vs. persistence* in [CLAUDE.md](CLAUDE.md).

**Migrations:** in production (`NODE_ENV=production`) `main.ts` runs the migrations from `dist/migrations/` on boot, after building the baseline schema if the database is empty. The repo migrations are idempotent, so they no-op against an already-provisioned schema.

**Security:** the Supabase tables are reachable through the Supabase anon key unless Row Level Security is enabled on them. Enable RLS before exposing the project.

**Free tier:** the free Render instance spins down after about 15 minutes without traffic, so the schedulers run only while the service is awake.

## 2. Frontend → Vercel

Auto-deploys on push to `main` (root [`vercel.json`](vercel.json)). Set two env vars in the Vercel project (**Settings → Environment Variables**), then redeploy:

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

Local development can use Redis (docker-compose starts one), but production never does, so don't rely on cache persistence when testing locally.

```bash
docker compose up postgres redis -d        # or have them on :5432 / :6379
cd backend  && npm run start:dev           # API on :3001
cd frontend && npm run dev                 # web on :3000
```

Required env (root `.env`): `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_API_URL`. `REDIS_URL` is optional. See [CLAUDE.md](CLAUDE.md) for the full list.
