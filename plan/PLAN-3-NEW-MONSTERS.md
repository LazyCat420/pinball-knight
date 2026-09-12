# Implementation Plan — 3 New Monsters: Christmas Tree, Gas Can Duo, and Hamster in a Ball

**Target Project**: `pinball-knight` (Three.js version)  
**Date**: 2026-09-10  
**Status**: PLAN ONLY (Awaiting User Review & Approval — DO NOT IMPLEMENT YET)  
**Methodology**: Strictly compliant with [`plan-verification-standard.md`](file:///home/lazycat/github/projects/sun/.agents/plan-verification-standard.md) (VCPM Claim Triage & Quality Gates)

---

## 1. Problem Statement & User Intent

The user requested adding three distinct new monsters to the Three.js version of `pinball-knight`, generated using the **Nano Banana** sprite sheet pipeline (16-bit arcade pixel art on pure `#00FF00` chroma background):

1. **Christmas Tree Monster (`christmas_tree`)**:
   - Coniferous pine tree decorated with glowing ornaments, tinsel, and a golden star.
   - Hops on its wooden tree stump to move around the dungeon floor.
   - Throws festive ornaments at the player as ranged projectiles.
   - Upon death, bursts into bright roaring flames, burning down into smoldering embers and ash.

2. **1950s Rubber-Hose Gas Canister & Lighter Duo (`gas_can` paired with `zippo`)**:
   - Gas Can Monster: 1950s vintage cartoon style with rubber-hose arms/legs, white gloves, little shoes, and a cheerful smiling pie-eyed face.
   - Walks in pairs with the lighter monster (`zippo`).
   - When the Gas Can dies, it topples and spills a puddle of gasoline/oil on the ground.
   - The nearby lighter monster freaks out in panic, trips and falls over, touching flame to the ground.
   - When the lighter hits the ground, it ignites the gasoline, causing a dynamic fire wave to spread across the map.

3. **Hamster in an Exercise Ball (`hamster_ball`)**:
   - Chubby dwarf hamster running inside a clear, transparent plastic exercise ball with ventilation air holes.
   - Dual-mode collision physics:
     - **Normal Mode (`p.momSpeed <= 0`)**: Rolls into the walking knight and deals contact damage.
     - **Pinball Mode (`p.momSpeed > 0`)**: Acts as a dynamic spherical bumper/deflector, deflecting the player's pinball momentum into unpredictable angles with high-velocity rebound force.
   - Death: Upon defeat, the plastic ball cracks with spiderweb fractures and shatters into clear plastic shards, leaving the dizzy hamster tumbling out safely.

---

## 2. Visual Design & Nano Banana Sprite Sheets

All three 16-bit arcade pixel art sprite sheets have been generated on uniform `#00FF00` chroma green backgrounds in standard 4×4 grids (16 frames each):

### Monster 1: Christmas Tree (`christmas_tree`)
![Christmas Tree Sprite Sheet](/home/lazycat/.gemini/antigravity-ide/brain/20b39876-27c7-46c8-a982-0cf7dd782234/christmas_tree_sheet_1789080684405.jpg)
- **Row 0 (`idle`)**: 4 frames — Conifer branches swaying gently, lights twinkling, golden star shining.
- **Row 1 (`walk`)**: 4 frames — Stump hopping locomotion, crouching and bouncing forward on its wooden base.
- **Row 2 (`attack`)**: 4 frames — Branch rears back, plucks a glowing Christmas bauble ornament, and pitches it forward.
- **Row 3 (`death`)**: 4 frames — Shudders in defeat, bursts into bright orange/yellow roaring fire, incinerates into bonfire embers and charred stump ash.

---

### Monster 2: 1950s Toon Gas Canister (`gas_can`)
![1950s Cartoon Gas Canister Sprite Sheet](/home/lazycat/.gemini/antigravity-ide/brain/20b39876-27c7-46c8-a982-0cf7dd782234/gas_can_sheet_1789080700162.jpg)
- **Row 0 (`idle`)**: 4 frames — Cheerful rubber-hose idling, hands on hips, innocent smiling face.
- **Row 1 (`walk`)**: 4 frames — Jaunty whistling stroll forward on cartoon shoes, swinging gloved arms.
- **Row 2 (`attack`)**: 4 frames — Tilts forward, mischievous grin, and sprays a gush of dark gasoline/oil from spout.
- **Row 3 (`death`)**: 4 frames — X_X defeat eyes, topples sideways, denting and spilling a large pool of dark gasoline onto the floor.

---

### Monster 3: Hamster in a Ball (`hamster_ball`)
![Hamster in an Exercise Ball Sprite Sheet](/home/lazycat/.gemini/antigravity-ide/brain/20b39876-27c7-46c8-a982-0cf7dd782234/hamster_ball_sheet_1789080713785.jpg)
- **Row 0 (`idle`)**: 4 frames — Hamster inside transparent plastic ball sniffing and twitching whiskers with glossy sphere highlights.
- **Row 1 (`walk`)**: 4 frames — Hamster running paws forward inside sphere, causing the plastic ball to roll forward.
- **Row 2 (`attack`)**: 4 frames — High-speed sprint charge with circular speed blur and green/white kinetic bumper arcs.
- **Row 3 (`death`)**: 4 frames — Plastic ball fractures with spiderweb cracks, bursts into flying translucent shards, dazed hamster tumbling out with stars circling its head.

---

## 3. Atomic Claim Classification Matrix (VCPM Standard)

| ID | Claim Statement | Classification | Evidence / Source / Validation Path |
|---|---|---|---|
| `CLAIM-1` | `state.ts:EnemyKind` defines all monster kinds and can accommodate `"christmas_tree"`, `"gas_can"`, `"hamster_ball"` | **Verified Fact** | Inspect [`state.ts:360-402`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/state.ts#L360-L402) |
| `CLAIM-2` | `items.ts:ProjectileKind` union supports adding `"ornament"` for the tree's ranged attack | **Verified Fact** | Inspect [`items.ts:27`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/items.ts#L27) |
| `CLAIM-3` | `entities/floor-fx.ts` already has native Oil + Fire overlap ignition logic that turns oil into blazing fire (`spawnFloorFx("fire", x, z, radius, OIL_IGNITE_LIFE)`) | **Verified Fact** | Inspect [`entities/floor-fx.ts:1050-1063`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/floor-fx.ts#L1050-L1063) |
| `CLAIM-4` | Pinball deflection and momentum alteration via enemy collision exists in engine (`entities/zombie.ts:437-452`) | **Verified Fact** | Inspect [`entities/zombie.ts:437-452`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/zombie.ts#L437-L452) |
| `CLAIM-5` | `entities/combat.ts:killZombie` provides an explicit centralized hook for monster death events (`onBloaterBurst`, `onEspressoSpill`, etc.) | **Verified Fact** | Inspect [`entities/combat.ts:974-1020`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/combat.ts#L974-L1020) |
| `CLAIM-6` | Christmas tree stump hop can be animated with vertical sine displacement (`z.stumpHopY`) without breaking grid floor collision | **Testable Claim** | Unit test verifying hopping offset ticks while `z.x, z.z` respect `moveCircle` boundaries |
| `CLAIM-7` | Paired monster spawning and flocking cohesion can keep `gas_can` and `zippo` within tether range ($< 2.5\text{ tiles}$) | **Testable Claim** | Unit test checking partner assignment on spawn and proximity maintenance |
| `CLAIM-8` | Hamster ball collision checks `p.momSpeed > 0`: deflects ball trajectory with speed boost if true; calls `hitPlayer` if false | **Testable Claim** | Unit test verifying dual-mode branch behavior |
| `CLAIM-9` | Debug console and panel labels must satisfy `CHIP_CHARS <= 8` (`XMASTREE`, `GASCAN`, `HAMSTER`) | **Verified Fact** | Inspect [`gui/screens/debug.ts:137`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/gui/screens/debug.ts#L137) |
| `CLAIM-10` | Procedural fallback cel-painters in `render/monsters/` guarantee immediate playable rendering before Sprite-Forge compilation | **Verified Fact** | Inspect [`render/sheet-painters.ts:140-180`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/render/sheet-painters.ts#L140-L180) |
| `ASSUMPTION-1` | Implementation will proceed strictly **one-by-one** (Monster 1 first, then Monster 2, then Monster 3) per user request | **Assumption** | Risk: Scope alignment. Validation: User confirms order and approves phase 1. |
| `ASSUMPTION-2` | Floor distribution: Christmas Tree appears Floor 3+ (Crypt/Garden/Hall biomes), Gas Can Duo Floor 2+ (Factory/Machine/Sewer), Hamster Ball Floor 4+ (Pinball/Carnival/Arcade) | **Assumption** | Risk: Dungeon pacing. Validation: Check `levelConfig` and floor budget tables. |

*Metrics: 7 Verified Facts (58%), 3 Testable Claims (25%), 2 Assumptions (17%), 0 Unverifiable Claims (0%). Passes VCPM ≥80% Gate.*

---

## 4. Detailed Behavior & Technical Mechanics

### Monster 1: `christmas_tree` (Stump Hopper & Pyrotechnic Pine)
- **Role**: Ranged Skirmisher & Post-Mortem Hazard.
- **HP**: 18 | **Radius**: 0.45 | **Speed**: 0.75 u/s | **Movement**: `"kite"`.
- **Hopping Stump Locomotion**:
  - Ticks `z.hopT += dt * 7.0`.
  - Computes vertical visual displacement `z.stumpHopY = Math.abs(Math.sin(z.hopT)) * 0.22`.
  - Sprite renders raised during hop; shadow remains anchored on floor.
- **Ornament Pitch Attack**:
  - Range: 6.5 tiles. Cooldown: 2.8s. Windup: 0.45s.
  - Launches `ornament` projectile (shiny festive bauble with metallic gold/red reflection, speed 4.5 u/s).
  - On contact with player: Deals 1 damage; shatters into colorful glass sparkles and glitter sparks (`state.vfx?.burst(..., 0xef4444, 14, 1.6)`).
  - Can ricochet once off stone walls before shattering.
- **Incineration Death Burst**:
  - Upon reaching 0 HP, triggers `onChristmasTreeDeath(x, z)`:
    - Spawns persistent fire puddle: `spawnFloorFx("fire", x, z, 1.4, 5.0, true)`.
    - Roaring fire burst VFX: `state.vfx?.burst(x, 0.4, z, 0xff4400, 24, 2.5)` + smoke puff.
    - Screen shake: `state.shakeT = Math.max(state.shakeT, 0.22)`.

---

### Monster 2: `gas_can` & `zippo` (1950s Slapstick Duo & Chain-Fire Blueprint)
- **Role**: Comic Duo, Oil Hazard, and Domino Firestarter.
- **HP**: `gas_can` 16, `zippo` 14 | **Radius**: 0.40 | **Speed**: 0.95 u/s | **Movement**: `gas_can` `"chase"`, `zippo` `"kite"`.
- **Duo Pairing Mechanics**:
  - In `spawn/factory.ts`: Spawning a `gas_can` automatically generates an adjacent paired `zippo` lighter (`z.partnerId = partner.dbgId`).
  - Cohesion logic: If distance between partners exceeds 2.2 tiles, each adds an attraction vector toward their partner to maintain their pair stroll.
- **Gasoline Spill & Domino Ignition Sequence**:
  1. **Gas Can Slain**:
     - Plays death animation: X_X eyes, dents, falls sideways.
     - Spills persistent gasoline/oil slick: `spawnFloorFx("oil", z.x, z.z, 2.0, 15.0)` plus 2 satellite puddles.
  2. **Lighter Freak-Out & Trip**:
     - If paired `zippo` is alive within 4.5 tiles:
     - Enters panic state (`panicT = 1.4s`): wide panicked eyes, arms flailing overhead, frantic zigzag sprint.
     - Enters stumble/trip state (`fallT = 0.5s`): loses footing and tumbles onto the floor.
  3. **Ignition & Spread**:
     - As the lighter hits the floor, its flame touches down: `spawnFloorFx("fire", zippo.x, zippo.z, 1.0, OIL_IGNITE_LIFE, true)`.
     - When fire overlaps oil, the existing `floor-fx` ignition pass triggers:
       - Instantly converts the oil puddle into raging fire (`spawnFloorFx("fire", oil.x, oil.z, oil.radius, OIL_IGNITE_LIFE)`).
       - Cascading ignition: Any connected oil slicks catch fire in sequence, creating an advancing wall of flame across the dungeon floor!
       - Thick black petroleum smoke plumes (`state.vfx?.smoke`) and fiery ember bursts.

---

### Monster 3: `hamster_ball` (Kinetic Pinball Deflector)
- **Role**: Mobile Bumper & Pinball Trajectory Disruptor.
- **HP**: 22 | **Radius**: 0.52 | **Speed**: 1.15 u/s | **Movement**: `"chase"`.
- **Dual-Mode Collision Matrix**:
  - **Case A: Walking Mode (`p.momSpeed <= 0`)**:
    - Hamster ball rolls into knight:
    - Deals `HAMSTER_DAMAGE` (1 HP).
    - Player receives standard directional shove (`nx * 0.5, nz * 0.5`).
  - **Case B: Pinball Momentum Mode (`p.momSpeed > 0`)**:
    - Knight rams into hamster ball at high speed:
    - Acts as a spherical pinball bumper with eccentric deflection!
    - Normal vector $(n_x, n_z) = \frac{p.pos - z.pos}{\|p.pos - z.pos\|}$.
    - Trajectory deflection: Reorients player heading with a dynamic deflection angle $\theta = \text{atan2}(n_z, n_x) + \Delta\theta$ (where $\Delta\theta \in [-0.35, +0.35]\text{ rad}$ depending on point of impact and hamster spin velocity).
    - Speed boost: Kicks the player away with launch speed `p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed * 1.15, 9.5 u/s))`.
    - Bumper sound & sparks: `sfxBumper()`, `state.vfx?.sparks(p.x, 0.5, p.z, nx, nz, 14)`.
    - Deals damage to hamster if player momentum satisfies the damage gate (`p.momSpeed >= 4.0`).
- **Ball Shatter Death**:
  - Upon reaching 0 HP:
    - Transparent plastic sphere shatters with spiderweb fractures!
    - Radial shard explosion: `state.vfx?.burst(z.x, 0.4, z.z, 0xa5f3fc, 24, 2.4)` (translucent plastic shards scattering across stone).
    - Hamster tumbles out dazed with circling cartoon stars before running off or yielding loot (`hamster_fluff`, `sunflower_seed`).

---

## 5. Implementation Strategy: Phased One-By-One Rollout

Per the user's explicit request (*"Make these one by one for the pinball-knight game please for the three.js version"*), the rollout will be executed in three isolated, fully validated phases:

### Phase 1: Monster 1 — Christmas Tree (`christmas_tree`)
1. **Worktree & Branch Setup**:
   - Create worktree `.worktrees/wt-monster-xmas-tree` on branch `feat/monster-xmas-tree`.
2. **Sprite-Forge Ingestion**:
   - Create `prep-christmas-tree.mjs` using generated sheet `christmas_tree_sheet_1789080684405.jpg`.
   - Process `#00FF00` chroma background, detect bounding boxes, output to `sources/christmas-tree-2026-09-10/` and `inbox/christmas_tree-S.*`.
   - Run `npm run sprites` to publish to `public/sprites/` and Windows dist bundle.
3. **Procedural Cel-Painter**:
   - Author `render/monsters/christmas-tree.ts` (conifer foliage tiers, wood stump, ornaments, lights, star) and register in `sheet-painters.ts` and `monster-portrait.ts`.
4. **Engine Registrations & Logic**:
   - Register in `state.ts:EnemyKind`, `constants/enemies.ts`, `items.ts:ProjectileKind` (`"ornament"`).
   - Table registrations: `enemy-rules.ts`, `combat.ts`, `zombie.ts`, `factory.ts`, `kind-skin.ts`, `bestiary.ts`, `reagents.ts`, `debug-panel.ts` (`XMASTREE`).
   - Implement stump hopping motion and `launchOrnament` projectile.
   - Implement `onChristmasTreeDeath` fire puddle and burst VFX.
5. **Automated Unit Tests**:
   - Create `ThreeJS/src/game/pinball-knight/entities/christmas-tree.test.ts`.
   - Verify projectile launch, hopping displacement, fire puddle spawn on kill, and regression test suites.

---

### Phase 2: Monster 2 — 1950s Gas Canister & Lighter Duo (`gas_can` + `zippo`)
1. **Sprite-Forge Ingestion**:
   - Create `prep-gas-can.mjs` using generated sheet `gas_can_sheet_1789080700162.jpg`.
   - Process `#00FF00` chroma background, bounding boxes, publish `gas_can-S.*`.
2. **Procedural Cel-Painter**:
   - Author `render/monsters/gas-can.ts` (red jerrycan, spout, white cartoon gloves, shoes, pie-eyes).
3. **Duo Pairing & Chain-Fire Logic**:
   - Register `gas_can` in all engine tables (`GASCAN` in debug panel).
   - Implement companion spawn and pair cohesion in `spawn/factory.ts` and `entities/zombie.ts`.
   - Implement gas spill on death (`spawnFloorFx("oil", ...)`).
   - Implement lighter freak-out (`panicT`), fall over (`fallT`), and ignition trigger.
   - Author VFX blueprint for chain-fire spread.
4. **Automated Unit Tests**:
   - Create `gas-can-duo.test.ts` testing duo spawning, oil spill, and chain ignition.

---

### Phase 3: Monster 3 — Hamster in a Ball (`hamster_ball`)
1. **Sprite-Forge Ingestion**:
   - Create `prep-hamster-ball.mjs` using generated sheet `hamster_ball_sheet_1789080713785.jpg`.
   - Ingest `#00FF00` chroma sheet, bounding boxes, publish `hamster_ball-S.*`.
2. **Procedural Cel-Painter**:
   - Author `render/monsters/hamster-ball.ts` (translucent sphere, highlight reflection, dwarf hamster).
3. **Dual-Mode Pinball Deflection Logic**:
   - Register `hamster_ball` in all engine tables (`HAMSTER` in debug panel).
   - Implement `p.momSpeed > 0` pinball deflection impulse and angular scatter.
   - Implement `p.momSpeed <= 0` contact damage.
   - Implement ball shattering VFX on death.
4. **Automated Unit Tests**:
   - Create `hamster-ball.test.ts` testing walking hit vs. pinball deflection and death fracture.

---

## 6. What Is Explicitly Out of Scope
- Editing Rodrigo Barraza's repositories (`prism-service`, `portal-service`, `tool-service`, `vault-service`, etc.).
- Changing core player pinball friction or table geometry rules.
- Modifying existing monsters (`zippo` behavior is extended/paired, but its existing solo attacks remain backwards-compatible).

---

## 7. Open Questions & User Clarifications

1. **Rollout Confirmation**: Would you like to proceed with **Monster 1 (Christmas Tree)** first as planned?
2. **Christmas Tree Ornaments**: Should the ornaments deal plain physical damage, or should different colored ornaments have special effects (e.g. Red = fire spark, Gold = blinding flash, Green = slippery pine needle puddle)?
3. **Gas Can Spilled Oil Hazard**: Should the unignited gasoline puddle also make the player slip (like water slicks) before it gets set on fire?
4. **Hamster Ball Loot**: When the hamster ball breaks and the hamster scrambles away, what drop would you prefer (e.g. Sunflower Seeds restoring HP, or Plastic Shards / Rodent Fur as crafting reagents)?
