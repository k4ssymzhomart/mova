# Vendored from Phoenix 1480ab0:services/imu-gateway/src/phoenix_imu_gateway/diagnostics.py
# Do not edit in mova -- change it upstream in Phoenix and re-copy. See VENDORED.md.
"""Hardware-free health checks for a three-sensor IMU stream.

Technical diagnostics only: no ROM, repetition, score or clinical meaning. The
same functions back the offline `analyze_capture.py` and the live
`selftest_imu.py` dev tools, so a recorded file and a live rig are judged by
identical rules. Default thresholds mirror `services/api/app/signal_quality.py`.
"""

from __future__ import annotations

import json
import math
import statistics
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

ROLES = ("thigh", "shank", "foot")

MIN_SAMPLE_RATE_HZ = 8.0
MAX_GAP_FAIL_SECONDS = 1.0
MAX_GAP_WARN_SECONDS = 0.5
MAX_SYNC_SKEW_MS = 250.0
CLIPPING_RAW_LIMIT = 32_700
MAX_STATIC_GYROSCOPE_RAW = 2000
# Consecutive byte-identical frames before a stream counts as frozen. Real
# sensors are never bit-identical across accel+gyro+euler for this long.
FROZEN_RUN_FRAMES = 20
# Largest plausible orientation change between two consecutive samples.
MAX_EULER_STEP_DEGREES = 60.0
STATIC_WINDOW_SECONDS = 1.0
# Below this peak-to-peak on every euler axis a sensor is considered not moving.
MOTION_FLOOR_DEGREES = 5.0
RATE_SPREAD_WARN = 0.2

FAIL, WARN, INFO = "FAIL", "WARN", "INFO"


@dataclass(frozen=True, slots=True)
class Sample:
    t: float  # seconds on any monotonic axis; only differences are used
    seq: int
    accel: tuple[int, int, int]
    gyro: tuple[int, int, int]
    euler: tuple[float, float, float]
    raw_hex: str | None = None


@dataclass(frozen=True, slots=True)
class Finding:
    level: str
    role: str | None
    code: str
    message: str


@dataclass(slots=True)
class SensorHealth:
    role: str
    frames: int = 0
    duration_s: float = 0.0
    rate_hz: float = 0.0
    median_dt_ms: float = 0.0
    p95_dt_ms: float = 0.0
    max_gap_s: float = 0.0
    sequence_holes: int = 0
    longest_frozen_run: int = 0
    clipped_samples: int = 0
    euler_glitches: int = 0
    quietest_window_gyro_max: int | None = None
    euler_peak_to_peak: tuple[float, float, float] = (0.0, 0.0, 0.0)
    gyro_peak: int = 0


@dataclass(slots=True)
class HealthReport:
    sensors: dict[str, SensorHealth] = field(default_factory=dict)
    start_skew_ms: float | None = None
    end_skew_ms: float | None = None
    findings: list[Finding] = field(default_factory=list)

    @property
    def verdict(self) -> str:
        levels = {finding.level for finding in self.findings}
        return FAIL if FAIL in levels else WARN if WARN in levels else "PASS"


def load_capture(path: str | Path) -> tuple[dict[str, list[Sample]], int]:
    """Read a `capture_wt901ble68.py` JSONL file; return samples per role and bad-line count."""
    by_role: dict[str, list[Sample]] = defaultdict(list)
    bad_lines = 0
    origin: datetime | None = None
    with Path(path).open(encoding="utf-8") as stream:
        for line in stream:
            if not line.strip():
                continue
            try:
                record = json.loads(line)
                moment = datetime.fromisoformat(record["gateway_timestamp"])
                origin = origin or moment
                sample = Sample(
                    t=(moment - origin).total_seconds(),
                    seq=int(record["sequence_number"]),
                    accel=tuple(int(v) for v in record["accelerometer_raw"]),  # type: ignore[arg-type]
                    gyro=tuple(int(v) for v in record["gyroscope_raw"]),  # type: ignore[arg-type]
                    euler=tuple(float(v) for v in record["euler_degrees"]),  # type: ignore[arg-type]
                    raw_hex=record.get("raw_frame_hex"),
                )
                role = str(record["sensor"]["role"])
            except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                bad_lines += 1
                continue
            by_role[role].append(sample)
    return dict(by_role), bad_lines


def to_events(samples_by_role: Mapping[str, Sequence[Sample]]) -> list[dict[str, Any]]:
    """Shape samples like the gateway's normalised events (for `evaluate_signal_quality`)."""
    base = datetime.fromisoformat("2000-01-01T00:00:00+00:00")
    events = []
    for role, samples in samples_by_role.items():
        for sample in samples:
            ax, ay, az = sample.accel
            gx, gy, gz = sample.gyro
            events.append(
                {
                    "sensor_role": role,
                    "timestamp_gateway": (base + timedelta(seconds=sample.t)).isoformat(),
                    "sequence_number": sample.seq,
                    "ax": ax,
                    "ay": ay,
                    "az": az,
                    "gx": gx,
                    "gy": gy,
                    "gz": gz,
                }
            )
    return events


def _wrapped_delta(a: float, b: float) -> float:
    return (b - a + 180.0) % 360.0 - 180.0


def _unwrapped_peak_to_peak(samples: Sequence[Sample]) -> tuple[float, float, float]:
    """Euler range per axis, following angles across the +-180 wrap instead of spanning it."""
    spans = []
    for axis in range(3):
        angle = samples[0].euler[axis]
        low = high = angle
        for previous, current in zip(samples, samples[1:], strict=False):
            angle += _wrapped_delta(previous.euler[axis], current.euler[axis])
            low, high = min(low, angle), max(high, angle)
        spans.append(high - low)
    return (spans[0], spans[1], spans[2])


def _percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(fraction * len(ordered)))]


def _quietest_window_gyro_max(samples: Sequence[Sample], window_s: float) -> int | None:
    """Smallest worst-case |gyro| over any `window_s` slice: how still the sensor ever got."""
    if not samples or samples[-1].t - samples[0].t < window_s:
        return None
    best: int | None = None
    left = 0
    for right, sample in enumerate(samples):
        while sample.t - samples[left].t > window_s:
            left += 1
        if sample.t - samples[left].t < window_s * 0.8:
            continue
        peak = max(abs(v) for s in samples[left : right + 1] for v in s.gyro)
        best = peak if best is None else min(best, peak)
    return best


def analyze_sensor(role: str, samples: Sequence[Sample]) -> tuple[SensorHealth, list[Finding]]:
    health = SensorHealth(role=role, frames=len(samples))
    findings: list[Finding] = []
    if len(samples) < 2:
        findings.append(
            Finding(
                FAIL,
                role,
                "no_data" if not samples else "too_few_frames",
                f"{len(samples)} frame(s) received",
            ),
        )
        return health, findings

    ordered = sorted(samples, key=lambda s: s.t)
    intervals = [b.t - a.t for a, b in zip(ordered, ordered[1:], strict=False)]
    health.duration_s = ordered[-1].t - ordered[0].t
    health.rate_hz = (len(ordered) - 1) / health.duration_s if health.duration_s > 0 else 0.0
    health.median_dt_ms = statistics.median(intervals) * 1000
    health.p95_dt_ms = _percentile(intervals, 0.95) * 1000
    health.max_gap_s = max(intervals)
    health.sequence_holes = sum(
        max(0, b.seq - a.seq - 1) for a, b in zip(ordered, ordered[1:], strict=False)
    )
    health.clipped_samples = sum(
        1 for s in ordered if any(abs(v) >= CLIPPING_RAW_LIMIT for v in (*s.accel, *s.gyro))
    )
    health.gyro_peak = max(abs(v) for s in ordered for v in s.gyro)
    health.euler_peak_to_peak = _unwrapped_peak_to_peak(ordered)
    health.euler_glitches = sum(
        1
        for a, b in zip(ordered, ordered[1:], strict=False)
        if any(
            abs(_wrapped_delta(a.euler[i], b.euler[i])) > MAX_EULER_STEP_DEGREES for i in range(3)
        )
    )
    health.quietest_window_gyro_max = _quietest_window_gyro_max(ordered, STATIC_WINDOW_SECONDS)

    def signature(s: Sample) -> object:
        return s.raw_hex or (s.accel, s.gyro, s.euler)

    run = longest = 1
    for a, b in zip(ordered, ordered[1:], strict=False):
        run = run + 1 if signature(a) == signature(b) else 1
        longest = max(longest, run)
    health.longest_frozen_run = longest

    if health.rate_hz < MIN_SAMPLE_RATE_HZ:
        findings.append(
            Finding(
                FAIL,
                role,
                "low_rate",
                f"{health.rate_hz:.1f} Hz is below the {MIN_SAMPLE_RATE_HZ:g} Hz floor",
            )
        )
    if health.max_gap_s > MAX_GAP_FAIL_SECONDS:
        findings.append(
            Finding(
                FAIL,
                role,
                "prolonged_gap",
                f"{health.max_gap_s:.2f}s without data (limit {MAX_GAP_FAIL_SECONDS:g}s)",
            )
        )
    elif health.max_gap_s > MAX_GAP_WARN_SECONDS:
        findings.append(Finding(WARN, role, "gap", f"{health.max_gap_s:.2f}s without data"))
    if health.longest_frozen_run >= FROZEN_RUN_FRAMES:
        findings.append(
            Finding(
                FAIL,
                role,
                "frozen_stream",
                f"{health.longest_frozen_run} identical frames in a row: sensor stuck or hung",
            )
        )
    if health.clipped_samples:
        findings.append(
            Finding(
                FAIL, role, "clipping", f"{health.clipped_samples} sample(s) at the int16 limit"
            )
        )
    if health.euler_glitches:
        findings.append(
            Finding(
                WARN,
                role,
                "euler_glitch",
                f"{health.euler_glitches} orientation jump(s) over {MAX_EULER_STEP_DEGREES:g} deg "
                "between consecutive samples",
            )
        )
    if health.sequence_holes:
        findings.append(
            Finding(
                WARN,
                role,
                "sequence_holes",
                f"{health.sequence_holes} missing sequence number(s) in the file",
            )
        )
    if (
        health.quietest_window_gyro_max is not None
        and health.quietest_window_gyro_max > MAX_STATIC_GYROSCOPE_RAW
    ):
        findings.append(
            Finding(
                WARN,
                role,
                "no_static_window",
                f"never still for {STATIC_WINDOW_SECONDS:g}s (quietest gyro peak "
                f"{health.quietest_window_gyro_max} > {MAX_STATIC_GYROSCOPE_RAW}): "
                "calibration would report motion",
            )
        )
    return health, findings


def analyze(
    samples_by_role: Mapping[str, Sequence[Sample]],
    *,
    expect_motion: bool = False,
    required_roles: Iterable[str] = ROLES,
) -> HealthReport:
    report = HealthReport()
    for role in required_roles:
        if role not in samples_by_role:
            report.findings.append(Finding(FAIL, role, "missing_role", "no frames from this role"))
    for role, samples in samples_by_role.items():
        health, findings = analyze_sensor(role, samples)
        report.sensors[role] = health
        report.findings.extend(findings)
        if (
            expect_motion
            and health.frames > 1
            and max(health.euler_peak_to_peak) < MOTION_FLOOR_DEGREES
        ):
            report.findings.append(
                Finding(
                    FAIL,
                    role,
                    "dead_sensor",
                    f"orientation never moved more than {MOTION_FLOOR_DEGREES:g} deg although "
                    "motion was expected",
                )
            )

    live = {role: s for role, s in samples_by_role.items() if len(s) >= 2}
    if len(live) >= 2:
        starts = [min(x.t for x in s) for s in live.values()]
        ends = [max(x.t for x in s) for s in live.values()]
        report.start_skew_ms = (max(starts) - min(starts)) * 1000
        report.end_skew_ms = (max(ends) - min(ends)) * 1000
        if report.end_skew_ms > MAX_SYNC_SKEW_MS:
            report.findings.append(
                Finding(
                    # INFO, not WARN: three independent BLE links deliver in bursts, so
                    # this exceeds the limit on essentially every healthy real capture.
                    # A genuinely stalled link is caught by the gap check instead.
                    INFO,
                    None,
                    "sync_skew",
                    f"last samples of the sensors are {report.end_skew_ms:.0f} ms apart "
                    f"(API skew limit {MAX_SYNC_SKEW_MS:g} ms would rate this MEDIUM)",
                )
            )
        rates = [h.rate_hz for h in report.sensors.values() if h.frames > 1]
        if rates and (max(rates) - min(rates)) > RATE_SPREAD_WARN * max(rates):
            report.findings.append(
                Finding(
                    WARN,
                    None,
                    "uneven_rates",
                    "per-sensor rates differ by more than "
                    f"{RATE_SPREAD_WARN:.0%}: "
                    + ", ".join(f"{r}={h.rate_hz:.1f}Hz" for r, h in report.sensors.items()),
                )
            )
    return report


def motion_energy(samples: Sequence[Sample]) -> float:
    """RMS gyro magnitude (raw units): how much a sensor is being moved."""
    if not samples:
        return 0.0
    return math.sqrt(sum(sum(v * v for v in s.gyro) for s in samples) / len(samples))


def identify_moving_sensor(
    samples_by_role: Mapping[str, Sequence[Sample]], *, min_ratio: float = 2.0
) -> tuple[str | None, dict[str, float]]:
    """Which role was physically moved? None if no sensor clearly stood out."""
    energy = {role: motion_energy(samples) for role, samples in samples_by_role.items()}
    if not energy:
        return None, energy
    ranked = sorted(energy.items(), key=lambda item: item[1], reverse=True)
    top_role, top = ranked[0]
    runner_up = ranked[1][1] if len(ranked) > 1 else 0.0
    if top <= 0 or (runner_up > 0 and top / runner_up < min_ratio):
        return None, energy
    return top_role, energy


def render_report(report: HealthReport) -> str:
    """Fixed-width table plus findings, for terminals."""
    lines = [
        "role    frames    Hz  med-dt  p95-dt  max-gap  frozen  clip  jumps  gyro-pk"
        "  euler pp (r/p/y)",
    ]
    for role in ROLES:
        h = report.sensors.get(role)
        if h is None:
            lines.append(f"{role:<6}  (no data)")
            continue
        roll, pitch, yaw = h.euler_peak_to_peak
        lines.append(
            f"{role:<6} {h.frames:>7} {h.rate_hz:>5.1f} {h.median_dt_ms:>5.0f}ms"
            f" {h.p95_dt_ms:>5.0f}ms"
            f" {h.max_gap_s:>6.2f}s {h.longest_frozen_run:>7} {h.clipped_samples:>5}"
            f" {h.euler_glitches:>6} {h.gyro_peak:>8}  {roll:6.1f} {pitch:6.1f} {yaw:6.1f}"
        )
    if report.end_skew_ms is not None:
        lines.append(
            f"sync: connect stagger {report.start_skew_ms:.0f} ms, "
            f"end offset {report.end_skew_ms:.0f} ms"
        )
    for finding in report.findings:
        scope = finding.role or "rig"
        lines.append(f"[{finding.level}] {scope}: {finding.code} - {finding.message}")
    lines.append(f"VERDICT: {report.verdict}")
    return "\n".join(lines)
