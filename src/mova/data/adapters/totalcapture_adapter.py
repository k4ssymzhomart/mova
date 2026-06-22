"""TotalCapture -> Mova canonical schema adapter.

TotalCapture pairs 13 Xsens IMUs with Vicon mocap (5 subjects). Each IMU file is a
whitespace matrix: a header line ``<n_sensors> <n_frames>`` followed by one row per frame
holding ``n_sensors * 13`` values — per sensor ``[quat_wxyz, acc_xyz, gyr_xyz, mag_xyz]``
in sensor order (see canonical.json). Acceleration is in g, gyro in rad/s, orientation as a
unit quaternion; all four are carried into the canonical record (``modality=imu``).

The adapter emits one canonical stream per sensor placement and re-bases time to seconds at
the native 60 Hz. The Vicon joint angles are handled separately by the pose pipeline.

Run:
    python -m mova.data.adapters.totalcapture_adapter --raw-dir data/raw/totalcapture --out-dir data/interim

Note: the .sensors layout is encoded in canonical.json
(``format_verified_against_real_data: false``); confirm on the first dvc pull.
"""

from __future__ import annotations

import argparse
import logging
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

logger = logging.getLogger("mova.adapters.totalcapture")

DATASET = "totalcapture"
DEFAULT_NATIVE_RATE_HZ = 60.0
PER_SENSOR_WIDTH = 13
DEFAULT_SENSOR_ORDER = [
    "Head", "Sternum", "Pelvis", "L_UpArm", "R_UpArm", "L_LowArm", "R_LowArm",
    "L_UpLeg", "R_UpLeg", "L_LowLeg", "R_LowLeg", "L_Foot", "R_Foot",
]
DEFAULT_PLACEMENT_MAP = {
    "Head": "head", "Sternum": "sternum", "Pelvis": "pelvis",
    "L_UpArm": "l_upper_arm", "R_UpArm": "r_upper_arm",
    "L_LowArm": "l_forearm", "R_LowArm": "r_forearm",
    "L_UpLeg": "l_thigh", "R_UpLeg": "r_thigh",
    "L_LowLeg": "l_shank", "R_LowLeg": "r_shank", "L_Foot": "l_foot", "R_Foot": "r_foot",
}
DEFAULT_FILE_GLOB = "*_Xsens_AuxFields.sensors"


class TotalCaptureSpec:
    def __init__(self, schema_path: Path | None) -> None:
        spec: dict[str, Any] = load_dataset_spec(schema_path, DATASET)
        self.native_rate = float(spec.get("native_sampling_rate_hz", DEFAULT_NATIVE_RATE_HZ))
        self.sensor_order: list[str] = spec.get("sensor_order", DEFAULT_SENSOR_ORDER)
        self.placement_map: dict[str, str] = spec.get("placement_map", DEFAULT_PLACEMENT_MAP)
        self.to_g = float((spec.get("units", {}).get("accelerometer", {}) or {}).get("to_g", 1.0))
        self.file_glob: str = spec.get("imu_file_glob", DEFAULT_FILE_GLOB)


def _read_matrix(path: Path, n_sensors: int) -> np.ndarray:
    """Read the whitespace IMU matrix [frames, n_sensors*13], skipping the size header."""
    rows = np.loadtxt(path, skiprows=1, ndmin=2)
    width = n_sensors * PER_SENSOR_WIDTH
    if rows.shape[1] != width:
        raise ValueError(f"{path.name}: expected {width} cols, got {rows.shape[1]}")
    return rows


def _process_file(path: Path, spec: TotalCaptureSpec) -> pl.DataFrame:
    stem = path.stem  # e.g. S1_acting1_Xsens_AuxFields
    subject_id = stem.split("_", 1)[0]
    session_id = stem
    n_sensors = len(spec.sensor_order)
    mat = _read_matrix(path, n_sensors)
    n_frames = mat.shape[0]
    t = np.arange(n_frames, dtype=np.float64) / spec.native_rate

    frames: list[pl.DataFrame] = []
    for i, sensor in enumerate(spec.sensor_order):
        block = mat[:, i * PER_SENSOR_WIDTH : (i + 1) * PER_SENSOR_WIDTH]
        placement = spec.placement_map.get(sensor, "unspecified")
        qw, qx, qy, qz, ax, ay, az, gx, gy, gz, mx, my, mz = (block[:, k] for k in range(13))
        frames.append(
            pl.DataFrame(
                {
                    "t": t,
                    "ax": (ax * spec.to_g).astype(np.float32),
                    "ay": (ay * spec.to_g).astype(np.float32),
                    "az": (az * spec.to_g).astype(np.float32),
                    "gx": gx.astype(np.float32),
                    "gy": gy.astype(np.float32),
                    "gz": gz.astype(np.float32),
                    "mx": mx.astype(np.float32),
                    "my": my.astype(np.float32),
                    "mz": mz.astype(np.float32),
                    "qw": qw.astype(np.float32),
                    "qx": qx.astype(np.float32),
                    "qy": qy.astype(np.float32),
                    "qz": qz.astype(np.float32),
                }
            ).with_columns(
                pl.lit("imu").alias("modality"),
                pl.lit(subject_id).alias("subject_id"),
                pl.lit(session_id).alias("session_id"),
                pl.lit(sensor).alias("device_id"),
                pl.lit(placement).alias("placement"),
                pl.lit(spec.native_rate, dtype=pl.Float32).alias("rate_hz"),
                pl.lit("xsens").alias("make_model"),
                pl.lit(DATASET).alias("dataset"),
                pl.lit(None, dtype=pl.Utf8).alias("activity"),
                pl.lit(None, dtype=pl.Utf8).alias("activity_canonical"),
                i8_null("fog_label"),
            )
        )
    return pl.concat(frames, how="vertical").select(CANONICAL_COLUMNS)


class TotalCaptureAdapter:
    def __init__(self, raw_dir: Path, out_dir: Path, schema_path: Path | None) -> None:
        self.raw_dir = raw_dir
        self.out_dir = out_dir
        self.spec = TotalCaptureSpec(schema_path)

    def run(self) -> int:
        if not self.raw_dir.is_dir():
            raise FileNotFoundError(f"raw TotalCapture dir not found: {self.raw_dir}")
        files = sorted(self.raw_dir.rglob(self.spec.file_glob))
        if not files:
            raise FileNotFoundError(f"no TotalCapture files ({self.spec.file_glob}) under {self.raw_dir}")
        self.out_dir.mkdir(parents=True, exist_ok=True)

        total_rows = 0
        for path in files:
            df = _process_file(path, self.spec)
            if df.height == 0:
                continue
            write_partitioned(df, self.out_dir, basename=f"totalcapture-{path.stem.lower()}")
            total_rows += df.height
            logger.info("%s -> %d rows | sensors=%d", path.name, df.height, len(self.spec.sensor_order))
        logger.info("TotalCapture adapter done: %d canonical rows -> %s", total_rows, self.out_dir)
        return total_rows


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="TotalCapture -> Mova canonical schema adapter")
    p.add_argument("--raw-dir", type=Path, default=Path("data/raw/totalcapture"))
    p.add_argument("--out-dir", type=Path, default=Path("data/interim"))
    p.add_argument("--schema", type=Path, default=Path("data_manifests/schemas/canonical.json"))
    p.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    schema_path = args.schema if args.schema.is_file() else None
    TotalCaptureAdapter(raw_dir=args.raw_dir, out_dir=args.out_dir, schema_path=schema_path).run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
