# Ported from Phoenix 1480ab0:tools/build_rep_quality_reference.py
# Adapted for mova: import paths and capture directory only; the logic is unchanged.
"""Build per-exercise range and tempo reference sets from labeled takes.

  py tools/build_rep_quality_reference.py                  # every labeled exercise
  py tools/build_rep_quality_reference.py --exercise exercise-step-up-v1 --k 3
  py tools/build_rep_quality_reference.py --dry-run        # report only, write nothing

For each ``*.reps.csv`` in --captures (written by label_reps.py):
1. re-detect the take's reps with the current signal profile;
2. check they are still the reps that were labeled (same count, same times);
3. join each quality's labels to the per-rep feature rows. Empty or skip cells
   leave a rep out of that quality only.

Then, per exercise and quality:
1. report leave-one-recording-out cross-validation, plus leave-one-subject-out
   with 2+ subjects, against the always-predict-the-majority baseline;
2. write the qualities that beat it to
   ``src/mova_imu/analysis/reference_sets/<exercise_id>.json``, which
   the API loads for shadow assessment. A quality that does not beat the
   baseline is left out unless --force.
"""

from __future__ import annotations

import _path  # noqa: F401  -- puts tools/ on sys.path for the sibling imports below

import argparse
import json
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from mova_imu.analysis import rep_quality
from mova_imu.analysis.rep_quality import (
    LABELS,
    QUALITIES,
    fit_reference,
    leave_one_recording_out,
    models_to_json,
)
from rep_labels import (
    DEFAULT_CAPTURE_DIR,
    REPS_CSV_SUFFIX,
    assess_capture,
    capture_path,
    first_timestamp,
    load_labeled_rows,
    rep_windows_ms,
    resolve_labels,
    windows_match,
)


@dataclass
class QualityData:
    rows: list[dict[str, float | None]] = field(default_factory=list)
    labels: list[str] = field(default_factory=list)
    recordings: list[str] = field(default_factory=list)
    subjects: list[str] = field(default_factory=list)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--captures", type=Path, default=DEFAULT_CAPTURE_DIR)
    parser.add_argument("--exercise", help="only build this exercise id")
    parser.add_argument("--k", type=int, default=rep_quality.DEFAULT_K)
    parser.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    parser.add_argument(
        "--force", action="store_true", help="write a quality even when it misses the baseline"
    )
    args = parser.parse_args()

    data = collect(args.captures, args.exercise)
    if not data:
        print(f"no usable labeled takes in {args.captures}")
        return 1
    written = 0
    for exercise_id, per_quality in sorted(data.items()):
        written += build(exercise_id, per_quality, args)
    return 0 if written or args.dry_run else 1


def collect(captures: Path, only_exercise: str | None) -> dict[str, dict[str, QualityData]]:
    data: dict[str, dict[str, QualityData]] = defaultdict(
        lambda: {quality: QualityData() for quality in QUALITIES}
    )
    for reps_file in sorted(captures.glob(f"*{REPS_CSV_SUFFIX}")):
        try:
            rows = load_labeled_rows(reps_file)
        except ValueError as error:
            print(f"skip {reps_file.name}: {error}")
            continue
        exercise_id = rows[0]["exercise_id"]
        subject = rows[0].get("subject") or "unknown"
        if only_exercise and exercise_id != only_exercise:
            continue
        capture = capture_path(reps_file)
        if not capture.is_file():
            print(f"skip {reps_file.name}: capture {capture.name} is missing")
            continue
        events, assessment = assess_capture(capture, exercise_id)
        if assessment.status != "assessed":
            print(f"skip {capture.name}: {assessment.status} ({assessment.reason})")
            continue
        if not windows_match(rows, rep_windows_ms(assessment, first_timestamp(events))):
            print(
                f"skip {capture.name}: re-detected reps no longer match the labeled ones; "
                "re-run label_reps.py --force and re-check the labels"
            )
            continue
        for quality in QUALITIES:
            try:
                labels = resolve_labels(rows, quality)
            except ValueError as error:
                print(f"skip {reps_file.name} [{quality}]: {error}")
                continue
            bucket = data[exercise_id][quality]
            for features, label in zip(assessment.rep_features, labels, strict=True):
                if label is None:
                    continue
                bucket.rows.append(dict(features))
                bucket.labels.append(label)
                bucket.recordings.append(capture.stem)
                bucket.subjects.append(subject)
    return dict(data)


def build(exercise_id: str, per_quality: dict[str, QualityData], args: argparse.Namespace) -> int:
    print(f"\n{'=' * 64}\n{exercise_id}")
    model_version = f"{exercise_id}-knn-{datetime.now(UTC).strftime('%Y%m%d%H%M')}"
    models = {}
    evaluation: dict[str, Any] = {}
    for quality in QUALITIES:
        data = per_quality[quality]
        takes = sorted(set(data.recordings))
        support = Counter(data.labels)
        print(
            f"  [{quality}] {len(data.rows)} reps from {len(takes)} takes: "
            + ", ".join(f"{label} {support[label]}" for label in LABELS)
        )
        if len(takes) < 2 or len(support) < 2:
            print("    not enough data: need 2+ takes and 2+ different labels")
            continue
        by_recording = leave_one_recording_out(
            data.rows, data.labels, data.recordings,
            exercise_id=exercise_id, quality=quality, k=args.k,
        )
        print_evaluation("leave-one-recording-out", by_recording)
        by_subject = None
        if len(set(data.subjects)) >= 2:
            by_subject = leave_one_recording_out(
                data.rows, data.labels, data.subjects,
                exercise_id=exercise_id, quality=quality, k=args.k,
            )
            print_evaluation("leave-one-subject-out", by_subject)
        accuracy = by_recording["accuracy"]
        beats = accuracy is not None and accuracy > by_recording["majority_baseline_accuracy"]
        evaluation[quality] = {
            "leave_one_recording_out": by_recording,
            "leave_one_subject_out": by_subject,
            "beats_majority_baseline": beats,
        }
        if not beats and not args.force:
            print("    does NOT beat the majority baseline -- left out (record more takes)")
            continue
        try:
            reference = fit_reference(
                data.rows, data.labels, data.recordings,
                exercise_id=exercise_id, quality=quality, model_version=model_version, k=args.k,
            )
        except ValueError as error:
            print(f"    cannot fit: {error}")
            continue
        models[quality] = reference
        print(
            f"    features: {', '.join(reference.feature_names)}; k={reference.k}, "
            f"abstain beyond distance {reference.abstain_distance:.3f}"
        )

    if not models:
        print("  nothing to write")
        return 0
    if args.dry_run:
        print(f"  dry run -- would write {', '.join(models)}")
        return 0
    payload = models_to_json(models)
    payload["evaluation"] = evaluation
    target = rep_quality.REFERENCE_DIR / f"{exercise_id}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=1) + "\n", encoding="utf-8")
    print(f"  wrote {target} ({model_version}: {', '.join(models)})")
    return 1


def print_evaluation(title: str, report: dict[str, Any]) -> None:
    def pct(value: float | None) -> str:
        return "n/a" if value is None else f"{value:.0%}"

    print(
        f"    {title}: accuracy {pct(report['accuracy'])} on {report['assessed']}/"
        f"{report['reps']} rated reps (abstained {pct(report['abstain_rate'])}), "
        f"macro-F1 {report['macro_f1']}, majority baseline "
        f"{pct(report['majority_baseline_accuracy'])}"
    )
    columns = (*LABELS, "abstained")
    print("      true \\ predicted " + " ".join(f"{name:>9}" for name in columns))
    for truth in LABELS:
        counts = report["confusion"][truth]
        print(f"      {truth:>17} " + " ".join(f"{counts[name]:>9}" for name in columns))


if __name__ == "__main__":
    sys.exit(main())
