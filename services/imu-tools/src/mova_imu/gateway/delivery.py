# Vendored from Phoenix 1480ab0:services/imu-gateway/src/phoenix_imu_gateway/delivery.py
# Do not edit in mova -- change it upstream in Phoenix and re-copy. See VENDORED.md.
"""Reliable gateway-to-server delivery primitives.

The sender is deliberately transport-only: it does not interpret movement or
make decisions about exercise quality.
"""

from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.request
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from .models import RawIMUPacket
from .transport import DurableBuffer, normalize_packet


class DeliveryError(RuntimeError):
    """The central API did not acknowledge an event."""


@dataclass(frozen=True, slots=True)
class DeliveryResult:
    delivered: int
    buffered: int


async def deliver_packets(
    packets: list[RawIMUPacket],
    *,
    send: Callable[[dict[str, Any]], Awaitable[None]],
    buffer: DurableBuffer,
) -> DeliveryResult:
    """Send packets in order; persist each failed packet for later replay."""
    delivered = 0
    buffered = 0
    for packet in packets:
        try:
            await send(normalize_packet(packet))
        except Exception as exc:
            # Keep the original event; the caller can retry after connectivity
            # returns. The exception is intentionally not swallowed silently.
            buffer.append(packet)
            buffered += 1
            if isinstance(exc, KeyboardInterrupt | SystemExit):
                raise
        else:
            delivered += 1
    return DeliveryResult(delivered=delivered, buffered=buffered)


async def flush_buffer(
    *, send: Callable[[dict[str, Any]], Awaitable[None]], buffer: DurableBuffer
) -> DeliveryResult:
    """Retry durable events in order and retain precisely the unacknowledged tail."""
    pending = buffer.pending()
    delivered = 0
    remaining: list[dict[str, Any]] = []
    for index, event in enumerate(pending):
        try:
            await send(event)
        except Exception:
            remaining.extend(pending[index:])
            break
        delivered += 1
    buffer.replace(remaining)
    return DeliveryResult(delivered=delivered, buffered=len(remaining))


class HttpJsonSender:
    """Small dependency-free HTTPS sender for the local gateway process."""

    def __init__(self, url: str, *, bearer_token: str, timeout_seconds: float = 5.0) -> None:
        self.url = url
        self.bearer_token = bearer_token
        self.timeout_seconds = timeout_seconds

    async def __call__(self, event: dict[str, Any]) -> None:
        await asyncio.to_thread(self._send_sync, event)

    def _send_sync(self, event: dict[str, Any]) -> None:
        body = json.dumps(event, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            self.url,
            data=body,
            headers={
                "Authorization": f"Bearer {self.bearer_token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                if not 200 <= response.status < 300:
                    raise DeliveryError(f"API rejected packet with HTTP {response.status}")
        except urllib.error.HTTPError as exc:
            raise DeliveryError(f"API rejected packet with HTTP {exc.code}") from exc
        except urllib.error.URLError as exc:
            raise DeliveryError(f"API is unavailable: {exc.reason}") from exc
