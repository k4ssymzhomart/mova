"""AMASS SMPL mocap -> virtual IMU + exact joint angles.

AMASS stores SMPL(-H) pose as per-joint axis-angle. Forward kinematics over the SMPL
kinematic tree gives each joint's *global* orientation (exact, from pose alone), from which
we derive the gyroscope (body-frame angular velocity). Joint *positions* additionally need
rest-pose bone offsets; we use a built-in approximate skeleton (override with the SMPL
J-regressor when the licensed body model is available — the documented plug-in point), then
double-differentiate to get the accelerometer's specific force. Realistic sensor
degradations are layered on top. Joint angles come for free from the pose, at unlimited scale.

This module is format/agnostic of the licensed SMPL weights so it runs on pose params alone;
``offsets`` can be replaced with the exact rest joints for metric-accurate accelerometers.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import polars as pl

from mova.data.adapters._canonical import CANONICAL_COLUMNS
from mova.synth.rotations import angular_velocity, matrix_to_quat, specific_force_body

DATASET = "amass"

# SMPL 22-body-joint kinematic tree (parent index per joint; -1 = root/pelvis).
SMPL_PARENTS: list[int] = [-1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19]

# Approximate rest-pose offsets (meters, child relative to parent). Coarse but plausible;
# replace with betas-driven SMPL joints for metric accuracy.
DEFAULT_OFFSETS: np.ndarray = np.array(
    [
        [0.00, 0.00, 0.00],   # 0 pelvis
        [0.06, -0.09, 0.00],  # 1 l_hip
        [-0.06, -0.09, 0.00],  # 2 r_hip
        [0.00, 0.12, -0.01],  # 3 spine1
        [0.00, -0.38, 0.00],  # 4 l_knee
        [0.00, -0.38, 0.00],  # 5 r_knee
        [0.00, 0.14, 0.00],   # 6 spine2
        [0.00, -0.40, -0.02],  # 7 l_ankle
        [0.00, -0.40, -0.02],  # 8 r_ankle
        [0.00, 0.06, 0.00],   # 9 spine3
        [0.00, -0.06, 0.12],  # 10 l_foot
        [0.00, -0.06, 0.12],  # 11 r_foot
        [0.00, 0.21, 0.00],   # 12 neck
        [0.08, 0.11, 0.00],   # 13 l_collar
        [-0.08, 0.11, 0.00],  # 14 r_collar
        [0.00, 0.09, 0.00],   # 15 head
        [0.11, 0.05, 0.00],   # 16 l_shoulder
        [-0.11, 0.05, 0.00],  # 17 r_shoulder
        [0.26, 0.00, 0.00],   # 18 l_elbow
        [-0.26, 0.00, 0.00],  # 19 r_elbow
        [0.25, 0.00, 0.00],   # 20 l_wrist
        [-0.25, 0.00, 0.00],  # 21 r_wrist
    ],
    dtype=np.float64,
)

# Virtual-IMU placement -> SMPL joint index (segment whose rigid motion the sensor follows).
PLACEMENT_JOINTS: dict[str, int] = {
    "pelvis": 0, "sternum": 9, "head": 15,
    "l_wrist": 20, "r_wrist": 21, "l_shank": 4, "r_shank": 5,
}

_G_TO_MS2 = 9.80665


@dataclass
class Degradations:
    """Realistic IMU sensor-degradation knobs (seeded; all default-light)."""

    acc_noise_g: float = 0.01
    gyr_noise: float = 0.01           # rad/s
    acc_axis_bias_g: float = 0.02
    gyr_drift: float = 0.002          # rad/s per sample random walk
    dropout_prob: float = 0.0
    enabled: bool = True
    placements: list[str] = field(default_factory=lambda: list(PLACEMENT_JOINTS))


def forward_kinematics(
    poses: np.ndarray, trans: np.ndarray, offsets: np.ndarray = DEFAULT_OFFSETS
) -> tuple[np.ndarray, np.ndarray]:
    """SMPL axis-angle pose ``[T,22,3]`` + root trans ``[T,3]`` -> (R_global[T,22,3,3], pos[T,22,3])."""
    from mova.synth.rotations import axis_angle_to_matrix

    t = poses.shape[0]
    r_local = axis_angle_to_matrix(poses)  # [T,22,3,3]
    r_global = np.zeros_like(r_local)
    pos = np.zeros((t, 22, 3), dtype=np.float64)
    r_global[:, 0] = r_local[:, 0]
    pos[:, 0] = trans
    for j in range(1, 22):
        p = SMPL_PARENTS[j]
        r_global[:, j] = np.einsum("tij,tjk->tik", r_global[:, p], r_local[:, j])
        pos[:, j] = pos[:, p] + np.einsum("tij,j->ti", r_global[:, p], offsets[j])
    return r_global, pos


def joint_angles_deg(poses: np.ndarray) -> np.ndarray:
    """Per-joint local rotation magnitude in degrees ``[T,22]`` (exact from pose)."""
    return np.degrees(np.linalg.norm(poses, axis=-1))


def _apply_degradations(acc: np.ndarray, gyr: np.ndarray, deg: Degradations, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    if not deg.enabled:
        return acc, gyr
    acc = acc + rng.normal(0, deg.acc_axis_bias_g * _G_TO_MS2, size=(1, 3))
    acc = acc + rng.normal(0, deg.acc_noise_g * _G_TO_MS2, size=acc.shape)
    gyr = gyr + np.cumsum(rng.normal(0, deg.gyr_drift, size=gyr.shape), axis=0)
    gyr = gyr + rng.normal(0, deg.gyr_noise, size=gyr.shape)
    if deg.dropout_prob > 0:
        mask = rng.random(acc.shape[0]) < deg.dropout_prob
        acc[mask] = 0.0
        gyr[mask] = 0.0
    return acc, gyr


def synth_virtual_imu(
    poses: np.ndarray,
    trans: np.ndarray,
    framerate: float,
    subject_id: str,
    session_id: str,
    deg: Degradations | None = None,
    seed: int = 1337,
    offsets: np.ndarray = DEFAULT_OFFSETS,
) -> pl.DataFrame:
    """SMPL motion -> canonical virtual-IMU records (modality=imu) for each placement."""
    deg = deg or Degradations()
    rng = np.random.default_rng(seed)
    poses = np.asarray(poses, dtype=np.float64)[:, :22, :]
    trans = np.asarray(trans, dtype=np.float64)
    dt = 1.0 / float(framerate)
    r_global, pos = forward_kinematics(poses, trans, offsets)
    t = np.arange(poses.shape[0], dtype=np.float64) * dt

    frames: list[pl.DataFrame] = []
    for placement in deg.placements:
        j = PLACEMENT_JOINTS[placement]
        r_seq = r_global[:, j]
        gyr = angular_velocity(r_seq, dt)
        acc_ms2 = specific_force_body(pos[:, j], r_seq, dt)  # m/s^2, body frame
        acc_ms2, gyr = _apply_degradations(acc_ms2, gyr, deg, rng)
        acc_g = acc_ms2 / _G_TO_MS2
        quat = matrix_to_quat(r_seq)
        frames.append(
            pl.DataFrame(
                {
                    "t": t,
                    "ax": acc_g[:, 0].astype(np.float32),
                    "ay": acc_g[:, 1].astype(np.float32),
                    "az": acc_g[:, 2].astype(np.float32),
                    "gx": gyr[:, 0].astype(np.float32),
                    "gy": gyr[:, 1].astype(np.float32),
                    "gz": gyr[:, 2].astype(np.float32),
                    "qw": quat[:, 0].astype(np.float32),
                    "qx": quat[:, 1].astype(np.float32),
                    "qy": quat[:, 2].astype(np.float32),
                    "qz": quat[:, 3].astype(np.float32),
                }
            ).with_columns(
                pl.lit(None, dtype=pl.Float32).alias("mx"),
                pl.lit(None, dtype=pl.Float32).alias("my"),
                pl.lit(None, dtype=pl.Float32).alias("mz"),
                pl.lit("imu").alias("modality"),
                pl.lit(subject_id).alias("subject_id"),
                pl.lit(session_id).alias("session_id"),
                pl.lit(f"virtual_{placement}").alias("device_id"),
                pl.lit(placement).alias("placement"),
                pl.lit(float(framerate), dtype=pl.Float32).alias("rate_hz"),
                pl.lit("amass_virtual").alias("make_model"),
                pl.lit(DATASET).alias("dataset"),
                pl.lit(None, dtype=pl.Utf8).alias("activity"),
                pl.lit(None, dtype=pl.Utf8).alias("activity_canonical"),
                pl.lit(None, dtype=pl.Int8).alias("fog_label"),
            )
        )
    return pl.concat(frames, how="vertical").select(CANONICAL_COLUMNS)


def load_amass_npz(path: str) -> dict:
    """Read an AMASS .npz -> {poses[T,156], trans[T,3], betas, framerate}."""
    raw = np.load(path, allow_pickle=True)
    poses = np.asarray(raw["poses"], dtype=np.float64).reshape(len(raw["poses"]), -1, 3)
    trans = np.asarray(raw.get("trans", np.zeros((poses.shape[0], 3))), dtype=np.float64)
    framerate = float(raw["mocap_framerate"]) if "mocap_framerate" in raw else 60.0
    return {"poses": poses, "trans": trans, "framerate": framerate}
