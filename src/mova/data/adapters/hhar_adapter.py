"""HHAR -> Mova canonical schema adapter.

The Heterogeneity Human Activity Recognition (HHAR) dataset ships four CSV files
(phone/watch x accelerometer/gyroscope). Accelerometer and gyroscope are recorded
in *separate* files on *independent* clocks, so this adapter emits per-modality
canonical rows (acc rows carry ``ax/ay/az``; gyro rows carry ``gx/gy/gz``). Time
alignment + resampling to the canonical 50 Hz grid happens later in the preprocess
stage, per ``data_manifests/schemas/canonical.json``.

What this adapter standardizes (the adapter's contract):
  * units      : accelerometer m/s^2 -> g; gyroscope rad/s (unchanged)
  * time       : Creation_Time (ns), falling back to Arrival_Time (ms) when corrupt,
                 re-based to a per-session relative ``t`` in seconds
  * placement  : device Model -> unified body-site vocabulary (phones=waist, watches=wrist)
  * labels     : raw ``gt`` -> ``activity`` (snake_case) + ``activity_canonical``
  * provenance : subject_id, session_id, device_id, make_model, rate_hz, dataset, modality

Output: Hive-partitioned Parquet under ``<out_dir>/dataset=hhar/subject_id=.../session_id=.../modality=...``.

Run:
    python -m mova.data.adapters.hhar_adapter --raw-dir data/raw/hhar --out-dir data/interim
    # or, after `pip install -e .`:
    mova-adapt-hhar --raw-dir data/raw/hhar --out-dir data/interim
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

import polars as pl

from mova.data.adapters._canonical import (
    CANONICAL_COLUMNS,
    f32_null,
    write_partitioned,
)

logger = logging.getLogger("mova.adapters.hhar")

DATASET = "hhar"
GRAVITY = 9.80665

# Fallbacks used only if canonical.json is missing the hhar section.
_DEFAULT_FILE_MODALITIES: dict[str, dict[str, str]] = {
    "Phones_accelerometer.csv": {"modality": "acc", "device_class": "phone"},
    "Phones_gyroscope.csv": {"modality": "gyr", "device_class": "phone"},
    "Watch_accelerometer.csv": {"modality": "acc", "device_class": "watch"},
    "Watch_gyroscope.csv": {"modality": "gyr", "device_class": "watch"},
}
_DEFAULT_PLACEMENT_MAP: dict[str, str] = {
    "nexus4": "waist",
    "s3": "waist",
    "s3mini": "waist",
    "samsungold": "waist",
    "gear": "wrist",
    "lgwatch": "wrist",
}
_DEFAULT_PLACEMENT_BY_CLASS: dict[str, str] = {"phone": "waist", "watch": "wrist"}
_DEFAULT_ACTIVITY_MAP: dict[str, str] = {
    "stand": "standing",
    "sit": "sitting",
    "walk": "walking",
    "stairsup": "stairs_up",
    "stairsdown": "stairs_down",
    "bike": "cycling",
}
_NULL_ACTIVITY_TOKENS = ["null", ""]

_RAW_SCHEMA_OVERRIDES: dict[str, pl.DataType] = {
    "Arrival_Time": pl.Int64,
    "Creation_Time": pl.Int64,
    "x": pl.Float64,
    "y": pl.Float64,
    "z": pl.Float64,
    "User": pl.Utf8,
    "Model": pl.Utf8,
    "Device": pl.Utf8,
    "gt": pl.Utf8,
}


class HharSpec:
    """HHAR-specific config, sourced from canonical.json with safe fallbacks."""

    def __init__(self, schema_path: Path | None) -> None:
        spec: dict[str, Any] = {}
        if schema_path is not None and schema_path.is_file():
            schema = json.loads(schema_path.read_text())
            spec = schema.get("datasets", {}).get(DATASET, {})
        units = spec.get("units", {}).get("accelerometer", {})
        self.file_modalities: dict[str, dict[str, str]] = spec.get(
            "file_modalities", _DEFAULT_FILE_MODALITIES
        )
        self.acc_to_g: float = float(units.get("to_g", 1.0 / GRAVITY))
        self.placement_map: dict[str, str] = spec.get("placement_map", _DEFAULT_PLACEMENT_MAP)
        self.placement_by_class: dict[str, str] = spec.get(
            "placement_default_by_class", _DEFAULT_PLACEMENT_BY_CLASS
        )
        self.activity_map: dict[str, str] = spec.get(
            "activity_canonical_map", _DEFAULT_ACTIVITY_MAP
        )
        self.null_tokens: list[str] = spec.get("null_activity_tokens", _NULL_ACTIVITY_TOKENS)


def _build_lazyframe(path: Path, modality: str, device_class: str, spec: HharSpec) -> pl.LazyFrame:
    """Transform one raw HHAR CSV into a canonical LazyFrame (native timestamps preserved)."""
    lf = pl.scan_csv(path, schema_overrides=_RAW_SCHEMA_OVERRIDES, null_values=["null"])

    lf = lf.select(
        pl.col("Creation_Time").alias("ct"),
        pl.col("Arrival_Time").alias("at"),
        pl.col("x"),
        pl.col("y"),
        pl.col("z"),
        pl.col("User").alias("subject_id"),
        pl.col("Model").alias("make_model"),
        pl.col("Device").alias("device_id"),
        pl.col("gt").alias("activity_raw"),
    )

    # Session = one (subject, physical device) recording stream.
    lf = lf.with_columns(
        pl.concat_str([pl.col("subject_id"), pl.col("device_id")], separator="__").alias(
            "session_id"
        )
    )

    # Timestamp: prefer Creation_Time (ns); fall back to Arrival_Time (ms -> ns) when corrupt.
    lf = lf.with_columns(
        pl.when(pl.col("ct") > 0)
        .then(pl.col("ct"))
        .otherwise(pl.col("at") * 1_000_000)
        .alias("t_ns")
    ).filter(pl.col("t_ns").is_not_null() & (pl.col("t_ns") > 0))

    lf = lf.sort(["session_id", "t_ns"])
    lf = lf.with_columns(
        ((pl.col("t_ns") - pl.col("t_ns").min().over("session_id")).cast(pl.Float64) / 1e9).alias(
            "t"
        )
    )

    # Effective native rate per session (robust to duplicate/zero diffs).
    rate = (
        lf.group_by("session_id")
        .agg(pl.col("t").sort().diff().median().alias("median_dt"))
        .with_columns(
            pl.when(pl.col("median_dt") > 0)
            .then(1.0 / pl.col("median_dt"))
            .otherwise(None)
            .cast(pl.Float32)
            .alias("rate_hz")
        )
        .select(["session_id", "rate_hz"])
    )
    lf = lf.join(rate, on="session_id", how="left")

    # Channel mapping: acc rows fill ax/ay/az (converted to g); gyro rows fill gx/gy/gz.
    if modality == "acc":
        lf = lf.with_columns(
            (pl.col("x") * spec.acc_to_g).cast(pl.Float32).alias("ax"),
            (pl.col("y") * spec.acc_to_g).cast(pl.Float32).alias("ay"),
            (pl.col("z") * spec.acc_to_g).cast(pl.Float32).alias("az"),
            f32_null("gx"),
            f32_null("gy"),
            f32_null("gz"),
        )
    elif modality == "gyr":
        lf = lf.with_columns(
            f32_null("ax"),
            f32_null("ay"),
            f32_null("az"),
            pl.col("x").cast(pl.Float32).alias("gx"),
            pl.col("y").cast(pl.Float32).alias("gy"),
            pl.col("z").cast(pl.Float32).alias("gz"),
        )
    else:  # pragma: no cover - guarded by caller
        raise ValueError(f"unsupported modality: {modality!r}")

    # Placement from device model, with a per-device-class default for unknown models.
    default_placement = spec.placement_by_class.get(device_class, "unspecified")
    placement = pl.col("make_model").replace_strict(
        spec.placement_map, default=default_placement, return_dtype=pl.Utf8
    )

    # Labels: normalize raw activity, derive canonical activity.
    activity = (
        pl.when(pl.col("activity_raw").is_in(spec.null_tokens) | pl.col("activity_raw").is_null())
        .then(None)
        .otherwise(pl.col("activity_raw"))
        .alias("activity")
    )
    activity_canonical = pl.col("activity_raw").replace_strict(
        spec.activity_map, default=None, return_dtype=pl.Utf8
    )

    lf = lf.with_columns(
        placement.alias("placement"),
        activity,
        activity_canonical.alias("activity_canonical"),
        pl.lit(modality).alias("modality"),
        pl.lit(DATASET).alias("dataset"),
        f32_null("mx"),
        f32_null("my"),
        f32_null("mz"),
        f32_null("qw"),
        f32_null("qx"),
        f32_null("qy"),
        f32_null("qz"),
        pl.lit(None, dtype=pl.Int8).alias("fog_label"),
    )

    return lf.select(CANONICAL_COLUMNS)


class HharAdapter:
    """Convert a raw HHAR download directory into canonical Parquet."""

    def __init__(self, raw_dir: Path, out_dir: Path, schema_path: Path | None) -> None:
        self.raw_dir = raw_dir
        self.out_dir = out_dir
        self.spec = HharSpec(schema_path)

    def run(self) -> int:
        if not self.raw_dir.is_dir():
            raise FileNotFoundError(f"raw HHAR dir not found: {self.raw_dir}")
        self.out_dir.mkdir(parents=True, exist_ok=True)

        total_rows = 0
        found_any = False
        for filename, meta in self.spec.file_modalities.items():
            path = self.raw_dir / filename
            if not path.is_file():
                logger.warning("skip missing file: %s", path)
                continue
            found_any = True
            modality, device_class = meta["modality"], meta["device_class"]
            logger.info("processing %s (modality=%s, class=%s)", path.name, modality, device_class)

            lf = _build_lazyframe(path, modality, device_class, self.spec)
            df = (
                lf.collect()
            )  # one HHAR file fits in memory after projection; scale via streaming later
            rows = df.height
            if rows == 0:
                logger.warning("no valid rows after cleaning: %s", path.name)
                continue

            basename = f"{Path(filename).stem.lower()}"
            write_partitioned(df, self.out_dir, basename)
            total_rows += rows
            logger.info(
                "wrote %d rows | sessions=%d | placements=%s",
                rows,
                df.get_column("session_id").n_unique(),
                sorted(df.get_column("placement").unique().to_list()),
            )

        if not found_any:
            raise FileNotFoundError(
                f"no HHAR CSVs found in {self.raw_dir}. Expected one of: "
                f"{sorted(self.spec.file_modalities)}"
            )
        logger.info("HHAR adapter done: %d canonical rows -> %s", total_rows, self.out_dir)
        return total_rows


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="HHAR -> Mova canonical schema adapter")
    p.add_argument("--raw-dir", type=Path, default=Path("data/raw/hhar"))
    p.add_argument("--out-dir", type=Path, default=Path("data/interim"))
    p.add_argument(
        "--schema",
        type=Path,
        default=Path("data_manifests/schemas/canonical.json"),
        help="canonical schema json (source of truth for units/placement/labels)",
    )
    p.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(
        level=args.log_level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    schema_path = args.schema if args.schema.is_file() else None
    if schema_path is None:
        logger.warning("schema not found at %s; using built-in HHAR defaults", args.schema)
    HharAdapter(raw_dir=args.raw_dir, out_dir=args.out_dir, schema_path=schema_path).run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
