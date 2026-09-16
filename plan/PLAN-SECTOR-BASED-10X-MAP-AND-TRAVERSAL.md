# Implementation Plan: 10× Sector-Based World Architecture & Traversal Rework

**Date:** 2026-09-16  
**Status:** In Review (Plan Mode - Awaiting User Approval)  
**Standard:** Verified-Claim Plan Methodology ([VCPM](../../../.agents/plan-verification-standard.md))  
**Target Repository:** `pinball-knight/ThreeJS`

---

## 1. Ground Truth & Problem Statement

### 1.1 Context & Baseline
The game engine's deep-floor ceiling currently saturates at **96 × 72 cells** (approx. 6,912 cells, producing a $(2c+1)$ tile grid of $193 \times 145 = 27,985$ tiles with ~18,627 walkable tiles at depth L23–L24).
While documented candidate `(132, 100)` raises the measured start-to-stairs walking path from 382 to 755 tiles, it only expands area by ~1.9×.
The intended vision requires a true **10.0× walkable area expansion**, reaching approximately **304 × 228 macro cells** (~278,313 tiles).

### 1.2 Identified Traversal Flaw
Currently, dead ends place high-ballistic catapults (`dead-end-mechanisms.ts:294-308`) with landing coordinates selected via an unconstrained random search across the entire floor (`pinball-collide.ts:1230-1256`):
```ts
const ti = 1 + Math.floor(Math.random() * (g.w - 2));
const tj = 1 + Math.floor(Math.random() * (g.h - 2));
```
In a 10× world, random sampling or unconstrained launches can bypass districts or accidentally deposit the knight into the boss arena or stairs. Traversal mechanisms must become **deliberate strategic regional shortcuts with precomputed landing pads and anti-skip exclusion zones**.

---

## 2. Pre-Review Claim Matrix (VCPM Standard)

| Claim ID | Category | Claim Statement | Evidence Source |
|---|---|---|---|
| **C-01** | **Verified Fact** | Current deep-floor ceiling in `constants/level.ts` saturates at 96 × 72 cells (~6,912 cells). | [`ThreeJS/src/game/pinball-knight/constants/level.ts#L197-L198`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/constants/level.ts#L197-L198) |
| **C-02** | **Verified Fact** | Repository documents `(132, 100)` as candidate yielding 53,265 tiles, 36,109 walkable, and extending start-to-stairs walking path from 382 to 755 tiles with 755ms gen time. | [`constants/level.ts#L176-L192`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/constants/level.ts#L176-L192) |
| **C-03** | **Verified Fact** | Catapults are configured with `CATAPULTS_PER_FLOOR = 2`, `CATAPULT_FLIGHT_DUR = 1.35s`, `CATAPULT_HOP_HEIGHT = 6.0`, and `hopSpeed = 16`. | [`constants/pinball.ts#L644-L651`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/constants/pinball.ts#L644-L651), [`entities/player.ts#L1250-L1252`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/player.ts#L1250-L1252) |
| **C-04** | **Verified Fact** | Current catapult landing target selection in `pinball-collide.ts` randomly samples coordinates across the entire grid without checking progression sectors, boss proximity, or stairs. | [`entities/pinball-collide.ts#L1230-L1256`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/pinball-collide.ts#L1230-L1256) |
| **C-05** | **Verified Fact** | Boss arena requirements dictate radius `BOSS_ARENA_R = 7` and clearance width `BOSS_ARENA_MIN_WIDTH = 9` derived from `doSlam` slam radius (2.6) and king body radius (0.784). | [`maze/floor-rules.ts#L202-L216`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/maze/floor-rules.ts#L202-L216) |
| **C-06** | **Verified Fact** | Mega-floor generator harness `dev/mega-floor.ts` and `scripts/maze-scaling.mjs` test scaling factors up to 4× linear (16× area), with benchmark logs in `docs/perf/maze-scaling-benchmark.json`. | [`dev/mega-floor.ts#L67-L126`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/dev/mega-floor.ts#L67-L126), [`docs/perf/maze-scaling-benchmark.json#L7-L92`](file:///home/lazycat/github/projects/sun/pinball-knight/docs/perf/maze-scaling-benchmark.json#L7-L92) |
| **C-07** | **Verified Fact** | `pinball-knight/ThreeJS` is the Three.js web application owning these systems; `drift-king` is a separate Rust/WASM simulation codebase. | [`drift-king/web/index.html#L21`](file:///home/lazycat/github/projects/sun/drift-king/web/index.html#L21), [`pinball-knight/ThreeJS/package.json#L1-L26`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/package.json#L1-L26) |
| **C-08** | **Testable Claim** | A sector-based hierarchical generation pipeline can construct a 304 × 228 cell floor within 1,200ms on Node.js without memory exhaustion. | To be verified via `scripts/maze-scaling.mjs` benchmark suite. |
| **C-09** | **Testable Claim** | Traversal-aware shortest path graph solver will guarantee $D_{\text{traversal}}(\text{start}, \text{boss}) \ge 0.60 \times D_{\text{walk}}(\text{start}, \text{boss})$ across all fixture seeds. | To be verified via new `traversal-graph.test.ts` suite. |
| **C-10** | **Testable Claim** | Sector-based frustum culling and chunked mesh instancing will maintain frame time < 16.6ms (>= 60 FPS) and draw calls <= 180 during traversal on large floors. | To be verified via Playwright headless frame-timing runner. |
| **C-11** | **Assumption-1** | User prompt prompt text *"make the Drift King game that's a three JS version that's the website have way larger match map"* was a naming slip for **Pinball Knight** (which contains all quoted constants and Three.js website architecture). | Stated risk: building for wrong target. Mitigation: explicitly target Pinball Knight in plan and request confirmation in follow-up question. |
| **C-12** | **Assumption-2** | Target **304 × 228** denotes macro `cellsW × cellsH` ($\sqrt{10} \times 96 \approx 304$, $\sqrt{10} \times 72 \approx 228$), producing a tile grid of $(2c+1) = 609 \times 457$ tiles (~278,313 tiles total). | Stated risk: sizing mismatch if user intended 304 × 228 final tiles. Mitigation: explicitly provide both interpretations in scale ladder options. |

---

## 3. Scale Ladder Definition

| Milestone | Grid Target (`cellsW × cellsH`) | Tile Grid (`w × h`) | Area Ratio vs Baseline | Purpose |
|---|---|---|---|---|
| **Baseline** | 96 × 72 | 193 × 145 (~28k tiles) | 1.0× | Shipped production baseline |
| **Phase 1** | 132 × 100 | 265 × 201 (~53k tiles) | 1.9× | Documented candidate; validates scaling & density assumptions |
| **Phase 2** | 192 × 144 | 385 × 289 (~111k tiles) | 4.0× | Validates multi-region macro graph routing and performance |
| **Final** | 304 × 228 | 609 × 457 (~278k tiles) | 10.0× | Intended large-map sector-based experience |

---

## 4. Sector-Based Macro-Architecture

### 4.1 Sector Grid & Roles
The level is partitioned into discrete sectors (32 × 32 tiles).
For a 609 × 457 tile grid, this yields an approximate $19 \times 14$ grid (~266 sectors).

Each sector is assigned:
1. **Role**:
   - `entry_district`: Safe onboarding, starting perimeter corner, low hazard, zero bossward catapults.
   - `exploration_maze`: 2 to 4 linked districts with distinct biome/visual identities (Warrens, Ringkeep, Cavern, Forge).
   - `mechanism_hub`: Strategic hub containing catapults, seesaws, cannons, and coaster rails connecting adjacent districts.
   - `elite_landmark`: Arenas containing elite encounters, special vaults, or puzzle rooms.
   - `boss_antechamber`: Guarded threshold zone with controlled gateway access.
   - `boss_arena`: Deepest branch, radius $R=7$, with hard anti-skip boundaries.
   - `optional_loop`: Exploration loops with high-value loot and return paths to prevent backtracking fatigue.
2. **Occupancy & Density Budget**:
   - Scaled strictly by **walkable area**, not bounding box rectangle.
   - Local caps per sector guarantee even distribution, preventing clustering.

### 4.2 Sector Generation & Gateway Stitching
1. **Macro Graph Carve**: Build the sector adjacency graph and designate the main progression artery before carving tile geometry.
2. **Local Sector Carve**: Carve corridors, chambers, and obstacles within each sector using deterministic PRNG seeded with `hash(floorSeed, sectorX, sectorY)`.
3. **Gateway Alignment**: Stitch adjacent sectors through validated doorways and corridor mouths, maintaining global path connectivity.

---

## 5. Traversal Rework & Anti-Skip Protocol

### 5.1 Mechanism Tiers & Reach Limits

| Mechanism | Max Strategic Reach | Permitted Target Sectors | Forbidden Actions |
|---|---|---|---|
| **Seesaw / Ramp** | 4–8 tiles | Intra-sector only | Cannot cross sector boundaries or wall bands > 2 tiles |
| **Catapult** | 14–26 tiles | Adjacent or 1-hop sector | Cannot land in Anti-Skip Zones or skip > 1 district |
| **Aimable Cannon** | 16–32 tiles | Line-of-sight runway in adjacent sector | Cannot fire blindly or into boss approach |
| **Coaster / Rail** | 20–50 tiles | Authored regional transit between hub stations | Cannot link Entry District directly to Boss Antechamber |
| **Portal / Trapdoor** | Multi-sector | Locked behind district switch/key | Cannot bypass core exploration until earned |

### 5.2 Precomputed Landing Pad Registry
1. Replace the raw `Math.random()` coordinate search in `pinball-collide.ts` with a registered `LandingPadRegistry`.
2. A landing pad is registered only if:
   - Tile is fully walkable (`isWalkable(g, x, z)`).
   - Clearance $\ge 1.5$ tiles from walls, pits, and spikes.
   - Not inside an Anti-Skip Zone.
   - Connects to forward routes (BFS confirms open escape paths).
3. Visual Signaling:
   - Landing pads are rendered with clear visual targets (runway lights, smoke decal, landing catcher circle).

### 5.3 Anti-Skip Zones
1. **Boss Arena & Antechamber Protection**:
   - Exclusion radius $R_{\text{boss\_excl}} = 25$ tiles where no catapult/cannon landing pad may be placed.
   - Airborne trajectory clipping: Airborne trajectories passing through the vertical bounds of the boss chamber are clamped to the antechamber threshold.
2. **Stairs & Start Protection**:
   - No catapult may deposit the player within 15 tiles of stairs or spawn.

### 5.4 Traversal-Aware Shortest Path Metric
- Maintain dual graph metrics:
  - $D_{\text{walk}}$: Shortest walking route from start to stairs/boss.
  - $D_{\text{traversal}}$: Shortest path on the multigraph where catapults, cannons, and rails are directed edges with cost = travel time.
- Invariant Gate:
  $$\frac{D_{\text{traversal}}}{D_{\text{walk}}} \ge 0.60$$
  and path must transit at least 4 intermediate sectors before reaching the boss approach.

---

## 6. Runtime Performance, Streaming & Culling

1. **Chunked Mesh Instancing**:
   - Partition floor and wall instanced meshes into 32 × 32 tile sector chunks.
2. **Frustum & Proximity Culling**:
   - Toggle visibility off for sectors outside camera frustum + 1 neighbor padding.
3. **AI Simulation Throttling**:
   - Freeze zombie AI and projectile updates in sectors $> 2$ hops away from player.
4. **Light Pooling**:
   - Maintain strict pooling (`TORCH_LIGHT_POOL = 6`), dynamically allocating active point lights to nearest visible torches.

---

## 7. Verification & Acceptance Criteria

1. **Automated Tests**:
   - Scale ladder generation determinism across milestones (1.0×, 1.9×, 4.0×, 10.0×).
   - Anti-skip landing pad validation suite.
   - Dual-path route metric validation suite.
   - Regression census fixture isolation check.
2. **Performance Benchmarks**:
   - Generation time at 10× on Node $\le 1,200\text{ ms}$.
   - Memory heap $\le 250\text{ MB}$.
   - Active draw calls during traversal $\le 180$.
   - Frame rate $\ge 60\text{ FPS}$ (frame time $\le 16.6\text{ ms}$).
