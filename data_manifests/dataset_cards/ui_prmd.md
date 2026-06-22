# Dataset card — UI-PRMD

**Role:** physical-rehab movements with correct/incorrect executions · **Task:** movement quality · **Modality:** pose (skeleton)

| | |
|---|---|
| Access | Public — [UI-PRMD](https://webpages.uidaho.edu/ui-prmd/) |
| Movements | 10 rehabilitation movements |
| Skeleton | 22 joints (Vicon/Kinect), positions (+ angles) |
| Native rate | ~30 Hz |
| Native format | `*_positions.txt` (frame × 22·3) under `Correct/` and `Incorrect/` |

## Canonical mapping
- Parsed to long-format pose Parquet. Movement id + subject inferred from the filename; the
  `Correct`/`Incorrect` folder → `correct` label (1/0).

## Features (`mova.pose.features`)
Per-session joint angles + ROM, smoothness (LDLJ), symmetry → `pose_features.parquet`. The
correct-vs-incorrect label supports a supervised movement-quality classifier and threshold tuning.

## Splits / eval axis
Subject-disjoint + **LOSO** (`splits/loso/ui_prmd.json`).

## Known limitations
Scripted correct/incorrect executions (not free-living); small subject count → LOSO.

`format_verified_against_real_data: false` — confirm the positions column order on first `dvc pull`.
