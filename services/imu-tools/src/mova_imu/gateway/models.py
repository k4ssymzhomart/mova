# Vendored from Phoenix 1480ab0:services/imu-gateway/src/phoenix_imu_gateway/models.py
# Do not edit in mova -- change it upstream in Phoenix and re-copy. See VENDORED.md.
"""Versioned, non-clinical transport models for raw IMU samples."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


class SensorRole(StrEnum):
    """Roles require explicit confirmation; they are never inferred from MAC order."""

    THIGH = "thigh"
    SHANK = "shank"
    FOOT = "foot"


class PacketOrigin(StrEnum):
    HARDWARE = "hardware"
    SYNTHETIC = "synthetic"


class ValidationStatus(StrEnum):
    UNVERIFIED_CHECKSUM = "unverified_checksum"
    SYNTHETIC = "synthetic"


@dataclass(frozen=True, slots=True)
class SensorInfo:
    sensor_id: str
    role: SensorRole
    address: str | None = None
    model: str | None = None
    service_uuid: str | None = None
    characteristic_uuid: str | None = None


@dataclass(frozen=True, slots=True)
class RawIMUPacket:
    """A lossless transport representation; it contains no clinical interpretation."""

    session_id: str
    sensor: SensorInfo
    sequence_number: int
    gateway_timestamp: datetime
    raw_frame: bytes
    accelerometer_raw: tuple[int, int, int]
    gyroscope_raw: tuple[int, int, int]
    euler_degrees: tuple[float, float, float]
    origin: PacketOrigin
    validation_status: ValidationStatus
    sample_rate_hz: float | None
    accelerometer_range_g: float | None
    gyroscope_range_dps: float | None
    accelerometer_scale_g_per_lsb: float | None
    gyroscope_scale_dps_per_lsb: float | None
    adapter_version: str
    timestamp_device: float | None = None
    battery: int | None = None

    def __post_init__(self) -> None:
        if not self.session_id:
            raise ValueError("session_id is required")
        if self.sequence_number < 0:
            raise ValueError("sequence_number must be non-negative")
        if len(self.raw_frame) != 20:
            raise ValueError("raw_frame must be exactly 20 bytes")
        if self.sample_rate_hz is not None and self.sample_rate_hz <= 0:
            raise ValueError("sample_rate_hz must be positive when provided")
