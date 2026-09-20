# Ported from Phoenix 1480ab0:services/imu-gateway/analyze_capture.py
# Adapted for mova: import paths and capture directory only; the logic is unchanged.
"""Health report for a recorded IMU capture (no hardware needed).

Reads a JSONL file written by `capture_wt901ble68.py` and checks every sensor
for the faults that actually bite in practice: low rate, gaps, a frozen or dead
sensor, clipping, orientation glitches, uneven links, plus the same
signal-quality verdict the API gives a calibration window. Non-clinical; it
never counts reps or scores anything.

    python analyze_capture.py captures/exercise-heel-slide-v1-good-good-01.jsonl
    python analyze_capture.py captures/*.jsonl --expect-motion
    python analyze_capture.py take.jsonl --json > report.json

Exit code is 0 for PASS/WARN, 1 for FAIL (2 for unreadable input), so it can
gate a recording session in a script.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from mova_imu.gateway.diagnostics import (
    Sample,
    analyze,
    load_capture,
    render_report,
    to_events,
)


def calibration_window(samples: dict[str, list[Sample]], seconds: float) -> dict[str, list[Sample]]:
    """The first `seconds` of the file, as the API would see it while calibrating."""
    start = min((s[0].t for s in samples.values() if s), default=0.0)
    return {role: [x for x in rows if x.t - start <= seconds] for role, rows in samples.items()}


def api_verdict(samples: dict[str, list[Sample]], seconds: float) -> dict | None:
    try:
        from mova_imu.analysis.signal_quality import evaluate_signal_quality
    except ImportError:
        return None
    window = calibration_window(samples, seconds)
    return evaluate_signal_quality(to_events(window)).as_dict()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Health report for a WT901BLE68 JSONL capture; not clinical use.",
        epilog=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("captures", nargs="+", type=Path)
    parser.add_argument(
        "--expect-motion",
        action="store_true",
        help="FAIL any sensor whose orientation never moves (exercise recordings)",
    )
    parser.add_argument(
        "--calibration-seconds",
        type=float,
        default=5.0,
        help="leading window to run the API signal-quality check on; default: 5",
    )
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args()

    worst = 0
    documents = []
    for path in args.captures:
        try:
            samples, bad_lines = load_capture(path)
        except OSError as error:
            print(f"{path}: cannot read ({error})", file=sys.stderr)
            return 2
        report = analyze(samples, expect_motion=args.expect_motion)
        quality = api_verdict(samples, args.calibration_seconds) if samples else None
        worst = max(worst, 1 if report.verdict == "FAIL" else 0)
        if args.json:
            documents.append(
                {
                    "file": str(path),
                    "verdict": report.verdict,
                    "unparseable_lines": bad_lines,
                    "sync": [report.start_skew_ms, report.end_skew_ms],
                    "sensors": {r: asdict(h) for r, h in report.sensors.items()},
                    "findings": [asdict(f) for f in report.findings],
                    "api_signal_quality": quality,
                }
            )
            continue
        print(f"== {path}")
        if bad_lines:
            print(f"[WARN] rig: {bad_lines} unparseable line(s) skipped")
        print(render_report(report))
        if quality is not None:
            reasons = ", ".join(quality["reasons"]) or "none"
            print(
                f"API signal quality on first {args.calibration_seconds:g}s: "
                f"{quality['level']} (scoring_permitted={quality['scoring_permitted']}; "
                f"reasons: {reasons})"
            )
        print()
    if args.json:
        json.dump(documents if len(documents) > 1 else documents[0], sys.stdout, indent=2)
        print()
    return worst


if __name__ == "__main__":
    raise SystemExit(main())
