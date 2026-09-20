# Ported from Phoenix 1480ab0:devtools/analysis.py
# Adapted for mova: paths, imports and branding only; the logic is unchanged.
"""Analysis, labeling and script glue for the IMU dev tools.

Everything here wraps code that already exists (`src/mova_imu/analysis`, the gateway
diagnostics and `scripts/`); it only reshapes results into JSON for the UI.
Technical/non-clinical: none of the numbers are clinical measurements.
"""

from __future__ import annotations

import dataclasses
import math
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]          # services/imu-tools
DEVTOOLS_DIR = Path(__file__).resolve().parent
TOOLS_DIR = ROOT / "tools"
DEFAULT_CAPTURE_DIR = ROOT / "captures"

# `mova_imu` comes from the installed package. Only tools/ needs a path entry:
# this module both imports those scripts by bare name and shells out to them.
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from analyze_capture import api_verdict  # noqa: E402
from mova_imu.analysis.attempt_assessment import (  # noqa: E402
    ASSESSMENT_FILTER_WINDOW,
    ASSESSMENT_RATE_HZ,
    assess_frames,
)
from mova_imu.analysis.execution_score import (  # noqa: E402
    CORRECTNESS_WEIGHT,
    EXECUTION_PROFILES,
    TARGET_WEIGHT,
    VOLUME_WEIGHT,
    assess_execution,
)
from mova_imu.analysis.exercise_signals import SIGNAL_PROFILES, SignalProfile  # noqa: E402
from mova_imu.analysis import rep_quality  # noqa: E402
from mova_imu.analysis.preprocessing import preprocess_transport_events  # noqa: E402
from mova_imu.analysis.reps import rest_level_from_static_window, signal_series  # noqa: E402
from mova_imu.gateway.diagnostics import analyze, load_capture  # noqa: E402
from rep_labels import (  # noqa: E402
    assess_capture,
    build_rows,
    first_timestamp,
    load_labeled_rows,
    reps_csv_path,
    write_reps_csv,
)
from tune_reps import load_file_events  # noqa: E402

LABELS = rep_quality.LABELS
QUALITIES = rep_quality.QUALITIES
MAX_CHART_POINTS = 900
TUNABLE = ("enter_deg", "exit_deg", "min_rep_seconds", "still_rate_dps", "min_still_seconds")
SCRIPTS = {
    "build_reference": "build_rep_quality_reference.py",
    "tune": "tune_reps.py",
    "score": "check_execution_score.py",
    "quality": "check_rep_quality.py",
}


def clean(value: Any) -> Any:
    """Make a structure JSON-safe: non-finite floats become None."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {str(key): clean(item) for key, item in value.items()}
    if isinstance(value, list | tuple | set):
        return [clean(item) for item in value]
    return value


def exercises() -> list[dict[str, Any]]:
    result = []
    for exercise_id, profile in SIGNAL_PROFILES.items():
        result.append(
            {
                "id": exercise_id,
                "profile": profile.as_dict(),
                "has_execution_profile": exercise_id in EXECUTION_PROFILES,
                "has_reference": bool(rep_quality.load_models(exercise_id)),
            }
        )
    return result


def profile_with(exercise_id: str, overrides: dict[str, Any] | None = None) -> SignalProfile:
    profile = SIGNAL_PROFILES.get(exercise_id)
    if profile is None:
        raise ValueError(f"no signal profile for {exercise_id!r}")
    changes = {}
    for name in TUNABLE:
        value = (overrides or {}).get(name)
        if value not in (None, ""):
            changes[name] = float(value)
    return dataclasses.replace(profile, **changes) if changes else profile


def _decimate(values: list[Any], limit: int = MAX_CHART_POINTS) -> list[Any]:
    stride = max(1, math.ceil(len(values) / limit))
    if stride == 1:
        return values
    thinned = values[::stride]
    if values and thinned[-1] is not values[-1]:
        thinned.append(values[-1])
    return thinned


def analyze_events(
    events: list[dict[str, Any]], profile: SignalProfile, *, prescribed_reps: int | None = None
) -> dict[str, Any]:
    """Preprocess -> reps -> biomechanics -> Execution Score -> KNN, exactly as the API does."""
    pre = preprocess_transport_events(
        events,
        signal_quality={"scoring_permitted": True},
        target_rate_hz=ASSESSMENT_RATE_HZ,
        filter_window_samples=ASSESSMENT_FILTER_WINDOW,
    )
    if not pre.allowed:
        return {"status": "blocked", "reason": ",".join(pre.reasons), "frames": 0}
    frames = list(pre.frames)
    assessment = assess_frames(frames, profile, rate_hz=ASSESSMENT_RATE_HZ)
    report = assessment.rep_report
    epoch = [float(frame["timestamp_gateway"]) for frame in frames]
    origin = epoch[0] if epoch else 0.0
    times = [round(moment - origin, 3) for moment in epoch]
    angle = (
        list(report.flexion_series) if report and len(report.flexion_series) == len(times) else []
    )

    secondary = []
    for signal in profile.secondary:
        raw = signal_series(frames, signal.spec) if frames else []
        rest = rest_level_from_static_window(raw, epoch) if raw else None
        if rest is None and raw:
            rest = sorted(raw)[len(raw) // 2]
        secondary.append(
            {
                "name": signal.name,
                "measure": signal.measure,
                "values": _decimate([round(value - rest, 2) for value in raw]) if raw else [],
            }
        )

    metrics = assessment.biomechanics.reps if assessment.biomechanics else ()
    reps = []
    segments = []
    for index, features in enumerate(assessment.rep_features):
        segment = report.segments[index]
        segments.append(
            {
                "index": index + 1,
                "start": times[segment.start_index],
                "end": times[segment.end_index],
                "peak": times[segment.peak_index],
            }
        )
        metric = dataclasses.asdict(metrics[index]) if index < len(metrics) else {}
        reps.append(
            {
                "index": index + 1,
                "start_s": times[segment.start_index],
                "end_s": times[segment.end_index],
                "features": features,
                "metrics": metric,
            }
        )

    rep_features = list(assessment.rep_features)
    execution: dict[str, Any] | None = None
    knn: dict[str, Any] | None = None
    if rep_features:
        execution = assess_execution(
            rep_features, profile.exercise_id, prescribed_reps=prescribed_reps
        )
        try:
            knn = rep_quality.assess_reps(rep_features, profile.exercise_id)
        except Exception as error:  # a broken checkpoint must not blank the whole view
            knn = {"status": "error", "reason": str(error)}

    bio = assessment.biomechanics
    stamps = _decimate(list(range(len(times))))
    return {
        "status": assessment.status,
        "reason": assessment.reason,
        "frames": len(frames),
        "rate_hz": ASSESSMENT_RATE_HZ,
        "duration_s": times[-1] if times else 0.0,
        "proxy": report.proxy if report else None,
        "baseline": report.baseline if report else None,
        "amplitude_deg": report.amplitude_degrees if report else 0.0,
        "rep_count": report.count if report else 0,
        "angle_now": angle[-1] if angle else None,
        "thresholds": {"enter_deg": profile.enter_deg, "exit_deg": profile.exit_deg},
        "profile": profile.as_dict(),
        "series": {
            "t": [times[i] for i in stamps],
            "angle": [round(angle[i], 2) for i in stamps] if angle else [],
        },
        "secondary": secondary,
        "segments": segments,
        "reps": reps,
        "execution": execution,
        "score_weights": {
            "volume": VOLUME_WEIGHT,
            "target": TARGET_WEIGHT,
            "correctness": CORRECTNESS_WEIGHT,
        },
        "knn": knn,
        "biomechanics_summary": bio.summary if bio else None,
        "limitations": list(bio.limitations) if bio else [],
    }


def health_dict(report: Any) -> dict[str, Any]:
    return {
        "verdict": report.verdict,
        "sensors": {role: dataclasses.asdict(h) for role, h in report.sensors.items()},
        "findings": [dataclasses.asdict(f) for f in report.findings],
        "start_skew_ms": report.start_skew_ms,
        "end_skew_ms": report.end_skew_ms,
    }


# ---------------------------------------------------------------- captures


def resolve_capture(capture_dir: Path, name: str) -> Path:
    """A capture file by bare name; refuses anything outside the captures directory."""
    path = (capture_dir / Path(name).name).resolve()
    if path.parent != capture_dir.resolve() or path.suffix != ".jsonl":
        raise ValueError(f"not a capture file: {name!r}")
    if not path.is_file():
        raise FileNotFoundError(name)
    return path


def guess_exercise(name: str) -> str | None:
    matches = [exercise_id for exercise_id in SIGNAL_PROFILES if exercise_id in name]
    return max(matches, key=len) if matches else None


def list_captures(capture_dir: Path) -> list[dict[str, Any]]:
    files = sorted(capture_dir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    return [
        {
            "name": path.name,
            "size_kb": round(path.stat().st_size / 1024, 1),
            "modified": path.stat().st_mtime,
            "exercise": guess_exercise(path.name),
            "labeled": reps_csv_path(path).exists(),
            "synthetic": path.name.startswith(("sim-", "replay-")),
        }
        for path in files
    ]


def analyze_capture_file(
    capture_dir: Path,
    name: str,
    exercise_id: str,
    *,
    prescribed_reps: int | None,
    overrides: dict[str, Any] | None,
    calibration_seconds: float = 5.0,
) -> dict[str, Any]:
    path = resolve_capture(capture_dir, name)
    profile = profile_with(exercise_id, overrides)
    events = load_file_events(str(path))
    if not events:
        return {"status": "empty", "reason": "no readable packets in this file"}
    result = analyze_events(events, profile, prescribed_reps=prescribed_reps)
    result["file"] = path.name
    result["packets"] = len(events)
    try:
        samples, bad_lines = load_capture(path)
        result["health"] = health_dict(analyze(samples, expect_motion=True))
        result["health"]["unparseable_lines"] = bad_lines
        result["quality"] = api_verdict(samples, calibration_seconds)
        result["quality_window_s"] = calibration_seconds
    except (OSError, ValueError, KeyError) as error:
        result["health"] = None
        result["health_error"] = str(error)
    return result


# ------------------------------------------------------------------ labels


def labels_get(capture_dir: Path, name: str) -> dict[str, Any]:
    csv_path = reps_csv_path(resolve_capture(capture_dir, name))
    if not csv_path.exists():
        return {"exists": False, "rows": []}
    rows = load_labeled_rows(csv_path)
    columns = ("rep", "start_ms", "end_ms", *QUALITIES, "peak_from_rest_deg", "rom_degrees",
               "duration_seconds", "tempo_ratio")  # fmt: skip
    return {
        "exists": True,
        "file": csv_path.name,
        "rows": [{column: row.get(column, "") for column in columns} for row in rows],
    }


def labels_create(
    capture_dir: Path,
    name: str,
    *,
    exercise_id: str,
    range_label: str,
    tempo_label: str,
    subject: str,
    expected: int | None,
    force: bool,
) -> dict[str, Any]:
    """Same rules as tools/label_reps.py: never write labels onto a wrong segmentation."""
    path = resolve_capture(capture_dir, name)
    events, assessment = assess_capture(path, exercise_id)
    if assessment.status == "blocked":
        return {"ok": False, "error": f"preprocessing rejected the take: {assessment.reason}"}
    count = assessment.rep_report.count if assessment.rep_report else 0
    if count == 0:
        return {"ok": False, "error": "no reps detected - nothing to label"}
    if expected is not None and count != expected:
        return {
            "ok": False,
            "error": f"detected {count} reps, expected {expected}: fix the profile or re-record",
        }
    target = reps_csv_path(path)
    if target.exists() and not force:
        return {"ok": False, "error": f"{target.name} already exists (tick 'overwrite')"}
    header, rows = build_rows(
        assessment,
        exercise_id=exercise_id,
        subject=subject or "unknown",
        take=path.stem,
        origin=first_timestamp(events),
        labels={"range": range_label, "tempo": tempo_label},
    )
    write_reps_csv(target, header, rows)
    return {"ok": True, "file": target.name, "reps": count}


def labels_save(capture_dir: Path, name: str, labels: list[dict[str, str]]) -> dict[str, Any]:
    csv_path = reps_csv_path(resolve_capture(capture_dir, name))
    rows = load_labeled_rows(csv_path)
    by_rep = {int(item["rep"]): item for item in labels}
    for row in rows:
        item = by_rep.get(int(float(row["rep"])))
        if item is None:
            continue
        for quality in QUALITIES:
            value = str(item.get(quality, "")).strip().lower()
            if value not in ("", "skip", *LABELS):
                return {"ok": False, "error": f"rep {row['rep']}: bad {quality} label {value!r}"}
            row[quality] = value
    write_reps_csv(csv_path, list(rows[0].keys()), rows)
    return {"ok": True, "file": csv_path.name}


def run_script(name: str, args: list[str], timeout: float = 240.0) -> dict[str, Any]:
    """Run one of the whitelisted scripts/ files and return its output.

    A script that exits non-zero (e.g. "no reps detected") is still a normal answer:
    ``ok`` is about the request, ``success`` about the script's exit code.
    """
    script = SCRIPTS.get(name)
    if script is None:
        return {"ok": False, "error": f"unknown script {name!r}"}
    command = [sys.executable, str(TOOLS_DIR / script), *args]
    shown = " ".join(["python", f"tools/{script}", *args])
    try:
        done = subprocess.run(
            command,
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
    except subprocess.TimeoutExpired:
        return {
            "ok": True,
            "success": False,
            "exit_code": None,
            "output": f"timed out after {timeout:g}s",
            "command": shown,
        }
    rep_quality.reset_reference_cache()
    return {
        "ok": True,
        "success": done.returncode == 0,
        "exit_code": done.returncode,
        "output": (done.stdout + done.stderr).strip(),
        "command": shown,
    }


def score_args(path: Path, exercise_id: str, prescribed: int | None) -> list[str]:
    args = ["--file", str(path), "--exercise", exercise_id]
    if prescribed:
        args += ["--prescribed", str(prescribed)]
    return args


SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$")
