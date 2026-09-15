# Heel Slide, end to end

Runbook for the one exercise that goes all the way through with real sensors: a patient opens the app, sees
Heel Slide on Today, straps on three WT901BLE68 sensors, does ten repetitions while the rep count and the live
leg move, answers the check-in, and a clinician opens that session. §7 maps the hardware test protocol onto the
screens.

Seven links, each of which has to work on real hardware:

| # | Link | Where it lives |
|---|---|---|
| 1 | A prescription exists | `services/frontend/scripts/seed-heel-slide.mjs` (no builder UI, by design) |
| 2 | Today lists it with «Начать» | `src/app/(app)/app/page.tsx` (unchanged) |
| 3 | Three sensors, each bound explicitly to thigh / shank / foot | `src/lib/ble/liveSensors.ts`, `patient_ble_devices` (0023) |
| 4 | Sample rate written to `ffe9`, read back, delivered rate measured | `src/lib/ble/sampleRate.ts`, `witRegister.ts` |
| 5 | Frames reach Postgres batched and idempotent | `src/lib/telemetry/buffer.ts` → `flush_session_telemetry_batch` (0021, redefined in 0034); rows still unsent at the end go out later through `src/lib/telemetry/outbox.ts` |
| 6 | Reps counted, guide moves | `src/lib/motion/*` (Phoenix `reps.py` + `LiveLegGuide` port, ±180° wrap fixed) |
| 7 | Check-in, then one clinician view of the session | `session_check_ins` + RPCs (0034), `/clinician/patient/[id]` |

Out of scope on this path: other exercises, any score (correctness / volume / target), calibration, a
prescription builder, safety triage of the check-in answers.

---

## 1. What is real and what is labelled

| Item | What it is |
|---|---|
| IMU frames | Real. Raw accelerometer and gyroscope counts plus Euler roll / pitch / yaw, stored per frame in `session_frames.imu` with the role. The 20-byte `55 61` frame has no checksum, so every row says `validation_status: "unverified_checksum"`. |
| Timestamps | `recorded_at` is the browser's receive time. The sensor sends no timestamp, so BLE transport jitter is inside every timing figure. |
| Sample rate | 50 Hz (code `0x08`) by default, 100 Hz (`0x09`) when the sensors step is opened with `?rate=100`. The rate is written on every connect and reconnect and register `0x03` is read back. "Confirmed" means the read-back code equals the request, nothing more. The delivered rate is measured from received frames and is the figure to trust. |
| Rep count | Real output of the hysteresis counter over the flexion proxy. A rep that is in progress when the data stops for more than 1 s is discarded, not counted after the gap. The clinician view recounts from the stored frames with the same rules and shows the on-device count next to it. |
| Flexion proxy | `wrap(shank.pitch − thigh.pitch)`, zeroed on the first ~500 ms after the latest «Начать» (that span is saved in the session summary, so the recount uses the same zero) and oriented so the larger excursion is positive. It is a relative device-orientation difference, **not knee flexion**, not calibrated, and not used for any score. The patient sees no number; the clinician chart labels it as such. `FLEXION_GAIN` from Phoenix is not ported. |
| Live leg drawing | Follows the proxy, clamped to 0–120 for drawing only, with a caption saying it is not a measurement. |
| Score, target | None computed. The `target` in the exercise config (`knee_flexion_deg ≥ 90`) is draft engineering config and is not evaluated anywhere. |
| Battery | Register `0x64` is read after the rate on every connect and reconnect and every 60 s while streaming. Volts are the register value ÷ 100. The percentage is WitMotion's interpolation table from its SDK, labelled as such, not a measured state of charge. A failed read shows as unknown, never as a guess. |
| Reconnect | A sensor that drops without the app asking is retried on the same device, without the chooser, after 1, 2, 4 and 8 s, then every 10 s, for up to 120 s. The session, recording and zero are untouched. |
| Frame delivery | Batched. At finish the app keeps trying for about 10 s; rows still unsent stay in the browser (IndexedDB) and are sent later: when the app opens, when the browser comes back online, and every 30 s while any remain. Rows recorded after the session ended are skipped by the server. |
| Check-in | Real patient answers, stored once. Every question must be answered, and the three 0–10 scales start with nothing selected, so no preset value is ever stored as an answer. No triage is derived from them on this path. |
| Device model | Shown as `WT901BLE68 (unverified)` until the label and datasheet are checked (§7). |
| Device identity | The browser's Bluetooth `device.id` (its last six characters are shown as a short ID) plus the advertised name. Web Bluetooth never exposes the MAC address. |
| Signal quality | Evaluated at most once per second and stored; not enforced. |
| Catalog row | `heel-slide` is `is_published = false`, `approval_state: "draft"`. |
| Accounts | `@mova.test` test accounts in an isolated clinic, `heel-slide-test`. |

## 2. Apply the migrations

Hosted project `sbdtujkpklqyevaoxfph` has 0001–0022 applied, plus `0035_signup_role_hotfix.sql` (already live: a
new account's role never comes from signup metadata, so nobody can sign up as a clinician or admin). This path
needs two more, in order:

1. `supabase/migrations/0023_patient_ble_devices.sql` (from #25): per-patient role ↔ device binding.
2. `supabase/migrations/0034_heel_slide_path.sql`:
   - adds `knee_flexion_extension` to `public.exercise_modality`;
   - creates `app.can_review_patient(uuid)`: platform admin, an active clinician with an active
     `care_team_link`, or the patient's `clinic_admin`. Never clinic-membership equality;
   - creates `public.session_check_ins` (RLS on, readable by the patient and by `app.can_review_patient`, no
     client writes, audited);
   - `start_prescribed_session`: locks the prescription, requires the caller's own active prescription in the
     caller's own active program, and marks the caller's sessions for that prescription that are still in
     progress as `aborted` (`summary.ended_by: "superseded_by_new_session"`) before inserting the new one;
   - `finish_prescribed_session`: completes only an `in_progress` session (anything else raises 55000), stores the
     summary as given (a JSON object of at most 64 KB), never writes `session_metrics`;
   - redefines `flush_session_telemetry_batch`: still idempotent on `(session_id, recorded_at, seq)`; for a session
     that is no longer in progress, frames and events after `ended_at` are skipped and counted instead of stored.
     The camera SessionStudio uses this RPC too;
   - creates `submit_session_check_in`, `clinician_patient_sessions` and `clinician_session_result` (the
     prescription and check-in in the result are tied to the session's own patient).

   Signatures are in the migration; anon cannot execute any of them.

0034 is numbered above #24's 0023–0033. #24 (tenancy fix) and #25 both ship a `0023_*` file; that collision is
resolved in those PRs. Once #24's 0024–0033 are merged after 0034 is on the remote, `supabase db push` will
need `--include-all`.

### Dry run first (nothing is committed)

Run both migrations and the database test in one transaction that ends in `rollback`. 0035 is already live on
hosted; on a fresh database apply 0001–0022 and 0035 first.

```bash
cd /path/to/mova
{
  echo "begin;"
  cat supabase/migrations/0023_patient_ble_devices.sql supabase/migrations/0034_heel_slide_path.sql
  awk 'BEGIN{d=0} /^begin;$/ && !d {d=1; next} {print}' supabase/tests/heel_slide_path_test.sql
} > /tmp/heel-slide-dryrun.sql        # the test's own begin is dropped; its rollback ends everything
```

Send it with `psql -v ON_ERROR_STOP=1 -f /tmp/heel-slide-dryrun.sql "$DATABASE_URL"`, or over HTTPS where port
5432 is blocked:

```bash
export SUPABASE_ACCESS_TOKEN=…   # personal access token; never commit it
sq() {
  jq -Rs '{query:.}' < "$1" | curl -sS -X POST \
    "https://api.supabase.com/v1/projects/sbdtujkpklqyevaoxfph/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data-binary @-
  echo
}
sq /tmp/heel-slide-dryrun.sql
```

A good run prints 74 `ok N - …` lines and `1..74`. Any failure comes back as an error naming the check.

### Apply

Each file goes as its own request, so each commits on its own. 0034 must be committed before the seed runs,
because an enum value added by `ALTER TYPE … ADD VALUE` cannot be used in the transaction that adds it.

```bash
sq supabase/migrations/0023_patient_ble_devices.sql
sq supabase/migrations/0034_heel_slide_path.sql
cat > /tmp/record.sql <<'SQL'
insert into supabase_migrations.schema_migrations (version, name)
values ('0023', 'patient_ble_devices'), ('0034', 'heel_slide_path')
on conflict do nothing;
SQL
sq /tmp/record.sql
```

Check:

```sql
select to_regclass('public.patient_ble_devices') as bindings,
       to_regclass('public.session_check_ins') as check_ins,
       'knee_flexion_extension' = any (enum_range(null::public.exercise_modality)::text[]) as modality,
       to_regprocedure('public.finish_prescribed_session(uuid,jsonb)') as finish,
       to_regprocedure('public.clinician_session_result(uuid)') as clinician_result;
```

## 3. Database test

`supabase/tests/heel_slide_path_test.sql` needs 0035, 0023 and 0034 applied (or the dry-run wrapper above). It
creates its own clinics, users, patients, clinicians, program and prescriptions, sets each fixture's role
explicitly on `profiles` (never through signup metadata), impersonates each user with
`set local role authenticated` and `request.jwt.claims`, and always ends in `rollback`. It does not use pgTAP
(the hosted project does not have it): each check raises on failure, and the final select prints TAP lines, so
`pg_prove` can read it too.

Among its 74 checks:

- signup metadata asking for admin, clinic_admin or clinician still yields a patient in Mova Personal;
- a patient starts a session only from their own active prescription in their own active program, and a new
  start aborts their own in-progress session for that prescription (not another prescription's, not another
  patient's);
- finishing works only on an in-progress session (55000 otherwise), validates the summary (22023), refuses
  another patient's session (42501) and writes no metrics;
- telemetry stores and re-sends idempotently, and after the session ends, rows recorded later are skipped while
  rows recorded before still land;
- check-in is refused before the session is completed, every field is validated, `none` is stripped, the note is
  trimmed, a second submit returns the stored row unchanged; no direct insert / update / delete on
  `session_check_ins`;
- check-ins are visible to the patient and a linked active clinician, and not to an unlinked clinician, an
  inactive link, a deactivated clinician, another clinic's admin or a metadata-admin signup;
- the clinician RPCs return null for those same outsiders, and the full result for a linked clinician and the
  patient's clinic admin; a session repointed at another patient's prescription shows no prescription; anon
  cannot execute the RPCs.

## 4. Seed the test clinic and sign in

`services/frontend/scripts/seed-heel-slide.mjs` uses the service role and is idempotent: it looks each row up,
creates what is missing and updates only fields that differ. It writes:

- `exercises` `heel-slide`: name `Heel Slide` (catalog names are shown verbatim), modality
  `knee_flexion_extension`, `target_joints '{}'`, unpublished, `default_dose {"reps": 10}`, the draft
  `exercise_config/heel_slide_path.v1` in `scoring_rubric`;
- `clinics` `heel-slide-test` ("Heel Slide test clinic", `Asia/Almaty`);
- a patient and a clinician account (email confirmed), their profiles moved into that clinic with the right role;
- `patients` (mrn `TEST-HEEL-SLIDE`, `affected_side` from `HEEL_SLIDE_SIDE`), `clinicians`, an active
  `care_team_links` row;
- an active program in the test clinic and an active Heel Slide prescription, `dose {"reps": 10}`, prescribed by
  the clinician.

### Environment

Read from the process environment first, then `services/frontend/.env.local`.

| Variable | Needed | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | always | already in `.env.local` |
| `HEEL_SLIDE_PATIENT_EMAIL` | optional | default `heel-slide-patient@mova.test`; must end in `@mova.test` |
| `HEEL_SLIDE_CLINICIAN_EMAIL` | optional | default `heel-slide-clinician@mova.test`; must end in `@mova.test` |
| `HEEL_SLIDE_PATIENT_PASSWORD` | when the patient account is created or taken over | never printed; the tester signs in with it |
| `HEEL_SLIDE_CLINICIAN_PASSWORD` | when the clinician account is created or taken over | never printed; the tester signs in with it |
| `HEEL_SLIDE_SIDE` | optional | `right` (default) or `left` |

**Keep `@mova.test` addresses.** The database is shared with real patients, so the seed refuses any other address
before it reads anything (exit code 2). A `.test` address receives no mail and belongs to no Google account, so
no real person can sign in behind it.

`HEEL_SLIDE_SIDE` is stored in `patients.affected_side` and is used only to pick the lateralized binding role
(`r_thigh`, `r_shank`, …) in `patient_ble_devices`. The patient shell does not show it as the operated knee.

### Run

```bash
cd services/frontend
npm run seed:heel-slide -- --dry-run          # or: node scripts/seed-heel-slide.mjs --dry-run
HEEL_SLIDE_PATIENT_PASSWORD=… HEEL_SLIDE_CLINICIAN_PASSWORD=… npm run seed:heel-slide
```

The dry run reads only and prints the plan plus any unmet preconditions (missing migrations, a missing password,
an address that is not `@mova.test`). The real run checks the same preconditions before its first write and stops
with "Nothing was written" if one fails. Output is ids, emails and two routes:
`/app/session/new/<prescriptionId>` and `/clinician/patient/<patientId>`.

When an address already has an account, the seed:

- reuses it when it is already in the test clinic with the right role;
- takes it over without a flag when it is fresh (the patient profile every new account starts as, with no patient
  or clinician record yet). That is usually the seed's own account from a run that stopped half way, so a rerun
  finishes it;
- takes it over only with `--adopt-existing` when it is another test account in another clinic;
- refuses it, with or without the flag, when it has a privileged role, already is the other test role, carries
  its own MRN, or has records in another clinic. Use a different `@mova.test` address instead.

Taking an account over sets its password from the environment and confirms its email.

### Sign in

The test-account password form on `/signin` accepts only `@mova.test` addresses and is shown only on a local
development server (`npx next dev`, on `http://localhost`) and on Vercel preview deployments. Run the hardware
session on one of those; both are secure contexts for Web Bluetooth.

- Patient: open `/signin` and use `HEEL_SLIDE_PATIENT_EMAIL` with `HEEL_SLIDE_PATIENT_PASSWORD`. It lands on `/app`.
- Clinician: open `/signin?next=/clinician` and use `HEEL_SLIDE_CLINICIAN_EMAIL` with
  `HEEL_SLIDE_CLINICIAN_PASSWORD`. Use another browser profile, or sign out first.

Production has no password form, and the other sign-in routes cannot reach these accounts: a magic link to a
`.test` address is never delivered (the hosted project has no custom SMTP either, so its built-in mailer sends only
to members of the project's organisation, two emails an hour), and Google sign-in cannot produce a `@mova.test`
account.

## 5. Hardware walk-through

Before starting: a Chromium browser that has Web Bluetooth (§6), the app on a preview deployment or
`http://localhost` (§4), three charged sensors labelled 1 / 2 / 3 with their MACs written down (§7), and a bed or
mat.

1. **Today.** Sign in as the test patient. `/app` lists **Heel Slide** with «Начать».
2. **Sensors** (`/app/session/new/<prescriptionId>`; add `?rate=100` for a 100 Hz run). The three units usually
   advertise the same name, so Chrome's chooser cannot tell them apart: power on **only** the unit for the row you
   are binding. Press «Подключить» on the thigh row, pick the one unit listed, and note its short ID under
   «Технические данные». Power on the next unit and repeat for the shank, then the foot. Each row shows the rate
   result, the delivered Hz and a short battery figure («≈ N %»). A device already bound to another role is
   refused. «Далее» unlocks once all three are streaming; an unconfirmed rate does not block.
3. **Start.** «Далее» calls `start_prescribed_session` with the device descriptors (name, device id, rate
   read-back, battery) and opens `/app/session/<id>/exercise`. A session for the same prescription that was left in
   progress is marked aborted. The calibrate step is not on this path.
4. **Mount, lie down, «Начать».** Strap each sensor to its segment of the operated leg. Which way each one faces is
   not fixed yet; record it (§7, moving axis). Lie with the leg **straight**, press «Начать» and keep the leg still
   through the three-second countdown and the half second after it: recording starts when the countdown ends, and
   that first half second is the zero for both the live count and the clinician recount. Starting bent has known
   effects (§7, limitations).
5. **Ten heel slides.** Slide the heel toward the buttock and back. The `N / 10` counter and the phase text update,
   the leg drawing follows, and the saving line shows frames sent and pending. If the thigh or shank sensor stops
   streaming, counting pauses and a line names the sensor; a rep in progress when the data stopped for more than
   1 s is not counted. A dropped sensor reconnects by itself («Переподключение…»); if it has not come back after
   120 s, press «Подключить заново».
6. **Finish.** «Завершить» (or «Закончить раньше») stops recording, tries for about 10 s to deliver what is left,
   completes the session through `finish_prescribed_session` and opens the check-in. The summary it stores holds
   the device's count and rep segments, the zero window, each sensor's rate checks, battery at finish and
   reconnects, and the delivery counters. Rows still unsent stay in the browser and are sent the next time the app
   is open and online.
7. **Check-in** (`/app/session/<id>/check-in`). Pain before and after and difficulty on 0–10 (nothing is
   preselected), how the knee feels, new symptoms. Every question is required. Submitting opens the summary.
8. **Clinician.** Sign in as the test clinician (`/signin?next=/clinician`), open the test patient
   (`/clinician/patient/<patientId>`). The Heel Slide section sits under the patient's name and shows:
   - reps recounted from stored frames against the target, with the device's count next to it, reps discarded at a
     pause, and frames from before the last start drawn grey and left out of the recount;
   - the relative-orientation chart with its caption;
   - per sensor: frames stored, the rate computed from stored frames, the device at finish (and the one at start if
     it changed), and the latest rate check;
   - every rate check per sensor, battery at start and at finish, and reconnects;
   - pairing skew, and the frames confirmed, unsent and dropped and the send errors as the device counted them at
     finish;
   - the check-in answers.

   `?session=<id>` selects an older session.

Look up what was stored (SQL editor, as the project owner):

```sql
select s.id, s.status, s.started_at, s.ended_at, s.device_info -> 'roles' as roles,
       (select count(*) from public.session_frames f where f.session_id = s.id) as frames,
       exists (select 1 from public.session_check_ins c where c.session_id = s.id) as has_check_in
from public.sessions s
join public.patients p on p.id = s.patient_id
join public.clinics c on c.id = p.clinic_id
where c.slug = 'heel-slide-test' and p.mrn = 'TEST-HEEL-SLIDE'
order by s.started_at desc
limit 5;
```

If a sensor has to be bound to a different role, clear the test patient's bindings and connect again:

```sql
delete from public.patient_ble_devices d
using public.patients p, public.clinics c
where d.patient_id = p.id and p.clinic_id = c.id
  and c.slug = 'heel-slide-test' and p.mrn = 'TEST-HEEL-SLIDE';
```

## 6. Web Bluetooth constraints

- Works in Chrome or Edge on desktop and Chrome on Android. Not in Safari, not on iOS (any browser there), not in
  Firefox.
- Needs a secure context: HTTPS, or `http://localhost` for local development.
- The chooser opens only from a click, one device per click. That is why each role has its own button.
- No MAC address. `device.id` is scoped to the origin and browser profile; clearing site data or using another
  browser gives a new id, and the sensor has to be bound again.
- A drop while the page stays open is reconnected automatically on the same device (§1). A full page reload, or
  leaving the app, drops every GATT connection for good; moving between flow steps inside the app keeps them.
  After a reload the exercise step shows the connect panel again and the on-screen count starts over.
- GATT writes to a device are serialized and spaced about 150 ms apart, as in the WitMotion SDK; the battery read
  shares that queue with the rate write.
- Rate codes: `FF AA 03 08 00` is 50 Hz and `FF AA 03 09 00` is 100 Hz; the WitMotion SDK table and issue #18
  agree on those two. They disagree on lower and higher codes (`0x06` is 10 Hz in one, 20 Hz in the other; 200 Hz
  is `0x0B` versus `0x0A`), so those are never written. The save command `FF AA 00 00 00` is never sent: the rate
  is set each session, which avoids flash wear.
- Keep the tab visible during a session. Behaviour in a background tab has not been measured.

## 7. The hardware test protocol, screen by screen

The protocol (@Nurzhan06) is run through the app, not a separate BLE tool. Record numbers, with the date, browser
and OS, and the label of each sensor.

### Before you start

- Label the units 1 / 2 / 3. Read each MAC from its label or with a BLE scanner app such as nRF Connect; Web
  Bluetooth never shows it.
- Bind roles with **one unit powered on at a time** (§5 step 2), and write down unit number ↔ role ↔ short ID ↔ MAC.
  The short ID is how the app names a unit from then on.

### Test 1: does the rate write work

Sensors step, **one** sensor connected (the thigh row). Connecting runs the whole sequence: unlock `FF AA 69 88 B5`,
rate `FF AA 03 08 00` to `ffe9`, read-back `FF AA 27 03 00`, answered by a `55 71` frame. Open «Технические данные»:

- the requested rate and the read-back code (`0x08` expected);
- **frames in the last 30 s** (shows "—" until 30 s have passed since the first frame). About 1500 means 50 Hz, about
  300 means the write did not take (10 Hz).

Fallback: open the same page with `?rate=100`. The read-back should be `0x09` and the 30 s count about 3000. The
unlock bytes and the `ffe9` write characteristic are fixed in `src/lib/ble/witRegister.ts` and
`connectSensor.ts`. If the count is still about 300 after both rates, stop and report it.

### Test 2: three sensors at once

Sensors step, all three connected and streaming. After a minute, read **frames in the last 60 s** for each sensor
in «Технические данные»; Hz is that count ÷ 60. Compare with Test 1.

For the inter-sensor skew, start a session, run for at least a minute, finish, and read the median and largest
thigh–shank skew in the clinician technical block, or run the skew query in §8 (swap `shank` for `foot` there for
the foot). These are receive times, so they include BLE jitter.

### Test 3: the rep counter on a real leg

Exercise screen.

1. **Ten deliberate heel slides.** The counter should reach 10 / 10.
2. **Ten fast ones.** Still 10?
3. **Five half-range slides.** Caveat: `min_valid_excursion_deg` (22.5) is written in knee degrees but is applied
   to the uncalibrated proxy, whose degrees are not knee degrees. Whether a half slide crosses 22.5 proxy degrees
   depends on the mounting, so a counted partial is not by itself a bug. Note the peak of each partial on the
   clinician chart. Only calibration (#17) can make this threshold mean knee degrees.
4. **Watch the guide.** It should track the leg. A sudden jump of about 360° would be the ±180° wrap bug; on the
   clinician chart it shows as a vertical spike. Note the leg position and the session id.

### Test 4: the honest failure modes

1. **Pull a sensor off mid-set.** Thigh or shank: counting pauses and a line names the missing sensor. A rep in
   progress when the data stopped for more than 1 s is not counted, and the clinician view lists it under reps not
   counted because of a pause. Foot only: a notice says the foot sensor is disconnected and its frames are not
   being saved; counting continues.
2. **Walk out of range and come back.** The row shows «Переподключение…» and retries after 1, 2, 4 and 8 s, then
   every 10 s, for up to 120 s. On return, the same session continues on the same zero; the rate is written again
   and the battery re-read. Attempts show in «Технические данные», and successful reconnects in the clinician
   technical block. Nothing is received while the sensor is out of range, so the stored series has a gap there.
   After 120 s the row offers «Подключить заново».
3. **Turn off Wi-Fi mid-set, do three reps, turn it back on.** The saving line shows unsent rows growing; the buffer
   holds about five minutes. After Wi-Fi returns, unsent falls back to 0. To confirm the rows landed, check that the
   clinician chart has no hole over those reps, or count the session's frames with the first query in §8. If you
   finish while still offline, the app tries for about 10 s, stores what is left in the browser and sends it the
   next time the app is open and online; the clinician view shows how many were unsent at the moment of finishing.

### Test 5: battery

The sensors step readout shows «Батарея: 3,92 В (≈ 75 % по таблице WitMotion)» per sensor; the row shows «≈ 75 %».
The battery is read on connect and every 60 s while streaming. Note the start, run 20 minutes at the chosen rate,
finish, and read «Батарея в начале» and «Батарея в конце» per sensor in the clinician technical block (or the
battery query in §8). Extrapolate from the volts: the percentage is WitMotion's table, not a measured charge.
"unknown" means that read failed.

### While the sensors are in your hand

- **Model number.** What the label on each unit says, compared with the WT901BLECL datasheet (9-axis). Until this is
  confirmed the app says `WT901BLE68 (unverified)`.
- **Moving axis on the real mounting.** During heel slides, which Euler axis actually changes on the thigh and
  shank sensors (axis query in §8). The path assumes pitch (`euler_deg[1]`); Phoenix's live guide found roll moving
  on its mounting. If roll moves here, reps will not count: report it with a photo of the mounting rather than
  changing code on the spot.

### Known limitations

- **Starting bent.** The zero is whatever pose the leg holds during the half second after the countdown. If the leg
  is bent then by at least 22.5 proxy degrees relative to the rest pose it returns to between reps, the patient's
  screen counts one extra rep that the clinician recount does not. If it is bent by more than about half of each
  slide, the whole session reads inverted in both counts: the guide draws the leg bent while it lies straight. This
  is pinned by `src/lib/motion/recount.test.ts`; changing it is a calibration decision (#17). Start straight and
  still.
- **Test 3.3** cannot be settled by code (above).
- **Pause judgement near 1 s.** The live and stored pairing can differ by up to about 100 ms at a dropout, so a pause
  very close to 1 s may be judged differently by the live count and the recount.
- **Clocks.** Frame times come from the patient's device and the session end from the server. If the device clock
  runs ahead, rows from the last seconds before finishing that arrive late are skipped.

### What to bring back

- The frame counts from Tests 1 and 2: numbers, not impressions.
- Whether the counter reached 10 / 10, and whether partials counted.
- A short screen recording of the ten-rep test.
- The model number on the label.
- Anything that jumped, dropped or lied, with the session id.

## 8. SQL for the hardware checks

Replace `<session id>` with the session from §5.

Delivered rate, gaps and loss inputs per role:

```sql
with f as (
  select imu ->> 'role' as role,
         recorded_at,
         extract(epoch from recorded_at - lag(recorded_at) over (partition by imu ->> 'role' order by recorded_at, seq)) * 1000 as dt_ms
  from public.session_frames
  where session_id = '<session id>'
)
select role,
       count(*) as frames,
       round(extract(epoch from max(recorded_at) - min(recorded_at)), 1) as seconds,
       round((count(*) - 1) / nullif(extract(epoch from max(recorded_at) - min(recorded_at)), 0), 1) as delivered_hz,
       round(percentile_cont(0.5) within group (order by dt_ms)::numeric, 1) as median_dt_ms,
       round(max(dt_ms), 1) as max_gap_ms
from f
group by role
order by role;
```

Packet loss per role is `1 − frames ÷ (seconds × requested Hz)`.

Thigh ↔ shank skew (nearest shank frame on either side of each thigh frame):

```sql
select round(percentile_cont(0.5) within group (order by skew_ms)::numeric, 1) as median_skew_ms,
       round(max(skew_ms), 1) as max_skew_ms,
       count(*) as thigh_frames_paired
from (
  select least(
           (select extract(epoch from t.recorded_at - s.recorded_at) * 1000
              from public.session_frames s
             where s.session_id = t.session_id and s.imu ->> 'role' = 'shank' and s.recorded_at <= t.recorded_at
             order by s.recorded_at desc limit 1),
           (select extract(epoch from s.recorded_at - t.recorded_at) * 1000
              from public.session_frames s
             where s.session_id = t.session_id and s.imu ->> 'role' = 'shank' and s.recorded_at >= t.recorded_at
             order by s.recorded_at limit 1)
         ) as skew_ms
  from public.session_frames t
  where t.session_id = '<session id>' and t.imu ->> 'role' = 'thigh'
) pairs;
```

Battery, rate checks and reconnects per sensor, as the app recorded them at start and at finish:

```sql
select r.role,
       s.device_info -> 'roles' -> r.role -> 'battery' as battery_at_start,
       s.summary -> 'sensors' -> r.role -> 'battery_end' as battery_at_finish,
       s.summary -> 'sensors' -> r.role -> 'requested_hz' as requested_hz,
       s.summary -> 'sensors' -> r.role -> 'rate_history' as rate_checks,
       s.summary -> 'sensors' -> r.role -> 'reconnects' as reconnects
from public.sessions s
cross join (values ('thigh'), ('shank'), ('foot')) as r(role)
where s.id = '<session id>';
```

Range of each Euler axis per role (a sensor sitting near ±180° shows a range close to 360; read that axis's raw
values before drawing a conclusion):

```sql
select imu ->> 'role' as role,
       round((max((imu -> 'euler_deg' ->> 0)::float8) - min((imu -> 'euler_deg' ->> 0)::float8))::numeric, 1) as roll_range_deg,
       round((max((imu -> 'euler_deg' ->> 1)::float8) - min((imu -> 'euler_deg' ->> 1)::float8))::numeric, 1) as pitch_range_deg,
       round((max((imu -> 'euler_deg' ->> 2)::float8) - min((imu -> 'euler_deg' ->> 2)::float8))::numeric, 1) as yaw_range_deg
from public.session_frames
where session_id = '<session id>' and jsonb_typeof(imu -> 'euler_deg') = 'array'
group by 1
order by 1;
```
