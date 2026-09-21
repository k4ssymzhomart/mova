# Ported from Phoenix 1480ab0:services/imu-tools/listen_raw.py
# Adapted for mova: import paths and capture directory only; the logic is unchanged.
"""Diagnostic raw BLE notification listener for a single WT901BLE68 address.

Non-clinical: prints every raw notification byte payload as it arrives, with
no frame parsing or filtering. Use this to tell apart "no data is arriving at
all" from "data arrives but does not match the expected frame shape".

Example:
  python listen_raw.py F4:03:1A:86:71:AD --seconds 20
"""

from __future__ import annotations

import argparse
import asyncio

CHARACTERISTIC_UUID = "0000ffe4-0000-1000-8000-00805f9a34fb"


async def listen(address: str, seconds: float) -> int:
    try:
        from bleak import BleakClient
    except ImportError as error:
        raise RuntimeError("Install BLE support: pip install -e .[ble]") from error

    count = 0

    def handle(_: int, payload: bytearray) -> None:
        nonlocal count
        count += 1
        print(f"[{count}] {len(payload)} bytes: {bytes(payload).hex()}")

    async with BleakClient(address) as client:
        print(f"Connected: {client.is_connected}")
        await client.start_notify(CHARACTERISTIC_UUID, handle)
        print(f"Subscribed. Listening for {seconds:.0f}s — try moving the sensor now.")
        await asyncio.sleep(seconds)
        await client.stop_notify(CHARACTERISTIC_UUID)
    return count


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Diagnostic raw notification listener; not clinical use."
    )
    parser.add_argument("address", help="BLE MAC address to listen to")
    parser.add_argument("--seconds", type=float, default=20, help="Listen duration; default: 20")
    args = parser.parse_args()
    count = asyncio.run(listen(args.address, args.seconds))
    print(f"Total notifications received: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
