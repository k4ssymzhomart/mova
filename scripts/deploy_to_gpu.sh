#!/usr/bin/env bash
#
# Mova -> University GPU cluster deploy.
#
# Syncs code + processed data to the GPU server over SSH using rsync.
#
# SECURITY: this script contains NO passwords. It relies on SSH key auth via the
# `mova-gpu` host alias (see ~/.ssh/config block in the README / deploy docs).
# One-time setup on your machine (you type the password ONCE, never stored):
#     ssh-keygen -t ed25519 -C mova-gpu          # if you don't have a key yet
#     ssh-copy-id mova-gpu                        # pushes your public key to the server
# The Kerio VPN must be connected first (the server lives on a private 192.168.x.x subnet).
#
# Usage:
#     scripts/deploy_to_gpu.sh            # sync
#     scripts/deploy_to_gpu.sh --dry-run  # preview without transferring
#
set -euo pipefail

REMOTE="${MOVA_GPU_HOST:-mova-gpu}"     # override with MOVA_GPU_HOST=user@ip if no alias
REMOTE_DIR="${MOVA_GPU_DIR:-mova}"      # path on the server, relative to the login home
DRY="${1:-}"

RSYNC_OPTS=(
  -avz --human-readable --partial --info=progress2
  --exclude='.venv/'        --exclude='__pycache__/'  --exclude='*.py[cod]'
  --exclude='.git/'         --exclude='.dvc/cache/'   --exclude='.mypy_cache/'
  --exclude='.ruff_cache/'  --exclude='wandb/'        --exclude='outputs/'
  --exclude='.env'          --exclude='.env.*'        --exclude='*.pem'
)
[[ "${DRY}" == "--dry-run" ]] && RSYNC_OPTS+=(--dry-run)

cd "$(dirname "$0")/.."   # repo root

echo ">> preflight: checking SSH reachability of '${REMOTE}' (VPN must be up)"
ssh -o ConnectTimeout=8 -o BatchMode=yes "${REMOTE}" "mkdir -p '${REMOTE_DIR}/data'" \
  || { echo "!! cannot reach ${REMOTE}. Connect the Kerio VPN and run 'ssh-copy-id ${REMOTE}' first."; exit 1; }

echo ">> syncing source, config, manifests, and processed windows to ${REMOTE}:${REMOTE_DIR}"
rsync "${RSYNC_OPTS[@]}" src/                 "${REMOTE}:${REMOTE_DIR}/src/"
rsync "${RSYNC_OPTS[@]}" pyproject.toml        "${REMOTE}:${REMOTE_DIR}/pyproject.toml"
rsync "${RSYNC_OPTS[@]}" configs/             "${REMOTE}:${REMOTE_DIR}/configs/"
rsync "${RSYNC_OPTS[@]}" data_manifests/      "${REMOTE}:${REMOTE_DIR}/data_manifests/"
rsync "${RSYNC_OPTS[@]}" data/processed/      "${REMOTE}:${REMOTE_DIR}/data/processed/"

echo ">> done."
echo "   On the server (one-time): cd ${REMOTE_DIR} && python3.12 -m venv .venv && .venv/bin/pip install -e '.[ml]'"
