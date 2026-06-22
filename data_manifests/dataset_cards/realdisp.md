# Dataset card — REALDISP

**Role:** cross-position generalization showcase · **Task:** HAR / movement quality · **Modality:** IMU (acc+gyro+mag+quat)

| | |
|---|---|
| Access | Public — [UCI 305](https://archive.ics.uci.edu/dataset/305/realdisp+activity+recognition+dataset) |
| Subjects | 17 · 33 activities |
| Sensors | 9 sites × 13 channels (acc, gyro, mag, quaternion) |
| Scenarios | **ideal / self / mutual** placement (the displacement axis) |
| Native rate | 50 Hz (already canonical) |
| Native format | tab `.log`: `ts_s, ts_us, [9×13 sensors], label` |

## Canonical mapping
- acc m/s² → g; gyro rad/s; quaternion carried through. Sensor sites → ontology (`RLA→r_forearm`, …).
- `modality=imu` (acc+gyro synchronized in one row).

## Splits / eval axis
Subject-disjoint per dataset. **Cross-position** is the headline axis: train on `ideal`, test on
`self`/`mutual` to prove placement invariance — layered at eval time.

## Known limitations
Magnetometer not unit-harmonized across datasets (kept nullable). Mutual displacement is adversarial
by design (sensors placed by a second person).

`format_verified_against_real_data: true`
