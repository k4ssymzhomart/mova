"""Event normalisation, multi-start splitting, exercise ids, and abstention.

These are the mova-authored seams. The vendored analysis is covered by its own
tests upstream; what has to be pinned here is everything this port invented.
"""

from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

import _fixtures as fx

from mova_imu.analysis.attempt_assessment import assess_attempt
from mova_imu.analysis.execution_score import assess_execution
from mova_imu.analysis.exercise_signals import SIGNAL_PROFILES, profile_for
from mova_imu.analysis.rep_quality import assess_reps, load_models
from mova_imu.exercises import ids
from mova_imu.sources.capture_jsonl import REQUIRED_FIELDS, capture_record, write_capture
from mova_imu.sources.events import normalise, normalise_rows
from mova_imu.sources.mova_frames import load_session_frames, split_by_starts

OPEN_GATE = {"scoring_permitted": True}


# ---------------------------------------------------------------- events


class Normalise(unittest.TestCase):
    """All three input shapes reach the same canonical event."""

    GATEWAY = {
        "sensor_role": "thigh", "timestamp_gateway": "2026-09-20T10:00:00Z",
        "ax": 1, "ay": 2, "az": 3, "gx": 4, "gy": 5, "gz": 6,
        "orientation_euler_degrees": [1.5, 2.5, 3.5],
    }
    CAPTURE = {
        "sensor": {"role": "thigh"}, "gateway_timestamp": "2026-09-20T10:00:00Z",
        "accelerometer_raw": [1, 2, 3], "gyroscope_raw": [4, 5, 6],
        "euler_degrees": [1.5, 2.5, 3.5],
    }
    MOVA = {
        "recorded_at": "2026-09-20T10:00:00Z", "seq": 0,
        "imu": {"role": "thigh", "ax": 1, "ay": 2, "az": 3, "gx": 4, "gy": 5, "gz": 6,
                "euler_deg": [1.5, 2.5, 3.5]},
    }

    def test_the_three_shapes_agree(self):
        events = [normalise(row) for row in (self.GATEWAY, self.CAPTURE, self.MOVA)]
        self.assertTrue(all(e is not None for e in events))
        self.assertEqual(events[0], events[1])
        self.assertEqual(events[1], events[2])

    def test_unknown_shape_returns_none_not_a_partial_event(self):
        for row in ({}, {"foo": "bar"}, {"imu": "not a mapping"}, {"sensor": {}}):
            self.assertIsNone(normalise(row), row)

    def test_unknown_role_is_refused(self):
        row = dict(self.MOVA)
        row["imu"] = dict(row["imu"], role="elbow")
        self.assertIsNone(normalise(row))

    def test_drop_report_counts_and_names_reasons(self):
        rows = [self.MOVA, {"nonsense": 1}, dict(self.MOVA, imu={"role": "thigh"})]
        events, report = normalise_rows(rows)
        self.assertEqual(len(events), 1)
        self.assertEqual(report.total, 3)
        self.assertEqual(report.kept, 1)
        self.assertEqual(report.reasons.get("unknown_shape"), 1)
        self.assertEqual(report.reasons.get("missing_euler_deg"), 1)


# ------------------------------------------------------------ multi-start


class MultiStart(unittest.TestCase):
    """One mova session can hold several starts; each is its own attempt."""

    def _two_start_session(self):
        first, begin = fx.heel_slide_rows(reps=3, simulated=True)
        gap = begin + timedelta(seconds=40)
        second, _ = fx.heel_slide_rows(reps=4, start=gap, simulated=True, seq_from=10_000)
        rows = first + second
        windows = [
            {"start": fx.epoch_ms(begin), "end": fx.epoch_ms(begin) + 500},
            {"start": fx.epoch_ms(gap), "end": fx.epoch_ms(gap) + 500},
        ]
        return load_session_frames(fx.export(rows, baseline_windows=windows))

    def test_two_starts_split_into_two_attempts(self):
        session = self._two_start_session()
        self.assertEqual(len(session.baseline_windows), 2)
        attempts = split_by_starts(session)
        counted = [a for a in attempts if a.index > 0]
        self.assertEqual(len(counted), 2)
        self.assertEqual([a.label for a in counted], ["start1", "start2"])
        self.assertTrue(all(a.events for a in counted))

    def test_each_attempt_is_counted_on_its_own(self):
        """3 reps then 4 reps must read as 3 and 4, not as one run of 7."""
        session = self._two_start_session()
        counted = [a for a in split_by_starts(session) if a.index > 0]
        profile = profile_for("exercise-heel-slide-v1")
        found = [
            len(assess_attempt(a.events, profile, signal_quality=OPEN_GATE).rep_features)
            for a in counted
        ]
        self.assertEqual(found, [3, 4])

    def test_frames_before_the_first_start_are_kept_apart(self):
        first, begin = fx.heel_slide_rows(reps=2)
        windows = [{"start": fx.epoch_ms(begin) + 5_000, "end": fx.epoch_ms(begin) + 5_500}]
        session = load_session_frames(fx.export(first, baseline_windows=windows))
        attempts = split_by_starts(session)
        pre = [a for a in attempts if a.index == 0]
        self.assertEqual(len(pre), 1)
        self.assertTrue(pre[0].events, "warm-up frames should be kept, just not counted")
        self.assertEqual(pre[0].label, "pre-start")

    def test_a_session_with_no_windows_is_one_attempt(self):
        rows, _ = fx.heel_slide_rows(reps=3)
        session = load_session_frames(fx.export(rows))
        attempts = split_by_starts(session)
        self.assertEqual(len(attempts), 1)
        self.assertEqual(attempts[0].index, 1)


# -------------------------------------------------------------- capture io


class CaptureRoundTrip(unittest.TestCase):
    def test_record_carries_every_field_load_capture_reads(self):
        rows, _ = fx.heel_slide_rows(reps=1)
        session = load_session_frames(fx.export(rows))
        record = capture_record(session.events[0], 0, simulated=True)
        for field in REQUIRED_FIELDS:
            self.assertIn(field, record)
        self.assertEqual(record["sensor"]["role"], session.events[0]["sensor_role"])
        self.assertEqual(record["origin"], "simulated")
        self.assertEqual(record["validation_status"], "unverified_checksum")

    def test_no_raw_frame_hex_is_fabricated(self):
        """mova does not store the 20 raw bytes, so the field must be absent."""
        rows, _ = fx.heel_slide_rows(reps=1)
        session = load_session_frames(fx.export(rows))
        self.assertNotIn("raw_frame_hex", capture_record(session.events[0], 0))

    def test_written_capture_is_read_back_by_the_gateway_loader(self):
        import tempfile
        from pathlib import Path

        from mova_imu.gateway.diagnostics import load_capture

        rows, _ = fx.heel_slide_rows(reps=3)
        session = load_session_frames(fx.export(rows))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "take.jsonl"
            written = write_capture(path, session.events, simulated=True)
            by_role, bad = load_capture(path)
        self.assertEqual(written, len(session.events))
        self.assertEqual(bad, 0, "the gateway loader rejected a converted record")
        self.assertEqual(set(by_role), set(fx.ROLES))


# -------------------------------------------------------------------- ids


class ExerciseIds(unittest.TestCase):
    def test_table_and_unmapped_list_partition_the_signal_profiles(self):
        mapped = {r.phoenix for r in ids.all_rows() if r.phoenix}
        unmapped = set(ids.phoenix_unmapped())
        self.assertEqual(
            mapped | unmapped, set(SIGNAL_PROFILES),
            "a Phoenix signal profile is neither mapped to a mova exercise nor "
            "listed as deliberately unmapped in exercise_ids.json",
        )
        self.assertFalse(mapped & unmapped, "an id is both mapped and unmapped")

    def test_round_trips_across_all_three_spaces(self):
        for row in ids.all_rows():
            self.assertEqual(ids.catalog_slug(row.catalog), row.catalog)
            if row.scoring:
                self.assertEqual(ids.catalog_slug(row.scoring), row.catalog)
                self.assertEqual(ids.scoring_slug(row.catalog), row.scoring)
            if row.phoenix:
                self.assertEqual(ids.catalog_slug(row.phoenix), row.catalog)
                self.assertEqual(ids.phoenix_id(row.catalog), row.phoenix)

    def test_lookup_raises_rather_than_guessing(self):
        # `heel_slide` and `heel-slide` differ by one character and are two
        # different ids in this repo. Nothing here may derive one from the other.
        with self.assertRaises(ids.UnknownExercise):
            ids.resolve("heel slide")
        with self.assertRaises(ids.UnknownExercise):
            ids.resolve("exercise-heel-slide")

    def test_exercise_without_a_profile_raises_on_phoenix_lookup(self):
        with self.assertRaises(ids.UnknownExercise):
            ids.phoenix_id("quad-set")

    def test_every_mapped_phoenix_id_really_has_a_profile(self):
        for row in ids.all_rows():
            if row.phoenix:
                self.assertIsNotNone(
                    profile_for(row.phoenix), f"{row.catalog} maps to a missing profile"
                )


# ------------------------------------------------------------- abstention


class NoReferenceSet(unittest.TestCase):
    """Shipping without a KNN reference must abstain, never raise or guess."""

    def test_no_reference_ships(self):
        self.assertIsNone(load_models("exercise-heel-slide-v1"))

    def test_assess_reps_abstains_cleanly(self):
        rows, _ = fx.heel_slide_rows(reps=3)
        session = load_session_frames(fx.export(rows))
        assessment = assess_attempt(
            session.events, profile_for("exercise-heel-slide-v1"), signal_quality=OPEN_GATE
        )
        result = assess_reps(assessment.rep_features, "exercise-heel-slide-v1")
        self.assertEqual(result.get("status"), "abstained", result)
        self.assertIn("reference", str(result.get("reason")))


class ExecutionScore(unittest.TestCase):
    def test_a_real_take_scores(self):
        rows, _ = fx.heel_slide_rows(reps=6)
        session = load_session_frames(fx.export(rows))
        assessment = assess_attempt(
            session.events, profile_for("exercise-heel-slide-v1"), signal_quality=OPEN_GATE
        )
        result = assess_execution(
            list(assessment.rep_features), "exercise-heel-slide-v1", prescribed_reps=6
        )
        self.assertEqual(result["status"], "scored")
        self.assertIsNotNone(result["execution_score"])
        self.assertGreaterEqual(result["execution_score"], 0)
        self.assertLessEqual(result["execution_score"], 100)

    def test_an_unknown_exercise_abstains_instead_of_returning_a_number(self):
        result = assess_execution([{"peak_from_rest_deg": 50.0}], "not-an-exercise",
                                  prescribed_reps=10)
        self.assertEqual(result["status"], "abstained")
        self.assertNotIn("execution_score", result)

    def test_uncalibrated_submetrics_are_left_out_not_scored_zero(self):
        """Heel slide has no calibrated smoothness target, so it must not count."""
        rows, _ = fx.heel_slide_rows(reps=4)
        session = load_session_frames(fx.export(rows))
        assessment = assess_attempt(
            session.events, profile_for("exercise-heel-slide-v1"), signal_quality=OPEN_GATE
        )
        result = assess_execution(
            list(assessment.rep_features), "exercise-heel-slide-v1", prescribed_reps=4
        )
        for rep in result["reps"]:
            self.assertNotIn(
                "smoothness", rep["correctness"]["metrics"],
                "an uncalibrated sub-metric was scored instead of abstaining",
            )


if __name__ == "__main__":
    unittest.main()
