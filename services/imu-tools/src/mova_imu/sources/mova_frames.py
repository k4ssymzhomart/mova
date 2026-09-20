"""Read a mova ``session_frames`` export as canonical transport events.

mova records a session in the browser: ``lib/ble/telemetryFrame.ts::toFrameRow``
wraps each BLE sample as a ``session_frames`` row and
``flush_session_telemetry_batch`` writes it. This module is the other end -- it
turns those rows back into the events the vendored analysis core reads, so a
real mova session can be recounted offline by the same code that counts it live.

Four rules, each with a test in ``tests/test_mova_frames.py``:

1. A row with no usable ``imu.euler_deg`` is dropped and counted, never
   zero-filled. A zero is indistinguishable from a sensor lying still.
2. ``imu.origin == "simulated"`` marks the whole session simulated, and every
   tool prints that. mova flags simulated sessions on four screens; a Python
   tool that quietly dropped the flag would be the weak link.
3. Fewer than three roles raises, naming the missing ones.
   ``preprocess_transport_events`` hard-requires thigh, shank and foot;
   synthesising the missing stream would turn "we did not record this" into a
   measurement.
4. ``imu.signal_quality`` -- the browser's own verdict -- is surfaced beside the
   recomputed one, never merged into it.

Multi-start is the thing that bites. One mova session can hold several
"Nachat" presses; ``lib/motion/flexion.ts`` re-zeroes on each and the summary
records every window in ``baseline_windows_ms``. Phoenix's ``assess_attempt``
assumes one attempt with one leading stay-still hold. So this module splits by
start, and merging is opt-in and warns.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from .events import ROLES, DropReport, normalise_rows

REQUIRED_ROLES = ("thigh", "shank", "foot")


class MovaFramesError(ValueError):
    """The export cannot be read as session_frames rows."""


class RpcShapeRefused(MovaFramesError):
    """The file is a ``clinician_session_result`` payload, not raw frames.

    That RPC returns only ``[[t_ms, pitch_deg], ...]`` for thigh and shank -- one
    Euler component, no roll, no yaw, no accelerometer, no gyroscope, and no foot
    at all (it reports ``foot_count`` and nothing else). Rep segmentation needs
    all three roles and ``evaluate_signal_quality`` needs raw gyro. Padding the
    gaps with zeros would produce something that looks like a measurement and is
    not one, so this shape is refused by name instead.
    """


@dataclass(slots=True)
class BaselineWindow:
    """One start's zero: ``start`` inclusive, ``end`` exclusive, epoch milliseconds."""

    start: float
    end: float


@dataclass(slots=True)
class MovaSession:
    events: list[dict[str, Any]]
    drops: DropReport
    simulated: bool = False
    session_id: str | None = None
    exercise_slug: str | None = None
    baseline_windows: list[BaselineWindow] = field(default_factory=list)
    #: The browser's own signal-quality reports, as recorded. Deliberately not
    #: merged with ``evaluate_signal_quality``'s verdict -- they are two opinions
    #: taken at different times, and averaging them would hide a disagreement.
    browser_signal_quality: list[dict[str, Any]] = field(default_factory=list)
    roles: tuple[str, ...] = ()

    @property
    def marker(self) -> str:
        """The one line every tool prints before it prints any number."""
        bits = [f"mova session {self.session_id or '(unknown)'}"]
        if self.exercise_slug:
            bits.append(self.exercise_slug)
        bits.append("SIMULATED SENSORS" if self.simulated else "real sensors")
        bits.append(self.drops.summary())
        if self.baseline_windows:
            bits.append(f"{len(self.baseline_windows)} start(s)")
        return " | ".join(bits)


def _epoch_ms(stamp: Any) -> float | None:
    if isinstance(stamp, int | float):
        return float(stamp)
    if not isinstance(stamp, str):
        return None
    try:
        return datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() * 1000.0
    except ValueError:
        return None


def _looks_like_rpc(payload: Any) -> bool:
    """Detect a ``clinician_session_result`` payload by its shape."""
    if not isinstance(payload, Mapping):
        return False
    if isinstance(payload.get("frame_counts"), Mapping):
        return True
    frames = payload.get("frames")
    if isinstance(frames, Mapping):
        if "foot_count" in frames:
            return True
        series = frames.get("thigh")
        if isinstance(series, list) and series and isinstance(series[0], list | tuple):
            return True
    return False


def _rows_and_meta(payload: Any) -> tuple[list[Any], Mapping[str, Any]]:
    """Accept a bare list of rows, or an export object wrapping them."""
    if isinstance(payload, list):
        return payload, {}
    if not isinstance(payload, Mapping):
        raise MovaFramesError(
            f"expected a list of rows or an export object, got {type(payload).__name__}"
        )
    if _looks_like_rpc(payload):
        raise RpcShapeRefused(
            "this is a clinician_session_result payload (pitch series only). "
            "Export the raw session_frames rows instead: they carry roll, yaw, "
            "accelerometer and gyroscope, which rep segmentation and signal "
            "quality both need."
        )
    for key in ("frames", "rows", "session_frames", "data"):
        value = payload.get(key)
        if isinstance(value, list):
            return value, payload
    raise MovaFramesError(
        "no frame rows found: expected a list, or an object with a "
        "'frames' / 'rows' / 'session_frames' / 'data' array"
    )


def _read_file(path: Path) -> Any:
    """Read JSON or JSON Lines; a file is whichever one parses."""
    text = path.read_text(encoding="utf-8")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    rows: list[Any] = []
    for number, line in enumerate(text.splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as error:
            raise MovaFramesError(f"{path.name} line {number}: {error}") from error
    if not rows:
        raise MovaFramesError(f"{path.name}: no JSON object or JSONL rows found")
    return rows


def load_session_frames(
    source: str | Path | Sequence[Mapping[str, Any]] | Mapping[str, Any],
    *,
    require_all_roles: bool = True,
) -> MovaSession:
    """A ``session_frames`` export -> a :class:`MovaSession`.

    ``source`` may be a path to JSON or JSONL, a list of rows, or an export
    object with the rows under ``frames`` / ``rows`` / ``session_frames`` /
    ``data`` and optionally the ``session`` row beside them.
    """
    payload = _read_file(Path(source)) if isinstance(source, str | Path) else source
    rows, meta = _rows_and_meta(payload)

    events, drops = normalise_rows(r for r in rows if isinstance(r, Mapping))

    simulated = False
    browser_quality: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        imu = row.get("imu")
        if not isinstance(imu, Mapping):
            continue
        if imu.get("origin") == "simulated":
            simulated = True                       # rule 2: one row is enough
        report = imu.get("signal_quality")
        if isinstance(report, Mapping):
            browser_quality.append(dict(report))   # rule 4: kept beside, not merged

    session = meta.get("session") if isinstance(meta.get("session"), Mapping) else meta
    summary = session.get("summary") if isinstance(session.get("summary"), Mapping) else {}
    device_info = session.get("device_info")
    if summary.get("simulated") is True or (
        isinstance(device_info, Mapping) and device_info.get("transport") == "simulated"
    ):
        simulated = True

    windows = [
        BaselineWindow(float(w["start"]), float(w["end"]))
        for w in (summary.get("baseline_windows_ms") or [])
        if isinstance(w, Mapping) and "start" in w and "end" in w
    ]

    present = tuple(role for role in ROLES if any(e["sensor_role"] == role for e in events))
    if require_all_roles:
        missing = [role for role in REQUIRED_ROLES if role not in present]
        if missing:                                # rule 3
            raise MovaFramesError(
                f"export has no frames for: {', '.join(missing)}. "
                f"Present: {', '.join(present) or 'none'}. The analysis needs all "
                "three roles; a missing stream is not filled in."
            )

    exercise = meta.get("exercise")
    slug = str(exercise["slug"]) if isinstance(exercise, Mapping) and exercise.get("slug") else None

    return MovaSession(
        events=events,
        drops=drops,
        simulated=simulated,
        session_id=str(session.get("id")) if session.get("id") else None,
        exercise_slug=slug,
        baseline_windows=windows,
        browser_signal_quality=browser_quality,
        roles=present,
    )


@dataclass(slots=True)
class Attempt:
    """One start, and the frames that followed it."""

    index: int            # 1-based; 0 is the pre-first-start remainder
    events: list[dict[str, Any]]
    window: BaselineWindow | None

    @property
    def label(self) -> str:
        return "pre-start" if self.index == 0 else f"start{self.index}"


def split_by_starts(session: MovaSession) -> list[Attempt]:
    """Split a session into one attempt per start, oldest first.

    Frames recorded before the first start go into ``index == 0`` and are never
    counted: that is whatever happened while the patient was getting ready. A
    session with no recorded windows is one attempt covering everything, which
    is also what a Phoenix capture looks like.
    """
    if not session.baseline_windows:
        return [Attempt(index=1, events=list(session.events), window=None)]

    starts = sorted(session.baseline_windows, key=lambda w: w.start)
    bounds = [w.start for w in starts] + [float("inf")]

    attempts = [Attempt(index=0, events=[], window=None)]
    attempts += [Attempt(index=i + 1, events=[], window=w) for i, w in enumerate(starts)]

    for event in session.events:
        moment = _epoch_ms(event["timestamp_gateway"])
        if moment is None or moment < bounds[0]:
            attempts[0].events.append(event)
            continue
        for slot in range(len(starts)):
            if bounds[slot] <= moment < bounds[slot + 1]:
                attempts[slot + 1].events.append(event)
                break

    return [a for a in attempts if a.events or a.index > 0]


def iter_rows(source: str | Path) -> Iterable[Mapping[str, Any]]:
    """The raw rows of an export, for callers that want them before normalisation."""
    rows, _ = _rows_and_meta(_read_file(Path(source)))
    return [r for r in rows if isinstance(r, Mapping)]
