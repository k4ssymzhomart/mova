"""IMU window augmentations for contrastive self-supervised learning.

These transforms generate *positive pairs* (two views of the same window) for NT-Xent. They are
chosen to be invariances we explicitly want the encoder to learn — the generalization axes from
the thesis (Part 1.4.3): cross-device, cross-position, and noise robustness:

  * ``jitter``          — additive Gaussian noise (sensor noise floor / device differences);
  * ``scaling``         — per-channel amplitude scaling (gain mismatch across devices);
  * ``time_warp``       — smooth, monotone time distortion (cadence / speed differences);
  * ``sensor_dropout``  — zero a contiguous channel group (a sensor briefly missing/occluded);
  * ``rotation``        — small SO(3) rotation of the acc & gyro triads jointly (placement / mounting
                          orientation differences — the dominant cross-position nuisance).

All ops run batched on the model device (``[B, T, C]`` float tensors) so contrastive views are made
on-GPU/MPS with no host round-trip. Seeds flow through the caller's global torch RNG.
"""

from __future__ import annotations

from dataclasses import dataclass

import torch


def jitter(x: torch.Tensor, sigma: float) -> torch.Tensor:
    if sigma <= 0:
        return x
    return x + torch.randn_like(x) * sigma


def scaling(x: torch.Tensor, sigma: float) -> torch.Tensor:
    """Per-(batch, channel) amplitude scale ~ N(1, sigma)."""
    if sigma <= 0:
        return x
    factor = 1.0 + torch.randn(x.shape[0], 1, x.shape[2], device=x.device) * sigma
    return x * factor


def time_warp(x: torch.Tensor, n_knots: int = 4, sigma: float = 0.2) -> torch.Tensor:
    """Smooth monotone temporal resampling via a random cumulative warp, per sample."""
    if sigma <= 0:
        return x
    b, t, c = x.shape
    knots = torch.rand(b, n_knots, device=x.device) * sigma + (1.0 - sigma / 2)
    steps = knots.repeat_interleave(max(1, t // n_knots), dim=1)
    if steps.shape[1] < t:
        steps = torch.cat([steps, steps[:, -1:].expand(b, t - steps.shape[1])], dim=1)
    else:
        steps = steps[:, :t]
    cum = torch.cumsum(steps, dim=1)
    cum = (cum - cum[:, :1]) / (cum[:, -1:] - cum[:, :1] + 1e-8)  # -> [0,1] per sample
    src = cum * (t - 1)  # fractional source indices
    lo = src.floor().long().clamp(0, t - 1)
    hi = (lo + 1).clamp(0, t - 1)
    frac = (src - lo.float()).unsqueeze(-1)
    gl = torch.gather(x, 1, lo.unsqueeze(-1).expand(b, t, c))
    gh = torch.gather(x, 1, hi.unsqueeze(-1).expand(b, t, c))
    return gl * (1 - frac) + gh * frac


def sensor_dropout(x: torch.Tensor, p: float, groups: tuple[tuple[int, ...], ...]) -> torch.Tensor:
    """Zero whole channel groups (e.g. the acc triad or gyro triad) with prob ``p`` per sample."""
    if p <= 0:
        return x
    out = x.clone()
    for g in groups:
        mask = (torch.rand(x.shape[0], device=x.device) < p).view(-1, 1, 1)
        idx = torch.tensor(g, device=x.device)
        gz = out.index_select(2, idx) * (~mask)
        out.index_copy_(2, idx, gz)
    return out


def _rand_rotation(b: int, sigma_deg: float, device: torch.device) -> torch.Tensor:
    """Batch of small rotation matrices ``[B,3,3]`` from axis-angle ~ N(0, sigma)."""
    aa = torch.randn(b, 3, device=device) * (sigma_deg * torch.pi / 180.0)
    theta = aa.norm(dim=1, keepdim=True).clamp_min(1e-8)
    k = aa / theta
    kx, ky, kz = k[:, 0], k[:, 1], k[:, 2]
    zero = torch.zeros_like(kx)
    kmat = torch.stack(
        [zero, -kz, ky, kz, zero, -kx, -ky, kx, zero], dim=1
    ).view(b, 3, 3)
    eye = torch.eye(3, device=device).expand(b, 3, 3)
    th = theta.view(b, 1, 1)
    return eye + torch.sin(th) * kmat + (1 - torch.cos(th)) * (kmat @ kmat)


def rotation(x: torch.Tensor, sigma_deg: float, acc=(0, 1, 2), gyr=(3, 4, 5)) -> torch.Tensor:
    """Apply the same small random SO(3) rotation to the acc triad and the gyro triad."""
    if sigma_deg <= 0 or x.shape[2] < 6:
        return x
    r = _rand_rotation(x.shape[0], sigma_deg, x.device)  # [B,3,3]
    out = x.clone()
    for triad in (acc, gyr):
        idx = torch.tensor(triad, device=x.device)
        v = out.index_select(2, idx)  # [B,T,3]
        rv = torch.einsum("bij,btj->bti", r, v)
        out.index_copy_(2, idx, rv)
    return out


@dataclass
class AugmentConfig:
    jitter_sigma: float = 0.05
    scale_sigma: float = 0.1
    warp_sigma: float = 0.2
    dropout_p: float = 0.1
    rotation_deg: float = 15.0
    channel_groups: tuple[tuple[int, ...], ...] = ((0, 1, 2), (3, 4, 5))  # acc, gyro


class ContrastiveAugment:
    """Stochastic augmentation pipeline producing one randomized view of a batch."""

    def __init__(self, cfg: AugmentConfig | None = None) -> None:
        self.cfg = cfg or AugmentConfig()

    def __call__(self, x: torch.Tensor) -> torch.Tensor:
        c = self.cfg
        x = rotation(x, c.rotation_deg)
        x = time_warp(x, sigma=c.warp_sigma)
        x = scaling(x, c.scale_sigma)
        x = jitter(x, c.jitter_sigma)
        x = sensor_dropout(x, c.dropout_p, c.channel_groups)
        return x

    def two_views(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        return self(x), self(x)
