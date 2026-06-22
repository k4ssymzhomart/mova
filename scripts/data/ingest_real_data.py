"""Move the manually-downloaded real datasets into their canonical ``data/raw/`` homes.

We obtained two real datasets by hand (academic licensing blocked automated pulls):

  * **AMASS — HDM05 subset**: a folder ``AMASS/HDM05/MPI_HDM05/<actor>/*.npz`` of SMPL-H mocap.
  * **DIP-IMU**: ``DIP/DIP_IMU_and_Others/DIP_IMU.zip`` -> ``DIP_IMU/s_XX/NN.pkl`` per subject.

This script relocates them to the canonical locations the adapters expect
(``data/raw/amass`` and ``data/raw/dip_imu``) and **permanently drops TotalCapture**
(access denied — out of scope). It is idempotent: re-running it is a no-op once the data is
in place. Nothing here touches git-tracked files; ``data/raw/*`` is DVC/gitignored.

Run (from the repo that holds the downloads):
    python scripts/data/ingest_real_data.py --src-root . --data-root .
"""

from __future__ import annotations

import argparse
import logging
import shutil
import zipfile
from pathlib import Path

logger = logging.getLogger("mova.ingest")


def _move_tree(src: Path, dst: Path) -> bool:
    """Move ``src`` directory contents under ``dst`` (merging). Returns True if anything moved."""
    if not src.exists():
        logger.info("source absent, skipping: %s", src)
        return False
    dst.mkdir(parents=True, exist_ok=True)
    moved = False
    for child in src.iterdir():
        if child.name == ".DS_Store":
            child.unlink(missing_ok=True)
            continue
        target = dst / child.name
        if target.exists():
            logger.info("already present, skipping: %s", target)
            continue
        shutil.move(str(child), str(target))
        moved = True
        logger.info("moved %s -> %s", child, target)
    return moved


def ingest_amass(src_root: Path, data_root: Path) -> None:
    """AMASS/HDM05 -> data/raw/amass/HDM05 (actor dirs preserved; actor = LOSO subject)."""
    src = src_root / "AMASS"
    dst = data_root / "data" / "raw" / "amass"
    if not src.exists():
        logger.info("no AMASS download at %s (already ingested?)", src)
        return
    _move_tree(src, dst)
    # Drop the now-empty download dir.
    shutil.rmtree(src, ignore_errors=True)
    npz = list(dst.rglob("*.npz"))
    logger.info("AMASS canonical: %s | %d npz files", dst, len(npz))


def ingest_dip(src_root: Path, data_root: Path) -> None:
    """DIP_IMU.zip -> data/raw/dip_imu/s_XX/NN.pkl (subject = parent dir s_XX)."""
    dst = data_root / "data" / "raw" / "dip_imu"
    if list(dst.rglob("*.pkl")):
        logger.info("DIP-IMU already extracted at %s", dst)
    else:
        zip_path = src_root / "DIP" / "DIP_IMU_and_Others" / "DIP_IMU.zip"
        if not zip_path.exists():
            logger.warning("DIP_IMU.zip not found at %s", zip_path)
            return
        dst.mkdir(parents=True, exist_ok=True)
        logger.info("extracting %s -> %s", zip_path, dst)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(dst)
        # Flatten a leading "DIP_IMU/" wrapper dir if present.
        wrapper = dst / "DIP_IMU"
        if wrapper.is_dir():
            _move_tree(wrapper, dst)
            shutil.rmtree(wrapper, ignore_errors=True)
    subjects = sorted({p.parent.name for p in dst.rglob("*.pkl")})
    logger.info("DIP-IMU canonical: %s | subjects=%s", dst, subjects)


def drop_totalcapture(src_root: Path, data_root: Path) -> None:
    """TotalCapture is permanently out of scope (access denied). Remove every copy."""
    targets = [
        src_root / "DIP" / "TotalCapture_Real_60FPS",
        data_root / "data" / "raw" / "totalcapture",
        src_root / "TotalCapture",
    ]
    for t in targets:
        if t.exists():
            shutil.rmtree(t, ignore_errors=True)
            logger.info("dropped TotalCapture: %s", t)


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Ingest manually-downloaded real datasets")
    p.add_argument("--src-root", type=Path, default=Path(),
                   help="dir holding the AMASS/ and DIP/ download folders")
    p.add_argument("--data-root", type=Path, default=Path(),
                   help="repo root holding data/raw/")
    p.add_argument("--log-level", default="INFO")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    src_root, data_root = args.src_root.resolve(), args.data_root.resolve()
    ingest_amass(src_root, data_root)
    ingest_dip(src_root, data_root)
    drop_totalcapture(src_root, data_root)
    logger.info("ingestion complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
