"""End-to-end preprocessing: canonical Parquet -> aligned 50 Hz -> windows -> sharded .npy.

Runs fully in memory (raw corpus is ~3 GB). For each (dataset, subject, session, placement) it aligns
to a 50 Hz, 6-channel grid (align.py), slices fixed 4 s windows (window.py) with a dataset-specific
overlap, assigns each window to a subject-disjoint split (split.py), and writes float32 shards to
``data/processed/<split>/<dataset>_<NNNN>.npy`` with a row-aligned ``index.parquet``.

Train-split per-channel normalization stats are accumulated on the fly (no leakage) and written to
``data_manifests/norm_stats/train_stats.json``.

Run:
    python -m mova.preprocess.pipeline --interim data/interim --out data/processed
"""

from __future__ import annotations

import argparse
import json
import logging
import random
from pathlib import Path

import numpy as np
import polars as pl

from mova.preprocess import align, split
from mova.preprocess.window import WINDOW, aggregate_fog, aggregate_har, iter_windows

logger = logging.getLogger("mova.preprocess")

CHANNELS = ["ax", "ay", "az", "gx", "gy", "gz"]
READ_COLUMNS = [
    "t",
    *CHANNELS,
    "modality",
    "placement",
    "activity_canonical",
    "activity",
    "fog_label",
]
# 200-sample windows: 50% overlap (stride 100) for HAR, 75% overlap (stride 50) for Daphnet.
STRIDE_BY_DATASET = {"daphnet_fog": 50}
DEFAULT_STRIDE = 100
TASK_BY_DATASET = {"daphnet_fog": "fog"}


class ShardWriter:
    """Buffers windows per (split, dataset) and flushes fixed-size float32 .npy shards."""

    def __init__(self, out_dir: Path, shard_size: int) -> None:
        self.out_dir = out_dir
        self.shard_size = shard_size
        self._buf: dict[tuple[str, str], list[np.ndarray]] = {}
        self._meta: dict[tuple[str, str], list[dict]] = {}
        self._shard_idx: dict[tuple[str, str], int] = {}
        self.index: list[dict] = []
        self.train_sum = np.zeros(len(CHANNELS), dtype=np.float64)
        self.train_sumsq = np.zeros(len(CHANNELS), dtype=np.float64)
        self.train_count = 0

    def add(self, split_name: str, dataset: str, x: np.ndarray, meta: dict) -> None:
        key = (split_name, dataset)
        self._buf.setdefault(key, []).append(x)
        self._meta.setdefault(key, []).append(meta)
        if len(self._buf[key]) >= self.shard_size:
            self._flush(key)

    def _flush(self, key: tuple[str, str]) -> None:
        buf = self._buf.get(key)
        if not buf:
            return
        split_name, dataset = key
        arr = np.stack(buf).astype(np.float32)  # [N, 200, 6]
        idx = self._shard_idx.get(key, 0)
        rel = f"{split_name}/{dataset}_{idx:04d}.npy"
        path = self.out_dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        np.save(path, arr)
        for row, meta in enumerate(self._meta[key]):
            self.index.append({**meta, "shard": rel, "row": row})
        if split_name == "train":
            a64 = arr.astype(np.float64)
            self.train_sum += a64.sum(axis=(0, 1))
            self.train_sumsq += (a64**2).sum(axis=(0, 1))
            self.train_count += arr.shape[0] * arr.shape[1]
        logger.info("flushed %s [%d windows]", rel, arr.shape[0])
        self._shard_idx[key] = idx + 1
        self._buf[key] = []
        self._meta[key] = []

    def finalize(self) -> None:
        for key in list(self._buf.keys()):
            self._flush(key)

    def norm_stats(self) -> dict:
        if self.train_count == 0:
            return {}
        mean = self.train_sum / self.train_count
        var = np.maximum(self.train_sumsq / self.train_count - mean**2, 1e-12)
        return {
            "channels": CHANNELS,
            "mean": mean.tolist(),
            "std": np.sqrt(var).tolist(),
            "count_samples": int(self.train_count),
        }


def _code_activities(act: np.ndarray, vocab: dict[str, int]) -> np.ndarray:
    """Vectorized str->int code (-1 for null/empty), growing a shared vocabulary."""
    uniq, inv = np.unique(act, return_inverse=True)
    codes = np.empty(len(uniq), dtype=np.int32)
    for i, u in enumerate(uniq):
        if u == "":
            codes[i] = -1
        else:
            codes[i] = vocab.setdefault(str(u), len(vocab))
    return codes[inv]


def _iter_sessions(interim_dir: Path):
    for ds_dir in sorted(interim_dir.glob("dataset=*")):
        dataset = ds_dir.name.split("=", 1)[1]
        for subj_dir in sorted(ds_dir.glob("subject_id=*")):
            subject = subj_dir.name.split("=", 1)[1]
            for sess_dir in sorted(subj_dir.glob("session_id=*")):
                session = sess_dir.name.split("=", 1)[1]
                yield dataset, subject, session, sess_dir


def _freeze_positive_subjects(interim_dir: Path) -> set[str]:
    """Daphnet subjects with at least one freeze sample (fog_label == 2)."""
    dap = interim_dir / "dataset=daphnet_fog"
    if not dap.exists():
        return set()
    df = (
        pl.scan_parquet(str(dap / "**" / "*.parquet"), hive_partitioning=True)
        .select("subject_id", "fog_label")
        .filter(pl.col("fog_label") == 2)
        .collect()
    )
    return set(df.get_column("subject_id").unique().to_list())


def _stratified_split(
    subjects: list[str],
    positives: set[str],
    seed: int,
    ratios: tuple[float, float, float] = (0.8, 0.1, 0.1),
) -> dict[str, list[str]]:
    """Spread positive (freeze) subjects across train/val/test so each split has positives."""
    rng = random.Random(seed + 7)

    def three_way(items: list[str]) -> tuple[list[str], list[str], list[str]]:
        s = list(items)
        rng.shuffle(s)
        n = len(s)
        if n == 0:
            return [], [], []
        if n == 1:
            return s, [], []
        if n == 2:
            return s[:1], s[1:], []
        n_tr = max(1, round(n * ratios[0]))
        n_va = max(1, round(n * ratios[1]))
        if n_tr + n_va >= n:
            n_va = max(1, n - n_tr - 1)
            n_tr = n - n_va - 1
        return s[:n_tr], s[n_tr : n_tr + n_va], s[n_tr + n_va :]

    ptr, pva, pte = three_way([x for x in subjects if x in positives])
    ntr, nva, nte = three_way([x for x in subjects if x not in positives])
    return {"train": sorted(ptr + ntr), "val": sorted(pva + nva), "test": sorted(pte + nte)}


def run(interim_dir: Path, out_dir: Path, splits_path: Path, seed: int, shard_size: int) -> None:
    subjects = split.discover_subjects(interim_dir)
    splits = split.make_subject_splits(subjects, seed=seed)
    # Freezing is rare and concentrated in a few subjects; stratify Daphnet so val AND test each
    # contain freezing subjects (else sensitivity/AUROC are unmeasurable on an all-negative test set).
    positives = _freeze_positive_subjects(interim_dir)
    if "daphnet_fog" in splits and positives:
        splits["daphnet_fog"] = _stratified_split(subjects["daphnet_fog"], positives, seed)
    split.save_splits(splits, splits_path, seed=seed, ratios=(0.8, 0.1, 0.1))
    lut = split.lookup_table(splits)
    logger.info("subjects per dataset: %s", {k: len(v) for k, v in subjects.items()})

    writer = ShardWriter(out_dir, shard_size)
    vocab: dict[str, int] = {}
    kept = 0

    for dataset, subject, session, sess_dir in _iter_sessions(interim_dir):
        split_name = lut.get(dataset, {}).get(subject)
        if split_name is None:
            continue
        task = TASK_BY_DATASET.get(dataset, "har")
        stride = STRIDE_BY_DATASET.get(dataset, DEFAULT_STRIDE)
        df = (
            pl.scan_parquet(str(sess_dir / "**" / "*.parquet"), hive_partitioning=True)
            .select(READ_COLUMNS)
            .collect()
        )
        for placement in df.get_column("placement").unique().to_list():
            built = align.build_placement(df.filter(pl.col("placement") == placement))
            if built is None:
                continue
            x_grid, act_grid, fog_grid = built
            act_codes = _code_activities(act_grid, vocab)
            for start, xw, act_w, fog_w in iter_windows(
                x_grid, act_codes, fog_grid, WINDOW, stride
            ):
                meta = {
                    "dataset": dataset,
                    "subject": subject,
                    "session": session,
                    "placement": placement,
                    "task": task,
                    "split": split_name,
                    "start": int(start),
                }
                if task == "fog":
                    fog = aggregate_fog(fog_w)
                    if fog is None:
                        continue
                    meta |= {"label_code": None, "fog": int(fog), "purity": 1.0}
                else:
                    code, purity = aggregate_har(act_w)
                    meta |= {"label_code": int(code), "fog": None, "purity": round(purity, 4)}
                writer.add(split_name, dataset, xw, meta)
                kept += 1
        logger.info("%s/%s/%s -> running total %d windows", dataset, subject, session, kept)

    writer.finalize()

    # Resolve labels now that the activity vocabulary is complete.
    code_to_act = {code: name for name, code in vocab.items()}
    index_schema = {
        "dataset": pl.Utf8,
        "subject": pl.Utf8,
        "session": pl.Utf8,
        "placement": pl.Utf8,
        "task": pl.Utf8,
        "split": pl.Utf8,
        "start": pl.Int64,
        "label_code": pl.Int64,
        "fog": pl.Int64,
        "purity": pl.Float64,
        "shard": pl.Utf8,
        "row": pl.Int64,
    }
    index_df = pl.DataFrame(writer.index, schema=index_schema)
    har_label = pl.col("label_code").replace_strict(code_to_act, default=None, return_dtype=pl.Utf8)
    fog_label = pl.when(pl.col("fog") == 1).then(pl.lit("freeze")).otherwise(pl.lit("no_freeze"))
    index_df = index_df.with_columns(
        pl.when(pl.col("task") == "fog").then(fog_label).otherwise(har_label).alias("label")
    ).drop("label_code")
    out_dir.mkdir(parents=True, exist_ok=True)
    index_df.write_parquet(out_dir / "index.parquet")

    stats = writer.norm_stats()
    stats_path = Path("data_manifests/norm_stats/train_stats.json")
    stats_path.parent.mkdir(parents=True, exist_ok=True)
    stats_path.write_text(json.dumps(stats, indent=2))

    meta = {
        "rate_hz": align.TARGET_HZ,
        "window_samples": WINDOW,
        "channels": CHANNELS,
        "stride_by_dataset": {**dict.fromkeys(subjects, DEFAULT_STRIDE), **STRIDE_BY_DATASET},
        "activity_vocab": {str(code): name for name, code in vocab.items()},
        "total_windows": int(index_df.height),
        "windows_by_split": index_df.group_by("split").len().sort("split").to_dicts(),
        "windows_by_dataset": index_df.group_by("dataset").len().sort("dataset").to_dicts(),
        "seed": seed,
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2))
    logger.info("DONE: %d windows | splits=%s", index_df.height, meta["windows_by_split"])


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Mova preprocessing pipeline")
    p.add_argument("--interim", type=Path, default=Path("data/interim"))
    p.add_argument("--out", type=Path, default=Path("data/processed"))
    p.add_argument("--splits", type=Path, default=Path("data_manifests/splits/subject_splits.json"))
    p.add_argument("--seed", type=int, default=1337)
    p.add_argument("--shard-size", type=int, default=20000)
    p.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(
        level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    run(args.interim, args.out, args.splits, args.seed, args.shard_size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
