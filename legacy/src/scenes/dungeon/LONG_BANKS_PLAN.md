# Long banks — the geometry, and the plan

_2026-07-25. Written after two failed attempts, and grounded in measurements of
real generated floors rather than intuition._

The ask: banks long enough to hold a rail and feel like a Sonic loop / NASCAR
high line, instead of the current one-quarter-turn fillets (3.1 tiles of arc).

---

## Part 0 — Why the two obvious approaches failed

Both were built and measured before being discarded. Recorded so nobody
rebuilds them.

**Bigger fillet radii.** A radius-R fillet needs an **R×R block** where every
tile passes the structural tests. Cost grows as `r²` while the supply of clean
blocks collapses. Censused over 40 real floors:

| radius | fits found |
|---|---|
| 2 | 3673 |
| 3 | 161 |
| 4 | 4 |
| 5 | 2 |

**Merging adjacent arcs.** Every fillet is centred at `C = P − (cx·R, cz·R)`
for **its own corner P**, so two fillets at different corners are on different
circles by construction. Measured on a real floor: **96 arcs, 96 distinct
circles, zero sharing a centre.** There is nothing to merge.

---

## Part 1 — The measurement that reframes the problem

I censused how much open space real floors actually contain (largest open disc
radius, 22,713 sampled tiles across 12 floors):

| open radius | share |
|---|---|
| 0 | **81.8%** |
| 1 | 14.7% |
| 2 | 3.4% |
| 3 | 0.2% |
| 4 | 0.0% (one tile) |

**Floors are corridors, not chambers.** A big circle needs an open disc, and
open discs essentially do not exist. Any plan that places a large circular arc
"in a room" is dead on arrival — which is exactly why both earlier attempts
failed. They were the same wrong idea in two costumes.

---

## Part 2 — The reframe: a bank is a corridor that BENDS

A banked turn does **not** require an open disc. It requires a **corridor that
turns**, with the ball riding the **outer wall** — precisely the NASCAR high
line the request describes.

Geometry. A corridor of width `W` turning through angle θ has two concentric
walls: inner radius `Ri`, outer radius `Ro = Ri + W`. The rail goes on the
**outer** wall, so the ridden arc length is `Ro · θ` — longer than the inner
wall for the same turn, which is why the outside of a bend is the fast line.

With `W = 3` (the width `widenMainArtery` already carves):

| Ri | Ro | arc @90° | arc @180° | outer-arc tiles |
|---|---|---|---|---|
| 1 | 4 | 6.3 | 12.6 | 9 |
| 2 | 5 | **7.9** | 15.7 | 9 |
| 3 | 6 | 9.4 | 18.8 | 13 |

**A W=3 bend at Ri=2 gives 7.9 tiles of arc — 2.5× the current fillet — and
needs no open disc at all.**

The cost argument in one line: a fillet's requirement is **area** (`r²`), an
arc strip's requirement is **perimeter** (`~r·θ`). At r=10 that is 100 tiles
versus 26.

---

## Part 3 — The sites already exist

`widenMainArtery` already carves a **3-wide highway** down the main
start→stairs artery, and `traceArtery` returns it as an ordered path. Censused
over 20 floors:

- mean artery length **301 tiles**
- **57.4 bends per floor**
- **17.9 bends per floor** preceded by a straight run of ≥5 tiles — i.e. you
  arrive at speed, which is the precondition for a bank being worth anything
- **59% of bends have ≤3 tiles of straight before them** — the artery *wiggles*,
  so bends come in clusters

That last figure is the prize. Consecutive bends are not a nuisance to be
smoothed out; they are an **S-curve chain**, and chaining is what produces a
genuinely long ride:

| ride | arc length |
|---|---|
| single quarter @ Ro=5 | 7.9 tiles |
| **chain of 3** | **23.6 tiles** |

At `RAIL_ACCEL = 15` from an 18 u/s entry, a 23.6-tile ride is **~0.94s held,
exiting at ~32 u/s** against a normal cap of 22 and a rail cap of 35.2. That is
the Sonic-loop payoff, and it falls out of geometry the floors already have.

---

## Part 4 — Implementation

### 4a. `maze/artery-banks.ts` (new, pure)

Runs **after** `widenMainArtery`, **before** `authorArcSweeps`.

1. **Walk `traceArtery`** to get the ordered highway path.
2. **Detect bends**: a heading change between consecutive steps. Record the
   corner tile, incoming heading, outgoing heading, and the straight-run length
   before it.
3. **Filter to bankable bends**: run-in ≥ `BANK_MIN_RUNIN` (start at 4) so the
   player arrives with speed, and a 90° turn (skip 180° reversals).
4. **Group into chains**: consecutive bends within `BANK_CHAIN_GAP` tiles
   become one authored ride. Same turn direction → a sweeping curve; alternating
   → an S. Both are good; alternating is better.
5. **Fit the arc**: for a bend with corner P and headings `h_in`, `h_out`, the
   turn centre sits on the inner side at `C = P + (Ri + W/2) · bisector`. Solve
   for the largest `Ro` whose annulus `[Ri, Ro]` is entirely walkable and whose
   outer arc tiles are wall or convertible.
6. **Emit** one `ArcFeature` per bend with `solidOut: true` (concave — solid
   outside, ball inside), `a0`/`span` from the headings. Chain members share
   nothing structurally; they simply abut, which is enough for the rail because
   `RAIL_GRACE` covers the seam.

### 4b. Rendering — no new machinery needed

This is the part that is already solved, and it is why this approach is cheap.
`ArcFeature` is fully general: `resolveArcFeature` takes **any** centre, radius
and span, and `arcSweepGeometry` in `build.ts` merges every sweep into one mesh
sampled off the same circle. The 90°/radius-2-3 limit is purely an **authoring
convention**, not an engine limit.

So a 7.9-tile bank renders and collides through the **existing** path:
- tiles marked `SHAPE_ARC` + `arcIdx` → the feature
- collider: `resolveArcFeature`, radial normal, already correct for any radius
- mesh: `arcSweepGeometry`, already samples the exact collider circle
- rail: `laneBandAt` / `laneTangent`, already span-agnostic

**No renderer change. No collision change. Only a new authoring pass.**

### 4c. Safety

Banking a corridor bend **adds wall** on the inside of the turn (converting
floor to wall to form the inner radius), so it inherits the concave-fillet
safety machinery already in `arc-sweeps.ts`:

- gate on `occupied` (no placed part/item/spawn inside the annulus)
- batch **BFS strand guard with revert** — if any floor tile loses its path to
  start, revert every bank on the floor
- **never touch the shell** (`i/j` ≤ 0 or ≥ w/h−1)
- never narrow the artery below its 3-wide contract — the bank reshapes the
  turn, it must not pinch the highway

### 4d. Tuning

New constants in `arc-sweeps.ts`:

| constant | start | meaning |
|---|---|---|
| `BANK_MIN_RUNIN` | 4 | straight tiles before a bend to qualify |
| `BANK_CHAIN_GAP` | 3 | max gap for two bends to chain |
| `BANK_MAX_PER_FLOOR` | 8 | cap |
| `BANK_RI` | 2 | inner radius (Ro = Ri + corridor width) |

Expected from the census: ~18 qualifying bends per floor, capped at 8, most in
chains of 2-3.

---

## Part 5 — Order of work

1. Bend detection + chain grouping over `traceArtery`, **pure and tested**
   against hand-built paths. No grid mutation yet.
2. Arc fitting (centre/radius/span from a bend), pure, with a test asserting
   the emitted feature's tiles round-trip through `resolveArcFeature`.
3. Grid mutation behind `occupied` + strand guard + revert.
4. Wire into `decorateMaze` after `widenMainArtery`.
5. Census: banks/floor, mean arc length, chain length distribution. **Target:
   mean ridden arc ≥ 7 tiles**, versus today's 3.1.
6. Headless rail check: warp onto a bank, hold, assert `__dungeonRail()`
   `overspeed > 0` and `rideT > 0.5s`.

## Part 6 — Risks

- **The artery is the spine.** `layStationSpine` lays the booster route down the
  same path, and its down-flow invariant is pinned by `decorate.test.ts`.
  Banks must run **before** the spine and leave the path walkable, or that test
  fails — which is the desired outcome (it catches the mistake).
- **Determinism**: draw from the same seeded `rng`, in fixed order, or floors
  reroll. `floor-pipeline.test.ts:124` pins this.
- **Feature budget**: `MAX_SWEEPS_PER_FLOOR = 96` and `arcIdx` is an
  `Int16Array`. Eight banks is nothing, but count them into the same budget.
- **Do not let a bank eat the highway.** The artery is the fastest route through
  the floor; a bank that narrows it trades a good ride for a worse floor.
