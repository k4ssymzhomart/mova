"""Kinematic feature extraction from skeleton sequences.

Turns a ``[T, J, 3]`` joint-position sequence into the movement-quality features the rehab
heads and clinician dashboards consume: per-joint angles + range of motion, smoothness
(log dimensionless jerk), and left/right symmetry. Skeleton-agnostic — joint indices come
from the dataset's joint list (see ``schema.py``).
"""

from __future__ import annotations

import numpy as np

from mova.pose.schema import ANGLE_TRIPLETS, SYMMETRY_PAIRS


def joint_angle_series(pos: np.ndarray, a: int, b: int, c: int) -> np.ndarray:
    """Angle (degrees) at vertex ``b`` between segments b->a and b->c, per frame ``[T]``."""
    v1 = pos[:, a] - pos[:, b]
    v2 = pos[:, c] - pos[:, b]
    n1 = np.linalg.norm(v1, axis=-1)
    n2 = np.linalg.norm(v2, axis=-1)
    denom = np.where((n1 * n2) < 1e-8, 1.0, n1 * n2)
    cos = np.clip(np.einsum("ti,ti->t", v1, v2) / denom, -1.0, 1.0)
    return np.degrees(np.arccos(cos))


def range_of_motion(angles: np.ndarray) -> float:
    """Peak-to-peak angular excursion (degrees)."""
    finite = angles[np.isfinite(angles)]
    return float(finite.max() - finite.min()) if finite.size else 0.0


def log_dimensionless_jerk(pos: np.ndarray, dt: float) -> float:
    """LDLJ smoothness of a single joint trajectory ``[T,3]`` (higher = smoother; <= 0)."""
    t = pos.shape[0]
    if t < 5:
        return 0.0
    vel = np.gradient(pos, dt, axis=0)
    acc = np.gradient(vel, dt, axis=0)
    jerk = np.gradient(acc, dt, axis=0)
    duration = t * dt
    peak_speed = np.linalg.norm(vel, axis=-1).max()
    if peak_speed < 1e-8:
        return 0.0
    integral = np.sum(np.linalg.norm(jerk, axis=-1) ** 2) * dt
    dlj = (duration**3 / peak_speed**2) * integral
    return float(-np.log(max(dlj, 1e-12)))


def symmetry_index(left: np.ndarray, right: np.ndarray) -> float:
    """1 - normalized L/R difference of two angle series (1 = perfectly symmetric)."""
    valid = np.isfinite(left) & np.isfinite(right)
    if valid.sum() < 2:
        return float("nan")
    diff = np.abs(left[valid] - right[valid]).mean()
    scale = (np.abs(left[valid]).mean() + np.abs(right[valid]).mean()) / 2.0
    return float(1.0 - diff / scale) if scale > 1e-8 else float("nan")


def session_features(pos: np.ndarray, joint_names: list[str], dt: float) -> dict:
    """All movement-quality features for one session's ``[T, J, 3]`` skeleton sequence."""
    idx = {name: i for i, name in enumerate(joint_names)}
    angles: dict[str, np.ndarray] = {}
    for name, (a, b, c) in ANGLE_TRIPLETS.items():
        if a in idx and b in idx and c in idx:
            angles[name] = joint_angle_series(pos, idx[a], idx[b], idx[c])

    rom = {name: range_of_motion(series) for name, series in angles.items()}
    smoothness = {
        name: log_dimensionless_jerk(pos[:, idx[name]], dt) for name in idx if name in idx
    }
    symmetry = {}
    for left, right in SYMMETRY_PAIRS:
        if left in angles and right in angles:
            symmetry[f"{left[2:]}"] = symmetry_index(angles[left], angles[right])

    mean_smoothness = float(np.nanmean(list(smoothness.values()))) if smoothness else 0.0
    mean_symmetry = (
        float(np.nanmean([v for v in symmetry.values() if np.isfinite(v)])) if symmetry else float("nan")
    )
    return {
        "n_frames": int(pos.shape[0]),
        "rom_deg": rom,
        "smoothness_ldlj": smoothness,
        "symmetry": symmetry,
        "mean_smoothness": mean_smoothness,
        "mean_symmetry": mean_symmetry,
    }
