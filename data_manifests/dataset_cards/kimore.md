# Dataset card — KIMORE

**Role:** rehab exercises with clinician quality scores · **Task:** movement quality · **Modality:** pose (Kinect skeleton)

| | |
|---|---|
| Access | Free academic request — [KIMORE](https://vrai.dii.univpm.it/content/kimore-dataset) |
| Subjects | healthy controls (CG) + motor-impaired (GPP: stroke / Parkinson's / low-back-pain) |
| Exercises | 5 (lifting arms, lateral trunk tilt, trunk rotation, pelvis rotation, squatting) |
| Skeleton | Kinect v2, 25 joints (x, y, z [, confidence]) |
| Native rate | ~30 Hz |
| Native format | `JointPosition*.csv` (frame × 25·k) under `.../{CG,GPP}/Es#/Subject#/` |

## Canonical mapping
- Parsed to long-format pose Parquet (`pose.io`, `dataset/subject_id/session_id` partitions): first 3
  values per joint → (x, y, z); a 4th → tracking confidence. Exercise + cohort inferred from the path.
- Clinician scores (cTS/PO) carried as `quality_score`.

## Features (`mova.pose.features`)
Per-session: joint angles + ROM (elbow/knee/shoulder), smoothness (log dimensionless jerk), left/right
symmetry → `data/processed/pose/pose_features.parquet`.

## Splits / eval axis
Subject-disjoint + **LOSO** (`splits/loso/kimore.json`). Target: correlation ≥ 0.7 with clinician scores.

`format_verified_against_real_data: false` — confirm the JointPosition column width on first `dvc pull`.
