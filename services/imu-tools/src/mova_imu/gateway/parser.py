# Vendored from Phoenix 1480ab0:services/imu-gateway/src/phoenix_imu_gateway/parser.py
# Do not edit in mova -- change it upstream in Phoenix and re-copy. See VENDORED.md.
"""Strict framing parser for the only frame shape observed in the legacy script."""

from __future__ import annotations

import struct
from datetime import UTC, datetime

from .models import (
    PacketOrigin,
    RawIMUPacket,
    SensorInfo,
    ValidationStatus,
)


class FrameParseError(ValueError):
    """The bytes are not the observed `0x55 0x61` 20-byte frame shape."""


class WitMotion61Parser:
    FRAME_LENGTH = 20
    HEADER = b"\x55\x61"
    ADAPTER_VERSION = "0.1.0"

    def parse(
        self,
        frame: bytes,
        *,
        session_id: str,
        sensor: SensorInfo,
        sequence_number: int,
        origin: PacketOrigin,
        gateway_timestamp: datetime | None = None,
        sample_rate_hz: float | None = None,
        accelerometer_range_g: float | None = None,
        gyroscope_range_dps: float | None = None,
        accelerometer_scale_g_per_lsb: float | None = None,
        gyroscope_scale_dps_per_lsb: float | None = None,
    ) -> RawIMUPacket:
        if len(frame) != self.FRAME_LENGTH:
            raise FrameParseError(f"Expected {self.FRAME_LENGTH} bytes, got {len(frame)} bytes")
        if frame[:2] != self.HEADER:
            raise FrameParseError("Expected 0x55 0x61 frame header")

        values = struct.unpack("<9h", frame[2:])
        validation_status = (
            ValidationStatus.SYNTHETIC
            if origin is PacketOrigin.SYNTHETIC
            else ValidationStatus.UNVERIFIED_CHECKSUM
        )
        return RawIMUPacket(
            session_id=session_id,
            sensor=sensor,
            sequence_number=sequence_number,
            gateway_timestamp=gateway_timestamp or datetime.now(UTC),
            raw_frame=frame,
            accelerometer_raw=values[:3],
            gyroscope_raw=values[3:6],
            euler_degrees=tuple(value / 32768.0 * 180.0 for value in values[6:9]),
            origin=origin,
            validation_status=validation_status,
            sample_rate_hz=sample_rate_hz,
            accelerometer_range_g=accelerometer_range_g,
            gyroscope_range_dps=gyroscope_range_dps,
            accelerometer_scale_g_per_lsb=accelerometer_scale_g_per_lsb,
            gyroscope_scale_dps_per_lsb=gyroscope_scale_dps_per_lsb,
            adapter_version=self.ADAPTER_VERSION,
        )
