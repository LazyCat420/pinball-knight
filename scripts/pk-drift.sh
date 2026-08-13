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
BDB_ROOT="${1:-$HERE/../braindeadbot-client}"
BDB="$BDB_ROOT/src/game/pinball-knight"
# ── I-2, 2026-08-12: THE GATE COVERED `src/` ONLY, AND ART IS ORACLE STATE ──
#
# Every A/B sheet PHOTOGRAPHS the sprite sheets. A monster re-published on the
# braindeadbot-client side would change what the oracle looks like while every
# `.ts` file stayed byte-identical, so the gate would report "clean — the oracle
# still describes the live game" over a picture that had moved. The code half
# was watched and the half the rigs actually measure was not.
#
# Scope note: `legacy/public` carries ONLY `sprites/` — the extraction took that
# and nothing else. So this walks what LEGACY has, rather than diffing the two
# `public/` roots: braindeadbot-client's carries `images/`, `textures/`,
# `mahjong-tiles/`, cursors and `admin.css`, none of which were ever part of the
# extraction, and reporting them would print a dozen DRIFT lines that mean
# nothing and train the reader to skim.
LEGACY_PUBLIC="$HERE/legacy/public"
BDB_PUBLIC="$BDB_ROOT/public"

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

# ── the ART allowlist, measured 2026-08-12, not assumed ────────────────────
#
# Each entry was checked for DIRECTION before it was allowed, because "differs"
# alone does not say which tree moved and only one direction is oracle rot:
#
#   sprites/brute-S.{png,json}  legacy 2026-08-12, 1,013,307 B
#                               bdb    2026-08-06,    44,548 B   → legacy ahead
#                               (re-baked here; see the alt-takes under
#                               tools/sprite-forge/sources/brute-2026-08-10)
#   sprites/stiltneck-E.png     legacy 2026-08-12 / bdb 2026-08-03 → legacy ahead
#
# ⚠️ THE BLIND SPOT, STATED: an allowlisted file is invisible to this gate in
# BOTH directions. If braindeadbot-client later re-publishes `brute-S.png`, this
# script will not say so. That is the price of an allowlist and the reason each
# line carries a date — when a date here is older than the change you are
# chasing, re-measure rather than trusting the entry.
ALLOW_PUBLIC_DIFF=(
  "sprites/brute-S.json"
  "sprites/brute-S.png"
  "sprites/stiltneck-E.png"
)
# Published in pinball-knight first (2026-08-12); braindeadbot-client's PK tree
# has been frozen since the extraction, so it has no way to have them.
ALLOW_PUBLIC_LEGACY_ONLY=(
  "sprites/goblin-S.json"
  "sprites/goblin-S.png"
  "sprites/reaper-S.json"
  "sprites/reaper-S.png"
  "sprites/slime-S.json"
  "sprites/slime-S.png"
  "sprites/spider-S.json"
  "sprites/spider-S.png"
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

# ── the ART leg (I-2) ──────────────────────────────────────────────────────
#
# Walks the subtrees LEGACY carries, one at a time, so braindeadbot-client's
# unrelated `public/` content is out of scope by construction rather than by a
# growing exclude list.
if [ ! -d "$LEGACY_PUBLIC" ]; then
  echo "pk-drift: CANNOT CHECK — no legacy public tree at $LEGACY_PUBLIC"
  exit 2
fi
if [ ! -d "$BDB_PUBLIC" ]; then
  echo "pk-drift: CANNOT CHECK — no braindeadbot-client public tree at $BDB_PUBLIC"
  exit 2
fi
for sub in "$LEGACY_PUBLIC"/*; do
  [ -d "$sub" ] || continue
  name="$(basename "$sub")"
  if [ ! -d "$BDB_PUBLIC/$name" ]; then
    echo "DRIFT  only in legacy: public/$name (whole directory)"
    drift=1
    continue
  fi
  while IFS= read -r line; do
    case "$line" in
      "Files "*" differ")
        rel="${line#Files $BDB_PUBLIC/}"
        rel="${rel%% and *}"
        if allowed "$rel" diff "${ALLOW_PUBLIC_DIFF[@]}"; then continue; fi
        echo "DRIFT  changed: public/$rel"
        drift=1
        ;;
      "Only in $LEGACY_PUBLIC"*)
        rel="$(only_in_path "$line" "$LEGACY_PUBLIC")"
        if allowed "$rel" only "${ALLOW_PUBLIC_LEGACY_ONLY[@]}"; then continue; fi
        echo "DRIFT  only in legacy: public/$rel"
        drift=1
        ;;
      "Only in $BDB_PUBLIC"*)
        # This direction is the one that matters most: a sheet the live game has
        # and the oracle does not means every A/B sheet is shot against art the
        # player is not looking at.
        echo "DRIFT  only in braindeadbot-client: public/$(only_in_path "$line" "$BDB_PUBLIC")"
        drift=1
        ;;
    esac
  done < <(diff -rq "${EXCLUDES[@]}" "$BDB_PUBLIC/$name" "$sub" 2>/dev/null)
done

if [ "$drift" -eq 0 ]; then
  echo "pk-drift: clean — the oracle still describes the live game (src/ and public/)"
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
