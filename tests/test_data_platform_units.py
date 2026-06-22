"""Unit tests for the Phase-2 data platform: rotation math, virtual-IMU synth, pose
features, LOSO generation, leakage detection, and adapter schema conformance."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tests" / "fixtures"))

import make_fixtures  # noqa: E402

from mova.data import leakage  # noqa: E402
from mova.data.adapters import (  # noqa: E402
    amass_adapter,
    capture24_adapter,
    dip_imu_adapter,
)
from mova.data.adapters._canonical import CANONICAL_COLUMNS  # noqa: E402
from mova.pose import features as pf  # noqa: E402
from mova.pose.schema import KINECT25  # noqa: E402
from mova.preprocess.loso import generate_loso  # noqa: E402
from mova.synth import amass, rotations  # noqa: E402

SCHEMA = str(REPO / "data_manifests" / "schemas" / "canonical.json")


# ── rotation math ──────────────────────────────────────────────────────────
def test_axis_angle_matrix_is_orthonormal():
    aa = np.random.default_rng(0).standard_normal((20, 3))
    R = rotations.axis_angle_to_matrix(aa)
    eye = np.einsum("tij,tkj->tik", R, R)
    assert np.allclose(eye, np.eye(3)[None], atol=1e-6)
    assert np.allclose(np.linalg.det(R), 1.0, atol=1e-6)


def test_angular_velocity_recovers_constant_spin():
    dt, omega, n = 1 / 60.0, 2.0, 200
    thetas = omega * dt * np.arange(n)
    R = rotations.axis_angle_to_matrix(np.stack([np.zeros(n), np.zeros(n), thetas], axis=-1))
    w = rotations.angular_velocity(R, dt)
    assert np.allclose(w[5:-5, 2], omega, atol=1e-2)
    assert np.allclose(w[5:-5, :2], 0.0, atol=1e-2)


def test_matrix_to_quat_identity_and_norm():
    q = rotations.matrix_to_quat(np.eye(3)[None])
    assert np.allclose(q[0], [1, 0, 0, 0], atol=1e-6)
    R = rotations.axis_angle_to_matrix(np.random.default_rng(1).standard_normal((10, 3)))
    assert np.allclose(np.linalg.norm(rotations.matrix_to_quat(R), axis=-1), 1.0, atol=1e-6)


# ── AMASS virtual-IMU synth ────────────────────────────────────────────────
def test_amass_synth_emits_finite_canonical():
    rng = np.random.default_rng(2)
    poses = np.cumsum(rng.standard_normal((300, 52, 3)) * 0.01, axis=0)
    trans = np.cumsum(rng.standard_normal((300, 3)) * 0.01, axis=0)
    df = amass.synth_virtual_imu(poses, trans, framerate=60.0, subject_id="x", session_id="s")
    assert list(df.columns) == CANONICAL_COLUMNS
    assert df.get_column("placement").n_unique() == len(amass.PLACEMENT_JOINTS)
    for ch in ("ax", "ay", "az", "gx", "gy", "gz"):
        assert df.get_column(ch).is_finite().all()
    angles = amass.joint_angles_deg(poses[:, :22])
    assert angles.shape == (300, 22) and np.isfinite(angles).all()


# ── pose features ──────────────────────────────────────────────────────────
def test_pose_features_rom_and_symmetry():
    n = 120
    pos = np.zeros((n, len(KINECT25), 3))
    idx = {nm: i for i, nm in enumerate(KINECT25)}
    # static shoulders/hips; flex both elbows identically -> ROM>0, symmetry~1
    for side in ("l", "r"):
        pos[:, idx[f"{side}_shoulder"]] = [0, 1, 0]
        pos[:, idx[f"{side}_hip"]] = [0, -1, 0]
        ang = np.linspace(0, np.pi / 2, n)
        pos[:, idx[f"{side}_elbow"]] = [0, 0.5, 0]
        pos[:, idx[f"{side}_wrist"]] = np.stack([np.sin(ang) * 0.3, 0.5 - np.cos(ang) * 0.3, np.zeros(n)], -1)
    feats = pf.session_features(pos, KINECT25, dt=1 / 30.0)
    assert feats["rom_deg"]["l_elbow"] > 5.0
    assert abs(feats["symmetry"]["elbow"] - 1.0) < 1e-3


# ── LOSO ───────────────────────────────────────────────────────────────────
def test_loso_each_subject_tested_once():
    subs = ["a", "b", "c", "d"]
    folds = generate_loso(subs)
    assert len(folds) == 4
    tested = sorted(s for f in folds for s in f["test"])
    assert tested == subs
    for f in folds:
        tr, va, te = set(f["train"]), set(f["val"]), set(f["test"])
        assert not (tr & va) and not (tr & te) and not (va & te)
        assert len(te) == 1


# ── leakage detection (positive + negative) ────────────────────────────────
def test_leakage_flags_overlap(tmp_path):
    leaky = {"splits": {"ds": {"train": ["a", "b"], "val": ["b"], "test": ["c"]}}}
    p = tmp_path / "splits.json"
    p.write_text(json.dumps(leaky))
    res = leakage.check_subject_splits(p)
    assert res["leak_count"] == 1  # 'b' in train and val

    clean = {"splits": {"ds": {"train": ["a"], "val": ["b"], "test": ["c"]}}}
    p.write_text(json.dumps(clean))
    assert leakage.check_subject_splits(p)["leak_count"] == 0


# ── adapter schema conformance ─────────────────────────────────────────────
def test_new_imu_adapters_conform(tmp_path):
    raw = tmp_path / "raw"
    make_fixtures.make_all(raw)
    interim = tmp_path / "interim"
    for mod, sub in [(capture24_adapter, "capture24"), (dip_imu_adapter, "dip_imu")]:
        assert mod.main(["--raw-dir", str(raw / sub), "--out-dir", str(interim),
                         "--schema", SCHEMA, "--log-level", "ERROR"]) == 0
    assert amass_adapter.main(["--raw-dir", str(raw / "amass"), "--out-dir", str(interim),
                               "--log-level", "ERROR"]) == 0

    import polars as pl

    df = pl.scan_parquet(str(interim / "**" / "*.parquet"), hive_partitioning=True).collect()
    for col in CANONICAL_COLUMNS:
        assert col in df.columns
    for ds in ("capture24", "dip_imu", "amass"):
        sub = df.filter(pl.col("dataset") == ds)
        assert sub.height > 0
        assert sub.get_column("ax").is_finite().all()
    # DIP subject must come from the parent dir (s_01 -> S01), not the activity filename.
    dip = df.filter(pl.col("dataset") == "dip_imu")
    assert set(dip.get_column("subject_id").unique().to_list()) == {"S01", "S02", "S03"}
    # AMASS subject must come from the performer dir (HDM05_<actor>), disjoint per actor.
    am = df.filter(pl.col("dataset") == "amass")
    assert am.get_column("subject_id").n_unique() == 4
