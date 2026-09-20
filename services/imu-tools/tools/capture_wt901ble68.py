# Ported from Phoenix 1480ab0:services/imu-gateway/capture_wt901ble68.py
# Adapted for mova: import paths and capture directory only; the logic is unchanged.
"""Capture non-clinical WT901BLE68 BLE notifications into an anonymised JSONL file.

Parses the currently observed 20-byte `0x55 0x61` frame shape (no checksum
field), confirmed on real hardware on 2026-09-05 across all three sensor
roles. Every record is tagged `origin: "hardware"` and
`validation_status: "unverified_checksum"` by the shared
`phoenix_imu_gateway` parser. It does not calculate ROM, repetitions, score or
clinical feedback -- except for the live terminal counter below, which is a
best-effort preview only; the authoritative rep count comes from
`scripts/label_reps.py` run on the finished file. Do not record patient
identifiers in the output filename or file contents.

Example:
  python capture_wt901ble68.py --seconds 60 --output captures/baseline.jsonl \
    --sensor thigh=AA:BB:CC:DD:EE:FF --sensor shank=AA:BB:CC:DD:EE:FE \
    --sensor foot=AA:BB:CC:DD:EE:FD

Pass --exercise to see reps counted live as you perform them:
  python capture_wt901ble68.py --seconds 25 --output captures/heel-good-good-01.jsonl \
    --sensor thigh=AA:BB:CC:DD:EE:FF --sensor shank=AA:BB:CC:DD:EE:FE \
    --sensor foot=AA:BB:CC:DD:EE:FD \
    --exercise exercise-heel-slide-v1 --expected 8
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any

from mova_imu.analysis.attempt_assessment import AttemptAssessment, assess_attempt
from mova_imu.analysis.exercise_signals import SIGNAL_PROFILES, profile_for
from mova_imu.gateway.framing import WitMotion61FrameBuffer
from mova_imu.gateway.models import PacketOrigin, SensorInfo, SensorRole
from mova_imu.gateway.parser import FrameParseError, WitMotion61Parser
from mova_imu.gateway.synthetic import packet_as_json
from mova_imu.gateway.transport import normalize_packet

SERVICE_UUID = "0000ffe5-0000-1000-8000-00805f9a34fb"
CHARACTERISTIC_UUID = "0000ffe4-0000-1000-8000-00805f9a34fb"
ROLES = {"thigh": SensorRole.THIGH, "shank": SensorRole.SHANK, "foot": SensorRole.FOOT}

# How often the background task re-scores the reps collected so far.
LIVE_CHECK_INTERVAL_SECONDS = 0.75
# No new frame from a sensor for this long mid-capture is flagged as a stall.
STALL_WARNING_SECONDS = 2.0


def parse_sensor(value: str) -> tuple[str, str]:
    role, separator, address = value.partition("=")
    if separator != "=" or role.lower() not in ROLES or not address:
        raise argparse.ArgumentTypeError(
            "Use --sensor thigh=ADDRESS, shank=ADDRESS or foot=ADDRESS"
        )
    return role.lower(), address


def _log(tag: str, message: str) -> None:
    print(f"[{tag}] {message}", flush=True)


async def _connect_all(sensors: dict[str, str]) -> tuple[dict[str, Any], list[Any]] | None:
    """Connect every sensor, printing sync status as each one lands.

    Returns ``None`` and leaves everything disconnected if any sensor fails,
    so the caller can abort cleanly instead of recording a partial rig.
    """
    from bleak import BleakClient

    clients: dict[str, Any] = {}
    order: list[Any] = []
    for role, address in sensors.items():
        client = BleakClient(address)
        try:
            await client.connect()
            if not client.is_connected:
                raise RuntimeError("connect() returned without an active link")
        except Exception as error:  # bleak raises several distinct exception types
            _log("SYNC", f"FAILED to connect {role} ({address}): {error}")
            for connected in reversed(order):
                try:
                    await connected.disconnect()
                except Exception:  # cleanup best-effort; the failure already printed
                    pass
            return None
        _log("SYNC", f"{role} connected ({address})")
        clients[role] = client
        order.append(client)
    _log("SYNC", "all 3 sensors connected -- recording started (Ctrl+C to stop early)")
    return clients, order


async def _live_feedback(
    events: list[dict[str, Any]],
    last_seen: dict[str, float],
    profile: Any,
    stop: asyncio.Event,
) -> None:
    """Poll the events collected so far and print new reps / stream stalls."""
    reps_seen = 0
    stalled: set[str] = set()
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=LIVE_CHECK_INTERVAL_SECONDS)
        except TimeoutError:
            pass
        now = time.monotonic()
        for role, seen_at in last_seen.items():
            gap = now - seen_at
            if gap > STALL_WARNING_SECONDS and role not in stalled:
                stalled.add(role)
                _log("SYNC", f"WARNING: no data from {role} for {gap:.1f}s -- check the link")
            elif gap <= STALL_WARNING_SECONDS and role in stalled:
                stalled.discard(role)
                _log("SYNC", f"{role} resumed")
        if profile is None or len(events) < 3:
            continue
        try:
            assessment = assess_attempt(
                list(events), profile, signal_quality={"scoring_permitted": True}
            )
        except Exception:
            continue  # best-effort preview only; never let this crash the capture
        if assessment.rep_report is None:
            continue
        count = assessment.rep_report.count
        while reps_seen < count:
            reps_seen += 1
            _log("REP", str(reps_seen))


async def capture(
    sensors: dict[str, str],
    output: Path,
    seconds: float,
    session_id: str,
    exercise_id: str | None,
) -> tuple[Counter[str], AttemptAssessment | None]:
    output.parent.mkdir(parents=True, exist_ok=True)
    counters: Counter[str] = Counter()
    packet_parser = WitMotion61Parser()
    buffers = {role: WitMotion61FrameBuffer() for role in sensors}
    sequence: Counter[str] = Counter()
    events: list[dict[str, Any]] = []
    last_seen = {role: time.monotonic() for role in sensors}
    profile = profile_for(exercise_id) if exercise_id else None

    connection = await _connect_all(sensors)
    if connection is None:
        _log("SYNC", "ABORTED -- not all sensors connected, nothing was recorded")
        return counters, None
    clients, ordered_clients = connection

    stop = asyncio.Event()
    live_task = asyncio.create_task(_live_feedback(events, last_seen, profile, stop))
    final_assessment: AttemptAssessment | None = None
    try:
        with output.open("x", encoding="utf-8") as stream:

            def notification(role: str, sensor: SensorInfo):
                def handle(_: int, payload: bytearray) -> None:
                    for raw in buffers[role].feed(bytes(payload)):
                        sequence[role] += 1
                        try:
                            packet = packet_parser.parse(
                                raw,
                                session_id=session_id,
                                sensor=sensor,
                                sequence_number=sequence[role],
                                origin=PacketOrigin.HARDWARE,
                            )
                        except FrameParseError:
                            counters[f"{role}_invalid"] += 1
                            continue
                        stream.write(packet_as_json(packet) + "\n")
                        stream.flush()
                        counters[role] += 1
                        last_seen[role] = time.monotonic()
                        events.append(normalize_packet(packet))

                return handle

            # stop_notify/disconnect must happen while `stream` is still open:
            # a BLE notification already in flight when the timer ends can
            # still fire after asyncio.sleep() returns, and it writes to
            # `stream` -- closing the file before that finishes raises
            # "I/O operation on closed file" from inside the callback.
            try:
                for role, client in clients.items():
                    sensor = SensorInfo(
                        sensor_id=f"{role}-{sensors[role]}",
                        role=ROLES[role],
                        address=sensors[role],
                        model="WT901BLE68",
                        service_uuid=SERVICE_UUID,
                        characteristic_uuid=CHARACTERISTIC_UUID,
                    )
                    await client.start_notify(CHARACTERISTIC_UUID, notification(role, sensor))
                await asyncio.sleep(seconds)
            except KeyboardInterrupt:
                _log("SYNC", "stopped early by user")
            finally:
                for client in reversed(ordered_clients):
                    try:
                        await client.stop_notify(CHARACTERISTIC_UUID)
                        await client.disconnect()
                    except Exception as error:  # cleanup must not discard an existing capture
                        print(f"Cleanup warning: {error}", file=sys.stderr)
    finally:
        stop.set()
        await live_task

    if profile is not None and events:
        try:
            final_assessment = assess_attempt(
                events, profile, signal_quality={"scoring_permitted": True}
            )
        except Exception as error:
            _log("RESULT", f"could not score the finished capture: {error}")
    return counters, final_assessment


def _report_result(
    counters: Counter[str], assessment: AttemptAssessment | None, expected: int | None
) -> bool:
    """Print the final pass/fail signal. Returns True on success."""
    per_role = {role: counters[role] for role in ROLES}
    dead = [role for role, count in per_role.items() if count == 0]
    if dead:
        _log("RESULT", f"FAILED -- no frames at all from: {', '.join(dead)}")
        return False
    spread = max(per_role.values()) - min(per_role.values())
    if spread > max(per_role.values()) * 0.2:
        _log("SYNC", f"WARNING: uneven frame counts across sensors: {per_role}")

    if assessment is None:
        total = sum(per_role.values())
        _log("RESULT", f"saved {total} frames; no --exercise given, rep count unknown")
        return True
    if assessment.rep_report is None or assessment.status == "blocked":
        _log("RESULT", f"FAILED -- could not score the capture: {assessment.reason}")
        return False

    count = assessment.rep_report.count
    if count == 0:
        _log("RESULT", "FAILED -- 0 reps detected; check sensor placement or re-record")
        return False
    if expected is not None and count != expected:
        _log("RESULT", f"MISMATCH -- detected {count} reps, expected {expected}")
        return False
    suffix = f" (matches --expected {expected})" if expected is not None else ""
    _log("RESULT", f"SUCCESS -- {count} reps detected{suffix}")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Diagnostic WT901BLE68 angles capture; not clinical use.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--sensor", action="append", type=parse_sensor, required=True)
    parser.add_argument("--seconds", type=float, default=60, help="Capture duration; default: 60")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--session-id",
        default="hardware-diagnostic-session",
        help=(
            "Non-clinical session label stored in each record; default: hardware-diagnostic-session"
        ),
    )
    parser.add_argument(
        "--exercise",
        choices=sorted(SIGNAL_PROFILES),
        default=None,
        help="enables the live rep counter and the final pass/fail verdict",
    )
    parser.add_argument(
        "--expected", type=int, default=None, help="expected rep count, checked against --exercise"
    )
    args = parser.parse_args()
    sensors = dict(args.sensor)
    if set(sensors) != set(ROLES):
        parser.error("Provide exactly one --sensor for each role: thigh, shank, foot")
    if args.seconds <= 0:
        parser.error("--seconds must be positive")
    if args.expected is not None and args.exercise is None:
        parser.error("--expected requires --exercise")
    if args.output.exists():
        parser.error(f"Refusing to overwrite existing capture: {args.output}")

    print(f"Connecting three sensors through {SERVICE_UUID}; capture is non-clinical.")
    counters, assessment = asyncio.run(
        capture(sensors, args.output, args.seconds, args.session_id, args.exercise)
    )
    if not counters:
        return 1
    print(f"Saved {sum(counters[role] for role in ROLES)} valid frames to {args.output}")
    print(dict(counters))
    return 0 if _report_result(counters, assessment, args.expected) else 1


if __name__ == "__main__":
    raise SystemExit(main())
