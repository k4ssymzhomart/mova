# MOVA

<p align="center">
  <img src="services/frontend/public/Logo_white.png" alt="MOVA" width="320" />
</p>

<p align="left">
  <a href="https://nextjs.org/">
    <img alt="Next.js" src="https://img.shields.io/badge/Next.js-14-000000.svg?style=for-the-badge&logo=nextdotjs&logoColor=white" />
  </a>
  <a href="https://supabase.com/">
    <img alt="Supabase" src="https://img.shields.io/badge/Supabase-3ECF8E.svg?style=for-the-badge&logo=supabase&logoColor=white" />
  </a>
  <a href="https://www.typescriptlang.org/">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6.svg?style=for-the-badge&logo=typescript&logoColor=white" />
  </a>
</p>

MOVA is a rehabilitation app for patients after primary total knee arthroplasty (TKA). It measures knee movement
with three wearable IMUs (WitMotion, on the thigh, shank and foot) connected straight to the browser over Bluetooth,
and it is built to a clinical technical specification (НТЗ) written by an orthopaedic surgeon, plus a scoring
specification for eight exercises.

**Start with [`SUBMISSION.md`](SUBMISSION.md)**: what is built, what is real, what is deliberately not claimed, and what
has not been verified. The hardware protocol is [`HARDWARE-TEST.md`](HARDWARE-TEST.md); notes for teammates are in
[`HANDOFF.md`](HANDOFF.md).

## What works today

- **Heel Slide, end to end.** A patient sees the exercise on Today, connects three sensors, does ten repetitions while
  the count and a drawing of the leg follow the movement, answers a check-in, and a clinician opens that session. The
  runbook is [`docs/heel-slide-path.md`](docs/heel-slide-path.md); the recording is
  [`docs/walkthrough/heel-slide-walkthrough-1920.mp4`](docs/walkthrough/heel-slide-walkthrough-1920.mp4).
- **Sensor rate configuration.** The app writes the output rate to the sensor and reads it back, instead of leaving
  it at the default.
- **Exercise library** at `/exercises`: seventeen exercises — twelve from the НТЗ and the scoring spec, plus five
  carried over from the PHOENIX signal and execution profiles — with the clinician-recorded reference videos on
  the twelve a clip is confirmed to show ([screenshots](docs/exercise-library/)).
- **Offline IMU tooling** in `services/imu-tools`: BLE capture, rig-health diagnostics, rep segmentation and a
  localhost dev-tools page, all of which run with no sensors. It reads the app's own stored frames, so a session
  can be recounted outside the browser ([README](services/imu-tools/README.md)).

What it does not do, stated in full in `SUBMISSION.md`:

- **No knee angle in degrees.** The sensors give a relative orientation reading that is not calibrated to the knee,
  so the patient screen shows no number and the clinician chart says what the reading is.
- **No scores.** The scoring engine now covers thirteen exercises and is in `services/frontend/src/lib/scoring`
  with its tests, but no screen uses it yet. `services/imu-tools` can score a recording offline; that number is a
  non-clinical engineering figure and stays inside that package.
- **Not run on physical sensors.** The recording uses a simulated sensor transport that exists only in local
  development and is marked «Симуляция» on screen.

## Architecture

```mermaid
flowchart LR
  S[3 × WitMotion IMU] -- Web Bluetooth --> B[Browser app<br/>rate write + readback<br/>rep counter, leg guide]
  B -- batched frames, offline outbox --> D[(Supabase<br/>Postgres + RLS)]
  B -- check-in --> D
  D -- care-team-gated RPCs --> C[Clinician view<br/>server-side recount]
```

- `services/frontend` — the Next.js 14 app (App Router, TypeScript, Tailwind): patient app, clinician portal, library.
  - `src/lib/ble` — Bluetooth client, sensor roles, rate register, session recorder, dev-only simulation.
  - `src/lib/telemetry` — frame buffer, durable queue and outbox.
  - `src/lib/motion` — repetition logic and the leg-guide geometry.
  - `src/lib/scoring` — the scoring engine (not wired to a screen).
  - `src/lib/exercises` — the static exercise catalogue and the exercise-id map; videos in `public/exercises`.
- `services/imu-tools` — IMU capture, diagnostics and offline analysis (Python, ported from PHOENIX; non-clinical).
- `supabase/migrations` — the database schema, row-level security and RPCs; `supabase/tests` — SQL tests.
- `docs` — the IA ([`docs/ia.md`](docs/ia.md)), the runbook, the walkthrough and research notes.

Everything else in the repository (`services/api`, the Python `src` and ML tooling — but not `services/imu-tools`,
which is part of the current product — `benchmark`, `data_manifests`,
most of `docs`, and the camera session screens still in the frontend) belongs to the earlier camera-based prototype
for Parkinson's disease and stroke (June–August 2026). It is kept for reference and is not the current product;
figures in its documents were that prototype's design targets, not measurements of this app.

## Running it

The app uses the hosted Supabase project. **Nothing needs to be installed for the database**: no Supabase CLI, no
Docker, no local Supabase. You need Node.js 20+ and network access to `*.supabase.co`.

```bash
cd services/frontend
npm ci
```

Copy `services/frontend/.env.local.example` to `services/frontend/.env.local` (git-ignored) and fill it in:

| Variable | Needed for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The app. Required. |
| `HEEL_SLIDE_PATIENT_PASSWORD`, `HEEL_SLIDE_CLINICIAN_PASSWORD` | The test sign-in buttons. Secrets: ask Kassymzhomart privately. |
| `SUPABASE_SERVICE_ROLE_KEY` | Only `npm run seed:heel-slide`. Not needed to run or present the app; keep it off other machines. |
| `NEXT_PUBLIC_SITE_URL` | The public origin behind a proxy, for sign-in redirects. Leave unset locally. |

| Command | What you get |
|---|---|
| `npm run demo` | **For presenting.** A development server with simulated sensors on http://127.0.0.1:3000/signin, after checking the env file (`npm run demo:check` only checks). Works the same on macOS, Linux and Windows. |
| `npm run dev` | A development server (http://localhost:3000) with real Bluetooth sensors, for hardware testing. |
| `npm run build` then `npm start` | A production server. It never shows test sign-in or simulated sensors, by design, and it serves whatever was last built: rebuild after every pull. |

Test sign-in («Войти как тестовый пациент» / «Войти как тестовый врач») exists only on a development server and on
Vercel previews. Web Bluetooth needs Chrome or Edge on desktop or Android; Safari and iOS do not have it. Simulated
sensors work in any browser.

### Presenting the Heel Slide demo

1. `git pull` on `main`, then `npm ci` in `services/frontend` (on Windows PowerShell type `npm.cmd` instead of `npm`).
2. `.env.local` with the two Supabase values and the two test passwords.
3. `npm run demo`, then open http://127.0.0.1:3000/signin and press «Войти как тестовый пациент». Today shows Heel
   Slide with «Начать». For the clinician side, go back to `/signin` and press «Войти как тестовый врач».

Every «Далее» on the sensors step writes one real session for the test patient to the production database, marked
simulated. Do not press «Dev auto-login · dev@mova.local» (a different, camera-era account), and do not type an
address into the e-mail sign-in box (it creates a real account).

### Checks

```bash
npx tsc --noEmit
npm run test:unit     # node:test — everything except BLE, telemetry and scoring
npm test              # vitest — BLE, telemetry and scoring
npm run i18n:check    # ru and en keys match; kk is a subset
npx next build
```

## Database

Migrations `0001`–`0023` and `0034`–`0036` are applied to the hosted project. `0024`–`0033` are unused here on
purpose: other branches use those numbers. `0037`–`0040` are in the repository but **not applied**; `0038` and `0040`
say in their headers what to resolve first. Do not run `supabase db push` against the hosted project until those are
decided.

- `0035` closed a hole where anyone could sign up as an administrator.
- `0036` closed a hole where any account in the shared self-serve clinic, patients included, could list every
  patient in it through the clinician-portal functions. Each new signup now gets its own clinic, and portal reads
  require a platform admin, the patient's clinic admin, or an active care-team link.

## Deployment

The app deploys to Vercel from `services/frontend`; see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Vercel rejects a
deployment whose commit author e-mail is not a member of the Vercel team.

## License

MOVA is intended to be released under the MIT License. There is no `LICENSE` file in the repository yet.

## Author

**Kassymzhomart Shubay**
Nazarbayev University
