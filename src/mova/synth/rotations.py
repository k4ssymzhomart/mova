"""Vectorized rotation math for deriving IMU signals from orientation/pose.

Used by the DIP-IMU adapter (orientation sequence -> gyro) and the AMASS virtual-IMU
generator (SMPL axis-angle pose -> joint orientations -> gyro + accel). Pure numpy.

Conventions: rotation matrices are world-from-body (a body-frame vector v maps to world as
``R @ v``); quaternions are ``(w, x, y, z)``; the accelerometer reads *specific force*
(proper acceleration + gravity reaction), expressed in the sensor's body frame.
"""

from __future__ import annotations

import numpy as np

GRAVITY = 9.80665  # m/s^2
_EPS = 1e-8


def axis_angle_to_matrix(aa: np.ndarray) -> np.ndarray:
    """Rodrigues: axis-angle ``[..., 3]`` -> rotation matrix ``[..., 3, 3]``."""
    aa = np.asarray(aa, dtype=np.float64)
    theta = np.linalg.norm(aa, axis=-1, keepdims=True)
    safe = np.where(theta < _EPS, 1.0, theta)
    axis = aa / safe
    x, y, z = axis[..., 0], axis[..., 1], axis[..., 2]
    c = np.cos(theta)[..., 0]
    s = np.sin(theta)[..., 0]
    C = 1.0 - c
    R = np.empty((*aa.shape[:-1], 3, 3), dtype=np.float64)
    R[..., 0, 0] = c + x * x * C
    R[..., 0, 1] = x * y * C - z * s
    R[..., 0, 2] = x * z * C + y * s
    R[..., 1, 0] = y * x * C + z * s
    R[..., 1, 1] = c + y * y * C
    R[..., 1, 2] = y * z * C - x * s
    R[..., 2, 0] = z * x * C - y * s
    R[..., 2, 1] = z * y * C + x * s
    R[..., 2, 2] = c + z * z * C
    small = (theta[..., 0] < _EPS)
    if np.any(small):
        R[small] = np.eye(3)
    return R


def matrix_to_quat(R: np.ndarray) -> np.ndarray:
    """Rotation matrix ``[..., 3, 3]`` -> unit quaternion ``[..., 4]`` (w, x, y, z)."""
    R = np.asarray(R, dtype=np.float64)

    def e(i: int, j: int) -> np.ndarray:
        return R[..., i, j]

    tr = e(0, 0) + e(1, 1) + e(2, 2)
    w = np.sqrt(np.maximum(0.0, 1.0 + tr)) / 2.0
    x = np.sqrt(np.maximum(0.0, 1.0 + e(0, 0) - e(1, 1) - e(2, 2))) / 2.0
    y = np.sqrt(np.maximum(0.0, 1.0 - e(0, 0) + e(1, 1) - e(2, 2))) / 2.0
    z = np.sqrt(np.maximum(0.0, 1.0 - e(0, 0) - e(1, 1) + e(2, 2))) / 2.0
    x = np.copysign(x, e(2, 1) - e(1, 2))
    y = np.copysign(y, e(0, 2) - e(2, 0))
    z = np.copysign(z, e(1, 0) - e(0, 1))
    q = np.stack([w, x, y, z], axis=-1)
    return q / np.maximum(np.linalg.norm(q, axis=-1, keepdims=True), _EPS)


def angular_velocity(R: np.ndarray, dt: float) -> np.ndarray:
    """Body-frame angular velocity (rad/s) from an orientation sequence ``R[T,3,3]``.

    omega_body[t] is the log-map of ``R_t^T @ R_{t+1}`` divided by dt — i.e. what a gyroscope
    rigidly attached to the body would integrate.
    """
    R = np.asarray(R, dtype=np.float64)
    n = R.shape[0]
    out = np.zeros((n, 3), dtype=np.float64)
    if n < 2:
        return out
    rel = np.einsum("tij,tjk->tik", np.transpose(R[:-1], (0, 2, 1)), R[1:])
    cos = np.clip((np.trace(rel, axis1=1, axis2=2) - 1.0) / 2.0, -1.0, 1.0)
    angle = np.arccos(cos)
    vec = np.stack(
        [rel[:, 2, 1] - rel[:, 1, 2], rel[:, 0, 2] - rel[:, 2, 0], rel[:, 1, 0] - rel[:, 0, 1]],
        axis=-1,
    )
    norm = np.linalg.norm(vec, axis=-1, keepdims=True)
    axis = vec / np.where(norm < _EPS, 1.0, norm)
    out[:-1] = axis * angle[:, None] / dt
    out[-1] = out[-2]
    return out


def specific_force_body(pos: np.ndarray, R: np.ndarray, dt: float, up_axis: int = 2) -> np.ndarray:
    """Accelerometer reading (m/s^2) in the body frame from world position + orientation.

    Specific force = world linear acceleration + gravity reaction, rotated into the body
    frame: ``a_body = R^T @ (d2x/dt2 + g)``.
    """
    pos = np.asarray(pos, dtype=np.float64)
    R = np.asarray(R, dtype=np.float64)
    n = pos.shape[0]
    a_world = np.zeros((n, 3), dtype=np.float64)
    if n >= 3:
        a_world[1:-1] = (pos[2:] - 2.0 * pos[1:-1] + pos[:-2]) / (dt * dt)
        a_world[0] = a_world[1]
        a_world[-1] = a_world[-2]
    g = np.zeros(3)
    g[up_axis] = GRAVITY
    total = a_world + g
    return np.einsum("tji,tj->ti", R, total)  # R^T @ total
