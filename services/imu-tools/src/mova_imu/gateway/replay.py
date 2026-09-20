# Vendored from Phoenix 1480ab0:services/imu-gateway/src/phoenix_imu_gateway/replay.py
# Do not edit in mova -- change it upstream in Phoenix and re-copy. See VENDORED.md.
"""Replay adapter for fixtures and synthetic streams; no BLE access is implemented."""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from .adapter import IMUAdapter
from .models import PacketOrigin, RawIMUPacket, SensorInfo
from .parser import WitMotion61Parser


@dataclass(frozen=True, slots=True)
class ReplayFrame:
    sensor_id: str
    frame: bytes
    offset_ms: int = 0


class ReplayAdapter(IMUAdapter):
    """A deterministic adapter used only for replay, fixtures and development."""

    def __init__(
        self,
        *,
        session_id: str,
        sensors: Iterable[SensorInfo],
        frames: Iterable[ReplayFrame],
        origin: PacketOrigin,
        started_at: datetime | None = None,
        sample_rate_hz: float | None = None,
    ) -> None:
        self._session_id = session_id
        self._sensors = {sensor.sensor_id: sensor for sensor in sensors}
        self._frames = tuple(frames)
        self._origin = origin
        self._started_at = started_at or datetime.now(UTC)
        self._sample_rate_hz = sample_rate_hz
        self._connected: set[str] = set()
        self._parser = WitMotion61Parser()

    async def discover(self) -> list[SensorInfo]:
        return list(self._sensors.values())

    async def connect(self, sensor_id: str) -> None:
        if sensor_id not in self._sensors:
            raise KeyError(f"Unknown replay sensor: {sensor_id}")
        self._connected.add(sensor_id)

    async def disconnect(self, sensor_id: str) -> None:
        self._connected.discard(sensor_id)

    async def stream(self) -> AsyncIterator[RawIMUPacket]:
        sequence_numbers = {sensor_id: 0 for sensor_id in self._sensors}
        for replay_frame in self._frames:
            if replay_frame.sensor_id not in self._connected:
                continue
            sensor = self._sensors[replay_frame.sensor_id]
            sequence_number = sequence_numbers[sensor.sensor_id]
            sequence_numbers[sensor.sensor_id] += 1
            yield self._parser.parse(
                replay_frame.frame,
                session_id=self._session_id,
                sensor=sensor,
                sequence_number=sequence_number,
                origin=self._origin,
                gateway_timestamp=self._started_at + timedelta(milliseconds=replay_frame.offset_ms),
                sample_rate_hz=self._sample_rate_hz,
            )
