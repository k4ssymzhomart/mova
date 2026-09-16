# MOVA — submission

## What this is

A rehabilitation platform for patients after primary total knee arthroplasty (TKA), built to a clinical technical
specification (НТЗ, 8,640 words, Russian) written by an orthopaedic surgeon, plus a 2,554-word scoring specification
for eight exercises. It measures knee movement with three wearable IMUs (WitMotion, on the thigh, shank and foot),
connected straight to the browser over Bluetooth.

This submission is one exercise, Heel Slide, working end to end: the patient sees it on Today, connects three
sensors, does ten repetitions while the count and a drawing of the leg follow the movement, answers a check-in, and a
clinician opens that session. Code: `main` (PRs #26 and #27). To run or present it, see "Running it" in the README.

## The engineering finding worth leading with

The project believed its sensors topped out at 10–12 Hz. Two decisions rested on that:

- the signal-quality minimum sample rate was lowered from **15 Hz to 8 Hz** (Phoenix commit `6f9441a`, 2026-09-06);
- the open-problems log wrote off PSD, dominant frequency, SPARC and jerk as unusable, because at 10–20 Hz the Nyquist
  limit is 5–10 Hz.

In WitMotion's protocol the output rate is a register. It has to be unlocked and written through a separate BLE
write characteristic, `0000ffe9-0000-1000-8000-00805f9a34fb`, and read back. No branch of either repository had
ever written to it: on 2026-09-16 `ffe9` appeared in zero files across all ten Phoenix branches and mova's `main`.
The observed 10–12 Hz matches the sensor's documented 10 Hz default, so the sensors were almost certainly never
told to go faster.

This branch writes it (unlock `FF AA 69 88 B5`, rate `FF AA 03 08 00` for 50 Hz) and confirms it from the sensor's
`55 71` register reply. **Whether the sensors then deliver 50 Hz has not been measured yet** — that is Test 1 of
the hardware protocol, and it confirms or kills this claim with a single number.

## What is real

- **Bluetooth client** — the browser connects three sensors, each bound explicitly to thigh, shank or foot.
- **Rate configuration** — the `ffe9` write and the readback above, with the rate the sensor actually delivers shown per sensor.
- **Frame pipeline** — every frame from all three sensors is batched to the database (at most about one request a
  second at 150 frames/s), deduplicated server-side on `(session, time, sequence)`, and kept on the device when
  the network drops until it can be sent.
- **Repetition logic** — the hysteresis counter ported from the earlier Python service, with its ±180° wrap bug fixed
  and a regression test that fails on the old code.
- **Database** — Supabase with row-level security; clinician reads go through an active care-team link. Two live
  holes were found during this work and closed on production: anyone could sign up as an administrator (migration
  `0035`), and any account in the shared self-serve clinic, patients included, could list every patient in it
  through the clinician-portal functions (migration `0036`).
- **Check-in** — pain before and after, difficulty, how the knee feels, new symptoms; every scale starts unanswered.
- **Clinician view** — the session's repetitions recounted on the server from the stored frames, the movement series,
  per-sensor technical data and the check-in answers.
- **Exercise library** — `/exercises` shows the twelve exercises from the НТЗ and the scoring spec, with the
  clinician-recorded reference videos (R-05, НТЗ §9.3) on the 7 exercises a clip is confirmed to show, and a one-minute
  overview at the top. Eight of the twelve have scoring targets; the five with no confirmed clip say the video is
  coming. The catalogue and videos are static files; only a prescribed Heel Slide can be started from the page.

## What is deliberately not claimed

**The app does not show a knee angle in degrees.** There is no validated calibration to an anatomical reference yet.
What the sensors give is a relative device-orientation reading (the difference in pitch between the shank and thigh
sensors). The patient screen shows no number at all; it uses the reading only to count repetitions and to move the
drawing of the leg. The clinician chart plots it labelled as exactly that — not knee flexion, not calibrated, not used
for any score — and no clinical score is computed anywhere.

Calibration and its goniometer validation are the next piece of work. An instrument that refuses to show an
unvalidated number is worth more than one that shows a confident wrong one.

## What has not been verified

- **Nothing has run on physical sensors.** The recorded walkthrough uses a simulated sensor transport that exists
  only in local development. The sensors step, the exercise screen and the clinician view all say «Симуляция» on
  screen, and the session is stored marked as simulated. Everything else in the recording is the real app against
  the real database: sign-in, Today, the session write, 7,419 stored frames, the rep count, the check-in and the
  clinician's server-side recount.
- **Recording:** [`docs/walkthrough/heel-slide-walkthrough-1920.mp4`](docs/walkthrough/heel-slide-walkthrough-1920.mp4)
  (about 2 minutes, 1920×1080): sign-in → Today → sensors → exercise to 10/10 → check-in → summary → clinician view.
  The clinician part was recorded again after a caption fix and spliced after the patient part; nothing else is
  edited. Phone-width (400 px) screenshots of the same screens are in `docs/walkthrough/400px/`; the exercise and
  check-in screens are not among them, because only one session was written.
- The hardware protocol — rate at 50 and 100 Hz, packet loss, battery, the model number on the label, the rep counter
  on a real leg, and the honest failure cases — is written and ready in [`HARDWARE-TEST.md`](HARDWARE-TEST.md).
- Known limits, stated in the runbook: the 22.5° minimum excursion is a knee angle applied to the uncalibrated reading;
  a sensor taken off the leg while still switched on is not detected; browser receive times cannot measure one
  link's latency; Safari and iOS have no Web Bluetooth.

## What is next

1. Calibration to an anatomical knee angle, validated against a goniometer.
2. Wiring the scoring engine for the eight exercises. It is in the branch (`lib/scoring`, 40 tests) but no screen
   uses it yet, so nothing is scored.
3. The clinician prescription builder.
