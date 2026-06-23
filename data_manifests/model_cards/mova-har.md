# Model Card — mova-har

**Task:** human_activity_recognition  ·  **Created:** 2026-06-23T11:30:16.049996+00:00  ·  **Commit:** `f779609`

SSL-pretrained encoder fine-tuned for HAR with cross-device/position breakdown.

## Intended use
Research / decision-support only. Not a diagnostic device; outputs are surrogate estimates that support, never replace, a clinician.

## Architecture
- Encoder: LIMU-BERT transformer, hidden=128, layers=3
- SSL pretraining: HHAR+REALDISP masked+contrastive

## Training data
- Datasets: hhar, realdisp
- Protocol: subject-disjoint test split
- Leakage control: subject-disjoint; no test windows in SSL

## Evaluation (honest)
| Metric | Value |
|---|---|
| macro_f1_overall | 0.405 |

Baseline to beat: AUROC 0.551 (single-subject, no SSL, plain CE).

## Limitations & failure modes
- Placements/devices seen in training; true leave-placement-out is future work.

## Artifacts
- Checkpoint: `checkpoints/har_model.ckpt`
- ONNX: `checkpoints/onnx/har.onnx`
- Eval JSON: `reports/har.json`
