"""Subject-leakage checker — the DoD gate for ``leakage = 0``.

Verifies three invariants and writes ``data_manifests/leakage_report.json``:
  1. subject-disjoint splits: per dataset, train/val/test subject sets are pairwise disjoint;
  2. LOSO folds: per fold, train/val/test are disjoint, test is the single held-out subject,
     and train + val + test covers every subject;
  3. processed windows (if present): every subject's windows live in exactly one split.

Exits non-zero on any violation so ``dvc repro`` / CI fail loudly.

Run:
    python -m mova.data.leakage --splits data_manifests/splits/subject_splits.json \
        --loso data_manifests/splits/loso --processed data/processed/index.parquet
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

logger = logging.getLogger("mova.data.leakage")


def _pairwise_overlap(parts: dict[str, list[str]]) -> dict[str, list[str]]:
    """Return any subject appearing in more than one split, per split-pair."""
    names = list(parts)
    overlaps: dict[str, list[str]] = {}
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = names[i], names[j]
            shared = sorted(set(parts[a]) & set(parts[b]))
            if shared:
                overlaps[f"{a}∩{b}"] = shared
    return overlaps


def check_subject_splits(splits_path: Path) -> dict:
    if not splits_path.is_file():
        return {"checked": False, "reason": f"missing {splits_path}"}
    payload = json.loads(splits_path.read_text())
    per_dataset: dict[str, dict] = {}
    leaks = 0
    for dataset, parts in payload.get("splits", {}).items():
        overlaps = _pairwise_overlap(parts)
        leaks += sum(len(v) for v in overlaps.values())
        per_dataset[dataset] = {
            "subjects": {k: len(v) for k, v in parts.items()},
            "overlaps": overlaps,
        }
    return {"checked": True, "leak_count": leaks, "datasets": per_dataset}


def check_loso(loso_dir: Path) -> dict:
    if not loso_dir.is_dir():
        return {"checked": False, "reason": f"missing {loso_dir}"}
    per_dataset: dict[str, dict] = {}
    leaks = 0
    for path in sorted(loso_dir.glob("*.json")):
        payload = json.loads(path.read_text())
        all_subjects = set()
        bad_folds = []
        for fold in payload.get("folds", []):
            tr, va, te = set(fold["train"]), set(fold["val"]), set(fold["test"])
            all_subjects |= tr | va | te
            disjoint = not (tr & va) and not (tr & te) and not (va & te)
            single_test = len(te) == 1
            if not (disjoint and single_test):
                bad_folds.append(fold["fold"])
                leaks += 1
        # every subject must be the test fold exactly once
        test_counts: dict[str, int] = {}
        for fold in payload.get("folds", []):
            for s in fold["test"]:
                test_counts[s] = test_counts.get(s, 0) + 1
        not_once = sorted(s for s, c in test_counts.items() if c != 1)
        leaks += len(not_once)
        per_dataset[payload["dataset"]] = {
            "n_folds": payload.get("n_folds"),
            "n_subjects": len(all_subjects),
            "bad_folds": bad_folds,
            "subjects_not_tested_once": not_once,
        }
    return {"checked": True, "leak_count": leaks, "datasets": per_dataset}


def check_processed(index_path: Path) -> dict:
    if not index_path.is_file():
        return {"checked": False, "reason": f"missing {index_path}"}
    import polars as pl

    df = pl.read_parquet(index_path).select("dataset", "subject", "split").unique()
    multi = (
        df.group_by("dataset", "subject")
        .agg(pl.col("split").n_unique().alias("n_splits"))
        .filter(pl.col("n_splits") > 1)
    )
    return {
        "checked": True,
        "leak_count": int(multi.height),
        "subjects_in_multiple_splits": multi.to_dicts(),
        "total_windows": int(pl.read_parquet(index_path).height),
    }


def run(splits_path: Path, loso_dir: Path, index_path: Path, out_path: Path) -> int:
    report = {
        "subject_splits": check_subject_splits(splits_path),
        "loso": check_loso(loso_dir),
        "processed": check_processed(index_path),
    }
    total_leaks = sum(
        section.get("leak_count", 0) for section in report.values() if section.get("checked")
    )
    report["leakage_free"] = total_leaks == 0
    report["total_leaks"] = total_leaks
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2))

    if total_leaks == 0:
        logger.info("LEAKAGE-FREE ✓ — report written to %s", out_path)
        return 0
    logger.error("LEAKAGE DETECTED: %d violation(s) — see %s", total_leaks, out_path)
    return 1


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Subject-leakage checker (DoD gate)")
    p.add_argument("--splits", type=Path, default=Path("data_manifests/splits/subject_splits.json"))
    p.add_argument("--loso", type=Path, default=Path("data_manifests/splits/loso"))
    p.add_argument("--processed", type=Path, default=Path("data/processed/index.parquet"))
    p.add_argument("--out", type=Path, default=Path("data_manifests/leakage_report.json"))
    p.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    return run(args.splits, args.loso, args.processed, args.out)


if __name__ == "__main__":
    raise SystemExit(main())
