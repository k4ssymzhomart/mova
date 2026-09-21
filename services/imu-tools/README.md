# mova IMU tools

Capture, rig diagnostics and offline movement analysis for the WT901BLE68 sensors.
Ported from PHOENIX (`feat/llm-feedback-two-tier`, `1480ab0`), mostly Nurzhan's (@Nurzhan06) work —
see [`VENDORED.md`](VENDORED.md) for what came from where and what is not to be edited here.

**Technical, non-clinical.** Nothing in this package is a clinical measurement or a diagnosis, and
nothing it prints may be shown to a patient or a clinician as a score. Read the table below before
using any number out of it.

## What is real, and what is labelled

| What it says | What it actually is |
|---|---|
| "angle", degrees | A **relative device-orientation proxy**: `wrap(shank.pitch − thigh.pitch)` for the knee, one segment's own pitch for a leg lift, foot−shank for the ankle. Not an anatomical joint angle, not calibrated to physical units. mova's own `lib/motion/flexion.ts` carries the same warning about the same quantity. |
| rep count | A hysteresis counter over that proxy, with per-exercise thresholds. Reliable enough to check a recording against what you actually did; it is not a clinical adherence record. |
| Execution Score | `0.50·Correctness + 0.20·Volume + 0.30·Target`, an **engineering** number from `analysis/execution_score.py`. It may appear in this package's output and in the localhost dev-tools page, and nowhere else. It must not reach `services/frontend`, `session_metrics` or any clinician screen. |
| rep-quality `bad` / `mediocre` / `good` | KNN labels against a reference set someone built by hand. PHOENIX's own words: engineering labels, not a clinically approved quality definition. Shadow only. No reference set ships, so this abstains until you build one. |
| `validation_status: unverified_checksum` | Literal. The WT901BLE68 frame shape carries no checksum field, so no packet from this hardware can be treated as verified. |
| signal quality `LOW` / `scoring_permitted: false` | The gate saying the data is not good enough to score. When it says no, the number next to it is not trustworthy — that is the point of it. |
| `SIMULATED SENSORS` | The frames came from a simulator or from mova's development simulation, not from a person. Every tool prints this when it is true. |

Two things follow from that table and are worth stating plainly:

- **The angle convention already matches mova's.** PHOENIX's pinned knee signal is shank-minus-thigh
  on pitch; mova's `flexion.ts` is `wrap(shank.pitch − thigh.pitch)` on the same axis index. They are
  the same quantity, so running with a profile reproduces the signal mova's live counter and the
  clinician recount already use. Nothing here introduces a second, different proxy — please do not
  "fix" it into one.
- **The zero is where they differ.** PHOENIX takes its rest level from the leading stay-still run of
  the whole take; mova re-zeroes on every start and counts each start on its own zero. That is why
  `frames_to_capture.py` splits per start, and why merging warns.

## Install

```bash
py -m pip install -e services/imu-tools            # numpy only
py -m pip install -e "services/imu-tools[ble]"     # adds bleak, for real sensors
```

On Windows, set `PYTHONIOENCODING=utf-8` or the degree signs come out mangled in the console.

## Without any hardware

Everything below runs with no sensors at all, which is the normal case for most people here.

```bash
# the rig self-test, against a simulated rig
py services/imu-tools/tools/selftest_imu.py --simulate
py services/imu-tools/tools/selftest_imu.py --simulate --swap thigh=shank   # must FAIL

# the browser dev tools: one page over all of it
py services/imu-tools/devtools/imu_devtools.py        # http://127.0.0.1:8765
#   Sensors  -> Simulator, or Replay an existing capture
#   Live     -> angle, rep count, Execution Score, signal-quality gate
#   Record   -> runs tools/capture_wt901ble68.py, scores the result
#   Captures -> re-analyse with tunable thresholds
#   Labels   -> label reps, build the KNN reference
```

## Analysing a real mova session

mova records in the browser and writes `session_frames` rows. Export them (Supabase SQL editor, a
local `supabase`, any read-only dump) and convert once:

```sql
select recorded_at, seq, imu, quality
from public.session_frames
where session_id = '<id>'
order by recorded_at, seq;
```

```bash
py services/imu-tools/tools/frames_to_capture.py frames.json --out captures/mova-<session>.jsonl
```

That one conversion makes every other tool work on real mova data unchanged:

```bash
py tools/analyze_capture.py captures/mova-<session>-start1.jsonl --expect-motion
py tools/tune_reps.py       --file captures/mova-<session>-start1.jsonl --expected 10
py tools/check_execution_score.py --file captures/mova-<session>-start1.jsonl \
        --exercise exercise-heel-slide-v1 --prescribed 6
py tools/check_rep_quality.py --file captures/mova-<session>-start1.jsonl \
        --exercise exercise-heel-slide-v1        # abstains until a reference set exists
```

`tune_reps.py --file` also reads a `session_frames` export directly, without converting.

**The check worth running.** Open the same session in the clinician view and compare its recount with
`tune_reps`, per start. They should agree. If they do not, that is a finding about the baseline
difference above — write it down rather than picking whichever number you prefer.

### What the converter refuses

A `clinician_session_result` payload. That RPC returns only `[[t_ms, pitch_deg]]` for thigh and
shank — one Euler component, no roll, no yaw, no accelerometer, no gyroscope, and foot only as a
count. Rep segmentation and signal quality both need what is missing, and zero-padding it would
produce something shaped like a measurement that is not one. Export the raw rows instead.

## With hardware

```bash
py tools/scan_wt901ble68.py --seconds 8              # power sensors on one at a time
py tools/inspect_gatt.py <ADDRESS>
py tools/listen_raw_multi.py --seconds 20 --sensor thigh=<A> --sensor shank=<B> --sensor foot=<C>
py tools/capture_wt901ble68.py --seconds 60 --output captures/take.jsonl \
        --sensor thigh=<A> --sensor shank=<B> --sensor foot=<C>
py tools/selftest_imu.py --sensor thigh=<A> --sensor shank=<B> --sensor foot=<C>
py tools/analyze_capture.py captures/*.jsonl --expect-motion
```

Roles are always mapped explicitly; nothing infers a physical role from discovery order. Use
`--expect-motion` on exercise recordings so a sensor that never moved fails instead of reading as a
valid still capture. Exit codes: 0 pass/warn, 1 fail, 2 could not connect — so a script can gate on
them.

`captures/` is gitignored. A capture is a recording of a person moving: it stays on the machine that
made it, and no patient identifier goes in a filename or in the file.

## Exercise ids

Three id spaces exist and none is derived from another —
[`exercise_ids.json`](exercise_ids.json) is the table, `mova_imu.exercises.ids` reads it, and
`services/frontend/src/lib/exercises/ids.ts` mirrors it under a test that fails on drift.

| space | example | home |
|---|---|---|
| catalog (canonical) | `heel-slide` | `lib/exercises/catalog.ts`, `public.exercises` |
| scoring | `heel_slide` | the `ExerciseSlug` union in `lib/scoring/types.ts` |
| phoenix | `exercise-heel-slide-v1` | `SIGNAL_PROFILES`, what this package is keyed on |

A lookup with no row raises and lists what it knows. Nothing guesses by replacing `-` with `_`:
that guess is how this repo ended up with two heel slides.

## Tests

```bash
py -m unittest discover -s services/imu-tools/tests    # no plugins needed
pytest services/imu-tools/tests                        # needs the package installed
```
