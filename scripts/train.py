"""Mova training entrypoint — Hydra + PyTorch Lightning + Weights & Biases.

Run on the GPU cluster (Python 3.12 + CUDA), from the repo root:
    python scripts/train.py task=ssl
    python scripts/train.py task=har finetune.pretrained_ckpt=checkpoints/last.ckpt
    python scripts/train.py task=fog trainer.max_epochs=30 wandb.mode=offline

Reads configs/train.yaml (composing model/ and trainer/ groups), builds the dataloaders + Lightning
module, logs to W&B, and launches the Trainer. Checkpoints land in ./checkpoints, W&B run files in ./outputs.
"""

from __future__ import annotations

import hydra
import pytorch_lightning as pl
import torch
from omegaconf import DictConfig, OmegaConf
from pytorch_lightning.callbacks import LearningRateMonitor, ModelCheckpoint
from pytorch_lightning.loggers import WandbLogger

from mova.train.data import make_dataloaders
from mova.train.module import MovaLitModule


@hydra.main(version_base=None, config_path="../configs", config_name="train")
def main(cfg: DictConfig) -> None:
    pl.seed_everything(cfg.seed, workers=True)
    torch.set_float32_matmul_precision("high")
    print(OmegaConf.to_yaml(cfg))

    loaders, vocabs = make_dataloaders(
        mode=cfg.task,
        batch_size=cfg.batch_size,
        num_workers=cfg.num_workers,
        processed_dir=cfg.processed_dir,
        normalize=cfg.normalize,
    )
    num_classes = {"har": len(vocabs.har_label), "fog": 2}.get(cfg.task)
    steps_per_epoch = max(1, len(loaders["train"]))
    max_steps = (
        steps_per_epoch * cfg.trainer.max_epochs // max(1, cfg.trainer.accumulate_grad_batches)
    )

    model = MovaLitModule(
        encoder_cfg=OmegaConf.to_container(cfg.model, resolve=True),
        task=cfg.task,
        num_classes=num_classes,
        n_placements=vocabs.n_placements,
        n_datasets=vocabs.n_datasets,
        lr=cfg.optim.lr,
        weight_decay=cfg.optim.weight_decay,
        warmup_ratio=cfg.optim.warmup_ratio,
        max_steps=max_steps,
        mask_ratio=cfg.ssl.mask_ratio,
        mask_span=cfg.ssl.mask_span,
        pretrained_ckpt=cfg.finetune.pretrained_ckpt,
        freeze_encoder=cfg.finetune.freeze_encoder,
    )

    monitor, mode = ("val/loss", "min") if cfg.task == "ssl" else ("val/macro_f1", "max")
    callbacks = [
        ModelCheckpoint(
            dirpath="checkpoints",
            filename=f"mova-{cfg.task}-{{epoch:02d}}",
            monitor=monitor,
            mode=mode,
            save_top_k=2,
            save_last=True,
        ),
        LearningRateMonitor(logging_interval="step"),
    ]
    logger: WandbLogger | bool = (
        False
        if cfg.wandb.mode == "disabled"
        else WandbLogger(
            project=cfg.wandb.project,
            entity=cfg.wandb.entity,
            name=cfg.wandb.run_name,
            offline=cfg.wandb.mode == "offline",
            save_dir="outputs",
        )
    )

    trainer = pl.Trainer(
        accelerator=cfg.trainer.accelerator,
        devices=cfg.trainer.devices,
        precision=cfg.trainer.precision,
        max_epochs=cfg.trainer.max_epochs,
        gradient_clip_val=cfg.trainer.gradient_clip_val,
        accumulate_grad_batches=cfg.trainer.accumulate_grad_batches,
        log_every_n_steps=cfg.trainer.log_every_n_steps,
        deterministic=cfg.trainer.deterministic,
        logger=logger,
        callbacks=callbacks,
    )
    trainer.fit(model, loaders["train"], loaders["val"])
    if cfg.task != "ssl":
        trainer.test(model, loaders["test"], ckpt_path="best")


if __name__ == "__main__":
    main()
