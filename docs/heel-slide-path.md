# Heel Slide, end to end

Runbook for the one exercise that goes all the way through with real sensors: a patient opens the app, sees
Heel Slide on Today, straps on three WT901BLE68 sensors, does ten repetitions while the rep count and the live
leg move, answers the check-in, and a clinician opens that session.

Seven links, each of which has to work on real hardware:

| # | Link | Where it lives |
|---|---|---|
| 1 | A prescription exists | `services/frontend/scripts/seed-heel-slide.mjs` (no builder UI, by design) |
| 2 | Today lists it with «Начать» | `src/app/(app)/app/page.tsx` (unchanged) |
| 3 | Three sensors, each bound explicitly to thigh / shank / foot | `src/lib/ble/liveSensors.ts`, `patient_ble_devices` (0023) |
| 4 | Sample rate written to `ffe9`, read back, delivered rate measured | `src/lib/ble/sampleRate.ts`, `witRegister.ts` |
| 5 | Frames reach Postgres batched and idempotent | `src/lib/telemetry/buffer.ts` → `flush_session_telemetry_batch` (0021) |
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
| Sample rate | 50 Hz is requested (code `0x08`) every session and register `0x03` is read back. "Confirmed" means the read-back code equals the request, nothing more. The delivered rate is measured from received frames and is the figure to trust. |
| Rep count | Real output of the hysteresis counter over the flexion proxy. The clinician view recounts from the stored frames and shows the on-device count separately when the two differ. |
| Flexion proxy | `wrap(shank.pitch − thigh.pitch)`, zeroed on the first ~500 ms and oriented so the larger excursion is positive. It is a relative device-orientation difference, **not knee flexion**, not calibrated, and not used for any score. The patient sees no number; the clinician chart labels it as such. `FLEXION_GAIN` from Phoenix is not ported. |
| Live leg drawing | Follows the proxy, clamped to 0–120 for drawing only, with a caption saying it is not a measurement. |
| Score, target | None computed. The `target` in the exercise config (`knee_flexion_deg ≥ 90`) is draft engineering config and is not evaluated anywhere. |
| Check-in | Real patient answers, stored once. No triage is derived from them on this path. |
| Device model | Shown as `WT901BLE68 (unverified)` until the label and datasheet are checked (§7). |
| Battery | Unknown. The frame carries none and no read path exists; the UI says so. |
| Device identity | The browser's Bluetooth `device.id` plus the advertised name. Web Bluetooth never exposes the MAC address. |
| Signal quality | Evaluated at most once per second and stored; not enforced. |
| Catalog row | `heel-slide` is `is_published = false`, `approval_state: "draft"`. |
| Accounts | Test data in an isolated clinic, `heel-slide-test`. |

## 2. Apply the migrations

Hosted project `sbdtujkpklqyevaoxfph` had 0001–0022 applied as of 2026-09-15. This path needs two more, in order:

1. `supabase/migrations/0023_patient_ble_devices.sql` (from #25): per-patient role ↔ device binding.
2. `supabase/migrations/0034_heel_slide_path.sql`:
   - adds `knee_flexion_extension` to `public.exercise_modality`;
   - creates `public.session_check_ins` (RLS on, select through `app.can_access_patient`, no client writes, audited);
   - creates `app.can_review_patient(uuid)`: platform admin, an active clinician with an active
     `care_team_link`, or the patient's `clinic_admin`. Never clinic-membership equality;
   - creates the RPCs `start_prescribed_session`, `submit_session_check_in`, `clinician_patient_sessions`,
     `clinician_session_result` (signatures in the migration; anon cannot execute them).

0034 is numbered above #24's 0023–0033. #24 (tenancy fix) and #25 both ship a `0023_*` file; that collision is
resolved in those PRs. Once #24's 0024–0033 are merged after 0034 is on the remote, `supabase db push` will
need `--include-all`.

### Dry run first (nothing is committed)

Run both migrations and the database test in one transaction that ends in `rollback`:

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

A good run returns 44 `ok N - …` lines and `1..44`. Any failure comes back as an error naming the check.

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
       to_regprocedure('public.clinician_session_result(uuid)') as clinician_result;
```

## 3. Database test

`supabase/tests/heel_slide_path_test.sql` needs 0034 applied (or the dry-run wrapper above). It creates its own
clinics, users, patients, clinicians, program and prescriptions, impersonates each user with
`set local role authenticated` and `request.jwt.claims`, and always ends in `rollback`. It does not use pgTAP
(the hosted project does not have it): each check raises on failure, and the final select prints TAP lines, so
`pg_prove` can read it too.

It checks, among 44 assertions: a patient starts a session only from their own active prescription in an active
program; telemetry stores and re-sends idempotently; check-in is refused before the session is completed, every
field is validated, `none` is stripped, the note is trimmed, a second submit returns the stored row unchanged;
no direct insert / update / delete on `session_check_ins`; anon cannot execute the RPCs; the clinician RPCs
return null for the patient, a same-clinic clinician without a link, an inactive link and another clinic's
admin, and the full result (session, config, dose, check-in, per-role `[t_ms, pitch]` series) for a linked
clinician and the patient's clinic admin.

## 4. Seed the test clinic

`services/frontend/scripts/seed-heel-slide.mjs` uses the service role and is idempotent: it looks each row up,
creates what is missing and updates only fields that differ. It writes:

- `exercises` `heel-slide`: name `Heel Slide` (catalog names are shown verbatim), modality
  `knee_flexion_extension`, `target_joints '{}'`, unpublished, `default_dose {"reps": 10}`, the draft
  `exercise_config/heel_slide_path.v1` in `scoring_rubric`;
- `clinics` `heel-slide-test` ("Heel Slide test clinic", `Asia/Almaty`);
- a patient and a clinician account (email confirmed), their profiles moved into that clinic with the right role;
- `patients` (mrn `TEST-HEEL-SLIDE`, `affected_side` from `HEEL_SLIDE_SIDE`), `clinicians`, an active
  `care_team_links` row;
- an active program (the patient's newest active one is reused) and an active Heel Slide prescription,
  `dose {"reps": 10}`, prescribed by the clinician.

### Environment

Read from the process environment first, then `services/frontend/.env.local`.

| Variable | Needed | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | always | already in `.env.local` |
| `HEEL_SLIDE_PATIENT_EMAIL` | optional | default `heel-slide-patient@mova.test` |
| `HEEL_SLIDE_CLINICIAN_EMAIL` | optional | default `heel-slide-clinician@mova.test` |
| `HEEL_SLIDE_PATIENT_PASSWORD` | when the patient account is created | never printed |
| `HEEL_SLIDE_CLINICIAN_PASSWORD` | when the clinician account is created | never printed |
| `HEEL_SLIDE_SIDE` | optional | `right` (default) or `left` |

**Use mailboxes you can open.** `/signin` offers Google and an email magic link; there is no password form in the
UI. The default `@mova.test` addresses cannot receive a magic link, so for a hardware session set both emails to
real addresses the testers control. Signing in with Google under the same address lands in the same confirmed
account. The passwords then only matter for API-level checks.

`HEEL_SLIDE_SIDE` is stored in `patients.affected_side` and is used only to pick the lateralized binding role
(`r_thigh`, `r_shank`, …) in `patient_ble_devices`. The patient shell does not show it as the operated knee.

### Run

```bash
cd services/frontend
npm run seed:heel-slide -- --dry-run          # or: node scripts/seed-heel-slide.mjs --dry-run
HEEL_SLIDE_PATIENT_EMAIL=… HEEL_SLIDE_CLINICIAN_EMAIL=… \
HEEL_SLIDE_PATIENT_PASSWORD=… HEEL_SLIDE_CLINICIAN_PASSWORD=… \
npm run seed:heel-slide
```

The dry run reads only and prints the plan plus any unmet preconditions (missing migrations, a missing password).
The real run checks the same preconditions before its first write and stops with "Nothing was written" if one
fails. An address that already belongs to an account outside the test clinic is refused unless
`--adopt-existing` is passed, so a typo cannot move a real patient. Output is ids, emails and two routes:
`/app/session/new/<prescriptionId>` and `/clinician/patient/<patientId>`.

## 5. Hardware walk-through

Before starting: a Chromium browser that has Web Bluetooth (§6), the app over HTTPS or on `http://localhost`, three
charged sensors with their labels readable, and a bed or mat.

1. **Today.** Sign in as the test patient. `/app` lists **Heel Slide** with «Начать».
2. **Sensors** (`/app/session/new/<prescriptionId>`). Press «Подключить» on the thigh row and pick that sensor in
   Chrome's chooser by its name, then shank, then foot. Each row shows the device name, the rate result
   ("50 Гц подтверждено датчиком" or not confirmed with the reason) and the delivered Hz. A device already bound to
   another role is refused. «Далее» unlocks once all three are streaming; an unconfirmed rate does not block.
3. **Start.** «Далее» calls `start_prescribed_session` with the device descriptors and opens
   `/app/session/<id>/exercise`. The calibrate step is not on this path.
4. **Mount, lie down, «Начать».** Strap each sensor to its segment of the operated leg. Which way each one faces is
   not fixed yet; record it (§7, moving axis). Lie with the leg straight, press «Начать» and keep the leg still
   through the three-second countdown and the half second after it: recording starts when the countdown ends, and
   that first half second is the baseline for both the live count and the clinician recount.
5. **Ten heel slides.** Slide the heel toward the buttock and back. The `N / 10` counter and the phase text update,
   the leg drawing follows, and the saving line shows frames sent and pending. If a sensor drops, the connect panel
   appears in place; a drop before the baseline is taken sends you back to «Начать».
6. **Finish.** «Завершить» (or «Закончить раньше») flushes the remaining frames, completes the session and opens
   the check-in.
7. **Check-in** (`/app/session/<id>/check-in`). Pain before and after, difficulty, how the knee feels (required),
   new symptoms. Submitting opens the summary.
8. **Clinician.** Sign in as the test clinician, open `/clinician`, then the test patient
   (`/clinician/patient/<patientId>`). The Heel Slide section shows reps recounted from stored frames against the
   target, the relative-orientation chart with its caption, per-role frame counts, delivered Hz, the rate
   confirmation, pairing skew, and the check-in answers. `?session=<id>` selects an older session.

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
- A full page reload, or leaving the app, drops every GATT connection. Moving between flow steps inside the app
  keeps them. After a reload the exercise step shows the connect panel again.
- GATT writes to a device are serialized and spaced about 150 ms apart, as in the WitMotion SDK.
- Rate codes: `FF AA 03 08 00` is 50 Hz and `FF AA 03 09 00` is 100 Hz; the WitMotion SDK table and issue #18
  agree on those two. They disagree on lower and higher codes (`0x06` is 10 Hz in one, 20 Hz in the other; 200 Hz
  is `0x0B` versus `0x0A`), so those are not used. The save command `FF AA 00 00 00` is never sent: the rate is
  set each session, which avoids flash wear.
- Keep the tab visible during a session. Behaviour in a background tab has not been measured.

## 7. Hardware checklist for @Nurzhan06

Record results in the issue with the date, browser and OS, and the physical label of each sensor.

- [ ] **Delivered rate at 50 Hz, all three connected.** Per sensor, for a run of at least two minutes: the delivered
      Hz shown on the connect panel, and the figure from stored frames (query below).
- [ ] **Delivered rate at 100 Hz, all three connected.** The app requests 50 Hz. For this run set
      `TARGET_SAMPLE_RATE_HZ` in `src/lib/ble/sampleRate.ts` to 100 on a local build (do not commit it) and repeat
      the measurement. Note
      whether register `0x03` reads back `0x09`.
- [ ] **Per-sensor packet loss.** `1 − frames ÷ (seconds × requested Hz)` per role, and the largest gap, at both
      rates.
- [ ] **Inter-sensor skew.** Median and max thigh ↔ shank pairing skew (query below, also shown in the clinician
      view). These are receive times, so the figure includes BLE jitter.
- [ ] **Model number.** What the label on each unit says, compared with the WT901BLECL datasheet (9-axis). Until
      this is confirmed the app says `WT901BLE68 (unverified)`.
- [ ] **Battery life at the chosen rate.** From full charge to the first disconnect, streaming continuously with
      all three connected. The frame carries no battery level, so this has to be timed.
- [ ] **MAC ↔ advertised name, per label.** Read each unit's MAC and advertised name with a BLE scanner app (for
      example nRF Connect) and write down the pair next to the physical label. Web Bluetooth only ever shows the
      name.
- [ ] **Moving axis on the real mounting.** During heel slides, which Euler axis actually changes on the thigh and
      shank sensors (query below). The path assumes pitch (`euler_deg[1]`); Phoenix's live guide found roll moving
      on its mounting. If roll moves here, reps will not count: report it with the mounting photo rather than
      changing code on the spot.

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
