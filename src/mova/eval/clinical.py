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
    average_precision_score,
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
    auprc: float
    threshold: float
    tn: int
    fp: int
    fn: int
    tp: int

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def fog_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    y_score: np.ndarray | None = None,
    threshold: float = 0.5,
) -> FogMetrics:
    """Binary FoG metrics (positive class = freeze = 1). ``threshold`` is recorded, not applied."""
    y_true = np.asarray(y_true).astype(int)
    y_pred = np.asarray(y_pred).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()
    sensitivity = tp / (tp + fn) if (tp + fn) else 0.0
    specificity = tn / (tn + fp) if (tn + fp) else 0.0
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    accuracy = (tp + tn) / max(1, tp + tn + fp + fn)
    auroc = auprc = float("nan")
    if y_score is not None and len(np.unique(y_true)) > 1:
        auroc = float(roc_auc_score(y_true, y_score))
        auprc = float(average_precision_score(y_true, y_score))
    return FogMetrics(
        accuracy=float(accuracy),
        balanced_accuracy=float(balanced_accuracy_score(y_true, y_pred)),
        macro_f1=float(f1_score(y_true, y_pred, average="macro")),
        sensitivity=float(sensitivity),
        specificity=float(specificity),
        precision=float(precision),
        auroc=auroc,
        auprc=auprc,
        threshold=float(threshold),
        tn=int(tn),
        fp=int(fp),
        fn=int(fn),
        tp=int(tp),
    )


def tune_threshold(
    y_true: np.ndarray,
    y_score: np.ndarray,
    min_specificity: float = 0.85,
    objective: str = "sensitivity_at_specificity",
) -> float:
    """Pick a decision threshold on a held-out *validation* subject — never the test subject.

    ``sensitivity_at_specificity``: highest sensitivity subject to specificity >= min_specificity
    (the clinical operating point from the Master Doc target). Falls back to Youden's J if the
    constraint is infeasible. ``youden`` maximizes sensitivity+specificity-1 outright.
    """
    y_true = np.asarray(y_true).astype(int)
    y_score = np.asarray(y_score, dtype=float)
    if len(np.unique(y_true)) < 2:
        return 0.5
    cands = np.unique(np.concatenate([[0.0, 1.0], y_score]))
    best_thr, best_key = 0.5, -np.inf
    for thr in cands:
        pred = (y_score >= thr).astype(int)
        tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
        sens = tp / (tp + fn) if (tp + fn) else 0.0
        spec = tn / (tn + fp) if (tn + fp) else 0.0
        if objective == "sensitivity_at_specificity":
            key = sens if spec >= min_specificity else -1.0 + spec  # prefer feasible; else closest
        else:  # youden
            key = sens + spec - 1.0
        if key > best_key:
            best_key, best_thr = key, float(thr)
    return best_thr


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


@torch.no_grad()
def collect_scores(
    module: torch.nn.Module, loader: DataLoader, device: str
) -> tuple[np.ndarray, np.ndarray]:
    """Run a trained module over a loader -> (y_true, positive_score) for threshold-free scoring."""
    y_true, _y_pred, y_score = collect_predictions(module, loader, device)
    return y_true, y_score
