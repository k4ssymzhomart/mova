"""Long-format pose I/O: skeleton arrays <-> canonical pose Parquet (Hive-partitioned)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import polars as pl
import pyarrow.dataset as pa_ds

from mova.pose.schema import POSE_COLUMNS, POSE_PARTITION


def pose_long_df(
    t: np.ndarray,
    positions: np.ndarray,
    joint_names: list[str],
    *,
    subject_id: str,
    session_id: str,
    dataset: str,
    confidence: np.ndarray | None = None,
    exercise: str | None = None,
    group: str | None = None,
    quality_score: float | None = None,
    correct: int | None = None,
) -> pl.DataFrame:
    """``positions[T,J,3]`` -> long canonical pose DataFrame (one row per frame per joint)."""
    n_frames, n_joints = positions.shape[0], positions.shape[1]
    conf = (
        np.asarray(confidence, dtype=np.float32).ravel()
        if confidence is not None
        else np.full(n_frames * n_joints, np.nan, dtype=np.float32)
    )
    return pl.DataFrame(
        {
            "t": np.repeat(t.astype(np.float64), n_joints),
            "joint": np.tile(np.asarray(joint_names, dtype=object), n_frames),
            "x": positions[:, :, 0].astype(np.float32).ravel(),
            "y": positions[:, :, 1].astype(np.float32).ravel(),
            "z": positions[:, :, 2].astype(np.float32).ravel(),
            "confidence": conf,
        }
    ).with_columns(
        pl.lit(subject_id).alias("subject_id"),
        pl.lit(session_id).alias("session_id"),
        pl.lit(dataset).alias("dataset"),
        pl.lit(exercise, dtype=pl.Utf8).alias("exercise"),
        pl.lit(group, dtype=pl.Utf8).alias("group"),
        pl.lit(quality_score, dtype=pl.Float64).alias("quality_score"),
        pl.lit(correct, dtype=pl.Int8).alias("correct"),
    ).select(POSE_COLUMNS)


def write_pose_partitioned(df: pl.DataFrame, out_dir: Path, basename: str) -> None:
    """Write canonical pose rows as Hive-partitioned Parquet (idempotent per partition)."""
    pa_ds.write_dataset(
        data=df.to_arrow(),
        base_dir=str(out_dir),
        format="parquet",
        partitioning=POSE_PARTITION,
        partitioning_flavor="hive",
        existing_data_behavior="delete_matching",
        basename_template=f"{basename}-{{i}}.parquet",
    )
