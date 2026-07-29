#!/usr/bin/env bash
#
# PostToolUse(Edit|Write) — the pinball-knight edit gate.
#
# One script rather than five hook entries: tsc dominates the cost, and running
# it once alongside the cheap checks keeps a single edit at ~6s instead of
# paying process startup five times over.
#
# Blocking (exit 2, stderr goes back to Claude):
#   · tsc, filtered to src/game/pinball-knight — the subtree is at ZERO errors
#     today while the wider repo carries ~6000, and next.config.js sets
#     ignoreBuildErrors, so nothing else would ever surface a regression here.
#     This is what makes the nine Record<EnemyKind, X> tables actually enforced.
#   · registry-drift.mjs — the registries tsc cannot see.
#
# Advisory (reported, never blocks): directory tests, dev-hook leaks, file size.
#
# Everything is skipped unless the edited file is under the game subtree, so
# this is silent for the other 30-odd repos and for the rest of this one.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/_hooklib.sh"

payload="$(cat)"
file="$(hk_field "$payload" tool_input file_path)"
case "$file" in
  */src/game/pinball-knight/*) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] || exit 0

# Repo root = the worktree this file lives in, so the hook follows you into
# any worktree instead of hardcoding the shared checkout.
root="$(cd "$(dirname "$file")" && git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$root" || exit 0

rel="${file#"$root"/}"
blocking=""
advisory=""

# ── blocking: typecheck, scoped ──────────────────────────────────────────────
ts_errors="$(npx tsc --noEmit -p tsconfig.json 2>&1 | grep '^src/game/pinball-knight/' || true)"
if [ -n "$ts_errors" ]; then
  # grep -c, not wc -l: the last line carries no newline, so wc undercounts by
  # one and a lone error reports as "0 error(s)".
  blocking+="TYPECHECK — $(printf '%s\n' "$ts_errors" | grep -c 'error TS') error(s) in the game subtree:"$'\n'
  blocking+="$(printf '%s' "$ts_errors" | head -20)"$'\n\n'
fi

# ── blocking: registry drift ─────────────────────────────────────────────────
# The checker is resolved from the WORKTREE being edited, not from wherever this
# hook was loaded, so a branch that predates it simply has no checker — and an
# older worktree must not be unable to accept an edit because a tool it has
# never heard of is missing. Absent checker = skip, not block.
NODE="$(hk_node)"
if [ -n "$NODE" ] && [ -f scripts/hooks/registry-drift.mjs ]; then
  if ! drift="$("$NODE" scripts/hooks/registry-drift.mjs 2>&1)"; then
    blocking+="$drift"$'\n\n'
  fi
fi

# ── advisory: tests for the edited file's directory ──────────────────────────
# maze/ is 59s of the suite's 88s (floor-pipeline.test.ts alone is 20s), which
# is well past what an edit should cost. It runs on the pre-deploy gate instead.
dir="$(dirname "$rel")"
case "$dir" in
  */maze|*/maze/*) advisory+="tests: skipped ${dir} (59s — covered by the deploy gate)"$'\n' ;;
  *)
    if compgen -G "$dir/*.test.ts" >/dev/null; then
      if ! out="$(timeout 90 npx vitest run "$dir" 2>&1)"; then
        advisory+="TESTS FAILING in ${dir}:"$'\n'"$(printf '%s' "$out" | grep -E '^\s*(×|FAIL|→)' | head -15)"$'\n'
      fi
    fi
    ;;
esac

# ── advisory: dev hooks escaping the dev surface ─────────────────────────────
# installDevHooks is called unconditionally and its only guard is an SSR check,
# so ~52 __dungeon* symbols already ship in the production bundle. Until that is
# gated, this at least stops the surface from growing in new places.
case "$rel" in
  */dev/*|*/playtest-bot.ts|*/engine/profiler.ts|*.test.ts) ;;
  *)
    if grep -qE '(window as [^)]*)?\.__(dungeon|lab)' "$file" 2>/dev/null; then
      advisory+="dev-hook leak: ${rel} assigns a window.__dungeon*/__lab global outside dev/ — that surface ships to production today"$'\n'
    fi
    ;;
esac

# ── advisory: file size ──────────────────────────────────────────────────────
# Nothing enforces this: ESLint has no max-lines and does not run at build.
# core.ts was decomposed once and grew back to ~2750.
lines="$(wc -l < "$file")"
case "$rel" in
  */render/cel-painter.ts|*/maze/decorate.ts|*/core.ts|*/entities/player.ts) ;;  # grandfathered
  *)
    if [ "$lines" -gt 1500 ]; then
      advisory+="size: ${rel} is ${lines} lines — past the 1500 line mark, split it"$'\n'
    elif [ "$lines" -gt 900 ]; then
      advisory+="size: ${rel} is ${lines} lines — approaching the 1500 line mark"$'\n'
    fi
    ;;
esac

# ── report ───────────────────────────────────────────────────────────────────
if [ -n "$blocking" ]; then
  { printf '%s' "$blocking"; [ -n "$advisory" ] && printf 'Also:\n%s' "$advisory"; } >&2
  exit 2
fi
if [ -n "$advisory" ]; then
  hk_emit_system_message "$advisory"
fi
exit 0
