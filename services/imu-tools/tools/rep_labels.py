# Ported from Phoenix 1480ab0:scripts/rep_labels.py
# Adapted for mova: import paths and capture directory only; the logic is unchanged.
"""Shared helpers for the rep-labeling workflow.

Used by two scripts:
- ``label_reps.py`` detects a take's reps and writes its reps CSV;
- ``build_rep_quality_reference.py`` reads the labels back and builds the KNN
  reference sets.

A take is one capture JSONL (``services/imu-gateway/captures/*.jsonl``). Its
reps live next to it in ``<stem>.reps.csv``, one row per rep:

    exercise_id, subject, take, rep, start_ms, end_ms   identity and timing
    range, tempo                                        the labels you edit
    peak_from_rest_deg, rom_degrees, ...                measured features
    angle_00 ... angle_49                               the rep's motion curve

A label is bad / mediocre / good. Leaving it empty, or writing skip, leaves that
rep out of that quality's model.

Only the identity, timing and label columns are read back; features are
recomputed from the capture. Timing is stored as integer milliseconds. So a
spreadsheet re-saving the file (``;`` separators, BOM, reformatted decimals)
cannot corrupt anything that matters. Captures and CSVs are git-ignored: they
are recordings of a person's movement.
"""

from __future__ import annotations

import _path  # noqa: F401  -- puts tools/ on sys.path for the sibling imports below

import csv
import io
import sys
from collections.abc import Mapping
from datetime import datetime
from pathlib import Path
from typing import Any

from mova_imu.analysis.attempt_assessment import AttemptAssessment, assess_attempt
from mova_imu.analysis.exercise_signals import profile_for
from mova_imu.analysis.rep_quality import LABELS, QUALITIES
from tune_reps import load_file_events

# mova: captures live inside services/imu-tools/, not in a sibling service.
DEFAULT_CAPTURE_DIR = Path(__file__).resolve().parents[1] / "captures"
REPS_CSV_SUFFIX = ".reps.csv"
SKIP = "skip"
CURVE_POINTS = 50
IDENTITY_COLUMNS = ("exercise_id", "subject", "take", "rep", "start_ms", "end_ms")
# Re-detected rep boundaries may move this much before the labels are
# considered to point at different reps.
WINDOW_TOLERANCE_MS = 500


def reps_csv_path(capture: Path) -> Path:
    return capture.with_name(capture.stem + REPS_CSV_SUFFIX)


def capture_path(reps_csv: Path) -> Path:
    return reps_csv.with_name(reps_csv.name[: -len(REPS_CSV_SUFFIX)] + ".jsonl")


def assess_capture(
    capture: Path, exercise_id: str
) -> tuple[list[dict[str, Any]], AttemptAssessment]:
    """Load a capture and run the whole-attempt assessment with the exercise's profile.

    Offline takes are recorded under the stay-still protocol, so the quality gate
    is opened here; the rest-level source on the rep report shows whether the
    initial hold was actually found.
    """
    profile = profile_for(exercise_id)
    if profile is None:
        raise ValueError(f"no signal profile for {exercise_id!r}")
    events = load_file_events(str(capture))
    return events, assess_attempt(events, profile, signal_quality={"scoring_permitted": True})


def first_timestamp(events: list[dict[str, Any]]) -> float:
    return min(
        datetime.fromisoformat(str(event["timestamp_gateway"]).replace("Z", "+00:00")).timestamp()
        for event in events
    )


def rep_windows_ms(assessment: AttemptAssessment, origin: float) -> list[tuple[int, int]]:
    """Each rep's start and end as whole milliseconds since the take's first packet."""
    reps = assessment.biomechanics.reps if assessment.biomechanics else ()
    return [
        (round((rep.start_time - origin) * 1000), round((rep.end_time - origin) * 1000))
        for rep in reps
    ]


def rep_curve(assessment: AttemptAssessment, index: int, points: int = CURVE_POINTS) -> list[float]:
    """The rep's movement angle (degrees from rest) resampled to ``points`` samples."""
    segment = assessment.rep_report.segments[index]
    values = assessment.rep_report.flexion_series[segment.start_index : segment.end_index + 1]
    last = len(values) - 1
    curve = []
    for step in range(points):
        position = step * last / (points - 1)
        low = int(position)
        high = min(low + 1, last)
        fraction = position - low
        curve.append(round(values[low] + (values[high] - values[low]) * fraction, 2))
    return curve


def build_rows(
    assessment: AttemptAssessment,
    *,
    exercise_id: str,
    subject: str,
    take: str,
    origin: float,
    labels: Mapping[str, str],
) -> tuple[list[str], list[dict[str, Any]]]:
    """The reps CSV header and rows for one take, labels pre-filled from ``labels``."""
    feature_names = list(dict.fromkeys(name for row in assessment.rep_features for name in row))
    curve_names = [f"angle_{step:02d}" for step in range(CURVE_POINTS)]
    header = [*IDENTITY_COLUMNS, *QUALITIES, *feature_names, *curve_names]
    windows = rep_windows_ms(assessment, origin)
    rows = []
    for index, (features, (start_ms, end_ms)) in enumerate(
        zip(assessment.rep_features, windows, strict=True)
    ):
        row: dict[str, Any] = {
            "exercise_id": exercise_id,
            "subject": subject,
            "take": take,
            "rep": index + 1,
            "start_ms": start_ms,
            "end_ms": end_ms,
            **{quality: labels[quality] for quality in QUALITIES},
        }
        for name in feature_names:
            value = features.get(name)
            row[name] = "" if value is None else round(value, 3)
        row.update(zip(curve_names, rep_curve(assessment, index), strict=True))
        rows.append(row)
    return header, rows


def write_reps_csv(path: Path, header: list[str], rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=header)
        writer.writeheader()
        writer.writerows(rows)


def load_labeled_rows(path: Path) -> list[dict[str, str]]:
    """Read a reps CSV back, tolerating a spreadsheet's re-save (``;``, BOM, reordering).

    Rows are returned in rep order; rep numbers must still run 1..N.
    """
    text = path.read_text(encoding="utf-8-sig")
    header_line = text.splitlines()[0] if text else ""
    try:
        dialect: Any = csv.Sniffer().sniff(header_line, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    rows = [
        {key.strip(): (value or "").strip() for key, value in row.items() if key}
        for row in csv.DictReader(io.StringIO(text), dialect=dialect)
    ]
    rows = [row for row in rows if any(row.values())]
    try:
        rows.sort(key=lambda row: int(float(row["rep"])))
        numbers = [int(float(row["rep"])) for row in rows]
    except (KeyError, ValueError) as error:
        raise ValueError(f"missing or unreadable rep column ({error})") from error
    if numbers != list(range(1, len(rows) + 1)):
        raise ValueError("rep numbers must run 1..N: do not add or delete rows")
    if not rows or not rows[0].get("exercise_id"):
        raise ValueError("no rows, or no exercise_id column")
    return rows


def windows_match(rows: list[dict[str, str]], detected: list[tuple[int, int]]) -> bool:
    if len(rows) != len(detected):
        return False
    for row, (start_ms, end_ms) in zip(rows, detected, strict=True):
        try:
            labeled = (int(float(row["start_ms"])), int(float(row["end_ms"])))
        except (KeyError, ValueError):
            return False
        if abs(labeled[0] - start_ms) > WINDOW_TOLERANCE_MS:
            return False
        if abs(labeled[1] - end_ms) > WINDOW_TOLERANCE_MS:
            return False
    return True


def resolve_labels(rows: list[dict[str, str]], quality: str) -> list[str | None]:
    """One ``quality`` label per rep; None for an empty or skip cell."""
    labels: list[str | None] = []
    for row in rows:
        value = row.get(quality, "").strip().lower()
        if value in ("", SKIP):
            labels.append(None)
        elif value in LABELS:
            labels.append(value)
        else:
            raise ValueError(
                f"rep {row.get('rep')}: {quality} must be one of {', '.join(LABELS)}, "
                f"or empty / {SKIP}; got {value!r}"
            )
    return labels
