"""DIP-IMU -> Mova canonical schema adapter.

DIP-IMU provides 17 Xsens sensors (10 subjects) with per-frame acceleration (m/s^2) and
orientation (rotation matrices), plus SMPL pose ground truth. Each ``.pkl`` holds
``imu_acc[T,17,3]``, ``imu_ori[T,17,3,3]`` and ``gt[T,72]`` (SMPL axis-angle).

The accelerometer is real; we *derive* the gyroscope from the orientation sequence
(body-frame angular velocity) and carry the orientation as a quaternion, so DIP becomes a
true 6-channel IMU dataset (``modality=imu``). Acceleration is converted m/s^2 -> g. The
SMPL pose is left to the pose pipeline (joint-angle labels). Sensors with all-NaN data
(unused in a recording) are skipped.

Run:
    python -m mova.data.adapters.dip_imu_adapter --raw-dir data/raw/dip_imu --out-dir data/interim

Note: the pickle key/layout is encoded in canonical.json
(``format_verified_against_real_data: false``); confirm on the first dvc pull.
"""

from __future__ import annotations

import argparse
import logging
import pickle
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl

from mova.data.adapters._canonical import (
    CANONICAL_COLUMNS,
    i8_null,
    load_dataset_spec,
    write_partitioned,
)
from mova.synth.rotations import angular_velocity, matrix_to_quat

logger = logging.getLogger("mova.adapters.dip_imu")

DATASET = "dip_imu"
DEFAULT_NATIVE_RATE_HZ = 60.0
DEFAULT_TO_G = 0.10197162129779283  # m/s^2 -> g
DEFAULT_SENSOR_ORDER = [
    "head", "spine", "l_upper_arm", "r_upper_arm", "l_forearm", "r_forearm", "l_hand",
    "r_hand", "pelvis", "l_thigh", "r_thigh", "l_shank", "r_shank", "l_foot", "r_foot",
    "l_toe", "r_toe",
]


class DipSpec:
    def __init__(self, schema_path: Path | None) -> None:
        spec: dict[str, Any] = load_dataset_spec(schema_path, DATASET)
        self.native_rate = float(spec.get("native_sampling_rate_hz", DEFAULT_NATIVE_RATE_HZ))
        self.sensor_order: list[str] = spec.get("sensor_order_17", DEFAULT_SENSOR_ORDER)
        self.to_g = float((spec.get("units", {}).get("accelerometer", {}) or {}).get("to_g", DEFAULT_TO_G))


def _load_pickle(path: Path) -> dict[str, Any]:
    with path.open("rb") as fh:
        try:
            return pickle.load(fh, encoding="latin1")
        except TypeError:  # pragma: no cover - py3-saved pickles
            fh.seek(0)
            return pickle.load(fh)


def _process_file(path: Path, spec: DipSpec) -> pl.DataFrame:
    data = _load_pickle(path)
    acc = np.asarray(data["imu_acc"], dtype=np.float64)   # [T, 17, 3]
    ori = np.asarray(data["imu_ori"], dtype=np.float64)   # [T, 17, 3, 3]
    n_frames, n_sensors = acc.shape[0], acc.shape[1]
    subject_id = path.stem.split("_", 1)[0]
    session_id = path.stem
    dt = 1.0 / spec.native_rate
    t = np.arange(n_frames, dtype=np.float64) * dt

    frames: list[pl.DataFrame] = []
    for i in range(n_sensors):
        placement = spec.sensor_order[i] if i < len(spec.sensor_order) else "unspecified"
        acc_i = acc[:, i, :]
        if not np.isfinite(acc_i).any():
            continue  # sensor unused in this recording
        ori_i = np.nan_to_num(ori[:, i, :, :], nan=0.0)
        # Replace degenerate (all-zero) frames with identity so derived gyro stays finite.
        bad = ~np.isfinite(ori_i).all(axis=(1, 2)) | (np.abs(ori_i).sum(axis=(1, 2)) < 1e-6)
        ori_i[bad] = np.eye(3)
        gyr_i = angular_velocity(ori_i, dt)
        quat_i = matrix_to_quat(ori_i)
        acc_i = np.nan_to_num(acc_i)
        frames.append(
            pl.DataFrame(
                {
                    "t": t,
                    "ax": (acc_i[:, 0] * spec.to_g).astype(np.float32),
                    "ay": (acc_i[:, 1] * spec.to_g).astype(np.float32),
                    "az": (acc_i[:, 2] * spec.to_g).astype(np.float32),
                    "gx": gyr_i[:, 0].astype(np.float32),
                    "gy": gyr_i[:, 1].astype(np.float32),
                    "gz": gyr_i[:, 2].astype(np.float32),
                    "qw": quat_i[:, 0].astype(np.float32),
                    "qx": quat_i[:, 1].astype(np.float32),
                    "qy": quat_i[:, 2].astype(np.float32),
                    "qz": quat_i[:, 3].astype(np.float32),
                }
            ).with_columns(
                pl.lit(None, dtype=pl.Float32).alias("mx"),
                pl.lit(None, dtype=pl.Float32).alias("my"),
                pl.lit(None, dtype=pl.Float32).alias("mz"),
                pl.lit("imu").alias("modality"),
                pl.lit(subject_id).alias("subject_id"),
                pl.lit(session_id).alias("session_id"),
                pl.lit(spec.sensor_order[i] if i < len(spec.sensor_order) else f"s{i}").alias("device_id"),
                pl.lit(placement).alias("placement"),
                pl.lit(spec.native_rate, dtype=pl.Float32).alias("rate_hz"),
                pl.lit("xsens").alias("make_model"),
                pl.lit(DATASET).alias("dataset"),
                pl.lit(None, dtype=pl.Utf8).alias("activity"),
                pl.lit(None, dtype=pl.Utf8).alias("activity_canonical"),
                i8_null("fog_label"),
            )
        )
    if not frames:
        return pl.DataFrame(schema=dict.fromkeys(CANONICAL_COLUMNS, pl.Utf8))
    return pl.concat(frames, how="vertical").select(CANONICAL_COLUMNS)


class DipImuAdapter:
    def __init__(self, raw_dir: Path, out_dir: Path, schema_path: Path | None) -> None:
        self.raw_dir = raw_dir
        self.out_dir = out_dir
        self.spec = DipSpec(schema_path)

    def run(self) -> int:
        if not self.raw_dir.is_dir():
            raise FileNotFoundError(f"raw DIP-IMU dir not found: {self.raw_dir}")
        files = sorted(self.raw_dir.rglob("*.pkl"))
        if not files:
            raise FileNotFoundError(f"no DIP-IMU pickles (*.pkl) under {self.raw_dir}")
        self.out_dir.mkdir(parents=True, exist_ok=True)

        total_rows = 0
        for path in files:
            df = _process_file(path, self.spec)
            if df.height == 0:
                logger.warning("empty after parse: %s", path.name)
                continue
            write_partitioned(df, self.out_dir, basename=f"dip-{path.stem.lower()}")
            total_rows += df.height
            logger.info("%s -> %d rows | placements=%d", path.name, df.height,
                        df.get_column("placement").n_unique())
        logger.info("DIP-IMU adapter done: %d canonical rows -> %s", total_rows, self.out_dir)
        return total_rows


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="DIP-IMU -> Mova canonical schema adapter")
    p.add_argument("--raw-dir", type=Path, default=Path("data/raw/dip_imu"))
    p.add_argument("--out-dir", type=Path, default=Path("data/interim"))
    p.add_argument("--schema", type=Path, default=Path("data_manifests/schemas/canonical.json"))
    p.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    schema_path = args.schema if args.schema.is_file() else None
    DipImuAdapter(raw_dir=args.raw_dir, out_dir=args.out_dir, schema_path=schema_path).run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
