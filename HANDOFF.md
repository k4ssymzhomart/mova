# Handoff

Everything is on `main`: the Heel Slide path (PR #26), the exercise library, the scoring engine and the tenancy fix
(PR #27). Read your section only.

## Anyone running or presenting the app

Follow "Running it" in [`README.md`](README.md). The short version:

```bash
git checkout main
git pull
cd services/frontend
npm ci
npm run demo
```

Then open http://127.0.0.1:3000/signin. On Windows PowerShell type `npm.cmd` instead of `npm`.

`services/frontend/.env.local` needs four values from Kassymzhomart, sent privately: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `HEEL_SLIDE_PATIENT_PASSWORD`, `HEEL_SLIDE_CLINICIAN_PASSWORD`. Not the service-role
key. `npm run demo:check` says what is missing, by name.

If `/signin` shows only Google and the e-mail box, you are on a production server (`npm run build` + `npm start`, or
a deployment): test sign-in never appears there. Use `npm run demo`.

## Rishat (@Theleriz)

**You don't need to build anything.** `main` already contains the
working path: Today → three sensors → Heel Slide with a live rep count → check-in → the clinician's view of that
session. It includes your #25 (real BLE layer), merged in.

**Why your deployment can't log in as the test accounts.** The password form on `/signin` renders only in local
development (`npm run dev`, `npm run demo`) and on Vercel preview builds. Everywhere else `/signin` offers Google and an email link, and
the test accounts have no mailbox.

| | |
|---|---|
| Test patient | `heel-slide-patient@mova.test` |
| Test clinician | `heel-slide-clinician@mova.test` |
| Passwords | ask Kassymzhomart privately; they are not in the repo |
| Patient start | `/app/session/new/dd6e686a-5946-42d2-bd82-ec94f60f49a9` |
| Clinician view of that patient | `/clinician/patient/6ed0d292-1183-4ae7-9a3e-04ee87c39a20` |

**Why a self-registered account looks empty.** A new signup (Google or email link) becomes a patient in a clinic of
its own (migration `0036`) with no program and no prescription, so Today has nothing to start. Since `0035` a signup
can never get a clinician or admin role, whatever the signup form sends.

**Please don't push unreviewed issue output to a shared branch** (`main`, `feat/tka-app-shell`, `feat/heel-slide`).
Production carries real patients and migrations up to `0023`, then `0034`–`0036`, are applied there. Open a PR and
ask for a review instead. Your tenancy fix landed as `0036`; your exercise-screen migrations are in the repo as
`0037`–`0040`, not applied (see the notes in their headers).

## Nurzhan (@Nurzhan06)

**The one thing worth doing today, if you have sensors in hand: Test 1** in [`HARDWARE-TEST.md`](HARDWARE-TEST.md).
Connect **one** sensor in the app, open «Технические данные», wait 30 seconds, and write down «Кадров за последние
30 с» and the rate readback line. About 1500 means the sensor now runs at 50 Hz; about 300 means it is still at the
10 Hz default. That single number confirms or kills the project's central technical claim.

**Skip today:** the university server, model training, the other seven exercises.

**Where things are:**
- How to run the app locally and sign in: the "Running it" section of `HARDWARE-TEST.md` (`npm run dev`, real
  sensors, not `npm run demo`). You need the four `.env.local` values above from Kassymzhomart.
- Test accounts and URLs: the table in Rishat's section above.
- Test 1 does not need «Далее»; pressing it starts a session on the production database.

**Where to post the result:** a comment on PR #26 — https://github.com/k4ssymzhomart/mova/pull/26. Numbers, not
impressions.
