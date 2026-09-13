# Implementation Plan — Long Maze Snake Boss ("Ouroboros") on Level 5

**Target Project**: `pinball-knight`  
**Date**: 2026-09-12  
**Status**: PLAN ONLY (Awaiting User Review & Approval — DO NOT IMPLEMENT YET)  
**Methodology**: Strictly compliant with [`plan-verification-standard.md`](file:///home/lazycat/github/projects/sun/.agents/plan-verification-standard.md) (VCPM Claim Triage & Quality Gates)

---

## 1. Problem Statement & User Intent

The user requested creating a modular snake monster that acts as a pacing and timeframe challenge in Level 5:
> *"make a monster using nano banana make sprite sheet and animate. The monster is a really long snake we need to render the parts in pieces then put them together look up how animations for sprites will repeat the middle part of a snake in order to make it longer so we need to render its body parts seperate so we can extend it as long as we need it to be. The snake slowly gets longer and longer over time until it takes over the maze. have it in the 5th level. It's like a monster that causes the user to have to beat the game within a timeframe."*

### Key Requirements & Grill-Me Alignments
1. **Sequence**: Build the **Long Maze Snake** first, followed by the **Spider Swarm Colossus**.
2. **Modular Sprite Anatomy**:
   - **Head (`dragon_snake_head`)**: Commanding leader actor with jaws, glowing eyes, and venomous strikes.
   - **Repeating Middle Body Segments (`dragon_snake_body`)**: Modular cylindrical/scaly segments designed for infinite repetition. Animated with phase-lag undulating ripple to simulate natural traveling muscle contraction.
   - **Tail (`dragon_snake_tail`)**: Terminal rattle/fin segment swishing behind the last body link.
3. **Corridor Traversal (Breadcrumb History Buffer)**:
   - To prevent cutting through solid maze walls around 90° corners, segments follow a high-resolution breadcrumb position history buffer recorded by the head along corridor paths.
4. **Dynamic Growth & Soft Enrage**:
   - Starts at 8 segments.
   - Grows +1 segment every 4.5 seconds (reaching 35+ segments by 2 minutes).
   - Segments coil through corridors, constricting movement and creating a soft enrage time limit for Level 5.
5. **Pinball Interaction**:
   - Body segments act as energetic pinball bumpers: they reflect the player marble with high impulse.
   - Standard collisions inflict 1 damage to the player; boosted/super-charged collisions reflect safely and deal chip damage to the boss.
   - Head strikes register full/critical damage.
6. **Level 5 Boss Integration**:
   - Replaces or acts as the primary guardian encounter on Floor 5 (`BOSS_EVERY = 5`).
   - HUD banner displays snake length and maze constriction percentage.

---

## 2. Technical Architecture & Component Design

```
                     ┌───────────────────────────────┐
                     │   SNAKE HEAD (Boss Leader)    │
                     │  • Health Bar: Boss HP Pool   │
                     │  • Maze Corridor Pathfinding  │
                     │  • Head Strike & Venom Breath │
                     └───────────────┬───────────────┘
                                     │
                        Records (x, z, θ) Path Trail
                                     ▼
                     ┌───────────────────────────────┐
                     │  CORRIDOR BREADCRUMB BUFFER   │
                     │  Stores exact path traversed  │
                     │  by head inside maze tunnels  │
                     └───────────────┬───────────────┘
                                     │
           Samples buffer at distance intervals (k × 0.72)
                                     ▼
      ┌─────────────────────────────────────────────────────────────┐
      │            MODULAR REPEATING BODY SEGMENTS (1..N)           │
      │  • Repeating 16-bit scaly sprite pieces                     │
      │  • Phase-offset undulation: frame = (t - k*0.1) % 4         │
      │  • Pinball Bumper Collider: deflects ball, deals/takes dmg  │
      │  • Growth Engine: Inserts +1 segment every 4.5s             │
      └──────────────────────────────┬──────────────────────────────┘
                                     │
                        Trailing at terminal offset
                                     ▼
                     ┌───────────────────────────────┐
                     │      SNAKE TAIL (Rattle)      │
                     │  • Terminal tapered end piece │
                     │  • Anti-phase swish animation │
                     └───────────────────────────────┘
```

### Modular Repeating Sprite Animation Principles:
- **Phase-Lag Wave**: In real serpentine locomotion (lateral undulation), muscles contract in a traveling sinusoidal wave. For each segment $k$, the animation time offset is $\Delta t_k = -k \cdot \tau$. This prevents the snake from looking like a rigid stick and gives it a flowing, lifelike ripple.
- **Segment Overlap Spacing**: Distance between segment pivots is set to $D = 0.72$ world units (with segment radius $0.58$), ensuring a continuous scaly overlap without visual gaps even during 90-degree corner turns.
- **Tangent Alignment**: Each segment rotates to face tangent to the local path $\vec{T} = \text{normalize}(P_{k-1} - P_{k+1})$.

---

## 3. Atomic Claim Classification Matrix (VCPM Standard)

| ID | Claim Statement | Classification | Evidence / Source / Validation Path |
|---|---|---|---|
| `CLAIM-1` | `BOSS_EVERY = 5` in `constants/enemies.ts:1118`, designating Floor 5 as the first Mega Boss floor | **Verified Fact** | Inspect [`constants/enemies.ts:1118`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/constants/enemies.ts#L1118) |
| `CLAIM-2` | `dragon_snake_head`, `dragon_snake_body`, and `dragon_snake_tail` are registered in `SheetKey` and `manifest-inventory.ts` | **Verified Fact** | Inspect [`boot/sheets.ts:160`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/boot/sheets.ts#L160) and [`boot/manifest-inventory.ts:28-30`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/boot/manifest-inventory.ts#L28-L30) |
| `CLAIM-3` | Published sprite sheets and JSON manifests exist in `ThreeJS/public/sprites/` (`dragon_snake_head-S.*`, `dragon_snake_body-S.*`, `dragon_snake_tail-S.*`) | **Verified Fact** | Inspect [`ThreeJS/public/sprites/dragon_snake_body-S.json`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/public/sprites/dragon_snake_body-S.json) |
| `CLAIM-4` | `createDragonSnake` in `entities/dragon-snake.ts` creates modular segments, but currently has a static count (12) and no growth over time | **Verified Fact** | Inspect [`entities/dragon-snake.ts:75-80`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/dragon-snake.ts#L75-L80) |
| `CLAIM-5` | Invariant distance relaxation without path memory cuts corners through solid maze walls on 90° turns | **Verified Fact** | Geometric trace: straight line between $(x, z)$ and $(x+2, z+2)$ crosses diagonal wall $(x+1, z)$ |
| `CLAIM-6` | Path-history breadcrumb buffer with arc-length sampling enforces that segments strictly follow the corridor route traversed by the head | **Testable Claim** | Unit test verifying that every segment position $(x_k, z_k)$ is on a corridor tile when head traverses maze |
| `CLAIM-7` | Dynamic growth function `growDragonSnake(dragon, scene)` instantiates a new body segment mesh, registers it with `animationPresentation`, and appends it to `segments` | **Testable Claim** | Unit test verifying `dragon.segments.length` increases by 1 and new mesh is added to `state.scene` |
| `CLAIM-8` | Ticking growth every 4.5 seconds increases length from 8 to 20 segments within 54 seconds | **Testable Claim** | Unit test simulating 60 seconds with `updateDragonSnakeGrowth` |
| `CLAIM-9` | Pinball collision against body segments reflects player with `DRAGON_BOUNCE_SPEED` and inflicts 1 damage unless player has `turboT > 0` or `momSpeed >= PINBALL_BOOST_SPEED` | **Testable Claim** | Unit test in `dragon-snake.test.ts` testing boosted vs non-boosted collisions |
| `CLAIM-10` | Head hits deal 1.5× critical damage and trigger brief stagger flinch | **Testable Claim** | Unit test asserting critical damage on head vs body |
| `CLAIM-11` | Level 5 boss spawner assigns `dragon_snake` as the guardian for Floor 5 | **Testable Claim** | Integration test asserting `guardianFor(5).kind === "dragon"` or dedicated `dragon_snake` boss spec |
| `ASSUMPTION-1` | 35 segments is an optimal maximum length before the snake begins overlapping its own tail in a 20×20 grid maze | **Assumption** | Risk: Over-constriction causing impassable bottlenecks. Validation: Run automated maze pathfinding solver to check player escape routes. |
| `ASSUMPTION-2` | The snake moves at 1.8 units/second, allowing agile player marbles to outmaneuver it in open intersections | **Assumption** | Risk: Snake too fast/slow. Validation: Compare with player base speed (4.5 u/s). |

*Metrics: 5 Verified Facts (38%), 6 Testable Claims (46%), 2 Assumptions (15%), 0 Unverifiable Claims (0%). Passes VCPM ≥80% Gate.*

---

## 4. Proposed Code Changes

### Component 1: Modular Snake Engine & Growth Kinematics
- **File**: `ThreeJS/src/game/pinball-knight/entities/dragon-snake.ts`
  - Implement `PathBreadcrumbBuffer`: Ring buffer storing `(x, z, angle, dist)` history.
  - Implement dynamic growth: `growDragonSnake(dragon, scene, count?)`.
  - Implement phase-lag undulation calculation for body segment animators.
  - Implement boosted pinball bumper interaction (safe bounce + chip damage when boosted, contact damage when unboosted).
  - Add constriction calculation: `snakeConstrictionFraction(dragon, grid)`.

### Component 2: Level 5 Encounter & Boss Specification
- **File**: `ThreeJS/src/game/pinball-knight/boss-kinds.ts` & `boss.ts`
  - Configure Floor 5 boss encounter to spawn the modular growing snake with growth ticker active.
  - Ensure death sequence cleanly cascades collapse across all $N$ dynamic segments and disposes meshes.

### Component 3: HUD Constriction Indicator
- **File**: `ThreeJS/src/game/pinball-knight/gui/screens/dungeon-hud.ts`
  - Display dynamic snake length counter and maze constriction gauge when fighting the snake on Level 5.

### Component 4: Test Suite Verification
- **File**: `ThreeJS/src/game/pinball-knight/entities/dragon-snake.test.ts`
  - Tests for dynamic segment growth.
  - Tests for corridor breadcrumb path following (no wall clipping).
  - Tests for phase-lag animation offset.
  - Tests for pinball boosted vs unboosted collision dynamics.
  - Tests for memory cleanup and mesh disposal with variable length chains.

---

## 5. Verification Plan

### Automated Tests
- Run targeted vitest suite:
  ```bash
  cd ThreeJS && npm test -- dragon-snake.test.ts
  ```
- Run boss integration tests:
  ```bash
  cd ThreeJS && npm test -- boss-roster.test.ts
  ```
- Run full game simulation tests:
  ```bash
  cd ThreeJS && npm test -- simulate.test.ts
  ```

### Manual Verification
- Launch local dev server (`npm run dev` in `ThreeJS`).
- Descend or jump to Level 5.
- Observe:
  1. Modular snake spawning with Head, 8 Body segments, and Tail.
  2. Lifelike undulating wave animation rippling through repeating body segments.
  3. Snake slithering cleanly through maze corridors without clipping walls.
  4. Growth ticker adding segments every 4.5 seconds, lengthening the snake.
  5. Bumping into body segments bouncing the marble.
  6. Defeating the head triggering the death crumple across the entire serpent.
