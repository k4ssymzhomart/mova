# Vendored from Phoenix 1480ab0:services/imu-gateway/tests/test_diagnostics.py
# Adapted for mova: import paths only. Regression cover on the vendored gateway.
import json
import tempfile
import unittest
from pathlib import Path


from mova_imu.gateway.diagnostics import (
    FAIL,
    INFO,
    ROLES,
    WARN,
    Sample,
    analyze,
    identify_moving_sensor,
    load_capture,
    render_report,
    to_events,
)


def stream(
    *,
    rate: float = 20.0,
    seconds: float = 4.0,
    gyro: tuple[int, int, int] = (10, -5, 3),
    euler=lambda i: (float(i % 7), 2.0, 3.0),
    hex_of=lambda i: f"{i:040x}",
    accel: tuple[int, int, int] = (0, 0, 16384),
) -> list[Sample]:
    count = int(rate * seconds)
    return [Sample(i / rate, i + 1, accel, gyro, euler(i), hex_of(i)) for i in range(count)]


def rig(**overrides) -> dict[str, list[Sample]]:
    return {role: stream(**overrides) for role in ROLES}


def codes(report, level=None):
    return {f.code for f in report.findings if level is None or f.level == level}


class AnalyzeTests(unittest.TestCase):
    def test_healthy_rig_passes(self) -> None:
        report = analyze(rig())
        self.assertEqual(report.verdict, "PASS")
        self.assertAlmostEqual(report.sensors["thigh"].rate_hz, 20.0, places=1)

    def test_missing_role_fails(self) -> None:
        samples = rig()
        del samples["foot"]
        report = analyze(samples)
        self.assertEqual(report.verdict, FAIL)
        self.assertIn("missing_role", codes(report, FAIL))

    def test_low_rate_fails(self) -> None:
        report = analyze({**rig(), "shank": stream(rate=5.0, seconds=6.0)})
        self.assertIn("low_rate", codes(report, FAIL))

    def test_long_gap_fails_and_short_gap_warns(self) -> None:
        holes = [s for s in stream(seconds=6.0) if not 2.0 < s.t < 3.5]
        self.assertIn("prolonged_gap", codes(analyze({**rig(), "thigh": holes}), FAIL))
        short = [s for s in stream(seconds=6.0) if not 2.0 < s.t < 2.7]
        self.assertIn("gap", codes(analyze({**rig(), "thigh": short}), WARN))

    def test_frozen_stream_fails(self) -> None:
        frozen = stream(hex_of=lambda i: "ab" * 20)
        report = analyze({**rig(), "foot": frozen})
        self.assertIn("frozen_stream", codes(report, FAIL))
        self.assertEqual(report.sensors["foot"].longest_frozen_run, len(frozen))

    def test_frozen_detection_without_raw_hex_uses_values(self) -> None:
        frozen = stream(hex_of=lambda i: None, euler=lambda i: (1.0, 2.0, 3.0))
        self.assertIn("frozen_stream", codes(analyze({**rig(), "foot": frozen}), FAIL))

    def test_clipping_fails(self) -> None:
        clipped = stream(accel=(32767, 0, 0))
        self.assertIn("clipping", codes(analyze({**rig(), "thigh": clipped}), FAIL))

    def test_euler_wrap_is_not_a_glitch_but_a_jump_is(self) -> None:
        crossing = stream(euler=lambda i: (179.0 if i % 2 else -179.0, 0.0, 0.0))
        report = analyze({**rig(), "thigh": crossing})
        self.assertNotIn("euler_glitch", codes(report))
        self.assertAlmostEqual(report.sensors["thigh"].euler_peak_to_peak[0], 2.0, places=3)
        jumping = stream(euler=lambda i: (100.0 if i == 30 else 0.0, 0.0, 0.0))
        self.assertIn("euler_glitch", codes(analyze({**rig(), "thigh": jumping}), WARN))

    def test_expect_motion_flags_dead_sensor(self) -> None:
        flat = stream(euler=lambda i: (1.0, 2.0, 3.0), hex_of=lambda i: f"{i:040x}")
        samples = {**rig(), "shank": flat}
        self.assertNotIn("dead_sensor", codes(analyze(samples)))
        self.assertIn("dead_sensor", codes(analyze(samples, expect_motion=True), FAIL))

    def test_never_still_warns(self) -> None:
        shaking = stream(gyro=(5000, 0, 0))
        self.assertIn("no_static_window", codes(analyze({**rig(), "thigh": shaking}), WARN))

    def test_end_skew_is_informational_only(self) -> None:
        early = [s for s in stream(seconds=5.0) if s.t < 4.0]
        report = analyze({**rig(seconds=5.0), "foot": early})
        self.assertIn("sync_skew", codes(report, INFO))
        self.assertEqual(report.verdict, "PASS")

    def test_render_report_mentions_verdict_and_findings(self) -> None:
        text = render_report(analyze({**rig(), "foot": stream(hex_of=lambda i: "ab" * 20)}))
        self.assertIn("frozen_stream", text)
        self.assertIn("VERDICT: FAIL", text)


class IdentifyTests(unittest.TestCase):
    def test_picks_the_moved_sensor(self) -> None:
        moving = stream(gyro=(6000, 0, 0))
        role, energy = identify_moving_sensor(
            {"thigh": stream(), "shank": moving, "foot": stream()}
        )
        self.assertEqual(role, "shank")
        self.assertGreater(energy["shank"], energy["thigh"])

    def test_none_when_ambiguous_or_still(self) -> None:
        both = {"thigh": stream(gyro=(6000, 0, 0)), "shank": stream(gyro=(5000, 0, 0))}
        self.assertIsNone(identify_moving_sensor(both)[0])
        self.assertIsNone(identify_moving_sensor({"thigh": stream(gyro=(0, 0, 0))})[0])


class LoaderTests(unittest.TestCase):
    def test_load_capture_and_events_roundtrip(self) -> None:
        def stamp(i: int) -> str:
            return f"2026-01-01T00:00:{i // 20:02d}.{(i % 20) * 50000:06d}+00:00"

        def record(role: str, i: int) -> str:
            return json.dumps(
                {
                    "gateway_timestamp": stamp(i),
                    "sequence_number": i + 1,
                    "accelerometer_raw": [1, 2, 3],
                    "gyroscope_raw": [4, 5, 6],
                    "euler_degrees": [7.0, 8.0, 9.0],
                    "raw_frame_hex": f"{i:040x}",
                    "sensor": {"role": role},
                }
            )

        lines = [record(role, i) for i in range(40) for role in ROLES]
        lines.insert(3, "not json")
        lines.insert(5, json.dumps({"sensor": {"role": "thigh"}}))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "take.jsonl"
            path.write_text("\n".join(lines) + "\n", encoding="utf-8")
            samples, bad = load_capture(path)
        self.assertEqual(bad, 2)
        self.assertEqual(
            {role: len(rows) for role, rows in samples.items()}, dict.fromkeys(ROLES, 40)
        )
        self.assertAlmostEqual(samples["thigh"][20].t, 1.0)
        events = to_events(samples)
        self.assertEqual(len(events), 120)
        self.assertEqual({"sensor_role", "timestamp_gateway", "ax", "gz"} - set(events[0]), set())


if __name__ == "__main__":
    unittest.main()
