#!/bin/bash
# ============================================================
# Pinball Knight Web (Three.js) — Build & Deploy to Synology NAS
#
# Thin wrapper — all logic lives in ../../deploy-kit/lib.sh
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="pinball-knight-web"
DISPLAY_NAME="🗡️ Pinball Knight Web"
DEPLOY_METHOD="ssh"
DEPLOY_SSH_HOST="nas"

# Resolve deploy-kit library location
if [ -f "${SCRIPT_DIR}/../../deploy-kit/lib.sh" ]; then
  source "${SCRIPT_DIR}/../../deploy-kit/lib.sh"
elif [ -f "${SCRIPT_DIR}/../../../../deploy-kit/lib.sh" ]; then
  source "${SCRIPT_DIR}/../../../../deploy-kit/lib.sh"
elif [ -f "${SCRIPT_DIR}/../deploy-kit/lib.sh" ]; then
  source "${SCRIPT_DIR}/../deploy-kit/lib.sh"
else
  echo "Error: deploy-kit/lib.sh not found" >&2
  exit 1
fi
