"""HAR fine-tuning + cross-device / cross-position generalization report.

Trains the activity head (warm-started from the SSL encoder) on the subject-disjoint HAR train
split and reports macro-F1 on the held-out test split — overall and **broken down by dataset
(HHAR vs REALDISP) and by sensor placement**. The per-group spread is the honest, available view of
the generalization axes the thesis is about (cross-device, cross-position). Subjects are disjoint;
a full leave-placement-out / leave-device-out protocol is future work and is labelled as such.

Run:
    python -m mova.train.har --processed-dir data/processed \
        --pretrained-ckpt checkpoints/ssl_encoder.ckpt --out reports/har.json
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

import numpy as np
import pytorch_lightning as pl_lightning
import torch
from sklearn.metrics import f1_score
from torch.utils.data import DataLoader, RandomSampler

from mova.train.data import MovaWindowDataset, build_vocabs
from mova.train.module import MovaLitModule

logger = logging.getLogger("mova.har")


def _device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


@torch.no_grad()
def _predict(module, loader, device) -> np.ndarray:
    module.eval().to(device)
    preds = []
    for batch in loader:
        h = module.encoder(batch["x"].to(device), batch["placement"].to(device), batch["dataset"].to(device))
        preds.append(module.head(module.encoder.pool(h)).argmax(1).cpu().numpy())
    return np.concatenate(preds)


def _group_f1(y_true, y_pred, groups: np.ndarray) -> dict[str, dict]:
    out = {}
    for g in sorted(set(groups.tolist())):
        m = groups == g
        out[str(g)] = {
            "n": int(m.sum()),
            "macro_f1": float(f1_score(y_true[m], y_pred[m], average="macro", zero_division=0)),
        }
    return out


def run_har(
    processed_dir: Path, out: Path, *, pretrained_ckpt: str | None, hidden: int, n_layers: int,
    max_epochs: int, batch_size: int, lr: float, samples_per_epoch: int, num_workers: int,
    seed: int, stats_path: Path, save_ckpt: Path | None = None,
) -> dict:
    pl_lightning.seed_everything(seed, workers=True)
    vocabs = build_vocabs(processed_dir)
    n_classes = len(vocabs.har_label)

    train_ds = MovaWindowDataset("train", "har", processed_dir, stats_path, vocabs)
    test_ds = MovaWindowDataset("test", "har", processed_dir, stats_path, vocabs)
    sampler = RandomSampler(train_ds, replacement=True, num_samples=min(samples_per_epoch, len(train_ds)))
    train_dl = DataLoader(train_ds, batch_size=batch_size, sampler=sampler, num_workers=num_workers, drop_last=True)
    test_dl = DataLoader(test_ds, batch_size=batch_size, shuffle=False, num_workers=num_workers)

    module = MovaLitModule(
        encoder_cfg={"in_channels": 6, "max_len": 200, "hidden": hidden, "n_layers": n_layers},
        task="har", num_classes=n_classes, n_placements=vocabs.n_placements,
        n_datasets=vocabs.n_datasets, lr=lr, max_steps=len(train_dl) * max_epochs,
        pretrained_ckpt=pretrained_ckpt or None,
    )
    trainer = pl_lightning.Trainer(
        accelerator=_device(), devices=1, max_epochs=max_epochs, precision="32-true",
        logger=False, enable_checkpointing=False, enable_progress_bar=False,
        gradient_clip_val=1.0, num_sanity_val_steps=0, enable_model_summary=False,
    )
    trainer.fit(module, train_dl)
    if save_ckpt is not None:
        save_ckpt.parent.mkdir(parents=True, exist_ok=True)
        trainer.save_checkpoint(save_ckpt)
        logger.info("saved HAR model -> %s", save_ckpt)

    y_true = test_ds.labels()
    y_pred = _predict(module, test_dl, _device())
    overall = float(f1_score(y_true, y_pred, average="macro", zero_division=0))
    datasets = test_ds.index.get_column("dataset").to_numpy()
    placements = test_ds.index.get_column("placement").to_numpy()
    by_dataset = _group_f1(y_true, y_pred, datasets)
    by_placement = _group_f1(y_true, y_pred, placements)

    spread = [v["macro_f1"] for v in by_placement.values()]
    result = {
        "task": "human_activity_recognition",
        "warm_start": "ssl" if pretrained_ckpt else "from_scratch",
        "n_classes": n_classes,
        "n_train_windows": len(train_ds), "n_test_windows": len(test_ds),
        "macro_f1_overall": overall,
        "target_in_distribution": 0.90,
        "by_dataset": by_dataset,
        "by_placement": by_placement,
        "generalization": {
            "placement_macro_f1_min": float(min(spread)),
            "placement_macro_f1_max": float(max(spread)),
            "placement_drop_max_minus_min": float(max(spread) - min(spread)),
            "note": "subjects disjoint; placements/devices seen in training. "
                    "Leave-placement-out / leave-device-out is future work.",
        },
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2))
    logger.info("HAR macro-F1 overall=%.3f | by-dataset=%s | placement spread=%.3f",
                overall, {k: round(v["macro_f1"], 3) for k, v in by_dataset.items()},
                result["generalization"]["placement_drop_max_minus_min"])
    return result


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="HAR fine-tune + generalization report")
    p.add_argument("--processed-dir", type=Path, default=Path("data/processed"))
    p.add_argument("--stats-path", type=Path, default=Path("data_manifests/norm_stats/train_stats.json"))
    p.add_argument("--pretrained-ckpt", default="checkpoints/ssl_encoder.ckpt")
    p.add_argument("--out", type=Path, default=Path("reports/har.json"))
    p.add_argument("--hidden", type=int, default=128)
    p.add_argument("--n-layers", type=int, default=3)
    p.add_argument("--max-epochs", type=int, default=3)
    p.add_argument("--batch-size", type=int, default=128)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--samples-per-epoch", type=int, default=30000)
    p.add_argument("--num-workers", type=int, default=0)
    p.add_argument("--save-ckpt", type=Path, default=None)
    p.add_argument("--seed", type=int, default=1337)
    p.add_argument("--log-level", default="INFO")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    run_har(
        args.processed_dir, args.out, pretrained_ckpt=args.pretrained_ckpt or None,
        hidden=args.hidden, n_layers=args.n_layers, max_epochs=args.max_epochs,
        batch_size=args.batch_size, lr=args.lr, samples_per_epoch=args.samples_per_epoch,
        num_workers=args.num_workers, seed=args.seed, stats_path=args.stats_path,
        save_ckpt=args.save_ckpt,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
