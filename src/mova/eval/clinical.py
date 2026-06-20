"""Clinical evaluation for the freezing-of-gait classifier.

Computes the metrics a clinician actually cares about — sensitivity, specificity, AUROC, balanced
accuracy, macro-F1 — from held-out predictions, plus a helper to run a trained module over a loader.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import torch
from sklearn.metrics import (
    balanced_accuracy_score,
    confusion_matrix,
    f1_score,
    roc_auc_score,
)
from torch.utils.data import DataLoader


@dataclass
class FogMetrics:
    accuracy: float
    balanced_accuracy: float
    macro_f1: float
    sensitivity: float  # recall of the freeze class (positive = 1)
    specificity: float
    precision: float
    auroc: float
    tn: int
    fp: int
    fn: int
    tp: int

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def fog_metrics(
    y_true: np.ndarray, y_pred: np.ndarray, y_score: np.ndarray | None = None
) -> FogMetrics:
    """Binary FoG metrics (positive class = freeze = 1)."""
    y_true = np.asarray(y_true).astype(int)
    y_pred = np.asarray(y_pred).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()
    sensitivity = tp / (tp + fn) if (tp + fn) else 0.0
    specificity = tn / (tn + fp) if (tn + fp) else 0.0
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    accuracy = (tp + tn) / max(1, tp + tn + fp + fn)
    auroc = float("nan")
    if y_score is not None and len(np.unique(y_true)) > 1:
        auroc = float(roc_auc_score(y_true, y_score))
    return FogMetrics(
        accuracy=float(accuracy),
        balanced_accuracy=float(balanced_accuracy_score(y_true, y_pred)),
        macro_f1=float(f1_score(y_true, y_pred, average="macro")),
        sensitivity=float(sensitivity),
        specificity=float(specificity),
        precision=float(precision),
        auroc=auroc,
        tn=int(tn),
        fp=int(fp),
        fn=int(fn),
        tp=int(tp),
    )


@torch.no_grad()
def collect_predictions(
    module: torch.nn.Module, loader: DataLoader, device: str
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Run a trained MovaLitModule over a loader -> (y_true, y_pred, positive_score)."""
    module.eval().to(device)
    y_true: list[np.ndarray] = []
    y_pred: list[np.ndarray] = []
    y_score: list[np.ndarray] = []
    for batch in loader:
        x = batch["x"].to(device)
        pid = batch["placement"].to(device)
        did = batch["dataset"].to(device)
        h = module.encoder(x, pid, did)
        logits = module.head(module.encoder.pool(h))
        prob = torch.softmax(logits, dim=1)[:, 1]
        y_true.append(batch["label"].numpy())
        y_pred.append(logits.argmax(dim=1).cpu().numpy())
        y_score.append(prob.cpu().numpy())
    return np.concatenate(y_true), np.concatenate(y_pred), np.concatenate(y_score)
