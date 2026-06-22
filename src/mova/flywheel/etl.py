"""Flywheel ETL: session pose+IMU -> virtual IMU -> gated candidate shards.

Each gamified session yields synchronized pose (derived keypoints) + optional real IMU.
This ETL turns the session pose into *virtual IMU* at standard placements (segment
orientation -> gyro; segment position -> accel), writes candidate shards, and records a
gate decision. The gate (Part 1.4.6) only admits synthesized data that does not hurt
held-out validation — the moat is additive and quality-controlled, never blindly mixed.

The model-in-the-loop evaluation arrives in Phase 3; here the gate is wired with a pluggable
``evaluate_fn`` and records ADMIT/REJECT/PENDING so the contract and plumbing are real now.

Session record (npz, the Phase-1 session_frames contract):
    pose [T, J, 3] (derived keypoints — never raw video), framerate (float),
    subject_id, session_id, optional imu [T, 6].

Run:
    python -m mova.flywheel.etl --sessions data/sessions --out data/processed/flywheel
"""

from __future__ import annotations

import argparse
import json
import logging
from collections.abc import Callable
from pathlib import Path

import numpy as np

from mova.pose.schema import KINECT25
from mova.synth.rotations import angular_velocity, specific_force_body

logger = logging.getLogger("mova.flywheel.etl")

_G_TO_MS2 = 9.80665

# placement -> (proximal_joint, distal_joint) defining the segment the virtual sensor rides.
DEFAULT_BONE_MAP: dict[str, tuple[str, str]] = {
    "l_forearm": ("l_elbow", "l_wrist"),
    "r_forearm": ("r_elbow", "r_wrist"),
    "l_shank": ("l_knee", "l_ankle"),
    "r_shank": ("r_knee", "r_ankle"),
    "pelvis": ("l_hip", "r_hip"),
}


def segment_frames(p_prox: np.ndarray, p_dist: np.ndarray) -> np.ndarray:
    """Orthonormal world-from-body frames ``[T,3,3]`` for a bone (x-axis along prox->dist)."""
    t = p_prox.shape[0]
    x = p_dist - p_prox
    x = x / np.clip(np.linalg.norm(x, axis=-1, keepdims=True), 1e-8, None)
    world_up = np.array([0.0, 1.0, 0.0])
    up = np.broadcast_to(world_up, (t, 3))
    y = up - np.einsum("ti,i->t", x, world_up)[:, None] * x
    ny = np.linalg.norm(y, axis=-1, keepdims=True)
    y = np.where(ny < 1e-6, np.array([1.0, 0.0, 0.0]), y / np.clip(ny, 1e-8, None))
    z = np.cross(x, y)
    return np.stack([x, y, z], axis=-1)


def pose_to_virtual_imu(
    pose: np.ndarray, joint_names: list[str], dt: float, bone_map: dict[str, tuple[str, str]]
) -> dict[str, np.ndarray]:
    """``pose[T,J,3]`` -> {placement: ``[T,6]`` acc(g)+gyro(rad/s)} virtual IMU."""
    idx = {n: i for i, n in enumerate(joint_names)}
    out: dict[str, np.ndarray] = {}
    for placement, (prox, dist) in bone_map.items():
        if prox not in idx or dist not in idx:
            continue
        p_prox, p_dist = pose[:, idx[prox]], pose[:, idx[dist]]
        frames = segment_frames(p_prox, p_dist)
        mid = (p_prox + p_dist) / 2.0
        gyr = angular_velocity(frames, dt)
        acc = specific_force_body(mid, frames, dt) / _G_TO_MS2
        out[placement] = np.concatenate([acc, gyr], axis=1).astype(np.float32)
    return out


def gate(val_delta: float | None, min_gain: float) -> str:
    """Admission decision: ADMIT if validation improves by >= min_gain, else REJECT/PENDING."""
    if val_delta is None:
        return "PENDING"  # no model yet (Phase 3 supplies evaluate_fn)
    return "ADMIT" if val_delta >= min_gain else "REJECT"


class FlywheelETL:
    def __init__(
        self,
        sessions_dir: Path,
        out_dir: Path,
        min_val_gain: float = 0.0,
        evaluate_fn: Callable[[np.ndarray], float] | None = None,
        bone_map: dict[str, tuple[str, str]] | None = None,
    ) -> None:
        self.sessions_dir = sessions_dir
        self.out_dir = out_dir
        self.min_val_gain = min_val_gain
        self.evaluate_fn = evaluate_fn
        self.bone_map = bone_map or DEFAULT_BONE_MAP

    def run(self) -> dict:
        if not self.sessions_dir.is_dir():
            raise FileNotFoundError(f"sessions dir not found: {self.sessions_dir}")
        files = sorted(self.sessions_dir.rglob("*.npz"))
        self.out_dir.mkdir(parents=True, exist_ok=True)

        records = []
        for path in files:
            data = np.load(path, allow_pickle=True)
            pose = np.asarray(data["pose"], dtype=np.float64)
            joint_names = list(data["joint_names"]) if "joint_names" in data else KINECT25
            framerate = float(data["framerate"]) if "framerate" in data else 30.0
            session_id = str(data["session_id"]) if "session_id" in data else path.stem
            if pose.shape[0] < 3:
                continue
            vimu = pose_to_virtual_imu(pose, joint_names, 1.0 / framerate, self.bone_map)
            if not vimu:
                continue
            stacked = {f"vimu_{k}": v for k, v in vimu.items()}
            np.savez(self.out_dir / f"candidate_{session_id}.npz", **stacked)
            val_delta = self.evaluate_fn(next(iter(vimu.values()))) if self.evaluate_fn else None
            decision = gate(val_delta, self.min_val_gain)
            records.append(
                {
                    "session_id": session_id,
                    "placements": sorted(vimu),
                    "frames": int(pose.shape[0]),
                    "val_delta": val_delta,
                    "decision": decision,
                }
            )
            logger.info("%s -> virtual IMU %s | gate=%s", session_id, sorted(vimu), decision)

        manifest = {
            "min_val_gain": self.min_val_gain,
            "n_sessions": len(records),
            "admitted": sum(r["decision"] == "ADMIT" for r in records),
            "pending": sum(r["decision"] == "PENDING" for r in records),
            "rejected": sum(r["decision"] == "REJECT" for r in records),
            "records": records,
        }
        (self.out_dir / "flywheel_manifest.json").write_text(json.dumps(manifest, indent=2))
        logger.info("flywheel ETL done: %d sessions (%d admitted, %d pending)",
                    manifest["n_sessions"], manifest["admitted"], manifest["pending"])
        return manifest


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Flywheel ETL: session pose -> gated virtual IMU")
    p.add_argument("--sessions", type=Path, default=Path("data/sessions"))
    p.add_argument("--out", type=Path, default=Path("data/processed/flywheel"))
    p.add_argument("--min-val-gain", type=float, default=0.0)
    p.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    FlywheelETL(args.sessions, args.out, min_val_gain=args.min_val_gain).run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
