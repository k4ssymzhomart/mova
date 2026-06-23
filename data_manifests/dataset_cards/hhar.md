# Dataset card — HHAR (Heterogeneity Activity Recognition)

**Role:** cross-device generalization showcase · **Task:** HAR · **Modality:** IMU (acc + gyro)

| | |
|---|---|
| Access | Public — [UCI 344](https://archive.ics.uci.edu/dataset/344/heterogeneity+activity+recognition) |
| Subjects | 9 (a–i) | 
| Devices | multiple phone + watch models (the device-heterogeneity axis) |
| Native rate | variable ~50–200 Hz (device-dependent) |
| Native format | CSV: `Index, Arrival_Time, Creation_Time, x, y, z, User, Model, Device, gt` |

## Canonical mapping
- acc m/s² → g (×0.10197); gyro rad/s unchanged. Phones → `waist`, watches → `wrist`.
- acc/gyro arrive as separate streams/clocks → each resampled to 50 Hz then stacked (sub-second
  cross-modality alignment; documented limitation in `preprocess/align.py`).
- Activities mapped to the canonical vocabulary (`stand→standing`, `walk→walking`, …).

## Splits / eval axis
Subject-disjoint per dataset. **Cross-device** is the headline generalization axis (train on a
subset of device models, test on held-out models) — layered at eval time, not in the base split.

## Known limitations
Corrupt `Creation_Time` on some devices → adapter falls back to `Arrival_Time`. No magnetometer.

`format_verified_against_real_data: true` (original three adapters validated on real downloads).
