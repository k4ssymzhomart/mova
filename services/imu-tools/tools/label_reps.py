# Ported from Phoenix 1480ab0:scripts/label_reps.py
# Adapted for mova: import paths and capture directory only; the logic is unchanged.
"""Detect the reps of one recorded take and write them to a CSV for labeling.

Run once per capture, right after recording it:

  python scripts/label_reps.py --file services/imu-gateway/captures/heel-good-bad-01.jsonl \
      --exercise exercise-heel-slide-v1 --range good --tempo bad --subject s1 --expected 8

It prints every detected rep, then writes ``heel-good-bad-01.reps.csv`` next to
the capture. The CSV has one row per rep: timing, the ``range`` and ``tempo``
labels pre-filled from --range / --tempo, the measured features, and the rep's
motion curve (angle_00..angle_49). Open it in a spreadsheet and change any rep
that came out differently from what the take was meant to show:
bad / mediocre / good, or leave the cell empty (or skip) to drop that rep from
that quality. Do not add, delete or renumber rows. The script refuses to
overwrite an existing CSV unless --force.

If the detected count differs from --expected, the take is not written: fix the
exercise's signal profile (check it with scripts/tune_reps.py --exercise) or
re-record. Never force labels onto a wrong segmentation.

Recording design: vary one quality per take so the two models can tell a range
problem from a tempo problem. Per exercise: 3 takes good/good, and 2 takes each
of range mediocre, range bad, tempo mediocre, tempo bad (the other quality
good). Every take starts with 3-5 s of stillness; fixed sensor placement.
"""

from __future__ import annotations

import _path  # noqa: F401  -- puts tools/ on sys.path for the sibling imports below

import argparse
import sys
from pathlib import Path

from mova_imu.analysis.attempt_assessment import STEP_PHASE_FEATURES
from mova_imu.analysis.exercise_signals import SIGNAL_PROFILES
from mova_imu.analysis.rep_quality import LABELS
from rep_labels import (
    SKIP,
    assess_capture,
    build_rows,
    first_timestamp,
    reps_csv_path,
    write_reps_csv,
)

BASE_COLUMNS = (
    "peak_from_rest_deg",
    "rom_degrees",
    "duration_seconds",
    "hold_seconds",
    "tempo_ratio",
    "velocity_reversals",
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--file", required=True, type=Path, help="capture JSONL of one take")
    parser.add_argument("--exercise", required=True, choices=sorted(SIGNAL_PROFILES))
    parser.add_argument(
        "--range", required=True, choices=LABELS, help="the range this take was performed with"
    )
    parser.add_argument(
        "--tempo", required=True, choices=LABELS, help="the tempo this take was performed with"
    )
    parser.add_argument("--subject", default="unknown", help="pseudonymous performer id, e.g. s1")
    parser.add_argument("--expected", type=int, help="number of reps actually performed")
    parser.add_argument("--force", action="store_true", help="overwrite an existing reps CSV")
    parser.add_argument("--print-only", action="store_true", help="show the reps, write nothing")
    args = parser.parse_args()

    if not args.file.is_file():
        parser.error(f"no such capture: {args.file}")
    events, assessment = assess_capture(args.file, args.exercise)
    if assessment.status == "blocked":
        print(f"preprocessing rejected the take: {assessment.reason}")
        return 1
    report = assessment.rep_report
    profile = assessment.profile
    print(
        f"{args.file.name}: {args.exercise}, signal {report.proxy}, "
        f"{assessment.frame_count} frames @ {assessment.rate_hz:g} Hz"
    )
    if report.baseline != "static_window":
        print(
            "WARNING: no initial stay-still hold found, rest level is the window median. "
            "Re-record with 3-5 s of stillness at the start."
        )

    columns = list(BASE_COLUMNS) + [signal.name for signal in profile.secondary]
    if profile.rep_pattern == "stillness_delimited":
        columns += list(STEP_PHASE_FEATURES)
    origin = first_timestamp(events)
    print_table(assessment, columns, origin)

    count = report.count
    if count == 0:
        print("no reps detected -- nothing to label")
        return 2
    if args.expected is not None and count != args.expected:
        print(
            f"detected {count} reps, expected {args.expected}: fix the profile or "
            "re-record; not writing the CSV"
        )
        return 2
    if args.print_only:
        return 0

    target = reps_csv_path(args.file)
    if target.exists() and not args.force:
        print(f"{target.name} already exists; pass --force to overwrite it (and its labels)")
        return 1
    header, rows = build_rows(
        assessment,
        exercise_id=args.exercise,
        subject=args.subject,
        take=args.file.stem,
        origin=origin,
        labels={"range": args.range, "tempo": args.tempo},
    )
    write_reps_csv(target, header, rows)
    print(
        f"wrote {target}\n  every rep is range={args.range}, tempo={args.tempo}. Fix any rep "
        f"that came out differently: {' / '.join(LABELS)}, or empty / {SKIP} to leave it out."
    )
    return 0


def print_table(assessment, columns: list[str], origin: float) -> None:
    reps = assessment.biomechanics.reps if assessment.biomechanics else ()
    widths = [max(len(name), 7) for name in columns]
    header = f"{'rep':>4} {'start s':>8} {'end s':>8}  " + " ".join(
        f"{name:>{width}}" for name, width in zip(columns, widths, strict=True)
    )
    print(header)
    print("-" * len(header))
    for rep, row in zip(reps, assessment.rep_features, strict=True):
        cells = []
        for name, width in zip(columns, widths, strict=True):
            value = row.get(name)
            cells.append(f"{'-':>{width}}" if value is None else f"{value:>{width}.2f}")
        print(
            f"{rep.index:>4} {rep.start_time - origin:>8.1f} {rep.end_time - origin:>8.1f}  "
            + " ".join(cells)
        )


if __name__ == "__main__":
    sys.exit(main())
