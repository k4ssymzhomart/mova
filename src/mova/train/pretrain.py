"""SSL pretraining entrypoint for the Mova encoder.

Pretrains on the **non-clinical** corpus — HHAR + REALDISP **train** windows only — so the encoder
never sees a Daphnet/FoG subject (kept entirely for LOSO) nor any HAR test window. This makes both
downstream evaluations strictly leakage-free while still pretraining on ~600k real windows.

Saves a Lightning checkpoint whose ``encoder.*`` weights warm-start the FoG / HAR / quality heads.

Run (Apple-Silicon MPS):
    python -m mova.train.pretrain --processed-dir data/processed --max-steps 4000 \
        --out checkpoints/ssl_encoder.ckpt
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

import pytorch_lightning as pl
import torch
from torch.utils.data import DataLoader

from mova.ssl.module import MovaSSLModule
from mova.train.data import MovaWindowDataset, build_vocabs

logger = logging.getLogger("mova.pretrain")

PRETRAIN_DATASETS = ["hhar", "realdisp"]  # no Daphnet (LOSO target), no synthetic


def _device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _loader(processed_dir, vocabs, split, batch_size, num_workers, stats_path) -> DataLoader:
    ds = MovaWindowDataset(
        split=split, mode="ssl", processed_dir=processed_dir, stats_path=stats_path,
        vocabs=vocabs, include_datasets=PRETRAIN_DATASETS,
    )
    return DataLoader(
        ds, batch_size=batch_size, shuffle=(split == "train"), num_workers=num_workers,
        drop_last=(split == "train"), persistent_workers=num_workers > 0,
    )


def pretrain(
    processed_dir: Path, out: Path, *, hidden: int, n_layers: int, max_steps: int,
    batch_size: int, lr: float, num_workers: int, contrastive_weight: float, seed: int,
    limit_val_batches: int, stats_path: Path,
) -> dict:
    pl.seed_everything(seed, workers=True)
    vocabs = build_vocabs(processed_dir)
    train_dl = _loader(processed_dir, vocabs, "train", batch_size, num_workers, stats_path)
    val_dl = _loader(processed_dir, vocabs, "val", batch_size, num_workers, stats_path)
    logger.info("pretrain windows: train=%d val=%d (datasets=%s)",
                len(train_dl.dataset), len(val_dl.dataset), PRETRAIN_DATASETS)

    module = MovaSSLModule(
        encoder_cfg={"in_channels": 6, "max_len": 200, "hidden": hidden, "n_layers": n_layers},
        n_placements=vocabs.n_placements, n_datasets=vocabs.n_datasets,
        lr=lr, max_steps=max_steps, contrastive_weight=contrastive_weight,
    )
    logger.info("encoder params: %.2fM", module.encoder.num_parameters / 1e6)

    trainer = pl.Trainer(
        accelerator=_device(), devices=1, max_steps=max_steps,
        precision="32-true", logger=False, enable_checkpointing=False,
        gradient_clip_val=1.0, log_every_n_steps=50,
        limit_val_batches=limit_val_batches, val_check_interval=1.0,
        enable_progress_bar=False,
    )
    trainer.fit(module, train_dl, val_dl)

    out.parent.mkdir(parents=True, exist_ok=True)
    trainer.save_checkpoint(out)
    meta = {
        "checkpoint": str(out),
        "datasets": PRETRAIN_DATASETS,
        "train_windows": len(train_dl.dataset),
        "val_windows": len(val_dl.dataset),
        "encoder": {"hidden": hidden, "n_layers": n_layers,
                    "params_m": round(module.encoder.num_parameters / 1e6, 3)},
        "max_steps": max_steps, "batch_size": batch_size, "lr": lr,
        "contrastive_weight": contrastive_weight, "seed": seed,
        "n_placements": vocabs.n_placements, "n_datasets": vocabs.n_datasets,
        "objective": "masked smooth-L1 + NT-Xent contrastive",
        "leakage_note": "no Daphnet subjects, no HAR test windows -> FoG/HAR eval are clean",
    }
    out.with_suffix(".json").write_text(json.dumps(meta, indent=2))
    logger.info("saved encoder -> %s", out)
    return meta


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="SSL pretraining for the Mova encoder")
    p.add_argument("--processed-dir", type=Path, default=Path("data/processed"))
    p.add_argument("--stats-path", type=Path, default=Path("data_manifests/norm_stats/train_stats.json"))
    p.add_argument("--out", type=Path, default=Path("checkpoints/ssl_encoder.ckpt"))
    p.add_argument("--hidden", type=int, default=128)
    p.add_argument("--n-layers", type=int, default=3)
    p.add_argument("--max-steps", type=int, default=1500)
    p.add_argument("--batch-size", type=int, default=128)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--num-workers", type=int, default=0)
    p.add_argument("--contrastive-weight", type=float, default=1.0)
    p.add_argument("--limit-val-batches", type=int, default=20)
    p.add_argument("--seed", type=int, default=1337)
    p.add_argument("--log-level", default="INFO")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    pretrain(
        args.processed_dir, args.out, hidden=args.hidden, n_layers=args.n_layers,
        max_steps=args.max_steps, batch_size=args.batch_size, lr=args.lr,
        num_workers=args.num_workers, contrastive_weight=args.contrastive_weight,
        seed=args.seed, limit_val_batches=args.limit_val_batches, stats_path=args.stats_path,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
