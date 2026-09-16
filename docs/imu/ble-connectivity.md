# Real BLE sensor connectivity

Production-oriented design for pairing and streaming real WT901BLE68 IMUs from the browser,
replacing the camera-derived virtual IMU as the live measurement source. Covers what's built,
what's deliberately stubbed pending another issue's data, and what's out of scope here.

---

## 1. Platform constraint: Chrome/Android only for this pilot

Web Bluetooth does not exist on Safari or iOS ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)).
For this pilot, real-sensor pairing works only in Chrome/Edge on desktop or Android, over HTTPS
(or `http://localhost` for local dev — Chrome's one exception). `/devices` and the pairing UI
say so explicitly rather than failing silently; [DevicesClient.tsx](../../services/frontend/src/app/(app)/devices/DevicesClient.tsx)
shows a dedicated unsupported-browser state instead of a broken scan button.

Two other options were considered and rejected for this pilot (not forever): a native/Flutter
patient app, and keeping a small device-gateway box in the patient's home (Phoenix's approach).
Both are real production paths if the pilot needs to grow past Chrome/Android patients; neither
is built here.

## 2. Frame format — ported, not reimplemented

[wt901ble68.ts](../../services/frontend/src/lib/ble/wt901ble68.ts) is a verbatim port of Phoenix's
BLE client (`packages/ui/src/ble/wt901ble68.ts` in that repo), confirmed against real WT901BLE68
hardware:

- Service `0000ffe5-0000-1000-8000-00805f9a34fb`, notify characteristic `0000ffe4-...` — note the
  non-standard `9a` base UUID, not the Bluetooth SIG-standard `9b`.
- 20-byte frames, header `0x55 0x61`, nine little-endian `int16` values: accel xyz, gyro xyz, euler
  xyz (euler scaled `raw/32768*180`; accel/gyro left as raw counts — see §3).
- **No checksum exists in this frame shape.** Every parsed frame is tagged `validation_status:
  "unverified_checksum"`.

This is the single source of truth for the frame shape on the browser side. If a second client
(native app, etc.) is ever built, port the test vectors in
[wt901ble68.test.ts](../../services/frontend/src/lib/ble/wt901ble68.test.ts) — including the
real 2026-09-05 hardware capture — rather than re-deriving the parser independently.

## 3. What's deliberately NOT done here: calibration maths

Raw accelerometer/gyroscope values pass through as LSB counts, unconverted, all the way to
`session_frames`. Turning those into physical units (g / °/s) needs a confirmed per-sensor scale
factor — even Phoenix's own packet model leaves that as `float | None` rather than hardcode one,
because the frame shape itself was already wrong once before being corrected against live
hardware. Getting a scale factor wrong silently corrupts every downstream angle/ROM calculation,
so this waits for the calibration-maths issue rather than guessing here.

The sample-rate write path is no longer a stub. [sampleRate.ts](../../services/frontend/src/lib/ble/sampleRate.ts)
writes the WitMotion SDK sequence to `ffe9` (unlock, set return rate, read register `0x03` back from
the `55 71` reply) and reports whether the sensor confirmed it; only 50 Hz (`0x08`) and 100 Hz
(`0x09`) are used, and the save-to-flash command is never sent. The rate actually delivered is
measured per sensor from received frames. Protocol sources and where they disagree:
[heel-slide-path.md §6](../heel-slide-path.md#6-web-bluetooth-constraints). Phoenix has no code here
at all — it only ever records whatever rate the firmware happens to be broadcasting.

## 4. Role assignment and persistence

Each of the three sensors is bound to a role (thigh/shank/foot) **only by explicit patient
choice**, one at a time, gated so role N+1 can't be picked before role N is connected — see
[useSensorConnect.ts](../../services/frontend/src/lib/ble/useSensorConnect.ts). Auto-assigning by
BLE discovery order is explicitly banned (Phoenix's own audit: *"Автоматическое сопоставление
MAC-адресов с ролями небезопасно и в новом gateway запрещено"*), and AC-03 requires the patient
see three separate role statuses before starting.

Pairings persist to `patient_ble_devices` (migration
[0023](../../supabase/migrations/0023_patient_ble_devices.sql)), keyed by the patient's affected
side plus role, reusing the existing lateralized `body_site` enum (`l_thigh`/`r_thigh`/etc.)
rather than introducing a second role vocabulary. This is durable across reloads/browsers and
visible to clinicians, unlike Phoenix's localStorage-only version — Web Bluetooth never exposes a
real MAC address, so `device_id` is a browser-scoped id, stable per (origin, device) but not a
hardware identity.

## 5. Signal quality and inter-sensor sync

[signalQuality.ts](../../services/frontend/src/lib/ble/signalQuality.ts) ports Phoenix's
HIGH/MEDIUM/LOW/INVALID classifier field-for-field (same thresholds, same reason codes), running
client-side here since mova has no live gateway process in this data path. It includes the
Δt_sync = max(t) − min(t) cross-role check from NTZ §10.4. All thresholds — `MIN_SAMPLE_RATE_HZ`,
`MAX_SYNC_SKEW_MS`, `MAX_STATIC_GYROSCOPE_RAW`, etc. — are Phoenix's engineering defaults from a
single 2026-09-05 live 3-sensor capture, **not** clinically validated. `MAX_SYNC_SKEW_MS` in
particular is a placeholder pending the sampling-rate issue's own bench measurement of real
inter-sensor skew.

`/devices` runs this live once all three roles are connected and surfaces the *specific* reason
(`describeSignalQuality` names the actual slow/missing role where the data supports it) rather
than a generic pass/fail, per AC-05/IMU-06-08. `scoring_permitted` is computed and stored
(`session_frames.quality` as a 0/0.2/0.6/1 rollup; the full report under `imu.signal_quality`) but
**not enforced** anywhere yet — wiring that gate into an actual score is the scoring issue's job.

## 6. Ingestion path

Real per-role frames go through the existing [TelemetryBuffer](../../services/frontend/src/lib/telemetry/buffer.ts)
(`useBleSessionRecorder.ts`), sized for 3 sensors × 50 Hz: a flush at 150 queued rows or every
second, at most 600 rows per RPC — this is what avoids Phoenix's
one-fetch-per-BLE-frame pattern (fatal at 3 sensors × 10-50 Hz). A single session-wide sequence
counter, not per-role, keeps `session_frames`'s `(session_id, recorded_at, seq)` primary key
collision-free when two sensors report in the same millisecond.

[DurableQueue](../../services/frontend/src/lib/telemetry/durableQueue.ts) mirrors whatever
TelemetryBuffer still considers undelivered into IndexedDB at most about once a second, plus on
stop and page hide, and `start()` recovers it — so a killed network plus a reloaded tab loses at
most the last second or so of rows that hadn't already reached Postgres. A duplicate resend after recovery is harmless: `flush_session_telemetry_batch` is
idempotent on the same primary key.

## 7. Token model

Phoenix's known weakness is `PHOENIX_GATEWAY_TOKEN` — one static secret compiled into the
browser bundle via `VITE_PHOENIX_GATEWAY_TOKEN`, shared across every patient. **Mova has no
equivalent to fix**, because it has no custom gateway in this path: real IMU frames go through
the already-JWT-authenticated Supabase RPC call `TelemetryBuffer` already used for the camera
pipeline (per-user session token, scoped by RLS via `auth.uid()`), and backend-to-inference calls
already use the HMAC-signed contract in
[contracts/inference/v1/signing.py](../../contracts/inference/v1/signing.py) (per-request
signature + timestamp, secret in the Supabase Vault, never in the repo or a client bundle). This
held true through this whole feature — nothing here introduces a new static or shared credential.
If a live-streaming path is added later (e.g. a WebSocket for sub-2s feedback) that needs a
token, reuse the Supabase JWT or extend the signing scheme; don't invent a bundled secret.

## 8. Escape hatch: none introduced, and mova already discloses simulated mode

Phoenix's Gen-3 patient app has a *"Продолжить без датчиков (демо)"* button on a live route that
reaches the full exercise + feedback flow with zero sensor data. Mova has no equivalent button
anywhere — confirmed by search, not just absence of a PR reference. The closest thing,
`useLiveInference.ts`'s `mockPredict` fallback (used when the ONNX model backend isn't deployed),
is a different and narrower case: it's a model-server-outage fallback, and — unlike Phoenix's
silent bypass — mova already discloses it in the UI (a `simulated` badge plus explanatory text in
[SessionTelemetry.tsx](../../services/frontend/src/components/session/SessionTelemetry.tsx)), so
a patient or clinician can't mistake it for a real reading.

**Important scope note:** the exercise screen (`SessionStudio.tsx`) does not use real BLE sensors
yet — it still runs entirely on the camera-derived virtual IMU built in an earlier phase. Nothing
built across this feature enforces AC-03's "three connected, calibrated, synced sensors before
starting" gate at exercise-start time, because there is no live BLE connection state inside the
exercise screen to gate on. Wiring real sensors into `SessionStudio` — and enforcing that gate —
is the exercise-screen issue's job, not repeated here.

## 9. Deferred to other issues

| Item | Owner |
|---|---|
| `ffe9` sample-rate register write, actual target Hz | sampling-rate issue |
| `MAX_SYNC_SKEW_MS` re-derivation from bench data | sampling-rate issue |
| Raw-count → physical-unit scale factor | calibration-maths issue |
| Wiring real BLE into `SessionStudio`, enforcing the AC-03 pre-exercise gate | exercise-screen issue |
| Enforcing `scoring_permitted` against an actual score | scoring issue |
