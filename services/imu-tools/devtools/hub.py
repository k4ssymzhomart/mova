# Ported from Phoenix 1480ab0:devtools/hub.py
# Adapted for mova: paths, imports and branding only; the logic is unchanged.
"""Live sensor hub for the IMU dev tools.

One `Hub` owns whichever frame source is active (real BLE sensors, a built-in
simulator, or a replayed capture), keeps a rolling buffer of packets, records
captures in the same JSONL format as `capture_wt901ble68.py`, and re-runs the
production analysis pipeline on the buffer a couple of times a second.

BLE and the simulators run on a private asyncio loop in a background thread, so
the HTTP server stays a plain threaded script. All shared state sits behind
`Hub.lock`. Non-clinical.
"""

from __future__ import annotations

import asyncio
import json
import math
import random
import struct
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from functools import partial
from pathlib import Path
from typing import Any

import analysis
from analysis import SAFE_NAME
from mova_imu.analysis.exercise_signals import SIGNAL_PROFILES
from mova_imu.analysis.signal_quality import evaluate_signal_quality
from jobs import Job
from mova_imu.gateway.diagnostics import Sample
from mova_imu.gateway.diagnostics import analyze as analyze_health
from mova_imu.gateway.framing import WitMotion61FrameBuffer
from mova_imu.gateway.models import PacketOrigin, SensorInfo, SensorRole
from mova_imu.gateway.parser import FrameParseError, WitMotion61Parser
from mova_imu.gateway.synthetic import packet_as_json
from mova_imu.gateway.transport import normalize_packet

ROLES = ("thigh", "shank", "foot")
SERVICE_UUID = "0000ffe5-0000-1000-8000-00805f9a34fb"
CHARACTERISTIC_UUID = "0000ffe4-0000-1000-8000-00805f9a34fb"
MAX_BUFFER_EVENTS = 24_000
HZ_WINDOW_SECONDS = 3.0
ANALYSIS_MIN_INTERVAL = 0.75
QUALITY_WINDOW_SECONDS = 8.0
STALL_SECONDS = 1.5
SIM_RATE_HZ = 20.0
DEFAULT_EXERCISE = "exercise-heel-slide-v1"
LIVE_HIDDEN_FINDINGS = {"no_static_window"}  # expected while a person is moving


def pack_frame(accel: tuple[int, ...], gyro: tuple[int, ...], euler: tuple[float, ...]) -> bytes:
    """The confirmed 20-byte `0x55 0x61` frame: 3 accel, 3 gyro, 3 euler int16."""

    def angle(degrees: float) -> int:
        wrapped = (degrees + 180.0) % 360.0 - 180.0
        return max(-32768, min(32767, round(wrapped / 180.0 * 32768.0)))

    clamp = lambda v: max(-32768, min(32767, int(v)))  # noqa: E731
    values = [*map(clamp, accel), *map(clamp, gyro), *map(angle, euler)]
    return struct.pack("<2s9h", b"\x55\x61", *values)


@dataclass
class SensorState:
    role: str
    address: str | None = None
    status: str = "idle"  # idle | connecting | connected | disconnected | error | simulated
    error: str | None = None
    rssi: int | None = None
    frames: int = 0
    invalid: int = 0
    last_mono: float | None = None
    arrivals: deque = field(default_factory=lambda: deque(maxlen=400))
    euler: tuple[float, float, float] | None = None
    accel: tuple[int, int, int] | None = None
    gyro: tuple[int, int, int] | None = None
    trace: deque = field(default_factory=lambda: deque(maxlen=200))  # (t, roll, pitch, yaw)

    def snapshot(self, now: float) -> dict[str, Any]:
        recent = [t for t in self.arrivals if now - t <= HZ_WINDOW_SECONDS]
        hz = (len(recent) - 1) / (recent[-1] - recent[0]) if len(recent) > 2 else 0.0
        return {
            "role": self.role,
            "address": self.address,
            "status": self.status,
            "error": self.error,
            "rssi": self.rssi,
            "frames": self.frames,
            "invalid": self.invalid,
            "hz": round(hz, 1),
            "age_s": None if self.last_mono is None else round(now - self.last_mono, 2),
            "euler": self.euler,
            "accel": self.accel,
            "gyro": self.gyro,
            "trace": [list(item) for item in self.trace],
        }


@dataclass
class Recording:
    path: Path
    stream: Any
    exercise_id: str
    expected: int | None
    range_label: str
    tempo_label: str
    subject: str
    auto_label: bool
    started: float
    counts: dict[str, int] = field(default_factory=lambda: dict.fromkeys(ROLES, 0))
    synthetic: bool = False


class Hub:
    def __init__(self, capture_dir: Path) -> None:
        self.capture_dir = capture_dir
        self.lock = threading.RLock()
        self.sensors = {role: SensorState(role) for role in ROLES}
        self.buffer: deque[dict[str, Any]] = deque(maxlen=MAX_BUFFER_EVENTS)
        self.version = 0
        self.take_started = time.time()
        self.source: dict[str, Any] = {"kind": "none"}
        self.log: deque[tuple[float, str]] = deque(maxlen=80)
        self.scan_state: dict[str, Any] = {"status": "idle", "devices": [], "error": None}
        self.exercise_id = DEFAULT_EXERCISE
        self.prescribed: int | None = 10
        self.overrides: dict[str, Any] = {}
        self.analysis: dict[str, Any] = {"status": "waiting"}
        self.quality: dict[str, Any] | None = None
        self.health: dict[str, Any] | None = None
        self.recording: Recording | None = None
        self.job: Job | None = None
        self.capture: dict[str, Any] | None = None
        self.last_recording_result: dict[str, Any] | None = None
        self.sim = {"amplitude": 45.0, "period": 4.0, "reps": 8, "noise": 0.2, "stalled": []}
        self._sequence = dict.fromkeys(ROLES, 0)
        self._framers = {role: WitMotion61FrameBuffer() for role in ROLES}
        self._parser = WitMotion61Parser()
        self._clients: dict[str, Any] = {}
        self._closing = False
        self._task: asyncio.Task | None = None
        self._loop = asyncio.new_event_loop()
        threading.Thread(target=self._loop.run_forever, daemon=True, name="hub-loop").start()
        threading.Thread(target=self._analysis_loop, daemon=True, name="hub-analysis").start()

    # ------------------------------------------------------------ helpers

    def say(self, message: str) -> None:
        with self.lock:
            self.log.append((time.time(), message))

    def _submit(self, coroutine: Any) -> None:
        asyncio.run_coroutine_threadsafe(coroutine, self._loop)

    def profile(self) -> Any:
        return analysis.profile_with(self.exercise_id, self.overrides)

    # ------------------------------------------------------------- ingest

    def feed_bytes(self, role: str, payload: bytes, origin: PacketOrigin) -> None:
        """Raw BLE notification chunk -> complete frames (notifications may fragment)."""
        for raw in self._framers[role].feed(payload):
            self.on_frame(role, raw, origin)

    def on_frame(
        self, role: str, raw: bytes, origin: PacketOrigin, stamp: datetime | None = None
    ) -> None:
        with self.lock:
            state = self.sensors[role]
            self._sequence[role] += 1
            info = SensorInfo(
                sensor_id=f"{role}-{state.address or self.source['kind']}",
                role=SensorRole(role),
                address=state.address,
                model="WT901BLE68",
                service_uuid=SERVICE_UUID,
                characteristic_uuid=CHARACTERISTIC_UUID,
            )
            try:
                packet = self._parser.parse(
                    raw,
                    session_id="devtools",
                    sensor=info,
                    sequence_number=self._sequence[role],
                    origin=origin,
                    gateway_timestamp=stamp,
                )
            except FrameParseError:
                state.invalid += 1
                return
            now = time.monotonic()
            state.frames += 1
            state.last_mono = now
            state.arrivals.append(now)
            state.euler = tuple(round(v, 2) for v in packet.euler_degrees)  # type: ignore[assignment]
            state.accel = packet.accelerometer_raw
            state.gyro = packet.gyroscope_raw
            wall = packet.gateway_timestamp.timestamp()
            state.trace.append((round(wall, 2), *state.euler))
            event = normalize_packet(packet)
            event.update(t=wall, seq=self._sequence[role], raw_hex=raw.hex())
            self.buffer.append(event)
            self.version += 1
            if self.recording is not None:
                self.recording.stream.write(packet_as_json(packet) + "\n")
                self.recording.counts[role] += 1

    def reset(self) -> None:
        """Start a new take: forget buffered packets and counters, keep connections."""
        with self.lock:
            self.buffer.clear()
            self.version += 1
            self.take_started = time.time()
            for state in self.sensors.values():
                state.frames = state.invalid = 0
                state.arrivals.clear()
                state.trace.clear()
            self._sequence = dict.fromkeys(ROLES, 0)
            self.analysis = {"status": "waiting"}
            self.quality = self.health = None
            self._framers = {role: WitMotion61FrameBuffer() for role in ROLES}

    # -------------------------------------------------------- exercise setup

    def set_exercise(
        self, exercise_id: str, prescribed: int | None, overrides: dict[str, Any] | None
    ) -> None:
        if exercise_id not in SIGNAL_PROFILES:
            raise ValueError(f"unknown exercise {exercise_id!r}")
        with self.lock:
            self.exercise_id = exercise_id
            self.prescribed = prescribed
            self.overrides = overrides or {}
            self.version += 1

    # ------------------------------------------------------------------ BLE

    def scan(self, seconds: float) -> None:
        with self.lock:
            if self.scan_state["status"] == "scanning":
                return
            self.scan_state = {"status": "scanning", "devices": [], "error": None}
        self._submit(self._scan(seconds))

    async def _scan(self, seconds: float) -> None:
        try:
            from bleak import BleakScanner

            found = await BleakScanner.discover(timeout=seconds, return_adv=True)
            devices = []
            for address, (device, advertisement) in found.items():
                uuids = [uuid.lower() for uuid in (advertisement.service_uuids or [])]
                name = device.name or advertisement.local_name or ""
                devices.append(
                    {
                        "address": address,
                        "name": name,
                        "rssi": advertisement.rssi,
                        "likely": SERVICE_UUID in uuids or name.upper().startswith("WT"),
                    }
                )
            devices.sort(key=lambda d: (not d["likely"], -(d["rssi"] or -200)))
            with self.lock:
                self.scan_state = {"status": "done", "devices": devices, "error": None}
            self.say(f"scan finished: {len(devices)} device(s)")
        except Exception as error:  # bleak raises several distinct exception types
            with self.lock:
                self.scan_state = {"status": "error", "devices": [], "error": str(error)}
            self.say(f"scan failed: {error}")

    def connect(self, assignments: dict[str, str]) -> None:
        clean = {r: a for r, a in assignments.items() if r in ROLES and a}
        if not clean:
            raise ValueError("assign at least one sensor to a role")
        if len(set(clean.values())) != len(clean):
            raise ValueError("the same address is assigned to two roles")
        self._submit(self._connect(clean))

    async def _connect(self, assignments: dict[str, str]) -> None:
        await self._stop_source()
        self.reset()
        self._closing = False
        self.source = {"kind": "ble", "detail": "Bluetooth sensors"}
        try:
            from bleak import BleakClient
        except ImportError:
            self.say('bleak is not installed: pip install -e "services/imu-tools[ble]"')
            return
        for role, address in assignments.items():
            state = self.sensors[role]
            with self.lock:
                state.address, state.status, state.error = address, "connecting", None
            self.say(f"connecting {role} ({address}) ...")
            client = BleakClient(address, disconnected_callback=partial(self._lost, role))
            try:
                await client.connect()
                await client.start_notify(
                    CHARACTERISTIC_UUID,
                    lambda _h, data, role=role: self.feed_bytes(
                        role, bytes(data), PacketOrigin.HARDWARE
                    ),
                )
            except Exception as error:  # bleak raises several distinct exception types
                with self.lock:
                    state.status, state.error = "error", str(error) or type(error).__name__
                self.say(f"{role}: connect FAILED - {state.error}")
                try:
                    await client.disconnect()
                except Exception:  # noqa: S110 - best-effort cleanup after a failed connect
                    pass
                continue
            self._clients[role] = client
            with self.lock:
                state.status = "connected"
            self.say(f"{role} connected")

    def _lost(self, role: str, _client: Any) -> None:
        if self._closing:
            return
        with self.lock:
            self.sensors[role].status = "disconnected"
            self.sensors[role].error = "link lost"
        self.say(f"{role}: LINK LOST")

    async def _disconnect_ble(self) -> None:
        self._closing = True
        for role, client in list(self._clients.items()):
            try:
                await client.stop_notify(CHARACTERISTIC_UUID)
            except Exception:  # noqa: S110 - already gone is fine
                pass
            try:
                await client.disconnect()
            except Exception:  # noqa: S110 - cleanup must not raise
                pass
            with self.lock:
                self.sensors[role].status = "idle"
            self.say(f"{role} disconnected")
        self._clients.clear()

    # -------------------------------------------------------------- sources

    def stop_source(self) -> None:
        self._submit(self._stop_source())

    async def _stop_source(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None
        await self._disconnect_ble()
        with self.lock:
            for state in self.sensors.values():
                state.status = "idle"
                state.error = None
            self.source = {"kind": "none"}

    def start_sim(self, params: dict[str, Any]) -> None:
        with self.lock:
            for key in ("amplitude", "period", "reps", "noise"):
                if params.get(key) not in (None, ""):
                    self.sim[key] = float(params[key])
            self.sim["stalled"] = []
        self._submit(self._start_task("sim", "Simulator", self._sim_loop()))

    def update_sim(self, params: dict[str, Any]) -> None:
        with self.lock:
            for key in ("amplitude", "period", "reps", "noise"):
                if params.get(key) not in (None, ""):
                    self.sim[key] = float(params[key])
            if isinstance(params.get("stalled"), list):
                self.sim["stalled"] = [r for r in params["stalled"] if r in ROLES]

    def start_replay(self, name: str, speed: float, loop: bool) -> None:
        path = analysis.resolve_capture(self.capture_dir, name)
        events = analysis.load_file_events(str(path))
        if not events:
            raise ValueError("that capture has no readable packets")
        self._submit(
            self._start_task(
                "replay", f"Replaying {path.name}", self._replay_loop(events, speed, loop)
            )
        )

    async def _start_task(
        self, kind: str, detail: str, coroutine: Any, status: str = "simulated"
    ) -> None:
        await self._stop_source()
        self.reset()
        with self.lock:
            self.source = {"kind": kind, "detail": detail}
            for state in self.sensors.values():
                state.status = status
                if status == "simulated":
                    state.address = kind
        self.say(f"source: {detail}")
        self._task = asyncio.ensure_future(coroutine)

    async def _sim_loop(self) -> None:
        pace = 1.0 / SIM_RATE_HZ
        started = time.monotonic()
        deadline = started
        previous = 0.0
        rng = random.Random(7)
        while True:
            profile = self.profile()
            spec = profile.primary
            with self.lock:
                p = dict(self.sim)
            elapsed = time.monotonic() - started
            excursion = self._sim_excursion(elapsed, p, profile)
            velocity = (excursion - previous) * SIM_RATE_HZ
            previous = excursion
            axis = 0 if spec.axis == "ori_roll" else 1
            for role, base in (("thigh", (3.0, 8.0, 40.0)), ("shank", (2.0, 8.0, 42.0)),
                               ("foot", (1.0, 5.0, 44.0))):  # fmt: skip
                if role in p["stalled"]:
                    continue
                euler = list(base)
                if (spec.kind == "relative" and role == spec.distal) or (
                    spec.kind == "absolute" and role == spec.role
                ):
                    euler[axis] += excursion
                euler = [v + rng.gauss(0, p["noise"]) for v in euler]
                accel = (rng.randint(-40, 40), rng.randint(-40, 40), 16384 + rng.randint(-40, 40))
                gyro = (0, round(velocity * 16.4), 0)
                self.on_frame(role, pack_frame(accel, gyro, tuple(euler)), PacketOrigin.SYNTHETIC)
            deadline += pace
            await asyncio.sleep(max(0.0, deadline - time.monotonic()))

    @staticmethod
    def _sim_excursion(elapsed: float, p: dict[str, Any], profile: Any) -> float:
        stillness = profile.rep_pattern == "stillness_delimited"
        lead, gap = 4.0, (2.4 if stillness else 0.6)
        into = elapsed - lead
        if into < 0:
            return 0.0
        cycle = p["period"] + gap
        index, within = divmod(into, cycle)
        if index >= p["reps"] or within > p["period"]:
            return 0.0
        u = within / p["period"]
        shape = math.sin(2 * math.pi * u) ** 2 if stillness else (1 - math.cos(2 * math.pi * u)) / 2
        return p["amplitude"] * shape

    async def _replay_loop(self, events: list[dict[str, Any]], speed: float, loop: bool) -> None:
        rows = []
        for event in events:
            stamp = datetime.fromisoformat(str(event["timestamp_gateway"]).replace("Z", "+00:00"))
            frame = pack_frame(
                (event["ax"], event["ay"], event["az"]),
                (event["gx"], event["gy"], event["gz"]),
                tuple(event["orientation_euler_degrees"]),
            )
            rows.append((stamp.timestamp(), event["sensor_role"], frame))
        rows.sort(key=lambda row: row[0])
        speed = max(0.1, speed)
        while True:
            started = time.monotonic()
            origin = rows[0][0]
            # Packets keep the capture's own time base, so `speed` changes only the pacing
            # and never the movement that rep detection sees.
            virtual_zero = datetime.now(UTC)
            for stamp, role, frame in rows:
                delay = (stamp - origin) / speed - (time.monotonic() - started)
                if delay > 0:
                    await asyncio.sleep(delay)
                moment = virtual_zero + timedelta(seconds=stamp - origin)
                self.on_frame(role, frame, PacketOrigin.SYNTHETIC, moment)
            if not loop:
                self.say("replay finished")
                with self.lock:
                    self.source = {**self.source, "finished": True}
                return
            self.reset()

    # ------------------------------------------------- capture_wt901ble68.py

    def release_ble(self) -> None:
        """Drop our own sensor connections and wait: a sensor accepts one BLE central."""
        asyncio.run_coroutine_threadsafe(self._stop_source(), self._loop).result(timeout=20)

    def start_capture(self, o: dict[str, Any]) -> dict[str, Any]:
        """Run `capture_wt901ble68.py` with the given sensors and mirror its file live."""
        with self.lock:
            if self.job is not None and self.job.running:
                raise ValueError("a capture is already running")
            if self.recording is not None:
                raise ValueError("stop the simulator recording first")
        stem = str(o.get("name") or "").strip()
        if not SAFE_NAME.match(stem):
            raise ValueError("capture name: letters, digits, . _ - only")
        exercise_id = str(o.get("exercise_id") or self.exercise_id)
        if exercise_id not in SIGNAL_PROFILES:
            raise ValueError(f"unknown exercise {exercise_id!r}")
        addresses = {role: str(o.get(role) or "").strip() for role in ROLES}
        if not all(addresses.values()):
            raise ValueError("the capture script needs an address for thigh, shank and foot")
        if len(set(addresses.values())) != 3:
            raise ValueError("the same address is assigned to two roles")
        seconds = float(o.get("seconds") or 25)
        if seconds <= 0:
            raise ValueError("seconds must be positive")
        expected = int(o["expected"]) if o.get("expected") not in (None, "") else None
        prescribed = int(o["prescribed"]) if o.get("prescribed") not in (None, "") else None
        path = self.capture_dir / f"{stem}.jsonl"
        if path.exists():
            raise ValueError(f"{path.name} already exists (the script refuses to overwrite)")

        command = [
            sys.executable,
            str(analysis.TOOLS_DIR / "capture_wt901ble68.py"),
            "--seconds",
            f"{seconds:g}",
            "--output",
            str(path),
            *[arg for role in ROLES for arg in ("--sensor", f"{role}={addresses[role]}")],
            "--exercise",
            exercise_id,
        ]
        if expected is not None:
            command += ["--expected", str(expected)]

        self.release_ble()
        self.reset()
        job = Job(
            f"capture {path.name}",
            command,
            analysis.REPO_ROOT,
            on_done=lambda finished: self._capture_done(finished, path, exercise_id, prescribed),
        )
        with self.lock:
            self.job = job
            self.capture = {
                "file": path.name,
                "exercise_id": exercise_id,
                "expected": expected,
                "seconds": seconds,
                "result": None,
            }
        job.start()
        self._submit(
            self._start_task(
                "capture",
                f"capture_wt901ble68.py -> {path.name}",
                self._tail_loop(path, addresses, lambda: job.running),
                status="recording",
            )
        )
        self.say(f"started capture_wt901ble68.py -> {path.name}")
        return {"file": path.name, "command": " ".join(command)}

    def stop_capture(self) -> None:
        with self.lock:
            job = self.job
        if job is None or not job.running:
            raise ValueError("no capture is running")
        job.stop()
        self.say("capture stopped early; partial file kept")

    def _capture_done(self, job: Job, path: Path, exercise_id: str, prescribed: int | None) -> None:
        """Runs in the job thread once the capture script exits: score it with the script."""
        verdict = next(
            (
                ln
                for tag in ("[RESULT]", "[SYNC]")
                for ln in reversed(job.lines)
                if ln.startswith(tag)
            ),
            None,
        )
        score: dict[str, Any] | None = None
        if path.exists() and path.stat().st_size > 0:
            score = analysis.run_script("score", analysis.score_args(path, exercise_id, prescribed))
        with self.lock:
            if self.capture is not None and self.capture["file"] == path.name:
                self.capture["result"] = {
                    "exit_code": job.exit_code,
                    "stopped": job.stopped,
                    "verdict": verdict,
                    "score": score,
                    "file_exists": path.exists(),
                }
        self.say(verdict or "capture script ended")

    async def _tail_loop(self, path: Path, addresses: dict[str, str], alive: Any) -> None:
        """Feed the growing capture file into the hub so the Live tab follows the script."""
        for _ in range(600):  # up to ~60 s for the script to connect and open the file
            if path.exists() or not alive():
                break
            await asyncio.sleep(0.1)
        if not path.exists():
            return
        with self.lock:
            for role, address in addresses.items():
                self.sensors[role].address = address
        pending = ""
        idle = 0
        with path.open(encoding="utf-8") as stream:
            while True:
                chunk = stream.read()
                if chunk:
                    idle = 0
                    pending += chunk
                    *lines, pending = pending.split("\n")
                    for line in lines:
                        self._replay_record(line)
                    await asyncio.sleep(0.05)
                    continue
                if not alive():
                    idle += 1
                    if idle > 5:
                        break
                await asyncio.sleep(0.1)
        with self.lock:
            self.source = {**self.source, "finished": True}
            for state in self.sensors.values():
                state.status = "idle"

    def _replay_record(self, line: str) -> None:
        try:
            record = json.loads(line)
            role = str(record["sensor"]["role"])
            raw = bytes.fromhex(record["raw_frame_hex"])
            stamp = datetime.fromisoformat(record["gateway_timestamp"])
        except (ValueError, KeyError, TypeError):
            return
        if role in ROLES:
            self.on_frame(role, raw, PacketOrigin.HARDWARE, stamp)

    # ------------------------------------------------------------ recording

    def start_recording(self, options: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            if self.recording is not None:
                raise ValueError("already recording")
            if self.source["kind"] == "none":
                raise ValueError("no source: connect sensors or start the simulator first")
            synthetic = self.source["kind"] != "ble"
            stem = str(options.get("name") or "").strip()
            if not SAFE_NAME.match(stem):
                raise ValueError("capture name: letters, digits, . _ - only")
            if synthetic and not stem.startswith(("sim-", "replay-")):
                stem = f"{'sim' if self.source['kind'] == 'sim' else 'replay'}-{stem}"
            path = self.capture_dir / f"{stem}.jsonl"
            if path.exists():
                raise ValueError(f"{path.name} already exists")
            self.capture_dir.mkdir(parents=True, exist_ok=True)
            expected = options.get("expected")
            self.reset()
            self.recording = Recording(
                path=path,
                stream=path.open("x", encoding="utf-8"),
                exercise_id=str(options.get("exercise_id") or self.exercise_id),
                expected=int(expected) if expected not in (None, "") else None,
                range_label=str(options.get("range") or "good"),
                tempo_label=str(options.get("tempo") or "good"),
                subject=str(options.get("subject") or "unknown"),
                auto_label=bool(options.get("auto_label")),
                started=time.time(),
                synthetic=synthetic,
            )
            self.last_recording_result = None
        self.say(f"recording -> {path.name}")
        return {"file": path.name}

    def stop_recording(self) -> dict[str, Any]:
        with self.lock:
            recording, self.recording = self.recording, None
            if recording is None:
                raise ValueError("not recording")
            recording.stream.close()
        result = self._judge_recording(recording)
        with self.lock:
            self.last_recording_result = result
        self.say(f"recording stopped: {result['message']}")
        return result

    def _judge_recording(self, rec: Recording) -> dict[str, Any]:
        """The verdict `capture_wt901ble68.py` gives: dead sensors, then rep count vs expected."""
        result: dict[str, Any] = {
            "file": rec.path.name,
            "frames": dict(rec.counts),
            "seconds": round(time.time() - rec.started, 1),
            "synthetic": rec.synthetic,
        }
        dead = [role for role, count in rec.counts.items() if count == 0]
        if dead:
            return {**result, "ok": False, "message": f"FAILED - no frames from {', '.join(dead)}"}
        try:
            events, assessment = analysis.assess_capture(rec.path, rec.exercise_id)
        except Exception as error:  # profile/format problems must not lose the recording
            return {**result, "ok": False, "message": f"saved, but could not assess: {error}"}
        if assessment.status == "blocked" or assessment.rep_report is None:
            return {**result, "ok": False, "message": f"could not score: {assessment.reason}"}
        count = assessment.rep_report.count
        result["reps"] = count
        if count == 0:
            return {
                **result,
                "ok": False,
                "message": "0 reps detected - check placement, re-record",
            }
        if rec.expected is not None and count != rec.expected:
            return {
                **result,
                "ok": False,
                "message": f"MISMATCH - detected {count} reps, expected {rec.expected}",
            }
        message = f"SUCCESS - {count} reps detected"
        if rec.auto_label:
            outcome = analysis.labels_create(
                self.capture_dir,
                rec.path.name,
                exercise_id=rec.exercise_id,
                range_label=rec.range_label,
                tempo_label=rec.tempo_label,
                subject=rec.subject,
                expected=rec.expected,
                force=False,
            )
            message += (
                f"; labels written to {outcome['file']}"
                if outcome["ok"]
                else f"; {outcome['error']}"
            )
        return {**result, "ok": True, "message": message}

    # -------------------------------------------------------------- analysis

    def _analysis_loop(self) -> None:
        seen = -1
        interval = ANALYSIS_MIN_INTERVAL
        while True:
            time.sleep(interval)
            with self.lock:
                if self.version == seen or not self.buffer:
                    interval = ANALYSIS_MIN_INTERVAL
                    continue
                seen = self.version
                events = list(self.buffer)
                prescribed = self.prescribed
                profile_error = None
                try:
                    profile = self.profile()
                except ValueError as error:
                    profile, profile_error = None, str(error)
            began = time.monotonic()
            result: dict[str, Any]
            if profile is None:
                result = {"status": "error", "reason": profile_error}
            else:
                try:
                    result = analysis.analyze_events(events, profile, prescribed_reps=prescribed)
                except Exception as error:  # keep the loop alive; show the failure in the UI
                    result = {"status": "error", "reason": f"{type(error).__name__}: {error}"}
            quality, health = self._technical_checks(events)
            with self.lock:
                self.analysis, self.quality, self.health = result, quality, health
            interval = max(ANALYSIS_MIN_INTERVAL, 2.5 * (time.monotonic() - began))

    @staticmethod
    def _technical_checks(events: list[dict[str, Any]]) -> tuple[dict | None, dict | None]:
        cutoff = events[-1]["t"] - QUALITY_WINDOW_SECONDS
        recent = [event for event in events if event["t"] >= cutoff]
        quality = None
        health = None
        try:
            quality = evaluate_signal_quality(recent).as_dict()
        except Exception as error:  # noqa: BLE001 - shown in the UI instead
            quality = {"level": "ERROR", "reasons": [str(error)], "scoring_permitted": False}
        stalled = []
        newest = events[-1]["t"]
        for role in ROLES:
            last = max((e["t"] for e in recent if e["sensor_role"] == role), default=None)
            if last is not None and newest - last > STALL_SECONDS:
                stalled.append(
                    {
                        "level": "FAIL",
                        "role": role,
                        "code": "stalled",
                        "message": f"no frames for {newest - last:.1f} s - link dropped or off",
                    }
                )
        by_role: dict[str, list[Sample]] = {}
        for event in recent:
            by_role.setdefault(event["sensor_role"], []).append(
                Sample(
                    t=event["t"],
                    seq=event["seq"],
                    accel=(event["ax"], event["ay"], event["az"]),
                    gyro=(event["gx"], event["gy"], event["gz"]),
                    euler=tuple(event["orientation_euler_degrees"]),  # type: ignore[arg-type]
                    raw_hex=event["raw_hex"],
                )
            )
        try:
            report = analyze_health(by_role)
            health = analysis.health_dict(report)
            health["findings"] = stalled + [
                f for f in health["findings"] if f["code"] not in LIVE_HIDDEN_FINDINGS
            ]
            if stalled:
                health["verdict"] = "FAIL"
        except Exception as error:  # noqa: BLE001 - shown in the UI instead
            health = {"verdict": "ERROR", "findings": [{"level": "FAIL", "role": None,
                      "code": "health_error", "message": str(error)}], "sensors": {}}  # fmt: skip
        return quality, health

    # -------------------------------------------------------------- snapshot

    def _capture_snapshot(self) -> dict[str, Any] | None:
        if self.job is None or self.capture is None:
            return None
        info = self.job.snapshot()
        reps = [
            int(line.split()[1])
            for line in info["lines"]
            if line.startswith("[REP]") and len(line.split()) > 1 and line.split()[1].isdigit()
        ]
        return {**self.capture, "job": info, "script_reps": max(reps, default=0)}

    def snapshot(self) -> dict[str, Any]:
        now = time.monotonic()
        with self.lock:
            recording = None
            if self.recording is not None:
                rec = self.recording
                recording = {
                    "file": rec.path.name,
                    "seconds": round(time.time() - rec.started, 1),
                    "counts": dict(rec.counts),
                    "expected": rec.expected,
                }
            return analysis.clean(
                {
                    "wall": time.time(),
                    "source": self.source,
                    "exercise": {
                        "id": self.exercise_id,
                        "prescribed": self.prescribed,
                        "overrides": self.overrides,
                    },
                    "sensors": {role: s.snapshot(now) for role, s in self.sensors.items()},
                    "buffer_events": len(self.buffer),
                    "take_seconds": round(time.time() - self.take_started, 1),
                    "analysis": self.analysis,
                    "quality": self.quality,
                    "health": self.health,
                    "recording": recording,
                    "recording_result": self.last_recording_result,
                    "capture": self._capture_snapshot(),
                    "scan": self.scan_state,
                    "sim": self.sim,
                    "log": [[t, m] for t, m in list(self.log)[-40:]],
                }
            )


def dump_json(payload: Any) -> bytes:
    return json.dumps(analysis.clean(payload), separators=(",", ":")).encode("utf-8")
