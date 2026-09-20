# Ported from Phoenix 1480ab0:services/imu-tools/debug_axes.py
# Adapted for mova: import paths and capture directory only; the logic is unchanged.
"""Live WT901BLE68 debug view: every value each sensor sends, its MAC, and the
per-axis range so you can see which orientation axis your knee flexion lands on.

Non-clinical diagnostic. Connects directly over BLE (bleak), so unlike the
patient-web path it DOES show the physical MAC address of each sensor.

    cd services/imu-tools
    python -m pip install -e ".[ble]"

    # find addresses first if you don't have them
    python scan_wt901ble68.py --seconds 8

    # then watch live (give the roles you have; thigh+shank enable the knee proxy)
    python debug_axes.py \
      --sensor thigh=F4:03:1A:86:71:AD \
      --sensor shank=F4:03:1A:86:71:AE \
      --sensor foot=F4:03:1A:86:71:AF

Do a heel slide while it runs. On Ctrl+C it prints which axis moved most and
what the rep detector (shank.pitch - thigh.pitch) actually saw.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

from mova_imu.gateway.framing import WitMotion61FrameBuffer
from mova_imu.gateway.parser import FrameParseError, WitMotion61Parser
from mova_imu.gateway.synthetic import packet_as_json  # noqa: F401 (used with --raw)

SERVICE_UUID = "0000ffe5-0000-1000-8000-00805f9a34fb"
CHARACTERISTIC_UUID = "0000ffe4-0000-1000-8000-00805f9a34fb"
ROLES = ("thigh", "shank", "foot")
EULER_AXES = ("roll", "pitch", "yaw")
ACCEL_AXES = ("ax", "ay", "az")
GYRO_AXES = ("gx", "gy", "gz")


def parse_sensor(value: str) -> tuple[str, str]:
    role, sep, address = value.partition("=")
    if sep != "=" or role.lower() not in ROLES or not address:
        raise argparse.ArgumentTypeError("use --sensor thigh=ADDR / shank=ADDR / foot=ADDR")
    return role.lower(), address


class Track:
    """Running min/max/last per channel for one sensor."""

    def __init__(self) -> None:
        self.last: dict[str, float] = {}
        self.lo: dict[str, float] = {}
        self.hi: dict[str, float] = {}
        self.count = 0
        self.first_t: float | None = None
        self.last_t = 0.0

    def update(self, name: str, value: float) -> None:
        self.last[name] = value
        self.lo[name] = value if name not in self.lo else min(self.lo[name], value)
        self.hi[name] = value if name not in self.hi else max(self.hi[name], value)

    def tick(self) -> None:
        now = time.monotonic()
        self.first_t = self.first_t or now
        self.last_t = now
        self.count += 1

    def hz(self) -> float:
        span = self.last_t - (self.first_t or self.last_t)
        return (self.count - 1) / span if span > 0 else 0.0

    def pp(self, name: str) -> float:
        if name not in self.lo:
            return 0.0
        return self.hi[name] - self.lo[name]


def _fmt_row(label: str, values: list[float], width: int = 9) -> str:
    return label.ljust(7) + " ".join(f"{v:+8.2f}" for v in values).ljust(width * len(values))


def render(sensors: dict[str, str], tracks: dict[str, Track], clear: bool) -> None:
    lines: list[str] = []
    lines.append(f"WT901BLE68 live  ({time.strftime('%H:%M:%S')})   Ctrl+C to stop")
    lines.append("")
    for role in ROLES:
        if role not in sensors:
            continue
        tr = tracks[role]
        lines.append(f"[{role.upper()}]  {sensors[role]}   {tr.hz():5.1f} Hz   n={tr.count}")
        if not tr.last:
            lines.append("   (waiting for data...)")
            lines.append("")
            continue
        lines.append("   " + _fmt_row("accel", [tr.last.get(a, 0.0) for a in ACCEL_AXES]))
        lines.append("   " + _fmt_row("gyro", [tr.last.get(a, 0.0) for a in GYRO_AXES]))
        lines.append("   " + _fmt_row("euler", [tr.last.get(a, 0.0) for a in EULER_AXES]))
        lines.append(
            "   " + _fmt_row("euler pp", [tr.pp(a) for a in EULER_AXES]) + "   <- peak-to-peak"
        )
        lines.append("")

    if "thigh" in sensors and "shank" in sensors:
        thigh, shank = tracks["thigh"], tracks["shank"]
        lines.append("knee proxy  shank.<axis> - thigh.<axis>   (deg)")
        for axis in EULER_AXES:
            if axis in shank.last and axis in thigh.last:
                cur = shank.last[axis] - thigh.last[axis]
                approx_range = shank.pp(axis) + thigh.pp(axis)
                mark = "  <-- rep detector uses this" if axis == "pitch" else ""
                lines.append(f"   {axis:<6} now {cur:+8.2f}   ~range {approx_range:7.2f}{mark}")
        lines.append("")
        lines.append("The axis with the largest range during a heel slide is the one to use.")

    out = "\n".join(lines)
    if clear:
        sys.stdout.write("\033[H\033[J")
    sys.stdout.write(out + "\n")
    sys.stdout.flush()


async def run(sensors: dict[str, str], dump_raw: bool, clear: bool) -> None:
    try:
        from bleak import BleakClient
    except ImportError as error:
        raise SystemExit('install BLE support:  python -m pip install -e ".[ble]"') from error

    parser = WitMotion61Parser()
    buffers = {role: WitMotion61FrameBuffer() for role in sensors}
    tracks = {role: Track() for role in sensors}
    from mova_imu.gateway.models import PacketOrigin, SensorInfo, SensorRole

    def make_handler(role: str, sensor: SensorInfo):
        seq = 0

        def handle(_: int, payload: bytearray) -> None:
            nonlocal seq
            for raw in buffers[role].feed(bytes(payload)):
                seq += 1
                try:
                    packet = parser.parse(
                        raw,
                        session_id="debug",
                        sensor=sensor,
                        sequence_number=seq,
                        origin=PacketOrigin.HARDWARE,
                    )
                except FrameParseError:
                    continue
                tr = tracks[role]
                tr.tick()
                for name, value in zip(ACCEL_AXES, packet.accelerometer_raw, strict=True):
                    tr.update(name, float(value))
                for name, value in zip(GYRO_AXES, packet.gyroscope_raw, strict=True):
                    tr.update(name, float(value))
                for name, value in zip(EULER_AXES, packet.euler_degrees, strict=True):
                    tr.update(name, float(value))
                if dump_raw:
                    print(packet_as_json(packet))

        return handle

    clients = []
    try:
        for role, address in sensors.items():
            info = SensorInfo(
                sensor_id=f"{role}-{address}",
                role=SensorRole(role),
                address=address,
                model="WT901BLE68",
                service_uuid=SERVICE_UUID,
                characteristic_uuid=CHARACTERISTIC_UUID,
            )
            print(f"connecting {role} ({address}) ...")
            client = BleakClient(address)
            await client.connect()
            if not client.is_connected:
                raise SystemExit(f"could not connect {role} ({address})")
            await client.start_notify(CHARACTERISTIC_UUID, make_handler(role, info))
            clients.append(client)
        print("connected. do a heel slide.\n")
        while not dump_raw:
            render(sensors, tracks, clear)
            await asyncio.sleep(0.2)
        while dump_raw:
            await asyncio.sleep(1.0)
    except asyncio.CancelledError:
        pass
    finally:
        for client in reversed(clients):
            try:
                await client.stop_notify(CHARACTERISTIC_UUID)
                await client.disconnect()
            except Exception as error:
                print(f"cleanup: {error}", file=sys.stderr)
        _summary(sensors, tracks)


def _summary(sensors: dict[str, str], tracks: dict[str, Track]) -> None:
    print("\n==== summary (peak-to-peak per axis, degrees) ====")
    for role in ROLES:
        if role not in sensors:
            continue
        tr = tracks[role]
        pps = {a: tr.pp(a) for a in EULER_AXES}
        best = max(pps, key=pps.get) if pps else "-"
        print(
            f"{role:<6} {sensors[role]}  "
            + "  ".join(f"{a}={pps[a]:6.1f}" for a in EULER_AXES)
            + f"   biggest: {best}"
        )
    if "thigh" in sensors and "shank" in sensors:
        thigh, shank = tracks["thigh"], tracks["shank"]
        print("\nknee proxy shank.<axis> - thigh.<axis>, combined range:")
        combined = {}
        for axis in EULER_AXES:
            combined[axis] = thigh.pp(axis) + shank.pp(axis)
            print(f"  {axis:<6} {combined[axis]:6.1f}")
        if any(combined.values()):
            pick = max(combined, key=combined.get)
            print(f"\n-> use axis '{pick}' for the rep detector.")
            if pick != "pitch":
                print(
                    "   (currently reps.py is hardcoded to 'pitch'; tell me and "
                    "I'll switch it to auto-select or to this axis.)"
                )
    print(
        "\nNote: a range near 360 usually means the angle wrapped +/-180 -- "
        "move through a smaller arc or ignore that axis."
    )


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--sensor",
        action="append",
        type=parse_sensor,
        required=True,
        help="role=MAC ; repeat for thigh/shank/foot",
    )
    ap.add_argument(
        "--raw", action="store_true", help="dump every parsed frame as JSON, no live table"
    )
    ap.add_argument(
        "--no-clear", action="store_true", help="do not clear the screen between refreshes"
    )
    args = ap.parse_args()
    sensors = dict(args.sensor)
    if not sensors:
        ap.error("give at least one --sensor")
    try:
        asyncio.run(run(sensors, dump_raw=args.raw, clear=not args.no_clear))
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
