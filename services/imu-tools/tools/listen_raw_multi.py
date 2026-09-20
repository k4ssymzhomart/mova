# Ported from Phoenix 1480ab0:services/imu-gateway/listen_raw_multi.py
# Adapted for mova: import paths and capture directory only; the logic is unchanged.
"""Diagnostic raw BLE notification listener for three sensors at once.

Non-clinical: connects to thigh/shank/foot simultaneously and counts raw
notification payloads per role, with no frame parsing. Use this to confirm
all three sensors can stream concurrently without BLE adapter contention.

Example:
  python listen_raw_multi.py --seconds 20 \
    --sensor thigh=F4:03:1A:86:71:AD --sensor shank=D6:4D:35:86:B6:05 \
    --sensor foot=DF:E2:8F:65:F6:46
"""

from __future__ import annotations

import argparse
import asyncio
from collections import Counter

CHARACTERISTIC_UUID = "0000ffe4-0000-1000-8000-00805f9a34fb"
ROLES = {"thigh", "shank", "foot"}


def parse_sensor(value: str) -> tuple[str, str]:
    role, separator, address = value.partition("=")
    if separator != "=" or role.lower() not in ROLES or not address:
        raise argparse.ArgumentTypeError(
            "Use --sensor thigh=ADDRESS, shank=ADDRESS or foot=ADDRESS"
        )
    return role.lower(), address


async def listen(sensors: dict[str, str], seconds: float) -> Counter[str]:
    try:
        from bleak import BleakClient
    except ImportError as error:
        raise RuntimeError("Install BLE support: pip install -e .[ble]") from error

    counts: Counter[str] = Counter()
    last_payload: dict[str, str] = {}

    def notification(role: str):
        def handle(_: int, payload: bytearray) -> None:
            counts[role] += 1
            last_payload[role] = bytes(payload).hex()

        return handle

    clients = []
    try:
        for role, address in sensors.items():
            client = BleakClient(address)
            await client.connect()
            if not client.is_connected:
                raise RuntimeError(f"Could not connect {role} ({address})")
            await client.start_notify(CHARACTERISTIC_UUID, notification(role))
            clients.append(client)
            print(f"Connected and subscribed: {role} ({address})")
        print(f"Listening for {seconds:.0f}s on all three — try moving each sensor.")
        await asyncio.sleep(seconds)
    finally:
        for client in reversed(clients):
            try:
                await client.stop_notify(CHARACTERISTIC_UUID)
                await client.disconnect()
            except Exception as error:
                print(f"Cleanup warning: {error}")

    for role in sensors:
        sample = last_payload.get(role, "(none)")
        byte_count = len(sample) // 2 if sample != "(none)" else 0
        print(f"{role}: {counts[role]} notifications, last payload {byte_count} bytes: {sample}")
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Diagnostic multi-sensor raw listener; not clinical use."
    )
    parser.add_argument("--sensor", action="append", type=parse_sensor, required=True)
    parser.add_argument("--seconds", type=float, default=20, help="Listen duration; default: 20")
    args = parser.parse_args()
    sensors = dict(args.sensor)
    if set(sensors) != ROLES:
        parser.error("Provide exactly one --sensor for each role: thigh, shank, foot")
    asyncio.run(listen(sensors, args.seconds))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
