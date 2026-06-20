#!/usr/bin/env bash
#
# Mova — local training on Apple Silicon (MPS) / CPU. No GPU cluster needed.
# Uses the Python 3.12 venv (.venv312) created for the ML stack.
#
# Usage:
#   bash scripts/train_local.sh smoke   # 1-batch sanity check
#   bash scripts/train_local.sh fog     # train the clinical FoG model + test
#   bash scripts/train_local.sh har     # train the activity model + test
#   bash scripts/train_local.sh ssl     # self-supervised pretrain (longer)
#
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${MOVA_PY:-.venv312/bin/python}"
export PYTORCH_ENABLE_MPS_FALLBACK=1   # let unsupported ops fall back to CPU

if [[ ! -x "${PY}" ]]; then
  echo "!! ${PY} not found. Create it with:"
  echo "   /opt/homebrew/bin/python3.12 -m venv .venv312 && .venv312/bin/pip install -e '.[ml]'"
  exit 1
fi

"${PY}" -c "import torch;print('torch',torch.__version__,'| mps',torch.backends.mps.is_available())"

cmd="${1:-fog}"
case "${cmd}" in
  smoke) "${PY}" scripts/train.py trainer=local task=fog trainer.fast_dev_run=True wandb.mode=disabled num_workers=0 ;;
  fog)   "${PY}" scripts/train.py trainer=local task=fog wandb.mode=disabled num_workers=2 batch_size=128 ;;
  har)   "${PY}" scripts/train.py trainer=local task=har wandb.mode=disabled num_workers=2 batch_size=256 trainer.max_epochs=8 ;;
  ssl)   "${PY}" scripts/train.py trainer=local task=ssl wandb.mode=disabled num_workers=2 batch_size=256 trainer.max_epochs=5 ;;
  *) echo "unknown command: ${cmd} (use: smoke|fog|har|ssl)"; exit 1 ;;
esac
