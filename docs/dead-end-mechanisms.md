# Dead-End Interactive Mechanisms Specification & Architecture

**Date**: 2026-09-15  
**Author**: LazyCat420  
**Scope**: `pinball-knight` procedural maze generation pipeline (`ThreeJS/src/game/pinball-knight/maze/`)

---

## 1. Executive Summary & Goal

In previous generator revisions, dead ends (cul-de-sacs or corridor terminations with exactly one walkable neighbor) often remained empty stone dead zones if trapdoor budgets ran out or if the spot was within Manhattan distance < 8 of the start tile.

This feature establishes an architectural rule: **100% of dead ends across all generated dungeon floors must feature an engaging, interactive mechanism** so there is always a dynamic interaction for the player rather than a boring dead end.

---

## 2. Interactive Mechanics Hierarchy

When furnishing a dead end, `furnishDeadEndMechanisms(...)` checks the local geometry and assigns an appropriate mechanism:

1. **Existing Mechanics Preservation**:
   - If a room activity, pinball bumper, spinner, target bank, or item drop already exists at the dead end, it is preserved and tagged with `deadEnd: true`.

2. **Cracked Secret Breakthrough Doors (`T_CRACKED`)**:
   - If the wall at the back of the dead end directly borders another walkable room or corridor 2 tiles away, an even-aligned 2×2 secret band (`T_CRACKED`) is forged.
   - Cracking the wall creates a shortcut breakthrough into adjacent territory.

3. **Oracle Frog Perch**:
   - For dead ends situated far from the entrance ($\text{dist} \ge 7$), the mysterious Oracle Frog can perch at the end of the corridor to grant hints, lore, and secret directions.

4. **Directional Cannon (`cannon`)**:
   - For dead ends with a long, unobstructed straight runway ($\ge 3$ tiles) aiming down the corridor, an aimable cannon is installed.
   - Stepping in fires the player down the hallway.

5. **Kinetic Plunger Spring (`spring`)**:
   - Installed at dead ends with clear linear runways ($\ge 3$ tiles), aimed outward down the corridor to propel the player out at high speed.

6. **Coaster Trapdoor (`trapdoor`)**:
   - Subterranean coaster trapdoors installed in the floor, whisking the knight into the coaster transit rails.

7. **High-Ballistic Catapult (`catapult` - Guaranteed Fallback)**:
   - For tight, short-runway dead ends ($< 3$ tiles) where linear ground launchers would collide into an immediate wall, a high-arc ballistic catapult is placed.
   - The catapult launches the knight in a high vertical parabolic arc over walls and obstacles into adjacent open chambers.

---

## 3. Implementation Details

- **`ThreeJS/src/game/pinball-knight/maze/dead-end-mechanisms.ts`**:
  - `findDeadEnds(g, start, stairs)`: Discovers all walkable non-endpoint tiles with degree 1.
  - `isInteractiveDeadEnd(...)`: Validates whether a tile already has an interactive entity, secret wall, or drop.
  - `furnishDeadEndMechanisms(...)`: Places interactive mechanisms for 100% of discovered dead ends.
- **`ThreeJS/src/game/pinball-knight/maze/decorate.ts`**:
  - Wired into `decorateMaze` immediately before the final density clamp.
  - `clampMayRemove(p)` updated: Parts marked `deadEnd: true` or with multi-part banks are immune to density culling.
- **`ThreeJS/src/game/pinball-knight/maze/build.ts`**:
  - Clutter generation (decorative crates and barrels) checks `partTiles` and `frog` to avoid stamping clutter on top of dead-end interactive mechanisms.

---

## 4. Verification & Invariants

- **Zero Dead Ends Empty**:
  - Verified across 20 procedural floors in `dead-end-mechanisms.test.ts`. Every floor achieves 100% interactive dead-end coverage.
- **Outward Directional Alignment**:
  - Launchers placed in dead ends are verified to aim outward into the open corridor rather than into stone backing.
- **Launch Clearance (`clearRun >= 3`)**:
  - Ground-based launchers (`spring`, `booster`) only deploy when `runway >= 3`, satisfying the `track-socket.ts` clear runway contract.
