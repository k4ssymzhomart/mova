# Dataset card — AMASS (virtual IMU)

**Role:** SMPL mocap → virtual IMU with exact joint angles at unlimited scale · **Task:** synthetic IMU + pose · **Modality:** virtual IMU (acc+gyro+quat) + exact angles

| | |
|---|---|
| Access | License (MPI) — register at [amass.is.tue.mpg.de](https://amass.is.tue.mpg.de/) |
| Content | 300+ subjects, 40+ hours of optical mocap unified on SMPL |
| Native rate | per-file `mocap_framerate` (typically 60–120 Hz) |
| Native format | `.npz`: `poses[T,156]` (SMPL-H axis-angle), `trans[T,3]`, `betas`, `mocap_framerate` |

## Virtual-IMU generation (`mova.synth.amass`)
- **Forward kinematics** over the SMPL 22-joint tree gives each joint's global orientation (exact from
  pose). **Gyro** = body-frame angular velocity of that orientation. **Accel** = double-differentiated
  joint position + gravity, rotated into the body frame.
- Joint positions use a built-in approximate rest skeleton; **exact accelerometers need the betas-driven
  SMPL joints** (the documented plug-in point — supply the licensed J-regressor).
- Realistic **degradations**: axis bias, gyro drift, gravity leakage, noise, dropout (seeded).
- Placements: pelvis, l/r wrist, l/r shank, head, sternum. **Exact joint angles** via `joint_angles_deg`.

## Splits / eval axis
The synthetic stream flows through the same preprocess → window pipeline (`dataset=amass`). Primary use:
SSL pretraining fuel + dense joint-angle supervision; **sim-to-real** measured on TotalCapture/DIP.

## Known limitations
Accelerometer fidelity bounded by the approximate skeleton until the SMPL mesh is wired in. Sim-to-real
gap is a first-class research question (Part 1.4). Licensed.

`format_verified_against_real_data: false` — gyro is exact-from-pose; accel is approximate pending SMPL joints.
