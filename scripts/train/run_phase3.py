"""Phase 3 end-to-end driver: run every evaluation from a pretrained SSL encoder, then assemble the
credibility surfaces (registry, model cards, benchmark leaderboard).

Assumes ``mova.train.pretrain`` already produced the SSL encoder checkpoint. Runs:
  1. FoG LOSO-CV (SSL warm-start)          -> reports/fog_loso_ssl.json
  2. FoG LOSO-CV (from scratch, ablation)  -> reports/fog_loso_scratch.json
  3. FoG deployable model (all subjects)   -> checkpoints/fog_model.ckpt
  4. HAR fine-tune + generalization        -> reports/har.json, checkpoints/har_model.ckpt
  5. Movement-quality proxy (AMASS)        -> reports/movement_quality.json
  6. ONNX export (FoG + encoder, HAR)      -> checkpoints/onnx/*.onnx
  7. Model registry + model cards          -> data_manifests/model_registry.json + model_cards/*.md
  8. Benchmark leaderboard                 -> benchmark/leaderboard.json

Run:
    python scripts/train/run_phase3.py --processed-dir /abs/data/processed \
        --ssl-ckpt checkpoints/ssl_encoder.ckpt --amass-dir /abs/data/raw/amass
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from mova.eval.benchmark import build_leaderboard
from mova.export.onnx_export import export_module, load_module_from_ckpt
from mova.registry.model_card import write_card
from mova.registry.registry import ModelEntry, ModelRegistry
from mova.train.fog_loso import run_loso, train_and_save_fog
from mova.train.har import run_har
from mova.train.quality import run_quality

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("mova.phase3")

HID, NL = 128, 3


def main() -> int:
    ap = argparse.ArgumentParser(description="Phase 3 end-to-end driver")
    ap.add_argument("--processed-dir", type=Path, required=True)
    ap.add_argument("--ssl-ckpt", default="checkpoints/ssl_encoder.ckpt")
    ap.add_argument("--amass-dir", type=Path, default=Path("data/raw/amass"))
    ap.add_argument("--stats-path", type=Path, default=Path("data_manifests/norm_stats/train_stats.json"))
    ap.add_argument("--fog-epochs", type=int, default=6)
    ap.add_argument("--har-epochs", type=int, default=3)
    ap.add_argument("--reports", type=Path, default=Path("reports"))
    ap.add_argument("--ckpt-dir", type=Path, default=Path("checkpoints"))
    args = ap.parse_args()

    common = {"hidden": HID, "n_layers": NL, "batch_size": 128, "lr": 3e-4, "seed": 1337,
              "stats_path": args.stats_path}
    fog_common = {"focal_gamma": 2.0, "min_specificity": 0.85, "samples_per_epoch": 12000,
                  "max_epochs": args.fog_epochs, "num_workers": 0, **common}

    # 1-2. FoG LOSO — SSL vs from-scratch ablation
    fog_ssl_json = args.reports / "fog_loso_ssl.json"
    fog_scratch_json = args.reports / "fog_loso_scratch.json"
    fog_ssl = run_loso(args.processed_dir, fog_ssl_json, pretrained_ckpt=args.ssl_ckpt, **fog_common)
    fog_scratch = run_loso(args.processed_dir, fog_scratch_json, pretrained_ckpt=None, **fog_common)

    # 3. deployable FoG model (all-but-one subject) for export/serving
    fog_ckpt = args.ckpt_dir / "fog_model.ckpt"
    fog_dep = train_and_save_fog(args.processed_dir, fog_ckpt, pretrained_ckpt=args.ssl_ckpt,
                                 max_epochs=args.fog_epochs, focal_gamma=2.0, min_specificity=0.85,
                                 samples_per_epoch=12000, **common)

    # 4. HAR
    har_json = args.reports / "har.json"
    har_ckpt = args.ckpt_dir / "har_model.ckpt"
    har = run_har(args.processed_dir, har_json, pretrained_ckpt=args.ssl_ckpt, max_epochs=args.har_epochs,
                  samples_per_epoch=30000, num_workers=0, save_ckpt=har_ckpt, **common)

    # 5. movement-quality proxy
    quality_json = args.reports / "movement_quality.json"
    quality = run_quality(args.amass_dir, quality_json, pretrained_ckpt=args.ssl_ckpt,
                          hidden=HID, n_layers=NL, max_files=40, stride=100, steps=400,
                          batch_size=64, lr=3e-4, seed=1337, stats_path=args.stats_path)

    # 6. ONNX export
    onnx_dir = args.ckpt_dir / "onnx"
    fog_onnx = export_module(load_module_from_ckpt(str(fog_ckpt)), onnx_dir, "fog", task="fog")
    har_onnx = export_module(load_module_from_ckpt(str(har_ckpt)), onnx_dir, "har", task="har")

    # 7. registry + model cards
    reg = ModelRegistry()
    fog_entry = ModelEntry(
        model_id="mova-fog-ssl-loso", task="freezing_of_gait",
        description="SSL-pretrained LIMU-BERT encoder fine-tuned for FoG; LOSO-CV over 8 freeze-positive "
                    "Daphnet subjects with focal loss + tuned operating point.",
        metrics={"auroc": fog_ssl["summary_tuned"]["auroc"], "auprc": fog_ssl["summary_tuned"]["auprc"],
                 "sensitivity": fog_ssl["summary_tuned"]["sensitivity"],
                 "specificity": fog_ssl["summary_tuned"]["specificity"]},
        encoder={"hidden": HID, "n_layers": NL},
        training_data={"datasets": ["daphnet_fog"], "protocol": "LOSO-CV (8 subjects)",
                       "ssl_pretraining": "HHAR+REALDISP masked+contrastive (no Daphnet)",
                       "leakage_control": "test subject never in train/val or SSL pretraining",
                       "baseline_auroc": 0.551},
        artifacts={"checkpoint": str(fog_ckpt), "onnx": fog_onnx["model_onnx"], "eval_json": str(fog_ssl_json)},
        provenance={"intended_use": "Decision support for clinicians; not a diagnostic device.",
                    "limitations": [
                        "Daphnet is accelerometer-only — gyro channels are zero-filled.",
                        f"SSL minus scratch AUROC delta = "
                        f"{fog_ssl['summary_tuned']['auroc']['mean'] - fog_scratch['summary_tuned']['auroc']['mean']:+.3f}.",
                        "Per-subject variance is high (see std); a few subjects dominate error.",
                        "Compute-bounded SSL (single Apple-Silicon GPU).",
                    ]},
    )
    reg.register(fog_entry)
    write_card(fog_entry.as_dict())

    har_entry = ModelEntry(
        model_id="mova-har", task="human_activity_recognition",
        description="SSL-pretrained encoder fine-tuned for HAR with cross-device/position breakdown.",
        metrics={"macro_f1_overall": har["macro_f1_overall"]},
        encoder={"hidden": HID, "n_layers": NL},
        training_data={"datasets": ["hhar", "realdisp"], "protocol": "subject-disjoint test split",
                       "ssl_pretraining": "HHAR+REALDISP masked+contrastive",
                       "leakage_control": "subject-disjoint; no test windows in SSL"},
        artifacts={"checkpoint": str(har_ckpt), "onnx": har_onnx["model_onnx"], "eval_json": str(har_json)},
        provenance={"limitations": ["Placements/devices seen in training; true leave-placement-out is future work."]},
    )
    reg.register(har_entry)
    write_card(har_entry.as_dict())

    # 8. benchmark leaderboard
    build_leaderboard(fog_ssl_json, fog_scratch_json, har_json, Path("benchmark/leaderboard.json"),
                      quality=quality_json)

    summary = {
        "fog_ssl_auroc": fog_ssl["summary_tuned"]["auroc"],
        "fog_scratch_auroc": fog_scratch["summary_tuned"]["auroc"],
        "fog_deploy_threshold": fog_dep["decision_threshold"],
        "har_macro_f1": har["macro_f1_overall"],
        "quality_pearson_r": quality["pearson_r"],
        "beats_baseline": fog_ssl["beats_baseline"],
    }
    (args.reports / "phase3_summary.json").write_text(json.dumps(summary, indent=2))
    log.info("PHASE 3 DONE: %s", json.dumps(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
