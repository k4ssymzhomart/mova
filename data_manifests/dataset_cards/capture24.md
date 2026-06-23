# Dataset card — CAPTURE-24

**Role:** large real free-living corpus for SSL pretraining · **Task:** SSL (+ coarse HAR) · **Modality:** IMU (wrist accelerometer)

| | |
|---|---|
| Access | Free academic registration — [Oxford ORA](https://ora.ox.ac.uk/objects/uuid:99d7c092-d865-4a19-b096-cc16440cd001) |
| Subjects | 151 participants · ~3,883 hours |
| Sensor | Axivity AX3, dominant wrist |
| Native rate | 100 Hz |
| Native format | per-participant `P001.csv.gz`: `time, x, y, z, annotation` (accel already in g) |

## Canonical mapping
- accel already in g (×1.0); no gyro/mag → gyro zero-filled at windowing. Placement `wrist`.
- `time` parsed from ISO-8601 (or seconds) → per-session seconds.
- coarse camera-derived `annotation` carried as `activity`, best-effort canonical map
  (`sleep→lying`, `bicycling→cycling`, …). Treated primarily as **unlabeled SSL fuel**.

## Splits / eval axis
Subject-disjoint. Primary use is self-supervised pretraining of the encoder on all windows
(masked + contrastive), then fine-tune the clinical heads.

## Known limitations
Wrist-only, accelerometer-only; annotation is coarse and not the focus. Very large — fetch via DVC.

`format_verified_against_real_data: false` — confirm the CSV column layout/units on first `dvc pull`.
