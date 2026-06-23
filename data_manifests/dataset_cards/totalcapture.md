# Dataset card — TotalCapture

**Role:** real IMU + Vicon mocap; sim-to-real and joint-angle eval anchor · **Task:** pose · **Modality:** IMU (acc+gyro+mag+quat) + mocap

| | |
|---|---|
| Access | Free academic registration — [CVSSP](https://cvssp.org/data/totalcapture/) |
| Subjects | 5 · multiple actions |
| Sensors | 13 Xsens IMUs + Vicon optical mocap |
| Native rate | 60 Hz (IMU) |
| Native format | whitespace `.sensors`: header `<n_sensors> <n_frames>`, then per-frame `n_sensors×13` (`quat_wxyz, acc, gyro, mag`) |

## Canonical mapping
- acc in g (×1.0); gyro rad/s; quaternion + mag carried through. `modality=imu`.
- Sensor names → ontology (`L_LowArm→l_forearm`, …). Vicon joint angles handled by the pose pipeline.

## Splits / eval axis
Subject-disjoint. Anchors **sim-to-real**: train virtual-IMU on AMASS, test on TotalCapture's real IMU;
and **joint-angle** evaluation against Vicon ground truth.

## Known limitations
Only 5 subjects → use with LOSO and as an eval anchor, not a large training set.

`format_verified_against_real_data: false` — the `.sensors` layout in `canonical.json` is a documented
intermediate; confirm/extend the Xsens parser on first `dvc pull`.
