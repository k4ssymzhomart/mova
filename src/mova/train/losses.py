"""Loss functions for Mova: contrastive (NT-Xent) for SSL and imbalance-aware losses for FoG.

The freezing-of-gait task is severely imbalanced (~9.5% positive windows), and plain
cross-entropy at threshold 0.5 is exactly what crippled the 0.55-AUROC baseline (it learned to
predict "no freeze"). ``focal_loss`` and ``class_weighted_ce`` down-weight the easy negative
majority so gradient signal reaches the rare freeze class.
"""

from __future__ import annotations

import torch
import torch.nn.functional as F


def nt_xent(z1: torch.Tensor, z2: torch.Tensor, temperature: float = 0.2) -> torch.Tensor:
    """Normalized temperature-scaled cross-entropy (SimCLR) over a batch of positive pairs.

    ``z1[i]`` and ``z2[i]`` are two augmented views of window ``i``; every other window in the
    batch (both views) is a negative. Returns the symmetric InfoNCE loss.
    """
    b = z1.shape[0]
    z1 = F.normalize(z1, dim=1)
    z2 = F.normalize(z2, dim=1)
    z = torch.cat([z1, z2], dim=0)  # [2B, d]
    sim = (z @ z.t()) / temperature  # [2B, 2B]
    self_mask = torch.eye(2 * b, dtype=torch.bool, device=z.device)
    sim.masked_fill_(self_mask, float("-inf"))
    # positive of row i is its counterpart view: i <-> i+B
    targets = torch.cat([torch.arange(b, 2 * b), torch.arange(0, b)]).to(z.device)
    return F.cross_entropy(sim, targets)


def focal_loss(
    logits: torch.Tensor,
    target: torch.Tensor,
    gamma: float = 2.0,
    alpha: torch.Tensor | None = None,
    reduction: str = "mean",
) -> torch.Tensor:
    """Multi-class focal loss (Lin et al. 2017). ``alpha`` is an optional per-class weight vector."""
    log_p = F.log_softmax(logits, dim=1)
    p = log_p.exp()
    log_pt = log_p.gather(1, target.unsqueeze(1)).squeeze(1)
    pt = p.gather(1, target.unsqueeze(1)).squeeze(1)
    loss = -((1.0 - pt) ** gamma) * log_pt
    if alpha is not None:
        loss = loss * alpha.to(logits.device)[target]
    if reduction == "mean":
        return loss.mean()
    if reduction == "sum":
        return loss.sum()
    return loss


def class_weighted_ce(
    logits: torch.Tensor, target: torch.Tensor, weight: torch.Tensor | None = None
) -> torch.Tensor:
    return F.cross_entropy(logits, target, weight=weight.to(logits.device) if weight is not None else None)


def inverse_frequency_weights(labels: torch.Tensor | list[int], num_classes: int) -> torch.Tensor:
    """Per-class weights ∝ 1/frequency, normalized to mean 1 (for weighted CE / focal alpha)."""
    counts = torch.bincount(torch.as_tensor(labels, dtype=torch.long), minlength=num_classes).float()
    counts = counts.clamp_min(1.0)
    w = counts.sum() / (num_classes * counts)
    return w / w.mean()
