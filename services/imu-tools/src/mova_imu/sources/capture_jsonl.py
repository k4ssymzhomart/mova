"""Read and write the capture JSONL shape.

A capture file is what ``tools/capture_wt901ble68.py`` writes and what
``gateway.diagnostics.load_capture`` reads. Writing that shape from somewhere
else is what lets a mova session be analysed by tools that only know about
capture files -- ``analyze_capture``, ``label_reps``, ``build_rep_quality_reference``
and the dev-tools Captures and Replay tabs.

``load_capture`` needs six fields per line: ``gateway_timestamp``,
``sequence_number``, ``sensor.role``, ``accelerometer_raw``, ``gyroscope_raw``
and ``euler_degrees``. The rest is provenance, and is written honestly:

- ``raw_frame_hex`` is **absent** for a mova-derived record. mova's
  ``toFrameRow`` keeps the decoded fields and drops the 20 raw bytes, so there
  is no frame to put there. Writing a fabricated one would defeat every check
  that exists to catch a mangled frame.
- ``origin`` is ``"simulated"`` when the session was, otherwise ``"hardware"``.
- ``validation_status`` stays ``"unverified_checksum"``: the WT901BLE68 frame
  shape carries no checksum field, so no record from this hardware may ever be
  presented as verified. mova writes the same value.
- ``source`` names this converter, so a capture that came out of the database is
  never mistaken for one recorded off the wire.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

CONVERTER = "mova_imu.sources.capture_jsonl"

#: What `diagnostics.load_capture` reads off every line.
REQUIRED_FIELDS = (
    "gateway_timestamp",
    "sequence_number",
    "sensor",
    "accelerometer_raw",
    "gyroscope_raw",
    "euler_degrees",
)


def capture_record(
    event: Mapping[str, Any],
    sequence_number: int,
    *,
    session_id: str = "mova-session",
    simulated: bool = False,
) -> dict[str, Any]:
    """One canonical transport event -> one capture JSONL record."""
    return {
        "session_id": session_id,
        "sensor": {"sensor_id": f"mova-{event['sensor_role']}", "role": event["sensor_role"]},
        "sequence_number": sequence_number,
        "gateway_timestamp": event["timestamp_gateway"],
        "accelerometer_raw": [event["ax"], event["ay"], event["az"]],
        "gyroscope_raw": [event["gx"], event["gy"], event["gz"]],
        "euler_degrees": list(event["orientation_euler_degrees"]),
        "origin": "simulated" if simulated else "hardware",
        "validation_status": "unverified_checksum",
        # No raw_frame_hex on purpose: mova does not store the 20 raw bytes.
        "source": CONVERTER,
    }


def write_capture(
    path: str | Path,
    events: Sequence[Mapping[str, Any]],
    *,
    session_id: str = "mova-session",
    simulated: bool = False,
) -> int:
    """Write events as a capture JSONL file. Returns the number of records written.

    Sequence numbers are per role and start at 0, matching what the capture
    script does, so the gap and out-of-order checks in ``diagnostics`` mean the
    same thing on a converted file as on a recorded one.
    """
    per_role: dict[str, int] = {}
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with target.open("w", encoding="utf-8", newline="\n") as stream:
        for event in events:
            role = str(event["sensor_role"])
            seq = per_role.get(role, 0)
            per_role[role] = seq + 1
            record = capture_record(
                event, seq, session_id=session_id, simulated=simulated
            )
            stream.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
            written += 1
    return written


def read_capture_rows(path: str | Path) -> Iterable[dict[str, Any]]:
    """Every JSON line of a capture file, unparsed beyond ``json.loads``."""
    with Path(path).open(encoding="utf-8") as stream:
        for line in stream:
            line = line.strip()
            if line:
                yield json.loads(line)
