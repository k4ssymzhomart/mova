"""UI-PRMD -> Mova canonical pose adapter.

UI-PRMD captures 10 physical-rehabilitation movements with correct and incorrect
executions (22-joint skeletons). Each ``*_positions.txt`` is a frame x (22*3) matrix of
joint positions. Movement id and correct/incorrect are inferred from the filename/path
(``m01_s01_positions.txt`` under a ``Correct``/``Incorrect`` folder).

Emits long-format canonical pose Parquet consumed by the pose feature pipeline.

Run:
    python -m mova.data.adapters.uiprmd_adapter --raw-dir data/raw/ui_prmd --out-dir data/interim/pose
"""

from __future__ import annotations

import argparse
import logging
import re
from pathlib import Path

import numpy as np

from mova.pose.io import pose_long_df, write_pose_partitioned
from mova.pose.schema import UIPRMD22

logger = logging.getLogger("mova.adapters.ui_prmd")

DATASET = "ui_prmd"
NATIVE_RATE_HZ = 30.0
N_JOINTS = len(UIPRMD22)
_MOVE_RE = re.compile(r"(m\d+)", re.IGNORECASE)
_SUBJ_RE = re.compile(r"(s\d+)", re.IGNORECASE)


def _infer_meta(path: Path) -> tuple[str, str, int | None]:
    """(subject_id, movement, correct) from the UI-PRMD filename/path."""
    name = path.stem.lower()
    move = (_MOVE_RE.search(name) or [None, "unknown"])[1] if _MOVE_RE.search(name) else "unknown"
    subj_m = _SUBJ_RE.search(name)
    subject = subj_m.group(1) if subj_m else "unknown"
    lowered = [p.lower() for p in path.parts]
    correct = 1 if "correct" in lowered else (0 if "incorrect" in lowered else None)
    return subject, move, correct


class UiPrmdAdapter:
    def __init__(self, raw_dir: Path, out_dir: Path) -> None:
        self.raw_dir = raw_dir
        self.out_dir = out_dir

    def run(self) -> int:
        if not self.raw_dir.is_dir():
            raise FileNotFoundError(f"raw UI-PRMD dir not found: {self.raw_dir}")
        files = sorted(self.raw_dir.rglob("*_positions.txt"))
        if not files:
            raise FileNotFoundError(f"no UI-PRMD *_positions.txt under {self.raw_dir}")
        self.out_dir.mkdir(parents=True, exist_ok=True)

        total = 0
        for path in files:
            raw = np.loadtxt(path, ndmin=2)
            if raw.shape[1] < N_JOINTS * 3:
                logger.warning("unexpected width, skipping: %s", path)
                continue
            positions = raw[:, : N_JOINTS * 3].reshape(raw.shape[0], N_JOINTS, 3)
            subject, move, correct = _infer_meta(path)
            session = f"{move}_{path.stem}"
            t = np.arange(positions.shape[0], dtype=np.float64) / NATIVE_RATE_HZ
            df = pose_long_df(
                t, positions, UIPRMD22, subject_id=subject, session_id=session, dataset=DATASET,
                exercise=move, correct=correct,
            )
            write_pose_partitioned(df, self.out_dir, basename=f"uiprmd-{session.lower()}")
            total += df.height
            logger.info("%s -> %d pose rows | %s correct=%s", path.name, df.height, move, correct)
        logger.info("UI-PRMD adapter done: %d pose rows -> %s", total, self.out_dir)
        return total


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="UI-PRMD -> Mova canonical pose adapter")
    p.add_argument("--raw-dir", type=Path, default=Path("data/raw/ui_prmd"))
    p.add_argument("--out-dir", type=Path, default=Path("data/interim/pose"))
    p.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    UiPrmdAdapter(args.raw_dir, args.out_dir).run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
