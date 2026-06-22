"""Leave-one-subject-out (LOSO) cross-validation fold artifacts.

The metrics doctrine (Part 1.4.3) calls for LOSO-CV on small clinical sets — one subject is
not an evaluation. This freezes, per dataset, a list of folds where each subject is the test
set exactly once (with one held-out validation subject), so training reports mean +/- std
across folds rather than a single lucky split.

Run:
    python -m mova.preprocess.loso --interim data/interim \
        --datasets daphnet_fog,kimore,ui_prmd --out data_manifests/splits/loso
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from mova.preprocess.split import discover_subjects

logger = logging.getLogger("mova.preprocess.loso")

Folds = list[dict[str, list[str] | int]]


def generate_loso(subjects: list[str], val_holdout: bool = True) -> Folds:
    """One fold per subject: that subject is test; an adjacent subject is val; rest train."""
    subs = sorted(subjects)
    folds: Folds = []
    for i, test in enumerate(subs):
        rest = [s for s in subs if s != test]
        val = [rest[i % len(rest)]] if (val_holdout and len(rest) >= 2) else []
        train = [s for s in rest if s not in val]
        folds.append({"fold": i, "test": [test], "val": val, "train": train})
    return folds


def run(interim_dir: Path, datasets: list[str], out_dir: Path) -> dict[str, int]:
    subjects = discover_subjects(interim_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    for ds in datasets:
        subs = subjects.get(ds, [])
        if len(subs) < 2:
            logger.warning("%s: < 2 subjects (%d), skipping LOSO", ds, len(subs))
            continue
        folds = generate_loso(subs)
        payload = {
            "dataset": ds,
            "policy": "leave_one_subject_out",
            "n_subjects": len(subs),
            "n_folds": len(folds),
            "folds": folds,
        }
        (out_dir / f"{ds}.json").write_text(json.dumps(payload, indent=2))
        counts[ds] = len(folds)
        logger.info("%s -> %d LOSO folds (%d subjects)", ds, len(folds), len(subs))
    return counts


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Generate LOSO-CV fold manifests")
    p.add_argument("--interim", type=Path, default=Path("data/interim"))
    p.add_argument("--datasets", default="daphnet_fog,kimore,ui_prmd")
    p.add_argument("--out", type=Path, default=Path("data_manifests/splits/loso"))
    p.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    datasets = [d.strip() for d in args.datasets.split(",") if d.strip()]
    run(args.interim, datasets, args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
