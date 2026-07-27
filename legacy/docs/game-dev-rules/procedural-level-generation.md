# Procedural level generation — house rules

How we build and change map generators. Written against the Pinball Knight
dungeon (`src/game/pinball-knight/maze/`), but the workflow is game-agnostic:
the same steps apply to a roguelike floor, a racing circuit or a platformer
chunk graph.

Read this **before** editing a generator or adding a knob to one.

---

## 0. The one-paragraph version

Decide what a level must *accomplish* before deciding how to generate it.
Generate in layers (topology → embedding → prefabs → detail) so each layer can
be reasoned about and tested alone. Make the seed responsible for *structural*
choices, not just noise. Then measure the output — connectivity, critical path,
loops, choice density, hazard density — over a hundred floors, and gate on
those numbers in CI. Randomness that nobody measures degenerates into soup.

---

## 1. Reading list

The three sources worth actually mining, and what to mine each for.

| Resource | Type | Mine it for |
| --- | --- | --- |
| **Procedural Generation in Game Design** — Tanya X. Short & Tarn Adams | Essay collection (Spelunky, Dwarf Fortress, Ultima Ratio Regum…) | *Design constraints.* How to avoid "random soup" by specifying what each level must accomplish — critical path, optional branches, difficulty curve — before picking an algorithm. |
| **Procedural Content Generation in Games** — Shaker, Togelius & Nelson | Textbook (free online at [pcgbook.com](http://pcgbook.com/)) | *Algorithm taxonomy and evaluation metrics.* Search-based generation, constraint solving, grammar-based levels, and — the chapter that matters most here — how to **evaluate** generated content quantitatively. |
| **Reverse Design: Diablo II** — The Game Design Forum ([the randomness chapter](http://thegamedesignforum.com/features/RD_D2_5.html)) | Online essay series | *How randomness serves a core loop.* D2's maps are procedural in service of replayability and difficulty pacing, not for their own sake. |

Supporting material worth a skim: the [libtcod roguelike
tutorial](https://rogueliketutorials.com/tutorials/tcod/2019/part-3/) for BSP
room-and-corridor, community D2 map-generation reverse engineering
([d2-map-investigation](https://github.com/squeek502/d2-map-investigation),
[d2-mapper](https://github.com/mgalos999/d2-mapper)), and any Delaunay+MST
dungeon write-up for graph-based connectivity.

### What Diablo II actually does, and what to steal

- **Tile/prefab assembly, not per-cell noise.** Areas are assembled from large
  building blocks with fixed internal geometry and flexible interconnections —
  jigsaw pieces, not grid cells.
- **Seed-driven determinism.** A 32-bit seed fixes room variants, connections
  and exit directions. Given the seed, the map is exactly reproducible.
- **Hierarchical generation.** Macro topology first, then room tiles, then
  presets (shrines, monsters, graves) inside them.
- **Variety with *learnable* patterns.** Only ~31 bits of information go into a
  map, so speedrunners can learn correlations (early layout clues predict exit
  directions). Levels feel varied and can still be partially mastered. That is
  a feature, and it is the opposite of maximising entropy.

Steal: deterministic seeds, reusable prefab chunks, and *an intentional amount
of learnable information in the layout.*

### Algorithm families — the vocabulary

- **BSP** — recursively split space, allocate rooms, connect. Structured but
  varied; the default for room-and-corridor roguelikes.
- **Graph connectivity (Delaunay + MST + a few re-added edges)** — controllable
  branching and loops. The MST alone is a tree; the re-added edges are the
  loops, and loops are usually where the good gameplay is.
- **Random walk / corridor carving** — organic, cave-like.
- **Cellular automata** — caves. Cheap, needs a largest-blob pass.
- **Growing tree (Prim ↔ recursive backtracker)** — one parameter spans bushy
  many-junction mazes to long winding corridors. Cheap variety knob.
- **Agent/flow simulation (e.g. Physarum conductivity)** — naturally loopy
  networks that differ every seed. Expensive, hard to control, unbeatable for
  "organic circuit".
- **Search-based / evolutionary** — represent the map as a genome, score it
  with a fitness function, evolve. Only worth it once you have the metrics from
  §6, because the fitness function *is* the metrics.

---

## 2. Reverse-design before you generate

Treat existing levels — yours and your references — as data.

1. **Build a corpus.** Capture generated maps (screenshots or exported grids)
   plus reference maps. Annotate entrances, exits, key interactives,
   bottlenecks, loops, dead ends.
2. **Classify macro topologies.** Linear-with-branches, hub-and-spoke,
   ring-with-spokes, multi-loop circuit, maze-with-central-hub. Note which
   produce good play and which read flat or confusing.
3. **Mark the gameplay beats.** Where does the chaos happen, where are the
   chokepoints, where does the player get to breathe. Think in beats every
   level should hit, not in geometry.
4. **Profile difficulty and pacing.** How hazard density, enemy pressure and
   environmental complexity rise and fall across a map.

Write the answers down as *constraints* (§4). They become the validator later.

---

## 3. Generate in layers

Not one monolithic function. Four:

| Layer | Produces | Owns |
| --- | --- | --- |
| 1. **Topology** | An abstract graph of sections and connections | Loop count, branching, critical path shape |
| 2. **Spatial embedding** | That graph placed in the grid without overlaps | Room sizes, corridor widths, corner radii |
| 3. **Prefab placement** | Actual tile blocks assigned per node/edge | Gameplay role of each space |
| 4. **Detail** | Decor, hazards, pickups, multipliers | Reinforcing the macro intent, never contradicting it |

The payoff is not tidiness, it is *allocation over scavenging*: when the
topology layer owns loop count, you set the loop count. When it doesn't, you
scavenge whatever the noise happened to leave and call it a design.

> The Pinball Knight rework is exactly this story. The old pipeline derived the
> racing line from a finished maze (`generateMaze → pickEndpoints →
> widenMainArtery → arcSweeps`), so corner radius was whatever the maze left
> over: a census of 22,713 open tiles found **81.8% with an open radius of
> zero**, and radius-4 fillets fit **4 times across 40 floors**. Inverting to
> track-first (`growTrack → buildTrackPath → carveTrack → growMazeAround`) made
> radius an input, and radius 5–7 became routine. Same content budget, opposite
> result, because the layer that cared owned the space.

---

## 4. Write the non-negotiable constraints first

Plain rules now; the validator's assertions later. For a dungeon floor:

- **Critical path exists**, and its length sits inside a chosen min/max band.
- **Reachability**: every walkable tile the player can see is reachable from
  spawn. No exceptions, ever — a stranded player is the worst bug a generator
  can ship.
- **Branching**: at least N optional branches or side loops with rewards, at
  most M so the floor doesn't read as noise.
- **Difficulty curve**: hazard density and complexity ramp; chaos spikes in
  controlled zones rather than everywhere.
- **Readability**: entrance and exit discoverable within K seconds; no
  disorienting backtracking spiral unless it is the point of the archetype.
- **Coverage**: no large region of the floor left without content.

---

## 5. Seed responsibilities

Write down, explicitly, what the seed controls versus what stays local noise.

- The seed should choose **which archetype and which prefab combinations get
  assembled** — structural choices — not merely jitter placement.
- Same seed ⇒ identical map. Required for debugging, for co-op determinism, and
  for learnable patterns. No `Math.random` anywhere on a generation path.
- Decide what is keyed to **depth** versus keyed to the **run**. A pure depth
  cycle (`(level - 1) % 5`) makes floor 7 identical in structure across every
  run forever; shuffle the cycle per run so the *set* is preserved and the
  *order* is not.
- When you shuffle one depth-keyed table, check what else is paired to it **by
  index**. In this codebase `BIOMES` and `THEMES` are index-paired — shuffling
  themes without pointing `biomeFor` at the same shuffle silently decouples a
  floor's palette from its furniture.

---

## 6. Metrics — how you judge a generator

Implement these as a module the tests and any tuning script can call. In
Pinball Knight that is `maze/floor-metrics.ts`.

| Metric | Definition | Why |
| --- | --- | --- |
| **Reachability** | walkable tiles reachable from spawn ÷ walkable tiles | The hard constraint. Must be 1.0. |
| **Critical path** | BFS distance spawn → exit | Pacing. Band it per depth. |
| **Directness** | euclidean(spawn, exit) ÷ path length | 1.0 = a straight shot. Bank it well below. |
| **Turn rate** | direction changes ÷ path length | Distinguishes "bent once" from "genuinely snaking". |
| **Circuit rank** | `E − V + 1` over the topology graph | Independent loops. This *is* "figure-eight or better", measured directly rather than inferred from edge count. |
| **Dead ends** | walkable tiles with ≤1 walkable neighbour | Corridors to nowhere. The single loudest "this was generated" tell. |
| **Choice density** | tiles with ≥3 walkable neighbours ÷ walkable | The *choice heuristic* — how often the player faces a real branch. |
| **Coverage** | fraction of coarse regions with real floor area that host content | Catches empty quadrants. |
| **Leniency / hazard density** | dangerous tiles ÷ walkable, per region | Tune per difficulty; check it *ramps*. |
| **Feature share** | tiles belonging to the signature feature ÷ walkable | If a floor is "a circuit", measure that the circuit is actually most of it. |

Two rules about metrics themselves:

- **A metric that emits the same value on every floor is not measuring
  anything.** Check a scorer's *distribution* before trusting it as a gate.
- **Report what the gate dropped.** If a generator silently retries or caps,
  log it. Silent truncation reads as "covered everything" when it didn't.

---

## 7. Reverse-design your *own* generator against those metrics

Run a census — 100+ floors across every depth and archetype — and print the
table. Do not reason about the source; run it. Every finding below came out of
a census that took ten minutes to write, and none of them were visible by
reading:

- **A cap that binds from level 1 is not a cap, it is a constant.**
  `foods = min(15, area/260 + 4)` looks like area scaling and is not: at floor 1
  it already clamps, so a floor-10 map three times the area got *the same
  network*, and the circuit's share of the floor decayed 30% → 12% with depth.
- **A knob no live path reads is dead, however well-tuned it is.** Five floor
  archetypes shaped a grid the live path discarded — the descent card announced
  "The Cavern · no straight lines · the rock decides" over a floor generated
  without ever consulting the archetype. Measured signature across all five:
  identical.
- **Integration tests can pin the dead path.** The whole-floor test mirrored
  `startLevel`'s legacy branch, which a feature flag had switched off. It was
  green and it was testing nothing that shipped.

Document each failure mode concretely ("often creates long dead-end corridors
with nothing in them", "critical path exceeds the intended maximum") before
proposing a change.

---

## 8. Write improvements as policies, not patches

Phrase each change as a rule the generator obeys, then implement it:

- "After building the initial graph, prune branches with no reward and no loop."
- "Limit consecutive high-hazard prefabs; insert a safe section every N tiles."
- "Guarantee at least one loop in the mid-level region for replay routes."
- "Bias prefab selection so early regions favour low-risk tiles and later ones
  favour combo/boss tiles."
- "Every archetype must change a *measurable* property of the output, and the
  census must be able to tell them apart blind."

That last one is the acceptance test for a variety feature. If a census can't
distinguish your archetypes, neither can the player.

---

## 9. The validation loop

1. **Log the topology, metrics and seed with every generated map.** Keep a
   sample gallery.
2. **Gate in CI.** A fast smoke pass — N floors × {reachable, has spawn+exit,
   no orphan content, constraints satisfied} — that runs on every commit, plus
   the slow deep-invariant tests. The fast gate is the one that catches
   regressions; a 30-second integration test gets skipped.
3. **Re-census periodically.** Generators drift as knobs get retuned around
   them. Re-run the census after any wave that touches generation and compare
   against the numbers in the plan doc.

---

## 10. Traps this codebase has already paid for

Ordered by how much they cost.

- **Fix topology in topology-land.** Roads that dead-end in mid-air came from
  degree-1 nodes in the graph. Repairing at tile level ("extend the stub until
  it rejoins something") chases its own tail — each extension creates a new tile
  that is the new end of the road; it "joined" 8–24× per floor while the
  termination count never moved. Removing the leaf *node* fixed it outright.
- **A path is all leaves, so a leaf-pruner deletes it.** The Spine archetype's
  first implementation strung its food nodes along an open polyline, which is
  what "spine" sounds like. It produced nothing: lane share 0.016–0.056, circuit
  rank 1.1, and 8–10 floors in 10 failing the exit-distance constraint with the
  stairs 13 tiles from the spawn. `pruneLeaves` was removing the two ends, which
  exposed the next pair, cascading until only a cycle remained — and it was
  *right* to, because an open-ended road is a road that dead-ends in rock.
  A linear feature in a network that guarantees loops has to be built as a long
  thin **loop** (out along one side, back along the other), not a line. This is
  the general shape: check your authored feature against the invariants the
  later passes enforce, or they will quietly delete it.
- **Normalise a flow field before reinforcing it.** Raw Physarum flow magnitudes
  are ~0.02, so `Q^1.35` runs ~20× weaker than the decay term and every tube
  starves to the floor — a uniformly dead graph the pruner then reads as "all
  edges equal" (measured: 42/42 edges at 0.000). Only *relative* flow carries
  information.
- **A pruner that stops at the floor pins to the floor.** Pruning weakest-first
  until `rank ≥ minLoops` gives you exactly `minLoops` on every seed. Add a
  survival threshold relative to the network's own strongest edge so genuinely
  thriving connections are kept regardless.
- **Pass ordering is load-bearing, and the order is rarely the intuitive one.**
  Uncarve → connect → de-stub, because uncarving can disconnect (safe only
  because connect follows) and both earlier passes *create* new stubs. Publish
  curved-collision shoulders **after** every carving pass — publishing early
  orphaned 20.6% of arc tiles onto open ground.
- **A corner narrower than the straight feeding it is a funnel, and a ball with
  momentum wedges in a funnel.** Wider is always safe; narrower is a soft-lock.
- **Cap the chord length in a nearest-neighbour mesh.** One long chord swept
  with a wide brush paves everything it crosses: 8/40 floors ended up >70%
  track, one at 97% — a floor with no maze left in it.
- **Two opposed launchers with nothing between them make a standing wave.**
  Any "aim a thing at a thing" placement pass needs an anti-parallel check, and
  the check must test what is *between* them — two launchers with a wall between
  are harmless and must not be churned.
- **Every static analysis needs a runtime net.** Smashable walls reshape lanes
  mid-run; a pair that only lines up at speed will not appear in any census. Ship
  a rattle detector that damps a repeating bounce whatever caused it.
- **A generated floor is not a place until the plumbing is repaired.** Before
  the repair passes, 20 floors measured 105.8 dead ends and 116.4 wall stubs
  *each*. That, not the topology, is what made floors read as "a bunch of walls
  that go nowhere".
