"""Synthetic mova ``session_frames`` rows for the adapter tests.

The row shape is copied field for field from
``services/frontend/src/lib/ble/telemetryFrame.ts::toFrameRow``. If that
function changes shape, these tests are what should fail.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta
from typing import Any

ROLES = ("thigh", "shank", "foot")
#: The WT901BLE68 streams around this rate per sensor over Web Bluetooth.
RATE_HZ = 20.0


def frame_row(
    role: str,
    recorded_at: datetime,
    seq: int,
    euler: tuple[float, float, float] | None,
    *,
    simulated: bool = False,
    signal_quality: dict[str, Any] | None = None,
    gyro: tuple[int, int, int] = (0, 0, 0),
) -> dict[str, Any]:
    """One `session_frames` row, exactly as `toFrameRow` writes it."""
    imu: dict[str, Any] = {
        "role": role,
        "ax": 0, "ay": 0, "az": 16384,        # raw LSB counts; ~1 g on Z at rest
        "gx": gyro[0], "gy": gyro[1], "gz": gyro[2],
        "validation_status": "unverified_checksum",
    }
    if euler is not None:
        imu["euler_deg"] = list(euler)
    if simulated:
        imu["origin"] = "simulated"
    if signal_quality is not None:
        imu["signal_quality"] = signal_quality
    return {
        "recorded_at": recorded_at.isoformat().replace("+00:00", "Z"),
        "seq": seq,
        "imu": imu,
        "quality": 0.8,
    }


def heel_slide_rows(
    reps: int = 6,
    *,
    start: datetime | None = None,
    rest_seconds: float = 3.0,
    rep_seconds: float = 3.0,
    peak_deg: float = 70.0,
    simulated: bool = True,
    seq_from: int = 0,
) -> tuple[list[dict[str, Any]], datetime]:
    """A heel-slide take: the shank pitches away from a still thigh and foot.

    That is the movement mova's own proxy reads --
    ``wrap(shank.pitch - thigh.pitch)`` -- so the pinned heel-slide profile
    should find exactly ``reps`` repetitions in the result.
    """
    begin = start or datetime(2026, 9, 20, 10, 0, 0, tzinfo=UTC)
    step = 1.0 / RATE_HZ
    rows: list[dict[str, Any]] = []
    seq = seq_from

    total = rest_seconds + reps * rep_seconds
    samples = int(total * RATE_HZ)
    for i in range(samples):
        t = i * step
        moment = begin + timedelta(seconds=t)
        if t < rest_seconds:
            bend = 0.0
            rate = 0
        else:
            phase = ((t - rest_seconds) % rep_seconds) / rep_seconds
            # one smooth out-and-back per rep, flat for the last third (the hold/rest)
            bend = peak_deg * math.sin(math.pi * min(phase / 0.66, 1.0)) if phase < 0.66 else 0.0
            rate = int(600 * math.cos(math.pi * phase))
        for role in ROLES:
            pitch = bend if role == "shank" else 0.0
            rows.append(
                frame_row(
                    role, moment, seq,
                    (0.0, pitch, 0.0),
                    simulated=simulated,
                    gyro=(0, rate if role == "shank" else 0, 0),
                )
            )
            seq += 1
    return rows, begin


def export(
    rows: list[dict[str, Any]],
    *,
    session_id: str = "session-test-1",
    slug: str = "heel-slide",
    baseline_windows: list[dict[str, float]] | None = None,
    simulated: bool = True,
) -> dict[str, Any]:
    """Rows wrapped in the export object shape, with the session row beside them."""
    summary: dict[str, Any] = {}
    if baseline_windows is not None:
        summary["baseline_windows_ms"] = baseline_windows
        summary["baseline_window_ms"] = baseline_windows[-1] if baseline_windows else None
    if simulated:
        summary["simulated"] = True
    return {
        "session": {
            "id": session_id,
            "summary": summary,
            "device_info": {"transport": "simulated"} if simulated else {"transport": "ble"},
        },
        "exercise": {"slug": slug},
        "frames": rows,
    }


def epoch_ms(moment: datetime) -> float:
    return moment.timestamp() * 1000.0
