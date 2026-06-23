"""SMPL kinematics for the AMASS virtual-IMU engine — with a graceful mock fallback.

AMASS stores motion as SMPL(-H) per-joint axis-angle. To synthesize a virtual IMU we need two
things from the body model:

  1. the **kinematic tree** (each joint's parent), and
  2. the **rest-pose joint offsets** (child position relative to parent in the T-pose).

The licensed SMPL body models (``*.pkl`` from smpl.is.tue.mpg.de) provide ``betas``-driven exact
joints. Those weights are **not redistributable** and our download was blocked, so this module
ships a **mock skeleton**: the published SMPL kinematic tree plus a fixed, anthropometrically
plausible set of rest offsets. With it:

  * joint **orientations** (hence the gyroscope) are **exact** — they come from the pose params
    alone via forward kinematics and do not depend on the body model at all;
  * joint **positions** (hence the accelerometer's specific force) are **approximate** — they use
    the mock rest offsets instead of the subject's betas-driven bone lengths.

``SmplSkeleton.from_model_or_mock(path)`` is the single plug-in point: drop a real SMPL ``.pkl``
at ``data/raw/smpl/`` and exact offsets are used automatically; otherwise the mock is returned with
a one-line warning and **nothing crashes**. This keeps the whole AMASS pipeline runnable today.
"""

from __future__ import annotations

import logging
import pickle
from dataclasses import dataclass
from pathlib import Path

import numpy as np

logger = logging.getLogger("mova.synth.smpl")

# SMPL 22-body-joint kinematic tree (parent index per joint; -1 = root/pelvis).
SMPL_PARENTS: tuple[int, ...] = (
    -1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19,
)

# Mock rest-pose offsets (meters, child relative to parent). Coarse but anatomically plausible;
# the licensed SMPL model replaces these with betas-driven joints for metric accuracy.
MOCK_OFFSETS: np.ndarray = np.array(
    [
        [0.00, 0.00, 0.00],    # 0  pelvis (root)
        [0.06, -0.09, 0.00],   # 1  l_hip
        [-0.06, -0.09, 0.00],  # 2  r_hip
        [0.00, 0.12, -0.01],   # 3  spine1
        [0.00, -0.38, 0.00],   # 4  l_knee
        [0.00, -0.38, 0.00],   # 5  r_knee
        [0.00, 0.14, 0.00],    # 6  spine2
        [0.00, -0.40, -0.02],  # 7  l_ankle
        [0.00, -0.40, -0.02],  # 8  r_ankle
        [0.00, 0.06, 0.00],    # 9  spine3
        [0.00, -0.06, 0.12],   # 10 l_foot
        [0.00, -0.06, 0.12],   # 11 r_foot
        [0.00, 0.21, 0.00],    # 12 neck
        [0.08, 0.11, 0.00],    # 13 l_collar
        [-0.08, 0.11, 0.00],   # 14 r_collar
        [0.00, 0.09, 0.00],    # 15 head
        [0.11, 0.05, 0.00],    # 16 l_shoulder
        [-0.11, 0.05, 0.00],   # 17 r_shoulder
        [0.26, 0.00, 0.00],    # 18 l_elbow
        [-0.26, 0.00, 0.00],   # 19 r_elbow
        [0.25, 0.00, 0.00],    # 20 l_wrist
        [-0.25, 0.00, 0.00],   # 21 r_wrist
    ],
    dtype=np.float64,
)

N_BODY_JOINTS = 22
DEFAULT_MODEL_DIR = Path("data/raw/smpl")


@dataclass
class SmplSkeleton:
    """Kinematic tree + rest offsets for SMPL forward kinematics.

    ``is_mock`` records whether the offsets are the built-in approximation (True) or came from a
    licensed SMPL body model (False). Downstream code stamps this onto provenance so synthetic
    accelerometers are never silently mistaken for metric-accurate.
    """

    parents: tuple[int, ...]
    offsets: np.ndarray
    is_mock: bool
    source: str

    @classmethod
    def mock(cls) -> SmplSkeleton:
        return cls(
            parents=SMPL_PARENTS,
            offsets=MOCK_OFFSETS.copy(),
            is_mock=True,
            source="mock-skeleton (licensed SMPL .pkl absent)",
        )

    @classmethod
    def from_model_or_mock(cls, model_path: Path | str | None = None) -> SmplSkeleton:
        """Load real SMPL rest joints if a body-model ``.pkl`` is available; else return the mock.

        Never raises: a missing/unreadable model degrades to the mock with a warning, so the
        AMASS pipeline keeps running. Accepts a file or a directory (first ``*.pkl`` is used).
        """
        path = Path(model_path) if model_path is not None else DEFAULT_MODEL_DIR
        pkl = _first_pickle(path)
        if pkl is None:
            logger.warning(
                "SMPL body model not found at %s — using mock skeleton "
                "(gyro exact from pose; accel approximate). Drop a licensed SMPL .pkl there "
                "for metric-accurate joints.",
                path,
            )
            return cls.mock()
        try:
            parents, offsets = _rest_skeleton_from_pkl(pkl)
            logger.info("loaded SMPL rest skeleton from %s (exact offsets)", pkl)
            return cls(parents=parents, offsets=offsets, is_mock=False, source=f"smpl:{pkl.name}")
        except Exception as exc:
            logger.warning("failed to parse SMPL model %s (%s) — using mock skeleton", pkl, exc)
            return cls.mock()

    def forward_kinematics(
        self, poses: np.ndarray, trans: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray]:
        """Axis-angle pose ``[T,J,3]`` + root ``trans[T,3]`` -> (R_global[T,J,3,3], pos[T,J,3]).

        Global joint orientations are exact (pose-only); positions use this skeleton's offsets.
        """
        from mova.synth.rotations import axis_angle_to_matrix

        j = len(self.parents)
        poses = np.asarray(poses, dtype=np.float64)[:, :j, :]
        trans = np.asarray(trans, dtype=np.float64)
        t = poses.shape[0]
        r_local = axis_angle_to_matrix(poses)  # [T,J,3,3]
        r_global = np.zeros_like(r_local)
        pos = np.zeros((t, j, 3), dtype=np.float64)
        r_global[:, 0] = r_local[:, 0]
        pos[:, 0] = trans
        for joint in range(1, j):
            p = self.parents[joint]
            r_global[:, joint] = np.einsum("tij,tjk->tik", r_global[:, p], r_local[:, joint])
            pos[:, joint] = pos[:, p] + np.einsum("tij,j->ti", r_global[:, p], self.offsets[joint])
        return r_global, pos


def _first_pickle(path: Path) -> Path | None:
    if path.is_file() and path.suffix == ".pkl":
        return path
    if path.is_dir():
        pkls = sorted(path.glob("*.pkl"))
        return pkls[0] if pkls else None
    return None


def _rest_skeleton_from_pkl(pkl: Path) -> tuple[tuple[int, ...], np.ndarray]:
    """Extract (parents, child-relative rest offsets) from a standard SMPL model pickle."""
    with pkl.open("rb") as fh:
        model = pickle.load(fh, encoding="latin1")
    kintree = np.asarray(model["kintree_table"])  # [2, 24]
    parents_full = kintree[0].astype(int)
    parents_full[parents_full == parents_full[0]] = -1  # root's parent sentinel -> -1
    if "J" in model:
        joints = np.asarray(model["J"], dtype=np.float64)  # [24, 3] rest joints
    else:
        v_template = np.asarray(model["v_template"], dtype=np.float64)
        j_regressor = np.asarray(model["J_regressor"].todense(), dtype=np.float64)
        joints = j_regressor @ v_template
    parents = parents_full[:N_BODY_JOINTS]
    offsets = np.zeros((N_BODY_JOINTS, 3), dtype=np.float64)
    for j in range(1, N_BODY_JOINTS):
        offsets[j] = joints[j] - joints[parents[j]]
    return tuple(int(p) for p in parents), offsets
