# Vendored from Phoenix 1480ab0:services/api/app/preprocessing.py
# Do not edit in mova -- change it upstream in Phoenix and re-copy. See VENDORED.md.
"""Reproducible, non-clinical preprocessing for versioned IMU transport data."""

from __future__ import annotations

import math
from bisect import bisect_left
from dataclasses import dataclass
from datetime import datetime
from typing import Any

REQUIRED_ROLES = ("thigh", "shank", "foot")

# Raw transport channels carried through unchanged. Accel/gyro stay in device
# int16 LSB and orientation stays in degrees: no unit conversion, sensor
# fusion, angle estimation or interpretation happens here. Fixed order -- this
# tuple IS the channel axis of any (T, 3, len(CHANNELS)) tensor built from the
# frames below.
ACCEL_GYRO_CHANNELS = ("ax", "ay", "az", "gx", "gy", "gz")
ORIENTATION_CHANNELS = ("ori_roll", "ori_pitch", "ori_yaw")
CHANNELS = ACCEL_GYRO_CHANNELS + ORIENTATION_CHANNELS

# A resample step whose two bracketing source samples are farther apart than
# this is flagged on the frame. Confirmed WT901BLE68 hardware streams at
# ~10 Hz per sensor (docs/imu/current-script-audit.md), so one period is
# ~100 ms; 300 ms means at least two consecutive dropped samples were linearly
# bridged. Engineering default, not a clinical threshold.
MAX_INTERPOLATION_GAP_SECONDS = 0.3

# int16 full scale is +/-32768. An accel/gyro channel at or above this
# magnitude was (near) saturated at the ADC before preprocessing ever saw it,
# so any velocity/acceleration feature derived from that frame is unreliable.
# Approximate: checked on the resampled value, not the raw sample.
NEAR_FULL_SCALE_RAW = 32_200


@dataclass(frozen=True, slots=True)
class PreprocessingResult:
    allowed: bool
    reasons: tuple[str, ...]
    sample_rate_hz: float
    frames: tuple[dict[str, Any], ...]
    parameters: dict[str, Any]


def _timestamp(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _channels_from_event(event: dict[str, Any]) -> dict[str, float] | None:
    """Flatten one transport event to the model channels.

    Returns ``None`` when the orientation triple is absent or malformed: that
    sample is then treated as a transport gap for its stream, not a hard
    failure, since real hardware always reports orientation and a total dropout
    still surfaces as ``missing_required_sensor_stream``.
    """
    row = {name: float(event[name]) for name in ACCEL_GYRO_CHANNELS}
    orientation = event.get("orientation_euler_degrees")
    if not isinstance(orientation, list | tuple) or len(orientation) != 3:
        return None
    try:
        row["ori_roll"], row["ori_pitch"], row["ori_yaw"] = (float(v) for v in orientation)
    except (TypeError, ValueError):
        return None
    return row


def preprocess_transport_events(
    events: list[dict[str, Any]],
    *,
    signal_quality: dict[str, Any],
    target_rate_hz: float = 20.0,
    filter_window_samples: int = 3,
) -> PreprocessingResult:
    """Validate timestamps and linearly resample the three raw streams.

    This deliberately stops before fusion, angle estimation, segmentation and
    scoring. Those stages require an approved device protocol and calibration
    method; inventing either would be unsafe.

    Each emitted frame carries every sensor's 9 channels plus a ``flags`` block
    (``interpolated_over_gap``, ``gap_seconds_max``, ``near_full_scale``) so a
    downstream windowing/model layer can drop or down-weight frames that were
    reconstructed across a dropout or saturated at the ADC.
    """
    if target_rate_hz <= 0:
        raise ValueError("target_rate_hz must be positive")
    if filter_window_samples < 1 or filter_window_samples % 2 == 0:
        raise ValueError("filter_window_samples must be a positive odd number")
    parameters = {
        "target_rate_hz": target_rate_hz,
        "filter_kind": "centered_moving_average",
        "filter_window_samples": filter_window_samples,
        "channels": list(CHANNELS),
        "sensor_order": list(REQUIRED_ROLES),
        "units": {
            "ax_ay_az": "raw_int16_lsb",
            "gx_gy_gz": "raw_int16_lsb",
            "ori_roll_ori_pitch_ori_yaw": "degrees",
        },
        "max_interpolation_gap_seconds": MAX_INTERPOLATION_GAP_SECONDS,
        "dropped_events_missing_orientation": 0,
    }
    if not signal_quality.get("scoring_permitted", False):
        return PreprocessingResult(
            False, ("signal_quality_gate_closed",), target_rate_hz, (), parameters
        )

    streams: dict[str, list[tuple[datetime, dict[str, float]]]] = {
        role: [] for role in REQUIRED_ROLES
    }
    dropped_missing_orientation = 0
    try:
        for event in events:
            role = event.get("sensor_role")
            if role not in streams:
                continue
            channels = _channels_from_event(event)
            if channels is None:
                dropped_missing_orientation += 1
                continue
            streams[role].append((_timestamp(event["timestamp_gateway"]), channels))
    except (KeyError, TypeError, ValueError):
        return PreprocessingResult(
            False, ("invalid_gateway_timestamp",), target_rate_hz, (), parameters
        )
    parameters["dropped_events_missing_orientation"] = dropped_missing_orientation
    if any(not stream for stream in streams.values()):
        return PreprocessingResult(
            False, ("missing_required_sensor_stream",), target_rate_hz, (), parameters
        )

    for stream in streams.values():
        stream.sort(key=lambda item: item[0])
    stream_times = {
        role: [stamp.timestamp() for stamp, _ in stream] for role, stream in streams.items()
    }
    started_at = max(stream[0][0] for stream in streams.values())
    ended_at = min(stream[-1][0] for stream in streams.values())
    if ended_at <= started_at:
        return PreprocessingResult(
            False, ("no_common_sensor_time_window",), target_rate_hz, (), parameters
        )

    step_seconds = 1 / target_rate_hz
    # Delta stays in the timedelta domain on purpose: subtracting two ~1.7e9 s
    # epoch floats loses enough precision to drop the final frame.
    frame_count = int((ended_at - started_at).total_seconds() / step_seconds) + 1
    origin_epoch = started_at.timestamp()
    raw_frames: list[dict[str, Any]] = []
    for index in range(frame_count):
        moment = origin_epoch + index * step_seconds
        sensors: dict[str, dict[str, float]] = {}
        gap_seconds_max = 0.0
        near_full_scale = False
        for role, stream in streams.items():
            values, bracket_gap = _interpolate(stream, stream_times[role], moment)
            sensors[role] = values
            gap_seconds_max = max(gap_seconds_max, bracket_gap)
            if any(abs(values[axis]) >= NEAR_FULL_SCALE_RAW for axis in ACCEL_GYRO_CHANNELS):
                near_full_scale = True
        raw_frames.append(
            {
                "timestamp_gateway": moment,
                "sensors": sensors,
                "flags": {
                    "interpolated_over_gap": gap_seconds_max > MAX_INTERPOLATION_GAP_SECONDS,
                    "gap_seconds_max": round(gap_seconds_max, 4),
                    "near_full_scale": near_full_scale,
                },
            }
        )
    return PreprocessingResult(
        True,
        (),
        target_rate_hz,
        filter_resampled_frames(tuple(raw_frames), window_samples=filter_window_samples),
        parameters,
    )


def filter_resampled_frames(
    frames: tuple[dict[str, Any], ...], *, window_samples: int
) -> tuple[dict[str, Any], ...]:
    """Apply a bounded centered moving average without interpreting movement.

    Accel/gyro channels are averaged arithmetically; orientation channels are
    averaged as unit vectors (circular mean) so the +/-180 deg wrap does not
    inject spikes. The per-frame ``flags`` block passes through unchanged.
    """
    if window_samples < 1 or window_samples % 2 == 0:
        raise ValueError("window_samples must be a positive odd number")
    radius = window_samples // 2
    filtered: list[dict[str, Any]] = []
    for index, frame in enumerate(frames):
        lower = max(0, index - radius)
        upper = min(len(frames), index + radius + 1)
        window = frames[lower:upper]
        span = upper - lower
        sensors: dict[str, dict[str, float]] = {}
        for role in REQUIRED_ROLES:
            smoothed = {
                axis: sum(source["sensors"][role][axis] for source in window) / span
                for axis in ACCEL_GYRO_CHANNELS
            }
            for axis in ORIENTATION_CHANNELS:
                cos_sum = sum(
                    math.cos(math.radians(source["sensors"][role][axis])) for source in window
                )
                sin_sum = sum(
                    math.sin(math.radians(source["sensors"][role][axis])) for source in window
                )
                smoothed[axis] = math.degrees(math.atan2(sin_sum, cos_sum))
            sensors[role] = smoothed
        filtered.append(
            {
                "timestamp_gateway": frame["timestamp_gateway"],
                "sensors": sensors,
                "flags": frame["flags"],
            }
        )
    return tuple(filtered)


def _interpolate(
    stream: list[tuple[datetime, dict[str, float]]], times: list[float], timestamp: float
) -> tuple[dict[str, float], float]:
    """Interpolate raw channels onto a shared time base without interpreting them.

    ``times`` holds the stream's epoch timestamps in the same (sorted) order, so
    the bracketing samples are found by bisection rather than a scan from the
    start of the stream for every frame, which was quadratic in attempt length.
    Returns ``(channel_values, bracket_gap_seconds)`` where the gap is the
    spacing of the two source samples the target timestamp fell between (0.0 at
    or before the first sample and after the last).
    """
    index = bisect_left(times, timestamp)
    if index == len(times):
        return {axis: stream[-1][1][axis] for axis in CHANNELS}, 0.0
    right_timestamp, right = times[index], stream[index][1]
    if index == 0 or right_timestamp == timestamp:
        return {axis: right[axis] for axis in CHANNELS}, 0.0
    left_timestamp, left = times[index - 1], stream[index - 1][1]
    span = right_timestamp - left_timestamp
    fraction = (timestamp - left_timestamp) / span
    values = {
        axis: left[axis] + (right[axis] - left[axis]) * fraction for axis in ACCEL_GYRO_CHANNELS
    }
    for axis in ORIENTATION_CHANNELS:
        values[axis] = _interpolate_angle_degrees(left[axis], right[axis], fraction)
    return values, span


def _interpolate_angle_degrees(left: float, right: float, fraction: float) -> float:
    """Shortest-arc linear interpolation between two angles in degrees."""
    left_rad, right_rad = math.radians(left), math.radians(right)
    cos_value = math.cos(left_rad) + (math.cos(right_rad) - math.cos(left_rad)) * fraction
    sin_value = math.sin(left_rad) + (math.sin(right_rad) - math.sin(left_rad)) * fraction
    return math.degrees(math.atan2(sin_value, cos_value))
