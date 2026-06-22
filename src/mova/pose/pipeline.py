"""Pose feature pipeline: canonical pose Parquet -> per-session movement-quality features.

Reads the long-format pose interim (KIMORE / UI-PRMD / mocap), reconstructs each session's
``[T, J, 3]`` skeleton, and emits one feature row per session (ROM per joint, mean smoothness,
mean symmetry) plus the carried labels (quality score / correctness), to
``data/processed/pose/pose_features.parquet``.

Run:
    python -m mova.pose.pipeline --interim data/interim/pose --out data/processed/pose
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

import numpy as np
import polars as pl

from mova.pose.features import session_features
from mova.pose.schema import KINECT25, UIPRMD22

logger = logging.getLogger("mova.pose.pipeline")

JOINTS_BY_DATASET: dict[str, list[str]] = {"kimore": KINECT25, "ui_prmd": UIPRMD22}


def _reconstruct(df: pl.DataFrame, joint_order: list[str]) -> tuple[np.ndarray, float] | None:
    """Long pose rows -> (positions[T,J,3], dt)."""
    present = set(df.get_column("joint").unique().to_list())
    joints = [j for j in joint_order if j in present]
    if not joints:
        return None
    axes = []
    for axis in ("x", "y", "z"):
        wide = df.pivot(on="joint", index="t", values=axis, aggregate_function="first").sort("t")
        axes.append(wide.select(joints).to_numpy())
    positions = np.stack(axes, axis=-1)  # [T, J, 3]
    ts = df.get_column("t").unique().sort().to_numpy()
    dt = float(np.median(np.diff(ts))) if ts.size > 1 else 1.0 / 30.0
    return positions, dt


def _iter_sessions(interim_dir: Path):
    for ds_dir in sorted(interim_dir.glob("dataset=*")):
        dataset = ds_dir.name.split("=", 1)[1]
        for subj_dir in sorted(ds_dir.glob("subject_id=*")):
            subject = subj_dir.name.split("=", 1)[1]
            for sess_dir in sorted(subj_dir.glob("session_id=*")):
                session = sess_dir.name.split("=", 1)[1]
                yield dataset, subject, session, sess_dir


def run(interim_dir: Path, out_dir: Path) -> None:
    rows: list[dict] = []
    for dataset, subject, session, sess_dir in _iter_sessions(interim_dir):
        joint_order = JOINTS_BY_DATASET.get(dataset, KINECT25)
        df = pl.read_parquet(sess_dir / "**" / "*.parquet")
        rec = _reconstruct(df, joint_order)
        if rec is None:
            continue
        positions, dt = rec
        feats = session_features(positions, joint_order, dt)
        labels = df.select("exercise", "group", "quality_score", "correct").head(1).to_dicts()[0]
        rows.append(
            {
                "dataset": dataset,
                "subject": subject,
                "session": session,
                "n_frames": feats["n_frames"],
                "mean_smoothness": feats["mean_smoothness"],
                "mean_symmetry": feats["mean_symmetry"],
                "rom_deg": json.dumps(feats["rom_deg"]),
                **labels,
            }
        )
        logger.info("%s/%s/%s -> smoothness=%.2f symmetry=%.3f",
                    dataset, subject, session, feats["mean_smoothness"], feats["mean_symmetry"])

    out_dir.mkdir(parents=True, exist_ok=True)
    if rows:
        pl.DataFrame(rows).write_parquet(out_dir / "pose_features.parquet")
    (out_dir / "meta.json").write_text(json.dumps({"sessions": len(rows)}, indent=2))
    logger.info("pose pipeline done: %d sessions -> %s", len(rows), out_dir)


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Mova pose feature pipeline")
    p.add_argument("--interim", type=Path, default=Path("data/interim/pose"))
    p.add_argument("--out", type=Path, default=Path("data/processed/pose"))
    p.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    run(args.interim, args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
