# Vendored from Phoenix 1480ab0:services/api/app/biomechanics.py
# Do not edit in mova -- change it upstream in Phoenix and re-copy. See VENDORED.md.
"""Deterministic, explainable per-repetition biomechanics on preprocessed frames.

Stage 8 of IMPLEMENTATION_PLAN.md: ROM, tempo (flexion / extension / hold split)
and smoothness are computed here as non-ML metrics from the same frames the
shadow model sees, so the deterministic and ML branches stay independent and
separately auditable.

The rep boundaries are carried on the ``RepReport`` (``segments`` + ``flexion_series``) -- today the
deterministic detector in ``app.reps`` fills them, later a trained model that
emits rep boundaries produces the same structure and swaps in at the call site
with no change here.

Non-clinical. The flexion angle is a device-orientation proxy -- the
auto-selected leg-segment roll/pitch difference from ``app.reps`` -- not an
anatomical knee angle. Capture rate is not fixed (~10-20 Hz today, and the
nominal 20 Hz preprocessing grid is interpolated when the hardware runs
slower), so every duration and derivative below is driven by real frame
timestamps and each rep carries how much of it was reconstructed by
interpolation.
"""

from __future__ import annotations

import math
import statistics
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from typing import Any

from .reps import MIN_FRAMES, RepReport, RepSegment

# Engineering defaults for the dev scaffold, not clinical thresholds.
HOLD_BAND_DEG = 5.0  # dwell within this many degrees of peak flexion counts as a hold
SMOOTHNESS_MAX_INTERP_FRACTION = 0.5  # above this, a rep's dimensionless jerk is withheld
RATE_STABLE_TOLERANCE = 0.25  # |effective / grid - 1| beyond this marks the window rate-unstable
MIN_SMOOTHNESS_FRAMES = 5  # need >= 3 jerk samples (three finite differences) for a stable RMS
# |d(theta)/dt| below this is sensor noise, not a change of direction: a held
# position at 10-20 Hz with ~0.2 deg orientation noise already reads a few deg/s.
REVERSAL_DEADBAND_DPS = 10.0

_LIMITATIONS: tuple[str, ...] = (
    "Flexion angle is a device-orientation proxy (auto-selected leg-segment "
    "roll/pitch difference), not an anatomical knee angle.",
    "Engineering thresholds, not a clinically approved valid-repetition definition.",
    "Capture rate is unstable (~10-20 Hz, subject to change) and the 20 Hz grid is "
    "interpolated when hardware is slower; smoothness/jerk are rate-dependent and "
    "partly an interpolation artifact.",
    "Smoothness is sampled below rates validated for clinical jerk/spectral analysis.",
    "calibrated_rom_degrees is not populated yet; it awaits a quaternion baseline from "
    "static calibration.",
)


@dataclass(frozen=True, slots=True)
class RepMetrics:
    index: int  # 1-based order within the window
    start_time: float
    end_time: float
    duration_seconds: float
    effective_sample_rate_hz: float  # (frames_in_segment - 1) / duration
    interpolated_fraction: float  # share of segment frames flagged interpolated_over_gap
    rom_degrees: float  # max(theta) - min(theta) over the segment
    peak_flexion_degrees: float  # max(theta) - theta[start]
    calibrated_rom_degrees: float | None  # reserved for the quaternion path
    flexion_seconds: float  # peak_time - start_time
    extension_seconds: float  # end_time - peak_time
    hold_seconds: float  # dwell within HOLD_BAND_DEG of peak, around the peak
    tempo_ratio: float | None  # flexion_seconds / extension_seconds
    rms_jerk_dps3: float  # sqrt(mean(jerk^2)) of the flexion proxy
    log_dimensionless_jerk: float | None  # LDLJ; None if degenerate or heavily interpolated
    velocity_reversals: int  # sign changes in d(theta)/dt (a smooth rep is ~1-2)


@dataclass(frozen=True, slots=True)
class BiomechanicsReport:
    status: str  # "computed" | "insufficient_frames" | "no_reps"
    reason: str | None
    proxy: str
    frame_count: int
    rate: dict[str, Any]  # {grid_hz, effective_hz, source_hz_by_role, stable}
    reps: tuple[RepMetrics, ...]
    summary: dict[str, Any]
    calibrated: bool
    limitations: tuple[str, ...]

    def as_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["reps"] = [asdict(rep) for rep in self.reps]
        payload["limitations"] = list(self.limitations)
        return payload


def compute_biomechanics(
    frames: list[dict[str, Any]],
    rep_report: RepReport,
    *,
    source_sample_rates_hz: Mapping[str, float] | None = None,
    calibration: dict[str, Any] | None = None,  # reserved; unused until the quaternion path
) -> BiomechanicsReport:
    """Per-rep ROM / tempo / smoothness plus session aggregates, timestamp-driven.

    ``rep_report`` carries both the boundaries (``segments``) and the exact
    oriented flexion signal the detector ran on (``flexion_series``), so this
    engine never re-derives -- and never re-derives a possibly different axis.
    """
    frames = list(frames)
    frame_count = len(frames)
    segments = rep_report.segments
    proxy = rep_report.proxy
    source_rates = {
        role: float(rate) for role, rate in dict(source_sample_rates_hz or {}).items()
    }

    interpolated_fraction = _interpolated_fraction(frames)

    if frame_count < MIN_FRAMES:
        return BiomechanicsReport(
            status="insufficient_frames",
            reason=f"need at least {MIN_FRAMES} frames",
            proxy=proxy,
            frame_count=frame_count,
            rate=_rate_block(
                frames, source_rates, effective_hz=None, interpolated_fraction=interpolated_fraction
            ),
            reps=(),
            summary={},
            calibrated=False,
            limitations=_LIMITATIONS,
        )

    theta = list(rep_report.flexion_series)
    times = [float(frame["timestamp_gateway"]) for frame in frames]
    window_seconds = times[-1] - times[0]
    effective_hz = (frame_count - 1) / window_seconds if window_seconds > 0 else None
    rate = _rate_block(
        frames, source_rates, effective_hz=effective_hz, interpolated_fraction=interpolated_fraction
    )

    if not segments:
        return BiomechanicsReport(
            status="no_reps",
            reason="no completed repetitions in window",
            proxy=proxy,
            frame_count=frame_count,
            rate=rate,
            reps=(),
            summary={
                "rep_count": 0,
                "active_seconds": 0.0,
                "window_seconds": round(max(0.0, window_seconds), 4),
                "paused_seconds": round(max(0.0, window_seconds), 4),
            },
            calibrated=False,
            limitations=_LIMITATIONS,
        )

    reps = tuple(
        _rep_metrics(index + 1, segment, theta, times, frames)
        for index, segment in enumerate(segments)
    )
    return BiomechanicsReport(
        status="computed",
        reason=None,
        proxy=proxy,
        frame_count=frame_count,
        rate=rate,
        reps=reps,
        summary=_summarize(reps, window_seconds),
        calibrated=False,
        limitations=_LIMITATIONS,
    )


def _rep_metrics(
    index: int,
    segment: RepSegment,
    theta: list[float],
    times: list[float],
    frames: list[dict[str, Any]],
) -> RepMetrics:
    start, end, peak = segment.start_index, segment.end_index, segment.peak_index
    seg_theta = theta[start : end + 1]
    seg_times = times[start : end + 1]
    span = len(seg_theta)
    duration = segment.end_time - segment.start_time
    effective_hz = (span - 1) / duration if duration > 0 and span > 1 else 0.0

    interpolated = sum(
        1
        for i in range(start, end + 1)
        if bool(frames[i].get("flags", {}).get("interpolated_over_gap", False))
    )
    interpolated_fraction = interpolated / span if span else 0.0

    rom = max(seg_theta) - min(seg_theta)
    peak_flexion = max(seg_theta) - seg_theta[0]
    flexion_seconds = segment.peak_time - segment.start_time
    extension_seconds = segment.end_time - segment.peak_time
    hold_seconds = _hold_seconds(theta, times, start, end, peak)
    tempo_ratio = flexion_seconds / extension_seconds if extension_seconds > 0 else None

    velocity_reversals = _sign_changes(_derivative(seg_theta, seg_times))
    rms_jerk, ldlj = _smoothness(seg_theta, duration, rom, interpolated_fraction)

    return RepMetrics(
        index=index,
        start_time=round(segment.start_time, 4),
        end_time=round(segment.end_time, 4),
        duration_seconds=round(duration, 4),
        effective_sample_rate_hz=round(effective_hz, 4),
        interpolated_fraction=round(interpolated_fraction, 4),
        rom_degrees=round(rom, 3),
        peak_flexion_degrees=round(peak_flexion, 3),
        calibrated_rom_degrees=None,
        flexion_seconds=round(flexion_seconds, 4),
        extension_seconds=round(extension_seconds, 4),
        hold_seconds=round(hold_seconds, 4),
        tempo_ratio=round(tempo_ratio, 4) if tempo_ratio is not None else None,
        rms_jerk_dps3=round(rms_jerk, 4),
        log_dimensionless_jerk=round(ldlj, 4) if ldlj is not None else None,
        velocity_reversals=velocity_reversals,
    )


def _hold_seconds(
    theta: list[float], times: list[float], start: int, end: int, peak: int
) -> float:
    """Seconds the proxy stays within HOLD_BAND_DEG of its peak, contiguous around it."""
    threshold = theta[peak] - HOLD_BAND_DEG
    left = peak
    while left - 1 >= start and theta[left - 1] >= threshold:
        left -= 1
    right = peak
    while right + 1 <= end and theta[right + 1] >= threshold:
        right += 1
    return times[right] - times[left]


def _derivative(values: list[float], times: list[float]) -> list[float]:
    """First difference divided by the real timestamp delta (0 on a non-positive dt)."""
    out: list[float] = []
    for i in range(len(values) - 1):
        dt = times[i + 1] - times[i]
        out.append((values[i + 1] - values[i]) / dt if dt > 0 else 0.0)
    return out


def _sign_changes(series: list[float]) -> int:
    """Direction changes of the velocity, ignoring the noise deadband around zero."""
    changes = 0
    previous = 0.0
    for value in series:
        if abs(value) < REVERSAL_DEADBAND_DPS:
            continue
        sign = math.copysign(1.0, value)
        if previous != 0.0 and sign != previous:
            changes += 1
        previous = sign
    return changes


def _smoothness(
    seg_theta: list[float], duration: float, rom: float, interpolated_fraction: float
) -> tuple[float, float | None]:
    """RMS jerk (deg/s^3) and log dimensionless jerk of the flexion proxy.

    The jerk chain uses the segment's mean sample spacing; between-rep and
    window-level rate variation is carried separately by
    ``RepMetrics.effective_sample_rate_hz`` and the timestamp-driven durations.
    LDLJ follows Balasubramanian et al. (2015): ``dlj = (D^3 / A^2) * int j^2 dt``.
    """
    span = len(seg_theta)
    if span < MIN_SMOOTHNESS_FRAMES or duration <= 0:
        return 0.0, None
    dt = duration / (span - 1)
    d1 = [seg_theta[i + 1] - seg_theta[i] for i in range(span - 1)]
    d2 = [d1[i + 1] - d1[i] for i in range(len(d1) - 1)]
    d3 = [d2[i + 1] - d2[i] for i in range(len(d2) - 1)]
    if not d3:
        return 0.0, None
    jerk = [value / dt**3 for value in d3]
    rms_jerk = math.sqrt(sum(j * j for j in jerk) / len(jerk))
    if rom <= 0 or interpolated_fraction > SMOOTHNESS_MAX_INTERP_FRACTION:
        return rms_jerk, None
    integral = sum(j * j for j in jerk) * dt
    dlj = (duration**3 / rom**2) * integral
    if dlj <= 0:
        return rms_jerk, None
    return rms_jerk, -math.log(dlj)


def _interpolated_fraction(frames: list[dict[str, Any]]) -> float:
    if not frames:
        return 0.0
    flagged = sum(
        1 for frame in frames if bool(frame.get("flags", {}).get("interpolated_over_gap", False))
    )
    return flagged / len(frames)


def _grid_hz(frames: list[dict[str, Any]]) -> float | None:
    deltas = [
        float(frames[i + 1]["timestamp_gateway"]) - float(frames[i]["timestamp_gateway"])
        for i in range(len(frames) - 1)
    ]
    positive = [delta for delta in deltas if delta > 0]
    if not positive:
        return None
    return 1.0 / statistics.median(positive)


def _rate_block(
    frames: list[dict[str, Any]],
    source_rates: dict[str, float],
    *,
    effective_hz: float | None,
    interpolated_fraction: float,
) -> dict[str, Any]:
    grid_hz = _grid_hz(frames)
    stable = True
    if effective_hz is None or effective_hz <= 0 or not grid_hz:
        stable = False
    elif abs(effective_hz / grid_hz - 1.0) > RATE_STABLE_TOLERANCE:
        stable = False
    present = [rate for rate in source_rates.values() if rate > 0]
    if source_rates and len(present) < len(source_rates):
        stable = False
    if len(present) >= 2 and (max(present) - min(present)) > RATE_STABLE_TOLERANCE * max(present):
        stable = False
    if interpolated_fraction > SMOOTHNESS_MAX_INTERP_FRACTION:
        stable = False
    return {
        "grid_hz": round(grid_hz, 4) if grid_hz else None,
        "effective_hz": round(effective_hz, 4) if effective_hz else None,
        "source_hz_by_role": {role: round(rate, 4) for role, rate in source_rates.items()},
        "interpolated_fraction": round(interpolated_fraction, 4),
        "stable": stable,
    }


def _summarize(reps: tuple[RepMetrics, ...], window_seconds: float) -> dict[str, Any]:
    roms = [rep.rom_degrees for rep in reps]
    ratios = [rep.tempo_ratio for rep in reps if rep.tempo_ratio is not None]
    ldljs = [rep.log_dimensionless_jerk for rep in reps if rep.log_dimensionless_jerk is not None]
    active_seconds = sum(rep.duration_seconds for rep in reps)
    rom_mean = statistics.fmean(roms)
    rom_stdev = statistics.pstdev(roms)
    return {
        "rep_count": len(reps),
        "rom_degrees": {
            "mean": round(rom_mean, 3),
            "min": round(min(roms), 3),
            "max": round(max(roms), 3),
            "stdev": round(rom_stdev, 3),
        },
        "rom_consistency_cv": round(rom_stdev / rom_mean, 4) if rom_mean else None,
        "flexion_seconds_mean": round(statistics.fmean(rep.flexion_seconds for rep in reps), 4),
        "extension_seconds_mean": round(
            statistics.fmean(rep.extension_seconds for rep in reps), 4
        ),
        "tempo_ratio_mean": round(statistics.fmean(ratios), 4) if ratios else None,
        "hold_seconds_mean": round(statistics.fmean(rep.hold_seconds for rep in reps), 4),
        "rms_jerk_dps3_mean": round(statistics.fmean(rep.rms_jerk_dps3 for rep in reps), 4),
        "log_dimensionless_jerk_mean": round(statistics.fmean(ldljs), 4) if ldljs else None,
        "interpolated_fraction_mean": round(
            statistics.fmean(rep.interpolated_fraction for rep in reps), 4
        ),
        "active_seconds": round(active_seconds, 4),
        "window_seconds": round(max(0.0, window_seconds), 4),
        "paused_seconds": round(max(0.0, window_seconds - active_seconds), 4),
    }
