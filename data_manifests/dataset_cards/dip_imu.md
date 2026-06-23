# Dataset card — DIP-IMU

**Role:** real sparse-IMU + SMPL pose; canonical sparse-IMU pose benchmark · **Task:** pose · **Modality:** IMU (acc + orientation → derived gyro + quat)

| | |
|---|---|
| Access | License (MPI) — register at [dip.is.tue.mpg.de](https://dip.is.tue.mpg.de/) |
| Subjects | 10 (S01–S10) · ~330k frames |
| Sensors | 17 Xsens IMUs; sparse-6 subset for sparse-IMU pose |
| Native rate | 60 Hz |
| Native format | `.pkl`: `imu_acc[T,17,3]` (m/s²), `imu_ori[T,17,3,3]`, `gt[T,72]` (SMPL pose) |

## Canonical mapping
- acc m/s² → g (×0.10197). **Gyro is derived** from the orientation sequence (body-frame angular
  velocity, `synth.rotations.angular_velocity`) and the orientation carried as a quaternion → DIP
  becomes a true 6-channel `modality=imu` dataset. Sensor index → ontology; sparse-6 = head, l/r
  forearm, l/r shank, pelvis. All-NaN sensors (unused in a take) are skipped.
- SMPL `gt` pose → joint-angle labels via the pose pipeline.

## Splits / eval axis
Subject-disjoint + LOSO. **Sparse-sensor ablation** (1/2/3/6 IMUs) and **sim-to-real** (AMASS→DIP).

## Known limitations
Gyro is reconstructed (not measured) — high-frequency content limited by the 60 Hz orientation. Licensed.

`format_verified_against_real_data: false` — confirm pickle keys/orientation convention on first `dvc pull`.
