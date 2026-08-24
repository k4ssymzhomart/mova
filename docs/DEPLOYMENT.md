# Deployment runbook

Mova runs as two Vercel projects out of this single repository, plus a hosted Supabase project.
Render remains supported as an alternative for the API (it is the only one of the three that can hold
a WebSocket open), and the root `render.yaml` Blueprint still describes it.

| Piece | Where | Root directory | Notes |
|---|---|---|---|
| Patient + clinician web app | Vercel project `mova` | `services/frontend` | Next.js 14 App Router |
| FoG inference gateway | Vercel project `mova-api` | `services/api` | FastAPI as a Python Serverless Function |
| Auth, Postgres, RLS | Supabase project `sbdtujkpklqyevaoxfph` | — | Free tier |

## How the API runs on a serverless host

`services/api` is written as a normal FastAPI app served by uvicorn (that is what the Dockerfile and
`docker-compose.yml` do). Two small pieces adapt it to Vercel without forking the application:

- **`services/api/api/index.py`** — Vercel's Python runtime serves any module under `api/` that
  exports an ASGI `app`. This module fixes `sys.path` (Python puts the *function's* directory on the
  path, not the project root) and re-exports `app.main:app`.
- **`services/api/vercel.json`** — rewrites every request onto that one function. Because a rewrite
  replaces the path the function sees, the rewrite smuggles the original path through as
  `?__path=…`, and `index.py` restores it onto the ASGI scope before FastAPI routes the request.

**WebSockets are not available on serverless functions.** On Vercel only `POST /api/v1/predict/fog`
is reachable; `/api/v1/predict/fog/stream` still works wherever the same image runs under uvicorn.
`useLiveInference` implements both transports behind one interface and picks whichever env var is
set, so no application code changes between hosts.

## Environment variables

### Project `mova-api`

| Variable | Value | Why |
|---|---|---|
| `MODEL_MODE` | `mock` | Deterministic Bachlin freeze-index engine until the trained model is served |
| `CORS_ORIGINS` | JSON array of frontend origins | e.g. `["https://mova.vercel.app"]` |
| `CORS_ORIGIN_REGEX` | `https://mova-[a-z0-9-]+\.vercel\.app` | Preview deployments get a fresh origin per commit and cannot be enumerated |

### Project `mova`

| Variable | Scope | Value |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Supabase → Project Settings → API → `anon` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Supabase → Project Settings → API → `service_role` key |
| `NEXT_PUBLIC_SITE_URL` | Public | The deployment's public origin |
| `NEXT_PUBLIC_BACKEND_HTTP_URL` | Public | The `mova-api` origin |

`NEXT_PUBLIC_*` variables are inlined at build time, so changing one requires a redeploy, not just a
restart.

## Supabase

The free tier **pauses a project after a stretch of inactivity**; every request then fails at DNS and
the app looks dead. Resume it from Dashboard → Project → *Resume project* — data, including backups
and storage, survives the pause.

After the frontend's public origin changes, update **Authentication → URL Configuration**:

- *Site URL* → the production origin.
- *Redirect URLs* → add `<origin>/auth/callback` for production, and
  `https://mova-*-<team>.vercel.app/auth/callback` if previews need to sign in.

Google OAuth additionally needs the Supabase callback
(`https://<project-ref>.supabase.co/auth/v1/callback`) in the Google Cloud console — that one does
not change when the frontend moves.

## Gotchas

- **Blocked deployments.** Vercel refuses a deployment whose commit author email is not attached to
  the GitHub account. Keep `git config user.email` set to a verified GitHub address; the
  `<id>+<login>@users.noreply.github.com` alias always matches.
- **Missing ONNX binaries.** `scripts/fetch-models.mjs` resolves `fog.onnx` / `har.onnx` from a local
  `checkpoints/onnx/` or from `MOVA_MODELS_BASE_URL`. Neither is present on a clean CI clone, so the
  build logs a warning and the app degrades to simulated on-device scoring. It never fails the build.
- **Cold starts.** The first request to an idle Python function takes seconds. `useLiveInference`
  probes with a long timeout, runs simulated meanwhile, and switches over as soon as the probe
  returns — so a cold backend degrades gracefully rather than stalling a session.
