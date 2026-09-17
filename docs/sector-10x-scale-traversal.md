# Sector-Based 10× Map Scaling and Strategic Traversal Rework

**Date:** 2026-09-16  
**Author:** LazyCat420  
**Status:** Implemented & Verified (Vitest 67/67 suites, 1036/1036 tests green)

---

## 1. Overview & Scale Ladder

To transition from monolithic maze generation at the previous 96 × 72 cell ceiling (~6.9k cells) to true 10× walkable area scaling without turning powerful traversal systems into accidental boss-delivery shortcuts, we established a 4-milestone scale ladder:

| Milestone | Macro Grid (`cellsW × cellsH`) | Full Grid (`(2c+1)`) | Walkable Area Target | Purpose |
|---|---:|---:|---:|---|
| **Current Baseline** | 96 × 72 | 193 × 145 | ~3,000 tiles (1.0×) | Existing shipped baseline |
| **Phase 1** | 132 × 100 | 265 × 201 | ~5,800 tiles (1.9×) | Validates scaling assumptions |
| **Phase 2** | 192 × 144 | 385 × 289 | ~11,700 tiles (4.0×) | Multi-region routing & density |
| **Final (10×)** | 304 × 228 | 609 × 457 | ~29,300 tiles (10.0×) | Full 10× large-map world |

---

## 2. Sector Graph Architecture

Large maps are decomposed into a 2D sector grid (default $32 \times 32$ tile sectors) governed by a macro route graph before and during corridor carving:

### Sector Roles
- `entry`: Safe onboarding district near spawn; clear exits, no bossward launches.
- `exploration`: Multi-region maze districts featuring thematic pinball mechanisms and hazards.
- `traversal`: High-density mechanism sector (catapults, cannons, rails, seesaws) connecting adjacent or mid-range districts.
- `side_loop`: Optional high-reward branches with returns to prevent backtracking fatigue.
- `boss_approach`: Controlled gateway antechamber preceding the boss arena.
- `boss_arena`: Protected boss zone and stairs exit with strict anti-skip boundaries.

### Anti-Skip Zones
Any tile within Euclidean distance $R \le 18$ tiles from the boss room or stairs is designated an **anti-skip exclusion zone**. Launches, teleports, and rails cannot select or target landing pads inside this boundary unless deliberately authored as the final gateway.

---

## 3. Traversal Mechanism Tiers & Reach Constraints

Every traversal mechanism has an authored reach ceiling preventing trivial floor skips:

| Mechanism | Max Sector Reach | Max Tile Distance | Anti-Skip Launch Block | Role |
|---|---:|---:|:---:|---|
| **Seesaw / Ramp** | 1 sector | 12 tiles | Yes | Local wall hop / hazard bypass |
| **Catapult** | 2 sectors | 28 tiles | Yes | Dead-end escape into adjacent district |
| **Cannon** | 3 sectors | 45 tiles | Yes | Player-aimed mid-range route choice |
| **Rail / Coaster** | 4 sectors | 70 tiles | Yes | Authored regional transit |
| **Portal / Trapdoor** | 5 sectors | 90 tiles | Yes | Earned macro shortcut |

### Precomputed Landing Pad Registry
- Launch targets are precomputed from a registry of validated walkable locations with $\ge 1.5$ tile clearance from walls and hazards.
- If dynamic changes block a landing pad, fallback vectors land the player safely in adjacent walkable tiles without jumping closer to the boss.

---

## 4. Traversal-Aware Route Metrics

We measure two graph distances from spawn to stairs:
1. $D_{\text{walk}}$: Shortest path via normal walking tiles.
2. $D_{\text{traversal}}$: Shortest path utilizing all placed catapults, cannons, rails, and portals as directed graph edges.

**Invariant:** Traversal mechanisms must save strategic travel time but cannot reduce path length below 40% of normal walking distance, and can never land inside the boss approach.

---

## 5. Automated Verification & Benchmarks

1. **Vitest Suite**: 67 test files, 1036 tests passed.
   - `src/game/pinball-knight/maze/traversal/sector-traversal.test.ts`: Validates sector graph generation, role assignment, mechanism reach constraints, landing pad selection, anti-skip boundaries, and Dijkstra dual-path route metrics.
   - `src/game/pinball-knight/maze/floor-rules.test.ts`: All existing floor generation contracts remain 100% green.
2. **Deterministic Scaling Benchmark** (`scripts/maze-scaling.mjs`):
   - **Scale 1.0× (96 × 72)**: 235.7ms gen time, 3,062 walkable tiles, 0 unreachable, 0 narrow gaps.
   - **Scale 1.9× (132 × 100)**: 329.5ms gen time, 5,865 walkable tiles, 0 unreachable, 0 narrow gaps.
   - **Scale 4.0× (192 × 144)**: 641.6ms gen time, 11,689 walkable tiles, 0 unreachable, 0 narrow gaps.
   - **Scale 10.0× (304 × 228)**: 1,743.7ms gen time, 29,274 walkable tiles, 0 unreachable, 0 narrow gaps.

---

## 6. Canonical FloorSpec & Option A Aggressive Progressive Scaling

To ensure the maze scales aggressively right from Level 1 and provides an expansive dungeon by Level 10:

1. **`resolveFloorSpec(opts)` (`maze/spec/floor-spec.ts`)**:
   - Single canonical authority for floor dimensions, area budgets, sector partitions, mission templates, and generator revisions.
   - Computes aggressive monotonic growth (Option A):
     - **Level 1**: $64 \times 48$ cells (**$129 \times 97$ tiles**, $0.44\times$ area) — roomy intro floor with launch areas and multiple chambers.
     - **Level 3**: $84 \times 63$ cells (**$169 \times 127$ tiles**, $0.77\times$ area).
     - **Level 5**: $104 \times 78$ cells (**$209 \times 157$ tiles**, $1.17\times$ area) — **exceeds the old deep-floor ceiling ($193 \times 145$)**.
     - **Level 7**: $140 \times 105$ cells (**$281 \times 211$ tiles**, $2.13\times$ area) — Phase 1 tier.
     - **Level 10**: $192 \times 144$ cells (**$385 \times 289$ tiles**, **$4.00\times$ area**, Phase 2 "Pretty Big" milestone, 6–10 macro sectors).
     - **Level 15**: $240 \times 180$ cells (**$481 \times 361$ tiles**, $6.25\times$ area).
     - **Level 20+**: $304 \times 228$ cells (**$609 \times 457$ tiles**, **$10.00\times$ area ceiling**).
2. **Pre-Carve `SectorPlan` Architecture**:
   - `generateSectorPlan(spec)` evaluates macro mission templates (`linear_descent`, `branching_hunt`, `locked_vault`, `mechanism_gauntlet`, `boss_approach`).
   - Reserves gateways on sector boundaries with local deterministic seeds (`hash32`).
   - Authoritative traversal destination assignment (`assignTraversalDestination`) with zero production `Math.random` fallbacks.
   - Pinned minimum traversal ratio $D_{\text{traversal}} / D_{\text{walk}} \ge 0.60$ and strict anti-skip boundaries ($R \ge 18$ tiles from stairs/boss).
3. **Dev & QA Controls (`window-hooks.ts`)**:
   - `window.__dungeonScale("phase1" | "phase2" | "final_10x" | number)`: Dynamically rescales the current floor in-place for live testing.
   - `window.__dungeonLevel(level, { tier, scaleMultiplier })`: Direct jump to any level with scale options.
   - `window.__dungeonStats()`: Reports active `gridW`, `gridH`, `cellsW`, `cellsH`, `scaleTier`, and `scaleMultiplier`.

