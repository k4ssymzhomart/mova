"""Shared building blocks for dataset adapters.

Every adapter emits the same canonical schema (see ``data_manifests/schemas/canonical.json``)
and writes Hive-partitioned Parquet with the same idempotent semantics. Keeping these here
guarantees HHAR / Daphnet / REALDISP stay byte-compatible at the schema level.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import polars as pl
import pyarrow.dataset as pa_ds

# Canonical column order emitted by every adapter (mirrors canonical.json record_schema).
CANONICAL_COLUMNS: list[str] = [
    "t",
    "ax",
    "ay",
    "az",
    "gx",
    "gy",
    "gz",
    "mx",
    "my",
    "mz",
    "qw",
    "qx",
    "qy",
    "qz",
    "modality",
    "subject_id",
    "session_id",
    "device_id",
    "placement",
    "rate_hz",
    "make_model",
    "dataset",
    "activity",
    "activity_canonical",
    "fog_label",
]
PARTITION_COLUMNS: list[str] = ["dataset", "subject_id", "session_id", "modality"]


def f32_null(name: str) -> pl.Expr:
    """A null Float32 column (for channels a dataset/modality does not provide)."""
    return pl.lit(None, dtype=pl.Float32).alias(name)


def i8_null(name: str) -> pl.Expr:
    """A null Int8 column (e.g. fog_label for non-Daphnet datasets)."""
    return pl.lit(None, dtype=pl.Int8).alias(name)


def load_dataset_spec(schema_path: Path | None, dataset: str) -> dict[str, Any]:
    """Return the per-dataset block from canonical.json, or {} if unavailable."""
    if schema_path is None or not schema_path.is_file():
        return {}
    schema = json.loads(schema_path.read_text())
    spec: dict[str, Any] = schema.get("datasets", {}).get(dataset, {})
    return spec


def estimate_rate_hz(t: pl.Series, fallback: float) -> float:
    """Effective sampling rate from the median timestamp delta (robust to dupes/gaps)."""
    if t.len() < 3:
        return fallback
    median_dt = t.sort().diff().median()
    if median_dt is None or median_dt <= 0:
        return fallback
    return float(1.0 / median_dt)


def write_partitioned(df: pl.DataFrame, out_dir: Path, basename: str) -> None:
    """Write a canonical DataFrame as Hive-partitioned Parquet (idempotent per partition)."""
    pa_ds.write_dataset(
        data=df.to_arrow(),
        base_dir=str(out_dir),
        format="parquet",
        partitioning=PARTITION_COLUMNS,
        partitioning_flavor="hive",
        existing_data_behavior="delete_matching",
        basename_template=f"{basename}-{{i}}.parquet",
    )
