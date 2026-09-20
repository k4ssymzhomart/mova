# Vendored from Phoenix 1480ab0:services/imu-gateway/src/phoenix_imu_gateway/transport.py
# Do not edit in mova -- change it upstream in Phoenix and re-copy. See VENDORED.md.
"""Gateway-side delivery helpers for normalized, loss-aware IMU events."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .models import RawIMUPacket


@dataclass(frozen=True, slots=True)
class SequenceObservation:
    sensor_id: str
    sequence_number: int
    missing: int = 0
    duplicate: bool = False
    out_of_order: bool = False


class SequenceTracker:
    """Track transport integrity independently for each explicitly assigned sensor."""

    def __init__(self) -> None:
        self._last: dict[str, int] = {}

    def observe(self, packet: RawIMUPacket) -> SequenceObservation:
        sensor_id = packet.sensor.sensor_id
        previous = self._last.get(sensor_id)
        if previous is None:
            self._last[sensor_id] = packet.sequence_number
            return SequenceObservation(sensor_id, packet.sequence_number)
        if packet.sequence_number == previous:
            return SequenceObservation(sensor_id, packet.sequence_number, duplicate=True)
        if packet.sequence_number < previous:
            return SequenceObservation(sensor_id, packet.sequence_number, out_of_order=True)
        self._last[sensor_id] = packet.sequence_number
        return SequenceObservation(
            sensor_id, packet.sequence_number, missing=packet.sequence_number - previous - 1
        )


def normalize_packet(packet: RawIMUPacket) -> dict[str, Any]:
    """Convert the lossless internal packet into the server transport contract."""
    ax, ay, az = packet.accelerometer_raw
    gx, gy, gz = packet.gyroscope_raw
    return {
        "session_id": packet.session_id,
        "device_id": packet.sensor.sensor_id,
        "sensor_role": packet.sensor.role.value,
        "timestamp_device": packet.timestamp_device,
        "timestamp_gateway": packet.gateway_timestamp.isoformat(),
        "sequence_number": packet.sequence_number,
        "ax": ax,
        "ay": ay,
        "az": az,
        "gx": gx,
        "gy": gy,
        "gz": gz,
        "orientation_euler_degrees": packet.euler_degrees,
        "battery": packet.battery,
        "origin": packet.origin.value,
        "validation_status": packet.validation_status.value,
        "adapter_version": packet.adapter_version,
    }


class DurableBuffer:
    """Append-only JSONL buffer used while central delivery is unavailable."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def append(self, packet: RawIMUPacket) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(normalize_packet(packet), ensure_ascii=False) + "\n")

    def pending(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        with self.path.open(encoding="utf-8") as stream:
            return [json.loads(line) for line in stream if line.strip()]

    def clear_after_delivery(self) -> None:
        self.path.unlink(missing_ok=True)

    def replace(self, events: list[dict[str, Any]]) -> None:
        """Atomically retain only events that were not acknowledged on replay."""
        if not events:
            self.clear_after_delivery()
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = self.path.with_suffix(f"{self.path.suffix}.tmp")
        with temporary_path.open("w", encoding="utf-8") as stream:
            for event in events:
                stream.write(json.dumps(event, ensure_ascii=False) + "\n")
        temporary_path.replace(self.path)
