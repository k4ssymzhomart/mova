# Dataset card — Daphnet Freezing-of-Gait

**Role:** clinical FoG detection (Parkinson's) · **Task:** FoG · **Modality:** IMU (accelerometer only)

| | |
|---|---|
| Access | Public — [UCI 245](https://archive.ics.uci.edu/dataset/245/daphnet+freezing+of+gait) |
| Subjects | 10 (S01–S10); freezes concentrated in a few |
| Sensors | ankle/shank, thigh, trunk (tri-axial accel, milli-g) |
| Native rate | 64 Hz |
| Native format | whitespace `.txt` per run: `time_ms` + 9 accel axes + `annotation` |

## Canonical mapping
- milli-g → g (×0.001). Raw axes (forward, vertical, lateral) → canonical (ax=forward, ay=lateral,
  az=vertical). No gyro/mag → gyro zero-filled at the windowing stage.
- `annotation` carried as `fog_label` (0 exclude / 1 no-freeze / 2 freeze); label-0 rows kept for SSL,
  dropped for FoG windows (`window.aggregate_fog`).

## Splits / eval axis
**Freeze-stratified, subject-disjoint** — positive (freeze) subjects are spread across train/val/test
so each split contains freezes (else sensitivity/AUROC are unmeasurable). Additionally **LOSO-CV**
(`data_manifests/splits/loso/daphnet_fog.json`) per the metrics doctrine — one subject is not an eval.
Window overlap 75% (stride 50) so short freezes are not missed.

## Known limitations
Accelerometer-only → the gyro half of the 6-channel input is zero. Heavy class imbalance (freezing is
rare). This is the dataset behind the honest baseline (AUROC 0.55, Part 1.4.2).

`format_verified_against_real_data: true`
