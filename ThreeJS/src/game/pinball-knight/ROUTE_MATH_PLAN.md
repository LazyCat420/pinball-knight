# Pinball Knight — Route Geometry & Map Generation Math (v2)

Revision of the route-math plan, corrected against the code as it exists at
`ff80e97` (shaped walls + curves live, station spine live, 4× floors live).
Pure geometry/algorithms — no feature work. Sections marked **[SHIPPED]**
already exist; the plan builds on them instead of re-inventing them.

---

## Part 0 — Corrections to the v1 plan (read first)

The v1 draft made five assumptions the codebase contradicts. Everything later
in this doc is written against the real engine:

1. **There is no 2:1 diamond transform.** The game renders true 3D through a
   tilted/yawed orthographic camera; world space IS tile space, 1:1
   (`tileCenter`: tile `(i,j)` centre = `(i+0.5-w/2, j+0.5-h/2)`). All route
   math happens in tile space with **no projection step at all** — the
   `wx=(col-row)·TILE_W/2` formula from v1 must not appear anywhere.
2. **The RNG is `mulberry32`** (`utils/rng.ts`, re-exported from
   `maze/generator.ts`), one seeded stream per `(run, level)` — not the
   holo-card LCG. Retry seeds must be a **substream** (`hash(seed, attempt)`),
   *not* `seed+1`: `seed+1` is literally the next thing a neighbouring
   consumer may derive, and colliding streams correlate floors.
3. **Wall-punch already exists — do not invent `PASSTHROUGH`.** `T_CRACKED`
   is a wall the pinball smashes at `≥ SECRET_BREAK_SPEED` (cost ×0.85), solid
   to the walking player; the A1 `launchBreaks` system already places them at
   runway ends, and `openLaunchTargets` already owns the safety invariants.
   §5.5 below becomes "place a cracked band on a route edge", full stop. A
   shapes-array `PASSTHROUGH` would also break the `shapes`-only-meaningful-
   on-walls contract that collision relies on.
4. **Curves already shipped.** `SHAPE_ROUND_NE..SW` (ids 5–8) exist beside
   the four slants, with `roundToSlant()` mapping each arc to its chord —
   which is exactly the generation-time approximation §2 needs. Catmull-Rom
   stamping (§7) should emit ROUND shapes via the existing
   `computeArcCorners`/decorate conventions, not a parallel system.
5. **The spine is built.** `traceArtery()` + `layStationSpine()` +
   tributary-merge rules + the `spine: true` exemption flag are live, with
   `corridorBudget` measured after the spine. §6's `buildFloorGraph` must
   **replace `layStationSpine`'s run-laying while keeping its seams** (the
   flag, the budget ordering, the `openLaunchTargets` interplay) — a second
   parallel spine would fight the first.

Also two physics realities that change the math (from `entities/player.ts` +
`constants.ts`):

- **Speed is not conserved.** Flat-wall restitution is just under 1 (no
  parallel-wall farming), corner banks pay `×PINBALL_CORNER_RESTITUTION +
  PINBALL_CORNER_ADD` (can gain, capped at `PINBALL_MAX_SPEED = 22`), slant
  hits and cracked-wall smashes pay ×0.85, and `PINBALL_FRICTION = 0.9 u/s²`
  linear decel is **multiplied by per-surface openness**. Route feasibility is
  therefore a *speed* question, not just a topology question → §2b.
- **Ramps/rides use Catmull-Rom already** (`ridePts`/`ridePoint` in
  `player.ts`). §7 should reuse that sampler, not add a second one.

---

## Part 1 — Coordinates & the 8-heading algebra

Route math runs on integer tiles with headings drawn from the 8 compass
directions, `Vec2 = {dx, dz} ∈ {-1,0,1}²ᐨ⁰`. Diagonals advance √2 world units
per step — distance budgets must use `hypot`, not step counts, wherever they
feed the speed model (§2b).

The closed reflection algebra (v1's core idea, kept):

- Flat N/S face: `(dx,dz) → (dx,−dz)`; flat E/W face: `(−dx,dz)`.
- Slants collapse to two ops regardless of quadrant: **swap** `(dz,dx)` for
  NE/SW normals, **swap-negate** `(−dz,−dx)` for NW/SE.
- ROUND tiles participate via `roundToSlant(shape)` — the chord — so the
  8-heading set stays closed at generation time. The real engine banks
  continuously around arcs; the chord approximation is validated by the §6c
  physics replay, never trusted blind.

Precompute the full `(heading × surface) → heading` table (≤ 8×9 entries) at
init and **pin it with a table-driven test against `shapeNormal()` and the
formula `v' = v − 2(v·n̂)n̂`** — v1's hand-written slant table had at least one
sign doubt in it ("not minus — test this"); the test IS the answer to that.

## Part 2 — `marchRay` (tile-space ray march)

As v1, with three amendments:

- Honour the collision contract: square sweep semantics for FULL tiles,
  shaped tiles resolve via their (chord) normal — mirroring how
  `moveCircle`/`resolveShaped` split ownership, so generation and physics
  can't drift.
- `T_CRACKED` is a **conditional surface**: it reflects below
  `SECRET_BREAK_SPEED` and transmits (×0.85 speed) at or above it. `marchRay`
  returns both outcomes; which one the route uses is decided by §2b.
- Out-of-bounds reads are walls (`at()` already guarantees this) — no
  bounds-checking in the marcher.

## Part 2b — Speed-interval propagation (NEW, the load-bearing addition)

v1 traced pure geometry; a route can be geometrically perfect and physically
dead (ball arrives too slow to punch a wall, or dies mid-lane). Annotate every
graph edge with a **speed interval** `[v_lo, v_hi]` and propagate it forward
through the DAG like interval arithmetic:

- **Friction over a leg of world-length L on surface openness σ:**
  linear decel `a = PINBALL_FRICTION · σ`, so
  `v_out = sqrt(max(0, v_in² − 2aL))`. A leg is dead if `v_lo,out` falls
  below the pinball exit threshold before the next redirect.
- **Per-surface multipliers:** flat wall ×rest(≈0.97), slant/crack ×0.85,
  corner bank `×PINBALL_CORNER_RESTITUTION + PINBALL_CORNER_ADD`, booster/
  spring/bumper: reset toward their launch speeds (clamp 22).
- **Feasibility checks become interval checks:** a cracked-band edge needs
  `v_lo ≥ SECRET_BREAK_SPEED` at that point; a ramp hop needs its launch
  window; a lasso needs enough speed to complete all three legs.
- **Booster spacing falls out of the math instead of being guessed:** with
  bounce losses dominating friction, the sustainable bounce count between
  boosts is `n_max = ln(v_min/v_0) / ln(rest_eff)` (≈ 10–11 for v₀=12,
  v_min=2, rest_eff≈0.85 worst-case) — so the rule is "re-boost every ≤ 8
  redirects", and pure distance is almost free (`(v₀²−v_min²)/2a` ≈ 78 tiles
  at σ=1). v1's stride-3-4 boosters were far denser than physics requires;
  keep them dense for *feel*, but the validator's floor is the formula.

## Part 3 — Dominant flow **[SHIPPED, formalized]**

`traceArtery()` is the flow source. Define the potential `φ(t)` = BFS distance
to stairs; dominant flow `f̂ᵢ` = artery forward-difference (equivalently −∇φ
along the artery). Keep v1's rules verbatim: spine segments need
`f̂ᵢ · exitDir > 0`; perpendicular (dot = 0) allowed only for branches, which
must re-enter with `spineFlowAt(reentry) · branchExitDir > 0`.

## Part 4/5 — Segment catalog (amended)

| Segment | v2 status |
|---|---|
| Straight run | As v1. Booster density per §2b, laid with `spine: true`. |
| 90° banked turn | As v1 — exploit existing walls, zero new tiles. Cheapest; weight it highest early. |
| 45° turn | Place one SLANT via the §1 table. **Anti-pinch gate:** never reduce a 2-wide corridor's clearance (the shipped curve pass has this rule; inherit it). |
| Continuous bank (NEW) | Place a ROUND corner on a route bend — the engine's `bankArcCorners` already redirects momentum leg-to-leg. Algebra uses the chord; physics replay validates. |
| S-curve | As v1 (lateral offset `dz`, two 90° walls). Wall-adding → must pass the union-find connectivity recheck (below). |
| Lasso / loop-back | As v1 §5.4 with heading quantization `argmin ∠(d, AP)`; min amplitude 3, K ≥ 4. Legs must satisfy §2b intervals. |
| Wall punch | **Reuse `T_CRACKED` + `openLaunchTargets` invariants.** Perpendicular-only rule stays (cardinal travel ↔ cardinal face). Never on an artery walk tile. Speed-gated per §2b. |
| Ramp arc | As v1; overflown wall band ∈ [1,2] tiles; reuse the existing hop maths (`RAMP_HOP_*`, sin(πt) arc). |

**Placement discipline (lessons already paid for in this repo):**
- The no-repeat shuffle bag holds segment **types**, orientation drawn after —
  the archetype bag had exactly this bug (four rotations of one shape read as
  repetition).
- Carveability/clash tests run **inside** the candidate-scoring loop, not
  after scoring — the hot-zone stamp bug (only-smallest-shape-ever-fits) came
  from testing after.
- Everything carve-only keeps connectivity monotone for free. The two
  wall-adding segments (S-curve, lasso) must run `stitchCells`-style
  union-find on the affected region and **revert on failure** — same pattern
  as `stampCurveCourts`' spine-burial revert.
- Player and ball are different audiences: walkability ignores shapes and
  cracked walls are solid to feet, so no segment may sever the walking
  start→stairs path. This is exactly the existing `floor-pipeline` invariant;
  extend that test, don't write a parallel one.

## Part 6 — Graph growth **[replaces `layStationSpine`'s run-laying]**

Keep v1's spine-first skeleton and weights table, with:

- Weights shift by depth (more turns/punches deeper) — as v1.
- Branch split 0.6 loop-back / 0.4 rewarded dead-end — as v1.
- Segments emit **`PinballPartSpot[]` through the existing decorate plan**, so
  `pinball-collide.ts`'s exhaustive handler and the `spine` exemptions keep
  working; a new part kind stays a compile error until handled.
- Budget seam preserved: graph parts are the spine layer; `corridorBudget` is
  measured after, as today.

## Part 6c — Validation is three tiers, and tier 2 is non-negotiable

1. **Graph traversal** (v1's `validateFloorGraph`) — cheap topology check,
   `'stuck' | 'escaped' | 'valid'`.
2. **Physics replay (NEW):** run the ball through the REAL `moveCircle` with
   the §2b speed model — the intro's `stepIntroBall` proved this costs
   milliseconds for minutes of simulated flight (it soaks 2 sim-minutes at
   120 Hz in a unit test today). Assert the replay reaches the stairs region
   and that every speed-gated edge fired. This catches chord-vs-arc drift and
   quantization lies that tier 1 structurally cannot see.
3. **ASCII goldens, read by a human.** Every generation bug that mattered in
   this repo (hypostyle pillars, orientation-bag repeats, cluster collapse)
   was invisible to invariant tests and obvious in one ASCII render. Add a
   deterministic `routeAscii(seed)` dump: spine `═`, branch `─`, loop `╭╮`,
   punch `✕`, boosters `»`. Goldens live beside `floor-pipeline.test.ts`.

Retry on failure with `mulberry32(hash(seed, attempt))`, bounded attempts,
then fall back to the current (non-graph) decorate pipeline for that floor —
never ship an invalid floor, never infinite-loop generation.

## Part 7 — Catmull-Rom stamping

Keep v1's formulation, with: reuse the `ridePoint` sampler; stamp **ROUND**
shapes (not just slants) picked by tangent octant; apply the anti-pinch gate;
and clamp sample rounding so two adjacent samples never stamp diagonal-only
adjacency (a ball can thread a diagonal gap the player reads as solid).

## Part 8 — Determinism

As v1 (fixed consumption order: spine → branches left-to-right → validation
consumes nothing), plus the repo's standing rule: **defaults are
bit-identical** — the graph layer lands behind a `MazeOpts`-style flag that,
when absent, leaves the RNG stream and output untouched, with a pinning test,
so existing floors don't reroll on the day it merges.

## Part 9 — Debug overlay

As v1 (colored nodes/edges/flow arrows via `debug-panel.ts` checkbox), plus a
headless hook `window.__dungeonRouteGraph()` returning the graph + replay
trace as JSON — screenshots under swiftshader are slow, JSON dumps are not,
and every QA harness in this repo is poll-based.

---

## Part 10 — 4× floors **[SHIPPED in this commit — ON THE LEGACY BRANCH ONLY]**

> **Correction 2026-08-26.** This heading is true of `generateMaze`'s branch and
> false of the floor players actually get. `buildTrackFloor` computes
> `w = cellsW * 2 + 1` — the pre-`thickenWalls` size — so a level-1 TRACK floor
> is 75×53 where the legacy floor is 150×106. `TRACK_FIRST` routes around this
> work; see `MAZE_OVERHAUL_PLAN.md:256`, which has carried the same finding as
> an open item. **Every budget riding `cfg.floorTiles` is therefore calibrated
> for 4× the area the live floor has.** Do not tune a `floorTiles`-derived
> budget until these two docs are reconciled; quadrupling the track floor's area
> is a balance and perf decision (the flow field is O(tiles), each zombie is a
> mesh), not a generator fix.

"4× larger" = 4× area = 2× per side (a further ×4 is a knob turn, not a
redesign). Tile grids are `(2·cells+1)·2` per side after thickening:

| | cells (l=1) | tiles (l=1) | tiles (cap) |
|---|---|---|---|
| before | 18×13 | ~74×54 (~4.0k) | ~134×102 (~13.7k) |
| after | 37×26 | ~150×106 (~15.9k) | ~266×202 (~53.7k) |

What scales **automatically** (rides `floorTiles`): zombie count, torch
count, braid/windiness character, artery length (hence spine parts),
`pickEndpoints` FAR_BAND distances, fog array, minimap canvas.

What was scaled **by hand** (`constants.ts` / `decorate.ts`): zombie cap
60→110 (density would otherwise drop 4×), torch cap 40→80 (live-light pool
stays 6 — it's a perf budget, not a density budget), rooms 3+0.8l→5+1.2l cap
8→14, secrets 2+0.5l→4+1l cap 5→10, launchBreaks base 5→8 cap 10→16,
corridor `partBudget` 8→16, frog trail 30→50 tiles (proportional guidance).

What deliberately does **not** scale: floor texture (fixed 512px repeating
tile — pixel count is repeat-driven, no 8192px-cap hazard), `SHADOW_AREA`
(camera-local), `VIEW_W/H` (field of view is a design constant),
`TORCH_LIGHT_POOL` (6 live PointLights is a GPU budget).

**Perf watchlist for real-GPU QA** (headless can't judge frame rate): ~110
enemy sprites are ~110 draw calls; the AI flow field is O(tiles) per
recompute at up to 53k tiles; `floor-pipeline.test.ts` runtime grows ~4×.
If deep floors chug, the levers are (in order): flow-field recompute cadence,
zombie cap, wall-instance frustum culling.

## Part 11 — Build order

1. ~~4× floors~~ (this commit — independent, shippable, testable).
2. Reflection table + `marchRay` + §2b intervals (pure, fully unit-testable).
3. Tier-2 physics replay harness reusing `stepIntroBall`'s shape.
4. Segment catalog behind the bit-identical flag; ASCII goldens.
5. Graph growth replacing `layStationSpine` run-laying; flip the flag.
6. Debug overlay + `__dungeonRouteGraph()`.
