"""Self-supervised pretraining module: masked IMU modeling + contrastive learning.

Two objectives share one encoder:

  * **Masked IMU modeling** — span-mask ~15% of timesteps (BERT 80/10/10 corruption) and reconstruct
    the masked positions with **smooth-L1** (Huber). Smooth-L1 is robust to the occasional large
    IMU spike that an MSE loss would over-penalize.
  * **Contrastive (NT-Xent)** — two augmented views of each window are pulled together and pushed
    away from the rest of the batch. The augmentations (rotation, time-warp, scaling, jitter,
    sensor-dropout) are exactly the cross-device / cross-position / noise nuisances the thesis wants
    the encoder to become invariant to (Part 1.4.3).

Total loss = ``recon`` + ``contrastive_weight · NT-Xent``. After pretraining, the reconstruction
and projection heads are discarded; only the encoder weights are warm-started into the task heads.
"""

from __future__ import annotations

from typing import Any

import pytorch_lightning as pl
import torch
import torch.nn.functional as F
from torch.optim import AdamW
from torch.optim.lr_scheduler import CosineAnnealingLR, LinearLR, SequentialLR

from mova.models.encoder import EncoderConfig, LIMUBertEncoder, ProjectionHead, ReconstructionHead
from mova.ssl.augment import AugmentConfig, ContrastiveAugment
from mova.train.losses import nt_xent


class MovaSSLModule(pl.LightningModule):
    """Masked + contrastive SSL over Mova IMU windows."""

    def __init__(
        self,
        encoder_cfg: dict[str, Any],
        n_placements: int = 32,
        n_datasets: int = 8,
        lr: float = 3e-4,
        weight_decay: float = 0.05,
        warmup_ratio: float = 0.05,
        max_steps: int = 10_000,
        mask_ratio: float = 0.15,
        mask_span: int = 10,
        proj_dim: int = 128,
        temperature: float = 0.2,
        contrastive_weight: float = 1.0,
        augment_cfg: dict[str, Any] | None = None,
    ) -> None:
        super().__init__()
        self.save_hyperparameters()
        cfg = EncoderConfig(**{**encoder_cfg, "n_placements": n_placements, "n_datasets": n_datasets})
        self.encoder = LIMUBertEncoder(cfg)
        self.recon_head = ReconstructionHead(cfg.hidden, cfg.in_channels)
        self.proj_head = ProjectionHead(cfg.hidden, proj_dim)
        self.augment = ContrastiveAugment(AugmentConfig(**augment_cfg) if augment_cfg else None)

    # ---- masked reconstruction ------------------------------------------------
    def _mlm_mask(self, b: int, t: int, device: torch.device) -> torch.Tensor:
        span = max(1, int(self.hparams.mask_span))
        p_seed = float(self.hparams.mask_ratio) / span
        seed = (torch.rand(b, t, device=device) < p_seed).float()
        if span > 1:
            seed = F.max_pool1d(seed.unsqueeze(1), kernel_size=span, stride=1, padding=span // 2)
            seed = seed.squeeze(1)[:, :t]
        mask = seed.bool()
        if not bool(mask.any()):
            mask[:, 0] = True
        return mask

    def _recon_loss(self, x, pid, did) -> torch.Tensor:
        b, t, _ = x.shape
        mask = self._mlm_mask(b, t, x.device)
        r = torch.rand(b, t, 1, device=x.device)
        m = mask.unsqueeze(-1)
        x_in = torch.where(m & (r < 0.8), torch.zeros_like(x), x)
        x_in = torch.where(m & (r >= 0.8) & (r < 0.9), torch.randn_like(x), x_in)
        h = self.encoder(x_in, pid, did)
        recon = self.recon_head(h)
        return F.smooth_l1_loss(recon[mask], x[mask])

    # ---- contrastive ----------------------------------------------------------
    def _contrastive_loss(self, x, pid, did) -> torch.Tensor:
        v1, v2 = self.augment.two_views(x)
        z1 = self.proj_head(LIMUBertEncoder.pool(self.encoder(v1, pid, did)))
        z2 = self.proj_head(LIMUBertEncoder.pool(self.encoder(v2, pid, did)))
        return nt_xent(z1, z2, temperature=float(self.hparams.temperature))

    # ---- steps ----------------------------------------------------------------
    def _step(self, batch: dict[str, torch.Tensor], stage: str) -> torch.Tensor:
        x, pid, did = batch["x"], batch["placement"], batch["dataset"]
        recon = self._recon_loss(x, pid, did)
        contrast = self._contrastive_loss(x, pid, did)
        loss = recon + float(self.hparams.contrastive_weight) * contrast
        self.log_dict(
            {f"{stage}/loss": loss, f"{stage}/recon": recon, f"{stage}/contrastive": contrast},
            prog_bar=(stage == "train"), on_step=(stage == "train"), on_epoch=True,
        )
        return loss

    def training_step(self, batch, _: int) -> torch.Tensor:
        return self._step(batch, "train")

    def validation_step(self, batch, _: int) -> None:
        self._step(batch, "val")

    def configure_optimizers(self) -> dict[str, Any]:
        params = [p for p in self.parameters() if p.requires_grad]
        opt = AdamW(params, lr=self.hparams.lr, weight_decay=self.hparams.weight_decay)
        total = max(1, int(self.hparams.max_steps))
        warmup = int(total * float(self.hparams.warmup_ratio))
        if warmup > 0:
            sched: torch.optim.lr_scheduler.LRScheduler = SequentialLR(
                opt,
                schedulers=[
                    LinearLR(opt, start_factor=0.01, total_iters=warmup),
                    CosineAnnealingLR(opt, T_max=max(1, total - warmup)),
                ],
                milestones=[warmup],
            )
        else:
            sched = CosineAnnealingLR(opt, T_max=total)
        return {"optimizer": opt, "lr_scheduler": {"scheduler": sched, "interval": "step"}}
