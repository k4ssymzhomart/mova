"""PyTorch datasets / dataloaders over Mova's preprocessed windows.

Reads the sharded float32 windows in ``data/processed/<split>/<dataset>_<NNNN>.npy`` together with the
row-aligned ``index.parquet``, and serves them per split. Subject-disjoint 80/10/10 splits are produced by
the preprocessing stage (``data_manifests/splits/subject_splits.json``) and re-verified here.

Modes:
  * ``ssl`` -> windows only (every window in the split, labelled or not) for masked pretraining.
  * ``har`` -> windows + HAR class id (windows whose majority activity is known).
  * ``fog`` -> windows + freeze/no-freeze id (Daphnet only).

Each item carries integer ``placement`` and ``dataset`` ids for the encoder's conditioning embeddings.
Windows are memory-mapped per shard (lazy, low-RAM) and normalized with train-only stats.

Quick check (on the GPU box, once torch is installed):
    python -m mova.train.data --mode har --batch-size 256
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np
import polars as pl
import torch
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler

Mode = Literal["ssl", "har", "fog"]

DEFAULT_PROCESSED = Path("data/processed")
DEFAULT_STATS = Path("data_manifests/norm_stats/train_stats.json")
DEFAULT_SPLITS = Path("data_manifests/splits/subject_splits.json")
FOG_VOCAB = {"no_freeze": 0, "freeze": 1}


@dataclass
class Vocabs:
    placement: dict[str, int]
    dataset: dict[str, int]
    har_label: dict[str, int]
    fog_label: dict[str, int]

    @property
    def n_placements(self) -> int:
        return len(self.placement)

    @property
    def n_datasets(self) -> int:
        return len(self.dataset)


def _build_vocab(values: list[str | None]) -> dict[str, int]:
    return {v: i for i, v in enumerate(sorted({x for x in values if x is not None}))}


def load_norm_stats(path: Path = DEFAULT_STATS) -> tuple[np.ndarray, np.ndarray]:
    d = json.loads(Path(path).read_text())
    mean = np.asarray(d["mean"], dtype=np.float32)
    std = np.asarray(d["std"], dtype=np.float32)
    std = np.where(std < 1e-6, 1.0, std).astype(np.float32)
    return mean, std


def build_vocabs(processed_dir: Path = DEFAULT_PROCESSED) -> Vocabs:
    """Build id vocabularies from the FULL index so train/val/test share consistent ids."""
    idx = pl.read_parquet(Path(processed_dir) / "index.parquet")
    har = idx.filter((pl.col("task") == "har") & pl.col("label").is_not_null())
    return Vocabs(
        placement=_build_vocab(idx.get_column("placement").to_list()),
        dataset=_build_vocab(idx.get_column("dataset").to_list()),
        har_label=_build_vocab(har.get_column("label").to_list()),
        fog_label=dict(FOG_VOCAB),
    )


def verify_splits(
    processed_dir: Path = DEFAULT_PROCESSED, splits_path: Path = DEFAULT_SPLITS
) -> None:
    """Assert no subject appears in >1 split and that splits match the manifest."""
    idx = pl.read_parquet(Path(processed_dir) / "index.parquet")
    leak = (
        idx.group_by(["dataset", "subject"])
        .agg(pl.col("split").n_unique().alias("n"))
        .filter(pl.col("n") > 1)
    )
    if leak.height:
        raise AssertionError(f"subject leakage across splits: {leak.to_dicts()}")
    manifest = json.loads(Path(splits_path).read_text())["splits"]
    for dataset, parts in manifest.items():
        for split_name, subs in parts.items():
            present = set(
                idx.filter((pl.col("dataset") == dataset) & (pl.col("split") == split_name))
                .get_column("subject")
                .unique()
                .to_list()
            )
            if not present <= set(subs):
                raise AssertionError(f"{dataset}/{split_name} has subjects outside the manifest")


class MovaWindowDataset(Dataset):
    """Serves preprocessed windows for one split, memory-mapped per shard."""

    def __init__(
        self,
        split: str | None,
        mode: Mode = "ssl",
        processed_dir: Path = DEFAULT_PROCESSED,
        stats_path: Path = DEFAULT_STATS,
        vocabs: Vocabs | None = None,
        normalize: bool = True,
        transform: Callable[[np.ndarray], np.ndarray] | None = None,
        channels_first: bool = False,
        include_datasets: list[str] | None = None,
        subjects: list[str] | None = None,
    ) -> None:
        self.split = split
        self.mode = mode
        self.processed_dir = Path(processed_dir)
        self.normalize = normalize
        self.transform = transform
        self.channels_first = channels_first
        self.vocabs = vocabs or build_vocabs(self.processed_dir)
        self.mean, self.std = load_norm_stats(stats_path)

        idx = pl.read_parquet(self.processed_dir / "index.parquet")
        if split is not None:  # split=None -> all splits (used for subject-defined LOSO folds)
            idx = idx.filter(pl.col("split") == split)
        if include_datasets is not None:  # leakage-safe SSL: pretrain only on chosen datasets
            idx = idx.filter(pl.col("dataset").is_in(include_datasets))
        if subjects is not None:  # LOSO fold membership is defined by subject, not by split
            idx = idx.filter(pl.col("subject").is_in(subjects))
        if mode == "har":
            idx = idx.filter((pl.col("task") == "har") & pl.col("label").is_not_null())
        elif mode == "fog":
            idx = idx.filter(pl.col("task") == "fog")
        if idx.height == 0:
            raise ValueError(
                f"no windows for split={split!r} mode={mode!r} "
                f"datasets={include_datasets} subjects={subjects}"
            )
        self.index = idx

        # Materialize hot columns to numpy for fast __getitem__.
        self._shard = idx.get_column("shard").to_list()
        self._row = idx.get_column("row").to_numpy()
        self._placement = np.array(
            [self.vocabs.placement.get(p, -1) for p in idx.get_column("placement").to_list()],
            dtype=np.int64,
        )
        self._dataset = np.array(
            [self.vocabs.dataset.get(d, -1) for d in idx.get_column("dataset").to_list()],
            dtype=np.int64,
        )
        if mode == "har":
            self._label = np.array(
                [self.vocabs.har_label[v] for v in idx.get_column("label").to_list()],
                dtype=np.int64,
            )
        elif mode == "fog":
            self._label = idx.get_column("fog").to_numpy().astype(np.int64)
        else:
            self._label = None
        self._mmaps: dict[str, np.ndarray] = {}

    def _shard_array(self, rel: str) -> np.ndarray:
        mm = self._mmaps.get(rel)
        if mm is None:
            mm = np.load(self.processed_dir / rel, mmap_mode="r")
            self._mmaps[rel] = mm
        return mm

    def __len__(self) -> int:
        return self.index.height

    def __getitem__(self, i: int) -> dict[str, torch.Tensor | int]:
        x = np.array(self._shard_array(self._shard[i])[self._row[i]], dtype=np.float32)  # [200,6]
        if self.normalize:
            x = (x - self.mean) / self.std
        if self.transform is not None:
            x = self.transform(x)
        if self.channels_first:
            x = x.transpose(1, 0)
        item: dict[str, torch.Tensor | int] = {
            "x": torch.from_numpy(np.ascontiguousarray(x)),
            "placement": int(self._placement[i]),
            "dataset": int(self._dataset[i]),
        }
        if self._label is not None:
            item["label"] = int(self._label[i])
        return item

    def labels(self) -> np.ndarray | None:
        return self._label


def _imbalance_sampler(labels: np.ndarray) -> WeightedRandomSampler:
    counts = np.bincount(labels)
    weights = 1.0 / np.maximum(counts[labels], 1)
    return WeightedRandomSampler(
        torch.as_tensor(weights, dtype=torch.double), num_samples=len(labels), replacement=True
    )


def make_dataloaders(
    mode: Mode = "ssl",
    batch_size: int = 256,
    num_workers: int = 4,
    processed_dir: Path = DEFAULT_PROCESSED,
    normalize: bool = True,
    transform: Callable[[np.ndarray], np.ndarray] | None = None,
    channels_first: bool = False,
    balance_fog: bool = True,
    pin_memory: bool = True,
    verify: bool = True,
) -> tuple[dict[str, DataLoader], Vocabs]:
    """Build train/val/test DataLoaders for a mode, sharing one vocabulary."""
    if verify:
        verify_splits(processed_dir)
    vocabs = build_vocabs(processed_dir)
    loaders: dict[str, DataLoader] = {}
    for split in ("train", "val", "test"):
        ds = MovaWindowDataset(
            split,
            mode=mode,
            processed_dir=processed_dir,
            vocabs=vocabs,
            normalize=normalize,
            transform=transform if split == "train" else None,
            channels_first=channels_first,
        )
        sampler: WeightedRandomSampler | None = None
        shuffle = split == "train"
        if split == "train" and mode == "fog" and balance_fog and ds.labels() is not None:
            sampler = _imbalance_sampler(ds.labels())
            shuffle = False
        loaders[split] = DataLoader(
            ds,
            batch_size=batch_size,
            shuffle=shuffle,
            sampler=sampler,
            num_workers=num_workers,
            pin_memory=pin_memory and torch.cuda.is_available(),  # pinning only helps CUDA
            drop_last=(split == "train"),
            persistent_workers=num_workers > 0,
        )
    return loaders, vocabs


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Mova dataloader smoke test")
    ap.add_argument("--mode", default="ssl", choices=["ssl", "har", "fog"])
    ap.add_argument("--batch-size", type=int, default=256)
    args = ap.parse_args(argv)
    loaders, vocabs = make_dataloaders(mode=args.mode, batch_size=args.batch_size, num_workers=0)
    print(
        f"placements={vocabs.n_placements} datasets={vocabs.n_datasets} "
        f"har_classes={len(vocabs.har_label)}"
    )
    for split, dl in loaders.items():
        print(f"{split}: {len(dl.dataset)} windows")
    batch = next(iter(loaders["train"]))
    print("batch x:", tuple(batch["x"].shape), "| keys:", sorted(batch.keys()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
