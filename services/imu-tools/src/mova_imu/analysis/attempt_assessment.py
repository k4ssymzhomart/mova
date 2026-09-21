# Vendored from Phoenix 1480ab0:services/api/app/attempt_assessment.py
# Do not edit in mova -- change it upstream in Phoenix and re-copy. See VENDORED.md.
"""Whole-attempt, profile-driven movement assessment input.

Runs preprocess -> reps -> biomechanics over a *complete* exercise attempt and
turns every repetition into one flat feature row. That row is what the
rep-quality model (and ``scripts/label_reps.py``) consume.

This differs from the live path in ``main.py::ingest_imu_packet``, which counts
reps on the recent tail of a stream as it arrives:

- the signal is pinned per exercise (``app.exercise_signals``) instead of
  auto-selected, so features are comparable across recordings;
- the rest level comes from the take's initial stay-still window;
- the grid is 10 Hz, the rate the WT901BLE68 actually streams, instead of
  interpolating it up to 20 Hz;
- step-up style exercises are segmented by stillness, and get phase features.

Non-clinical: device-orientation proxies and engineering thresholds.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .biomechanics import BiomechanicsReport, compute_biomechanics
from .exercise_signals import SignalProfile
from .preprocessing import preprocess_transport_events
from .reps import (
    MIN_FRAMES,
    PEAK_PROMINENCE_DEG,
    RepReport,
    RepSegment,
    count_repetitions,
    oriented_magnitude,
    prominent_peaks,
    report_from_segments,
    rest_level_from_static_window,
    segment_by_stillness,
    signal_series,
)

# Confirmed hardware streams ~10-12 Hz per sensor; a 20 Hz grid would be mostly
# interpolated frames and turn jerk into an interpolation artifact.
ASSESSMENT_RATE_HZ = 10.0
ASSESSMENT_FILTER_WINDOW = 3

# Per-rep features taken from biomechanics.RepMetrics. rms_jerk is left out: it
# scales with the sample rate. peak_flexion_degrees is left out: it is measured
# from the segment start, already past enter_deg; peak_from_rest_deg replaces
# it. log_dimensionless_jerk is already None when a rep is mostly interpolated.
REP_METRIC_FEATURES = (
    "rom_degrees",
    "duration_seconds",
    "flexion_seconds",
    "extension_seconds",
    "hold_seconds",
    "tempo_ratio",
    "velocity_reversals",
    "log_dimensionless_jerk",
)
# Split at the rep's single highest point, which means nothing for a two-hump
# step-up; its phase features replace these.
PEAK_SPLIT_FEATURES = ("flexion_seconds", "extension_seconds", "tempo_ratio", "hold_seconds")
STEP_PHASE_FEATURES = (
    "hump_count",
    "up_peak_deg",
    "residual_flexion_on_step_deg",
    "push_up_seconds",
    "step_down_seconds",
    "down_peak_deg",
)


@dataclass(frozen=True, slots=True)
class AttemptAssessment:
    status: str  # "assessed" | "no_reps" | "insufficient_frames" | "blocked"
    reason: str | None
    exercise_id: str | None
    profile: SignalProfile | None
    rep_report: RepReport | None
    biomechanics: BiomechanicsReport | None
    # One flat {feature: value} row per rep, in rep order; None = not measurable.
    rep_features: tuple[dict[str, float | None], ...]
    frame_count: int
    rate_hz: float

    def as_dict(self) -> dict[str, Any]:
        report = self.rep_report
        return {
            "status": self.status,
            "reason": self.reason,
            "exercise_id": self.exercise_id,
            "profile": self.profile.as_dict() if self.profile else None,
            "repetitions": (
                {
                    "count": report.count,
                    "proxy": report.proxy,
                    "baseline": report.baseline,
                    "amplitude_degrees": report.amplitude_degrees,
                    "reason": report.reason,
                }
                if report
                else None
            ),
            "biomechanics": self.biomechanics.as_dict() if self.biomechanics else None,
            "rep_features": [dict(row) for row in self.rep_features],
            "frame_count": self.frame_count,
            "rate_hz": self.rate_hz,
        }


def assess_attempt(
    events: list[dict[str, Any]],
    profile: SignalProfile | None,
    *,
    signal_quality: dict[str, Any],
    rate_hz: float = ASSESSMENT_RATE_HZ,
    source_sample_rates_hz: Mapping[str, float] | None = None,
) -> AttemptAssessment:
    """Assess every transport event of one attempt. ``profile=None`` falls back
    to the auto-selected live-counter proxy."""
    result = preprocess_transport_events(
        events,
        signal_quality=signal_quality,
        target_rate_hz=rate_hz,
        filter_window_samples=ASSESSMENT_FILTER_WINDOW,
    )
    if not result.allowed:
        return AttemptAssessment(
            status="blocked",
            reason=",".join(result.reasons),
            exercise_id=profile.exercise_id if profile else None,
            profile=profile,
            rep_report=None,
            biomechanics=None,
            rep_features=(),
            frame_count=0,
            rate_hz=rate_hz,
        )
    return assess_frames(
        list(result.frames),
        profile,
        rate_hz=rate_hz,
        source_sample_rates_hz=source_sample_rates_hz,
    )


def assess_frames(
    frames: list[dict[str, Any]],
    profile: SignalProfile | None,
    *,
    rate_hz: float = ASSESSMENT_RATE_HZ,
    source_sample_rates_hz: Mapping[str, float] | None = None,
) -> AttemptAssessment:
    """Same as ``assess_attempt`` for frames that are already preprocessed."""
    if profile is None:
        rep_report = count_repetitions(frames)
    else:
        rep_report = _profile_rep_report(frames, profile, rate_hz)
    biomechanics = compute_biomechanics(
        frames, rep_report, source_sample_rates_hz=source_sample_rates_hz
    )
    rows = _rep_features(frames, rep_report, biomechanics, profile)
    status = "assessed" if biomechanics.status == "computed" else biomechanics.status
    return AttemptAssessment(
        status=status,
        reason=biomechanics.reason,
        exercise_id=profile.exercise_id if profile else None,
        profile=profile,
        rep_report=rep_report,
        biomechanics=biomechanics,
        rep_features=rows,
        frame_count=len(frames),
        rate_hz=rate_hz,
    )


def _times(frames: Sequence[dict[str, Any]]) -> list[float]:
    return [float(frame["timestamp_gateway"]) for frame in frames]


def _profile_rep_report(
    frames: list[dict[str, Any]], profile: SignalProfile, rate_hz: float
) -> RepReport:
    proxy = profile.primary.label
    if len(frames) < MIN_FRAMES:
        return RepReport(0, (), False, None, 0.0, proxy, "insufficient_frames", (), ())
    raw = signal_series(frames, profile.primary)
    rest_level = rest_level_from_static_window(raw, _times(frames))
    min_rep_frames = max(2, math.ceil(profile.min_rep_seconds * rate_hz))
    if profile.rep_pattern == "single_excursion":
        return count_repetitions(
            frames,
            enter_deg=profile.enter_deg,
            exit_deg=profile.exit_deg,
            min_rep_frames=min_rep_frames,
            series=raw,
            proxy=proxy,
            rest_level=rest_level,
        )
    magnitude, _ = oriented_magnitude(raw, rest_level)
    segments = segment_by_stillness(
        frames,
        magnitude,
        enter_deg=profile.enter_deg,
        exit_deg=profile.exit_deg,
        min_rep_frames=min_rep_frames,
        still_rate_dps=profile.still_rate_dps,
        min_still_seconds=profile.min_still_seconds,
    )
    return report_from_segments(
        frames,
        magnitude,
        segments,
        proxy=proxy,
        enter_deg=profile.enter_deg,
        baseline="window_median" if rest_level is None else "static_window",
    )


def _rep_features(
    frames: list[dict[str, Any]],
    rep_report: RepReport,
    biomechanics: BiomechanicsReport,
    profile: SignalProfile | None,
) -> tuple[dict[str, float | None], ...]:
    times = _times(frames)
    secondary = []
    for signal in profile.secondary if profile else ():
        series = signal_series(frames, signal.spec)
        rest = rest_level_from_static_window(series, times)
        if rest is None and series:
            rest = sorted(series)[len(series) // 2]
        secondary.append((signal, series, rest))

    step_pattern = profile is not None and profile.rep_pattern == "stillness_delimited"
    metric_names = [
        name
        for name in REP_METRIC_FEATURES
        if not (step_pattern and name in PEAK_SPLIT_FEATURES)
    ]
    rows: list[dict[str, float | None]] = []
    # compute_biomechanics emits one RepMetrics per segment, in segment order.
    for metrics, segment in zip(biomechanics.reps, rep_report.segments, strict=True):
        row: dict[str, float | None] = {
            name: _number(getattr(metrics, name)) for name in metric_names
        }
        # peak_flexion_degrees is measured from the segment start (already past
        # enter_deg); the excursion from rest is what "range too small" means.
        row["peak_from_rest_deg"] = round(
            max(rep_report.flexion_series[segment.start_index : segment.end_index + 1]), 3
        )
        for signal, series, rest in secondary:
            window = series[segment.start_index : segment.end_index + 1]
            if signal.measure == "max_abs_deviation":
                value = max(abs(sample - rest) for sample in window)
            else:
                value = max(window) - min(window)
            row[signal.name] = round(value, 3)
        if profile and profile.rep_pattern == "stillness_delimited":
            row.update(
                _step_phase_features(rep_report.flexion_series, times, segment, profile.enter_deg)
            )
        rows.append(row)
    return tuple(rows)


def _step_phase_features(
    magnitude: Sequence[float], times: Sequence[float], segment: RepSegment, enter_deg: float
) -> dict[str, float | None]:
    """Split a step-up rep at its knee humps.

    First hump = foot placed on the step and pushed up; the lowest point after it
    = knee straightness reached standing on the step; last hump = stepping down.
    Fields that need two humps are None when only one was found.
    """
    start, end = segment.start_index, segment.end_index
    knee = list(magnitude[start : end + 1])
    clock = list(times[start : end + 1])
    peaks = prominent_peaks(knee, min_prominence=PEAK_PROMINENCE_DEG, min_height=enter_deg)
    row: dict[str, float | None] = dict.fromkeys(STEP_PHASE_FEATURES)
    row["hump_count"] = float(len(peaks))
    if not peaks:
        return row
    first = peaks[0]
    row["up_peak_deg"] = round(knee[first], 3)
    if len(peaks) >= 2:
        last = peaks[-1]
        valley = min(range(first, last + 1), key=lambda i: knee[i])
        row["residual_flexion_on_step_deg"] = round(knee[valley], 3)
        row["push_up_seconds"] = round(clock[valley] - clock[first], 4)
        row["step_down_seconds"] = round(clock[-1] - clock[valley], 4)
        row["down_peak_deg"] = round(knee[last], 3)
    return row


def _number(value: Any) -> float | None:
    return None if value is None else float(value)
