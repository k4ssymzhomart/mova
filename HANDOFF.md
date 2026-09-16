# Handoff — feat/heel-slide (PR #26)

Two people, an hour each, no context. Read your section only.

## Rishat (@Theleriz)

**You don't need to build anything.** PR #26 (`feat/heel-slide`, base `feat/tka-app-shell`) already contains the
working path: Today → three sensors → Heel Slide with a live rep count → check-in → the clinician's view of that
session. It includes your #25 (real BLE layer), merged in.

**Why your deployment can't log in as the test accounts.** The password form on `/signin` renders only in local
development (`next dev`) and on Vercel preview builds. Everywhere else `/signin` offers Google and an email link, and
the test accounts have no mailbox.

| | |
|---|---|
| Test patient | `heel-slide-patient@mova.test` |
| Test clinician | `heel-slide-clinician@mova.test` |
| Passwords | ask Kassymzhomart privately; they are not in the repo |
| Patient start | `/app/session/new/dd6e686a-5946-42d2-bd82-ec94f60f49a9` |
| Clinician view of that patient | `/clinician/patient/6ed0d292-1183-4ae7-9a3e-04ee87c39a20` |

**Why a self-registered account looks empty.** A new signup (Google or email link) becomes a patient in the shared
"Mova Personal" clinic with no program and no prescription, so Today has nothing to start. Since hotfix `0035` a signup
can never get a clinician or admin role, whatever the signup form sends.

**Please don't push unreviewed issue output to a shared branch** (`main`, `feat/tka-app-shell`, `feat/heel-slide`).
Production carries 9 real patients and migrations `0023`, `0034` and `0035` are applied there. Open a PR and ask for a
review instead. Your #24 is not applied; its `0023_tenancy_fix.sql` shares version `0023` with #25's
`0023_patient_ble_devices.sql`, so it needs renumbering before it can land.

## Nurzhan (@Nurzhan06)

**The one thing worth doing today, if you have sensors in hand: Test 1** in [`HARDWARE-TEST.md`](HARDWARE-TEST.md).
Connect **one** sensor in the app, open «Технические данные», wait 30 seconds, and write down «Кадров за последние
30 с» and the rate readback line. About 1500 means the sensor now runs at 50 Hz; about 300 means it is still at the
10 Hz default. That single number confirms or kills the project's central technical claim.

**Skip today:** the university server, model training, the other seven exercises.

**Where things are:**
- How to run the app locally and sign in: the "Running it with `feat/heel-slide`" section of `HARDWARE-TEST.md`.
  You need `services/frontend/.env.local` from Kassymzhomart.
- Test accounts and URLs: the table in Rishat's section above.
- Test 1 does not need «Далее»; pressing it starts a session on the production database.

**Where to post the result:** a comment on PR #26 — https://github.com/k4ssymzhomart/mova/pull/26. Numbers, not
impressions.
