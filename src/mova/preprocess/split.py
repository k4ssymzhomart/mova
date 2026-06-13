"""Subject-disjoint train/val/test splits (per dataset), persisted to a manifest.

Splits are computed per dataset so every dataset contributes to every split, but a given subject
appears in exactly one split (no subject leakage). HHAR additionally supports a cross-device axis and
REALDISP a cross-position (ideal/self/mutual) axis; those are layered at eval time, not here.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

Splits = dict[str, dict[str, list[str]]]


def discover_subjects(interim_dir: Path) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for ds_dir in sorted(interim_dir.glob("dataset=*")):
        dataset = ds_dir.name.split("=", 1)[1]
        subs = sorted(p.name.split("=", 1)[1] for p in ds_dir.glob("subject_id=*"))
        out[dataset] = subs
    return out


def make_subject_splits(
    subjects_by_dataset: dict[str, list[str]],
    ratios: tuple[float, float, float] = (0.8, 0.1, 0.1),
    seed: int = 1337,
) -> Splits:
    rng = random.Random(seed)
    splits: Splits = {}
    for dataset, subs in subjects_by_dataset.items():
        s = list(subs)
        rng.shuffle(s)
        n = len(s)
        if n < 3:  # too few subjects to hold out cleanly: put all in train
            splits[dataset] = {"train": sorted(s), "val": [], "test": []}
            continue
        n_train = max(1, round(n * ratios[0]))
        n_val = max(1, round(n * ratios[1]))
        if n_train + n_val >= n:  # guarantee a non-empty test set
            n_val = max(1, n - n_train - 1)
            n_train = n - n_val - 1
        splits[dataset] = {
            "train": sorted(s[:n_train]),
            "val": sorted(s[n_train : n_train + n_val]),
            "test": sorted(s[n_train + n_val :]),
        }
    return splits


def lookup_table(splits: Splits) -> dict[str, dict[str, str]]:
    """{dataset: {subject: split_name}} for O(1) assignment during processing."""
    table: dict[str, dict[str, str]] = {}
    for dataset, parts in splits.items():
        table[dataset] = {subj: name for name, subs in parts.items() for subj in subs}
    return table


def save_splits(splits: Splits, path: Path, seed: int, ratios: tuple[float, float, float]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "seed": seed,
        "ratios": list(ratios),
        "policy": "subject_disjoint_per_dataset",
        "splits": splits,
    }
    path.write_text(json.dumps(payload, indent=2))
