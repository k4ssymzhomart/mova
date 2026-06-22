"""Unit tests for the Phase-3 ML core: augmentations, losses, SMPL mock, threshold tuning,
fusion, the virtual-IMU engine, ONNX export parity, and the model registry / cards."""

from __future__ import annotations

import numpy as np
import torch

from mova.eval.clinical import fog_metrics, tune_threshold
from mova.models.fusion import CrossModalFusion, complementary_filter
from mova.registry.model_card import render_card
from mova.registry.registry import ModelEntry, ModelRegistry
from mova.ssl.augment import ContrastiveAugment
from mova.synth.engine import VirtualImuEngine
from mova.synth.smpl import SmplSkeleton
from mova.train.losses import focal_loss, inverse_frequency_weights, nt_xent


# ── augmentations ───────────────────────────────────────────────────────────
def test_contrastive_views_shape_and_distinct():
    x = torch.randn(16, 200, 6)
    v1, v2 = ContrastiveAugment().two_views(x)
    assert v1.shape == x.shape == v2.shape
    assert torch.isfinite(v1).all() and torch.isfinite(v2).all()
    assert not torch.allclose(v1, v2)  # stochastic -> two different views


# ── losses ──────────────────────────────────────────────────────────────────
def test_nt_xent_prefers_aligned_pairs():
    torch.manual_seed(0)
    z = torch.randn(32, 128)
    aligned = nt_xent(z, z.clone())
    misaligned = nt_xent(z, torch.randn(32, 128))
    assert aligned < misaligned


def test_inverse_frequency_weights_upweights_minority():
    y = torch.tensor([0] * 90 + [1] * 10)
    w = inverse_frequency_weights(y, 2)
    assert w[1] > w[0]
    assert abs(float(w.mean()) - 1.0) < 1e-5


def test_focal_runs_and_alpha_changes_value():
    logits = torch.randn(8, 2)
    y = torch.tensor([0, 0, 0, 0, 0, 0, 1, 1])
    a = focal_loss(logits, y)
    b = focal_loss(logits, y, alpha=torch.tensor([0.5, 2.0]))
    assert torch.isfinite(a) and torch.isfinite(b) and a != b


# ── SMPL mock ───────────────────────────────────────────────────────────────
def test_smpl_mock_fallback_when_model_absent(tmp_path):
    skel = SmplSkeleton.from_model_or_mock(tmp_path / "nope")
    assert skel.is_mock
    assert len(skel.parents) == 22


def test_smpl_fk_orientations_orthonormal():
    skel = SmplSkeleton.mock()
    poses = np.random.default_rng(0).standard_normal((10, 22, 3)) * 0.3
    trans = np.zeros((10, 3))
    R, pos = skel.forward_kinematics(poses, trans)
    assert R.shape == (10, 22, 3, 3) and pos.shape == (10, 22, 3)
    eye = np.einsum("...ij,...kj->...ik", R, R)
    assert np.allclose(eye, np.eye(3), atol=1e-6)


# ── threshold tuning + metrics ──────────────────────────────────────────────
def test_tune_threshold_separates_clean_scores():
    y = np.array([0] * 50 + [1] * 50)
    s = np.concatenate([np.full(50, 0.1), np.full(50, 0.9)])
    thr = tune_threshold(y, s, min_specificity=0.85)
    m = fog_metrics(y, (s >= thr).astype(int), s, threshold=thr)
    assert m.sensitivity == 1.0 and m.specificity == 1.0 and m.auroc == 1.0


# ── fusion ──────────────────────────────────────────────────────────────────
def test_complementary_filter_shape():
    out = complementary_filter(torch.randn(4, 50, 3), torch.randn(4, 50, 3), dt=0.02)
    assert out.shape == (4, 50, 3)


def test_cross_modal_fusion_confidence_gate():
    torch.manual_seed(0)
    fusion = CrossModalFusion(hidden=32, pose_dim=8, out_dim=4).eval()
    imu = torch.randn(5, 32)
    pose = torch.randn(5, 8)
    out_full = fusion(imu, pose, cv_conf=torch.ones(5, 1))
    out_zero = fusion(imu, pose, cv_conf=torch.zeros(5, 1))
    out_none = fusion(imu, None)
    assert out_full.shape == (5, 4)
    # zero confidence drops the pose token -> differs from full-confidence fusion
    assert not torch.allclose(out_full, out_zero, atol=1e-5)
    assert out_none.shape == (5, 4)


# ── virtual-IMU engine ──────────────────────────────────────────────────────
def test_virtual_imu_engine_from_pose():
    eng = VirtualImuEngine()
    assert eng.uses_mock_skeleton
    poses = np.cumsum(np.random.default_rng(1).standard_normal((120, 22, 3)) * 0.02, axis=0)
    trans = np.zeros((120, 3))
    df = eng.from_pose(poses, trans, framerate=60.0, subject_id="s1", session_id="seq")
    assert df.height > 0
    assert df.get_column("ax").is_finite().all()
    assert set(df.get_column("modality").unique().to_list()) == {"imu"}


# ── ONNX export parity ──────────────────────────────────────────────────────
def test_onnx_export_parity(tmp_path):
    from mova.export.onnx_export import export_module
    from mova.train.module import MovaLitModule

    module = MovaLitModule(
        encoder_cfg={"in_channels": 6, "max_len": 200, "hidden": 32, "n_layers": 2},
        task="fog", num_classes=2, n_placements=4, n_datasets=2,
    )
    meta = export_module(module, tmp_path, "fog_test", task="fog", opset=17)
    assert meta["model_parity_max_abs"] < 2e-4
    assert meta["encoder_parity_max_abs"] < 2e-4
    assert (tmp_path / "fog_test.onnx").is_file()


# ── registry + card ─────────────────────────────────────────────────────────
def test_registry_register_and_card(tmp_path):
    reg = ModelRegistry(tmp_path / "registry.json")
    entry = ModelEntry(
        model_id="mova-fog-test", task="freezing_of_gait",
        description="test model", metrics={"auroc": {"mean": 0.71, "std": 0.08}},
        encoder={"hidden": 128, "n_layers": 3},
        training_data={"datasets": ["daphnet_fog"], "protocol": "LOSO-CV"},
    )
    reg.register(entry)
    assert (tmp_path / "registry.json").is_file()
    reg2 = ModelRegistry(tmp_path / "registry.json")
    assert reg2.get("mova-fog-test")["metrics"]["auroc"]["mean"] == 0.71
    card = render_card(entry.as_dict())
    assert "Model Card" in card and "0.710" in card
