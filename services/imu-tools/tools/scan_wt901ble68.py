# Ported from Phoenix 1480ab0:services/imu-tools/scan_wt901ble68.py
# Adapted for mova: import paths and capture directory only; the logic is unchanged.
"""Diagnostic BLE scan to find nearby WT901BLE68 sensor addresses.

Non-clinical: only lists discovered device names/addresses and, when a device
advertises the confirmed WT901BLE68 service UUID, flags it as a likely match.
It does not connect, read angles or assign a role automatically.

Example:
  python scan_wt901ble68.py --seconds 8
"""

from __future__ import annotations

import argparse
import asyncio

SERVICE_UUID = "0000ffe5-0000-1000-8000-00805f9a34fb"


async def scan(seconds: float) -> None:
    try:
        from bleak import BleakScanner
    except ImportError as error:
        raise RuntimeError("Install BLE support: pip install -e .[ble]") from error

    print(f"Scanning for {seconds:.0f}s. Power on one sensor at a time to tell them apart.")
    devices = await BleakScanner.discover(timeout=seconds, return_adv=True)
    if not devices:
        print("No BLE devices found. Check the sensors are powered on and in range.")
        return

    for address, (device, advertisement) in devices.items():
        service_uuids = [uuid.lower() for uuid in (advertisement.service_uuids or [])]
        likely_match = SERVICE_UUID in service_uuids
        name = device.name or "(no name)"
        marker = " <- likely WT901BLE68" if likely_match else ""
        print(f"{address}  rssi={advertisement.rssi:>4}  name={name}{marker}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Diagnostic BLE scan; not clinical use.")
    parser.add_argument("--seconds", type=float, default=8, help="Scan duration; default: 8")
    args = parser.parse_args()
    if args.seconds <= 0:
        parser.error("--seconds must be positive")
    asyncio.run(scan(args.seconds))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
