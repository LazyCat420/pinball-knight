# Completion plan — the route from here to cutover

The [port checklist](port-checklist.md) is the *inventory*: every subsystem,
what state it is in. This page is the *route*: the order the remaining work has
to happen in, what gate each stage is allowed to claim done against, and which
of those gates does not exist yet.

Written 2026-08-10 with `main` at `ce686f6` (P2 pass 2 landed). Every number
below is measured from the tree on that day, not estimated.

## Where the port actually stands

`legacy/src/game/pinball-knight` is **104,205 lines of source** plus 41,646
lines of test. Rust so far is **26,712 lines** (pk-core 15,236 + pk-game 9,054 +
pk-audio 2,319 + pk-assets 103) plus 1,779 lines of integration test, built in
two days against five bit-exact fixtures.

| Area | Legacy src | Ported | Remaining | Gate class |
|---|---:|---:|---:|---|
| Sim primitives (rng, jsmath, grid, collide, tile-shape, surfaces) | ~1.6k | all | — | bit-exact |
| P1 pinball physics | ~6.0k | ~1.0k | **~5.0k** | bit-exact trace |
| P2 maze `buildTrackFloor` (23 passes) | ~10.7k | 1.1k (2 passes) | **~9.6k** | pass digests |
| P2 content half-B (`decorate`, prefabs, assembly, surface-paint) | ~5.4k | — | **~5.4k** | **no gate yet** |
| P2 fallback (`generator`) | 0.4k | — | 0.4k | pass digests |
| P3 render (minus baked `cel-painter`) | ~12.0k | ~2.0k | **~10.0k** | visual A/B |
| P4 entities + combat + root gameplay + spawn + economy | ~20.0k | — | **~20.0k** | ported tests + trace |
| P5 GUI, HUD, run flow, saves | ~6.8k | ~3.4k *(unmerged)* | ~3.4k | fixture + flow script |
| P6 tavern | ~13.5k | core+shell | debt only | A/B (rig exists) |
| P7 FX + audio | ~2.2k | ~0.6k | ~1.6k | **spectral diff — no rig** |
| P8 parity sweep, playtest bot, deploy | — | — | all | soak + budgets |

Roughly **60k of 104k legacy source lines remain**, and the cheap half is the
half that is done: what is left is the render layer and the entity/combat mass,
neither of which has a bit-exact oracle.

## The rule that orders everything

A phase is scheduled behind its gate, never in front of it. That rule is why P0
came before P1 and why the 23-pass digest harness came before a single line of
maze code — and it has already paid twice (pass 1's first run localised to
`grow_network` in one read; pass 2's boundary turned out to pin only a count and
had to be widened before the port could be believed).

Three gate classes, in descending strength:

1. **Bit-exact fixture** — a golden trace or digest exported from the live
   legacy pipeline, replayed in Rust for equality. Available for anything
   deterministic: physics, maze, entity logic, economy.
2. **Ported behavioural tests** — the legacy vitest suite transcribed. Weaker:
   green means "not obviously wrong", which a mis-ordered rng draw also is.
3. **Visual / audible A/B** — a human verdict off matched frames or a spectral
   diff. The only option for rendering and FX, and the reason those phases are
   the schedule risk rather than the line count.

**Two gates in class 3 do not exist yet**, and both are prerequisites, not
follow-ups:

- **Dungeon visual A/B.** `scripts/pk-ab-tavern.mjs` is the template and it is a
  good one — it pins both sides to 1920×1080 because that is the *only* regime
  where legacy's scale-derived render target lands at zoom exactly 1.0, asserts
  the viewport before either shot, and leaves a heatmap plus loose numeric
  receipts. It is tavern-specific. P3 needs the dungeon equivalent at a matched
  seed and camera, and it must be written before the render port starts.
- **Audio spectral diff.** P7 says "by ear vs TS + offline render spectral
  diff". No such script exists. Nothing in P7 has been signed off.

## The route

### Stage A — unblock (small, and everything downstream is cheaper for it)

1. **Land or retire `.worktrees/wt-gui-port`.** Two unmerged commits, ~3.4k
   insertions: a `pk-gui` crate (im toolkit on a CPU painter, font baked from
   the browser that authored it) with legacy-painted golden fixtures. It is
   based on `6fe8452`, so its diff currently *deletes* the board and incident
   entries main has added since — merging it needs the docs conflict resolved in
   main's favour. Its owner is the only one who knows if it is finished; ask
   before touching it. This is most of P5's foundation and P3/P5 both want it.
2. **CI — there is none.** No `.github/` at all. At 28k lines of Rust, 2,652
   legacy vitest tests and four build targets, the missing CI is now the largest
   unforced risk in the project. What it can run: fmt, clippy (deny-level — they
   abort the *whole* workspace lint, which already hid four errors and left
   pk-game/pk-audio/xtask unlinted), `cargo test`, legacy vitest, the wasm build,
   the wasm-size budget, and the windows-gnullvm build. What it **cannot** run:
   `pk-check`, because SwiftShader cannot run the Bevy wasm app at all. Host
   Chrome on this box stays the manual gate; CI covers everything else.
3. ~~**Measure `jsmath` under `wasm32-unknown-unknown`.**~~ **DONE
   2026-08-10, and it was a live defect on BOTH non-native targets.** The
   suspicion was right and understated: wasm's `powf` is fdlibm (19,904 /
   200,001 on x^1.35), and windows-gnullvm — the *play* target — is a third
   implementation again (201 / 200,001, and not fdlibm). Two unrelated causes,
   which is why enumerating targets was never the fix. `js_pow` now carries
   ARM's optimized-routines `pow`, fusion-for-fusion; all three targets
   reproduce the runtime. Gate: `node scripts/jsmath-wasm-check.mjs` (no GPU, so
   CI can run it) plus `cargo test --target x86_64-pc-windows-gnullvm -p pk-core
   --test jsmath_oracle`. Details in the [checklist](port-checklist.md); the
   general lesson is that a "✅ std" in the `jsmath` table was a claim about one
   machine, and every remaining ✅ there is now target-independent by
   construction.
4. **Write the `intro.rs` camera fixture** so the last two `jsmath` call sites
   can be switched with a gate behind them, instead of sitting as documented
   debt.

### Stage B — finish P2 (the largest gated block, and P4 is waiting on it)

Passes 3–23 in `PASS_ORDER`, each bit-identical at its boundary before the next
starts: `carve-track` → `plaza` → `launch-chute` → `grow-maze` →
`endpoints-early` → `repair-1` → `plan-doorways` → `publish-arcs` →
`orbit-island` → `arc-sweeps` → `repair-2` → `endpoints-final` → `boss-chamber`
→ `artery-banks` → `reseal-chute` → `carve-doorways` → `funnels-relays` →
`compact-fixed-point` → `stairs` → `arc-rails` → `done`. Next up is **pass 3,
`carveTrack`** (`maze/track-carve.ts`, 664 lines) — it is also where the P1 arc
features start being authored, so it closes a loop with the physics already
ported.

Then two items the checklist lists but the harness does not cover:

- **`decorateMaze` is outside the gate.** `buildTrackFloor` is half A —
  topology. Half B is `decorate.ts` (3,169 lines: parts, zombies, torches, arcs,
  rooms) called from `core.ts`, and the `onPass` seam exists in `track-floor.ts`
  **only**. Grepped: no other module has one. So the 23 green boundaries will
  certify a floor's shape and say nothing about what is standing on it — and
  half B is what P4's entities and P3's dressing both read. Extend the seam into
  `decorateMaze` before porting it, on the same terms as the first harness: the
  digest certified on its own vectors before it is pointed at a floor.
- **The growing-tree fallback last.** `generator.ts` (434 lines) runs on no
  floor a player sees — measured, `buildTrackFloor` declined 0 times in 400
  floors. Port it for completeness at the end of P2, not before.
  *(Correction, 2026-08-10: this bullet and the table above used to say
  "`generator.ts` + `build.ts`, 2.3k". `build.ts` is 1,834 lines of **three.js
  renderer** — grid → two `InstancedMesh` wall passes, torch sconces, a
  `PointLight` pool — not a generator at all. It is Stage D work and P2 is 1.9k
  smaller than the table claimed.)*

Exit: 10/10 corpus floors bit-exact at all 23 boundaries *and* through decorate,
`buildTrackFloor` wired into `setup_dungeon` replacing `demo_floor`, pk-check
green on a real generated floor.

### Stage C — finish P1 and wire the verbs

The sim is ready and the game still only walks. Open: ramp/jumppad hops,
trapdoor, pits, targets/rollovers/lamps, plunger, `marble.ts` (1,005),
`multiball.ts` (341), `ricochet-form.ts` (342), and the player verbs on top —
sprint charge, wall-kick, pounce (`entities/player.ts` 2,445 + `abilities.ts`
916). Gate: new trace fixtures **at pinball speeds** so sub-stepping is
exercised, plus the shell input wiring driven from pk-check. This is the stage
that makes the Rust build feel like the game rather than a walking demo — worth
pulling ahead of Stage B if a playable milestone matters more than breadth.

### Stage D — P3 rendering (the schedule risk)

Write the dungeon A/B rig first (see above). Then, in this order because each
unblocks the next: real `xtask bake` per-rung atlases (replacing the embedded ÷4
sheets) → `animator.ts` clip timing → room dressing (wall/floor materials,
lighting, biome looks) → `pinball-parts.ts` (1,611) + arc kickers/lanes +
`part-instancer` → palette-swap shader → damage text. `cel-painter.ts` (4,785
lines) is **baked offline, never ported** — that decision is what keeps this
phase at ~10k instead of ~15k, and the bake pipeline is the thing that has to be
real for it to hold. The pixel-pass port is written but unverified; its sign-off
is the first thing the new A/B rig should be pointed at.

### Stage E — P4 entities and combat (the largest single mass, ~20k)

Order: the nine `Record<EnemyKind,X>` registries → enums + `EnumMap` first
(everything else indexes them) → `spawn/` → `combat.ts` → `movement`/AI/
flow-field → per-kind behaviours → `boss.ts` → root gameplay (`state.ts` 1,556,
`cards`, `abilities`, `skills`, `items`, `secrets`, `economy/`). Gate: the
ported entity/spawn suites, combat trace fixtures, and a pk-check scripted fight
on a fixed seed. Needs Stage B's decorate to place anything.

### Stage F — P5 GUI and run flow

On top of Stage A's `pk-gui`: pixel fonts, HUD (`hud-face.ts` 1,330, meters,
minimap, floor-map overlay, toasts), ESC menu, backtick debug panel + the
`__lab` equivalent grown out of `window.__pk`, the screens (shop,
character-select, haul, game-over, floor-loading), run flow
(`descend`/`death`/`ledger`/`grade`/`lobby`/`corpse-run`), and saves (native file
/ wasm localStorage). This is where "what the user still sees missing" lives.

### Stage G — P7 FX and audio remainder

Build the spectral-diff rig, then: the remaining element families (fire, frost,
water, molten, goo, rod, noise), puffs, heat haze, decals, `juice.ts`
screenshake, and every patch family beyond tavern/intro
(combat/monsters/weapons/pinball/world/run) plus the bus, the gate, the wasm
gesture unlock and the master mute — `PK_MUTE=1` / `?mute=1` are documented as
planned and **no mute gate exists in `crates/` yet**.

### Stage H — P8 parity sweep and cutover

Port the remaining vitest logic suites wholesale; rebuild the playtest bot
against the Rust build (soak + stuck detection); `xtask dist` (wasm-opt +
brotli) under a size budget; Docker static container → Synology → Cloudflare;
then link from braindeadbot.com. Multiplayer (`net/`) and the leaderboard client
are a decision point here, not an assumption. **Cutover means legacy is demoted
from oracle to reference** — until that day `legacy/` is load-bearing and
`braindeadbot-client` keeps serving the live game untouched.

## Standing risks

- ~~**The shipped target is not the gated target.**~~ **Was true, and the
  "exe half is closed by the sim being target-deterministic" line was the wrong
  half to relax.** Measured 2026-08-10: the exe was the *worse* of the two, with
  its own third-party `pow`. Target-determinism is not a property the sim had —
  it is one every primitive has to be built to have, and `js_pow` was the one
  that deferred. Closed for `jsmath`; the standing form of the risk is now
  narrower and sharper: **any call that resolves through the target's libc is
  ungated until it is run on all three targets**, and the two cheap gates for
  that (`jsmath-wasm-check.mjs`, the windows `cargo test`) exist and take
  seconds. Run them when a new primitive lands, not when a floor looks wrong.
- **Every visual and end-to-end gate needs the host GPU.** SwiftShader cannot
  run the app, so pk-check and both A/B rigs are manual, on a quiet box, on this
  machine. That caps how much of the gate story CI can ever own.
- **Class-2 gates certify silence.** Where only ported tests exist (most of P4),
  a wrong draw order passes. Prefer a trace fixture wherever the subsystem is
  deterministic — which, in this codebase, is nearly everywhere.
- **The oracle can be wrong and still be the oracle.** Pass 2 found a real
  tangency defect in the original (`radii[0]` clamp, 1.81 tiles). The rule holds
  anyway: reproduce it bit-exactly, pin it as its own test, and fix it after
  parity is declared — never during.
