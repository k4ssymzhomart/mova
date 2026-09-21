# Vendored from Phoenix 1480ab0:services/imu-gateway/src/phoenix_imu_gateway/wt901ble68.py
# Do not edit in mova -- change it upstream in Phoenix and re-copy. See VENDORED.md.
"""Non-clinical framing for the confirmed WT901BLE68 0x61 angles packet."""

from __future__ import annotations

import struct
from dataclasses import dataclass

FRAME_HEADER = b"\x55\x61"
FRAME_LENGTH = 11


@dataclass(frozen=True, slots=True)
class AnglesFrame:
    raw: bytes
    roll_degrees: float
    pitch_degrees: float
    yaw_degrees: float
    version: int


def checksum_is_valid(frame: bytes) -> bool:
    return len(frame) == FRAME_LENGTH and (sum(frame[:-1]) & 0xFF) == frame[-1]


def parse_angles_frame(frame: bytes) -> AnglesFrame:
    if len(frame) != FRAME_LENGTH or frame[:2] != FRAME_HEADER:
        raise ValueError("Expected an 11-byte 0x55 0x61 frame")
    if not checksum_is_valid(frame):
        raise ValueError("WT901BLE68 checksum mismatch")
    roll, pitch, yaw = struct.unpack("<hhh", frame[2:8])
    return AnglesFrame(
        raw=frame,
        roll_degrees=roll / 32768 * 180,
        pitch_degrees=pitch / 32768 * 180,
        yaw_degrees=yaw / 32768 * 180,
        version=int.from_bytes(frame[8:10], "little"),
    )


class AnglesFramer:
    """Extract complete frames from arbitrary BLE notification chunks."""

    def __init__(self) -> None:
        self._buffer = bytearray()

    def feed(self, chunk: bytes) -> list[bytes]:
        self._buffer.extend(chunk)
        frames: list[bytes] = []
        while True:
            index = self._buffer.find(FRAME_HEADER)
            if index < 0:
                self._buffer[:] = self._buffer[-1:]
                return frames
            if index:
                del self._buffer[:index]
            if len(self._buffer) < FRAME_LENGTH:
                return frames
            candidate = bytes(self._buffer[:FRAME_LENGTH])
            del self._buffer[:FRAME_LENGTH]
            if checksum_is_valid(candidate):
                frames.append(candidate)
