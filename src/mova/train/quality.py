"""Movement-quality head — a synthetic-IMU proxy demonstrator (real rehab data pending).

The clinical movement-quality task needs clinician-scored rehab data (KIMORE / UI-PRMD), which we
have **not** obtained yet. To still build and validate the head, we use AMASS as a *paired* source:
SMPL forward kinematics gives both

  * the **input** — a virtual-IMU window at a limb placement, and
  * the **target** — the exact pose-derived **smoothness** (log dimensionless jerk) of that limb over
    the window (a standard, clinically-meaningful movement-quality surrogate).

We then train ``encoder + RegressionHead`` to predict smoothness from the IMU window alone and report
Pearson r on **held-out HDM05 actors** (subject-disjoint). This is honestly a *synthetic proxy*: it
proves the head + pipeline work and that sparse IMU carries the smoothness signal; the real cTS/PO
clinician-score evaluation is future work, gated on KIMORE/UI-PRMD access.

Run:
    python -m mova.train.quality --amass-dir data/raw/amass \
        --pretrained-ckpt checkpoints/ssl_encoder.ckpt --out reports/movement_quality.json
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

import numpy as np
import torch
from scipy.stats import pearsonr
from torch import nn

from mova.models.encoder import EncoderConfig, LIMUBertEncoder, RegressionHead
from mova.pose.features import log_dimensionless_jerk
from mova.synth.amass import PLACEMENT_JOINTS, load_amass_npz, synth_virtual_imu
from mova.synth.smpl import SmplSkeleton
from mova.train.data import load_norm_stats

logger = logging.getLogger("mova.quality")
WIN = 200
PLACEMENT = "l_wrist"


def _device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    return "cuda" if torch.cuda.is_available() else "cpu"


def _amass_subject(rel: Path) -> str:
    parts = rel.parts
    return f"{parts[0]}_{parts[-2]}" if len(parts) >= 3 else (parts[0] if len(parts) == 2 else "amass")


def build_windows(amass_dir: Path, max_files: int, stride: int, mean, std):
    """-> (X[N,WIN,6] normalized, y[N] smoothness, subjects[N])."""
    skel = SmplSkeleton.mock()
    joint = PLACEMENT_JOINTS[PLACEMENT]
    # Round-robin across performers so the sample spans all actors (a flat sort would take only
    # the alphabetically-first actor's files and collapse the subject-disjoint split).
    by_subj: dict[str, list[Path]] = {}
    for p in sorted(amass_dir.rglob("*.npz")):
        by_subj.setdefault(_amass_subject(p.relative_to(amass_dir)), []).append(p)
    files: list[Path] = []
    depth = 0
    while len(files) < max_files and any(depth < len(v) for v in by_subj.values()):
        for v in by_subj.values():
            if depth < len(v) and len(files) < max_files:
                files.append(v[depth])
        depth += 1
    X, y, subj = [], [], []
    for path in files:
        d = load_amass_npz(str(path))
        if d["poses"].shape[0] < WIN + 1:
            continue
        s = _amass_subject(path.relative_to(amass_dir))
        df = synth_virtual_imu(d["poses"], d["trans"], d["framerate"],
                               subject_id=s, session_id=path.stem, skeleton=skel)
        df = df.filter(df["placement"] == PLACEMENT)
        sig = df.select(["ax", "ay", "az", "gx", "gy", "gz"]).to_numpy().astype(np.float32)
        _, pos = skel.forward_kinematics(d["poses"], d["trans"])  # [T,22,3]
        dt = 1.0 / float(d["framerate"])
        n = min(sig.shape[0], pos.shape[0])
        for st in range(0, n - WIN, stride):
            w = sig[st:st + WIN]
            ldlj = log_dimensionless_jerk(pos[st:st + WIN, joint], dt)
            if not np.isfinite(ldlj):
                continue
            X.append((w - mean) / std)
            y.append(ldlj)
            subj.append(s)
    return np.asarray(X, np.float32), np.asarray(y, np.float32), np.asarray(subj)


def run_quality(
    amass_dir: Path, out: Path, *, pretrained_ckpt: str | None, hidden: int, n_layers: int,
    max_files: int, stride: int, steps: int, batch_size: int, lr: float, seed: int, stats_path: Path,
) -> dict:
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    mean, std = load_norm_stats(stats_path)
    X, y, subj = build_windows(amass_dir, max_files, stride, mean, std)
    if len(X) < 50:
        raise RuntimeError(f"too few windows ({len(X)}) — check AMASS dir {amass_dir}")

    subjects = sorted(set(subj.tolist()))
    test_subj = subjects[-1]  # leave the last actor out (subject-disjoint)
    tr = subj != test_subj
    te = subj == test_subj
    # standardize the regression target on TRAIN only (no leakage).
    y_mu, y_sd = float(y[tr].mean()), float(y[tr].std() + 1e-6)
    dev = _device()

    # Match the conditioning-embedding sizes to the SSL checkpoint so warm-start fits exactly.
    n_placements, n_datasets = 32, 8
    enc_state = None
    if pretrained_ckpt:
        ckpt = torch.load(pretrained_ckpt, map_location="cpu", weights_only=False)
        state = ckpt.get("state_dict", ckpt)
        enc_state = {k[len("encoder."):]: v for k, v in state.items() if k.startswith("encoder.")}
        if "placement_emb.weight" in enc_state:
            n_placements = enc_state["placement_emb.weight"].shape[0]
            n_datasets = enc_state["dataset_emb.weight"].shape[0]

    cfg = EncoderConfig(in_channels=6, max_len=WIN, hidden=hidden, n_layers=n_layers,
                        n_placements=n_placements, n_datasets=n_datasets)
    enc = LIMUBertEncoder(cfg).to(dev)
    head = RegressionHead(hidden, 1).to(dev)
    if enc_state is not None:
        missing, _ = enc.load_state_dict(enc_state, strict=False)
        logger.info("warm-started encoder (missing=%d)", len(missing))

    opt = torch.optim.AdamW([*enc.parameters(), *head.parameters()], lr=lr, weight_decay=0.05)
    pid = torch.zeros(batch_size, dtype=torch.long, device=dev)
    did = torch.zeros(batch_size, dtype=torch.long, device=dev)
    Xtr, ytr = X[tr], (y[tr] - y_mu) / y_sd
    idx = np.arange(len(Xtr))
    enc.train()
    head.train()
    for _ in range(steps):
        b = rng.choice(idx, size=min(batch_size, len(idx)), replace=False)
        xb = torch.from_numpy(Xtr[b]).to(dev)
        yb = torch.from_numpy(ytr[b]).to(dev).unsqueeze(1)
        pred = head(LIMUBertEncoder.pool(enc(xb, pid[:len(b)], did[:len(b)])))
        loss = nn.functional.mse_loss(pred, yb)
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_([*enc.parameters(), *head.parameters()], 1.0)
        opt.step()

    enc.eval()
    head.eval()
    with torch.no_grad():
        xte = torch.from_numpy(X[te]).to(dev)
        p = head(LIMUBertEncoder.pool(enc(xte, torch.zeros(te.sum(), dtype=torch.long, device=dev),
                                          torch.zeros(te.sum(), dtype=torch.long, device=dev))))
        pred = p.squeeze(1).cpu().numpy() * y_sd + y_mu
    r, _ = pearsonr(pred, y[te])
    mae = float(np.mean(np.abs(pred - y[te])))
    result = {
        "task": "movement_quality",
        "status": "synthetic_proxy",
        "data_note": "AMASS virtual-IMU input; target = pose-derived LDLJ smoothness. "
                     "Real clinician-scored eval (KIMORE/UI-PRMD) PENDING data access.",
        "warm_start": "ssl" if pretrained_ckpt else "from_scratch",
        "target": "log_dimensionless_jerk (smoothness)",
        "placement": PLACEMENT,
        "n_windows": len(X), "n_subjects": len(subjects),
        "test_subject": test_subj, "n_test": int(te.sum()),
        "pearson_r": float(r), "mae": mae,
        "correlation_target": 0.70,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2))
    logger.info("movement-quality proxy: Pearson r=%.3f (test actor %s, n=%d)", r, test_subj, int(te.sum()))
    return result


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Movement-quality proxy demonstrator on AMASS")
    p.add_argument("--amass-dir", type=Path, default=Path("data/raw/amass"))
    p.add_argument("--stats-path", type=Path, default=Path("data_manifests/norm_stats/train_stats.json"))
    p.add_argument("--pretrained-ckpt", default="checkpoints/ssl_encoder.ckpt")
    p.add_argument("--out", type=Path, default=Path("reports/movement_quality.json"))
    p.add_argument("--hidden", type=int, default=128)
    p.add_argument("--n-layers", type=int, default=3)
    p.add_argument("--max-files", type=int, default=40)
    p.add_argument("--stride", type=int, default=100)
    p.add_argument("--steps", type=int, default=400)
    p.add_argument("--batch-size", type=int, default=64)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--seed", type=int, default=1337)
    p.add_argument("--log-level", default="INFO")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    run_quality(
        args.amass_dir, args.out, pretrained_ckpt=args.pretrained_ckpt or None,
        hidden=args.hidden, n_layers=args.n_layers, max_files=args.max_files, stride=args.stride,
        steps=args.steps, batch_size=args.batch_size, lr=args.lr, seed=args.seed, stats_path=args.stats_path,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
