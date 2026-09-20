# Ported from Phoenix 1480ab0:services/imu-gateway/inspect_gatt.py
# Adapted for mova: import paths and capture directory only; the logic is unchanged.
"""Diagnostic GATT inspection for a single BLE address.

Non-clinical: connects to one device and prints every service and
characteristic it actually exposes, with properties. Use this when the
assumed WT901BLE68 service/characteristic UUIDs are not found, to see what
the physical device really advertises.

Example:
  python inspect_gatt.py F4:03:1A:86:71:AD
"""

from __future__ import annotations

import argparse
import asyncio


async def inspect(address: str) -> None:
    try:
        from bleak import BleakClient
    except ImportError as error:
        raise RuntimeError("Install BLE support: pip install -e .[ble]") from error

    async with BleakClient(address) as client:
        print(f"Connected: {client.is_connected}")
        for service in client.services:
            print(f"\nService {service.uuid}")
            for characteristic in service.characteristics:
                props = ",".join(characteristic.properties)
                print(f"  Characteristic {characteristic.uuid}  properties=[{props}]")


def main() -> int:
    parser = argparse.ArgumentParser(description="Diagnostic GATT dump; not clinical use.")
    parser.add_argument("address", help="BLE MAC address to inspect")
    args = parser.parse_args()
    asyncio.run(inspect(args.address))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
