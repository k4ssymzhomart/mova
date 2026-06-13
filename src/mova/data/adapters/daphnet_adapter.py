"""Daphnet Freezing-of-Gait -> Mova canonical schema adapter.

Each ``SxxRyy.txt`` is one run (whitespace-delimited, 11 columns): a time column (ms)
followed by 3 tri-axial accelerometers (ankle/shank, thigh, trunk) in milli-g, and a
freezing-of-gait annotation. There is no gyroscope. The adapter emits one canonical
``modality=acc`` stream per sensor (3 placements share the run's partition), converts
mg -> g, re-bases time per session, and carries the FoG label.

Raw axis order per sensor is [horizontal-forward, vertical, horizontal-lateral]; we map
to the canonical body frame ax=forward, ay=lateral, az=vertical (see canonical.json).

FoG annotation is preserved as ``fog_label`` (0=not-in-experiment, 1=no-freeze, 2=freeze).
Rows with label 0 are kept here for SSL; the preprocess/eval stage drops them for FoG tasks.

Run:
    python -m mova.data.adapters.daphnet_adapter --raw-dir data/raw/daphnet_fog --out-dir data/interim
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
    load_dataset_spec,
    write_partitioned,
)

logger = logging.getLogger("mova.adapters.daphnet")

DATASET = "daphnet_fog"
DEFAULT_NATIVE_RATE_HZ = 64.0
DEFAULT_TO_G = 0.001  # milli-g -> g
DEFAULT_FILE_GLOB = "S[0-9][0-9]R[0-9][0-9].txt"

RAW_COLUMNS: list[str] = [
    "time_ms",
    "ankle_fwd",
    "ankle_vert",
    "ankle_lat",
    "thigh_fwd",
    "thigh_vert",
    "thigh_lat",
    "trunk_fwd",
    "trunk_vert",
    "trunk_lat",
    "annotation",
]

# sensor -> (forward, lateral, vertical) raw columns + default canonical placement
SENSORS: dict[str, dict[str, str]] = {
    "ankle": {"fwd": "ankle_fwd", "lat": "ankle_lat", "vert": "ankle_vert", "placement": "ankle"},
    "thigh": {"fwd": "thigh_fwd", "lat": "thigh_lat", "vert": "thigh_vert", "placement": "thigh"},
    "trunk": {"fwd": "trunk_fwd", "lat": "trunk_lat", "vert": "trunk_vert", "placement": "back"},
}


class DaphnetSpec:
    """Daphnet config sourced from canonical.json with safe fallbacks."""

    def __init__(self, schema_path: Path | None) -> None:
        spec: dict[str, Any] = load_dataset_spec(schema_path, DATASET)
        acc_units = spec.get("units", {}).get("accelerometer", {}) or {}
        self.to_g: float = float(acc_units.get("to_g", DEFAULT_TO_G))
        self.native_rate: float = float(spec.get("native_sampling_rate_hz", DEFAULT_NATIVE_RATE_HZ))
        self.file_glob: str = spec.get("file_glob", DEFAULT_FILE_GLOB)
        sensors_spec = spec.get("sensors", {})
        self.placements: dict[str, str] = {
            name: sensors_spec.get(name, {}).get("placement", meta["placement"])
            for name, meta in SENSORS.items()
        }


def _process_file(path: Path, spec: DaphnetSpec) -> pl.DataFrame:
    """One Daphnet run -> canonical DataFrame (3 accelerometer placements stacked)."""
    stem = path.stem  # e.g. S01R01
    subject_id = stem[:3]
    session_id = stem

    base = pl.read_csv(
        path,
        separator=" ",
        has_header=False,
        new_columns=RAW_COLUMNS,
        schema_overrides=dict.fromkeys(RAW_COLUMNS, pl.Int64),
    )
    base = base.with_columns(
        ((pl.col("time_ms") - pl.col("time_ms").min()).cast(pl.Float64) / 1000.0).alias("t"),
        pl.col("annotation").cast(pl.Int8).alias("fog_label"),
    )
    rate = estimate_rate_hz(base.get_column("t"), spec.native_rate)

    frames: list[pl.DataFrame] = []
    for name, cols in SENSORS.items():
        placement = spec.placements[name]
        frames.append(
            base.select(
                pl.col("t"),
                (pl.col(cols["fwd"]) * spec.to_g).cast(pl.Float32).alias("ax"),
                (pl.col(cols["lat"]) * spec.to_g).cast(pl.Float32).alias("ay"),
                (pl.col(cols["vert"]) * spec.to_g).cast(pl.Float32).alias("az"),
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
                pl.lit(session_id).alias("session_id"),
                pl.lit(None, dtype=pl.Utf8).alias("device_id"),
                pl.lit(placement).alias("placement"),
                pl.lit(rate, dtype=pl.Float32).alias("rate_hz"),
                pl.lit(None, dtype=pl.Utf8).alias("make_model"),
                pl.lit(DATASET).alias("dataset"),
                pl.lit(None, dtype=pl.Utf8).alias("activity"),
                pl.lit(None, dtype=pl.Utf8).alias("activity_canonical"),
                pl.col("fog_label"),
            )
        )
    return pl.concat(frames, how="vertical").select(CANONICAL_COLUMNS)


class DaphnetAdapter:
    """Convert a raw Daphnet download directory into canonical Parquet."""

    def __init__(self, raw_dir: Path, out_dir: Path, schema_path: Path | None) -> None:
        self.raw_dir = raw_dir
        self.out_dir = out_dir
        self.spec = DaphnetSpec(schema_path)

    def run(self) -> int:
        if not self.raw_dir.is_dir():
            raise FileNotFoundError(f"raw Daphnet dir not found: {self.raw_dir}")
        files = sorted(self.raw_dir.rglob(self.spec.file_glob))
        if not files:
            raise FileNotFoundError(
                f"no Daphnet runs ({self.spec.file_glob}) found under {self.raw_dir}"
            )
        self.out_dir.mkdir(parents=True, exist_ok=True)

        total_rows = 0
        for path in files:
            df = _process_file(path, self.spec)
            if df.height == 0:
                logger.warning("empty after parse: %s", path.name)
                continue
            write_partitioned(df, self.out_dir, basename=f"daphnet-{path.stem.lower()}")
            total_rows += df.height
            freeze = df.filter(pl.col("fog_label") == 2).height
            logger.info(
                "%s -> %d rows | placements=%s | freeze_samples=%d",
                path.name,
                df.height,
                sorted(df.get_column("placement").unique().to_list()),
                freeze,
            )
        logger.info("Daphnet adapter done: %d canonical rows -> %s", total_rows, self.out_dir)
        return total_rows


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Daphnet FoG -> Mova canonical schema adapter")
    p.add_argument("--raw-dir", type=Path, default=Path("data/raw/daphnet_fog"))
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
        logger.warning("schema not found at %s; using built-in Daphnet defaults", args.schema)
    DaphnetAdapter(raw_dir=args.raw_dir, out_dir=args.out_dir, schema_path=schema_path).run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
