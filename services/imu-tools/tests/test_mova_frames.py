"""The mova `session_frames` adapter: the four rules, and a real recount.

The point of the whole port is the last test here -- that mova's own stored
frames, run through the vendored analysis, produce the rep count mova's live
counter produced. Everything above it protects that from being a coincidence.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

import _fixtures as fx

from mova_imu.analysis.attempt_assessment import assess_attempt
from mova_imu.analysis.exercise_signals import profile_for
from mova_imu.analysis.preprocessing import preprocess_transport_events
from mova_imu.sources.mova_frames import (
    MovaFramesError,
    RpcShapeRefused,
    load_session_frames,
)


class MissingOrientation(unittest.TestCase):
    """Rule 1: a row with no usable euler_deg is dropped and counted."""

    def test_row_without_euler_is_dropped_not_zero_filled(self):
        rows, _ = fx.heel_slide_rows(reps=2)
        kept = len(rows)
        # the browser attaches its signal-quality report to about one row a
        # second, and a short WT901 frame lands the same way
        rows.insert(10, fx.frame_row("thigh", datetime(2026, 9, 20, 10, 0, 1, tzinfo=UTC), 999, None))
        rows.insert(20, fx.frame_row("shank", datetime(2026, 9, 20, 10, 0, 2, tzinfo=UTC), 998, None))

        session = load_session_frames(fx.export(rows))

        self.assertEqual(session.drops.total, kept + 2)
        self.assertEqual(session.drops.kept, kept)
        self.assertEqual(session.drops.dropped, 2)
        self.assertEqual(session.drops.reasons.get("missing_euler_deg"), 2)
        self.assertIn("2 dropped", session.drops.summary())
        # and nothing was invented in their place
        self.assertTrue(all(len(e["orientation_euler_degrees"]) == 3 for e in session.events))

    def test_malformed_euler_is_also_dropped(self):
        rows, _ = fx.heel_slide_rows(reps=1)
        bad = fx.frame_row("foot", datetime(2026, 9, 20, 10, 0, 1, tzinfo=UTC), 1, (0.0, 0.0, 0.0))
        bad["imu"]["euler_deg"] = [1.0, 2.0]          # two components, not three
        rows.append(bad)
        session = load_session_frames(fx.export(rows))
        self.assertEqual(session.drops.reasons.get("missing_euler_deg"), 1)


class SimulatedFlag(unittest.TestCase):
    """Rule 2: `origin: simulated` reaches every tool."""

    def test_one_simulated_row_marks_the_session(self):
        rows, _ = fx.heel_slide_rows(reps=2, simulated=False)
        rows[5]["imu"]["origin"] = "simulated"
        session = load_session_frames(fx.export(rows, simulated=False))
        self.assertTrue(session.simulated)
        self.assertIn("SIMULATED SENSORS", session.marker)

    def test_real_session_says_so(self):
        rows, _ = fx.heel_slide_rows(reps=2, simulated=False)
        session = load_session_frames(fx.export(rows, simulated=False))
        self.assertFalse(session.simulated)
        self.assertIn("real sensors", session.marker)

    def test_device_info_transport_also_marks_it(self):
        rows, _ = fx.heel_slide_rows(reps=2, simulated=False)
        session = load_session_frames(fx.export(rows, simulated=True))
        self.assertTrue(session.simulated)


class MissingRoles(unittest.TestCase):
    """Rule 3: a missing sensor stream raises, by name."""

    def test_two_role_export_raises_naming_the_missing_role(self):
        rows, _ = fx.heel_slide_rows(reps=2)
        rows = [r for r in rows if r["imu"]["role"] != "foot"]
        with self.assertRaises(MovaFramesError) as caught:
            load_session_frames(fx.export(rows))
        message = str(caught.exception)
        self.assertIn("foot", message)
        self.assertIn("not filled in", message)

    def test_opt_out_is_available_but_explicit(self):
        rows, _ = fx.heel_slide_rows(reps=2)
        rows = [r for r in rows if r["imu"]["role"] != "foot"]
        session = load_session_frames(fx.export(rows), require_all_roles=False)
        self.assertEqual(session.roles, ("thigh", "shank"))


class BrowserSignalQuality(unittest.TestCase):
    """Rule 4: the browser's verdict sits beside the recomputed one, not inside it."""

    def test_reports_are_collected_separately(self):
        rows, _ = fx.heel_slide_rows(reps=2)
        rows[3]["imu"]["signal_quality"] = {"level": "HIGH", "scoring_permitted": True}
        rows[9]["imu"]["signal_quality"] = {"level": "LOW", "scoring_permitted": False}
        session = load_session_frames(fx.export(rows))
        self.assertEqual(len(session.browser_signal_quality), 2)
        self.assertEqual(
            [r["level"] for r in session.browser_signal_quality], ["HIGH", "LOW"]
        )
        # and they did not become events
        self.assertTrue(all("level" not in e for e in session.events))


class RpcShape(unittest.TestCase):
    """The clinician RPC payload is refused by name, not zero-padded."""

    def test_clinician_session_result_is_refused(self):
        payload = {
            "session": {"id": "s1"},
            "exercise": {"slug": "heel-slide"},
            "frames": {
                "thigh": [[0, 1.5], [50, 1.6]],
                "shank": [[0, 2.5], [50, 9.9]],
                "foot_count": 0,
            },
            "frame_counts": {"thigh": 2, "shank": 2, "foot": 0},
        }
        with self.assertRaises(RpcShapeRefused) as caught:
            load_session_frames(payload)
        message = str(caught.exception)
        self.assertIn("clinician_session_result", message)
        self.assertIn("session_frames", message)


class FileFormats(unittest.TestCase):
    def test_json_array_jsonl_and_export_object_all_load(self):
        rows, _ = fx.heel_slide_rows(reps=2)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "a.json").write_text(json.dumps(rows), encoding="utf-8")
            (root / "b.jsonl").write_text(
                "\n".join(json.dumps(r) for r in rows), encoding="utf-8"
            )
            (root / "c.json").write_text(json.dumps(fx.export(rows)), encoding="utf-8")
            counts = [
                len(load_session_frames(root / name).events)
                for name in ("a.json", "b.jsonl", "c.json")
            ]
        self.assertEqual(counts[0], counts[1])
        self.assertEqual(counts[1], counts[2])

    def test_export_object_carries_session_metadata(self):
        rows, _ = fx.heel_slide_rows(reps=2)
        session = load_session_frames(fx.export(rows, session_id="abc", slug="heel-slide"))
        self.assertEqual(session.session_id, "abc")
        self.assertEqual(session.exercise_slug, "heel-slide")


class EndToEndRecount(unittest.TestCase):
    """mova's stored frames -> the vendored analysis -> the right rep count."""

    def test_stored_frames_survive_preprocessing(self):
        """The nine channels and three roles preprocessing insists on are all there."""
        rows, _ = fx.heel_slide_rows(reps=6)
        session = load_session_frames(fx.export(rows))
        result = preprocess_transport_events(
            session.events, signal_quality={"scoring_permitted": True}
        )
        self.assertTrue(result.allowed, f"preprocessing refused: {result.reasons}")
        self.assertGreater(len(result.frames), 0)
        # every resampled frame carries all three roles
        self.assertTrue(all(set(f["sensors"]) == set(fx.ROLES) for f in result.frames))

    def test_six_recorded_reps_are_recounted_as_six(self):
        rows, _ = fx.heel_slide_rows(reps=6, peak_deg=70.0)
        session = load_session_frames(fx.export(rows))
        profile = profile_for("exercise-heel-slide-v1")
        self.assertIsNotNone(profile, "the heel-slide profile must exist")

        assessment = assess_attempt(
            session.events, profile, signal_quality={"scoring_permitted": True}
        )

        self.assertEqual(assessment.status, "assessed", assessment.reason)
        self.assertEqual(
            len(assessment.rep_features), 6,
            f"expected 6 reps, got {len(assessment.rep_features)}",
        )
        # every rep clears this exercise's minimum valid excursion
        for rep in assessment.rep_features:
            peak = rep.get("peak_from_rest_deg")
            self.assertIsNotNone(peak)
            self.assertGreaterEqual(peak, profile.enter_deg)

    def test_a_still_recording_yields_no_reps(self):
        """A take with no movement must count zero, not pick up noise."""
        begin = datetime(2026, 9, 20, 10, 0, 0, tzinfo=UTC)
        rows = [
            fx.frame_row(role, begin + timedelta(seconds=i / fx.RATE_HZ), i, (0.0, 0.0, 0.0))
            for i in range(200)
            for role in fx.ROLES
        ]
        session = load_session_frames(fx.export(rows))
        assessment = assess_attempt(
            session.events,
            profile_for("exercise-heel-slide-v1"),
            signal_quality={"scoring_permitted": True},
        )
        self.assertEqual(len(assessment.rep_features), 0)


if __name__ == "__main__":
    unittest.main()
