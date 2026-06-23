# Model Card — mova-fog-ssl-loso

**Task:** freezing_of_gait  ·  **Created:** 2026-06-23T11:30:16.024893+00:00  ·  **Commit:** `f779609`

SSL-pretrained LIMU-BERT encoder fine-tuned for FoG; LOSO-CV over 8 freeze-positive Daphnet subjects with focal loss + tuned operating point.

## Intended use
Decision support for clinicians; not a diagnostic device.

## Architecture
- Encoder: LIMU-BERT transformer, hidden=128, layers=3
- SSL pretraining: HHAR+REALDISP masked+contrastive (no Daphnet)

## Training data
- Datasets: daphnet_fog
- Protocol: LOSO-CV (8 subjects)
- Leakage control: test subject never in train/val or SSL pretraining

## Evaluation (honest)
| Metric | Value |
|---|---|
| auroc | 0.723 ± 0.051 |
| auprc | 0.259 ± 0.131 |
| sensitivity | 0.312 ± 0.193 |
| specificity | 0.859 ± 0.109 |

Baseline to beat: AUROC 0.551 (single-subject, no SSL, plain CE).

## Limitations & failure modes
- Daphnet is accelerometer-only — gyro channels are zero-filled.
- SSL minus scratch AUROC delta = +0.038.
- Per-subject variance is high (see std); a few subjects dominate error.
- Compute-bounded SSL (single Apple-Silicon GPU).

## Artifacts
- Checkpoint: `checkpoints/fog_model.ckpt`
- ONNX: `checkpoints/onnx/fog.onnx`
- Eval JSON: `reports/fog_loso_ssl.json`
