"""KIMORE -> Mova canonical pose adapter.

KIMORE records Kinect v2 skeletons (25 joints) for 5 rehab exercises across a healthy
control group (CG) and a group with motor impairments (GPP), each with clinician quality
scores. Each ``JointPosition*.csv`` is a frame x (25*k) matrix; we take the first three
values per joint as (x, y, z) and a fourth, if present, as tracking confidence.

Exercise and cohort are inferred from the path (``.../CG/Es1/.../JointPosition.csv``).
Emits long-format canonical pose Parquet consumed by the pose feature pipeline.

Run:
    python -m mova.data.adapters.kimore_adapter --raw-dir data/raw/kimore --out-dir data/interim/pose

Note: layout encoded in canonical.json (``format_verified_against_real_data: false``).
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

import numpy as np

from mova.pose.io import pose_long_df, write_pose_partitioned
from mova.pose.schema import KINECT25

logger = logging.getLogger("mova.adapters.kimore")

DATASET = "kimore"
NATIVE_RATE_HZ = 30.0
N_JOINTS = len(KINECT25)


def _infer_meta(path: Path) -> tuple[str, str, str]:
    """(subject_id, exercise, group) from the KIMORE path."""
    parts = list(path.parts)
    group = next((p for p in parts if p.upper() in ("CG", "GPP")), "unknown")
    exercise = next((p for p in parts if p.lower().startswith("es")), "unknown")
    subject = next((p for p in parts if p.lower().startswith(("subject", "id", "s"))), path.stem)
    return subject, exercise, group


def _process_file(path: Path) -> None | tuple:
    raw = np.loadtxt(path, delimiter=",", ndmin=2)
    if raw.shape[1] < N_JOINTS * 3:
        return None
    k = raw.shape[1] // N_JOINTS  # 3 (xyz) or 4 (xyz + confidence)
    mat = raw[:, : N_JOINTS * k].reshape(raw.shape[0], N_JOINTS, k)
    positions = mat[:, :, :3]
    confidence = mat[:, :, 3] if k >= 4 else None
    return positions, confidence


class KimoreAdapter:
    def __init__(self, raw_dir: Path, out_dir: Path) -> None:
        self.raw_dir = raw_dir
        self.out_dir = out_dir

    def run(self) -> int:
        if not self.raw_dir.is_dir():
            raise FileNotFoundError(f"raw KIMORE dir not found: {self.raw_dir}")
        files = sorted(self.raw_dir.rglob("JointPosition*.csv"))
        if not files:
            raise FileNotFoundError(f"no KIMORE JointPosition*.csv under {self.raw_dir}")
        self.out_dir.mkdir(parents=True, exist_ok=True)

        total = 0
        for path in files:
            parsed = _process_file(path)
            if parsed is None:
                logger.warning("unexpected width, skipping: %s", path)
                continue
            positions, confidence = parsed
            subject, exercise, group = _infer_meta(path)
            session = f"{exercise}_{path.stem}"
            t = np.arange(positions.shape[0], dtype=np.float64) / NATIVE_RATE_HZ
            df = pose_long_df(
                t, positions, KINECT25, subject_id=subject, session_id=session, dataset=DATASET,
                confidence=confidence.ravel() if confidence is not None else None,
                exercise=exercise, group=group,
            )
            write_pose_partitioned(df, self.out_dir, basename=f"kimore-{session.lower()}")
            total += df.height
            logger.info("%s -> %d pose rows | %s/%s", path.name, df.height, group, exercise)
        logger.info("KIMORE adapter done: %d pose rows -> %s", total, self.out_dir)
        return total


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="KIMORE -> Mova canonical pose adapter")
    p.add_argument("--raw-dir", type=Path, default=Path("data/raw/kimore"))
    p.add_argument("--out-dir", type=Path, default=Path("data/interim/pose"))
    p.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    KimoreAdapter(args.raw_dir, args.out_dir).run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
