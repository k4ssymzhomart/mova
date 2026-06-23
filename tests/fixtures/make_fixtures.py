"""Synthetic raw-data fixtures for every adapter.

Generates tiny files in each dataset's *real* on-disk format so the full pipeline (adapters
-> canonical -> windows -> splits -> leakage) can be exercised end-to-end without the gated
multi-GB downloads. Fixtures verify pipeline mechanics (schema conformance, windowing,
subject-disjoint splits, zero leakage) — not real-data fidelity, which is confirmed on the
first ``dvc pull`` (each dataset card flags ``format_verified_against_real_data: false``).

Usage:
    python tests/fixtures/make_fixtures.py --out /tmp/mova_fixtures
"""

from __future__ import annotations

import argparse
import gzip
import pickle
from pathlib import Path

import numpy as np

RNG = np.random.default_rng(7)
SECONDS = 8.0


def _sig(n: int, base: float, rng: np.random.Generator) -> np.ndarray:
    """A smooth-ish 1-D signal of length n."""
    t = np.linspace(0, SECONDS, n)
    return base + 0.3 * np.sin(2 * np.pi * 0.8 * t) + 0.05 * rng.standard_normal(n)


def make_hhar(root: Path, subjects: list[str]) -> None:
    d = root / "hhar"
    d.mkdir(parents=True, exist_ok=True)
    rate = 100
    n = int(SECONDS * rate)
    acts = ["stand", "sit", "walk", "bike"]
    for fname, model, device in [
        ("Phones_accelerometer.csv", "nexus4", "nexus4_1"),
        ("Phones_gyroscope.csv", "nexus4", "nexus4_1"),
        ("Watch_accelerometer.csv", "gear", "gear_1"),
        ("Watch_gyroscope.csv", "gear", "gear_1"),
    ]:
        lines = ["Index,Arrival_Time,Creation_Time,x,y,z,User,Model,Device,gt"]
        for u in subjects:
            rng = np.random.default_rng(hash((u, fname)) % 2**32)
            x, y, z = _sig(n, 0, rng), _sig(n, 0, rng), _sig(n, 1, rng)
            ct0 = 1424000000000000000
            for i in range(n):
                ct = ct0 + int(i * 1e9 / rate)
                at = ct // 1_000_000
                gt = acts[(i // (n // 4)) % len(acts)]
                lines.append(f"{i},{at},{ct},{x[i]:.4f},{y[i]:.4f},{z[i]:.4f},{u},{model},{device},{gt}")
        (d / fname).write_text("\n".join(lines) + "\n")


def make_daphnet(root: Path, subjects: list[str]) -> None:
    d = root / "daphnet_fog"
    d.mkdir(parents=True, exist_ok=True)
    rate = 64
    n = int(SECONDS * rate)
    for si, s in enumerate(subjects):
        rng = np.random.default_rng(100 + si)
        cols = [np.arange(n) * int(1000 / rate)]  # time_ms
        for _ in range(9):  # 3 sensors x 3 axes, milli-g
            cols.append((_sig(n, 0, rng) * 1000).astype(int))
        annotation = np.ones(n, dtype=int)  # no_freeze
        annotation[n // 3 : n // 2] = 2  # a freeze episode
        annotation[: rate // 2] = 0  # out-of-experiment lead-in
        cols.append(annotation)
        mat = np.column_stack(cols)
        np.savetxt(d / f"{s}R01.txt", mat, fmt="%d", delimiter=" ")


def make_realdisp(root: Path, subjects: list[str]) -> None:
    d = root / "realdisp"
    d.mkdir(parents=True, exist_ok=True)
    rate = 50
    n = int(SECONDS * rate)
    n_sensors = 9
    for si, s in enumerate(subjects):
        rng = np.random.default_rng(200 + si)
        ts_s = (np.arange(n) // rate).astype(int)
        ts_us = ((np.arange(n) % rate) * int(1e6 / rate)).astype(int)
        block = np.column_stack([_sig(n, 0, rng) for _ in range(n_sensors * 13)])
        label = ((np.arange(n) // (n // 4)) % 4 + 1).astype(int)  # activities 1..4
        mat = np.column_stack([ts_s, ts_us, block, label])
        np.savetxt(d / f"{s}_ideal.log", mat, fmt="%.5f", delimiter="\t")


def make_capture24(root: Path, subjects: list[str]) -> None:
    d = root / "capture24"
    d.mkdir(parents=True, exist_ok=True)
    rate = 100
    n = int(SECONDS * rate)
    anno = ["sleep", "sitting", "walking", "bicycling"]
    for si, s in enumerate(subjects):
        rng = np.random.default_rng(300 + si)
        x, y, z = _sig(n, 0, rng), _sig(n, 0, rng), _sig(n, 1, rng)
        rows = ["time,x,y,z,annotation"]
        for i in range(n):
            a = anno[(i // (n // 4)) % len(anno)]
            rows.append(f"{i / rate:.4f},{x[i]:.4f},{y[i]:.4f},{z[i]:.4f},{a}")
        with gzip.open(d / f"{s}.csv.gz", "wt") as fh:
            fh.write("\n".join(rows) + "\n")


def make_totalcapture(root: Path, subjects: list[str]) -> None:
    d = root / "totalcapture"
    d.mkdir(parents=True, exist_ok=True)
    rate = 60
    n = int(SECONDS * rate)
    n_sensors = 13
    for si, s in enumerate(subjects):
        rng = np.random.default_rng(400 + si)
        # per sensor: quat(4 normalized) + acc(3) + gyro(3) + mag(3)
        blocks = []
        for _ in range(n_sensors):
            q = rng.standard_normal((n, 4))
            q /= np.linalg.norm(q, axis=1, keepdims=True)
            acc = np.column_stack([_sig(n, 0, rng), _sig(n, 0, rng), _sig(n, 1, rng)])
            gyr = np.column_stack([_sig(n, 0, rng) for _ in range(3)])
            mag = np.column_stack([_sig(n, 0, rng) for _ in range(3)])
            blocks.append(np.column_stack([q, acc, gyr, mag]))
        mat = np.column_stack(blocks)
        with (d / f"{s}_acting1_Xsens_AuxFields.sensors").open("w") as fh:
            fh.write(f"{n_sensors} {n}\n")
            np.savetxt(fh, mat, fmt="%.5f")


def make_dip(root: Path, subjects: list[str]) -> None:
    from mova.synth.rotations import axis_angle_to_matrix

    d = root / "dip_imu"
    d.mkdir(parents=True, exist_ok=True)
    n = int(SECONDS * 60)
    for si, s in enumerate(subjects):
        rng = np.random.default_rng(500 + si)
        acc = rng.standard_normal((n, 17, 3)) * 2.0  # m/s^2
        aa = np.cumsum(rng.standard_normal((n, 17, 3)) * 0.02, axis=0)
        ori = axis_angle_to_matrix(aa)  # [n,17,3,3]
        gt = rng.standard_normal((n, 72)) * 0.1
        with (d / f"{s}.pkl").open("wb") as fh:
            pickle.dump({"imu_acc": acc, "imu_ori": ori, "gt": gt}, fh)


def make_amass(root: Path, subjects: list[str]) -> None:
    n = int(SECONDS * 60)
    for si, s in enumerate(subjects):
        rng = np.random.default_rng(600 + si)
        poses = np.zeros((n, 156))
        poses[:, :66] = np.cumsum(rng.standard_normal((n, 66)) * 0.01, axis=0)
        trans = np.cumsum(rng.standard_normal((n, 3)) * 0.01, axis=0)
        sd = root / "amass" / s
        sd.mkdir(parents=True, exist_ok=True)
        np.savez(sd / "seq1.npz", poses=poses, trans=trans, mocap_framerate=60.0)


def make_kimore(root: Path, subjects: list[str]) -> None:
    n = int(SECONDS * 30)
    for si, s in enumerate(subjects):
        rng = np.random.default_rng(700 + si)
        pos = np.cumsum(rng.standard_normal((n, 25 * 3)) * 0.01, axis=0)
        conf = np.full((n, 25), 1.0)
        # interleave xyz + confidence per joint -> 25*4
        full = np.zeros((n, 25 * 4))
        for j in range(25):
            full[:, j * 4 : j * 4 + 3] = pos.reshape(n, 25, 3)[:, j]
            full[:, j * 4 + 3] = conf[:, j]
        sd = root / "kimore" / "CG" / "Es1" / s
        sd.mkdir(parents=True, exist_ok=True)
        np.savetxt(sd / "JointPosition.csv", full, delimiter=",", fmt="%.4f")


def make_uiprmd(root: Path, subjects: list[str]) -> None:
    n = int(SECONDS * 30)
    for si, s in enumerate(subjects):
        rng = np.random.default_rng(800 + si)
        pos = np.cumsum(rng.standard_normal((n, 22 * 3)) * 0.01, axis=0)
        sd = root / "ui_prmd" / "Correct"
        sd.mkdir(parents=True, exist_ok=True)
        np.savetxt(sd / f"m01_{s}_positions.txt", pos, fmt="%.4f")


def make_sessions(root: Path, n_sessions: int = 4) -> None:
    """Flywheel session records (pose + framerate), Kinect-25 skeleton."""
    n = int(SECONDS * 30)
    sd = root / "sessions"
    sd.mkdir(parents=True, exist_ok=True)
    from mova.pose.schema import KINECT25

    for i in range(n_sessions):
        rng = np.random.default_rng(900 + i)
        pose = np.cumsum(rng.standard_normal((n, 25, 3)) * 0.01, axis=0)
        np.savez(
            sd / f"session_{i:03d}.npz",
            pose=pose,
            joint_names=np.array(KINECT25, dtype=object),
            framerate=30.0,
            session_id=f"sess{i:03d}",
            subject_id=f"patient{i:03d}",
        )


def make_all(out: Path) -> Path:
    imu_subjects = ["s01", "s02", "s03", "s04"]
    out.mkdir(parents=True, exist_ok=True)
    make_hhar(out, ["a", "b", "c", "d"])
    make_daphnet(out, ["S01", "S02", "S03", "S04"])
    make_realdisp(out, [f"subject{i}" for i in range(1, 5)])
    make_capture24(out, ["P001", "P002", "P003"])
    make_totalcapture(out, ["S1", "S2", "S3"])
    make_dip(out, [f"S{i:02d}" for i in range(1, 4)])
    make_amass(out, imu_subjects)
    make_kimore(out, [f"Subject{i}" for i in range(1, 4)])
    make_uiprmd(out, [f"s{i:02d}" for i in range(1, 4)])
    make_sessions(out)
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Generate synthetic raw fixtures for all adapters")
    p.add_argument("--out", type=Path, default=Path("/tmp/mova_fixtures"))
    args = p.parse_args(argv)
    make_all(args.out)
    print(f"fixtures written to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
