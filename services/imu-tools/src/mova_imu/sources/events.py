"""The one event shape every tool in this package consumes.

The vendored analysis core (`preprocess_transport_events` and everything under
it) reads exactly one record shape. Three different files can produce it, so
the knowledge of which is which lives here rather than being re-guessed in each
tool:

1. **gateway event** -- what the Phoenix gateway posts upstream.
2. **capture JSONL** -- what `tools/capture_wt901ble68.py` writes and
   `gateway.diagnostics.load_capture` reads.
3. **mova `session_frames`** -- a row the browser wrote through
   `flush_session_telemetry_batch`. This is the one mova actually has.

Nothing here converts units or fills anything in. A row that does not carry a
usable orientation triple is dropped and counted, never zero-filled: a zero is
indistinguishable from a sensor lying still, and the analysis downstream would
read it as a real measurement.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

ROLES = ("thigh", "shank", "foot")

#: Keys of a canonical transport event, in the order `preprocess_transport_events` expects.
EVENT_KEYS = (
    "sensor_role",
    "timestamp_gateway",
    "ax", "ay", "az",
    "gx", "gy", "gz",
    "orientation_euler_degrees",
)


@dataclass(slots=True)
class DropReport:
    """Why rows were left out. Printed by every tool that loads a file."""

    total: int = 0
    kept: int = 0
    unknown_shape: int = 0
    bad_role: int = 0
    bad_euler: int = 0
    reasons: dict[str, int] = field(default_factory=dict)

    @property
    def dropped(self) -> int:
        return self.total - self.kept

    def note(self, reason: str) -> None:
        self.reasons[reason] = self.reasons.get(reason, 0) + 1

    def summary(self) -> str:
        if self.dropped == 0:
            return f"{self.kept} frames, none dropped"
        parts = [f"{name}={count}" for name, count in sorted(self.reasons.items())]
        return f"{self.kept} frames, {self.dropped} dropped ({', '.join(parts)})"


def _triple(value: Any) -> list[float] | None:
    if not isinstance(value, list | tuple) or len(value) != 3:
        return None
    try:
        return [float(value[0]), float(value[1]), float(value[2])]
    except (TypeError, ValueError):
        return None


def _ints(value: Any, default: int = 0) -> tuple[int, int, int]:
    if not isinstance(value, list | tuple) or len(value) != 3:
        return (default, default, default)
    out = []
    for item in value:
        try:
            out.append(int(item))
        except (TypeError, ValueError):
            out.append(default)
    return (out[0], out[1], out[2])


def _event(role: str, ts: Any, accel: tuple[int, int, int], gyro: tuple[int, int, int],
           euler: list[float]) -> dict[str, Any]:
    return {
        "sensor_role": role,
        "timestamp_gateway": ts,
        "ax": accel[0], "ay": accel[1], "az": accel[2],
        "gx": gyro[0], "gy": gyro[1], "gz": gyro[2],
        "orientation_euler_degrees": euler,
    }


def normalise(row: Mapping[str, Any], report: DropReport | None = None) -> dict[str, Any] | None:
    """One row of any of the three shapes -> one canonical event, or ``None``.

    ``None`` always means "this row carries no usable measurement". It never
    means "here is a partial one".
    """
    def drop(reason: str) -> None:
        if report is not None:
            report.note(reason)

    if "sensor_role" in row and "orientation_euler_degrees" in row:
        # 1. gateway event
        role = row.get("sensor_role")
        euler = _triple(row.get("orientation_euler_degrees"))
        ts = row.get("timestamp_gateway")
        accel = (_int(row.get("ax")), _int(row.get("ay")), _int(row.get("az")))
        gyro = (_int(row.get("gx")), _int(row.get("gy")), _int(row.get("gz")))
    elif "sensor" in row and "euler_degrees" in row:
        # 2. capture JSONL
        sensor = row.get("sensor")
        role = sensor.get("role") if isinstance(sensor, Mapping) else None
        euler = _triple(row.get("euler_degrees"))
        ts = row.get("gateway_timestamp")
        accel = _ints(row.get("accelerometer_raw"))
        gyro = _ints(row.get("gyroscope_raw"))
    elif isinstance(row.get("imu"), Mapping):
        # 3. mova session_frames row
        imu = row["imu"]
        role = imu.get("role")
        euler = _triple(imu.get("euler_deg"))
        ts = row.get("recorded_at")
        accel = (_int(imu.get("ax")), _int(imu.get("ay")), _int(imu.get("az")))
        gyro = (_int(imu.get("gx")), _int(imu.get("gy")), _int(imu.get("gz")))
    else:
        if report is not None:
            report.unknown_shape += 1
        drop("unknown_shape")
        return None

    if role not in ROLES:
        if report is not None:
            report.bad_role += 1
        drop("bad_role")
        return None
    if euler is None:
        # The browser attaches a signal-quality report to about one row a second
        # and the WT901 occasionally emits a short frame: both land here.
        if report is not None:
            report.bad_euler += 1
        drop("missing_euler_deg")
        return None
    if ts is None:
        drop("missing_timestamp")
        return None
    return _event(str(role), ts, accel, gyro, euler)


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def normalise_rows(rows: Iterable[Mapping[str, Any]]) -> tuple[list[dict[str, Any]], DropReport]:
    """Normalise many rows, keeping a count of what was left out and why."""
    report = DropReport()
    events: list[dict[str, Any]] = []
    for row in rows:
        report.total += 1
        event = normalise(row, report)
        if event is not None:
            events.append(event)
            report.kept += 1
    return events, report
