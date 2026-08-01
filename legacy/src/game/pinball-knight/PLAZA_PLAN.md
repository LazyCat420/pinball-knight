# Plaza plan — filling the open floor, and the movers that cross it

_Opened 2026-07-31. Companion to `NEXT_WAVE_PLAN.md` (whose Track 2 this cashes
and amends) and `DECLONE_PLAN.md` (which owns improving shipped features)._

The ask, in the player's words: _"make these more open spaces be filled out with
pinball machine logic so there's not just blank spaces for too long"_, and
_"more systems you would see in pinball machines — going thru the mouth of a
monster, hands that swing and push you, other mechanisms to move you around."_

Two halves, tracked separately below because they touch disjoint code:
**Track A** is generation (why the plaza is empty), **Track B** is runtime (new
movers). Neither blocks the other.

**Decisions taken with the user, do not re-litigate:**
1. The monster mouth ships as a **fixture first, a living creature later**.
2. Scoped to **big-plaza archetypes** — corridor floors stay bit-identical.
3. Built out over as many sessions as it needs, one wave per session.

---

## The complaint, measured

The Great Hall carves its chamber on purpose. `carveChamber`'s docblock
(`maze/track-carve.ts:213`): _"Pinball physics need open area to chain caroms and
a 4-tile lane never gives them any; this is the one place per floor where that is
not true."_ It creates the area. Almost nothing fills it.

Friction will not save it. `FRICTION_OPEN 0.35 × PINBALL_FRICTION 0.9` = 0.315
u/s², so from `BOOSTER_SPEED = 15` you coast ~357 tiles. **A plaza cannot be
crossed slowly. It has to be populated.**

### The plaza is not unreached — it gets texture, not machines

Two passes already target open space, and stating this correctly matters,
because "the plaza is unreached" would lead to the wrong fix:

- `polishParts` §3 "Plaza patterns" (`decorate.ts:1921`) scans a stride-4 lattice
  for 5×5 all-floor windows and stamps a four-bumper diamond, capped at
  `plazaCap = clamp(round(walkable/900), 2, 8)` **for the whole floor**.
- Sparse-region fill (`decorate.ts:2417`) partitions into 24×24 regions and drops
  **one** omni part into each region holding none — so a region with a single
  bumper on its edge counts as filled.

That is roughly one part per 576 tiles, and the thing placed is a loose scatter
primitive. The fix is not "reach the plaza". It is **"put an authored object
there"**.

### Three structural facts

**A1. The room-furnishing pass is dead code on every shipped floor.**
`furnishRooms` (`decorate.ts:1073`) is real content: distance-zoned archetypes
(`RoomArchetype = "bumper" | "speedway" | "arena" | "vault"`) laying a staggered
bumper quincunx, a one-way ramp→booster speedway aimed down Φ, arena/vault corner
guards with a centre prize, and a four-deflector **orbit** ring that scores as a
lap. It runs off the `rooms` argument, and `spawn/floor-authoring.ts:170` passes
`[]` on the track branch — the shipping path (`buildTrackFloor` returned null 0
times over 400 measured floors). `stampPrefabs`, `stampLandmark` and `carveRooms`
are dead there too.

`carveChamber(g, mask, cx, cz, r)` carves the plaza as a **disc** and returns
`boolean`; both call sites use it only for truthiness, so its centre and radius
are discarded. Nothing downstream knows a chamber exists.

**A2. Six of eleven dealable kinds cannot be placed in open space.**
`classifyTopology` (`decorate.ts:264`) returns `junction` for ≥3 open orthogonal
neighbours, and `KIND_TOPOLOGY` maps only `bumper`, `spinpad` and `flipper` to it.
Worse, a `junction` spot carries `dirI = dirJ = 0`, so `spotForKind` (`:1046`)
picks a facing at **random** — open-field placement cannot aim anything.

**A3. Nothing measures it.** `floor-metrics.ts` computes `chamberShare` (the Great
Hall's `plazaFrac` was raised 0.16 → 0.29 specifically to win that number) but it
has **no entry in `DEFAULT_CONSTRAINTS`**. `floor-density.ts` bounds are
floor-wide per-1k **maxima** — a floor can sit at `maxPartsPer1k: 34` globally
with a dead plaza and every gate passes.

---

## Assets already built and idle

Nothing in this plan re-implements any of these.

| Asset | State |
|---|---|
| `furnishRooms` + `RoomArchetype` (`decorate.ts:1073`) | Runs on `[]` every floor |
| `maze/assembly.ts` + `assembly-lib.ts` + `assembly-check.ts` | 41 tests, 8 machines, **nothing imports it**; its docblock cites `assembly-place.ts`, which does not exist |
| `clearanceField(g)` (`doorways.ts:193`) | 3-4 chamfer distance-to-solid, already on `FloorRuleContext.clearance` |
| `labelSections(g, cl, 3)` (`doorways.ts:244`) | Connected components of tiles that are genuinely *spaces* |
| `openRunway(g,i,j,di,dj,max)` (`flow-orient.ts:177`) | Approach measurement — do not write a second one |
| `stampOrbitIsland` (`arc-sweeps.ts:463`) | Already sites an arc island on the widest open disc, strand-guarded |
| `startRide`/`updateRide` (`player.ts:840`) | General Catmull-Rom coaster; only `trapdoor` uses it |
| `simulateHazards(dt)` + `inLaneOf` (`hazards.ts:42`) | Self-firing lane sweep against player and horde |
| `PinballDeps` (`pinball-collide.ts:125`) | `startRampHop` / `startDrop` / `setSteerLock` / `raiseSteerLock` |

---

## Shipped defects found while planning

All five verified against source on 2026-07-31. They are independent of this
plan's features; three of them are landmines directly under it.

**D1. `state.elapsed` is WALL CLOCK.** `sim/loop.ts:108` does
`state.elapsed += frame` from the rAF delta, **outside and before** the
fixed-step block; `simulate()` runs on `FixedStepLoop` at `FIXED_STEP`, and the
sim is deliberately paused during hitstop while `elapsed` keeps advancing. So
`spinPadPhase(state.elapsed, part.i)`'s docstring claim — _"Deterministic, so it
replays identically in co-op"_ — **is not true today**. Two peers at different
frame rates read different phases at the same sim step. Do not build more
phase-driven parts on that clock; add `state.simT` first.

**D2. `p.grabT` only ticks while `momSpeed > 0`.** `updatePinball`
(`player.ts:1151`) returns false on `p.momSpeed <= 0`, and the whole grab-hold
block sits below it at `:1157`. Its only other reset is `:1721`, also inside. **Any
hold that zeroes `momSpeed` hangs `grabT` forever** while the walking path takes
over. The deflector survives only because it never touches `momSpeed` during its
hold. Two Track-B mechanisms (scoop, magpost) sit directly on this.

**D3. `hazards.ts` still has the catch-all shape `PART_HANDLERS` was built to
kill.** `simulateHazards` is an `if (kind==="glove") … else if …` chain. Because
`selfFiring` is a silent no-op, **a kind assigned `selfFiring` and then forgotten
in hazards.ts does nothing at all and compiles green.**

**D4. `PartSpotKind → PinballPartKind` is an unchecked cast**
(`render/pinball-parts.ts:880`, `kind: s.kind as PinballPartKind`). A
`PartSpotKind` with no `PinballPartKind` twin compiles clean, then
`PART_BUILDERS[s.kind]` is `undefined` → TypeError at level build. The reverse
(runtime-only kinds like `gravepit`) is legitimate, so the unions cannot simply
be merged — but `PartSpotKind extends PinballPartKind` can be asserted.

**D5. `registry-drift.mjs` covers nothing in the parts pipeline.** All its checks
are scoped to `EnemyKind`, `SheetKey` and marble materials; neither
`PinballPartKind` nor `PartSpotKind` appears in the file. Parts have **five
compile-enforced tables and ten unenforced ones, with no drift checker at all**.

**D6. No existing harness builds the floor that ships.** Found while building
A-Wave 0's census, and measured rather than argued: a probe comparing walkable
count and endpoints over 15 (level, seed) pairs found the shipped chain and the
`buildHeadlessFloor` chain agreeing on **0 of 15**.

`spawn/floor-authoring.ts` `authorFloor` states the contract in its own header —
_"THE ORDER OF THE DRAWS IS THE CONTRACT … reorder any two draws and every draw
after them changes"_ — and its order is:

```
floorRng → rollModifier → windinessFor → buildTrackFloor → stampSecretBands → decorateMaze
```

- `dev/headless-floor.ts` `buildHeadlessFloor` and `maze/floor-rules.test.ts`
  `floorContext()` (declared TWINs of each other, and they are) both insert an
  entire legacy maze — `generateMaze`, `carveRooms`, `stampLandmark`,
  `pickFocusCells`, `stampPrefabs`, `crackSecretWalls` — between `windinessFor`
  and `buildTrackFloor`. On the track branch, which ships and which
  `buildTrackFloor` has declined 0 times in 400 floors, none of those calls
  happen: that block is `authorFloor`'s `else`. Every one of them draws.
- `maze/floor-density.test.ts` `liveFloor()` drifts the other way, omitting
  `rollModifier` and `stampSecretBands`, which also draw.

Consequences, stated at the strength the evidence supports:

- **`floor-rules.test.ts` gates floors nobody plays.** `boss-has-room-to-fight`,
  `doorways-are-uniform` and the rest are being checked on a different floor
  population than ships. That is the serious one.
- **The doorway-funnel measurement's *relative* conclusion survives.** It was a
  paired same-seed A/B — funnels on vs off on the same floor — so "funnels
  improve capture" is still supported. But "+6.1 pp over 100 floors never used
  for tuning" describes a population the game does not generate, so the
  magnitude should not be quoted as a shipping number.

`buildHeadlessPlan` (A-Wave 0) mirrors `authorFloor` draw for draw and is the
one faithful harness in the tree. **Fixing the other three is not done** — it is
deliberately out of this wave's scope because rewriting `floorContext` changes
every floor the rule gate judges, which is its own wave and plausibly its own
session. Recorded here so it is not rediscovered.

Also noted, minor: `hazards.ts:69-73` hand-rolls the glove's trigger instead of
calling `onPartTrigger()`, so **the glove does not cleanse webs and does not pay
frenzy**, and nothing says so.

---

# Track A — generation

### A-Wave 0 — measure the hole _(no behaviour change)_

Clearance answers "how far from a wall", which is a proxy. The quantity the
complaint names is **distance to the nearest interactive part**, cross-tabulated
against clearance so an empty *corridor* (fine — that is transit) is
distinguished from an empty *space*.

New `maze/open-space.ts` — pure, structural input, the third member of the family
(`floor-metrics` = shape, `floor-density` = amount, `open-space` =
**distribution**):

```ts
export function barrenField(g: Grid, parts: readonly TilePos[]): Int32Array;
export interface OpenSpaceMetrics {
  worstBarren: number;         // tiles you travel before meeting anything
  deadShare: number;           // share of walkable over R_DEAD
  openDeadShare: number;       // share BOTH open and barren — names the plaza
  sections: SectionDensity[];  // rollup over labelSections()
  biggestSectionRatio: number; // largest section parts/1k ÷ floor parts/1k
}
```

`biggestSectionRatio` is the hierarchy check a floor-wide average cannot make:
below 1, the biggest room is the emptiest room.

`R_DEAD` is derived, not chosen. `TILE = 1` and `BOOSTER_SPEED = 15`, so
`R_DEAD = 12` tiles = **0.80 s of nothing**. Cross-check from the other end:
`floor-density.ts`'s `minPartsPer1k: 8` implies mean spacing
`0.5·√(1000/8) ≈ 5.6` tiles, so R_DEAD is ~2× the spacing that gate already calls
acceptably sparse. Two independent derivations, one answer.

`dev/headless-floor.ts` stops at `buildTrackFloor` and produces no parts. Add
`buildHeadlessPlan()` **additively** — that file is a declared TWIN of
`floor-rules.test.ts`'s `floorContext()` and the contract must not shift. Then
`scripts/open-space-census.mjs`, patterned on `scripts/funnel-census.mjs`.

**Run the census first, write the numbers into the docblock, then set thresholds
with headroom.** A gate set at exactly current output tests nothing — both
`floor-density.ts` and `floor-metrics.ts` say so in their own headers.

This wave decides whether the rest is worth building. If the numbers come back
healthy, the complaint is legibility, not generation, and Track B owns it.

#### RESULT — measured 2026-07-31, 180 floors, and it revises the plan

`node scripts/open-space-census.mjs --levels 1..30 --seeds 6`:

|                     | min   | p50   | p95   | max   |
|---------------------|-------|-------|-------|-------|
| worstBarren (tiles) | 14.0  | 23.0  | 34.0  | 55.7  |
| deadShare           | 0.011 | 0.058 | 0.118 | 0.164 |
| openDeadShare       | 0.000 | 0.011 | 0.035 | 0.056 |
| biggestSectionRatio | 0.00  | 0.83  | 1.56  | 3.48  |
| partsPer1k          | 13.6  | 18.8  | 25.4  | 28.4  |

**The complaint is real.** The median floor has a stretch of **23 tiles** —
1.5 s at `BOOSTER_SPEED` — crossed without meeting anything, and 5.8% of all
walkable area sits more than `R_DEAD` from any part. The p95 floor has a 34-tile
run and the worst a 55.7-tile one, 3.7 s of nothing.

**But it is not the Great Hall, and it is not plazas.** By archetype, `deadShare`
runs warrens 6.0%, spine 5.3%, greathall 5.4%, cavern 5.8%, **ringkeep 8.8%** —
and `ringkeep`'s `plazaFrac` is **0**. The archetype the wave was scoped around
is mid-pack.

**The real axis is DEPTH**, via the part budget:

| band   | walkable | parts/1k | worstBarren | deadShare | bigRatio |
|--------|----------|----------|-------------|-----------|----------|
| L1-8   | 4040     | 23.2     | 22.4 t      | 5.3%      | 0.96     |
| L9-16  | 8122     | 18.4     | 25.7 t      | 6.6%      | 0.81     |
| L17-24 | 8532     | 17.7     | 23.7 t      | 6.7%      | 0.91     |
| L25-30 | 8655     | 17.9     | 24.7 t      | 6.4%      | 0.85     |

Floors roughly **double** in walkable area after level 8 while `partBudget` is
`min(PARTS_BASE + (level-1)·PARTS_PER_LEVEL, PARTS_MAX) + budget.partsArea` —
capped, with an area term that does not keep up. Part density falls 23% and stays
down.

**The hierarchy defect IS confirmed, and it is general.**
`biggestSectionRatio` is below 1 for **every** archetype — spine 0.76, warrens
0.84, greathall 0.90, ringkeep 0.93, cavern 0.99 — so "the biggest room is the
emptiest room" holds floor-wide, not just in plazas. 17 of 180 floors have their
largest section below half the floor's average density, and **2 ship with zero
parts in it**.

#### What this changes

1. **A-Wave 1's scoping is wrong as written.** Gating on `prof.plazaFrac > 0`
   reaches one archetype and mid-pack severity. The defect is floor-wide and
   depth-driven. *Needs a scoping decision before A-Wave 1 starts.*
2. **A new candidate wave, ahead of the rest: the part budget.** `partsPer1k`
   falling 23.2 → 17.7 with depth is a one-constant defect with floor-wide
   reach, and it is upstream of every placement change below. Cheap to test
   against the census that now exists.
3. **A-Waves 1-4 remain right in kind** — chambers should be furnished, islands
   should exist — but they are a *distribution* fix layered on a *supply*
   problem, and the supply problem should be measured first.

`biggestSectionRatio` is deliberately not a per-floor band (2 floors sit at 0, so
it could only pass at 0, and an inert gate is worse than none). It is gated as a
rate over a sweep, the same idiom `TrackFloor.relaxed` uses.

### A-Wave 1 — chambers become rooms

The cheapest real content in the plan: revive a system that already exists.

- `carveChamber` returns the carved `{cx, cz, r}` instead of `boolean`.
- `track-floor.ts` collects them into `TrackFloor.chambers: Room[]`.
- `floor-authoring.ts:170` passes `track.chambers` as `decorateMaze`'s `rooms`.

The scoping gate needs no new threshold: **`plazaFrac` is non-zero on exactly one
archetype** — `greathall` at 0.29 (`archetypes.ts:511`); `warrens`, `spine`,
`cavern`, `ringkeep` are all 0. So `prof.plazaFrac > 0` *is* "the big-plaza
archetype", and only Great Hall floors reroll.

Split in two — the second half has a much wider blast radius:

- **1a — the Great Hall plaza** (`track-floor.ts:552`). One archetype. Measure it.
- **1b — the King's Hall** (`carveBossChamber`, `:393`). Same brush, same empty
  box, but carved on **every** floor. Own flag, after 1a's density numbers land.

Two things to get right:

- `furnishRooms`' `Room` is `{i0, j0, w, h}` and every archetype indexes off those
  edges with a wall margin — but the plaza is a **disc**, so the bounding
  square's corners are rock. Clip every emission to `at(g,i,j) === T_FLOOR`.
  **Main correctness risk of the wave.**
- Density is already handled: `decorate.ts:2082` runs rooms **first** and
  `corridorBudget = partBudget + parts.length` is computed at `:2254`, so room
  parts are debited from the corridor deal automatically. Do not move either.

`furnishRooms` emits parts, spawns and items only — it writes no tiles.

### A-Wave 2 — library correctness _(no floor changes)_

- `assembly-check.ts` grows **`internal-duel`** (two parts in one machine whose
  kinds are in `LAUNCH_KINDS`, anti-parallel on a shared axis with only machine
  floor between — `firesAt`'s condition restated at authoring time),
  **`no-gutter`**, **`one-sided-island`**.
- `internal-duel` **fails `SLING_PAIR` today**: slingshots at `(0,1)` dir E and
  `(2,1)` dir W, same row, opposed, floor between. Since `breakLaunchDuels` still
  runs over machine parts, that machine would be re-aimed or demoted on every
  floor it landed on. Offset one across a cell, or make one a deflector.
- `assembly.ts`: add `Assembly.island`; amend the docblock, which claims a router
  in `assembly-place.ts` that does not exist.
- Track 2's two loose bugs, ranked honestly: `ANCHOR_KINDS` (`prefabs.ts:413`) has
  no glyph for `booster`; `tilttable` (`:203`) emits loose targets with no
  `bank`/`seq` and **cannot be fixed without widening `PrefabAnchor`**, which is
  `{i, j, kind}` with nowhere to put them. Both are legacy-branch-only and
  invisible to players — do them last.

### A-Wave 3 — the island placer

`maze/assembly-place.ts`, to `NEXT_WAVE_PLAN.md` Track 2's design, **amended in
four places**.

**The decisive choice: the island placer writes no tiles.** For an island,
`Assembly.floor` means "these cells must *already* be floor", not "carve them".
Three consequences, all collapsing the wave's risk: it cannot strand anything, it
cannot un-back an arc face (so it leaves the `compactArcs`/`removeWallStubs`
fixed point alone), and it cannot move `reachShare`, `openShare`, `pathLen`,
`directness`, `deadEnds` or `chamberShare` — **so it is structurally incapable of
failing `floor-metrics`, `floor-rules` or the wall half of `piece-rules`.** It is
also the honest answer to the ask: the space is already open; what is missing is
the object standing in it.

**Hook at `track-floor.ts:973`**, after `setTile(stairs)` and `orientArcRails` —
not at the boss-chamber slot, because doorways are cut after that and a doorway
changes a machine's approach lines. Last draw in the function, behind a flag, so
flag-off floors are bit-identical; assert it the way the `SURFACE_BANDS` block at
`floor-pipeline.test.ts:238` does.

**Core / gutter / apron** replaces wall anchoring:

| ring | rule |
|---|---|
| **core** (`Assembly.floor`) | must already be `T_FLOOR` with `SHAPE_FULL` — the test `stampOrbitIsland:480` already applies |
| **gutter** (1 cell, authored into `floor`) | carries the outer ports; free in a plaza |
| **apron** (`APRON = 3` tiles) | already open, stays part-free — what makes it an island you lap rather than an obstruction you clip |

`APRON = 3` is `MIN_PART_RUNWAY` from `piece-rules.ts:49` — the same 3 tiles that
gate demands of every throwing part on the finished grid. A different number
would mean authoring machines the gate then fails.

`wantsRunway` is a corridor scalar. For an island: every `in` port needs
≥ `MIN_APPROACH = 8` open tiles along its travel vector (via `openRunway`), and
**at least two `in` ports on different sides** must clear it. One approach side
means it is a wall machine standing in a field.

- **Amendment 1 — ordering.** Track 2 says sort by port count descending. Right
  instinct, wrong variable in the open: the binding constraint is *fit*, and
  eligible centres fall as the clearance threshold squared. Sort by **footprint
  area descending, then port count descending**.
- **Amendment 2 — orientation.** Track 2 says mirror-only because machines are
  flow-directional. True of ramps and orbits, **false of islands** — a jet nest
  has no up-flow. `island: true` licenses all eight orientations.
- **Amendment 3 — claims.** Track 2 says thread `ClaimRect[]` through
  `stampPrefabs`. That is dead code on the shipping branch, and `ClaimRect` is in
  half-scale cell space only the legacy grid has. The live idiom is a **tile
  predicate** (`inChute` `:2002`, `inRoom` `:2088`). Export
  `machineMask(g, placed): Uint8Array` and add `inMachine` beside them.
- **Amendment 4 — MustConnect** lands as a test plus a `relaxed` entry, not a
  runtime throw — the existing `TrackFloor.relaxed` idiom, rate-capped exactly as
  `boss-has-room-to-fight` is.

Siting scores candidates from the A-Wave-0 fields rather than a raster sweep:
eligible by clearance, `barren ≥ R_DEAD` and section size; rejected by chute, boss
room, orbit island, stairs and a calm start radius; scored by barren (fill the
emptiest pocket first) plus a Φ-band bonus so the machine sits *on* the route
rather than in a corner the roads never reach. **Clash test inside the candidate
loop, never after** — `prefabs.ts:553-560` documents that exact bug. Feed accepted
centres into a `createSpacingGrid(halfDiag + APRON)` and re-query.

**One ordering detail carries the whole density story:** push machine parts in
**before** `const corridorBudget = partBudget + parts.length`
(`decorate.ts:2254`) and they are debited from the corridor deal automatically.
After it they are additive and blow `maxPartsPer1k: 34`. Three 8-12-part islands
is ~+7.5 parts/1k against measured floors at 15.6-28.2 — enough to breach on busy
seeds if the ordering is wrong.

Exemptions: one field, `PinballPartSpot.asm?: AssemblyRef`, matching the existing
`spine`/`chain`/`chute`/`vault` family. Exempt from de-clumping (`:1909`), the
runway re-aim (`:2791`) and `openLaunchTargets` — its facing is authored, not
guessed. **Not** exempt from `breakLaunchDuels` or `breakFlowLoops`: those guard a
genuine soft-lock.

### A-Wave 4 — the five islands, plus the archetype dial

All `island: true`, gutter authored in, using real `PartSpotKind` members (note
`gravepit` is **not** one — it is runtime-only). At `CELL = 2` a 5×5-cell machine
is a 10×10-tile island against a ~46-tile hall.

- **`jet-island` (5×5)** — three bumpers in a triangle, a spinpad at the centroid,
  four `rollover` with `seq` 0-3 around the gutter. The rollover ring makes it a
  *scoring object* rather than the loose bumper diamond `polishParts` stamps.
- **`captive-post` (3×3)** — a bumper dead centre, four slingshots on the gutter
  mid-sides aimed **tangentially in rotational order**. Tangential aiming is
  exactly what topology placement cannot produce (A2), and it makes the machine
  duel-free by construction: no two slingshots share an axis.
- **`spin-disc` (5×5)** — eight magstrips around the ring aimed tangentially, a
  spinpad hub, oil between the spokes. Turns `FRICTION_OPEN` from a liability into
  the mechanic: enter at the rim, get carried round, leave tangentially.
- **`scoop-keep` (4×4)** — a four-target drop ring (`bank`/`seq` 0-3) guarding a
  centre spring and trapdoor. Carries an **eject** port, which is `assembly.ts`'s
  own rule for terminating a long chain.
- **`ramp-cross` (5×5)** — a plaza-scale orbit: an X of booster→ramp lanes onto a
  deflector centre. What a 40×40 plaza structurally lacks is a way to cross from
  one quadrant to another that is a *shot* rather than a walk.

Recommended against: a `pit`/`electric` hazard island. Hazards already have an
owner and their own budget (`decorate.ts:2642`); a second author for one quantity
is the failure this codebase has already paid for twice.

**Archetype side — parts, not walls.** Do not carve pillars into the plaza. Three
reasons, all measured:

1. `greatHallSeeds` is **dead on the shipping path** (`archetypes.ts:36-52` — a
   blind census over 6 seeds × 10 depths could not tell the five archetypes apart
   on any statistic, because `buildTrackFloor` took no archetype argument).
2. Carving into the widest open disc early is a recorded failure
   (`track-floor.ts:732` — the King's Hall _"came out ONE TILE wide … on a third
   of floors"_ because the wall-adding families all hunt the same disc).
3. Pillars demolish `largestChamber`, which needs a fully open 5×5 neighbourhood,
   while raising `deadEnds`, which *is* gated.

So the archetype change is one field in the established `foodPer1k` shape:
`TrackProfile.machinesPer1k` — highest for `greathall`, moderate for `ringkeep`
and `cavern`, ~0 for `warrens` and `spine`. And add `minChamberShare` to
`DEFAULT_CONSTRAINTS` for plaza archetypes: the number the Great Hall was tuned to
win is currently ungated (A3).

---

# Track B — runtime movers

### B-Wave 0 — make the additions safe _(no new kinds)_

Every item is one of the shipped defects above. **This wave or nothing** — five
new kinds across ten unenforced registries is fifty chances to silently do
nothing.

- `PartSpotKind extends PinballPartKind` static assertion (D4).
- `HAZARD_SIMS: Partial<Record<PinballPartKind, HazardSim>>` replacing the
  if-chain, plus an assertion that every kind mapped to `selfFiring` has an
  entry (D3).
- `state.simT`, incremented in `simulate()`, replacing `hazards.ts`'s private
  `hazT` — and `spinPadPhase` moved onto it (D1).
- Hoist the `grabT` hold block **above** the `momSpeed <= 0` guard (D2).
- `registry-drift.mjs` **check G**, modelled on check F, covering
  `KIND_TOPOLOGY`, `deal`, `LAUNCH_KINDS`, `FORWARD_FLOW_KINDS` and
  `part-broadphase.test.ts`'s `REACHES` against `PartSpotKind` (D5).
- `phase`/`fireT` on `__dungeonParts` — without them no headless test can verify
  a swat, and every B-Wave-1 claim stays unfalsifiable.
- `state.lockT` where `steerLockT` is decremented (`player.ts:1217`) — the only
  way `MAX_LOCK_DUTY` is ever *measured* rather than asserted.

**Measurable:** a paired same-seed floor census must be **byte-identical**
(`scripts/floor-census.mjs --diff`). This wave draws zero RNG, so a dirty diff is
a bug in it, full stop.

**Positive controls that must fire:** temporarily delete `firevent` from
hazards.ts and confirm the new assertion throws; delete `magstrip` from
`KIND_TOPOLOGY` and confirm check G fails. _A gate never seen to fail is not
known to work._

### B-Wave 1 — `swingarm` (the hands that swing)

Highest value, lowest risk: **zero steer-lock cost**, no relocation, pure-math
core.

The collider resolves against the static grid only — `hitN`/`hitLane`/`hitKick`
all come from tile shapes and authored `ArcFeature`s. **There is no dynamic-body
path.** So an arm cannot be a collider: it is a self-firing part
(`PART_HANDLERS.swingarm = selfFiring`) whose consequence lives in `HAZARD_SIMS`,
with contact by an analytic swept test in a new pure `entities/swing-arm.ts`
(same contract as `entities/rail.ts`: no THREE, no DOM, no state import).

**Copy the spinpad's rule, not its clock.** Its rule is right and is why it works:
the renderer and the physics call one phase function, so what you see is what
hits you, by construction. Its clock is wall-time (D1). So:

```ts
export function swingPhase(simT, i, j) { return simT * SWING_RATE + (i * 0.7 + j * 1.3); }
export function swingAngle(simT, i, j) { return SWING_ARC * Math.sin(swingPhase(simT, i, j)); }
export function swingOmega(simT, i, j) { return SWING_ARC * SWING_RATE * Math.cos(swingPhase(simT, i, j)); }
```

Three properties free: no per-part integration (so the `near` animation gate at
`pinball-parts.ts:1409` cannot desync the angle), no `Math.random`, and sim-time
so it pauses correctly under hitstop and `freezeT`.

**Pendulum, not rotor.** `swingOmega` has genuine zero-crossings at the arc ends:
the arm visibly hangs, then accelerates. That is the telegraph. A continuous 360°
rotor has no tell and is unavoidable in a corridor. If a rotor is wanted later it
is a *second kind*, never a boolean on `PinballPart`.

**The impulse is a moving surface, not a rotating booster.** Snapping the heading
to the arm's tangent would make it the latter. Transfer the contact-point
velocity:

```ts
export function batImpulse(vx, vz, armVx, armVz, nx, nz, e) {
  const relN = (vx - armVx) * nx + (vz - armVz) * nz;  // closing speed in the ARM's frame
  if (relN > 0) return null;                            // arm moving away — no contact
  return { vx: vx - (1 + e) * relN * nx, vz: vz - (1 + e) * relN * nz };
}
```

Three behaviours fall out for free, each a named unit test:

- **Standing still** → exit `= (1+e)·ω·r`. At the tip (`SWING_LEN 1.6`,
  `ω_max 4.4`) that is `1.9 × 7.0 = 13.3 u/s`, flipper-grade. **At the hub it is a
  nudge.** The tip/hub gradient is a real skill axis nobody had to author.
- **Head-on into the face** → your speed reflects *and* the arm's adds. The only
  way a swing arm can pay a fast line; a tangent-snap cannot express it.
- **Outrunning the surface** → `relN > 0`, no hit. That is the dodge.

Clamp through `comboSpeedCeil(p.bounceCombo)` so the arm joins the concave ramp
and **cannot become an infinite speed farm**. Call `onPartTrigger()` rather than
hand-rolling it — and fix the glove to do the same in this wave, since its
hand-rolled version skips the web cleanse and the frenzy payout.

**Tunnelling, honestly.** At `FIXED_STEP 1/60` and `ω_max 4.4 rad/s` the tip moves
`0.117` units/step, far under `PLAYER_R + SWING_THICK = 0.38` — **the arm cannot
tunnel**. The *player* can: at `PINBALL_MAX_SPEED 22` it moves `0.367`/step,
marginally over `PLAYER_R`. So the wrap-safe `angleCrossed` interval test is
belt-and-braces, and **the mitigation that carries the weight is sampling the
player at both pre- and post-move position**. Say so in the header rather than
shipping both as if equally necessary.

**Duty budget.** The arm's steer-lock cost is **exactly zero** — it never calls
`setSteerLock`. It changes velocity in one instant and hands the wheel back. That
is the argument for adding it rather than another pad: the floor is
booster-saturated (decorate.ts's own census: 73%, 2471 of 3364) precisely because
every mover it had was a steer-locking pad.

It has a different budget — **unavoidability**, derived the way `PAD_STRIDE` is:

```
sweep occupancy = 2·(PLAYER_R + SWING_THICK) / (SWING_ARC · SWING_LEN)
                = 0.76 / 3.2 = 0.2375
export const MAX_SWEEP_OCCUPANCY = 0.25;   // ¾ of the swept ring passable at any instant
```

This is what forces `SWING_ARC = 2.0` rather than a natural-looking 1.05 — at 60°
the arm blocks 45% of its own footprint and becomes a toll booth. Pin the
inequality in a test so a future bump to `SWING_THICK` fails the suite.

Placement: junctions and rooms only, never a 2-wide corridor — the call
`decorate.ts:2352` already made for the deflector. `SWING_MAX_PER_FLOOR = 3`.
**PortFlow: `impact`** — `portsChain` must refuse to route a combo through it.

**Measured three ways:** (1) unit tests for the three physical claims plus the
occupancy inequality; (2) paired same-seed `__dungeonBot({seconds:120})` on seeds
42/1337/7 at `SWING_MAX_PER_FLOOR` 0 vs 3, predicting **flow up AND
`lockT/elapsed` unchanged** — two-sided, because "adds momentum events without
taking control" is a two-sided claim; (3) **a positive control that SCALES** —
0/3/8 arms must move `state.swingHits` monotonically and roughly linearly. If 8
arms swat as often as 3, the sweep test is dropping contacts and everything above
it is unfounded.

### B-Wave 2 — `scoop` (the saucer with a timed kickout)

The most-missed real mechanism and the cheapest, because **the deflector already
is a zero-hold scoop**. Capture sets `grabT`/`grabX`/`grabZ`/`throwDir*`/
`throwSpeed`; `updatePinball`'s existing hold-and-release block owns the rest.
Zero new player state — *subject to D2*, which is why B-Wave 0 comes first.

New versus the deflector: the hold is a *beat* (1.1 s, long enough to be an
event); the exit is the part's **authored** direction rather than derived from
your entry leg (that is what makes it an eject); it pays on capture and escalates
with `state.scoopHits`, giving the floor a "shoot here again" objective; and it
can award (`overcharge`, multiball).

**PortFlow: `eject`** — and the canonical one. `assembly-lib.ts`'s header states
"long chains need an eject", and today **the library has no part that actually
ejects at an authored vector.** This is the link it was written for and lacks.

**Measurable: capture rate.** `assembly-lib.ts`'s rule "a machine you cannot reach
in a straight line is furniture" made numeric. Positive control: 1/3/6 scoops →
captures scale. Flow *will* dip (the scoop stops the ball for `SCOOP_HOLD`); the
question is whether the kick pays it back.

### B-Wave 3 — `maw` (the monster mouth)

**Part, not enemy** — and the disqualifier is not cost, it is **mortality**. An
enemy can die; a mouth that is also a route link would vanish mid-floor and break
a chain the generator authored. It would also have to be rooted, which
`zombie.ts:939` already carves out for golems and chompers as _"FURNITURE WITH
TEETH"_ — all the cost of an enemy, none of the benefit. The visual language
already exists as a painter idiom (`chomperFrame` does "gape then SNAP"), so
nothing is lost building it as a `PART_BUILDERS` group.

**Facing the teleport invariant head-on.** `pinball-collide.ts:257` says
_"Deliberately NOT a teleport — the trapdoor is the only thing on the floor that
relocates you."_ Do not quietly falsify that. Its real content is narrower than
its wording: *a hazard you fall into must not also relocate you*, because then
falling in is sometimes good and players cannot read it. Rewrite it to what it
protects:

> Exactly two things relocate you, and both are RIDES you earn: the trapdoor
> (unaimed, a dead-end payout) and the maw (aimed, a shot). **No hazard
> relocates.**

Pin it with a test that drives every `PinballPartKind` through `PART_HANDLERS`
with a stub `PinballDeps` and asserts `startDrop`/`startRide` is reached only from
`trapdoor` and `maw`. That converts a comment into a gate.

The maw earns "not a hazard" by construction: it swallows only above
`MAW_SWALLOW_SPEED` **and** only from inside a facing cone into the throat.
Grazing the teeth at a walk bounces you off. **You cannot fall into it.**

**The exit — three tiers.** Refactor `startRide()` to
`startRide(exit?, opts?)` so `startDrop`'s call site is unchanged and the maw gets
its own policy without duplicating the Catmull-Rom code. Then `pickMawExit`:

1. **Authored port**, once A-Wave 3 lands — the maw declares
   `in: ballistic(minSpeed)`, `out: eject`. That is where a maw feeding an orbit
   is a real chain rather than a coincidence.
2. **Φ-bounded, near-a-machine** (the shipping default, works today). This is
   where reusing `pickRideExit` would be actively **wrong**: it scores `+6` for
   landing near the stairs (`player.ts:830-833`), and a monster that eats you and
   puts you next to the exit **is** a floor skip. The maw inverts it — accept only
   within `[Φ_entry − MAW_PHI_DROP_MAX, Φ_entry]`, reject near the stairs
   outright, and score by proximity to a scoring part plus *lateral* displacement
   from the entry→stairs line. **The maw moves you sideways across the machine,
   not forward through the floor.**
3. **Refusal.** `pickRideExit`'s 40-sample loop silently falls back to a
   zero-length ride. A Φ-bounded acceptance set is much smaller and will hit that
   far more often, so the maw needs an explicit ladder ending in *decline to
   swallow*, with a visible note — `startRampHop` already learned this and prints
   `⛰️ NO LANDING`.

**What it costs:** your line. `startRide` sets `momSpeed = 0` and lands you at a
flat `MAW_SPIT_SPEED`, so a 22 u/s entry or a `railCap()` overspeed is
**downgraded**. That single fact is what stops it being strictly better than
driving, and why the spit is a flat eject rather than a multiplier. No gold toll —
the pit already takes gold, and a maw that charged would read as a hazard.

**What it pays:** landing *into* a machine, `onPartTrigger()` on landing so the
chain survives, and `recordShot("maw")` plus a `NAMED_COMBOS` entry (without one
the id is invisible to the chain layer).

Anti-skip: one maw per floor; on landing, arm **every** maw's cooldown, mirroring
`player.ts:940`'s all-hatches rule, so maw→maw ping-pong is impossible.

**Measurable — the Φ-skip census**, and this is the wave that most needs it.
Record `phiAt(entry) − phiAt(exit)` per ride, assert **two-sided**: p95 ≤
`MAW_PHI_DROP_MAX` (unbounded max means it *is* a floor skip) **and** mean > 0 (a
zero mean means it is a slow trapdoor). Neither bound alone says anything.
Second: chain-continuation rate versus the trapdoor's. **If they are equal,
`pickMawExit` is doing nothing and the maw is a re-skinned trapdoor.**

### B-Wave 4 — `gate` + `diverter`

Ship together: they are the two parts that make the assembly router meaningful (a
directional `in`-only port, and the first two-exit machine).

**`gate`** — the one-way. The pipeline already asserts a one-way flow field; a
gate makes it visible and enforceable rather than statistical, and kills the
launch-duel class by construction (decorate.ts records 54.5% of floors once
carried one). Handler is `mirror` plus a direction test. **The soft-lock risk has
exactly one mitigation that works:** below `GATE_HOLD_SPEED 3` a walking knight
pushes through either way — a one-way for the **ball**, a door for the **knight**.
Verify as a reachability property in a seeded generator test, not a playtest.
**PortFlow: `ballistic`, `way: "in"` only** — being in-only *is* the mechanic.

**`diverter`** — a `deflector` whose second leg alternates on `swingPhase`, so
B-Waves 1 and 4 share one clock primitive. Not the spinpad: that rotates your
heading by an arbitrary continuous angle, while a diverter picks between **two
authored exits**. The difference between chaos and a fork you can learn, and the
only part that lets the generator author a genuine *branch*. **PortFlow: `eject`
with TWO out ports** tagged left/right — what `assembly-place.ts` needs to build a
*route* rather than a chain. Its derived stride is `ceil(13 × 0.18 / 0.3) = 8`,
exactly `PAD_STRIDE`, so it slots into the existing spacing rule unchanged.

Measurables: for the gate, launch-duel rate across 40 seeded floors with and
without — **if it does not fall, gates are decoration**. For the diverter, the
what-you-see contract as a test: the left/right split approaches 50/50 over a run,
but **per-entry it must be 100% predictable** from `swingPhase` at contact time.
That is the rule the spinpad rebuild established, finally made into a gate.

### B-Wave 5 — `magpost`

Last, because it is the case that exercises B-Wave 0's `grabT` fix at
`throwSpeed ≈ 0`. Distinct from both existing magnets: `magstrip` clamps
`momSpeed` (a zone), the `magnet` **enemy** translates `p.x/p.z` directly. Neither
*holds and then drops*. The skill is in the drop: you get steering back at zero
speed on a live playfield, mid-machine.

**PortFlow: `in` = eject, and NO out port — a terminus.** `hasExit()` already
models this. Note `assembly.ts`'s comment names *the scoop* as its example
terminus; ours is the opposite — the scoop is the best chainable eject in the game
and the magpost is the real terminus. Say so, or the router inherits a wrong
assumption from an accurate-sounding comment.

### Ruled out, with reasons

- **Plunger lane** — shipped (`maze/track-launch.ts`, `updatePlungerRig`,
  `trySkillShot`).
- **Drop-through subway** — that is the trapdoor plus the ride.
- **Spinning disc that redirects** — that is `spinpad`.
- **Whirlwind spinner** — a real spinner is a wireform you pass *through*,
  scoring per revolution. With no vertical wireform and a knight for a ball it is
  visually indistinguishable from `rollover`.
- **Captive ball** — genuinely blocked: the whole mechanic *is* the second body's
  trajectory, and there are no dynamic colliders. The swing arm's analytic swept
  test works because the arm's motion is *prescribed*; a captive ball's is not.
- **Ball lock / multiball feeder** — `entities/multiball.ts` is
  echo-knights-as-a-buff; there is no ball to lock. Get the fantasy for one line
  instead: let the scoop arm multiball.
- **Drain + kickback** — there is no drain; nothing to be saved from.

---

## The registry cost of a new part kind

**Compile-enforced — 5 sites:** `PinballPartKind` (`state.ts:510`),
`PART_HANDLERS` (`pinball-collide.ts:332`), `PART_BUILDERS`
(`pinball-parts.ts:842`), `PART_HIT_LIFETIME` (`:976`), `PART_ANIMATORS`
(`:1022`).

**NOT enforced — 10 sites, every one a silent failure:** `PartSpotKind`
(`decorate.ts:62`, bridged by the D4 cast); `KIND_TOPOLOGY` (`:1024`, missing kind
falls back to `"junction"`); `spotForKind` (`:1039`, if-chain with a
copy-the-topology default); `deal` (`:2358`), `hazardDeal` (`:2646`),
`FORWARD_FLOW_KINDS`, `LAUNCH_KINDS`, `HAZARD_KINDS`; `simulateHazards` (D3);
`createPinballParts`' field-init ternaries (`pinball-parts.ts:893`);
`part-broadphase.test.ts`'s hand-listed `REACHES`; `floor-populate.ts:107`
(what enemies guard); `__dungeonParts`; `NAMED_COMBOS`.

A launcher missing from `LAUNCH_KINDS` skips the no-orphan runway check and is
placed firing into rock. Missing from `FORWARD_FLOW_KINDS` means its heading is
`classifyTopology`'s coin flip — the defect decorate.ts's own comment blames for
73% of the floor.

**`registry-drift.mjs` catches none of it** (D5). Check G lands in B-Wave 0,
modelled line-for-line on check F, which already has the `valueSpan` + token-scan
machinery in the same file. Reuse check F's `readIfPresent` discipline — a checker
that throws on a renamed file becomes a wall blocking every edit in the repo,
which that file already learned the hard way.

---

## Verification

Per wave, in order:

1. `npx tsc --noEmit` — the build does **not** typecheck (`next.config.js` sets
   `ignoreBuildErrors`), so this must be run by hand.
2. `node scripts/hooks/registry-drift.mjs` — mandatory for every Track B wave.
3. `npx vitest run src/game/pinball-knight/maze` — ~370 s alone, dominated by four
   whole-floor census gates. Iterate against `decorate.test.ts` (7 s) and
   `archetypes.test.ts` (3 s); run the full gate before committing.
4. `node scripts/floor-census.mjs --out before.json` / `--diff` — proves the RNG
   stream was not disturbed. It drives the real game through the real
   `startLevel` rather than a re-implementation, because `floor-pipeline.test.ts`
   already carries the scar of a local copy of the budget arithmetic that went
   three tunings stale. A dirty diff on a corridor floor is a bug; a dirty diff on
   a Great Hall is the point.
5. `scripts/open-space-census.mjs`, same-seed paired, on floors never used for
   tuning. Expected direction: `worstBarren` ↓, `openDeadShare` ↓,
   `biggestSectionRatio` → 1, `chamberShare` **flat**, `deadEnds` **flat**.
6. `npm run playtest` and the `__lab()` / `__dungeonBot({seconds})` /
   `__dungeonParts` / `__dungeonPlayer` surface. Headless runs under swiftshader
   at 2-8 fps, so **no frame-rate claim is measurable there** — poll with a
   wait-for-condition, never sleep. Flow and lock-duty are sim-time ratios and are
   unaffected.
7. Actually play a Great Hall floor. `__lab.floor(n)` / `__lab.lock(n)` jump
   straight to one; `__dungeonFreshRun()` then reload, or the resume floor blocks
   floor-1 testing.

| regression | caught by |
|---|---|
| busier rather than better-distributed | `floor-density.test.ts` — `maxPartsPer1k 34`, `maxFurniturePer1k 110` |
| a machine part fires into stone | `piece-rules.test.ts` — furniture rule 1, `MIN_PART_RUNWAY 3` |
| a machine strands or shortens the route | `floor-pipeline.test.ts` (structurally impossible while carve-free) |
| flag-on rerolls floors that should be identical | `floor-pipeline.test.ts` determinism + the new bit-identity block |
| the plaza is still empty | `open-space.test.ts` |
| the Great Hall loses its chamber | `chamberShare` in the census diff — **gate it in A-Wave 4** |
| a new part kind silently does nothing | `registry-drift.mjs` check G — **B-Wave 0** |

---

## Risks

- **The density gate is the real constraint on A-Waves 1 and 3**, and the
  mitigation in both cases is one line of ordering (`decorate.ts:2254`). Get it
  wrong and the wave fails on merge day.
- **`furnishRooms` assumes rects; the plaza is a disc.** Unclipped emissions land
  in rock.
- **Cross-machine launch duels cannot be caught at authoring time.** Two islands 8
  tiles apart with facing drives will silently demote one part. Accept it and
  **count it** in the census rather than pretending it will not happen.
- **Doorway funnels are the cautionary tale.** They work (+6.1 pp capture,
  same-seed paired over 100 held-out floors) and still ship off, because the tile
  shapes they leave are not in `piece-rules`' vocabulary. Staying carve-free is
  what keeps A-Waves 3-4 out of that drawer.
- **RNG order is unforgiving.** `floor-authoring.ts`'s header: _"Reorder any two
  draws and every draw after them changes — a completely different floor that
  renders perfectly, throws nothing, and passes every unit test."_ Every new draw
  goes last in its function and behind a flag.
- **Ports carry no behaviour yet.** `portsChain` is a predicate and nothing in the
  runtime consumes a port. A-Waves 3-4 buy *placement coherence*, not *chaining* —
  a ball leaving `scoop-keep` is launched by the `spring` underneath it, not by
  the port. Track 2b's port-signature work is where chaining becomes real. **Do
  not oversell A-Wave 4.**
- **Thresholds in A-Wave 0 are derivations, not measurements.** That is what the
  wave exists to fix, and the house convention is that the measured number gets
  written down next to the constant it justifies.

## Conventions this subtree enforces

- Exhaustive `Record<Kind, Handler>` tables, never a catch-all `else`.
- The identity element of any new table is neutral — all multipliers 1, all
  additives 0 — with a test asserting it field by field.
- New generation behaviour derives its own RNG stream and consumes zero draws from
  the caller's (`surface-paint.ts` is the worked example).
- No `Math.random()` in a physics path co-op replays.
- A mechanic the player cannot see is a bug: every surface has a tint, every
  movement policy a telegraph colour, every one-way lane its chevrons.
- One instrument per quantity — `piece-rules.ts`' header warns about two.
- `engine/` is DOM-free and THREE-free (`purity.test.ts`, `core-boundary.test.ts`).

---

## Status

| Wave | State |
|---|---|
| A-0 measure the hole | **SHIPPED** 2026-07-31 — `maze/open-space.ts`, `dev/open-space-census.ts`, `scripts/open-space-census.mjs`, `dev/headless-floor.ts buildHeadlessPlan`, 18 tests. Bands armed off 180 measured floors. **Result revises the plan — see above.** |
| A-1 chambers become rooms | **blocked on a scoping decision** (the defect is depth-wide, not Great-Hall-only) |
| A-2 library correctness | not started |
| A-3 island placer | not started |
| A-4 islands + archetype dial | not started |
| B-0 make additions safe | not started |
| B-1 `swingarm` | not started |
| B-2 `scoop` | not started |
| B-3 `maw` | not started |
| B-4 `gate` + `diverter` | not started |
| B-5 `magpost` | not started |
