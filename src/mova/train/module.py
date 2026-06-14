"""PyTorch Lightning module wrapping the Mova encoder.

One module, three tasks (selected by ``task``):
  * ``ssl`` — LIMU-BERT masked-IMU modeling: span-mask timesteps (BERT 80/10/10 corruption) and
    reconstruct the masked positions (MSE on masked positions only).
  * ``har`` — multi-class activity classification head on the pooled encoder representation.
  * ``fog`` — binary freezing-of-gait classification head (the clinical task).

Optimizer: AdamW. Schedule: linear warmup -> CosineAnnealing (step interval).
Fine-tuning can warm-start from a pretrained SSL checkpoint and optionally freeze the encoder.
"""

from __future__ import annotations

from typing import Any

import pytorch_lightning as pl
import torch
import torch.nn.functional as F
from torch.optim import AdamW
from torch.optim.lr_scheduler import CosineAnnealingLR, LinearLR, SequentialLR
from torchmetrics.classification import MulticlassAccuracy, MulticlassF1Score

from mova.models.encoder import ClassifierHead, EncoderConfig, LIMUBertEncoder, ReconstructionHead


class MovaLitModule(pl.LightningModule):
    """Encoder + task head + optimization, for SSL pretraining and HAR/FoG fine-tuning."""

    def __init__(
        self,
        encoder_cfg: dict[str, Any],
        task: str = "ssl",
        num_classes: int | None = None,
        n_placements: int = 32,
        n_datasets: int = 8,
        lr: float = 3e-4,
        weight_decay: float = 0.05,
        warmup_ratio: float = 0.05,
        max_steps: int = 10_000,
        mask_ratio: float = 0.15,
        mask_span: int = 10,
        pretrained_ckpt: str | None = None,
        freeze_encoder: bool = False,
    ) -> None:
        super().__init__()
        self.save_hyperparameters()
        cfg = EncoderConfig(
            **{**encoder_cfg, "n_placements": n_placements, "n_datasets": n_datasets}
        )
        self.encoder = LIMUBertEncoder(cfg)

        if task == "ssl":
            self.head: torch.nn.Module = ReconstructionHead(cfg.hidden, cfg.in_channels)
        else:
            if num_classes is None:
                raise ValueError(f"task={task!r} requires num_classes")
            self.head = ClassifierHead(cfg.hidden, num_classes)
            self.val_acc = MulticlassAccuracy(num_classes)
            self.val_f1 = MulticlassF1Score(num_classes, average="macro")
            self.test_acc = MulticlassAccuracy(num_classes)
            self.test_f1 = MulticlassF1Score(num_classes, average="macro")

        if pretrained_ckpt:
            self._load_pretrained_encoder(pretrained_ckpt)
        if freeze_encoder:
            for p in self.encoder.parameters():
                p.requires_grad_(False)

    # ---- pretrained warm-start ------------------------------------------------
    def _load_pretrained_encoder(self, path: str) -> None:
        ckpt = torch.load(path, map_location="cpu", weights_only=False)
        state = ckpt.get("state_dict", ckpt)
        enc = {k[len("encoder.") :]: v for k, v in state.items() if k.startswith("encoder.")}
        missing, unexpected = self.encoder.load_state_dict(enc, strict=False)
        print(
            f"[pretrained] loaded encoder from {path} | missing={len(missing)} unexpected={len(unexpected)}"
        )

    # ---- SSL masking ----------------------------------------------------------
    def _mlm_mask(self, b: int, t: int, device: torch.device) -> torch.Tensor:
        """Boolean [B, T] mask (~mask_ratio True), dilated into contiguous spans of ~mask_span."""
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

    def _mlm_loss(self, batch: dict[str, torch.Tensor]) -> torch.Tensor:
        x, pid, did = batch["x"], batch["placement"], batch["dataset"]
        b, t, _ = x.shape
        mask = self._mlm_mask(b, t, x.device)
        r = torch.rand(b, t, 1, device=x.device)
        m = mask.unsqueeze(-1)
        x_in = torch.where(m & (r < 0.8), torch.zeros_like(x), x)  # 80% -> mask token (mean=0)
        x_in = torch.where(m & (r >= 0.8) & (r < 0.9), torch.randn_like(x), x_in)  # 10% random
        h = self.encoder(x_in, pid, did)
        recon = self.head(h)
        return F.mse_loss(recon[mask], x[mask])

    # ---- classification -------------------------------------------------------
    def _cls_forward(self, batch: dict[str, torch.Tensor]) -> tuple[torch.Tensor, torch.Tensor]:
        h = self.encoder(batch["x"], batch["placement"], batch["dataset"])
        logits = self.head(LIMUBertEncoder.pool(h))
        return logits, batch["label"]

    # ---- Lightning steps ------------------------------------------------------
    def training_step(self, batch: dict[str, torch.Tensor], _: int) -> torch.Tensor:
        if self.hparams.task == "ssl":
            loss = self._mlm_loss(batch)
        else:
            logits, y = self._cls_forward(batch)
            loss = F.cross_entropy(logits, y)
        self.log("train/loss", loss, prog_bar=True, on_step=True, on_epoch=True)
        return loss

    def validation_step(self, batch: dict[str, torch.Tensor], _: int) -> None:
        if self.hparams.task == "ssl":
            self.log("val/loss", self._mlm_loss(batch), prog_bar=True, on_epoch=True)
            return
        logits, y = self._cls_forward(batch)
        self.val_acc(logits, y)
        self.val_f1(logits, y)
        self.log_dict(
            {
                "val/loss": F.cross_entropy(logits, y),
                "val/acc": self.val_acc,
                "val/macro_f1": self.val_f1,
            },
            prog_bar=True,
            on_step=False,
            on_epoch=True,
        )

    def test_step(self, batch: dict[str, torch.Tensor], _: int) -> None:
        if self.hparams.task == "ssl":
            self.log("test/loss", self._mlm_loss(batch), on_epoch=True)
            return
        logits, y = self._cls_forward(batch)
        self.test_acc(logits, y)
        self.test_f1(logits, y)
        self.log_dict(
            {"test/acc": self.test_acc, "test/macro_f1": self.test_f1},
            on_step=False,
            on_epoch=True,
        )

    # ---- optim ----------------------------------------------------------------
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
