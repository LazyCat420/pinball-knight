#!/usr/bin/env bash
# gate-config.sh — pinball-knight's repo-specific gate facts. Everything the
# vendored gate-lib.sh/scoped-gate.sh/full-suite.sh must not hardcode lives
# here. Sourced, never executed.

GATE_REPO_NAME="pinball-knight"

# clippy is advisory-strict here: pass extra args after the packages, e.g.
# "-- -D warnings" once the workspace is clean. Empty = clippy's defaults.
GATE_CLIPPY_ARGS=""

# Files outside any crate that are load-bearing for a crate's tests.
# jsmath-oracle.json is the fixture jsmath_oracle.rs and the wasm probe replay.
GATE_TRIGGERS=("assets/fixtures/*=pk-core")

# Cross-targets that must BUILD whenever the closure is non-empty. A cfg-gated
# function is covered by no gate that skips its cfg — the wasm build once broke
# under 877 green native tests, and main was pushed unable to build wasm.
GATE_TARGETS=("wasm32-unknown-unknown" "x86_64-pc-windows-gnullvm")

# Which members build on each target — PROBED 2026-08-19: cargo check per
# member per target passed for ALL SEVEN members on BOTH targets. xtask is
# deliberately left out (dev-only tooling, never ships cross-target). These
# lists are frozen truth and can rot when a crate gains a platform dep; the
# entry package below is always included so the SHIPPED graph is checked even
# if a list rots.
GATE_WASM_PKGS="pk-core pk-jsmath-probe pk-assets pk-audio pk-game pk-gui"
GATE_WIN_PKGS="pk-core pk-jsmath-probe pk-assets pk-audio pk-game pk-gui"

# The entry package per target: feature unification happens at the leaf, so
# checking pk-core alone with default features is not the build that ships.
gate_target_entry() {
  case "$1" in
    wasm32-unknown-unknown)     echo "pk-game" ;;
    x86_64-pc-windows-gnullvm)  echo "pk-game" ;;
  esac
}

gate__target_list() {
  case "$1" in
    wasm32-unknown-unknown)    echo "$GATE_WASM_PKGS" ;;
    x86_64-pc-windows-gnullvm) echo "$GATE_WIN_PKGS" ;;
  esac
}

# scoped: (closure ∩ target's buildable set) ∪ entry package
gate_target_pkgs() {  # $1 = target, $2.. = closure members
  local t="$1"; shift
  local list=" $(gate__target_list "$t") " out="" m
  for m in "$@"; do
    [[ "$list" == *" $m "* ]] && out="$out $m"
  done
  local entry; entry="$(gate_target_entry "$t")"
  [[ " $out " == *" $entry "* ]] || out="$out $entry"
  echo "$out"
}

# full suite: every buildable member on that target
gate_target_full_pkgs() { gate__target_list "$1"; }

# maps a target to its full-suite leg flag (--wasm / --win)
gate_target_flag() {
  case "$1" in
    wasm32-unknown-unknown)    echo wasm ;;
    x86_64-pc-windows-gnullvm) echo win ;;
  esac
}

# ── extra legs (scoped) ───────────────────────────────────────────────────────
# jsmath is covered by a PAIR, per scripts/jsmath-wasm-check.mjs's own header:
# the wasm probe (no system libm on wasm) AND the windows oracle test binary
# (mingw pow was off on 201/200,001 inputs — "wasm is the odd one out" was the
# wrong model). Both fire when the closure touches the math.
gate_extra_legs() {  # $@ = closure members
  local closure=" $* "
  if [[ "$closure" == *" pk-core "* || "$closure" == *" pk-jsmath-probe "* ]]; then
    run_leg jsmath-wasm node scripts/jsmath-wasm-check.mjs --build
    run_leg jsmath-win cargo test --target x86_64-pc-windows-gnullvm -p pk-core \
      --test jsmath_oracle --jobs "$GRANT" -- --test-threads="$GRANT"
  fi
}
gate_extra_legs_names() {  # dry-run display twin of the above
  local closure=" $* "
  if [[ "$closure" == *" pk-core "* || "$closure" == *" pk-jsmath-probe "* ]]; then
    echo "jsmath-wasm jsmath-win"
  else
    echo "(none)"
  fi
}

# ── extra legs (full suite) ───────────────────────────────────────────────────
gate_full_extra_legs() {  # $1 = the `want` predicate function name
  local want="$1"
  if "$want" jsmath; then
    run_leg jsmath-wasm node scripts/jsmath-wasm-check.mjs --build
    run_leg jsmath-win cargo test --target x86_64-pc-windows-gnullvm -p pk-core \
      --test jsmath_oracle --jobs "$GRANT" -- --test-threads="$GRANT"
  fi
}
