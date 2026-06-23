"""Benchmark harness -> the generalization leaderboard JSON (the Benchmark-page source of truth).

Consumes the per-task eval reports (FoG LOSO with and without SSL, HAR with its generalization
breakdown) and emits one ``benchmark/leaderboard.json`` artifact: headline metrics per model, the
SSL-vs-scratch ablation, and the comparison against the honest 0.55-AUROC FoG baseline. Phase 8
renders the Benchmark page straight from this file — nothing hand-typed.

Run:
    python -m mova.eval.benchmark --fog-ssl reports/fog_loso_ssl.json \
        --fog-scratch reports/fog_loso_scratch.json --har reports/har.json \
        --out benchmark/leaderboard.json
"""

from __future__ import annotations

import argparse
import json
import logging
import subprocess
from datetime import UTC, datetime
from pathlib import Path

logger = logging.getLogger("mova.benchmark")

BASELINE_FOG_AUROC = 0.551


def _load(path: Path | None) -> dict | None:
    if path is None or not Path(path).exists():
        return None
    return json.loads(Path(path).read_text())


def _git_sha() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"],
                                       stderr=subprocess.DEVNULL).decode().strip()
    except Exception:
        return "unknown"


def _fog_entry(report: dict, model_id: str) -> dict:
    s = report["summary_tuned"]
    return {
        "model_id": model_id,
        "task": "freezing_of_gait",
        "protocol": f"LOSO-CV ({report['n_folds']} freeze-positive subjects)",
        "warm_start": report["warm_start"],
        "primary_metric": "auroc",
        "metrics": {k: {"mean": v["mean"], "std": v["std"]} for k, v in s.items()},
        "auroc_mean": s["auroc"]["mean"],
        "beats_baseline": report["beats_baseline"],
        "delta_vs_baseline": round(s["auroc"]["mean"] - BASELINE_FOG_AUROC, 4),
    }


def _har_entry(report: dict, model_id: str) -> dict:
    return {
        "model_id": model_id,
        "task": "human_activity_recognition",
        "protocol": "subject-disjoint test split",
        "warm_start": report["warm_start"],
        "primary_metric": "macro_f1",
        "macro_f1_overall": report["macro_f1_overall"],
        "by_dataset": report.get("by_dataset", {}),
        "generalization": report.get("generalization", {}),
    }


def build_leaderboard(
    fog_ssl: Path | None, fog_scratch: Path | None, har: Path | None, out: Path,
    quality: Path | None = None,
) -> dict:
    entries: list[dict] = []
    fs = _load(fog_ssl)
    fsc = _load(fog_scratch)
    h = _load(har)
    q = _load(quality)

    if fs:
        entries.append(_fog_entry(fs, "mova-fog-ssl-loso"))
    if fsc:
        entries.append(_fog_entry(fsc, "mova-fog-scratch-loso"))
    if h:
        entries.append(_har_entry(h, "mova-har"))

    ablations = {}
    if fs and fsc:
        ablations["ssl_vs_scratch_fog_auroc_delta"] = round(
            fs["summary_tuned"]["auroc"]["mean"] - fsc["summary_tuned"]["auroc"]["mean"], 4
        )

    leaderboard = {
        "schema": "mova-benchmark/v1",
        "generated_utc": datetime.now(UTC).isoformat(),
        "git_sha": _git_sha(),
        "baseline": {"fog_auroc": BASELINE_FOG_AUROC,
                     "note": "from-scratch, 12-epoch, single-subject (S08), plain CE, threshold 0.5"},
        "entries": entries,
        "ablations": ablations,
    }
    if q:
        leaderboard["movement_quality"] = q
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(leaderboard, indent=2))
    logger.info("leaderboard -> %s (%d entries)", out, len(entries))
    return leaderboard


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Assemble the Mova benchmark leaderboard JSON")
    p.add_argument("--fog-ssl", type=Path, default=Path("reports/fog_loso_ssl.json"))
    p.add_argument("--fog-scratch", type=Path, default=Path("reports/fog_loso_scratch.json"))
    p.add_argument("--har", type=Path, default=Path("reports/har.json"))
    p.add_argument("--quality", type=Path, default=Path("reports/movement_quality.json"))
    p.add_argument("--out", type=Path, default=Path("benchmark/leaderboard.json"))
    p.add_argument("--log-level", default="INFO")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    build_leaderboard(args.fog_ssl, args.fog_scratch, args.har, args.out, quality=args.quality)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
