#!/usr/bin/env bash
# full-suite.sh — everything, in sequence, with real exit-status plumbing.
#
#   scripts/ops/full-suite.sh [leg flags] [--no-lease] [--self-test]
#
# Leg flags (none = every leg): --rust (fmt+clippy+native tests) · --wasm ·
# --win · plus whatever gate-config.sh's gate_full_extra_flags declares.
#
# WHY SEQUENTIAL: running halves concurrently oversubscribes the shared box and
# manufactures phantom timeout "failures" (~16 of them, once, in an afternoon).
# WHY --no-fail-fast: plain `cargo test --workspace` fail-fasts and reports 1 of
# N test binaries as if it were the whole suite.
# WHY the exit code is sacred: every leg's rc reaches the summary and the exit;
# a `| grep passed` tail once shipped four real reds as exit 0. --self-test
# proves this plumbing any day, in one command.
set -u -o pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=gate-lib.sh
. "$HERE/gate-lib.sh"
# shellcheck source=gate-config.sh
. "$HERE/gate-config.sh"

gate_selftest_maybe "${BASH_SOURCE[0]}" "$@"

declare -A WANT=()
ANY_FLAG=0
while [ $# -gt 0 ]; do
  case "$1" in
    --no-lease)  GATE_NO_LEASE=1; shift ;;
    --self-test) shift ;;  # handled above
    -h|--help)   sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --*)         WANT["${1#--}"]=1; ANY_FLAG=1; shift ;;
    *) gate_die "unknown arg '$1'" ;;
  esac
done
want() { [ "$ANY_FLAG" = 0 ] || [ "${WANT[$1]:-0}" = 1 ]; }

cd "$REPO_ROOT" || gate_die "cannot cd to $REPO_ROOT"
export GATE_LABEL="${GATE_REPO_NAME}-full-suite"

# Name a dirty primary before anything runs — a suite result on a tree you
# cannot name is not a result. Warn only: worktree-first means the primary is
# often legitimately mid-something that is not ours to describe.
PRIMARY="$(gate_primary_checkout)"
DIRTY_N="$(git -C "$PRIMARY" status --porcelain 2>/dev/null | wc -l)"
if [ "$DIRTY_N" != 0 ]; then
  gate_note "NOTE: primary checkout is DIRTY ($DIRTY_N files) — this run describes THIS tree ($REPO_ROOT), not that one."
fi

meter_grab
lease_target_dir

if want rust; then
  run_leg fmt cargo fmt --all --check
  # shellcheck disable=SC2086
  run_leg clippy cargo clippy --workspace --all-targets --jobs "$GRANT" ${GATE_CLIPPY_ARGS:-}
  run_leg test cargo test --workspace --no-fail-fast --jobs "$GRANT" -- --test-threads="$GRANT"
fi

for t in ${GATE_TARGETS[@]+"${GATE_TARGETS[@]}"}; do
  flag="$(gate_target_flag "$t")"
  want "$flag" || continue
  read -r -a TPKGS <<<"$(gate_target_full_pkgs "$t")"
  TARGS=(); for m in "${TPKGS[@]}"; do TARGS+=(-p "$m"); done
  [ ${#TARGS[@]} -gt 0 ] && run_leg "check-$t" cargo check --target "$t" "${TARGS[@]}" --jobs "$GRANT"
done

gate_full_extra_legs want

gate_finish
