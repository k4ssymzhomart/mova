"""Convert a mova ``session_frames`` export into capture JSONL.

This is the direction mova actually needs, and it replaces Phoenix's
``replay_capture_to_api.py`` (which pushed captures into Phoenix's compose
stack through API routes mova does not have -- see VENDORED.md).

Write one converted file and every other tool here works on real mova data
with no further changes: ``analyze_capture``, ``tune_reps``, ``label_reps``,
``check_execution_score``, ``check_rep_quality``,
``build_rep_quality_reference``, and the dev-tools Captures and Replay tabs.

Getting the export
------------------
Any read-only dump of the session's ``session_frames`` rows works -- the
Supabase SQL editor, a local ``supabase``, or a small script. JSON or JSONL,
either a bare array of rows or an object with them under ``frames`` and the
``sessions`` row beside them under ``session`` (that form also carries
``summary.baseline_windows_ms``, which is what lets this split by start).

    select recorded_at, seq, imu, quality
    from public.session_frames
    where session_id = '<id>'
    order by recorded_at, seq;

Multiple starts
---------------
One mova session can hold several presses of the start button, and the app
re-zeroes the angle on each one. Phoenix's whole-attempt assessment assumes a
single attempt, so **this splits per start by default** and writes one capture
each. Frames from before the first start go to ``*.pre-start.jsonl`` and are
never counted. ``--merge-starts`` writes one file for the whole session and
warns: that number will disagree with what the clinician view shows, because
the clinician view counts every start on its own zero.

Examples
--------
    py tools/frames_to_capture.py frames.json
    py tools/frames_to_capture.py frames.json --out captures/session-abc.jsonl
    py tools/frames_to_capture.py frames.json --merge-starts
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from mova_imu.sources.capture_jsonl import write_capture
from mova_imu.sources.mova_frames import (
    MovaFramesError,
    RpcShapeRefused,
    load_session_frames,
    split_by_starts,
)

DEFAULT_CAPTURE_DIR = Path(__file__).resolve().parents[1] / "captures"


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("export", help="session_frames export (JSON or JSONL)")
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help=f"output capture path; default: {DEFAULT_CAPTURE_DIR}/mova-<session>.jsonl",
    )
    parser.add_argument(
        "--merge-starts",
        action="store_true",
        help="one capture for the whole session instead of one per start (warns)",
    )
    parser.add_argument(
        "--allow-missing-roles",
        action="store_true",
        help="convert even if a sensor role has no frames; the analysis will refuse it",
    )
    args = parser.parse_args()

    try:
        session = load_session_frames(
            args.export, require_all_roles=not args.allow_missing_roles
        )
    except RpcShapeRefused as error:
        print(f"refused: {error}", file=sys.stderr)
        return 2
    except MovaFramesError as error:
        print(f"cannot read {args.export}: {error}", file=sys.stderr)
        return 2

    print(session.marker)
    if session.simulated:
        print("  NOTE: these frames came from the development simulation, "
              "not from sensors on a person.")
    if session.browser_signal_quality:
        levels = [r.get("level") for r in session.browser_signal_quality]
        print(f"  browser signal-quality reports: {len(levels)} "
              f"(levels seen: {', '.join(sorted({str(v) for v in levels}))})")
        print("  these are the browser's own verdicts, kept separate from "
              "analyze_capture's recomputed one.")

    stem = args.out.with_suffix("") if args.out else (
        DEFAULT_CAPTURE_DIR / f"mova-{session.session_id or 'session'}"
    )

    if args.merge_starts:
        if len(session.baseline_windows) > 1:
            print(f"  WARNING: {len(session.baseline_windows)} starts merged into one attempt. "
                  "The rep count from this file will disagree with the clinician view, "
                  "which counts each start on its own zero.")
        path = stem.with_suffix(".jsonl")
        written = write_capture(
            path, session.events,
            session_id=session.session_id or "mova-session", simulated=session.simulated,
        )
        print(f"  wrote {path}  ({written} records)")
        return 0

    attempts = split_by_starts(session)
    counted = [a for a in attempts if a.index > 0]
    for attempt in attempts:
        if not attempt.events:
            print(f"  {attempt.label}: no frames")
            continue
        suffix = ".pre-start.jsonl" if attempt.index == 0 else (
            ".jsonl" if len(counted) == 1 else f"-{attempt.label}.jsonl"
        )
        path = Path(str(stem) + suffix)
        written = write_capture(
            path, attempt.events,
            session_id=session.session_id or "mova-session", simulated=session.simulated,
        )
        note = "  (before the first start; never counted)" if attempt.index == 0 else ""
        print(f"  wrote {path}  ({written} records){note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
