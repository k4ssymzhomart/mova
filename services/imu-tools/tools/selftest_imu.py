# Ported from Phoenix 1480ab0:services/imu-tools/selftest_imu.py
# Adapted for mova: import paths and capture directory only; the logic is unchanged.
"""Guided live self-test for the three-sensor WT901BLE68 rig.

Answers "is my rig healthy and wired the way I think?" in about 30 seconds:

  1. CONNECT   every sensor connects and streams frames.
  2. STILL     hold everything still: rate, gaps, frozen/clipped data and the
               calibration-still check are judged by the same rules as
               `analyze_capture.py`.
  3. IDENTIFY  you wave the thigh, then shank, then foot sensor; the test
               checks that the sensor mapped to that role is the one that moved
               (catches swapped MAC-to-role mappings before they poison a
               recording).

Non-clinical: nothing here counts reps, scores or gives feedback.

    python -m pip install -e ".[ble]"
    python selftest_imu.py \
      --sensor thigh=F4:03:1A:86:71:AD \
      --sensor shank=F4:03:1A:86:71:AE \
      --sensor foot=F4:03:1A:86:71:AF

No hardware? `--simulate` runs the same flow against generated samples. Add
`--swap thigh=shank` (with --simulate) to see the mapping check catch a swap.

Exit code: 0 all passed (warnings allowed), 1 any failure, 2 could not connect.
"""

from __future__ import annotations

import argparse
import asyncio
import math
import random
import sys
import time
from collections.abc import Callable
from pathlib import Path

from mova_imu.gateway.diagnostics import (
    FAIL,
    ROLES,
    Sample,
    analyze,
    identify_moving_sensor,
    render_report,
)
from mova_imu.gateway.framing import WitMotion61FrameBuffer
from mova_imu.gateway.parser import FrameParseError, WitMotion61Parser

SERVICE_UUID = "0000ffe5-0000-1000-8000-00805f9a34fb"
CHARACTERISTIC_UUID = "0000ffe4-0000-1000-8000-00805f9a34fb"
SIMULATED_RATE_HZ = 20.0


def parse_sensor(value: str) -> tuple[str, str]:
    role, separator, address = value.partition("=")
    if separator != "=" or role.lower() not in ROLES or not address:
        raise argparse.ArgumentTypeError(
            "Use --sensor thigh=ADDRESS, shank=ADDRESS or foot=ADDRESS"
        )
    return role.lower(), address


def parse_swap(value: str) -> tuple[str, str]:
    first, separator, second = value.partition("=")
    if separator != "=" or first not in ROLES or second not in ROLES:
        raise argparse.ArgumentTypeError("Use --swap thigh=shank")
    return first, second


class Rig:
    """Arrival-timestamped samples per role, fed by BLE callbacks or the simulator."""

    def __init__(self) -> None:
        self.samples: dict[str, list[Sample]] = {role: [] for role in ROLES}
        self._zero = time.monotonic()

    def now(self) -> float:
        """The one clock every sample and every phase window is measured on."""
        return time.monotonic() - self._zero

    def feed(self, role: str, sample: Sample) -> None:
        self.samples[role].append(sample)

    def since(self, start: float) -> dict[str, list[Sample]]:
        return {role: [s for s in rows if s.t >= start] for role, rows in self.samples.items()}


def say(tag: str, message: str) -> None:
    print(f"[{tag}] {message}", flush=True)


async def countdown(seconds: float, label: str) -> None:
    end = time.monotonic() + seconds
    while (remaining := end - time.monotonic()) > 0:
        print(f"\r  {label}  {remaining:3.1f}s ", end="", flush=True)
        await asyncio.sleep(0.1)
    print(f"\r  {label}  done   ")


async def run_phases(
    rig: Rig,
    *,
    still_seconds: float,
    move_seconds: float,
    skip_identify: bool,
    on_prompt: Callable[[str | None], None] = lambda role: None,
) -> bool:
    ok = True

    say("STILL", f"Put the leg down and hold ALL sensors still for {still_seconds:g}s")
    on_prompt(None)
    start = rig.now()
    await countdown(still_seconds, "hold still")
    report = analyze(rig.since(start))
    print(render_report(report))
    ok &= report.verdict != FAIL

    if skip_identify:
        return ok
    say("IDENTIFY", "Wave ONE sensor when prompted; keep the other two still")
    for role in ROLES:
        await countdown(2.0, f"get ready to wave the {role.upper()} sensor")
        on_prompt(role)
        start = rig.now()
        await countdown(move_seconds, f"WAVE the {role.upper()} sensor")
        on_prompt(None)
        moved, energy = identify_moving_sensor(rig.since(start))
        scores = "  ".join(f"{r}={energy.get(r, 0):.0f}" for r in ROLES)
        if moved == role:
            say("IDENTIFY", f"PASS  {role} is the sensor that moved   (gyro rms: {scores})")
        elif moved is None:
            say("IDENTIFY", f"FAIL  no single sensor clearly moved   (gyro rms: {scores})")
            ok = False
        else:
            say(
                "IDENTIFY",
                f"FAIL  you waved {role} but {moved} moved: MAC-to-role mapping is swapped "
                f"(gyro rms: {scores})",
            )
            ok = False
    return ok


async def connect_and_run(sensors: dict[str, str], args: argparse.Namespace) -> int:
    from bleak import BleakClient
    from mova_imu.gateway.models import PacketOrigin, SensorInfo, SensorRole

    rig = Rig()
    parser = WitMotion61Parser()
    buffers = {role: WitMotion61FrameBuffer() for role in sensors}
    counts = dict.fromkeys(sensors, 0)

    def handler(role: str, info: SensorInfo):
        def handle(_: int, payload: bytearray) -> None:
            arrived = rig.now()
            for raw in buffers[role].feed(bytes(payload)):
                counts[role] += 1
                try:
                    packet = parser.parse(
                        raw,
                        session_id="selftest",
                        sensor=info,
                        sequence_number=counts[role],
                        origin=PacketOrigin.HARDWARE,
                    )
                except FrameParseError:
                    continue
                rig.feed(
                    role,
                    Sample(
                        t=arrived,
                        seq=counts[role],
                        accel=packet.accelerometer_raw,
                        gyro=packet.gyroscope_raw,
                        euler=packet.euler_degrees,
                        raw_hex=raw.hex(),
                    ),
                )

        return handle

    clients: list = []
    try:
        for role, address in sensors.items():
            say("CONNECT", f"{role} ({address}) ...")
            client = BleakClient(address)
            try:
                await client.connect()
                info = SensorInfo(
                    sensor_id=f"{role}-{address}",
                    role=SensorRole(role),
                    address=address,
                    model="WT901BLE68",
                    service_uuid=SERVICE_UUID,
                    characteristic_uuid=CHARACTERISTIC_UUID,
                )
                await client.start_notify(CHARACTERISTIC_UUID, handler(role, info))
            except Exception as error:  # bleak raises several distinct exception types
                say("CONNECT", f"FAIL  {role}: {error}")
                return 2
            clients.append(client)
            say("CONNECT", f"PASS  {role}")
        await asyncio.sleep(1.0)
        silent = [role for role, n in counts.items() if n == 0]
        if silent:
            say("CONNECT", f"FAIL  connected but no frames from: {', '.join(silent)}")
            return 1
        ok = await run_phases(
            rig,
            still_seconds=args.still_seconds,
            move_seconds=args.move_seconds,
            skip_identify=args.skip_identify,
        )
    finally:
        for client in reversed(clients):
            try:
                await client.stop_notify(CHARACTERISTIC_UUID)
                await client.disconnect()
            except Exception as error:  # cleanup must not mask the result
                print(f"Cleanup warning: {error}", file=sys.stderr)
    return 0 if ok else 1


async def simulate_and_run(args: argparse.Namespace) -> int:
    """Same phases, fed by generated samples; `--swap a=b` exchanges two roles' motion."""
    rig = Rig()
    swap = dict(args.swap or [])
    swap.update({v: k for k, v in swap.items()})
    moving: list[str | None] = [None]
    rng = random.Random(1)

    async def emit() -> None:
        seq = 0
        while True:
            seq += 1
            now = rig.now()
            for role in ROLES:
                active = swap.get(role, role) == moving[0]
                wave = math.sin(now * 6) if active else 0.0
                gyro = tuple(int(wave * 6000 + rng.gauss(0, 30)) for _ in range(3))
                euler = (30 * wave, 20 * wave, 10 * wave)
                rig.feed(
                    role,
                    Sample(
                        now,
                        seq,
                        (rng.randint(-50, 50), rng.randint(-50, 50), 16384 + rng.randint(-50, 50)),
                        gyro,  # type: ignore[arg-type]
                        euler,
                    ),
                )
            await asyncio.sleep(1 / SIMULATED_RATE_HZ)

    task = asyncio.create_task(emit())
    try:
        say("CONNECT", "PASS  simulated rig (no hardware)")
        await asyncio.sleep(0.5)
        ok = await run_phases(
            rig,
            still_seconds=args.still_seconds,
            move_seconds=args.move_seconds,
            skip_identify=args.skip_identify,
            on_prompt=lambda role: moving.__setitem__(0, role),
        )
    finally:
        task.cancel()
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Guided live self-test for the WT901BLE68 rig; not clinical use.",
        epilog=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--sensor", action="append", type=parse_sensor)
    parser.add_argument("--still-seconds", type=float, default=5.0)
    parser.add_argument("--move-seconds", type=float, default=3.0)
    parser.add_argument("--skip-identify", action="store_true", help="only run the stream check")
    parser.add_argument("--simulate", action="store_true", help="generated samples, no BLE")
    parser.add_argument(
        "--swap", action="append", type=parse_swap, help="with --simulate: fake a role swap"
    )
    args = parser.parse_args()
    if args.still_seconds < 2 or args.move_seconds <= 0:
        parser.error("--still-seconds must be >= 2 and --move-seconds positive")
    if args.swap and not args.simulate:
        parser.error("--swap only applies to --simulate")
    try:
        if args.simulate:
            return asyncio.run(simulate_and_run(args))
        sensors = dict(args.sensor or [])
        if set(sensors) != set(ROLES):
            parser.error("Provide exactly one --sensor for each role: thigh, shank, foot")
        return asyncio.run(connect_and_run(sensors, args))
    except KeyboardInterrupt:
        say("SELFTEST", "aborted")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
