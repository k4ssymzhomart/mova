"""REALDISP -> Mova canonical schema adapter.

Each ``subject{N}_{scenario}.log`` is tab-delimited with 120 columns: 2 timestamp columns
(seconds, microseconds), then 9 Xsens sensors x 13 channels (acc xyz, gyro xyz, mag xyz,
quaternion wxyz), then 1 activity-id column (0..33). The adapter emits one canonical
``modality=imu`` stream per sensor (9 placements share the file's partition), converts
accelerometer m/s^2 -> g (gyro already rad/s), keeps magnetometer (arbitrary units) and
orientation, and maps the activity id to canonical labels.

The displacement scenario (ideal / self / mutualN) is preserved in ``device_id`` and in
``session_id`` so the cross-position evaluation can split on it later.

Run:
    python -m mova.data.adapters.realdisp_adapter --raw-dir data/raw/realdisp --out-dir data/interim
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import Any

import polars as pl

from mova.data.adapters._canonical import (
    CANONICAL_COLUMNS,
    estimate_rate_hz,
    i8_null,
    load_dataset_spec,
    write_partitioned,
)

logger = logging.getLogger("mova.adapters.realdisp")

DATASET = "realdisp"
DEFAULT_NATIVE_RATE_HZ = 50.0
DEFAULT_TO_G = 0.10197162129779283  # m/s^2 -> g
DEFAULT_FILE_GLOB = "subject*_*.log"
N_COLUMNS = 120
SENSOR_BLOCK_START = 2
PER_SENSOR_WIDTH = 13
LABEL_COL = 119

DEFAULT_SENSOR_ORDER: list[str] = ["RLA", "RUA", "BACK", "LUA", "LLA", "RC", "RT", "LT", "LC"]
DEFAULT_PLACEMENT_MAP: dict[str, str] = {
    "RLA": "r_forearm",
    "RUA": "r_upper_arm",
    "BACK": "back",
    "LUA": "l_upper_arm",
    "LLA": "l_forearm",
    "RC": "r_calf",
    "RT": "r_thigh",
    "LT": "l_thigh",
    "LC": "l_calf",
}
DEFAULT_ACTIVITY_LABELS: dict[str, str] = {
    "0": "null",
    "1": "walking",
    "2": "jogging",
    "3": "running",
    "4": "jump_up",
    "5": "jump_front_back",
    "6": "jump_sideways",
    "7": "jump_legs_arms_open_close",
    "8": "jump_rope",
    "9": "trunk_twist_arms_out",
    "10": "trunk_twist_elbows_bent",
    "11": "waist_bends_forward",
    "12": "waist_rotation",
    "13": "waist_bend_reach_foot",
    "14": "reach_heels_backwards",
    "15": "lateral_bend",
    "16": "lateral_bend_arm_up",
    "17": "repetitive_forward_stretching",
    "18": "upper_lower_opposite_twist",
    "19": "lateral_elevation_arms",
    "20": "frontal_elevation_arms",
    "21": "frontal_hand_claps",
    "22": "frontal_crossing_arms",
    "23": "shoulders_high_rotation",
    "24": "shoulders_low_rotation",
    "25": "arms_inner_rotation",
    "26": "knees_to_breast",
    "27": "heels_to_backside",
    "28": "knees_bending_crouching",
    "29": "knees_bending_forward",
    "30": "rotation_on_knees",
    "31": "rowing",
    "32": "elliptical_bike",
    "33": "cycling",
}
DEFAULT_ACTIVITY_CANONICAL: dict[str, str] = {
    "1": "walking",
    "2": "jogging",
    "3": "running",
    "33": "cycling",
}


class RealdispSpec:
    """REALDISP config sourced from canonical.json with safe fallbacks."""

    def __init__(self, schema_path: Path | None) -> None:
        spec: dict[str, Any] = load_dataset_spec(schema_path, DATASET)
        acc_units = spec.get("units", {}).get("accelerometer", {}) or {}
        self.to_g: float = float(acc_units.get("to_g", DEFAULT_TO_G))
        self.native_rate: float = float(spec.get("native_sampling_rate_hz", DEFAULT_NATIVE_RATE_HZ))
        self.file_glob: str = spec.get("file_glob", DEFAULT_FILE_GLOB)
        self.sensor_order: list[str] = spec.get("sensor_order", DEFAULT_SENSOR_ORDER)
        self.placement_map: dict[str, str] = spec.get("placement_map", DEFAULT_PLACEMENT_MAP)
        self.activity_labels: dict[str, str] = spec.get(
            "activity_label_map", DEFAULT_ACTIVITY_LABELS
        )
        self.activity_canonical: dict[str, str] = spec.get(
            "activity_canonical_map", DEFAULT_ACTIVITY_CANONICAL
        )


def _parse_scenario(stem: str) -> tuple[str, str]:
    """'subject12_mutual5' -> ('subject12', 'mutual5')."""
    subject, _, scenario = stem.partition("_")
    return subject, (scenario or "unknown")


def _process_file(path: Path, spec: RealdispSpec) -> pl.DataFrame:
    """One REALDISP log -> canonical DataFrame (9 IMU placements stacked)."""
    stem = path.stem
    subject_id, scenario = _parse_scenario(stem)
    session_id = stem

    names = [f"c{i}" for i in range(N_COLUMNS)]
    base = pl.read_csv(
        path,
        separator="\t",
        has_header=False,
        new_columns=names,
        infer_schema_length=2000,
    )

    # Shared timestamp + activity columns (computed once, reused by every sensor).
    label_str = pl.col(f"c{LABEL_COL}").cast(pl.Int64).cast(pl.Utf8)
    activity_named = label_str.replace_strict(
        spec.activity_labels, default=None, return_dtype=pl.Utf8
    )
    base = base.with_columns(
        (pl.col("c0").cast(pl.Float64) + pl.col("c1").cast(pl.Float64) * 1e-6).alias("t_abs"),
        pl.when(activity_named == "null").then(None).otherwise(activity_named).alias("activity"),
        label_str.replace_strict(spec.activity_canonical, default=None, return_dtype=pl.Utf8).alias(
            "activity_canonical"
        ),
    ).with_columns((pl.col("t_abs") - pl.col("t_abs").min()).alias("t"))
    rate = estimate_rate_hz(base.get_column("t"), spec.native_rate)

    frames: list[pl.DataFrame] = []
    for idx, sensor in enumerate(spec.sensor_order):
        b = SENSOR_BLOCK_START + idx * PER_SENSOR_WIDTH
        placement = spec.placement_map.get(sensor, "unspecified")
        frames.append(
            base.select(
                pl.col("t"),
                (pl.col(f"c{b}").cast(pl.Float64) * spec.to_g).cast(pl.Float32).alias("ax"),
                (pl.col(f"c{b + 1}").cast(pl.Float64) * spec.to_g).cast(pl.Float32).alias("ay"),
                (pl.col(f"c{b + 2}").cast(pl.Float64) * spec.to_g).cast(pl.Float32).alias("az"),
                pl.col(f"c{b + 3}").cast(pl.Float32).alias("gx"),
                pl.col(f"c{b + 4}").cast(pl.Float32).alias("gy"),
                pl.col(f"c{b + 5}").cast(pl.Float32).alias("gz"),
                pl.col(f"c{b + 6}").cast(pl.Float32).alias("mx"),
                pl.col(f"c{b + 7}").cast(pl.Float32).alias("my"),
                pl.col(f"c{b + 8}").cast(pl.Float32).alias("mz"),
                pl.col(f"c{b + 9}").cast(pl.Float32).alias("qw"),
                pl.col(f"c{b + 10}").cast(pl.Float32).alias("qx"),
                pl.col(f"c{b + 11}").cast(pl.Float32).alias("qy"),
                pl.col(f"c{b + 12}").cast(pl.Float32).alias("qz"),
                pl.lit("imu").alias("modality"),
                pl.lit(subject_id).alias("subject_id"),
                pl.lit(session_id).alias("session_id"),
                pl.lit(scenario).alias("device_id"),
                pl.lit(placement).alias("placement"),
                pl.lit(rate, dtype=pl.Float32).alias("rate_hz"),
                pl.lit(None, dtype=pl.Utf8).alias("make_model"),
                pl.lit(DATASET).alias("dataset"),
                pl.col("activity"),
                pl.col("activity_canonical"),
                i8_null("fog_label"),
            )
        )
    return pl.concat(frames, how="vertical").select(CANONICAL_COLUMNS)


class RealdispAdapter:
    """Convert a raw REALDISP download directory into canonical Parquet."""

    def __init__(self, raw_dir: Path, out_dir: Path, schema_path: Path | None) -> None:
        self.raw_dir = raw_dir
        self.out_dir = out_dir
        self.spec = RealdispSpec(schema_path)

    def run(self) -> int:
        if not self.raw_dir.is_dir():
            raise FileNotFoundError(f"raw REALDISP dir not found: {self.raw_dir}")
        files = sorted(self.raw_dir.rglob(self.spec.file_glob))
        if not files:
            raise FileNotFoundError(
                f"no REALDISP logs ({self.spec.file_glob}) found under {self.raw_dir}"
            )
        self.out_dir.mkdir(parents=True, exist_ok=True)

        total_rows = 0
        for path in files:
            df = _process_file(path, self.spec)
            if df.height == 0:
                logger.warning("empty after parse: %s", path.name)
                continue
            write_partitioned(df, self.out_dir, basename=f"realdisp-{path.stem.lower()}")
            total_rows += df.height
            logger.info(
                "%s -> %d rows | placements=%d | activities=%d",
                path.name,
                df.height,
                df.get_column("placement").n_unique(),
                df.get_column("activity").drop_nulls().n_unique(),
            )
        logger.info("REALDISP adapter done: %d canonical rows -> %s", total_rows, self.out_dir)
        return total_rows


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="REALDISP -> Mova canonical schema adapter")
    p.add_argument("--raw-dir", type=Path, default=Path("data/raw/realdisp"))
    p.add_argument("--out-dir", type=Path, default=Path("data/interim"))
    p.add_argument("--schema", type=Path, default=Path("data_manifests/schemas/canonical.json"))
    p.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(
        level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    schema_path = args.schema if args.schema.is_file() else None
    if schema_path is None:
        logger.warning("schema not found at %s; using built-in REALDISP defaults", args.schema)
    RealdispAdapter(raw_dir=args.raw_dir, out_dir=args.out_dir, schema_path=schema_path).run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
