# Implementation Plan — Remake Brute Monster (Gym Behemoth & Dumbbell Thrower)

**Target Project**: `pinball-knight`  
**Date**: 2026-09-17  
**Status**: PLAN ONLY (Awaiting User Review & Approval — DO NOT IMPLEMENT YET)  
**Render Asset**: 16-bit Pixel Art Sprite Sheet Generated via Nano Banana (`generate_image`)  
**Methodology**: Strictly compliant with [`plan-verification-standard.md`](file:///home/lazycat/github/projects/sun/.agents/plan-verification-standard.md) (VCPM Claim Triage & Quality Gates)

---

## 1. Problem Statement & User Intent

The user requested:
> *"can we remake the brute using nano banana tomake the sprite sheet. I want the brute to be a monster that throws dumbbells at you. /plan and implement."*

### Current State vs. Redesign Goals
1. **Current State**:
   - The existing Brute (`public/sprites/brute-S.json`) is an old partial sprite sheet with only 3 clips (`idle`, `walk`, `attack`) and is missing a `death` clip entirely (`boot/sheets.ts:418-437`). On death, it either freezes or exhibits a visual costume change falling back to procedural painter cels.
   - Its combat behavior (`entities/zombie.ts:463`) is purely a slow, point-blank melee haymaker (`bruteSlam`).
2. **New Vision**:
   - **Visual Identity**: Reimagined as a musclebound, iron-pumping gym behemoth / armored juggernaut orc wielding massive cast-iron hexagonal dumbbells in both hands, wearing a weightlifting belt and wrist wraps.
   - **Nano Banana Asset**: Full 4×4 master sprite sheet (16 frames) on clean uniform chroma `#00FF00` green background containing all 4 core animations: `idle` (breathing & flexing), `walk` (heavy stomping stride with dumbbells), `attack` (raising & heaving dumbbells), and `death` (dropping dumbbells with an iron clang and collapsing).
   - **Combat Verbs**:
     - **Ranged Dumbbell Heave**: At medium/long range, winds up and hurls heavy iron dumbbells down the corridor at the knight.
     - **Tumbling Flight & Wall Ricochet**: The dumbbell flies with end-over-end tumbling physics, ricochets off dungeon walls with sparks and an iron clang, creating dynamic pinball hazards.
     - **Close-Range Ground Slam**: If the knight gets within close range, the Brute slams dumbbells into the stone floor, kicking up radial dust and triggering a violent shockwave (`shakeT = 0.35`).
     - **Enraged State**: Below 40% HP, the Brute enrages—veins pulse, throw cadence accelerates, and he hurls twin dumbbells!

---

## 2. Atomic Claim Classification Matrix (VCPM Standard)

Per [`plan-verification-standard.md`](file:///home/lazycat/github/projects/sun/.agents/plan-verification-standard.md), all technical claims are parsed into atomic assertions and triaged:

| ID | Claim Statement | Classification | Evidence / Source / Validation Path |
|---|---|---|---|
| `CLAIM-1` | `items.ts:ProjectileKind` defines all projectile keys and can accept `"dumbbell"` | **Verified Fact** | Verified in [`items.ts:27`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/items.ts#L27) |
| `CLAIM-2` | `entities/projectiles.ts` already has built-in wall ricochet physics via `pr.bounces > 0` | **Verified Fact** | Verified in [`entities/projectiles.ts:2277-2310`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/projectiles.ts#L2277-L2310) |
| `CLAIM-3` | `fx/projectiles/` supports custom projectile mesh bundles and archetype configurations | **Verified Fact** | Verified in [`fx/projectiles/factory.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/fx/projectiles/factory.ts) and [`registry.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/fx/projectiles/registry.ts) |
| `CLAIM-4` | The legacy brute sheet lacks a `death` clip, requiring procedural fallback | **Verified Fact** | Documented in [`boot/sheets.ts:418-445`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/boot/sheets.ts#L418-L445) and [`brute-imported-death.test.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/engine/render/brute-imported-death.test.ts) |
| `CLAIM-5` | Ingesting a 4×4 master sheet into `inbox/brute-S.json` and running `npm run sprites` compiles and publishes `public/sprites/brute-S.png` and `public/sprites/brute-S.json` | **Testable Claim** | Execute `FORGE_PUBLISH=1 vitest run src/game/pinball-knight/tools/sprite-forge` |
| `CLAIM-6` | `STATS.brute` in `entities/zombie.ts` can be set to `ranged: true` with `contactRange = 6.0` to permit ranged dumbbell throws while branching to `bruteSlam` when $pdist \le 1.6$ | **Testable Claim** | Unit test verifying attack dispatch at $pdist = 4.0$ vs $pdist = 1.0$ |
| `CLAIM-7` | A thrown dumbbell deals 2 damage, imparts a backward pinball impulse ($momSpeed \ge 5.5$), and screenshakes ($shakeT \ge 0.25$) | **Testable Claim** | Unit test in `dumbbell-projectile.test.ts` asserting player state on impact |
| `CLAIM-8` | A thrown dumbbell rebounds off cardinal walls up to 2 times, sparking and playing sound effects | **Testable Claim** | Unit test simulating wall collision with velocity reflection vector |
| `CLAIM-9` | Below 40% HP, `z.enraged` triggers twin dumbbell throws or reduced attack cooldown | **Testable Claim** | Unit test verifying projectile count and cooldown when `z.hp <= BRUTE_HP * 0.4` |
| `ASSUMPTION-1` | 4 frames each for `idle`, `walk`, `attack`, and `death` (16 frames total) provides high animation clarity and fits Sprite-Forge standard 4×4 grid layout | **Assumption** | Risk: Frame slicing alignment. Validation: Test cell bounding boxes with `prep-brute.mjs`. |
| `ASSUMPTION-2` | Cast-iron hexagonal weight geometry renders cleanly as low-poly 3D mesh at game camera distance | **Assumption** | Risk: Geometry scale too small/large. Validation: Benchmark visual silhouette at standard 45° orthographic projection. |

*Metrics: 4 Verified Facts (36%), 5 Testable Claims (45%), 2 Assumptions (18%), 0 Unverifiable Claims (0%). Passes VCPM ≥80% Gate.*

---

## 3. Visual Design & Nano Banana Sprite Sheet

### Sprite Sheet Specification (4×4 Grid, 16 Frames)
- **Tool**: `generate_image` ("Nano Banana")
- **Prompt Architecture**:
  - Retro 16-bit SNES/arcade pixel art sprite sheet of a massive musclebound gym monster / hulking orc brute bodybuilder holding heavy cast-iron dumbbells.
  - Uniform flat chroma green (`#00FF00`) background, zero shadows, zero floor lines, zero borders.
  - 4 rows, 4 columns:
    - **Row 0 (`idle`)** [Frames 0..3]: Facing south. Flexes massive biceps holding dumbbells at waist/sides, breathing heavily, chest expanding and contracting.
    - **Row 1 (`walk`)** [Frames 4..7]: Facing south. Heavy stomping forward walk, lumbering gait carrying dumbbells in alternating rhythm.
    - **Row 2 (`attack`)** [Frames 8..11]: Facing south. Deep windup squat, heaves dumbbell high overhead with glowing red eyes, and violently flings / slams it forward with floor-shaking follow-through.
    - **Row 3 (`death`)** [Frames 12..15]: Facing south. Heavy stagger back from final blow, hands open and dumbbells drop to the floor with sparks, collapsing onto knees and falling face-down defeated.

### Ingestion & Processing Pipeline
1. Save generated raw take to `tools/sprite-forge/sources/brute-2026-09-17/alt-takes/`.
2. Run `prep-brute.mjs` to clean background, detect tight bounding boxes per frame, and generate `tools/sprite-forge/inbox/brute-S.png` and `inbox/brute-S.json`.
3. Run `npm run sprites` (`FORGE_PUBLISH=1 vitest run src/game/pinball-knight/tools/sprite-forge`) to compile and publish to `public/sprites/brute-S.png` and `public/sprites/brute-S.json`.

---

## 4. Proposed Changes & Technical Architecture

### 4.1 Projectile System (`items.ts` & `entities/projectiles.ts`)

#### [MODIFY] [`items.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/items.ts)
- Add `"dumbbell"` to `ProjectileKind` union.

#### [MODIFY] [`constants/enemies.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/constants/enemies.ts)
- Define new dumbbell projectile constants:
  - `BRUTE_THROW_RANGE = 6.0` (range to trigger dumbbell heave)
  - `BRUTE_DUMBBELL_SPEED = 5.2` (weighty, dodgeable trajectory)
  - `BRUTE_DUMBBELL_DAMAGE = 2`
  - `BRUTE_DUMBBELL_BOUNCES = 2` (iron wall ricochets)
  - `BRUTE_DUMBBELL_IMPULSE = 5.5` (backward player deflection)

#### [MODIFY] [`fx/projectiles/registry.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/fx/projectiles/registry.ts)
- Register `dumbbell` configuration:
  - Archetype: `"bomb"` or custom heavy iron geometry.
  - Colors: Core dark iron `0x1f242d`, accent chrome knurled grip `0x94a3b8`, glow `0x334155`.
  - Flight: Tumbling pitch spin `spinAxis: "pitch"`, `spinSpeed: 16`.
  - Launch: Muzzle dust puff and heave tell.
  - Impact: Wall sparks, metallic clatter sound, screen shake `0.25`.

#### [MODIFY] [`fx/projectiles/factory.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/fx/projectiles/factory.ts)
- Implement `createDumbbellBundle(config)`:
  - Dual 6-sided hexagonal iron plates on either end (`CylinderGeometry(0.16, 0.16, 0.08, 6)`).
  - Chrome knurled handle bar connecting the plates (`CylinderGeometry(0.04, 0.04, 0.38, 8)`).

#### [MODIFY] [`entities/projectiles.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/projectiles.ts)
- Implement `hurlDumbbell(x: number, z: number, dx: number, dz: number, speedMult = 1.0)`:
  - Spawns projectile with `kind: "dumbbell"`, `bounces: 2`, `damage: BRUTE_DUMBBELL_DAMAGE`.
  - In `updateProjectiles`:
    - Handles end-over-end tumbling rotation: `pr.mesh.rotation.x += dt * 16`.
    - Wall collision: Rebounds off wall normal, decrements `pr.bounces`, spawns metallic impact sparks and plays `sfxTarget()`.
    - Player collision: Deals 2 damage, knocks player backward (`p.momX = dx`, `p.momZ = dz`, `p.momSpeed = 5.5`), emits screen shake and dust/spark VFX.

---

### 4.2 Monster AI & Behavior (`entities/zombie.ts`)

#### [MODIFY] [`entities/zombie.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/zombie.ts)
- Update `STATS.brute`:
  ```typescript
  brute: {
    bodyR: BRUTE_R,
    contactRange: BRUTE_THROW_RANGE, // 6.0 tiles
    windup: BRUTE_ATTACK_WINDUP,     // 0.65s
    cooldown: BRUTE_ATTACK_COOLDOWN, // 1.8s
    ranged: true,
  }
  ```
- In attack release handling (around line 1762):
  ```typescript
  } else if (z.kind === "brute") {
    if (pdist <= BRUTE_CONTACT_RANGE * 1.8) {
      // Close quarters: Ground smash with dumbbells
      bruteSlam(z, pdist, contactRange);
    } else if (pdist > 1e-4) {
      // Medium / Long range: Hurl iron dumbbell down the line!
      const ux = pdx / pdist;
      const uz = pdz / pdist;
      hurlDumbbell(z.x, z.z, ux, uz);
      
      // Enraged: Below 40% HP, throw a second dumbbell with a slight spread angle
      if (z.enraged) {
        const spread = 0.22; // ~12 degrees
        const cos = Math.cos(spread);
        const sin = Math.sin(spread);
        hurlDumbbell(z.x, z.z, ux * cos - uz * sin, ux * sin + uz * cos, 1.1);
      }
    }
  }
  ```

---

### 4.3 Bestiary & Documentation Updates

#### [MODIFY] [`bestiary.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/bestiary.ts)
- Update Brute entry:
  - Icon: 🏋️
  - Blurb: `"massive gym behemoth; throws heavy iron dumbbells and slams the ground, enrages when hurt"`

#### [MODIFY] [`OPEN_WORK.md`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/OPEN_WORK.md)
- Log the Brute remake, new 4-clip moveset, and dumbbell throwing mechanics.

---

## 5. Verification Plan

### 5.1 Automated Unit & Integration Tests
1. **Dumbbell Projectile Unit Tests** (`entities/dumbbell-projectile.test.ts`) [NEW]:
   - Verify dumbbell bundle construction and geometries.
   - Verify trajectory update and tumbling rotation.
   - Verify wall collision resolution, velocity reflection, and bounce counter decrement.
   - Verify player impact: damage dealt, knockback impulse applied, screenshake triggered.
2. **Brute Combat AI Tests** (`entities/brute-combat.test.ts`) [NEW]:
   - Assert that when player distance $> 1.8$, attack release spawns a dumbbell projectile.
   - Assert that when player distance $\le 1.8$, attack release triggers `bruteSlam` melee shockwave.
   - Assert that below 40% HP, enraged Brute throws twin dumbbells.
3. **Sprite & Death Animation Test** (`engine/render/brute-imported-death.test.ts`):
   - Update test to verify that `brute-S.json` now includes all 4 rows including imported `death`, and `MonsterAnimator` plays the death sequence directly to completion.
4. **Sprite-Forge Suite**:
   ```bash
   export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; . "$NVM_DIR/nvm.sh"
   cd ThreeJS && npm run sprites
   ```
5. **Full Regression Test Suite**:
   ```bash
   cd ThreeJS && npx vitest run src/game/pinball-knight/entities/
   ```

### 5.2 Container Deployment & Operational Verification
- Commit all changes within worktree.
- Push to GitHub remote `origin`.
- Deploy updated container to Synology NAS:
  ```bash
  npm run deploy
  ```
- Verify container health and gameplay at `http://10.0.0.16:8789/`.

---

## 6. Open Questions & Design Options for User Review

> [!IMPORTANT]
> **Please review the following design questions before we proceed to implementation:**

1. **Dumbbell Ricochet Count**:
   - *Option A (Recommended)*: Dumbbell bounces off walls up to 2 times with sparks and metallic clanging sounds, creating chaotic ricochet hazards in tight corridors.
   - *Option B*: Dumbbell does not ricochet; it shatters or embeds into masonry upon first wall impact, kicking up stone chips.
2. **Enraged Throw Behavior (< 40% HP)**:
   - *Option A (Recommended)*: Throws twin dumbbells in a V-spread ($\pm 12^\circ$), forcing the player to dodge between them or sidestep wide.
   - *Option B*: Throws a single massive high-speed dumbbell with faster cooldown ($1.0\text{s}$) and heavy screen shake.
3. **Visual Style Detail**:
   - *Option A (Recommended)*: Classic armored gym orc with green skin, leather lifting belt, wrist wraps, and iron chains across his chest.
   - *Option B*: Modern retro 1980s gym bodybuilder aesthetic with headband and neon tank top.
