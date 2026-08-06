#!/usr/bin/env bash
#
# UserPromptSubmit — inject the pinball-knight working knowledge, once, the
# first time a session turns to the game.
#
# Gated on the prompt rather than fired at SessionStart because most sessions in
# this tree are trading/HTML-Notes work, and unconditional injection is a tax on
# all of them. Gated to ONCE per session because the second copy teaches nothing
# and costs the same.
#
# What goes in is only what is expensive to rediscover and cheap to state: the
# debug surface (which otherwise gets rediscovered by reading 800 lines of
# window-hooks.ts), the rule that makes it useful, and the registry checklist.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/_hooklib.sh"

payload="$(cat)"
prompt="$(hk_field "$payload" prompt)"
printf '%s' "$prompt" | grep -qiE 'pinball|dungeon|monster|enemykind|bestiary|braindeadbot|floor|maze' || exit 0

session="$(hk_field "$payload" session_id)"
session="${session:-nosession}"
stamp="${TMPDIR:-/tmp}/.pk-primed-${session}"
[ -f "$stamp" ] && exit 0
touch "$stamp"

read -r -d '' CONTEXT <<'EOF' || true
Pinball Knight (src/game/pinball-knight/) working notes:

DEBUG SURFACE — installed in every build, drive it from the browser console:
  __lab()                  every lab command + the live monster roster
  __lab.spawn(kind, n)     spawn on the spot; .only(kind) clears first (art QA)
  __lab.ring()             one of every kind in a ring — the roster check
  __lab.floor(n)           jump to a floor; .lock(n)/.unlock() pin every descent
  __dungeonBot({seconds})  headless play; __dungeonBotStop() prints the report
  __dungeonFreshRun()      then reload — the resume floor otherwise blocks
                           floor-1 testing
  __dungeonItems()         ground items, for "picked it up but it's still there"
  __dungeonPad             synthetic gamepad; what playtest.mjs drives

  Spawning BYPASSES level gates. Never restart a run to test a monster.

ADDING AN EnemyKind: nine Record<EnemyKind,X> tables are compile-enforced
(state/factory/reagents/combat/enemy-rules/stagger/bestiary/card-styles/
monster-portrait) — but tsc does NOT run at build (next.config.js sets
ignoreBuildErrors), so run it yourself. The registries it CANNOT see are
covered by scripts/hooks/registry-drift.mjs: the spawnKind switch, the biome
tables in maze/prefabs.ts, EXPANSION_SKIN vs KIND_PORTRAIT, and ESSENTIAL.

REPO: default branch is `main`, not master. `npm run lint` is broken (next lint
was removed in Next 16, and ESLint 9 has no flat config here) — do not trust it.
The suite is 88s unmetered, of which maze/ is 59s. deploy.sh ships the WORKING
TREE.

THE BOX IS SHARED — never hand a run every core. `npm test`, `dev`, `playtest*`,
`audit*`, `webgpu:check*` and `sprites` go through scripts/ops/pk-run.sh, which
takes flock'd THREAD locks (budget = 20 of this box's 24; 2 physical cores are
always held back) and, for browser/perf runs, physical CORE-SLOTS via
with-cores.sh. `npm run ops:status` prints who holds what right now. Measured on
a loaded box: 186s at the default half-budget grant (10 threads), 237s at 6 —
so the meter costs wall-clock and buys back a usable desktop and comparable
timings. Unit-test classes SHRINK on a busy box rather than fail; perf/webgpu
are exact or exit 75, and **75 means the run never started — it is not a red
suite**. `npm run test:raw` bypasses everything and is never a timing datapoint.

ART has three pipelines, pick deliberately: painters (render/monsters/*.ts,
procedural canvas code, the default for anything animated) · sprite-forge
(tools/sprite-forge/, whole PNG sheets: matte→slice→resample→register, for
sanctioned imports like jester/rotortail) · pixel-trace (tools/pixel-trace/,
`npm run pixels -- trace img.png --grid square32`, an image or a from-scratch
sketch → a hand-editable JSON grid of characters→hex, for one-off icons
neither of the other two fits; `--palette coldcrypt` snaps to the real
dungeon palette). None of the three replaces the others.
EOF

hk_emit_additional_context "UserPromptSubmit" "$CONTEXT"
exit 0
