"""Train + clinically evaluate the freezing-of-gait model locally (Apple Silicon MPS / CPU).

Prints the metrics a clinician cares about — sensitivity, specificity, AUROC, balanced accuracy,
macro-F1 — on the subject-disjoint held-out test set. Mirrors notebooks/train_local.ipynb.

    PYTORCH_ENABLE_MPS_FALLBACK=1 .venv312/bin/python scripts/fog_local_demo.py --epochs 12
"""

from __future__ import annotations

import argparse
import os

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import pytorch_lightning as pl  # noqa: E402
import torch  # noqa: E402

from mova.eval.clinical import collect_predictions, fog_metrics  # noqa: E402
from mova.train.data import make_dataloaders  # noqa: E402
from mova.train.module import MovaLitModule  # noqa: E402

ENCODER_CFG = {
    "in_channels": 6,
    "max_len": 200,
    "hidden": 192,
    "n_layers": 4,
    "n_heads": 6,
    "ff_mult": 4,
    "dropout": 0.1,
    "use_conditioning": True,
}


def main() -> int:
    ap = argparse.ArgumentParser(description="Local FoG train + clinical eval")
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--batch-size", type=int, default=128)
    args = ap.parse_args()

    pl.seed_everything(1337, workers=True)
    device = (
        "mps"
        if torch.backends.mps.is_available()
        else ("cuda" if torch.cuda.is_available() else "cpu")
    )
    print(f"device: {device} | torch {torch.__version__}")

    loaders, vocabs = make_dataloaders(mode="fog", batch_size=args.batch_size, num_workers=0, pin_memory=False)
    model = MovaLitModule(
        encoder_cfg=ENCODER_CFG,
        task="fog",
        num_classes=2,
        n_placements=vocabs.n_placements,
        n_datasets=vocabs.n_datasets,
        lr=3e-4,
        weight_decay=0.05,
        warmup_ratio=0.1,
        max_steps=len(loaders["train"]) * args.epochs,
    )
    trainer = pl.Trainer(
        accelerator="auto",
        devices=1,
        precision="32-true",
        max_epochs=args.epochs,
        gradient_clip_val=1.0,
        logger=False,
        enable_checkpointing=False,
        enable_progress_bar=True,
        log_every_n_steps=20,
    )
    trainer.fit(model, loaders["train"], loaders["val"])

    y_true, y_pred, y_score = collect_predictions(model, loaders["test"], device)
    metrics = fog_metrics(y_true, y_pred, y_score)
    print("\n=============== FoG · held-out test (subject-disjoint) ===============")
    for key, value in metrics.as_dict().items():
        line = f"  {key:>18}: {value:.4f}" if isinstance(value, float) else f"  {key:>18}: {value}"
        print(line)
    print("=====================================================================")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
