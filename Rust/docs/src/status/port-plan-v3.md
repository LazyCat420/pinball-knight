# Port plan v3 — the remaining 61,852 lines, measured off the ledger

**Version 3 · 2026-08-12 · baseline `main` @ `8cb9415` · method: VCPM
(`.agents/plan-verification-standard.md`).** Every number on this page was
produced today by a named command, on this box, and is reproducible by re-running
it. Nothing is estimated.

**What changed since [v2](one-to-one.md).** v2 measured the remainder with
`scripts/pk-coverage.sh`, a two-signal *heuristic* that v2 itself labelled an
upper bound (ASSUMPTION-1). Its own work item P-1 — the provenance ledger —
landed on 2026-08-12 (`8b7813a`), so the remainder no longer has to be inferred.
**v3 re-baselines every number against the ledger.** v2 stays the definition of
1:1 and the triage of the three handed-in blueprints; where its §5.2 track table
and this page disagree, **this page wins**, because that table was derived from
the upper bound and this one is derived from declarations.

This page answers one question: *what is still to do, in what order, and how
will each piece be known to be done.*

---

## 1. Where the port stands, measured today

### 1.1 The ledger

`cargo xtask coverage` — reads `//! PORTS:` / `PORTS-PARTIAL:` / `PORTS-NOTHING`
declarations, never substrings:

```
legacy PK tree      104309 lines, 296 files
excluded             15997 lines, 34 files  (decisions, see EXCLUSIONS)
1:1 TARGET           88312 lines

  ported             21215 lines, 48 files
  partial              5245 lines, 4 files
  NOT STARTED         61852 lines, 210 files

  converted        24.0%  (ported / target; partial counts as NOT done)
```

24.0%, up from the 22.4% the ledger reported at its own landing commit — the two
commits since (`f3799fe` enemy constants, `8cb9415` `movement.ts`) are the
difference. **The 1:1 target is 88,312 lines, not v2's 91,756**: the exclusion
list grew when it was written down as code rather than prose (`render/monsters/`,
`render/imported-paints.ts` and `testkit/` joined `tools/` and `cel-painter.ts`,
each with the decision that made it attached).

### 1.2 The remainder, per legacy directory

`cargo xtask coverage --by-dir` (new on this branch — see §5, I-4). It
reconciles exactly: the sixteen rows sum to 61,852.

| Legacy dir | NOT STARTED | Files | The headline files |
|---|---:|---:|---|
| `maze/` | 12,014 | 25 | `decorate.ts` 3,169 · `prefabs` 702 · `arc-sweeps` 694 · `doorway-funnels` 687 · `circuit` 634 |
| root | 9,523 | 38 | `hud-face` 1,330 · `abilities` 916 · `boss` 772 · `core` 593 · `secrets` 409 |
| `entities/` | 9,425 | 13 | `player` 2,445 · `zombie` 1,217 · `combat` 1,204 · `marble` 1,005 · `floor-fx` 993 · `projectiles` 807 |
| `engine/` | 5,907 | 19 | `render/sprite` 1,697 · `render/figure` 575 · `tile-shape` 529 (the render half) |
| `dev/` | 5,298 | 17 | `window-hooks` 1,054 (`__lab()`) · `pattern-census` 991 · `funnel-census` 535 |
| `gui/` | 4,523 | 18 | `screens/menu` 809 · `screens/debug` 717 · `screens/hud` 404 |
| `render/` | 3,913 | 17 | `card-styles` 640 · `card-glyphs` 538 (net of every excluded painter) |
| `fx/` | 3,639 | 22 | `system` 540 + the element families |
| `constants/` | 1,797 | 8 | `render` 671 |
| `boot/` | 1,336 | 7 | `sheets` 586 |
| `spawn/` | 1,192 | 4 | `factory` 525 · `floor-populate` 363 · `tide` 261 |
| `run/` | 1,036 | 8 | `descend` 308 · `death` 251 |
| `economy/` | 885 | 5 | `pickups` 243 · `coins` 234 · `shop` 200 — the DUNGEON economy; the tavern's is ported |
| `sfx/` | 712 | 6 | `ambience` 222 · `bus` 161 |
| `sim/` | 528 | 2 | `loop` 506 |
| `input/` | 124 | 1 | `keymap` |
| | **61,852** | **210** | |

Four files are **partial** (5,245 lines) and the ledger prints what each is
missing: `maze/build.ts` 1,898, `render/pinball-parts.ts` 1,611, `state.ts`
1,556, `sim/simulate.ts` 180.

### 1.3 Every gate, run today

| Gate | Command | Result |
|---|---|---|
| workspace tests | `cargo test --workspace` | **1 FAILED** at `8cb9415` — see §5 I-1. With the fix: **867 passed, 0 failed, exit 0** |
| browser parity (debug wasm) | `node scripts/pk-check.mjs` | **ALL GATES PASSED**, console clean, render FPS 31.3 |
| browser parity (**release** wasm) | `trunk build --release` then `pk-check --no-build` | **2 GATES FAILED**, twice — see §5 I-7. FPS 32.1 |
| oracle drift | `bash scripts/pk-drift.sh` | clean — *over `src/` only*, see §5 I-2 |
| dungeon A/B | `node scripts/pk-ab-dungeon.mjs --no-build --level 3 --seed 1` | mean **30.2**, p95 77, over32 **33.8%** |
| intro A/B | `node scripts/pk-ab-intro.mjs --no-build` | five phases, table below |
| tavern A/B | `node scripts/pk-ab-tavern.mjs --no-build` | **1 numeric check FAILED** (highlight clipping) |

**Dungeon** reproduces V-2's sign-off (30.1 mean / 33.6% over32) to within 0.1
and 0.2 pp with the art untouched, so that rig is stable at N=2 across a day.

**Intro**, against the [handoff](handoff.md) baseline taken after the rig was
repaired:

| phase | diff mean (was) | p95 | over32 (was) | median luma L/R |
|---|---:|---:|---:|---|
| run | 16.9 (17.2) | 149 | 11.8% (12.0%) | 166 / 163 |
| bonk | **22.0 (16.9)** | 150 | **18.3% (13.7%)** | 171 / 165 |
| **shatter** | **60.7 (56.7)** | 133 | **79.2% (71.3%)** | **10 / 61** |
| sweep | 25.3 (25.0) | 74 | 40.5% (39.7%) | 40 / 41 |
| title | 13.3 (13.5) | 38 | 14.6% (14.7%) | 10 / 11 |

`run`, `sweep` and `title` reproduce within 0.3. **`bonk` moved +5.1 and
`shatter` +4.0 with neither side's art touched**, which is the honest reading of
this rig's precision: it is ±0.3 on the still phases and unquantified on the two
fast ones, at N=1 per side. Both fast phases need three runs before any number
taken off them is used as a before/after (§5, I-3).

**Tavern**: nine checks pass; one fails — *rust clips 0.349% of pixels out of
range against the oracle's 0.091%, 2.79× on matched room area, allowance 2.5×*.
The tavern was signed off as 1:1 on 2026-08-11 (`bead9a4`) and its own rig has
a red row today; that row is Stage 3's first item, not a footnote.

### 1.4 What the dungeon sheet actually shows

`.checks/ab-dungeon-L3-s1.png`, both sides on the authored L3 seed 1, both
cameras centred on the same start tile (75, 32). The port draws the oracle's
floor. What is on it, and what is not:

| In the oracle's frame | In the port's frame | Owner |
|---|---|---|
| the whole HUD — portrait, health, depth/kills/rage, belt, skills, weapon, minimap | **nothing** | `hud-face.ts` 1,330 + `gui/screens/hud.ts` 404 |
| six monsters closing on the knight | one billboard at the frame edge | `entities/` 9,425 — the horde stands, it does not live |
| dropped weapons, barrels, chests, corpses, skulls | coloured discs and cylinders | `spawn/factory.ts` 525 + the part/prop art |
| bumpers with lit caps, boost chevrons, glowing rollovers | flat quads and plain cylinders | `render/pinball-parts.ts` (partial, 1,611 missing) |
| torch flames with warm pools | orange rectangles, correctly placed | V-4 |
| the knight in gold armour, sword up | a small dark figure | sheet/rung selection |

That table *is* the answer to "what is still missing" for a player, and every row
already has a file and a line count in §1.2.

---

## 2. The one scheduling call this plan makes

The user's order, set 2026-08-11 and unchanged, is **by scene: intro → tavern →
maze**, each finished 1:1 and signed off by an A/B sheet before the next starts.

The last four commits are Stage 4 work (`4A-1`/`4A-2` dungeon wiring,
`constants/enemies.ts`, `entities/movement.ts`) while **Stage 2 has a measured,
unfixed defect** (shatter, 79.2% of pixels over the threshold) and **Stage 3 has
a red check**. Both are small; both are in front of the maze by the standing
order. This plan schedules them first, and says so here rather than burying it in
a queue, because it is the only place v3 changes what happens next.

---

## 3. The queue

### Stage 2 — finish the intro *(smallest scene, gate exists)*

> **2026-08-12: 2-1 and 2-4 were ONE defect, and it is fixed.** The intro camera
> was pinned to `VIEW_H = 11.25` while legacy re-frames every scene to
> `renderH/PPU = 19.29` on every frame — **1.7143× too close**, at every
> `sweep_u` except 1, where `fit_zoom` cancels it exactly. "Shatter too big",
> "sweep framed differently" and "the knight draws several times larger" are
> three symptoms of that one line. See [the route to 1:1](one-to-one-route.md)
> §4 and the board. What remains under 2-1 is the SHARD RATE — the 2D canvas,
> which never touched the camera.

| # | Item | Acceptance |
|---|---|---|
| 2-1 | ~~Shatter is too big~~ **(fixed — the frustum)**. What is left: at t+0.45 s the oracle has collapsed to a thin band on black and the port still fills the frame with SHARDS. Those are `paint_shatter`'s 2D canvas, not the 3D board, so this is a rate/count question with a different owner. | `ab-intro-shatter` over32 from 68.3% into the band the still phases sit in, at N=3 |
| 2-2 | Characterise the rig on the fast phases: three runs per side, publish the spread. | a stated ± on `bonk` and `shatter`, so 2-1's before/after is a measurement |
| 2-3 | Torches, banners and decor on the title maze (the V-4 slice the intro needs). The title sheet shows it plainly: the oracle's top wall carries lit sconces and doors, ours carries none, and that is most of the remaining brightness gap on a phase already down to 13.3 | `ab-intro-title` mean below 13.3 with the sconces lit |
| 2-4 | ~~**The sweep phase is framed differently, and it is not a zoom.**~~ **RESOLVED — it was exactly a zoom.** ⚠️ The reasoning that closed this off is the trap worth keeping: *"both frustums are 20 × 11.25 at 16:9 and `1/zoom` is right"* was true, and measured against the **config default** rather than against what the oracle runs. `syncCameraFrustum` overwrites that default every frame, in `render()`, for every scene. **A frustum that agrees with a config is not a frustum that agrees with the oracle.** What is left on this phase: a **~148 px vertical offset** (the port's board sits high and clips at the top) and the missing top wall / doors / sconces, which is 2-3 | the two frames' board edges land within a few pixels, at N=3 |

### Stage 3 — finish the tavern

| # | Item | Acceptance |
|---|---|---|
| 3-1 | **Highlight clipping 2.79×.** Clipping is what "blown out" is and mean luma cannot see it. Suspects, in order: emissive materials on the keeper sprites, the hearth light's intensity against the oracle's, the cel grade's shoulder. | the tavern rig's ten checks all green |
| 3-2 | Warm spill 6.71% vs the oracle's 23.20% (reported, not gated) — the hearth lights a much smaller area than the oracle's. Decide: real gap or a hard-cut artefact of the fraction. | either a fix, or the check promoted from reported to gated with a stated allowance |

### Stage 4 — the maze *(the bulk — 55k of the 61.8k)*

Ordered so that each block's gate exists before the block starts.

| # | Block | Lines | Gate |
|---|---|---:|---|
| 4-C1 | maze passes 10–23 in `PASS_ORDER` | ~4.3k of `maze/` | 10/10 corpus floors bit-exact per boundary + a sabotage sweep each; re-run the two `connect_all` sabotages at pass 13 |
| 4-C2 | **the `onPass` seam inside `decorateMaze`, before a line of it is ported** | — | the digest certified on its own vectors, 10-floor fixtures, both sides sabotage-verified |
| 4-C3 | `decorate.ts` in its fourteen sections | 3,169 | per-section fixture boundary |
| 4-C4 | `spawn/` — `factory`, `floor-populate`, `tide`, `reaper` | 1,192 | `AuthoredFloor`-level digest, seed → finished plan |
| 4-E1 | the thirteen enemy registries as enums + `EnumMap` (nine `tsc`-enforced, four only `registry-drift.mjs` sees) | part of `constants/` 1,797 | exhaustive `match` + a test standing in for the four the compiler cannot see |
| 4-E2 | `combat.ts`, `zombie.ts`, `projectiles.ts`, `boss.ts`, per-kind behaviours | ~6k of `entities/` | trace fixtures + ported suites + a scripted fight on a fixed seed |
| 4-E3 | `entities/player.ts` 2,445 + `abilities.ts` 916 — the player verbs, and P1's unwired remainder (`marble` 1,005, multiball, ricochet, plunger, ramps, trapdoors, pits, targets/rollovers/lamps) | ~4.4k | new trace fixtures **at pinball speeds** (sub-stepping) + input driven from pk-check |
| 4-D1 | `dev/window-hooks.ts` — the `__lab()` surface: spawn, ring, floor-jump, the headless bot | 1,054 | spawn one of every kind on demand, in the running build |
| 4-V1 | `engine/render/sprite.ts` 1,697 + `figure.ts` 575 + `boot/sheets.ts` 586 + the real `xtask bake` (`assets/sprites/` is **empty**; bare `xtask bake` still returns FAILURE) | ~3k | per-rung atlases loaded, monsters drawn from them, A/B per rung |
| 4-V2 | `fx/` — the element families, puffs, decals, screenshake | 3,639 | A/B per family |
| 4-F1 | HUD: `hud-face.ts` 1,330 + `gui/screens/hud.ts` + minimap + toasts | ~2k | the dungeon sheet's HUD row goes from *nothing* to matched |
| 4-F2 | run flow + persistence: `run/` 1,036, `gui/screens/{menu,game-over,haul,character-select,shop}`, saves | ~3k | a full descend→death→ledger loop driven headless |
| 4-G1 | `economy/` dungeon side — pickups, coins, loot, ground items | 885 | ported suites |
| 4-G2 | `sfx/` remainder behind the **spectral-diff rig that does not exist** | 712 + the rig | build the rig first, then sign off |

### Stage 5 — sweep and cutover

Port the remaining vitest logic suites (**228 files, 41,877 lines** — selectively,
by subsystem, as each lands), rebuild the playtest bot against the Rust build,
`xtask dist` under a size budget, deploy, then demote `legacy/` from oracle to
reference. The ledger reads 100% or the cutover does not happen.

---

## 4. The benchmark and performance suite *(new — P0's last unchecked box)*

The checklist has carried "*perf baseline page in docs: record FPS/frame-time
from pk-check per commit*" unchecked since P0. Today the entire performance
story is one line of pk-check output — `render FPS: 31.3` — with **no budget, no
history and no scene breakdown**. Today's other two numbers (32.1 ms in the
dungeon banner, 41.2 ms in the intro's shatter frame) come from the same debug
build.

The obvious objection — *debug is several times slower than the shipped build,
so these are numbers about the build* — was tested rather than assumed, and it
is **false**: a release wasm build measures **32.1 fps against debug's 31.3**.
Whatever costs 31 ms a frame is not the Rust build, and B1 below rules out the
sim as well. So the suite is not a nice-to-have that follows the port; it is the
only way to find out where the frame actually goes.

Three layers, cheapest first. **B1 is built and its first baseline is below**;
B2 and B3 are specified and unstarted.

### B1 — the sim, headless and deterministic — ✅ **BUILT**

`cargo run --release -p pk-core --example perf_suite` (`--json` for a machine
row, `--reps N` for more samples). An example rather than `cargo bench`, because
the bench harness is nightly-only and the workspace has no criterion; one
dependency is a real cost for a table of medians. Every case runs N reps and
prints **median, min, max and spread**, because on a shared box a single number
is not a measurement and the spread is what says whether the run was clean.

**First baseline — release, 5 reps, L3 seed 1 (87×61, 3,482 walkable), box at
load ~5:**

| case | median | spread | what it says |
|---|---:|---:|---|
| `simulate_idle` | 9.6 ns | 14% | |
| `simulate_walk` | 44.9 ns | 11% | |
| `simulate_pinball` | **299.2 ns** | 7% | the ride costs **6.7× the walk** — that is `move_circle`'s sub-stepping, and it is the reason the case exists |
| `move_circle` | 32.4 ns | 7% | |
| `build_floor_L1 / L3 / L5` | 3.31 / 4.20 / **5.28 ms** | 3-4% | nine of twenty-three passes. Whatever the remaining fourteen cost, they are added to this — the floor build is a loading-screen budget, and this is the first number it has ever had |
| `bfs_distances` | 16.5 µs | 7% | |
| `flow_step_x1000` | 7.6 µs | 8% | 7.6 ns per steering decision — 72 monsters at 60 Hz is **33 µs/s**, so the horde's AI is free and will not be what slows the game |
| `js_pow` vs `std_powf` | 36.8 ns vs 8.7 ns | 7% / 2% | **the price of determinism, measured for the first time: 4.2×.** It is worth paying — it is why the exe, wasm and native agree — but it is now a number instead of a shrug |
| `js_hypot` vs `std_hypot` | 2.7 ns vs 3.9 ns | 6% / 3% | and the other twin is *faster* than std |

**The finding that reorders this whole section: the sim is not where the frame
goes.** A frame at the measured 32 fps is 31 ms. The sim's most expensive tick —
the pinball ride, sub-stepping — is 0.0003 ms of it, about **one part in
100,000**. Every remaining millisecond is render, and no instrument in this
project can currently see inside it. That is B2's job, and it is now the only
performance work with any evidence behind it.

The case that could most easily have lied is guarded: `simulate_pinball` asserts
the knight actually moves more than a walk could before it times anything,
because `update_pinball` returns at its first line when `mom_speed <= 0` and a
mis-armed setup would have timed the walking branch under a pinball label.

No budgets are asserted yet. Three green baselines on a quiet box, then band.

### B2 — the frame-time series, measured in-engine

`__pk.perf`: a per-frame accumulator inside the app — p50 / p95 / max / count over
a window — **not** a sampled probe. The probe already learned this once: it
publishes every 5 frames and a transient state vanished between samples. A
sampled frame time misses exactly the excursions a budget is about.

Alongside the timings, the counts that explain them: entities, merged meshes,
lights, materials, and draw calls where Bevy's diagnostics expose them.

**Its first question is already set by B1**: 31 ms a frame, of which the sim is
0.0003 ms and the build accounts for none of it. So B2's first row must split
the frame — CPU extract/queue vs GPU — and the first suspect to price is the
post chain at 1920×1080, because it is the one pass that costs the same whether
the dungeon has 102 parts on it or none. A scene-count sweep (empty floor vs
L5's 121 parts) separates "the room is expensive" from "the chain is", and it is
one afternoon's work with the accumulator in place.

`pk-check` drives it across the scenes — intro (per phase), tavern, dungeon
L1/L3/L5 authored, dungeon generated — and appends one row per run to
`docs/src/status/perf-log.md` plus a machine-readable `.checks/perf-<sha>.json`.
**Release builds only for judgement**; a debug row is recorded but labelled, and
never compared against a release one.

### B3 — head-to-head against the oracle

1:1 includes cost. The same scene, seed and viewport, both sides in host Chrome,
**interleaved A/B/A/B** rather than run-then-run — a loaded shared box drifts
over minutes and a sequential comparison measures the drift. Report medians with
the spread; never a single number, and never a mean of two maxima taken from
different samples.

The play target is the Windows exe, so the number that decides "does it feel
right" is the release exe's frame time, not the browser's. That needs a capture
path the project does not have yet — it is the one piece of B2 that is new work
rather than wiring.

### The traps this suite must not walk into

- **A budget is not a wish.** Blueprint B's "<30 s bake" and "60 FPS on
  low-power devices" were both rejected in v2 for having no measurement behind
  them. Every budget here derives from a recorded baseline.
- **The box is shared.** Anything timed takes its cores through a lock and says
  how many it had; a timing without its concurrency is not reproducible.
- **Debug ≠ release ≠ wasm ≠ exe.** Four builds, four cost profiles. Every row
  carries its target.
- **A profile that indicts the code you were already being lobbied to rewrite
  deserves one measurement first.** The ">13 minute" bake was a browser defect,
  and all three suspects were inside the painters two blueprints wanted
  transcribed.

---

## 5. Instruments that need repair (found while measuring this page)

| ID | Finding | Status |
|---|---|---|
| **I-1** | **`cargo test --workspace` is RED at HEAD.** `the_generated_enemy_table_still_matches_the_oracle` compares the exporter's output byte for byte with the committed `enemies.rs`, and the exporter emits **one trailing blank line** that `cargo fmt` strips — so the file cannot round-trip through the formatter and the gate has been red since `f3799fe`. Its message said `committed: (length differs)` / `oracle: (length differs)`, naming neither side. | **fixed on this branch**: the exporter drops the trailing push; the message now prints bytes and lines when no line differs. Sabotage-verified — moving `REAPER_SPEED_MAX` 6.2 → 6.3 still fails, and now names the constant |
| **I-2** | **`pk-drift.sh` covers `src/` only.** `public/sprites` already differs: `legacy/` carries `goblin-S`, `reaper-S`, `slime-S`, `spider-S` (8 files) that `braindeadbot-client` does not. Art is oracle state — the A/B rigs photograph it — so the drift gate's guarantee has a hole the size of the sprite tree. | open — extend the diff to `public/sprites`, with the same legacy-ahead allowlist |
| **I-3** | **The intro rig's precision is unstated on the fast phases.** `bonk` +5.1 and `shatter` +4.0 across a day with no art touched. At N=1 per side, a 4-point improvement claimed on either phase is indistinguishable from noise. | open — Stage 2-2 |
| **I-4** | `coverage --todo` printed 40 of 210 files with no note, which reads as a complete work list. | **fixed on this branch**: `--by-dir`, `--all`, and a line naming the withheld files and lines |
| **I-5** | **`pk-ab-dungeon` never checks that the two sides photograph the same place.** It reads legacy's `probe().player` and prints only `level` and `stairs`. Today they do agree — both frames are centred on start (75, 32), verified by eye — so 30.2 is a real number; nothing keeps it that way, and a start-tile divergence would silently turn every future number into a comparison of two different rooms. | open — assert pose equality and **throw rather than shoot**, the same repair that fixed the intro rig |
| **I-7** | **`pk-check` has only ever been run against a DEBUG build, and the RELEASE build fails two of its gates.** Reproduced twice on `trunk build --release`: *intro hands off to the tavern hub* and *tavern probe carries a pose (no probe)*. On the same run the click-skip path into the tavern PASSES and every tavern gate after it passes, so the hub does build — the failure is at the natural-handoff **sampling edge**: the loop takes its one reading at the first poll where `intro === null`, and on a faster build that instant can land before `TavernRes` exists. Stated as the likely mechanism, not as a diagnosis; it needs the poll widened and one re-run to settle. Second observation from the same pair of runs: the sim-rate gate reads **66 Hz on debug and 72 Hz on release** for a sim that should be fixed-step. | open — and it is the gate the whole project treats as the definition of "green" |
| **I-6** | Both rigs report ~17 failed sprite requests on the *oracle* side and warn "a side missing its art is not a side to judge". They are the oracle's own optional facings — `boot/sheets.ts` says *"W is drawn as a flipped E"* and missing facings reuse what loaded — and **neither tree ships `-N` sheets**. The warning is noise that will cost someone an investigation. | open — allowlist the optional facings so a real 404 stands out |

---

## 6. Risks and assumptions carried forward

v2 §8's four risks all still stand (host-GPU-only visual gates; class-2 gates
certify silence; libc-resolved calls are ungated until run on all three targets;
the oracle can be wrong and still be the oracle). Two are re-stated because this
page's numbers depend on them, and one is new:

- **ASSUMPTION-2 (v2) — `braindeadbot-client` stays frozen.** Still true for
  `src/` (no commit since 2026-08-09) and **already false for `public/sprites`**
  (I-2).
- **ASSUMPTION-4 (new) — an A/B mean is a comparison of the same scene.** It is
  checked by eye today and by nothing automatically (I-5).
- ~~**RISK-5 — every performance number in the project is a debug number.**~~
  **Measured today, and the assumption behind it was wrong.** A release wasm
  build renders at **32.1 fps against debug's 31.3** — the frame rate is not
  build-bound at all. With B1 showing the sim's worst tick at 0.0003 ms of a
  31 ms frame, **the cost is entirely render-side and nothing in this project can
  see inside it**. The standing risk is now sharper: *no instrument exists for
  the 31 ms that matters*, which is B2.
- **RISK-6 (new) — the release build is ungated.** Every green `pk-check` in the
  project's history is a debug-build green, and the release build fails two of
  its gates today (I-7). The shipped artefact has never passed the gate.

## 7. Rollback

Unchanged from v2 §9: every stage is a worktree branch merged `--ff-only`, and
the rollback is the merge commit. This page adds no irreversible move.
