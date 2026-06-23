"""CAPTURE-24 -> Mova canonical schema adapter.

CAPTURE-24 is ~3,883 h of 100 Hz wrist accelerometry from 151 participants with
camera-derived activity annotations — the largest *real* corpus we have for SSL
pretraining. Each participant is one gzipped CSV (``P001.csv.gz``) with columns
``time, x, y, z, annotation``; acceleration is already in g. There is no gyroscope.

The adapter emits one canonical ``modality=acc`` stream per participant at the dominant
wrist, re-bases time to per-session seconds (parsing ISO-8601 timestamps when present),
and carries the coarse annotation as ``activity`` with a best-effort canonical mapping.

Run:
    python -m mova.data.adapters.capture24_adapter --raw-dir data/raw/capture24 --out-dir data/interim

Note: the real-file column layout/units are encoded in canonical.json
(``format_verified_against_real_data: false``); confirm on the first dvc pull.
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
    f32_null,
    i8_null,
    load_dataset_spec,
    write_partitioned,
)

logger = logging.getLogger("mova.adapters.capture24")

DATASET = "capture24"
DEFAULT_NATIVE_RATE_HZ = 100.0
DEFAULT_TO_G = 1.0
DEFAULT_FILE_GLOB = "P[0-9][0-9][0-9].csv.gz"
DEFAULT_PLACEMENT = "wrist"


class Capture24Spec:
    """CAPTURE-24 config sourced from canonical.json with safe fallbacks."""

    def __init__(self, schema_path: Path | None) -> None:
        spec: dict[str, Any] = load_dataset_spec(schema_path, DATASET)
        acc_units = spec.get("units", {}).get("accelerometer", {}) or {}
        self.to_g: float = float(acc_units.get("to_g", DEFAULT_TO_G))
        self.native_rate: float = float(spec.get("native_sampling_rate_hz", DEFAULT_NATIVE_RATE_HZ))
        self.file_glob: str = spec.get("file_glob", DEFAULT_FILE_GLOB)
        self.placement: str = spec.get("placement_default", DEFAULT_PLACEMENT)
        self.canonical_map: dict[str, str] = spec.get("activity_canonical_map", {})


def _time_seconds(df: pl.DataFrame) -> pl.Series:
    """Per-session relative seconds from a `time` column that may be ISO-8601 or numeric."""
    col = df.get_column("time")
    if col.dtype in (pl.Float64, pl.Float32, pl.Int64, pl.Int32):
        t = col.cast(pl.Float64)
    else:
        parsed = col.cast(pl.Utf8).str.to_datetime(strict=False, time_unit="us")
        t = parsed.dt.timestamp("us").cast(pl.Float64) / 1_000_000.0
    return (t - t.min()).alias("t")


def _process_file(path: Path, spec: Capture24Spec) -> pl.DataFrame:
    """One CAPTURE-24 participant -> canonical accelerometer DataFrame."""
    subject_id = path.name.split(".", 1)[0]  # P001.csv.gz -> P001
    raw = pl.read_csv(path, infer_schema_length=2000)
    have_annot = "annotation" in raw.columns
    base = raw.with_columns(_time_seconds(raw))
    rate = estimate_rate_hz(base.get_column("t"), spec.native_rate)

    activity = (
        pl.col("annotation").cast(pl.Utf8) if have_annot else pl.lit(None, dtype=pl.Utf8)
    )
    activity_canon = (
        pl.col("annotation").cast(pl.Utf8).replace_strict(
            spec.canonical_map, default=None, return_dtype=pl.Utf8
        )
        if have_annot and spec.canonical_map
        else pl.lit(None, dtype=pl.Utf8)
    )

    return base.select(
        pl.col("t"),
        (pl.col("x") * spec.to_g).cast(pl.Float32).alias("ax"),
        (pl.col("y") * spec.to_g).cast(pl.Float32).alias("ay"),
        (pl.col("z") * spec.to_g).cast(pl.Float32).alias("az"),
        f32_null("gx"),
        f32_null("gy"),
        f32_null("gz"),
        f32_null("mx"),
        f32_null("my"),
        f32_null("mz"),
        f32_null("qw"),
        f32_null("qx"),
        f32_null("qy"),
        f32_null("qz"),
        pl.lit("acc").alias("modality"),
        pl.lit(subject_id).alias("subject_id"),
        pl.lit(subject_id).alias("session_id"),
        pl.lit(None, dtype=pl.Utf8).alias("device_id"),
        pl.lit(spec.placement).alias("placement"),
        pl.lit(rate, dtype=pl.Float32).alias("rate_hz"),
        pl.lit("axivity_ax3").alias("make_model"),
        pl.lit(DATASET).alias("dataset"),
        activity.alias("activity"),
        activity_canon.alias("activity_canonical"),
        i8_null("fog_label"),
    ).select(CANONICAL_COLUMNS)


class Capture24Adapter:
    """Convert a raw CAPTURE-24 download directory into canonical Parquet."""

    def __init__(self, raw_dir: Path, out_dir: Path, schema_path: Path | None) -> None:
        self.raw_dir = raw_dir
        self.out_dir = out_dir
        self.spec = Capture24Spec(schema_path)

    def run(self) -> int:
        if not self.raw_dir.is_dir():
            raise FileNotFoundError(f"raw CAPTURE-24 dir not found: {self.raw_dir}")
        files = sorted(self.raw_dir.rglob(self.spec.file_glob))
        if not files:
            raise FileNotFoundError(
                f"no CAPTURE-24 files ({self.spec.file_glob}) under {self.raw_dir}"
            )
        self.out_dir.mkdir(parents=True, exist_ok=True)

        total_rows = 0
        for path in files:
            df = _process_file(path, self.spec)
            if df.height == 0:
                logger.warning("empty after parse: %s", path.name)
                continue
            write_partitioned(df, self.out_dir, basename=f"capture24-{path.name.split('.', 1)[0].lower()}")
            total_rows += df.height
            logger.info("%s -> %d rows | placement=%s", path.name, df.height, self.spec.placement)
        logger.info("CAPTURE-24 adapter done: %d canonical rows -> %s", total_rows, self.out_dir)
        return total_rows


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="CAPTURE-24 -> Mova canonical schema adapter")
    p.add_argument("--raw-dir", type=Path, default=Path("data/raw/capture24"))
    p.add_argument("--out-dir", type=Path, default=Path("data/interim"))
    p.add_argument("--schema", type=Path, default=Path("data_manifests/schemas/canonical.json"))
    p.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    schema_path = args.schema if args.schema.is_file() else None
    if schema_path is None:
        logger.warning("schema not found at %s; using built-in defaults", args.schema)
    Capture24Adapter(raw_dir=args.raw_dir, out_dir=args.out_dir, schema_path=schema_path).run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
