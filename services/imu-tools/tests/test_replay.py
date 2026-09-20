# Vendored from Phoenix 1480ab0:services/imu-gateway/tests/test_replay.py
# Adapted for mova: import paths only. Regression cover on the vendored gateway.
import asyncio
import unittest
from pathlib import Path


from mova_imu.gateway.delivery import deliver_packets, flush_buffer
from mova_imu.gateway.models import ValidationStatus
from mova_imu.gateway.synthetic import build_synthetic_replay, packet_as_json
from mova_imu.gateway.transport import DurableBuffer, SequenceTracker, normalize_packet


class SyntheticReplayTests(unittest.TestCase):
    def test_streams_three_explicit_roles_with_synthetic_marking(self) -> None:
        async def collect():
            replay = build_synthetic_replay()
            sensors = await replay.discover()
            for sensor in sensors:
                await replay.connect(sensor.sensor_id)
            return [packet async for packet in replay.stream()]

        packets = asyncio.run(collect())
        self.assertEqual(len(packets), 15)
        self.assertEqual(
            {packet.sensor.role.value for packet in packets}, {"thigh", "shank", "foot"}
        )
        self.assertTrue(
            all(packet.validation_status is ValidationStatus.SYNTHETIC for packet in packets)
        )
        self.assertIn('"origin": "synthetic"', packet_as_json(packets[0]))

    def test_sequence_number_is_monotonic_per_sensor(self) -> None:
        async def collect():
            replay = build_synthetic_replay()
            for sensor in await replay.discover():
                await replay.connect(sensor.sensor_id)
            return [packet async for packet in replay.stream()]

        packets = asyncio.run(collect())
        by_sensor: dict[str, list[int]] = {}
        for packet in packets:
            by_sensor.setdefault(packet.sensor.sensor_id, []).append(packet.sequence_number)
        self.assertEqual(set(map(tuple, by_sensor.values())), {(0, 1, 2, 3, 4)})

    def test_normalized_contract_contains_explicit_role_and_timestamps(self) -> None:
        async def first_packet():
            replay = build_synthetic_replay()
            for sensor in await replay.discover():
                await replay.connect(sensor.sensor_id)
            return await anext(replay.stream())

        normalized = normalize_packet(asyncio.run(first_packet()))
        self.assertEqual(normalized["sensor_role"], "thigh")
        self.assertIn("timestamp_gateway", normalized)
        self.assertIn("sequence_number", normalized)

    def test_tracker_reports_gap_duplicate_and_out_of_order(self) -> None:
        async def packets():
            replay = build_synthetic_replay()
            for sensor in await replay.discover():
                await replay.connect(sensor.sensor_id)
            return [packet async for packet in replay.stream()]

        samples = asyncio.run(packets())
        tracker = SequenceTracker()
        first, second = samples[0], samples[9]
        self.assertEqual(tracker.observe(first).missing, 0)
        self.assertEqual(tracker.observe(second).missing, 2)
        self.assertTrue(tracker.observe(second).duplicate)
        self.assertTrue(tracker.observe(first).out_of_order)

    def test_durable_buffer_round_trip(self) -> None:
        async def first_packet():
            replay = build_synthetic_replay()
            sensor = (await replay.discover())[0]
            await replay.connect(sensor.sensor_id)
            return await anext(replay.stream())

        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            buffer = DurableBuffer(Path(directory) / "pending.jsonl")
            buffer.append(asyncio.run(first_packet()))
            self.assertEqual(len(buffer.pending()), 1)
            buffer.clear_after_delivery()
            self.assertEqual(buffer.pending(), [])

    def test_delivery_buffers_failed_packets_and_preserves_order(self) -> None:
        async def packets():
            replay = build_synthetic_replay()
            sensor = (await replay.discover())[0]
            await replay.connect(sensor.sensor_id)
            return [packet async for packet in replay.stream()]

        import tempfile

        sent: list[int] = []

        async def send(event):
            if event["sequence_number"] == 1:
                raise RuntimeError("offline")
            sent.append(event["sequence_number"])

        with tempfile.TemporaryDirectory() as directory:
            buffer = DurableBuffer(Path(directory) / "pending.jsonl")
            result = asyncio.run(
                deliver_packets(asyncio.run(packets())[:3], send=send, buffer=buffer)
            )
            self.assertEqual((result.delivered, result.buffered), (2, 1))
            self.assertEqual(sent, [0, 2])
            self.assertEqual(buffer.pending()[0]["sequence_number"], 1)

    def test_flush_buffer_retains_unacknowledged_tail_in_order(self) -> None:
        async def packets():
            replay = build_synthetic_replay()
            sensor = (await replay.discover())[0]
            await replay.connect(sensor.sensor_id)
            return [packet async for packet in replay.stream()]

        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            buffer = DurableBuffer(Path(directory) / "pending.jsonl")
            for packet in asyncio.run(packets())[:3]:
                buffer.append(packet)
            sent: list[int] = []

            async def send(event):
                sent.append(event["sequence_number"])
                if event["sequence_number"] == 1:
                    raise RuntimeError("offline")

            result = asyncio.run(flush_buffer(send=send, buffer=buffer))
            self.assertEqual((result.delivered, result.buffered), (1, 2))
            self.assertEqual(sent, [0, 1])
            self.assertEqual([item["sequence_number"] for item in buffer.pending()], [1, 2])
