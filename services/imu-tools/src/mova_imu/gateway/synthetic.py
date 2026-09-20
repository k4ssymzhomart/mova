# Vendored from Phoenix 1480ab0:services/imu-gateway/src/phoenix_imu_gateway/synthetic.py
# Do not edit in mova -- change it upstream in Phoenix and re-copy. See VENDORED.md.
"""Deterministic development-only frames, explicitly not patient measurements."""

from __future__ import annotations

import asyncio
import json
import struct
from dataclasses import asdict
from datetime import UTC, datetime

from .models import PacketOrigin, RawIMUPacket, SensorInfo, SensorRole
from .replay import ReplayAdapter, ReplayFrame


def _int16_angle(degrees: float) -> int:
    return round(max(-180.0, min(180.0, degrees)) / 180.0 * 32768.0)


def make_observed_shape_frame(
    *,
    accelerometer: tuple[int, int, int],
    gyroscope: tuple[int, int, int],
    euler_degrees: tuple[float, float, float],
) -> bytes:
    """Build a 20-byte shape inferred from legacy code, not a device protocol claim."""
    return b"\x55\x61" + struct.pack(
        "<9h",
        *accelerometer,
        *gyroscope,
        *(_int16_angle(angle) for angle in euler_degrees),
    )


def default_sensors() -> tuple[SensorInfo, SensorInfo, SensorInfo]:
    return (
        SensorInfo("synthetic-thigh", SensorRole.THIGH, model="synthetic"),
        SensorInfo("synthetic-shank", SensorRole.SHANK, model="synthetic"),
        SensorInfo("synthetic-foot", SensorRole.FOOT, model="synthetic"),
    )


def build_synthetic_replay() -> ReplayAdapter:
    """Create three deterministic motion-shaped streams for UI and transport tests."""
    sensors = default_sensors()
    frames: list[ReplayFrame] = []
    # A waveform only to exercise transport/rendering; it is not ROM or a rep.
    for sample_index, shank_pitch in enumerate((0.0, 8.0, 16.0, 8.0, 0.0)):
        offset_ms = sample_index * 50
        for sensor, pitch in (
            (sensors[0], 0.0),
            (sensors[1], shank_pitch),
            (sensors[2], shank_pitch / 3.0),
        ):
            frames.append(
                ReplayFrame(
                    sensor_id=sensor.sensor_id,
                    offset_ms=offset_ms,
                    frame=make_observed_shape_frame(
                        accelerometer=(0, 0, 16384),
                        gyroscope=(0, round(pitch * 20), 0),
                        euler_degrees=(0.0, pitch, 0.0),
                    ),
                )
            )
    return ReplayAdapter(
        session_id="synthetic-session-v1",
        sensors=sensors,
        frames=frames,
        origin=PacketOrigin.SYNTHETIC,
        started_at=datetime(2026, 1, 1, tzinfo=UTC),
        sample_rate_hz=20.0,
    )


def packet_as_json(packet: RawIMUPacket) -> str:
    document = asdict(packet)
    document["sensor"]["role"] = packet.sensor.role.value
    document["gateway_timestamp"] = packet.gateway_timestamp.isoformat()
    document["raw_frame_hex"] = packet.raw_frame.hex()
    del document["raw_frame"]
    document["origin"] = packet.origin.value
    document["validation_status"] = packet.validation_status.value
    return json.dumps(document, ensure_ascii=False, sort_keys=True)


async def _main() -> None:
    replay = build_synthetic_replay()
    for sensor in await replay.discover():
        await replay.connect(sensor.sensor_id)
    async for packet in replay.stream():
        print(packet_as_json(packet))


if __name__ == "__main__":
    asyncio.run(_main())
