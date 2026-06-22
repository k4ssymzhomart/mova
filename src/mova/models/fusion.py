"""IMU ↔ vision (pose) fusion for one robust kinematic stream.

The product (Part 5) runs on-device markerless pose *and* sparse IMUs. Each modality fails
differently: vision degrades under occlusion / extreme flexion / poor lighting; IMUs drift and are
placement-sensitive. Fusion exploits the complementarity — and crucially **shifts weight to the IMU
when the CV confidence drops** (the documented CV failure mode).

Two complementary mechanisms:

  * ``ComplementaryFilter`` — the classical orientation fuser: high-pass the gyro integration,
    low-pass the accelerometer tilt. No training; a strong, interpretable baseline.
  * ``CrossModalFusion`` — a learned cross-attention block over the IMU encoder embedding and a
    pose-feature embedding, with a **confidence gate**: the pose contribution is scaled by the
    per-frame CV confidence, so as confidence → 0 the fused estimate falls back to IMU-only.

Both are pure ``nn.Module`` / functional code so they export to ONNX and run in the inference
service. Trained end-to-end they require synced pose+IMU (the flywheel, Part 1.4.6); until that
real paired data exists, ``CrossModalFusion`` is validated structurally + on synthetic pairs.
"""

from __future__ import annotations

import torch
from torch import nn


def complementary_filter(
    gyro: torch.Tensor, accel_tilt: torch.Tensor, dt: float, alpha: float = 0.98
) -> torch.Tensor:
    """Fuse gyro-integrated angle with accelerometer tilt. ``gyro``/``accel_tilt``: ``[B,T,A]``.

    angle_t = alpha (angle_{t-1} + gyro_t·dt) + (1-alpha) accel_tilt_t.
    """
    b, t, a = gyro.shape
    angle = torch.zeros(b, a, device=gyro.device, dtype=gyro.dtype)
    out = []
    for k in range(t):
        angle = alpha * (angle + gyro[:, k] * dt) + (1.0 - alpha) * accel_tilt[:, k]
        out.append(angle)
    return torch.stack(out, dim=1)


class PoseFeatureEncoder(nn.Module):
    """Small MLP lifting a pose-feature vector (joint angles / ROM / smoothness) to the fusion dim."""

    def __init__(self, in_dim: int, hidden: int) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden), nn.GELU(), nn.LayerNorm(hidden), nn.Linear(hidden, hidden)
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class CrossModalFusion(nn.Module):
    """Confidence-gated cross-attention fusion of IMU and pose embeddings -> kinematic output.

    Inputs:
      * ``imu_emb``  ``[B, hidden]`` — pooled IMU encoder representation;
      * ``pose_feat`` ``[B, pose_dim]`` — per-window pose features (or None);
      * ``cv_conf``  ``[B, 1]`` in [0,1] — markerless-pose confidence (1 = reliable).

    Output: ``[B, out_dim]`` fused kinematic estimate (e.g. joint angles). When ``cv_conf`` → 0 the
    gated pose token vanishes and the block reduces to an IMU-only estimator.
    """

    def __init__(self, hidden: int, pose_dim: int, out_dim: int, n_heads: int = 4) -> None:
        super().__init__()
        self.pose_enc = PoseFeatureEncoder(pose_dim, hidden)
        self.attn = nn.MultiheadAttention(hidden, n_heads, batch_first=True)
        self.norm = nn.LayerNorm(hidden)
        self.imu_only = nn.Parameter(torch.zeros(1, 1, hidden))  # learned IMU-only fallback token
        self.head = nn.Sequential(
            nn.LayerNorm(hidden), nn.Linear(hidden, hidden), nn.GELU(), nn.Linear(hidden, out_dim)
        )

    def forward(
        self,
        imu_emb: torch.Tensor,
        pose_feat: torch.Tensor | None = None,
        cv_conf: torch.Tensor | None = None,
    ) -> torch.Tensor:
        b = imu_emb.shape[0]
        query = imu_emb.unsqueeze(1)  # [B,1,H]
        if pose_feat is not None:
            pose_tok = self.pose_enc(pose_feat).unsqueeze(1)  # [B,1,H]
            if cv_conf is not None:
                pose_tok = pose_tok * cv_conf.view(b, 1, 1).clamp(0, 1)
        else:
            pose_tok = self.imu_only.expand(b, 1, -1)
        # context = the (gated) pose token + a constant IMU-only fallback, so attention can ignore
        # an unreliable pose token and still attend to a stable IMU-derived key.
        context = torch.cat([pose_tok, self.imu_only.expand(b, 1, -1)], dim=1)  # [B,2,H]
        fused, _ = self.attn(query, context, context, need_weights=False)
        fused = self.norm(query + fused).squeeze(1)
        return self.head(fused)
