"""LIMU-BERT-style Transformer encoder for Mova IMU windows.

Ingests standardized windows of shape ``[B, T=200, C=6]`` (acc xyz + gyro xyz @ 50 Hz) and produces
per-timestep hidden states plus a pooled representation. Each timestep is projected to a token
(LIMU-BERT style, no patch merging) with a learned positional embedding; optional placement/dataset
conditioning embeddings (a Mova extension for cross-position / cross-device robustness) are added to every
token.

Heads included for downstream stages:
  * ``ReconstructionHead`` -> masked-IMU pretraining (Issue 1.4).
  * ``ClassifierHead``     -> HAR / FoG fine-tuning (Issues 1.5 / 1.6).

Pure PyTorch (no Lightning) so the same module is reused by training, ONNX export, and serving.
"""

from __future__ import annotations

from dataclasses import dataclass

import torch
from torch import nn


@dataclass
class EncoderConfig:
    in_channels: int = 6
    max_len: int = 200
    hidden: int = 256
    n_layers: int = 6
    n_heads: int = 8
    ff_mult: int = 4
    dropout: float = 0.1
    n_placements: int = 32
    n_datasets: int = 8
    use_conditioning: bool = True


class LIMUBertEncoder(nn.Module):
    """Per-timestep Transformer encoder over IMU windows."""

    def __init__(self, cfg: EncoderConfig) -> None:
        super().__init__()
        self.cfg = cfg
        self.input_proj = nn.Linear(cfg.in_channels, cfg.hidden)
        self.pos_emb = nn.Parameter(torch.zeros(1, cfg.max_len, cfg.hidden))
        nn.init.trunc_normal_(self.pos_emb, std=0.02)
        if cfg.use_conditioning:
            self.placement_emb = nn.Embedding(cfg.n_placements, cfg.hidden)
            self.dataset_emb = nn.Embedding(cfg.n_datasets, cfg.hidden)
        self.input_norm = nn.LayerNorm(cfg.hidden)
        self.dropout = nn.Dropout(cfg.dropout)
        layer = nn.TransformerEncoderLayer(
            d_model=cfg.hidden,
            nhead=cfg.n_heads,
            dim_feedforward=cfg.hidden * cfg.ff_mult,
            dropout=cfg.dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(layer, num_layers=cfg.n_layers)
        self.out_norm = nn.LayerNorm(cfg.hidden)
        self.apply(self._init_weights)

    @staticmethod
    def _init_weights(m: nn.Module) -> None:
        if isinstance(m, nn.Linear):
            nn.init.trunc_normal_(m.weight, std=0.02)
            if m.bias is not None:
                nn.init.zeros_(m.bias)
        elif isinstance(m, nn.Embedding):
            nn.init.trunc_normal_(m.weight, std=0.02)

    def forward(
        self,
        x: torch.Tensor,
        placement_id: torch.Tensor | None = None,
        dataset_id: torch.Tensor | None = None,
        key_padding_mask: torch.Tensor | None = None,
    ) -> torch.Tensor:
        """x: ``[B, T, C]`` -> hidden states ``[B, T, hidden]``."""
        t = x.shape[1]
        h = self.input_proj(x) + self.pos_emb[:, :t]
        if self.cfg.use_conditioning:
            if placement_id is not None:
                h = h + self.placement_emb(placement_id).unsqueeze(1)
            if dataset_id is not None:
                h = h + self.dataset_emb(dataset_id).unsqueeze(1)
        h = self.dropout(self.input_norm(h))
        h = self.encoder(h, src_key_padding_mask=key_padding_mask)
        return self.out_norm(h)

    @staticmethod
    def pool(h: torch.Tensor, key_padding_mask: torch.Tensor | None = None) -> torch.Tensor:
        """Mean-pool over time (mask-aware if a padding mask is given) -> ``[B, hidden]``."""
        if key_padding_mask is None:
            return h.mean(dim=1)
        keep = (~key_padding_mask).float().unsqueeze(-1)
        return (h * keep).sum(dim=1) / keep.sum(dim=1).clamp_min(1.0)

    @property
    def num_parameters(self) -> int:
        return sum(p.numel() for p in self.parameters())


class ReconstructionHead(nn.Module):
    """Predicts raw channels per timestep for masked-IMU self-supervised pretraining."""

    def __init__(self, hidden: int, out_channels: int) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(hidden, hidden),
            nn.GELU(),
            nn.LayerNorm(hidden),
            nn.Linear(hidden, out_channels),
        )

    def forward(self, h: torch.Tensor) -> torch.Tensor:
        return self.net(h)


class ClassifierHead(nn.Module):
    """Pooled-representation classifier for HAR / FoG fine-tuning."""

    def __init__(self, hidden: int, num_classes: int, dropout: float = 0.1) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.LayerNorm(hidden),
            nn.Dropout(dropout),
            nn.Linear(hidden, num_classes),
        )

    def forward(self, pooled: torch.Tensor) -> torch.Tensor:
        return self.net(pooled)


if __name__ == "__main__":
    cfg = EncoderConfig()
    enc = LIMUBertEncoder(cfg)
    dummy = torch.randn(4, cfg.max_len, cfg.in_channels)
    pid = torch.zeros(4, dtype=torch.long)
    did = torch.zeros(4, dtype=torch.long)
    out = enc(dummy, pid, did)
    print(f"params={enc.num_parameters / 1e6:.2f}M  hidden_states={tuple(out.shape)}")
    print(f"recon={tuple(ReconstructionHead(cfg.hidden, cfg.in_channels)(out).shape)}")
    print(f"logits={tuple(ClassifierHead(cfg.hidden, 37)(enc.pool(out)).shape)}")
