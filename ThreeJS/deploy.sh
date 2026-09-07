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

# Every worktree shares these image tags and the same NAS container. Serialize
# release builds and deployments across worktrees; ordinary dev builds remain
# independent. Never remove this lock file: flock releases it on process exit.
if [[ " $* " != *" --dry-run "* ]]; then
  RELEASE_GIT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir)" || exit 1
  exec 9>"${RELEASE_GIT_DIR}/pinball-knight-web.deploy.lock"
  if ! flock -n 9; then
    echo "Another Pinball Knight release build or deployment is running. Retry after it finishes." >&2
    exit 1
  fi
fi

# pnpm may auto-install before each script. Prepare dependencies once before
# deploy-kit's parallel test shards, then fail on drift instead of letting
# several installers replace node_modules concurrently.
PRE_TEST() {
  if $DRY_RUN; then return; fi
  CI=true pnpm install --frozen-lockfile || fail "Dependency preparation failed"
  export pnpm_config_verify_deps_before_run=error
}

# Resolve deploy-kit library location
if [ -f "${SCRIPT_DIR}/../../../../deploy-kit/lib.sh" ]; then
  source "${SCRIPT_DIR}/../../../../deploy-kit/lib.sh"
elif [ -f "${SCRIPT_DIR}/../../deploy-kit/lib.sh" ]; then
  source "${SCRIPT_DIR}/../../deploy-kit/lib.sh"
elif [ -f "${SCRIPT_DIR}/../deploy-kit/lib.sh" ]; then
  source "${SCRIPT_DIR}/../deploy-kit/lib.sh"
else
  echo "Error: deploy-kit/lib.sh not found" >&2
  exit 1
fi
