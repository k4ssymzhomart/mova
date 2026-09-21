# Vendored from Phoenix 1480ab0:services/imu-gateway/tests/test_parser.py
# Adapted for mova: import paths only. Regression cover on the vendored gateway.
import unittest


from mova_imu.gateway.framing import WitMotion61FrameBuffer
from mova_imu.gateway.models import (
    PacketOrigin,
    SensorInfo,
    SensorRole,
    ValidationStatus,
)
from mova_imu.gateway.parser import FrameParseError, WitMotion61Parser
from mova_imu.gateway.synthetic import make_observed_shape_frame


class WitMotion61ParserTests(unittest.TestCase):
    def setUp(self) -> None:
        self.parser = WitMotion61Parser()
        self.sensor = SensorInfo("sensor-a", SensorRole.THIGH)
        self.frame = make_observed_shape_frame(
            accelerometer=(1, -2, 3),
            gyroscope=(-4, 5, -6),
            euler_degrees=(90.0, -45.0, 0.0),
        )

    def test_parses_observed_frame_shape_without_discarding_raw_values(self) -> None:
        packet = self.parser.parse(
            self.frame,
            session_id="session-a",
            sensor=self.sensor,
            sequence_number=4,
            origin=PacketOrigin.HARDWARE,
        )

        self.assertEqual(packet.accelerometer_raw, (1, -2, 3))
        self.assertEqual(packet.gyroscope_raw, (-4, 5, -6))
        self.assertAlmostEqual(packet.euler_degrees[0], 90.0)
        self.assertAlmostEqual(packet.euler_degrees[1], -45.0)
        self.assertEqual(packet.validation_status, ValidationStatus.UNVERIFIED_CHECKSUM)

    def test_rejects_bad_length_and_header(self) -> None:
        with self.assertRaises(FrameParseError):
            self.parser.parse(
                self.frame[:-1],
                session_id="session-a",
                sensor=self.sensor,
                sequence_number=0,
                origin=PacketOrigin.HARDWARE,
            )
        with self.assertRaises(FrameParseError):
            self.parser.parse(
                b"\x00" + self.frame[1:],
                session_id="session-a",
                sensor=self.sensor,
                sequence_number=0,
                origin=PacketOrigin.HARDWARE,
            )

    def test_preserves_declared_scale_and_range_metadata(self) -> None:
        packet = self.parser.parse(
            self.frame,
            session_id="session-a",
            sensor=self.sensor,
            sequence_number=0,
            origin=PacketOrigin.HARDWARE,
            sample_rate_hz=100.0,
            accelerometer_range_g=16.0,
            gyroscope_range_dps=2_000.0,
            accelerometer_scale_g_per_lsb=16.0 / 32768.0,
            gyroscope_scale_dps_per_lsb=2_000.0 / 32768.0,
        )

        self.assertEqual(packet.sample_rate_hz, 100.0)
        self.assertEqual(packet.accelerometer_range_g, 16.0)
        self.assertEqual(packet.gyroscope_range_dps, 2_000.0)
        self.assertAlmostEqual(packet.accelerometer_scale_g_per_lsb, 16.0 / 32768.0)
        self.assertAlmostEqual(packet.gyroscope_scale_dps_per_lsb, 2_000.0 / 32768.0)


class WitMotion61FrameBufferTests(unittest.TestCase):
    def test_accepts_fragmented_frames_and_discards_noise_before_header(self) -> None:
        frame = make_observed_shape_frame(
            accelerometer=(1, 2, 3),
            gyroscope=(4, 5, 6),
            euler_degrees=(0.0, 0.0, 0.0),
        )
        buffer = WitMotion61FrameBuffer()

        self.assertEqual(buffer.feed(b"noise\x55"), [])
        self.assertEqual(buffer.feed(frame[1:9]), [])
        self.assertEqual(buffer.feed(frame[9:]), [frame])
