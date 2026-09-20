# Ported from Phoenix 1480ab0:tools/tune_reps.py
# Adapted for mova: import paths and capture directory only; the logic is unchanged.
"""Offline tuner for the deterministic rep counter.

Record a known number of real repetitions, then run this against that data to
see which sensor pair / orientation axis carries the movement and how many
reps each threshold set detects. Use the result to edit
``src/mova_imu/analysis/reps.py``.

This is the one tool allowed to sweep sensor pairs and axes. Every other
mova-facing entry point runs with the exercise's pinned signal profile, so the
live counter and an offline recount can never disagree about which signal they
are reading.

Data source:
  --file <path.jsonl>   a capture JSONL, a gateway-event dump, or a mova
                        `session_frames` export (the shape is detected)

Examples:
  py tools/tune_reps.py --file captures/take.jsonl --expected 8
  py tools/tune_reps.py --file captures/take.jsonl --expected 10 --enter 15 --exit 6
  py tools/tune_reps.py --file captures/take.jsonl --exercise exercise-heel-slide-v1
"""

from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path

from mova_imu.analysis.preprocessing import preprocess_transport_events

ROLES = ("thigh", "shank", "foot")
AXES = ("ori_roll", "ori_pitch", "ori_yaw")
AXIS_SHORT = {"ori_roll": "roll", "ori_pitch": "pitch", "ori_yaw": "yaw"}



def load_file_events(path: str) -> list[dict]:
    rows = [
        json.loads(line)
        for line in Path(path).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    return [normalise(row) for row in rows if normalise(row) is not None]


def normalise(row: dict) -> dict | None:
    """Accept both the gateway-event shape and the capture-file shape."""
    if "sensor_role" in row and "orientation_euler_degrees" in row:
        role = row["sensor_role"]
        euler = row["orientation_euler_degrees"]
        ts = row["timestamp_gateway"]
        accel = (row.get("ax", 0), row.get("ay", 0), row.get("az", 0))
        gyro = (row.get("gx", 0), row.get("gy", 0), row.get("gz", 0))
    elif "sensor" in row and "euler_degrees" in row:
        role = row["sensor"]["role"]
        euler = row["euler_degrees"]
        ts = row["gateway_timestamp"]
        accel = row.get("accelerometer_raw", (0, 0, 0))
        gyro = row.get("gyroscope_raw", (0, 0, 0))
    else:
        return None
    if role not in ROLES or not isinstance(euler, list | tuple) or len(euler) != 3:
        return None
    return {
        "sensor_role": role,
        "timestamp_gateway": ts,
        "ax": int(accel[0]), "ay": int(accel[1]), "az": int(accel[2]),
        "gx": int(gyro[0]), "gy": int(gyro[1]), "gz": int(gyro[2]),
        "orientation_euler_degrees": [float(euler[0]), float(euler[1]), float(euler[2])],
    }


def _wrap(degrees: float) -> float:
    """Map an angle difference into (-180, 180] so the +/-180 wrap does not
    create fake jumps in the flexion signal."""
    return ((degrees + 180.0) % 360.0) - 180.0


def count_cycles(magnitude: list[float], enter: float, exit_: float, min_frames: int) -> int:
    """Same hysteresis state machine as reps.count_repetitions."""
    count = 0
    state = "rest"
    start = 0
    peak = 0.0
    for index, value in enumerate(magnitude):
        if state == "rest":
            if value >= enter:
                state, start, peak = "flexed", index, value
        else:
            peak = max(peak, value)
            if value <= exit_:
                if index - start >= min_frames and peak >= enter:
                    count += 1
                state = "rest"
    return count


def oriented_magnitude(signal: list[float]) -> tuple[list[float], float]:
    baseline = statistics.median(signal)
    sign = 1.0 if (max(signal) - baseline) >= (baseline - min(signal)) else -1.0
    magnitude = [sign * (value - baseline) for value in signal]
    return magnitude, max(magnitude)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--file",
        required=True,
        help="capture JSONL, gateway-event dump, or mova session_frames export",
    )
    parser.add_argument("--expected", type=int, default=None, help="reps you actually did")
    parser.add_argument("--rate", type=float, default=20.0)
    parser.add_argument("--enter", type=float, default=18.0)
    parser.add_argument("--exit", dest="exit_", type=float, default=7.0)
    parser.add_argument("--min-frames", type=int, default=5)
    parser.add_argument("--dump-csv", help="write the best candidate signal to this CSV")
    parser.add_argument(
        "--exercise",
        help="also count with this exercise's pinned signal profile, as the whole-attempt "
        "assessment does (e.g. exercise-step-up-v1)",
    )
    args = parser.parse_args()

    events = load_file_events(args.file)
    return analyse(events, args) or analyse_profile(events, args)


def analyse_profile(events: list[dict], args: argparse.Namespace) -> int:
    """Count with the exercise's pinned signal, rest level from the initial
    stay-still hold and the 10 Hz grid -- exactly what label_reps.py and the
    rep-quality assessment see."""
    if not args.exercise:
        return 0
    from mova_imu.analysis.attempt_assessment import assess_attempt
    from mova_imu.analysis.exercise_signals import profile_for

    profile = profile_for(args.exercise)
    if profile is None:
        print(f"\nno signal profile for {args.exercise}")
        return 1
    assessment = assess_attempt(events, profile, signal_quality={"scoring_permitted": True})
    print(
        f"\nprofile {args.exercise}: {profile.rep_pattern}, signal {profile.primary.label}, "
        f"enter {profile.enter_deg:g} / exit {profile.exit_deg:g}"
    )
    report = assessment.rep_report
    if report is None:
        print(f"assessment {assessment.status}: {assessment.reason}")
        return 1
    line = (
        f"reps: {report.count}  (rest level from {report.baseline}, "
        f"amplitude {report.amplitude_degrees:.1f} deg)"
    )
    if args.expected is not None:
        line += f"  err {report.count - args.expected:+d}"
    print(line)
    if report.baseline != "static_window":
        print("no initial stay-still hold found -- record 3-5 s of stillness first")
    return 0


def analyse(events: list[dict], args: argparse.Namespace) -> int:
    per_role = {r: sum(1 for e in events if e["sensor_role"] == r) for r in ROLES}
    print(f"events: {len(events)}  per role: {per_role}")
    if not events or min(per_role.values()) == 0:
        print("missing a sensor stream -- cannot analyse")
        return 1

    result = preprocess_transport_events(
        events, signal_quality={"scoring_permitted": True},
        target_rate_hz=args.rate, filter_window_samples=1,
    )
    if not result.allowed:
        print(f"preprocessing rejected: {', '.join(result.reasons)}")
        return 1
    frames = list(result.frames)
    print(f"frames: {len(frames)} @ {args.rate} Hz  ({round(len(frames) / args.rate, 1)} s)\n")

    pairs = (("shank", "thigh"), ("shank", "foot"), ("thigh", "foot"))
    candidates: list[tuple[str, list[float], float, int]] = []
    for distal, proximal in pairs:
        for axis in AXES:
            signal = [
                _wrap(float(f["sensors"][distal][axis]) - float(f["sensors"][proximal][axis]))
                for f in frames
            ]
            magnitude, amplitude = oriented_magnitude(signal)
            detected = count_cycles(magnitude, args.enter, args.exit_, args.min_frames)
            name = f"{distal}-{proximal} {AXIS_SHORT[axis]}"
            candidates.append((name, magnitude, amplitude, detected))

    header = f"{'candidate':<20} {'amplitude':>10} {'reps':>6}"
    if args.expected is not None:
        header += f"  {'err':>5}"
    print(header)
    print("-" * len(header))
    candidates.sort(key=lambda c: c[2], reverse=True)
    for name, _magnitude, amplitude, detected in candidates:
        line = f"{name:<20} {amplitude:>9.1f}° {detected:>6}"
        if args.expected is not None:
            line += f"  {detected - args.expected:>+5}"
        print(line)

    best = candidates[0]
    if args.expected is not None:
        exact = [c for c in candidates if c[3] == args.expected and c[2] >= args.enter]
        if exact:
            best = max(exact, key=lambda c: c[2])
    print(f"\nbest candidate: {best[0]}  (amplitude {best[2]:.1f}°, {best[3]} reps)")
    print(
        "reps.py auto-selects the largest roll/pitch pair (yaw excluded -- it "
        "drifts) with enter=18, exit=7. Yaw rows above are diagnostic only; if a "
        "roll/pitch row looks wrong, tune the thresholds or MAX_PLAUSIBLE_SWING_DEG."
    )

    if args.dump_csv:
        rows = ["frame,magnitude_deg"]
        rows += [f"{i},{v:.3f}" for i, v in enumerate(best[1])]
        Path(args.dump_csv).write_text("\n".join(rows), encoding="utf-8")
        print(f"wrote {args.dump_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
