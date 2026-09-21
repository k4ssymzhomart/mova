# Vendored from Phoenix 1480ab0:services/imu-gateway/src/phoenix_imu_gateway/framing.py
# Do not edit in mova -- change it upstream in Phoenix and re-copy. See VENDORED.md.
"""Byte-stream framing for the only packet shape observed in the legacy script.

This module intentionally does not validate a checksum. The protocol material
needed to do that has not been supplied, so physical packets must remain marked
``unverified_checksum`` by downstream parsing.
"""

from __future__ import annotations


class WitMotion61FrameBuffer:
    """Accumulate fragmented notifications and safely resynchronise to frames."""

    FRAME_LENGTH = 20
    HEADER = b"\x55\x61"

    def __init__(self) -> None:
        self._buffer = bytearray()

    def feed(self, data: bytes) -> list[bytes]:
        """Return complete header-aligned frames while retaining incomplete data."""
        self._buffer.extend(data)
        frames: list[bytes] = []
        while True:
            header_index = self._buffer.find(self.HEADER)
            if header_index < 0:
                # Retain a possible first header byte for the next notification.
                self._buffer[:] = self._buffer[-1:] if self._buffer[-1:] == b"\x55" else b""
                return frames
            if header_index:
                del self._buffer[:header_index]
            if len(self._buffer) < self.FRAME_LENGTH:
                return frames
            frames.append(bytes(self._buffer[: self.FRAME_LENGTH]))
            del self._buffer[: self.FRAME_LENGTH]

    def clear(self) -> None:
        self._buffer.clear()
