"""Leave-One-Subject-Out cross-validation for freezing-of-gait — the headline evaluation.

The 0.55-AUROC baseline was a *single* held-out subject (S08): high variance, not an evaluation.
This harness does it the honest way (Master Doc Part 1.4.2/1.4.3):

  * **LOSO over the 8 freeze-positive Daphnet subjects.** S04 and S10 have zero freezes, so they can
    never be a test fold (sensitivity/AUROC are undefined) — they stay in every training set as extra
    negatives. Each of the 8 positive subjects is the test fold exactly once.
  * **Strictly subject-disjoint per fold:** test = held-out subject; val = one other positive subject
    (threshold tuning + reporting only); train = the remaining 8 subjects.
  * **Imbalance handled** with focal loss + a class-balanced sampler.
  * **Decision threshold tuned on the val subject**, never the test subject.
  * Optional **warm-start from the SSL encoder** (pretrained on HHAR+REALDISP — no Daphnet, so no
    leakage). Run with ``--pretrained-ckpt ''`` for the from-scratch ablation.

Reports per-fold metrics and the **mean ± std** across folds — AUROC, AUPRC, and
sensitivity@specificity at the tuned operating point.

Run:
    python -m mova.train.fog_loso --processed-dir data/processed \
        --pretrained-ckpt checkpoints/ssl_encoder.ckpt --out reports/fog_loso_ssl.json
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

import numpy as np
import polars as pl
import pytorch_lightning as pl_lightning
import torch
from torch.utils.data import DataLoader, WeightedRandomSampler

from mova.eval.clinical import collect_scores, fog_metrics, tune_threshold
from mova.train.data import MovaWindowDataset, build_vocabs
from mova.train.losses import inverse_frequency_weights
from mova.train.module import MovaLitModule

logger = logging.getLogger("mova.fog_loso")

DATASET = "daphnet_fog"


def _device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def freeze_positive_subjects(processed_dir: Path) -> list[str]:
    idx = pl.read_parquet(Path(processed_dir) / "index.parquet").filter(
        (pl.col("dataset") == DATASET) & (pl.col("task") == "fog")
    )
    pos = (
        idx.group_by("subject").agg((pl.col("fog") == 1).sum().alias("freeze"))
        .filter(pl.col("freeze") > 0).get_column("subject").to_list()
    )
    return sorted(pos)


def all_subjects(processed_dir: Path) -> list[str]:
    idx = pl.read_parquet(Path(processed_dir) / "index.parquet").filter(pl.col("dataset") == DATASET)
    return sorted(idx.get_column("subject").unique().to_list())


def _jitter(sigma: float):
    def t(x: np.ndarray) -> np.ndarray:
        return x + np.random.standard_normal(x.shape).astype(np.float32) * sigma
    return t


def _fog_dataset(processed_dir, vocabs, subjects, stats_path, transform=None):
    return MovaWindowDataset(
        split=None, mode="fog", processed_dir=processed_dir, stats_path=stats_path,
        vocabs=vocabs, include_datasets=[DATASET], subjects=subjects, transform=transform,
    )


def _loader(ds, batch_size, *, train: bool, num_workers: int, samples_per_epoch: int = 0) -> DataLoader:
    sampler = None
    shuffle = train
    if train and ds.labels() is not None:
        labels = ds.labels()
        counts = np.bincount(labels, minlength=2)
        weights = 1.0 / np.maximum(counts[labels], 1)
        n_samples = samples_per_epoch if samples_per_epoch > 0 else len(labels)
        sampler = WeightedRandomSampler(
            torch.as_tensor(weights, dtype=torch.double), num_samples=n_samples, replacement=True
        )
        shuffle = False
    return DataLoader(
        ds, batch_size=batch_size, shuffle=shuffle, sampler=sampler, num_workers=num_workers,
        drop_last=train, persistent_workers=num_workers > 0,
    )


def run_fold(
    processed_dir: Path, vocabs, test_subj: str, val_subj: str, train_subjs: list[str], *,
    pretrained_ckpt: str | None, hidden: int, n_layers: int, max_epochs: int, batch_size: int,
    lr: float, focal_gamma: float, min_specificity: float, num_workers: int, seed: int,
    stats_path: Path, samples_per_epoch: int = 12000,
) -> dict:
    pl_lightning.seed_everything(seed, workers=True)
    train_ds = _fog_dataset(processed_dir, vocabs, train_subjs, stats_path, transform=_jitter(0.05))
    val_ds = _fog_dataset(processed_dir, vocabs, [val_subj], stats_path)
    test_ds = _fog_dataset(processed_dir, vocabs, [test_subj], stats_path)

    cw = inverse_frequency_weights(train_ds.labels(), 2).tolist()
    train_dl = _loader(train_ds, batch_size, train=True, num_workers=num_workers,
                       samples_per_epoch=samples_per_epoch)
    steps_per_epoch = max(1, len(train_dl))

    module = MovaLitModule(
        encoder_cfg={"in_channels": 6, "max_len": 200, "hidden": hidden, "n_layers": n_layers},
        task="fog", num_classes=2, n_placements=vocabs.n_placements, n_datasets=vocabs.n_datasets,
        lr=lr, max_steps=steps_per_epoch * max_epochs, loss_type="focal", class_weights=cw,
        focal_gamma=focal_gamma, pretrained_ckpt=pretrained_ckpt or None,
    )
    trainer = pl_lightning.Trainer(
        accelerator=_device(), devices=1, max_epochs=max_epochs, precision="32-true",
        logger=False, enable_checkpointing=False, enable_progress_bar=False,
        gradient_clip_val=1.0, num_sanity_val_steps=0, enable_model_summary=False,
    )
    trainer.fit(module, train_dl)

    dev = _device()
    yv, sv = collect_scores(module, _loader(val_ds, batch_size, train=False, num_workers=0), dev)
    thr = tune_threshold(yv, sv, min_specificity=min_specificity)
    yt, st = collect_scores(module, _loader(test_ds, batch_size, train=False, num_workers=0), dev)

    m_tuned = fog_metrics(yt, (st >= thr).astype(int), st, threshold=thr)
    m_half = fog_metrics(yt, (st >= 0.5).astype(int), st, threshold=0.5)
    n_pos = int((yt == 1).sum())
    logger.info(
        "fold test=%s val=%s | n=%d pos=%d | AUROC=%.3f AUPRC=%.3f sens@thr=%.3f spec=%.3f thr=%.3f",
        test_subj, val_subj, len(yt), n_pos, m_tuned.auroc, m_tuned.auprc,
        m_tuned.sensitivity, m_tuned.specificity, thr,
    )
    return {
        "test_subject": test_subj, "val_subject": val_subj, "train_subjects": train_subjs,
        "n_test_windows": len(yt), "n_test_freeze": n_pos,
        "tuned": m_tuned.as_dict(), "at_0p5": m_half.as_dict(),
    }


def train_and_save_fog(
    processed_dir: Path, out_ckpt: Path, *, pretrained_ckpt: str | None, hidden: int, n_layers: int,
    max_epochs: int, batch_size: int, lr: float, focal_gamma: float, min_specificity: float,
    samples_per_epoch: int, seed: int, stats_path: Path,
) -> dict:
    """Train one deployable FoG model on all-but-one subject and save it (for ONNX / serving).

    The honest generalization estimate is the LOSO mean ± std; this single checkpoint just packages a
    model trained on (almost) all data for export. Threshold is tuned on the held-out val subject.
    """
    vocabs = build_vocabs(processed_dir)
    positives = freeze_positive_subjects(processed_dir)
    every = all_subjects(processed_dir)
    val_subj = positives[len(positives) // 2]
    train_subjs = [s for s in every if s != val_subj]
    pl_lightning.seed_everything(seed, workers=True)

    train_ds = _fog_dataset(processed_dir, vocabs, train_subjs, stats_path, transform=_jitter(0.05))
    val_ds = _fog_dataset(processed_dir, vocabs, [val_subj], stats_path)
    cw = inverse_frequency_weights(train_ds.labels(), 2).tolist()
    train_dl = _loader(train_ds, batch_size, train=True, num_workers=0, samples_per_epoch=samples_per_epoch)

    module = MovaLitModule(
        encoder_cfg={"in_channels": 6, "max_len": 200, "hidden": hidden, "n_layers": n_layers},
        task="fog", num_classes=2, n_placements=vocabs.n_placements, n_datasets=vocabs.n_datasets,
        lr=lr, max_steps=max(1, len(train_dl)) * max_epochs, loss_type="focal", class_weights=cw,
        focal_gamma=focal_gamma, pretrained_ckpt=pretrained_ckpt or None,
    )
    trainer = pl_lightning.Trainer(
        accelerator=_device(), devices=1, max_epochs=max_epochs, precision="32-true",
        logger=False, enable_checkpointing=False, enable_progress_bar=False,
        gradient_clip_val=1.0, num_sanity_val_steps=0, enable_model_summary=False,
    )
    trainer.fit(module, train_dl)
    yv, sv = collect_scores(module, _loader(val_ds, batch_size, train=False, num_workers=0), _device())
    thr = tune_threshold(yv, sv, min_specificity=min_specificity)
    out_ckpt.parent.mkdir(parents=True, exist_ok=True)
    trainer.save_checkpoint(out_ckpt)
    meta = {"checkpoint": str(out_ckpt), "val_subject": val_subj, "decision_threshold": thr,
            "train_subjects": train_subjs}
    out_ckpt.with_suffix(".json").write_text(json.dumps(meta, indent=2))
    logger.info("saved deployable FoG model -> %s (threshold=%.3f)", out_ckpt, thr)
    return meta


def _agg(folds: list[dict], key: str) -> dict:
    vals = np.array([f["tuned"][key] for f in folds], dtype=float)
    vals = vals[np.isfinite(vals)]
    return {"mean": float(vals.mean()), "std": float(vals.std()), "n": int(vals.size)}


def run_loso(
    processed_dir: Path, out: Path, *, pretrained_ckpt: str | None, hidden: int, n_layers: int,
    max_epochs: int, batch_size: int, lr: float, focal_gamma: float, min_specificity: float,
    num_workers: int, seed: int, stats_path: Path, samples_per_epoch: int = 12000,
    max_folds: int | None = None,
) -> dict:
    vocabs = build_vocabs(processed_dir)
    positives = freeze_positive_subjects(processed_dir)
    every = all_subjects(processed_dir)
    if max_folds:
        positives = positives[:max_folds]
    logger.info("LOSO over %d freeze-positive subjects: %s | all subjects: %s",
                len(positives), positives, every)

    folds: list[dict] = []
    for i, test_subj in enumerate(positives):
        val_subj = positives[(i + 1) % len(positives)]
        train_subjs = [s for s in every if s not in {test_subj, val_subj}]
        folds.append(run_fold(
            processed_dir, vocabs, test_subj, val_subj, train_subjs,
            pretrained_ckpt=pretrained_ckpt, hidden=hidden, n_layers=n_layers,
            max_epochs=max_epochs, batch_size=batch_size, lr=lr, focal_gamma=focal_gamma,
            min_specificity=min_specificity, num_workers=num_workers, seed=seed, stats_path=stats_path,
            samples_per_epoch=samples_per_epoch,
        ))

    summary = {key: _agg(folds, key) for key in
               ["auroc", "auprc", "sensitivity", "specificity", "balanced_accuracy", "macro_f1"]}
    result = {
        "task": "freezing_of_gait",
        "protocol": "LOSO-CV over freeze-positive Daphnet subjects",
        "warm_start": "ssl" if pretrained_ckpt else "from_scratch",
        "pretrained_ckpt": pretrained_ckpt or None,
        "baseline_auroc": 0.551,
        "n_folds": len(folds),
        "loss": f"focal(gamma={focal_gamma}) + class-balanced sampler",
        "threshold_policy": f"tuned on val subject, sensitivity@specificity>={min_specificity}",
        "encoder": {"hidden": hidden, "n_layers": n_layers},
        "summary_tuned": summary,
        "auroc_mean": summary["auroc"]["mean"],
        "beats_baseline": bool(summary["auroc"]["mean"] > 0.551),
        "folds": folds,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2))
    logger.info(
        "LOSO done (%s): AUROC %.3f ± %.3f | AUPRC %.3f ± %.3f | sens %.3f | spec %.3f | beats 0.55: %s",
        result["warm_start"], summary["auroc"]["mean"], summary["auroc"]["std"],
        summary["auprc"]["mean"], summary["auprc"]["std"], summary["sensitivity"]["mean"],
        summary["specificity"]["mean"], result["beats_baseline"],
    )
    return result


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="FoG LOSO-CV evaluation")
    p.add_argument("--processed-dir", type=Path, default=Path("data/processed"))
    p.add_argument("--stats-path", type=Path, default=Path("data_manifests/norm_stats/train_stats.json"))
    p.add_argument("--pretrained-ckpt", default="checkpoints/ssl_encoder.ckpt",
                   help="encoder warm-start; pass '' for from-scratch")
    p.add_argument("--out", type=Path, default=Path("reports/fog_loso_ssl.json"))
    p.add_argument("--hidden", type=int, default=128)
    p.add_argument("--n-layers", type=int, default=3)
    p.add_argument("--max-epochs", type=int, default=6)
    p.add_argument("--batch-size", type=int, default=128)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--focal-gamma", type=float, default=2.0)
    p.add_argument("--min-specificity", type=float, default=0.85)
    p.add_argument("--samples-per-epoch", type=int, default=12000)
    p.add_argument("--num-workers", type=int, default=0)
    p.add_argument("--seed", type=int, default=1337)
    p.add_argument("--max-folds", type=int, default=None)
    p.add_argument("--log-level", default="INFO")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    run_loso(
        args.processed_dir, args.out, pretrained_ckpt=args.pretrained_ckpt or None,
        hidden=args.hidden, n_layers=args.n_layers, max_epochs=args.max_epochs,
        batch_size=args.batch_size, lr=args.lr, focal_gamma=args.focal_gamma,
        min_specificity=args.min_specificity, num_workers=args.num_workers, seed=args.seed,
        stats_path=args.stats_path, max_folds=args.max_folds,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
