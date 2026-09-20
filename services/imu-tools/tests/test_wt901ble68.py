# Vendored from Phoenix 1480ab0:services/imu-gateway/tests/test_wt901ble68.py
# Adapted for mova: import paths only. Regression cover on the vendored gateway.
import unittest

from mova_imu.gateway.wt901ble68 import AnglesFramer, checksum_is_valid, parse_angles_frame


def frame() -> bytes:
    payload = bytes.fromhex("5561004000e000000000")
    return payload + bytes([sum(payload) & 0xFF])


class WT901BLE68Tests(unittest.TestCase):
    def test_checksum_and_scaling(self) -> None:
        parsed = parse_angles_frame(frame())
        self.assertTrue(checksum_is_valid(frame()))
        self.assertAlmostEqual(parsed.roll_degrees, 90.0)
        self.assertAlmostEqual(parsed.pitch_degrees, -45.0)

    def test_framer_handles_split_notification(self) -> None:
        framer = AnglesFramer()
        self.assertEqual(framer.feed(frame()[:4]), [])
        self.assertEqual(framer.feed(frame()[4:]), [frame()])
