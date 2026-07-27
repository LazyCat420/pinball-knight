# Investigation — Pinball Knight maze generation

_2026-07-26. Reverse-design pass over the live floor generator, following the
workflow in [game-dev-rules/procedural-level-generation.md](game-dev-rules/procedural-level-generation.md).
Commit `c27fb16`, merged to main._

---

## 1. Question

The brief was "improve the maze generation system". The system is large and
well-documented — `maze/` is ~13,000 lines across 35 files with a Physarum
circuit grower, a fillet geometry pass, four plumbing-repair passes and a
1,435-test suite — so the first question was not *what should we add* but
**what is it actually producing?**

Following §7 of the rules doc: don't reason about the source, run a census.

## 2. Method

A throwaway vitest file generating N floors per (depth × archetype) and printing
a table. Three rounds, ~15 minutes each:

1. **Baseline** — 6 seeds × 10 depths through the live path.
2. **Network internals** — node counts wanted vs. placed vs. survived.
3. **Parameter sweep** — the pruner's survival threshold across 8 seeds × 3
   depths × 5 layouts, to size a fix rather than guess it.

Plus an ASCII downsample of one floor per archetype, because numbers can agree
while the geometry looks wrong.

The measurement code was then kept as production code — `maze/floor-metrics.ts`
— so the next person does not have to rewrite it.

### One trap worth recording

The first draft of the reachability metric read `dist[k] < 0x3fffffff`.
`bfsDistances` returns **−1** for unreachable, so that expression counts every
unreachable tile as reached and the metric pins at 1.0000 — a gate that can only
pass. It reported perfect reachability on the very first run, which is exactly
what a broken gate looks like. Check a scorer's *distribution* before trusting
it.

## 3. Findings

### 3.1 The five floor archetypes did nothing

`archetypeFor(level)` returns one of Warrens / The Spine / The Great Hall / The
Cavern / The Ring Keep. Each defines `seeds()`, a set of cells `generateMaze`
pre-carves and grows around. `core.ts:1203` prints the archetype's name and
flavour on the descent card.

But `TRACK_FIRST` has been `true` since the circuit rework, and on that branch
the grid `generateMaze` produced is **discarded**:

```ts
const raw = generateMaze(cfg.cellsW, cfg.cellsH, rng, …, { seeds: arch.seeds(…) });
…
const track = TRACK_FIRST ? buildTrackFloor(cfg.cellsW, cfg.cellsH, rng) : null;
if (track) { grid = track.grid; }        // `raw` is never used again
```

`buildTrackFloor` took no archetype argument at all. Censused over 6 seeds × 10
depths, the five archetypes were **statistically identical** — open share
0.586–0.648, varying with floor *size* and nothing else. The only thing an
archetype changed on a shipped floor was how many rng draws it consumed before
the real generator ran.

So the game announced "The Cavern · no straight lines · the rock decides" over a
floor generated without ever consulting it. Every level-variety feature built on
archetypes — including the windiness-per-archetype work from the previous wave —
was landing on a dead branch.

**Also dead on the live path:** `carveRooms`, `stampLandmark`, `stampPrefabs`
and `pickFocusCells` all run against `raw`, and their anchors are dropped
(`const anchors = track ? [] : …`). The whole prefab-stamp system is unused on
every floor that ships.

### 3.2 "Scale the seed count with floor area" did not

```ts
const foods  = Math.max(6,  Math.min(15, Math.round(area / 260) + 4));
const relays = Math.max(8,  Math.min(22, Math.round(area / 190) + 6));
```

The comment above it explains that this exists "so a big floor gets a bigger
network rather than the same little circuit adrift in it". Measured, both clamps
**bind from floor 1**: every depth from 1 to 10 wanted 15 food and 22 relays and
got exactly that, while the grid grew from 3,975 to 11,125 tiles.

The consequence was visible in the output. The circuit's share of the walkable
floor — the thing the entire track-first rework exists to produce — decayed:

| Depth | Grid | Lane share |
|---|---|---|
| 1 | 75×53 | 0.319 |
| 4 | 93×65 | 0.287 |
| 7 | 109×77 | 0.196 |
| 10 | 125×89 | **0.120** |

By floor 10 the "circuit" was 12% of the floor: the same little network, adrift
in a bigger and bigger maze. Exactly the failure the comment claims to prevent.

### 3.3 The integration test was pinned to the dead branch

`floor-pipeline.test.ts` opens by describing itself as running "the exact
sequence core.ts startLevel uses". It mirrors the **legacy** branch — the one the
feature flag switched off. It has been green, and it has been testing a code
path that does not ship.

## 4. What was changed

Layered per the rules doc's §3: each property is now owned by the layer that can
actually decide it.

### `TrackProfile` — the archetype's grip on the live generator

A new field on `FloorArchetype`, consumed by `buildTrackFloor`:

| Knob | Layer | Decides |
|---|---|---|
| `layout` | topology | Where food nodes are sited — the real macro-shape lever |
| `minLoops`, `survive` | topology | How many independent cycles survive pruning |
| `foodPer1k`, `relayPer1k` | topology | Network density, as a rate not a count |
| `maxLenFrac` | topology | Chord cap; long chords pave what they cross |
| `laneScale`, `plazaFrac` | embedding | How the space feels at speed |
| `fill`, `linkChance` | surround | How much maze, and how porous the boundary |

### Node layouts (`layoutNodes`, track-grow.ts)

Physarum reinforces routes *between* food sources, so where the food sits
decides what the circuit becomes. Four layouts:

- **scatter** — the existing Poisson-ish mesh, unchanged draw for draw.
- **spine** — food around one long thin **stadium** (see §5).
- **ring** — food on concentric rectangles; galleries with gates between them.
- **hub** — a food node dead centre plus a ring of spokes, which `carveChamber`
  then opens into a plaza. This is the Great Hall's "one vast chamber".

The plaza is carved **before** `growMazeAround`, not after. Carved afterwards it
would bulldoze finished corridors and leave severed stubs pointing into it;
carved before, it is simply part of the circuit and the maze's keep-out margin
respects it.

### Other fixes

- **Node counts are densities per 1000 tiles**, with the clamp raised to 44/64
  so it is a runaway guard on the deepest floors rather than the operative value
  on every floor.
- **`windinessFor` reconnected.** It fed only the discarded grid; it is now the
  surrounding maze's growing-tree bias on the live branch, clamped 0.35–0.85 (at
  1.0 the surround is a pure backtracker with no junctions; at 0 it is all
  junctions and no corridor).
- **`TrackPath.arcHalf`.** Lane scale had to reach the fillets too. Widening the
  straights without widening the corners makes every junction a funnel, and a
  ball carrying pinball momentum into a funnel wedges.

## 5. The interesting failure: a spine cannot be a line

The first Spine implementation strung food along an open polyline — a straight
run, an elbow, a Z, mirroring the legacy `spineSeeds`. It is what "spine" sounds
like, and it produced nothing:

| | Measured (10 seeds × 5 depths) |
|---|---|
| Lane share | 0.016 – 0.056 |
| Circuit rank | 1.1 |
| Constraint failures | 8–10 floors in 10 |
| Typical failure | stairs **13 tiles** from the spawn |

The cause is topological. `pruneLeaves` removes degree-1 nodes, cascading — and
**a path is all leaves**. Its two ends are removed, which exposes the next pair,
until only a cycle remains. Whatever the flow simulation reinforced, the
boulevard was deleted after the fact.

And the pruner is *right* to do it: an open-ended road is a road that dead-ends
in solid rock, which is the exact defect `pruneLeaves` was written to fix.

The fix is to build the linear feature as a long thin **loop** — a stadium, out
along one side and back along the other, in one of four orientations. It reads
as a boulevard at ground level because the two runs are far enough apart to be
separate roads, it survives `pruneLeaves` by construction, and it gives the
floor a genuine lap.

**General lesson:** check an authored feature against the invariants the later
passes enforce, or they will quietly delete it. This is the same shape as the
already-documented "fix topology in topology-land".

## 6. Results

Shipped signature — 10 seeds per cell, `lane share · circuit rank`:

| | L1 | L6 | L16 |
|---|---|---|---|
| Warrens | 0.25 · 5.6 | 0.19 · 9.4 | 0.15 · 9.5 |
| The Spine | 0.31 · 2.1 | 0.17 · 2.4 | 0.15 · 2.1 |
| The Great Hall | 0.23 · 3.9 | 0.47 · 9.0 | 0.37 · 4.4 |
| The Cavern | 0.40 · 8.3 | 0.28 · 11.4 | 0.23 · 13.3 |
| The Ring Keep | 0.39 · 3.3 | 0.30 · 5.5 | 0.26 · 7.6 |

Depth decay of the circuit is fixed: lane share now holds roughly flat per
archetype instead of collapsing 0.30 → 0.12. Warrens still thins with depth, on
purpose — it is a maze that happens to have roads.

Visual check (ASCII downsample, floor 6) confirmed the numbers: the Spine draws
one diagonal stadium with spawn and stairs at opposite ends, the Ring Keep draws
visibly concentric galleries, the Great Hall a large central chamber with roads
radiating out, the Cavern a dense loopy web, the Warrens narrow track threaded
through heavy maze.

**Tests: 1,435 pass across 125 files** (was 1,427/124).

### The new gate

`maze/floor-metrics.ts` measures a finished floor — reachability, critical path,
directness, turn rate, dead ends, choice density, lane share, region coverage —
and `checkFloor` holds it to a constraint band. `maze/floor-metrics.test.ts`
runs the **live** generator across every archetype and a spread of depths in 9
seconds, plus a blind test that no two archetypes produce the same floor. That
last test is the acceptance criterion for any future variety feature: if a
census cannot tell your archetypes apart, neither can the player.

The bands are deliberately wide. A gate pinned to today's numbers is a change
detector, not a constraint — it goes red on every legitimate tuning pass and
gets deleted.

## 7. Still open

- **The track floor is a quarter the area the caller believes it is.**
  `buildTrackFloor` computes `w = cellsW * 2 + 1`, which is what `generateMaze`
  produces *before* `thickenWalls`; the legacy branch ends at `(2c+1) × 2`. A
  level-1 track floor is 75×53 where the legacy floor is 150×106, and every
  budget riding `cfg.floorTiles` (zombies, torches, the part-count area term) is
  calibrated for 4× the area. The docstring claims the doubling happens.
  **Deliberately not changed here:** quadrupling floor area is a balance and
  performance decision (the flow field is O(tiles), each zombie is its own mesh),
  not a generator fix.
- **The prefab-stamp system is dead weight on every shipped floor** (§3.1).
  Track C of `MAZE_OVERHAUL_PLAN.md` proposes making the stamps intent-aware;
  making them *reachable* comes first.
- **`floor-pipeline.test.ts` still covers the legacy branch only.** It should
  either be pointed at both or relabelled as the fallback-path test.

## 8. Process note

This wave was done in a `git worktree`. A parallel Claude session in the same
checkout ran `git reset --hard` mid-edit and destroyed every tracked change
(untracked new files survived) — the fourth recorded occurrence in this repo.
It also ran `prettier --write` implicitly through this session's own cleanup,
which matters because **the repo is not prettier-clean**: `.prettierrc` sets
`printWidth: 100` while the codebase is written at ~130, so `prettier --write`
reformats every file it touches. 550 lines of formatting churn in `core.ts` were
backed out before the merge.

Both are documented in the rules folder's preamble. Work in a worktree here.
