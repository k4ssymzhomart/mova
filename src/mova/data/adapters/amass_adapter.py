"""AMASS -> Mova canonical schema adapter (virtual IMU).

Thin CLI over ``mova.synth.amass``: walks AMASS ``.npz`` files, runs SMPL forward
kinematics to synthesize per-placement virtual IMU (``modality=imu``) with realistic
degradations, and writes canonical Parquet so the synthetic stream flows through the same
preprocess -> window -> shard pipeline as real IMU. Joint angles are exact and available via
``mova.synth.amass.joint_angles_deg`` for the pose/angle heads.

Run:
    python -m mova.data.adapters.amass_adapter --raw-dir data/raw/amass --out-dir data/interim

Requires AMASS pose params only (not the licensed SMPL mesh weights). Exact accelerometers
need betas-driven joint offsets — the documented plug-in point in mova.synth.amass.
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

from mova.data.adapters._canonical import write_partitioned
from mova.synth.amass import Degradations, load_amass_npz, synth_virtual_imu
from mova.synth.smpl import SmplSkeleton

logger = logging.getLogger("mova.adapters.amass")


def amass_subject_id(rel: Path) -> str:
    """LOSO subject for an AMASS file from its path relative to the raw dir.

    AMASS groups motions by *performer* in the directory immediately containing the ``.npz``
    (e.g. HDM05's actors ``bk/dg/mm/tr``). We use that actor dir as the subject, prefixed by the
    top-level sub-dataset to stay globally unique (``HDM05_bk``), so subject-disjoint splits and
    LOSO never mix one performer across folds.
    """
    parts = rel.parts
    if len(parts) >= 3:
        return f"{parts[0]}_{parts[-2]}"
    if len(parts) == 2:
        return parts[0]
    return "amass"


class AmassAdapter:
    def __init__(
        self, raw_dir: Path, out_dir: Path, seed: int, degrade: bool,
        smpl_model: Path | None = None,
    ) -> None:
        self.raw_dir = raw_dir
        self.out_dir = out_dir
        self.seed = seed
        self.deg = Degradations(enabled=degrade)
        # Single plug-in point: real SMPL .pkl if present, else the mock skeleton (no crash).
        self.skeleton = SmplSkeleton.from_model_or_mock(smpl_model)

    def run(self) -> int:
        if not self.raw_dir.is_dir():
            raise FileNotFoundError(f"raw AMASS dir not found: {self.raw_dir}")
        files = sorted(self.raw_dir.rglob("*.npz"))
        if not files:
            raise FileNotFoundError(f"no AMASS files (*.npz) under {self.raw_dir}")
        self.out_dir.mkdir(parents=True, exist_ok=True)
        logger.info("AMASS skeleton: %s (mock=%s)", self.skeleton.source, self.skeleton.is_mock)

        total_rows = 0
        for path in files:
            rel = path.relative_to(self.raw_dir)
            subject_id = amass_subject_id(rel)
            session_id = path.stem
            data = load_amass_npz(path)
            if data["poses"].shape[0] < 3:
                logger.warning("too short, skipping: %s", rel)
                continue
            df = synth_virtual_imu(
                data["poses"], data["trans"], data["framerate"],
                subject_id=subject_id, session_id=session_id, deg=self.deg, seed=self.seed,
                skeleton=self.skeleton,
            )
            write_partitioned(df, self.out_dir, basename=f"amass-{session_id.lower()}")
            total_rows += df.height
            logger.info("%s -> %d virtual-IMU rows | subject=%s", rel, df.height, subject_id)
        logger.info("AMASS adapter done: %d canonical rows -> %s", total_rows, self.out_dir)
        return total_rows


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="AMASS -> Mova canonical virtual-IMU adapter")
    p.add_argument("--raw-dir", type=Path, default=Path("data/raw/amass"))
    p.add_argument("--out-dir", type=Path, default=Path("data/interim"))
    p.add_argument("--seed", type=int, default=1337)
    p.add_argument("--no-degrade", action="store_true", help="disable sensor-degradation augmentation")
    p.add_argument("--smpl-model", type=Path, default=Path("data/raw/smpl"),
                   help="dir/file with a licensed SMPL .pkl; absent -> mock skeleton")
    p.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    AmassAdapter(
        args.raw_dir, args.out_dir, seed=args.seed, degrade=not args.no_degrade,
        smpl_model=args.smpl_model,
    ).run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
