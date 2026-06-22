"""Virtual-IMU synthesis engine — one entry point for both synthesis paths.

Two sources of synthetic IMU feed the data flywheel and the sim-to-real study:

  * **AMASS / SMPL pose** (offline, large scale): axis-angle body pose -> forward kinematics ->
    per-placement gyro (exact) + accel (approximate under the mock skeleton). Uses
    :class:`mova.synth.smpl.SmplSkeleton` — the same SMPL mock the AMASS adapter uses, so a
    licensed ``.pkl`` later upgrades every path at once.
  * **Session keypoints** (online, from each gamified session): markerless-pose joint positions ->
    segment frames -> gyro + accel. This is the flywheel source (never raw video).

The engine wraps both behind ``from_amass`` / ``from_session_pose`` and shares one degradation model
and placement set, so downstream code (pretraining augmentation, fusion training, the flywheel gate)
does not care which source produced a window.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import polars as pl

from mova.flywheel.etl import DEFAULT_BONE_MAP, pose_to_virtual_imu
from mova.synth.amass import Degradations, load_amass_npz, synth_virtual_imu
from mova.synth.smpl import SmplSkeleton


class VirtualImuEngine:
    """Synthesize canonical virtual-IMU windows from SMPL pose or session keypoints."""

    def __init__(
        self,
        skeleton: SmplSkeleton | None = None,
        degradations: Degradations | None = None,
        smpl_model: Path | str | None = None,
    ) -> None:
        # Same plug-in point as the AMASS adapter: real SMPL .pkl if present, else mock.
        self.skeleton = skeleton or SmplSkeleton.from_model_or_mock(smpl_model)
        self.degradations = degradations or Degradations()

    @property
    def uses_mock_skeleton(self) -> bool:
        return self.skeleton.is_mock

    def from_amass(self, npz_path: str | Path, subject_id: str, session_id: str, seed: int = 1337) -> pl.DataFrame:
        """AMASS ``.npz`` -> canonical virtual-IMU DataFrame (modality=imu) via SMPL FK."""
        data = load_amass_npz(str(npz_path))
        return synth_virtual_imu(
            data["poses"], data["trans"], data["framerate"],
            subject_id=subject_id, session_id=session_id, deg=self.degradations, seed=seed,
            skeleton=self.skeleton,
        )

    def from_pose(
        self, poses: np.ndarray, trans: np.ndarray, framerate: float,
        subject_id: str, session_id: str, seed: int = 1337,
    ) -> pl.DataFrame:
        """In-memory SMPL pose arrays -> canonical virtual-IMU DataFrame."""
        return synth_virtual_imu(
            poses, trans, framerate, subject_id=subject_id, session_id=session_id,
            deg=self.degradations, seed=seed, skeleton=self.skeleton,
        )

    @staticmethod
    def from_session_pose(
        pose: np.ndarray, joint_names: list[str], framerate: float,
        bone_map: dict[str, tuple[str, str]] | None = None,
    ) -> dict[str, np.ndarray]:
        """Session markerless keypoints ``[T,J,3]`` -> {placement: ``[T,6]``} virtual IMU.

        This is the flywheel path: segment frames from joint positions, no body model needed.
        """
        return pose_to_virtual_imu(
            pose, joint_names, 1.0 / float(framerate), bone_map or DEFAULT_BONE_MAP
        )
