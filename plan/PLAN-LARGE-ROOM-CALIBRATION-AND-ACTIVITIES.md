# PLAN: Calibrating Large Rooms & Plazas for Interactive Pinball Dungeon Gameplay

**Status:** Brainstorming Plan Completed (Awaiting User Implementation Approval)  
**Date:** 2026-09-17  
**Author:** Pair programming with LazyCat420  
**Target Project:** `pinball-knight` (LazyCat420)  
**Corpus Root:** `/home/lazycat/github/projects/sun/pinball-knight`  

---

## 1. Executive Summary & Root Cause Analysis

Following the deployment of the Option A aggressive progressive scaling ramp, floor geometry expands aggressively on deep floors:
- **Level 1**: $64 \times 48$ cells ($129 \times 97$ render tiles, $\sim 0.44\times$ area)
- **Level 5**: $104 \times 78$ cells ($209 \times 157$ render tiles, $\sim 1.17\times$ area, already exceeding former Level 24 maximum)
- **Level 10**: $192 \times 144$ cells ($385 \times 289$ render tiles, $\sim 4.00\times$ area, 6–10 sectors, dedicated `mechanism_gauntlet`)
- **Level 20+**: $304 \times 228$ cells ($609 \times 457$ render tiles, $\sim 10.00\times$ area)

While the macro scale and sector routes are vast, **large rooms, arenas, and plazas contain wide barren spaces**. 

### Primary Root Causes Identified in `ThreeJS/src/game/pinball-knight/maze/decorate.ts`

Through code inspection of `decorate.ts` and `author-floor.ts`, four architectural bottlenecks leave large rooms empty:

1. **The Blanket `inRoom(p)` Exemption Gate**:
   - `inRoom(p)` in `decorate.ts:2434` defines any tile inside `[r.i0, r.i0 + r.w) × [r.j0, r.j0 + r.h)` as belonging to a room.
   - Almost all procedural decoration passes unconditionally skip room tiles:
     - Zombie mob spawns: `floors.filter(p => ... && !inRoom(p))` (line 2445)
     - Torches: `!inRoom(p)` (line 2511)
     - Item/potion drops: `if (inRoom(p)) continue;` (line 2561)
     - Rail loops / circuits: `inRoom({ i, j }) ||` (line 2605)
     - Machine assemblies: `inRoom({ i, j }) ||` (line 2686)
     - Vault ramps: `if (inRoom(p)) continue;` (line 2809)
     - Hazards (spikes, pits, flame jets): `!inRoom(c)` (line 2829)
     - Flywheels: `if (inRoom(c)) continue;` (line 3078)
     - Seesaws: `if (inRoom(p)) continue;` (line 3125)
     - Wall springs: `if (inRoom(p)) continue;` (line 3177)
     - Rollover arrays: `!inRoom(c)` (line 3191)
     - Swingarms: `if (inRoom(p)) continue;` (line 3212)
     - Magposts: `if (inRoom(p)) continue;` (line 3227)
     - Catapults: `if (inRoom(c)) continue;` (line 3795)
     - Cannons: `if (inRoom(c)) continue;` (line 3857)

2. **Primitive Single-Pattern Archetype Furnishing in `furnishRooms`**:
   - `bumper` rooms: When oversized ($W \ge 24$ or $H \ge 24$), `STEP = 10` (line 1400), placing only 1 bumper per 100 tiles. In a $30 \times 30$ room (900 tiles), only $\approx 8$ bumpers are placed.
   - `speedway` rooms: Places exactly ONE 1-tile-wide line of boosters and ramps down the center line (line 1438). The remaining $98\%$ of the room is bare floor.
   - `arena` rooms: Spawns exactly 4 zombies in the 4 outer corners, 1 potion in the exact center, and 4 bumpers on outer wall midpoints (lines 1467-1489). Zero internal encounters, zero obstacles, zero torches.
   - `vault` rooms: Spawns exactly 2 zombies in corners, 1 weapon in the center, and 4 bumpers on wall midpoints (lines 1471-1489).

3. **Arbitrary Hard Capping on Machines (`ASSEMBLY_MAX = 6`)**:
   - `decorate.ts:656`: `const ASSEMBLY_MAX = 6;` and `ASSEMBLY_PER_WALKABLE = 3000;`.
   - On a 10× floor with 40,000+ walkable tiles, machine assemblies are still capped at 6 total across the entire world, and because of `inRoom({ i, j })`, they are forced only into narrow corridors rather than open chambers.

4. **Sparse Room Island & Play Space Generation**:
   - `room-islands.ts`: `authorRoomIslands` requires a massive $15 \times 15$ flat floor clearing (`x <= i+7 && y <= j+7`) to place a single $2 \times 3$ wall pillar. It caps total islands across the floor at `floor(g.w * g.h / 1800)`.

---

## 2. Confirmed Design Directives

The user has approved the following design choices:
1. **Activity Style: Hybrid Pinball Colosseum & Arcade**:
   - Tactical combat encounters paired with high-speed pinball mechanics (banked 45° corner slingshots, 3-bumper/5-bumper nests, drop target banks, and gargoyle kicker scoops).
2. **Physical Layout: Architectural Subdivision**:
   - Subdivide giant halls ($25 \times 25+$ tiles) using stone colonnades, $2 \times 2$ pillars, and deflector baffles to create 2–3 readable, connected bays rather than a single cavernous void.

---

## 3. Tiered Room Classification

| Room Tier | Span (Tiles) | Floor Area | Activity Budget | Architectural & Interactive Features |
|---|---|---|---|---|
| **Tier 1 (Chamber)** | $8 \times 8$ to $15 \times 15$ | $64 - 225$ tiles | 1 Primary Feature | Classic single setpiece: Pop nest, speedway lane, or corner-guarded chest. |
| **Tier 2 (Hall)** | $16 \times 16$ to $24 \times 24$ | $256 - 576$ tiles | 2–3 Features | Central architectural island (pedestal/colonnade), perimeter orbit rail, slingshot crossfire, mob pack. |
| **Tier 3 (Grand Plaza)** | $25 \times 25$ to $45 \times 45+$ | $625 - 2,000+$ tiles | 4–6 Features | Full pinball colosseum: multi-bay sub-arenas, drop target banks, kicker scoops, hazards, catapult shortcuts, wave encounters. |

---

## 4. Interactive Setpiece Blueprints for Subdivided Bays

### Bay 1: The Combat Colosseum
- **Central Stage**: Elevated/partitioned $4 \times 4$ or $6 \times 6$ courtyard with a high-tier chest or elite champion (Armored Zombie, Executioner, or Gargoyle).
- **Corner Slingshot Crossfire**: Banked 45° slingshots in corners that accelerate the knight diagonally across the room at high velocity.
- **Flanking Bumper Triangles**: Two 3-bumper nests flanking the central stage, creating high-frequency ricochets during combat.
- **Perimeter Torches & Sconces**: Regular wall torches along room perimeter giving dramatic lighting.

### Bay 2: The Arcade Playground
- **Honeycomb / Diamond Bumper Clusters**: Staggered bumper constellations (spacing 4–5 tiles, not 10 tiles) grouped into dense bouncing clusters.
- **Drop Target Bank**: 3-target or 5-target bank along an interior dividing partition. Striking down all targets awards extra score, replenishes knight rage/haste, or opens a secret passage.
- **Kicker Scoop (Gargoyle Scoop)**: A hole/scoop that swallows the knight, holds for 0.5s with mechanical hum, then fires the knight out into a booster lane at 2.5× speed.

### Bay 3: The Speedway & Transit Bay
- **Dual-Track Banked Outer Ring**: Continuous perimeter deflector rails allowing complete laps around the bay.
- **Center Jump Ramp over Hazard**: A vault ramp lined up with an interior hazard bed (spike pit or flame jets) that leaps across the room onto a safe landing pad.
- **Speed Gates & Rollover Arrays**: Arrays of rollover buttons down the acceleration lane that trigger combo multipliers when completed in order.

---

## 5. Architectural Subdivision Implementation

In `ThreeJS/src/game/pinball-knight/maze/room-islands.ts`:
- **Pillar Arrays**:
  - For rooms with $W \ge 24$ and $H \ge 24$, stamp pairs of $2 \times 2$ stone pillars framing the central thoroughfare.
- **Dividing Low Baffles**:
  - Short $1 \times 4$ or $4 \times 1$ wall baffles with deflector rubber edges that divide a 1,000-tile plaza into 2–3 connected bays.
- **Clearance Invariant**:
  - Maintain $\ge 4$-tile wide open passage around all interior dividers to ensure ball velocity is never trapped or choked.

---

## 6. Technical Execution Phases

### Phase 1: Budget & Exemption De-Bottlenecking in `decorate.ts`
- Replace blanket `!inRoom(p)` with fine-grained zone checking:
  - Keep spine thoroughfare clear (`isSpineReserved`).
  - Allow torches, monster hordes, hazards, and machines to claim valid tiles within rooms outside specific reserved corridors.
- Scale `assemblyBudgetFor(walkable)`:
  - Remove `ASSEMBLY_MAX = 6`. Dynamically scale: $\text{budget} = \max(2, \min(24, \lfloor \text{walkable} / 1200 \rfloor))$.
  - Allow `placeAssemblies` to anchor inside room activity sites.

### Phase 2: Modular Room Blueprints in `room-blueprints.ts`
- Implement `furnishColosseumBay`, `furnishArcadeBay`, and `furnishSpeedwayBay`.
- Wire into `furnishRooms` based on room scale tiers.

### Phase 3: Mob & Hazard Scaling for Room Interiors
- Arena and Gauntlet rooms receive mob squads scaled to area ($N_{\text{mobs}} = \min(16, \max(4, \lfloor A / 45 \rfloor))$).
- Perimeter wall torches stamped at regular 6–8 tile intervals along room walls.

### Phase 4: Verification & Test Suite Gates
- Run Vitest suite:
  - `author-floor.test.ts`
  - `decorate.test.ts`
  - `floor-rules.test.ts`
  - `canonical-floor-scaling.test.ts`
  - `regression-census.test.ts`
- Run maze corpus benchmark across 30 seeds to guarantee zero stuck states, zero closed flow loops, and valid traversal ratios ($\ge 0.60$).
- Container build and Synology NAS redeploy (`pinball-knight-web:latest`).

---

## 7. Plan Verification Standard Claims Matrix

| Claim ID | Classification | Statement | Evidence / Verification Method |
|---|---|---|---|
| **C-01** | `Verified Fact` | `inRoom(p)` in `decorate.ts` excludes torches, mob spawns, assemblies, circuits, and hazards from room bounding boxes. | Confirmed by direct source inspection of `decorate.ts:2434-3916`. |
| **C-02** | `Verified Fact` | Oversized bumper rooms set `STEP = 10`, leaving 99 out of 100 tiles empty. | Confirmed in `decorate.ts:1400`. |
| **C-03** | `Verified Fact` | `ASSEMBLY_MAX` is currently hard-coded to 6 regardless of floor size. | Confirmed in `decorate.ts:656`. |
| **C-04** | `Testable Claim` | Subdividing large rooms into 2–3 bays with hybrid pinball machinery will increase room interactive part density from $< 2\%$ to $8\% - 15\%$ without degrading 60 FPS performance. | Measure via headless floor census and browser stats on Level 10. |
| **C-05** | `Testable Claim` | Removing the blanket `!inRoom` ban while maintaining $\ge 4$-tile passage clearances will produce 0 unreachable tiles and 0 stuck loops. | Validate via `test:maze` suite and `maze-corpus-benchmark.mjs`. |
