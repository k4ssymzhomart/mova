# Ported from Phoenix 1480ab0:scripts/check_execution_score.py
# Adapted for mova: import paths and capture directory only; the logic is unchanged.
"""Score one finished capture with the deterministic Execution Score, offline.

No API, no DB, no trained reference needed -- unlike check_rep_quality.py's
KNN, this just needs the exercise's calibrated targets in
services/api/app/execution_score.py.

Example:
  python scripts/check_execution_score.py \
      --file services/imu-gateway/captures/exercise-heel-slide-v1-test-01.jsonl \
      --exercise exercise-heel-slide-v1 --prescribed 10
"""

from __future__ import annotations

import _path  # noqa: F401  -- puts tools/ on sys.path for the sibling imports below

import argparse
import sys
from pathlib import Path

from mova_imu.analysis.execution_score import assess_execution
from rep_labels import assess_capture


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--file", required=True, type=Path, help="capture JSONL to score")
    parser.add_argument("--exercise", required=True, help="e.g. exercise-heel-slide-v1")
    parser.add_argument(
        "--prescribed", type=int, default=None, help="prescribed rep count, for Volume"
    )
    args = parser.parse_args()

    if not args.file.is_file():
        parser.error(f"no such capture: {args.file}")

    _, assessment = assess_capture(args.file, args.exercise)
    if assessment.status == "blocked":
        print(f"preprocessing rejected the take: {assessment.reason}")
        return 1
    if not assessment.rep_features:
        print("no reps detected in this capture -- nothing to score")
        return 1

    result = assess_execution(
        list(assessment.rep_features), args.exercise, prescribed_reps=args.prescribed
    )
    if result["status"] != "scored":
        print(f"no score: {result['reason']}")
        return 1

    scores = {
        "Correctness": result["correctness"]["score"],
        "Volume": result["volume"]["score"],
        "Target": result["target_achievement"]["score"],
    }
    weights = result["components_used"]
    used = [
        (name, scores[name], weights[name.lower()])
        for name in scores
        if name.lower() in weights
    ]

    print(f"{args.file.name}: {args.exercise}, {len(result['reps'])} valid reps\n")
    for name, score in scores.items():
        note = "" if score is not None else "  (not scored -- left out, weight redistributed)"
        print(f"  {name:<12} {score}{note}")
    print()
    if not used:
        print("  Execution Score = n/a (no component could be scored)\n")
    else:
        terms = [round(score * weight, 2) for _, score, weight in used]
        print(
            "  Execution Score = "
            + " + ".join(f"{name}*{weight}" for name, _, weight in used)
            + "\n                   = "
            + " + ".join(f"{score}*{weight}" for _, score, weight in used)
            + "\n                   = "
            + " + ".join(str(term) for term in terms)
            + f"\n                   = {result['execution_score']}\n"
        )
    for rep in result["reps"]:
        target = rep["target"]["score"]
        correctness = rep["correctness"]["score"]
        metrics = rep["correctness"].get("metrics", {})
        detail = ", ".join(f"{name}={value}" for name, value in metrics.items())
        print(f"  rep {rep['index']:>2}  target={target}  correctness={correctness}  [{detail}]")

    return 0


if __name__ == "__main__":
    sys.exit(main())
