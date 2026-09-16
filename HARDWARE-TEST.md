# Heel Slide — hardware test protocol

~45 minutes. Needs three sensors, a charged phone or laptop, and a leg.

**Browser: Chrome or Edge on desktop or Android.** Web Bluetooth does not exist in Safari
or on iOS — don't waste time discovering that on the day.

Before you start: physically label the three sensors 1 / 2 / 3, write down each MAC, and
record which role each is bound to. Everything below depends on knowing which is which.

---

## Test 1 — does the rate write actually work

**This is the test. Everything else is downstream of it.** The entire premise of issue #18
is that the sensors were never told to go faster than their 10 Hz factory default.

1. Connect **one** sensor.
2. Send unlock: `FF AA 69 88 B5` to the write characteristic `0000ffe9-…-00805f9a34fb`.
3. Send rate: `FF AA 03 08 00` (50 Hz).
4. Read back: `FF AA 27 03 00`. The sensor should answer with a `55 71` register frame.
5. Count notifications over **30 seconds**.

| Result | Meaning |
|---|---|
| **~1500 frames (≈50 Hz)** | The premise holds. Everything in #18 is unblocked. |
| **~300 frames (≈10 Hz)** | The write didn't take. Try `0x09` for 100 Hz; check the unlock byte order; confirm you're writing to `ffe9` and not `ffe4`. |
| **Still 10 Hz after all that** | **Stop and tell me immediately.** It changes #18, #17 and the scoring plan, and the whole 15 → 8 Hz threshold decision has to be revisited rather than reversed. |

Record the actual number. Not "it worked" — the number.

## Test 2 — three sensors at once

1. All three connected, streaming, **60 seconds**.
2. Count frames per sensor. Compute Hz for each.
3. Compare against Test 1's single-sensor rate — note any drop. Three concurrent BLE links
   on one adapter is where congestion shows up.
4. Record the inter-sensor timestamp skew.

The spec says the device supports up to four concurrent links, so three should hold. Whether
it holds *at 50 Hz* is the open question.

## Test 3 — the rep counter, on a real leg

Strap thigh / shank / foot per the diagram. Lie down.

1. **Ten deliberate heel slides**, counting out loud. Does the app say 10?
2. **Ten fast ones.** Still 10?
3. **Five partial slides** — half range only. These should **not** count. If they do,
   `min_valid_excursion` (22.5°) isn't being applied.
4. Watch the live guide while you move. Does it track the leg, or does it jump?

**A sudden ~360° jump is the ±180° wrap bug.** It's supposedly fixed on this branch; this is
where you find out. Note the leg position when it happens.

## Test 4 — the honest failure modes

These matter more than the happy path, because they're what a patient will actually hit.

1. **Pull one sensor off mid-set.** Does the app pause and say which sensor, or does it keep
   counting and lie?
2. **Walk out of range and come back.** Does it reconnect without losing the session?
3. **Turn off wifi mid-set, do three reps, turn it back on.** Do those three frames land?
   The batching buffer is supposed to hold them.

## Test 5 — battery

Note the starting percentage, run 20 minutes at the chosen rate, note the end. Extrapolate.
The datasheet claims ~10 hours at the 10 Hz default; at 50 Hz expect materially less, and a
patient needs it to survive a session without hunting for a charger.

## Also, while you have them in your hand

**Read the model number off the physical label.** "WT901BLE68" appears in no WitMotion
catalogue. The datasheet that matches the observed frame format is the **WT901BLECL**, which
is **9-axis** — it has a magnetometer. The НТЗ is written throughout around "3 × 6-axis =
18 channels," so if the label says BLECL that's a correction the spec needs.

---

## What to bring back

- The frame counts from Tests 1 and 2. Numbers, not impressions.
- Whether the rep counter hit 10/10, and whether partials counted.
- A short video of the ten-rep test — this is what you show Жанель апай.
- The model number on the label.
- Anything that jumped, dropped, or lied.

Put it in the PR as a comment. It's the evidence #18 has been waiting for since the start.

---

## Running it with `feat/heel-slide`

The app does the byte-level work in Test 1 for you: connecting a sensor writes the unlock and rate commands to
`ffe9` and reads the rate back from the sensor's `0x55 0x71` reply. You read the numbers off the screen.

**Setup (laptop, Chrome or Edge; `localhost` counts as a secure context, so Web Bluetooth works there):**

```bash
git fetch origin && git checkout feat/heel-slide
cd services/frontend && npm ci
# get services/frontend/.env.local from Kassymzhomart (Supabase keys + test account passwords; never commit it)
npx next dev
```

1. Open `http://localhost:3000/signin` and use **«Вход для тестовых аккаунтов»** with `heel-slide-patient@mova.test`.
2. Open `http://localhost:3000/app/session/new/dd6e686a-5946-42d2-bd82-ec94f60f49a9` (the seeded Heel Slide
   prescription). For the 100 Hz run add `?rate=100`.
3. **Power on one sensor at a time** when you press «Подключить» for a role. All three sensors probably advertise the
   same name, so Chrome's device list cannot tell them apart. The browser never shows a MAC: read it from the label
   or a BLE scanner app such as nRF Connect.
4. Open **«Технические данные»** under the sensors. It shows, per sensor: «Ответ датчика о частоте» (the readback and
   the code the sensor returned), «Фактическая частота (за 2 с)», **«Кадров за последние 30 с»**, «Кадров за
   последние 60 с», battery voltage from register `0x64` (the percent next to it is WitMotion's own table), and
   reconnects.

**Test 1** — step 4 with one sensor; wait 30 s and write down «Кадров за последние 30 с» and the readback line.
**Test 2** — all three connected, 60 s, «Кадров за последние 60 с» per sensor. The browser only sees when each
notification *arrives*, so it cannot measure one link's latency; the clinician view's skew block shows gaps between
the thigh and shank streams, not latency. Record frame counts first; treat skew as secondary.
**Test 3** — press «Далее», then «Начать» on the exercise screen, and follow the protocol. This creates one session for
the test patient on the production database, which is expected. Two limits to know before judging the result:
the 22.5° minimum is a knee angle applied to an uncalibrated sensor reading, so whether a half-range slide counts
depends on how the sensors sit (calibration is #17); and a session that starts with the knee bent counts wrongly.
**Test 4** — the app pauses the count and names the sensor when a thigh or shank sensor *stops sending* (switched off
or out of range), and reconnects to the same sensor on its own for up to two minutes. A sensor taken off the leg
but still switched on is **not** detected. Run and report both.
**Test 5** — read the voltage in «Технические данные» at the start and after 20 minutes.

Post the numbers as a comment on PR #26: https://github.com/k4ssymzhomart/mova/pull/26
