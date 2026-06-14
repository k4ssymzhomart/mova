#!/usr/bin/env bash
#
# Mova — GPU bootstrap. Run THIS ON the GPU server (mova-gpu), from the repo root,
# after `scripts/deploy_to_gpu.sh` has synced the code + data/processed.
#
# Steps: create the Python 3.12 venv -> install mova[ml] -> wandb login -> 1-batch smoke test.
#
# Optional env vars:
#   PYTHON=python3.12            interpreter to use (must be 3.12; torch has no 3.14 wheels)
#   MOVA_TORCH_INDEX_URL=...     install a specific CUDA torch build first, e.g.
#                                https://download.pytorch.org/whl/cu121
#   WANDB_API_KEY=...            non-interactive wandb login (else you'll be prompted)
#   MOVA_SKIP_WANDB=1            skip the wandb login step
#
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$(pwd)"
PY="${PYTHON:-python3.12}"
VENV="${MOVA_VENV:-.venv}"

echo ">> Mova GPU bootstrap @ ${REPO}"

# 1) Python 3.12 -------------------------------------------------------------
if ! command -v "${PY}" >/dev/null 2>&1; then
  echo "!! '${PY}' not found. Install Python 3.12 first (torch/pytorch-lightning have no 3.14 wheels)."
  exit 1
fi
echo ">> interpreter: $(${PY} --version)"

# 2) Virtual environment -----------------------------------------------------
if [[ ! -d "${VENV}" ]]; then
  echo ">> creating venv at ${VENV}"
  "${PY}" -m venv "${VENV}"
fi
# shellcheck disable=SC1091
source "${VENV}/bin/activate"
python -m pip install -U pip wheel >/dev/null
echo ">> venv active: $(python --version) @ $(which python)"

# 3) Install -----------------------------------------------------------------
if [[ -n "${MOVA_TORCH_INDEX_URL:-}" ]]; then
  echo ">> installing CUDA torch from ${MOVA_TORCH_INDEX_URL}"
  pip install torch --index-url "${MOVA_TORCH_INDEX_URL}"
fi
echo ">> installing mova + [ml] extra (editable)"
pip install -e ".[ml]"

# 4) GPU sanity --------------------------------------------------------------
python - <<'PY'
import torch
ok = torch.cuda.is_available()
dev = torch.cuda.get_device_name(0) if ok else "CPU"
print(f">> torch {torch.__version__} | cuda_available={ok} | device={dev}")
PY

# 5) Weights & Biases login (non-fatal) --------------------------------------
if [[ "${MOVA_SKIP_WANDB:-0}" != "1" ]]; then
  if [[ -n "${WANDB_API_KEY:-}" ]]; then
    wandb login "${WANDB_API_KEY}" || echo "!! wandb login failed (continuing — smoke test does not need it)"
  else
    echo ">> wandb: WANDB_API_KEY not set — launching interactive login (paste key, or Ctrl-C to skip)"
    wandb login || echo "!! wandb login skipped/failed (continuing)"
  fi
fi

# 6) Smoke test: 1 train + 1 val batch through the full SSL stack ------------
echo ">> running fast_dev_run smoke test (task=ssl) ..."
python scripts/train.py task=ssl trainer.fast_dev_run=True

echo ""
echo ">> bootstrap complete ✔"
echo "   Full pretraining : python scripts/train.py task=ssl"
echo "   Fine-tune (FoG)  : python scripts/train.py task=fog finetune.pretrained_ckpt=checkpoints/last.ckpt"
