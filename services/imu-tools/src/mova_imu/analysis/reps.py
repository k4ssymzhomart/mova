# Vendored from Phoenix 1480ab0:services/api/app/reps.py
# Do not edit in mova -- change it upstream in Phoenix and re-copy. See VENDORED.md.
"""Deterministic repetition segmentation on preprocessed IMU frames.

Non-clinical. For a heel slide the knee flexes then extends once per rep. The
flexion proxy is the orientation-angle difference between two leg segments; the
segment pair and the axis (roll or pitch) are auto-selected as the one with the
largest rest-to-peak excursion, so the sensor mounting orientation does not have
to be fixed. Yaw is never used -- without a magnetometer it drifts.

A rep is one excursion past a flexion threshold and back past an extension
threshold (hysteresis + a minimum duration). This is the *primary* rep signal
returned to the patient app. A trained model's rep boundaries, when a checkpoint
is present, run in the shadow branch for comparison only and never replace this
until clinically approved.

Whole-attempt assessment (``app.attempt_assessment``) instead pins the signal
per exercise (``app.exercise_signals``), takes the rest level from the
protocol's initial stay-still window rather than the window median, and can
delimit reps by stillness for exercises with more than one excursion per rep
(step up). Those paths are opt-in keyword arguments and helpers below; the live
counter's default behaviour is unchanged.
"""

from __future__ import annotations

import statistics
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from .exercise_signals import SignalSpec

# Engineering defaults for the dev scaffold, not clinical thresholds.
ENTER_FLEXION_DEG = 18.0
EXIT_FLEXION_DEG = 7.0
MIN_REP_FRAMES = 5  # ~250 ms at 20 Hz: rejects jitter blips
MIN_FRAMES = 12
RECENT_COMPLETION_FRAMES = 6  # a rep counts as "just completed" if it ended within this many frames
# A candidate whose full peak-to-trough swing exceeds this is almost certainly
# yaw-style drift, not a limb movement -- reject it.
MAX_PLAUSIBLE_SWING_DEG = 150.0
# The leading static window (the protocol's stay-still hold) may wander this
# much and must last this long to serve as the rest level.
REST_BAND_DEG = 3.0
MIN_REST_SECONDS = 1.0
# A hump inside a stillness-delimited rep must rise this far above the valleys
# on both sides of it.
PEAK_PROMINENCE_DEG = 10.0

_SEGMENT_PAIRS = (("shank", "thigh"), ("shank", "foot"), ("thigh", "foot"))
_AXES = ("ori_roll", "ori_pitch")


@dataclass(frozen=True, slots=True)
class RepSegment:
    """One completed flexion/extension excursion, as frame indices and times.

    Source-agnostic on purpose: the deterministic detector below fills these in
    today, but a trained model that emits rep boundaries produces the same
    structure, so ``app.biomechanics`` consumes a ``Sequence[RepSegment]``
    without caring which branch produced it.
    """

    start_index: int
    end_index: int
    peak_index: int
    start_time: float
    end_time: float
    peak_time: float


@dataclass(frozen=True, slots=True)
class RepReport:
    count: int
    completion_timestamps: tuple[float, ...]
    just_completed: bool
    last_completed_at: float | None
    amplitude_degrees: float
    proxy: str
    reason: str | None
    segments: tuple[RepSegment, ...]
    # The oriented flexion signal the detector actually ran on (rest ~= 0,
    # flexion positive, degrees). Downstream (app.biomechanics) uses this so it
    # does not re-derive -- and re-derive a possibly different axis.
    flexion_series: tuple[float, ...]
    # Where the rest level came from: "window_median" | "static_window".
    baseline: str = "window_median"


def _wrap_deg(value: float) -> float:
    """Map an angle difference into (-180, 180] so the +/-180 wrap is not a jump."""
    return ((value + 180.0) % 360.0) - 180.0


def oriented_magnitude(
    signal: Sequence[float], rest_level: float | None = None
) -> tuple[list[float], float]:
    """Subtract the rest level (the median when not given), flip so the
    excursion is positive; return (magnitude series, peak amplitude)."""
    baseline = statistics.median(signal) if rest_level is None else rest_level
    sign = 1.0 if (max(signal) - baseline) >= (baseline - min(signal)) else -1.0
    magnitude = [sign * (value - baseline) for value in signal]
    return magnitude, max(magnitude)


def flexion_signal(frames: list[dict[str, Any]]) -> tuple[list[float], str]:
    """Auto-select the segment-pair/axis (roll or pitch, never yaw) with the
    largest plausible excursion. Returns (oriented magnitude series, label)."""
    best_label = "shank_minus_thigh_ori_roll_deg"
    best_series: list[float] = [0.0] * len(frames)
    best_amplitude = -1.0
    for distal, proximal in _SEGMENT_PAIRS:
        for axis in _AXES:
            raw = [
                _wrap_deg(
                    float(frame["sensors"][distal].get(axis, 0.0))
                    - float(frame["sensors"][proximal].get(axis, 0.0))
                )
                for frame in frames
            ]
            if max(raw) - min(raw) > MAX_PLAUSIBLE_SWING_DEG:
                continue
            magnitude, amplitude = oriented_magnitude(raw)
            if amplitude > best_amplitude:
                best_amplitude = amplitude
                best_series = magnitude
                best_label = f"{distal}_minus_{proximal}_{axis}_deg"
    return best_series, best_label


def signal_series(frames: Sequence[dict[str, Any]], spec: SignalSpec) -> list[float]:
    """The configured signal in degrees, continuous across the +/-180 wrap.

    Each sample is unwrapped against the first frame, so a mounting that sits
    near +/-180 does not produce a 360 deg jump. The absolute level is arbitrary;
    callers subtract a rest level.
    """

    def angle(frame: dict[str, Any], role: str | None) -> float:
        return float(frame["sensors"][role].get(spec.axis, 0.0))

    if spec.kind == "relative":
        raw = [angle(frame, spec.distal) - angle(frame, spec.proximal) for frame in frames]
    else:
        raw = [angle(frame, spec.role) for frame in frames]
    if not raw:
        return []
    reference = _wrap_deg(raw[0])
    return [reference + _wrap_deg(value - reference) for value in raw]


def rest_level_from_static_window(
    series: Sequence[float],
    times: Sequence[float],
    *,
    band_deg: float = REST_BAND_DEG,
    min_seconds: float = MIN_REST_SECONDS,
) -> float | None:
    """Mean of the leading run that stays within ``band_deg``, if it lasts ``min_seconds``.

    The recording protocol starts every take with a stay-still hold. Its level is
    the true rest, unlike the window median, which drifts toward the flexed
    position when reps are slow or held. ``None`` when the take has no such hold.
    """
    if not series:
        return None
    low = high = series[0]
    end = 0
    for index, value in enumerate(series):
        low, high = min(low, value), max(high, value)
        if high - low > band_deg:
            break
        end = index
    if times[end] - times[0] < min_seconds:
        return None
    return statistics.fmean(series[: end + 1])


def _segment(frames: Sequence[dict[str, Any]], start: int, end: int, peak: int) -> RepSegment:
    def time(index: int) -> float:
        return float(frames[index]["timestamp_gateway"])

    return RepSegment(
        start_index=start,
        end_index=end,
        peak_index=peak,
        start_time=time(start),
        end_time=time(end),
        peak_time=time(peak),
    )


def report_from_segments(
    frames: Sequence[dict[str, Any]],
    magnitude: Sequence[float],
    segments: Sequence[RepSegment],
    *,
    proxy: str,
    enter_deg: float,
    baseline: str,
) -> RepReport:
    amplitude = max(magnitude) if magnitude else 0.0
    completion_timestamps = tuple(segment.end_time for segment in segments)
    just_completed = bool(segments) and (
        len(frames) - segments[-1].end_index <= RECENT_COMPLETION_FRAMES
    )
    return RepReport(
        count=len(segments),
        completion_timestamps=completion_timestamps,
        just_completed=just_completed,
        last_completed_at=completion_timestamps[-1] if completion_timestamps else None,
        amplitude_degrees=round(amplitude, 2),
        proxy=proxy,
        reason=None if amplitude >= enter_deg else "no_flexion_detected",
        segments=tuple(segments),
        flexion_series=tuple(magnitude),
        baseline=baseline,
    )


def count_repetitions(
    frames: list[dict[str, Any]],
    *,
    enter_deg: float = ENTER_FLEXION_DEG,
    exit_deg: float = EXIT_FLEXION_DEG,
    min_rep_frames: int = MIN_REP_FRAMES,
    series: Sequence[float] | None = None,
    proxy: str | None = None,
    rest_level: float | None = None,
) -> RepReport:
    """Count flexion/extension cycles in a window of preprocessed frames.

    By default the signal is auto-selected (``flexion_signal``). Pass ``series``
    (from ``signal_series``) to pin it, and ``rest_level`` to measure excursions
    from a known rest instead of the window median.
    """
    frames = list(frames)
    if len(frames) < MIN_FRAMES:
        return RepReport(0, (), False, None, 0.0, "none", "insufficient_frames", (), ())

    if series is None:
        magnitude, proxy = flexion_signal(frames)
        baseline = "window_median"
    else:
        magnitude, _ = oriented_magnitude(series, rest_level)
        proxy = proxy or "configured_signal"
        baseline = "window_median" if rest_level is None else "static_window"

    segments: list[RepSegment] = []
    state = "rest"
    segment_start = 0
    segment_peak = 0.0
    segment_peak_index = 0
    for index, value in enumerate(magnitude):
        if state == "rest":
            if value >= enter_deg:
                state = "flexed"
                segment_start = index
                segment_peak = value
                segment_peak_index = index
        else:
            if value > segment_peak:
                segment_peak = value
                segment_peak_index = index
            if value <= exit_deg:
                long_enough = index - segment_start >= min_rep_frames
                if long_enough and segment_peak >= enter_deg:
                    segments.append(_segment(frames, segment_start, index, segment_peak_index))
                state = "rest"

    return report_from_segments(
        frames, magnitude, segments, proxy=proxy, enter_deg=enter_deg, baseline=baseline
    )


def prominent_peaks(
    values: Sequence[float],
    *,
    min_prominence: float = PEAK_PROMINENCE_DEG,
    min_height: float = 0.0,
) -> list[int]:
    """Indices of local maxima at least ``min_height`` high that rise
    ``min_prominence`` above the lowest point between them and the next higher
    point (or the edge) on each side."""
    peaks: list[int] = []
    count = len(values)
    for index, value in enumerate(values):
        left = values[index - 1] if index > 0 else float("-inf")
        right = values[index + 1] if index + 1 < count else float("-inf")
        if value < min_height or not (value > left and value >= right):
            continue
        base_left = value
        cursor = index - 1
        while cursor >= 0 and values[cursor] <= value:
            base_left = min(base_left, values[cursor])
            cursor -= 1
        base_right = value
        cursor = index + 1
        while cursor < count and values[cursor] <= value:
            base_right = min(base_right, values[cursor])
            cursor += 1
        if value - max(base_left, base_right) >= min_prominence:
            peaks.append(index)
    return peaks


def _still_mask(
    frames: Sequence[dict[str, Any]], times: Sequence[float], still_rate_dps: float
) -> list[bool]:
    """Per frame: every segment's roll/pitch rate is below ``still_rate_dps``.

    Uses the orientation angles, not the raw gyro, so it does not depend on the
    unverified gyro scale factor.
    """
    count = len(frames)
    rates = [0.0] * count
    for index in range(1, count):
        dt = times[index] - times[index - 1]
        if dt <= 0:
            rates[index] = rates[index - 1]
            continue
        current, previous = frames[index]["sensors"], frames[index - 1]["sensors"]
        rates[index] = max(
            abs(_wrap_deg(float(current[role][axis]) - float(previous[role][axis]))) / dt
            for role in current
            for axis in _AXES
        )
    if count > 1:
        rates[0] = rates[1]
    return [rate < still_rate_dps for rate in rates]


def segment_by_stillness(
    frames: Sequence[dict[str, Any]],
    magnitude: Sequence[float],
    *,
    enter_deg: float,
    exit_deg: float,
    min_rep_frames: int,
    still_rate_dps: float,
    min_still_seconds: float,
) -> list[RepSegment]:
    """Reps delimited by stillness, for exercises with several excursions per rep.

    A rest is a run of still frames lasting ``min_still_seconds``; a rep is the
    movement between two rests, reaching ``enter_deg``. A window edge counts as
    a rest only when the limb is back within ``exit_deg`` of rest there.

    Spans are never merged or split by hump shape. A bad step-up can blur its two
    knee humps into one (knee not straightened on the step), so hump-based
    merging would silently pair up neighbouring reps. Instead the protocol keeps
    the floor pause longer than ``min_still_seconds`` and any pause on top of the
    step shorter; a take that breaks it shows up as a wrong count against
    ``label_reps.py --expected``, not as a silent merge.
    """
    count = len(frames)
    if count == 0:
        return []
    times = [float(frame["timestamp_gateway"]) for frame in frames]
    still = _still_mask(frames, times, still_rate_dps)

    rest = [False] * count
    index = 0
    while index < count:
        if not still[index]:
            index += 1
            continue
        end = index
        while end + 1 < count and still[end + 1]:
            end += 1
        if times[end] - times[index] >= min_still_seconds:
            rest[index : end + 1] = [True] * (end - index + 1)
        index = end + 1

    spans: list[tuple[int, int]] = []
    index = 0
    while index < count:
        if rest[index]:
            index += 1
            continue
        end = index
        while end + 1 < count and not rest[end + 1]:
            end += 1
        start, stop = max(0, index - 1), min(count - 1, end + 1)
        closed = (index > 0 or magnitude[0] <= exit_deg) and (
            end + 1 < count or magnitude[-1] <= exit_deg
        )
        if (
            closed
            and stop - start >= min_rep_frames
            and max(magnitude[start : stop + 1]) >= enter_deg
        ):
            spans.append((start, stop))
        index = end + 1

    segments = []
    for start, stop in spans:
        peak = max(range(start, stop + 1), key=lambda i: magnitude[i])
        segments.append(_segment(frames, start, stop, peak))
    return segments
