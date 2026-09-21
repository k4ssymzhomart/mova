# Vendored from Phoenix 1480ab0:services/api/app/signal_quality.py
# Do not edit in mova -- change it upstream in Phoenix and re-copy. See VENDORED.md.
"""Deterministic technical IMU stream checks; never a clinical assessment."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any


class SignalQualityLevel(StrEnum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    INVALID = "INVALID"


REQUIRED_ROLES = frozenset({"thigh", "shank", "foot"})
MIN_CALIBRATION_SECONDS = 3.0
# Confirmed WT901BLE68 hardware (2026-09-05 live capture, see
# docs/imu/current-script-audit.md) streams at ~10-12 Hz per sensor on its
# 10 Hz firmware setting. The previous 15 Hz floor would mark every real
# session LOW regardless of actual signal quality; 8 Hz leaves margin below
# the observed minimum (~10 Hz) for normal jitter without masking a genuinely
# degraded stream. Still an engineering default pending device/clinical
# validation.
MIN_SAMPLE_RATE_HZ = 8.0
# Three independently-clocked WT901BLE68 units over three separate BLE
# connections (services/imu-gateway is single-process; a Web Bluetooth client
# is three independent GATT links) are not phase-locked to a shared clock.
# At the confirmed ~10-12 Hz per-sensor rate, one sample period alone is
# 80-100ms, so 100ms left effectively no room for ordinary inter-device
# jitter and marked every real hardware session at best MEDIUM. Raised to
# give margin above one sample period; still an engineering default pending
# device/clinical validation, not a synchronisation guarantee.
MAX_SYNC_SKEW_MS = 250.0
MAX_GAP_SECONDS = 1.0
CLIPPING_RAW_LIMIT = 32_700
# A live capture from real (stationary, resting-on-a-surface) WT901BLE68
# hardware on 2026-09-05 (docs/imu/current-script-audit.md) measured a gyro
# raw value of 700 on one axis -- 7x the previous limit of 100. That prior
# limit was only ever validated against synthetic frames, which are exactly
# zero when at rest; it does not reflect this sensor's real noise floor.
# Raised with margin above the one observed real-rest sample; still an
# engineering default pending a proper stationary-vs-moving hardware
# comparison, not a clinical threshold.
MAX_STATIC_GYROSCOPE_RAW = 2000


@dataclass(frozen=True, slots=True)
class SignalQualityReport:
    level: SignalQualityLevel
    reasons: tuple[str, ...]
    calibration_duration_seconds: float
    synchronization_skew_ms: float | None
    sample_rates_hz: dict[str, float]
    packet_counts: dict[str, int]

    def as_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result["level"] = self.level.value
        result["scoring_permitted"] = self.level in {
            SignalQualityLevel.HIGH,
            SignalQualityLevel.MEDIUM,
        }
        return result


def _timestamp(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def evaluate_signal_quality(events: list[dict[str, Any]]) -> SignalQualityReport:
    """Evaluate connection, calibration window and transport quality conservatively.

    The limits are engineering safeguards for the development scaffold. They
    need protocol-specific validation before any clinical use.
    """
    by_role: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        role = str(event.get("sensor_role", ""))
        if role in REQUIRED_ROLES:
            by_role[role].append(event)

    observed_roles = set(by_role)
    packet_counts = {role: len(by_role.get(role, [])) for role in sorted(REQUIRED_ROLES)}
    missing_roles = REQUIRED_ROLES - observed_roles
    if missing_roles:
        return SignalQualityReport(
            SignalQualityLevel.INVALID,
            (f"missing_sensor_roles:{','.join(sorted(missing_roles))}",),
            0.0,
            None,
            {},
            packet_counts,
        )

    timed: dict[str, list[tuple[datetime, dict[str, Any]]]] = {}
    try:
        for role, role_events in by_role.items():
            # key= so a tie on the timestamp never falls through to comparing
            # the event dicts (that raises TypeError -> misreported below as
            # "invalid_gateway_timestamp"). Two packets can share a host
            # timestamp whenever they land in the same clock tick.
            timed[role] = sorted(
                ((_timestamp(event["timestamp_gateway"]), event) for event in role_events),
                key=lambda pair: pair[0],
            )
    except (KeyError, TypeError, ValueError):
        return SignalQualityReport(
            SignalQualityLevel.INVALID,
            ("invalid_gateway_timestamp",),
            0.0,
            None,
            {},
            packet_counts,
        )

    all_timestamps = [timestamp for role_events in timed.values() for timestamp, _ in role_events]
    duration_seconds = (max(all_timestamps) - min(all_timestamps)).total_seconds()
    latest = [role_events[-1][0] for role_events in timed.values()]
    synchronization_skew_ms = (max(latest) - min(latest)).total_seconds() * 1000

    sample_rates: dict[str, float] = {}
    long_gap = False
    for role, role_events in timed.items():
        intervals = [
            (right[0] - left[0]).total_seconds()
            for left, right in zip(role_events, role_events[1:], strict=False)
        ]
        if intervals:
            sample_rates[role] = 1 / (sum(intervals) / len(intervals))
            long_gap = long_gap or max(intervals) > MAX_GAP_SECONDS
        else:
            sample_rates[role] = 0.0

    clipped = any(
        abs(int(event.get(axis, 0))) >= CLIPPING_RAW_LIMIT
        for role_events in by_role.values()
        for event in role_events
        for axis in ("ax", "ay", "az", "gx", "gy", "gz")
    )
    moving_during_calibration = any(
        abs(int(event.get(axis, 0))) > MAX_STATIC_GYROSCOPE_RAW
        for role_events in by_role.values()
        for event in role_events
        for axis in ("gx", "gy", "gz")
    )
    reasons: list[str] = []
    if duration_seconds < MIN_CALIBRATION_SECONDS:
        reasons.append("static_calibration_window_too_short")
    if moving_during_calibration:
        reasons.append("static_calibration_motion_detected")
    if clipped:
        reasons.append("sensor_clipping_detected")
    if long_gap:
        reasons.append("prolonged_packet_gap")
    if any(rate < MIN_SAMPLE_RATE_HZ for rate in sample_rates.values()):
        reasons.append("insufficient_sample_rate")
    if synchronization_skew_ms > MAX_SYNC_SKEW_MS:
        reasons.append("sensor_synchronization_out_of_range")

    if any(reason in reasons for reason in ("sensor_clipping_detected", "prolonged_packet_gap")):
        level = SignalQualityLevel.INVALID
    elif (
        "static_calibration_window_too_short" in reasons
        or "static_calibration_motion_detected" in reasons
        or "insufficient_sample_rate" in reasons
    ):
        level = SignalQualityLevel.LOW
    elif "sensor_synchronization_out_of_range" in reasons:
        level = SignalQualityLevel.MEDIUM
    else:
        level = SignalQualityLevel.HIGH
    return SignalQualityReport(
        level,
        tuple(reasons),
        duration_seconds,
        synchronization_skew_ms,
        sample_rates,
        packet_counts,
    )
