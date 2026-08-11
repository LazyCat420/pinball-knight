#!/usr/bin/env bash
#
# D-1 — THE ORACLE-ROT GATE.
#
#   bash scripts/pk-drift.sh [path-to-braindeadbot-client]
#
# `legacy/` is the port's ORACLE: every bit-exact fixture the Rust side replays
# is exported from it, and every A/B sheet is shot against it. It is also a
# filtered EXTRACTION of `braindeadbot-client/src/game/pinball-knight`, which is
# the tree that still serves the live game.
#
# Nothing keeps those two in step. A single gameplay fix landed in
# braindeadbot-client would make the oracle wrong, and **every fixture would
# stay green while the port converged on a game that no longer exists** — the
# failure is invisible by construction, which is what makes it worth a gate
# rather than a note. braindeadbot-client's PK tree has had no commit since the
# extraction (2026-08-09, `7937bfe`), so today this passes; that is an
# ASSUMPTION until something checks it, and this is the something.
#
# Exit codes are three, not two, on purpose:
#   0  no drift outside the allowlist
#   1  DRIFT — a file changed on the braindeadbot-client side, or a new file
#      appeared on either
#   2  CANNOT CHECK — the other tree is not on this machine. NOT a pass. A
#      caller that treats 2 as success has built a gate that reports green when
#      it did not run, which is worse than no gate at all.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEGACY="$HERE/legacy/src/game/pinball-knight"
BDB="${1:-$HERE/../braindeadbot-client}/src/game/pinball-knight"

if [ ! -d "$BDB" ]; then
  echo "pk-drift: CANNOT CHECK — no braindeadbot-client PK tree at $BDB"
  echo "pk-drift: pass its path as \$1. Exit 2 is not a pass."
  exit 2
fi
if [ ! -d "$LEGACY" ]; then
  echo "pk-drift: CANNOT CHECK — no legacy PK tree at $LEGACY"
  exit 2
fi

# `tools/` is the sprite forge: the permanent art toolchain, excluded from the
# port by decision (docs/src/art/pipelines.md), and worked on independently in
# both trees. Diffing it would report art work as oracle rot every week.
# The rest are build/test detritus that never belonged to either tree.
EXCLUDES=(-x node_modules -x tools -x .pytest_cache -x __pycache__ -x '*.pyc')

# Files that are ALLOWED to differ, each because `legacy/` is deliberately
# ahead. Keep this list short and justified: every entry is a place where the
# gate cannot see a real change.
#
#   boot/sheets.ts      + the spider/goblin/slime/reaper sheet registry
#   maze/build.ts       + the `bakeMazeSurfaces()` seam
#   maze/track-floor.ts + the `onPass` harness seam and `PassSnapshot`
#   port-*.test.ts      the fixture and floor EXPORTERS — legacy-only by design
ALLOW_DIFF=(
  "boot/sheets.ts"
  "maze/build.ts"
  "maze/track-floor.ts"
)
ALLOW_LEGACY_ONLY=(
  "port-fixtures.test.ts"
  "port-maze-fixtures.test.ts"
  "port-floor-export.test.ts"
)

# "Only in <root>[/sub]: <name>" → "[sub/]<name>", relative to the PK root.
only_in_path() {
  local line="$1" root="$2" dir name
  dir="${line#Only in }"
  dir="${dir%%: *}"
  name="${line##*: }"
  dir="${dir#"$root"}"
  dir="${dir#/}"
  [ -n "$dir" ] && echo "$dir/$name" || echo "$name"
}

allowed() {
  local needle="$1" name="$2"
  shift 2
  for a in "$@"; do
    [ "$needle" = "$a" ] && return 0
  done
  return 1
}

drift=0
while IFS= read -r line; do
  case "$line" in
    "Files "*" differ")
      # "Files <a> and <b> differ" → the path relative to the PK tree root.
      rel="${line#Files $BDB/}"
      rel="${rel%% and *}"
      if allowed "$rel" diff "${ALLOW_DIFF[@]}"; then continue; fi
      echo "DRIFT  changed: $rel"
      drift=1
      ;;
    # "Only in <dir>: <name>" — the SUBDIRECTORY is in the dir half, so both
    # halves are needed to name the file. Reporting the bare name would print
    # "new-thing.ts" for a file three directories down and send the reader
    # hunting.
    "Only in $LEGACY"*)
      rel="$(only_in_path "$line" "$LEGACY")"
      if allowed "$rel" only "${ALLOW_LEGACY_ONLY[@]}"; then continue; fi
      echo "DRIFT  only in legacy: $rel"
      drift=1
      ;;
    "Only in $BDB"*)
      echo "DRIFT  only in braindeadbot-client: $(only_in_path "$line" "$BDB")"
      drift=1
      ;;
  esac
done < <(diff -rq "${EXCLUDES[@]}" "$BDB" "$LEGACY" 2>/dev/null)

if [ "$drift" -eq 0 ]; then
  echo "pk-drift: clean — the oracle still describes the live game"
  exit 0
fi
cat <<'MSG'

pk-drift: THE ORACLE HAS ROTTED.

`legacy/` is what every parity fixture and every A/B sheet is measured against.
A change on the braindeadbot-client side means the port is converging on a game
that no longer exists, and no fixture will go red to tell you.

Resolve it deliberately, one of two ways:
  · port the change into `legacy/` as well, so the oracle catches up, or
  · add it to this script's allowlist WITH a reason, if legacy is meant to lead.
MSG
exit 1
