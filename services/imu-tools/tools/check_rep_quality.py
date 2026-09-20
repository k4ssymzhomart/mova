# Ported from Phoenix 1480ab0:tools/check_rep_quality.py
# Adapted for mova: import paths and capture directory only; the logic is unchanged.
"""Score one finished capture against a built reference, offline -- no API, no DB.

Run this after ``tools/build_rep_quality_reference.py`` has written a
checkpoint for the exercise, against any capture -- typically a fresh test
take that was *not* one of the recordings the reference was built from.

Example:
  py tools/check_rep_quality.py \
      --file captures/exercise-heel-slide-v1-test-01.jsonl \
      --exercise exercise-heel-slide-v1
"""

from __future__ import annotations

import _path  # noqa: F401  -- puts tools/ on sys.path for the sibling imports below

import argparse
import sys
from pathlib import Path

from mova_imu.analysis.rep_quality import assess_reps
from rep_labels import assess_capture


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--file", required=True, type=Path, help="capture JSONL to score")
    parser.add_argument("--exercise", required=True, help="e.g. exercise-heel-slide-v1")
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

    result = assess_reps(list(assessment.rep_features), args.exercise)
    if result["status"] != "predicted":
        print(
            f"no prediction: {result['reason']} "
            "(build the reference first: py tools/build_rep_quality_reference.py)"
        )
        return 1

    print(
        f"{args.file.name}: {args.exercise}, {len(result['reps'])} reps, "
        f"model {result['model_version']}\n"
    )
    for rep in result["reps"]:
        parts = []
        for quality in result["qualities"]:
            rating = rep[quality]
            if rating["abstained"]:
                parts.append(f"{quality}=abstained")
                continue
            issues = ",".join(issue["code"] for issue in rating["issues"])
            suffix = f" [{issues}]" if issues else ""
            parts.append(f"{quality}={rating['label']} ({rating['confidence']:.0%}){suffix}")
        print(f"  rep {rep['index']:>2}  " + "  ".join(parts))

    print(f"\nsummary: {result['summary']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
