# Implementation Plan — Hotdog Monster ("Franken-Frank" / Glizzy Goliath)

**Target Project**: `pinball-knight` (Three.js version)  
**Date**: 2026-09-12  
**Status**: PLAN ONLY (Awaiting User Review & Approval — DO NOT IMPLEMENT YET)  
**Methodology**: Strictly compliant with [`plan-verification-standard.md`](file:///home/lazycat/github/projects/sun/.agents/plan-verification-standard.md) (VCPM: Parse → Classify → Trace → Verify → Gate)

---

## 1. Problem Statement & User Intent

The user requested: *"make a hotdog monster"*.
This expands **Pinball Knight's** iconic ballpark / diner monster rogue's gallery alongside the Burger Beast (`burger`), Fry Sentinel (`fries`), Toxic Shake (`milkshake`), and Walking Espresso (`espresso`).

The Hotdog Monster introduces a fast-food brawler / skirmisher that wields high-velocity condiment attacks (burning mustard streams, relish bombs) and leaves slippery condiment slicks that disrupt player momentum, fitting seamlessly into the pinball physics and combat ecosystem.

---

## 2. Character Specification & Visual Identity

### Visual Anatomy
- **Body**: A plump, grilled ballpark frankfurter with char/grill marks, nestled inside a warm golden toasted split bun with sesame seeds.
- **Condiments**: Signature zigzag ribbon of bright stadium mustard and chunks of emerald pickle relish (with optional ketchup streaks).
- **Face & Limbs**: Expressive cartoon eyes perched on the top curve of the frankfurter, a gaping mouth that acts as a condiment cannon, and stubby bun feet (or toothpick limbs) with ketchup/mustard sneakers.
- **Locomotion & Animation Clips** (4×4 grid, 256×256 frames):
  - **`idle`** (4 frames): Rhythmic squishy breathing bob; the frankfurter flexes inside the bun while mustard beads slowly drip and sizzle.
  - **`walk`** (4 frames): Scurrying waddle on stubby bun feet, bouncing with slight pitch/roll wobble and kicking up tiny condiment flecks.
  - **`attack`** (4 frames): Condiment Cannon Blast — rears back, the sausage tip expands, and it squirts a high-pressure stream of searing yellow mustard / relish glob.
  - **`death`** (4 frames): Bun splits wide open, frankfurter snaps in two with an explosive pop, spraying mustard, relish, and sesame seed particles, collapsing into a sizzling condiment puddle on the floor.

---

## 3. Combat Mechanics & AI Behavior

| Metric | Proposed Value | Classification | Rationale |
| :--- | :--- | :--- | :--- |
| **EnemyKind** | `"hotdog"` | Verified Fact | Unique key in `EnemyKind` union in `state.ts`. |
| **HP** | `5` | Testable Claim | Balanced: tougher than Burger (`4`), equal to Fries (`5`), lighter than Pancake (`6`). |
| **Body Radius (`r`)** | `0.38` | Testable Claim | Standard medium monster collision radius matching `fries` (`0.36`) and `milkshake` (`0.38`). |
| **Speed Factor** | `0.90` | Testable Claim | Nimble waddling cadence; slightly faster than `milkshake` (`0.85`), slightly slower than `burger` (`0.95`). |
| **AI Movement** | `"kite"` / `"strafer"` | Testable Claim | Keeps ~3.5 tiles distance, strafing to line up condiment blasts. |
| **Attack Range** | `6.2` tiles | Testable Claim | Long-distance zoning threat. |
| **Attack Windup** | `0.45` s | Testable Claim | Visual expansion and squint anticipation before firing. |
| **Attack Cooldown** | `2.2` s | Testable Claim | Cadenced barrage spacing. |
| **Projectile: Mustard Squirt** | Speed: `7.8`, Dmg: `1` | Testable Claim | Stream of yellow mustard projectiles emitting sizzle trail motes. |
| **Player Debuff: Greasy Slick** | Duration: `1.8` s | Testable Claim | On direct hit, cuts floor friction by 60%, making the knight drift/slide like on ice/banana peel. |
| **Floor Hazard: Mustard Slick** | Radius: `1.4`, Life: `4.5` s | Testable Claim | Floor decal that reduces player friction and causes walking enemies to slide. |
| **Death Splatter** | `"mustard"` puddle | Testable Claim | Explodes into a sizzling puddle of hot mustard and relish chunks with steam particles. |
| **Loot Drops** | Rotflesh 30%, Slimegel 25% | Testable Claim | Registered in `reagents.ts` drop tables. |
| **Dungeon Floor Availability** | Floor 2+ (Ratio `16`) | Testable Claim | Spawns alongside food enemies on floor 2 and above. |

---

## 4. Architecture & Code Touchpoints (Traceability Matrix)

Every file modification is traceable to a specific system requirement:

### Layer 1: Core Types & State
- **`ThreeJS/src/game/pinball-knight/state.ts`**
  - Add `"hotdog"` to `EnemyKind` union.
  - Add `"mustard"` to `FloorFxKind` union.
- **`ThreeJS/src/game/pinball-knight/items.ts`**
  - Add `"mustard_glob"` to `ProjectileKind`.

### Layer 2: Constants & Configuration
- **`ThreeJS/src/game/pinball-knight/constants/enemies.ts`**
  - Define `HOTDOG_HP = 5`, `HOTDOG_R = 0.38`, `HOTDOG_SPEED_FACTOR = 0.90`, `HOTDOG_FIRE_RANGE = 6.2`, `HOTDOG_KITE_RANGE = 3.5`, `HOTDOG_WINDUP = 0.45`, `HOTDOG_COOLDOWN = 2.2`, `HOTDOG_DAMAGE = 1`, `HOTDOG_MUSTARD_SPEED = 7.8`, `HOTDOG_MUSTARD_SLICK_TIME = 1.8`, `HOTDOG_RATIO = 16`, `HOTDOG_FROM_LEVEL = 2`.
- **`ThreeJS/src/game/pinball-knight/constants/index.ts`**
  - Re-export all hotdog constants.

### Layer 3: Visual Rendering & Cel-Painter Fallback
- **`ThreeJS/src/game/pinball-knight/render/monsters/hotdog.ts`** [NEW]
  - Procedural cel-painter `makeHotdogPaints(dir, phase, opts)`:
    - Color ramps: Toasted bun gold/tan, grilled frankfurter dark red-brown, stadium mustard neon yellow, relish deep emerald, cartoon eye white/black, grill char lines.
    - Full animation frames for `idle`, `walk`, `attack`, `death` across `S`, `N`, `E` directions.
- **`ThreeJS/src/game/pinball-knight/render/sheet-painters.ts`**
  - Register `hotdog: makeHotdogPaints`.
- **`ThreeJS/src/game/pinball-knight/render/card-styles.ts`**
  - Register `hotdog: "bone"` or `"chitin"`.
- **`ThreeJS/src/game/pinball-knight/render/monster-portrait.ts`**
  - Register `hotdog: { paints: makeHotdogPaints }`.

### Layer 4: Sprite-Forge Pipeline (Nano Banana Art Generation)
- Generate 16-bit pixel art 4×4 sprite sheet (1024×1024, 256×256 frames) using Nano Banana (`generate_image`):
  - Row 0: `idle` (4 frames)
  - Row 1: `walk` (4 frames)
  - Row 2: `attack` (4 frames)
  - Row 3: `death` (4 frames)
  - Uniform flat chroma background (`#FF00FF` magenta).
- Archive master sheet in `sources/hotdog-2026-09-12/alt-takes/README.md`.
- Ingest into `inbox/hotdog-S.png` and `inbox/hotdog-S.json` with tailored palette.
- Publish into `public/sprites/hotdog-S.png` and `public/sprites/hotdog-S.json`.
- Run enclosed chroma pocket cleanup (`clean-magenta.mjs`) and synchronize SHA-256 hash.

### Layer 5: Engine Registration & Sheet Manifests
- **`ThreeJS/src/game/pinball-knight/boot/sheets.ts`**
  - Add `"hotdog"` to `SheetKey`, `ALL_KEYS`, `BACKFILL`, `IMPORTED_ART`, and `levelConfig` tables.
- **`ThreeJS/src/game/pinball-knight/boot/manifest-inventory.ts`**
  - Add `hotdog: ["S"]` to `IMPORTED_FACINGS`.

### Layer 6: Combat, AI, Projectiles & Floor Hazards
- **`ThreeJS/src/game/pinball-knight/entities/enemy-rules.ts`**
  - Add `hotdog: "kite"` to `MOVEMENT_BY_KIND`.
- **`ThreeJS/src/game/pinball-knight/entities/stagger.ts`**
  - Add `hotdog: 0.45` to `PAIN_BY_KIND`.
- **`ThreeJS/src/game/pinball-knight/entities/zombie.ts`**
  - Add `hotdog` to `STATS` and implement ranged attack trigger in `updateZombies`.
- **`ThreeJS/src/game/pinball-knight/entities/projectiles.ts`**
  - Implement `launchMustardGlob(x, z, dx, dz)`: yellow projectile with bubble motes and impact splash.
- **`ThreeJS/src/game/pinball-knight/entities/floor-fx.ts`**
  - Register `"mustard"` floor decal: neon yellow condiment puddle with greasy low friction.
- **`ThreeJS/src/game/pinball-knight/entities/combat.ts`**
  - Add `hotdog: HOTDOG_DAMAGE` to `DMG_BY_KIND`.
  - Add death burst handler `triggerHotdogDeathSplatter(x, z)`.
- **`ThreeJS/src/game/pinball-knight/boot/wiring.ts`**
  - Wire hotdog death handler to spawn mustard puddle and audio/VFX cues.

### Layer 7: Spawning, Bestiary, Reagents & Debug Screen
- **`ThreeJS/src/game/pinball-knight/spawn/kind-skin.ts`**
  - Add `hotdog: { scale: 1.05 }`.
- **`ThreeJS/src/game/pinball-knight/spawn/factory.ts`**
  - Register `hotdog: HOTDOG_HP` in `HP_BY_KIND`, `spawnKind`, `isKindAvailableAtLevel`, and horde weighting.
- **`ThreeJS/src/game/pinball-knight/bestiary.ts`**
  - Add bestiary entry: `hotdog: { label: "Franken-Frank", icon: "🌭", blurb: "grilled ballpark wiener in a toasted split bun that squirts searing mustard streams and bursts into relish splatter" }`.
- **`ThreeJS/src/game/pinball-knight/reagents.ts`**
  - Add `hotdog: [{ id: "rotflesh", chance: 0.30 }, { id: "slimegel", chance: 0.25 }]`.
- **`ThreeJS/src/game/pinball-knight/gui/screens/debug.ts` & `debug-panel.ts`**
  - Add debug spawn button `hotdog: "Hotdog"`.

---

## 5. Automated Verification Plan

### Test Suites
1. **[NEW] `ThreeJS/src/game/pinball-knight/entities/hotdog.test.ts`**:
   - Verify stats (HP, radius, speed, movement pattern).
   - Verify projectile launch, velocity vector, collision, and player grease debuff.
   - Verify death splatter trigger and loot drop table chances.
2. **`monsters-14-sprites.test.ts` / `published.test.ts`**:
   - Verify published sprite PNG and JSON manifest exist.
   - Verify 0 un-keyed magenta pixels.
   - Verify SHA-256 hash synchronization.
   - Verify playable paints compilation and atlas loading.
3. **`lazy-sheets.test.ts` & `all-monsters-imported-pipeline.test.ts`**:
   - Verify seamless engine animation state playback.

### Release & Deployment Verification
- Execute full test suite across all shards in WSL with Linux Node (`NVM_DIR`).
- Merge into `main` and push to GitHub `origin/main`.
- Deploy container to Synology NAS via `npm run deploy`.
- Validate live health endpoint `http://10.0.0.16:8789/health` and sprite manifest serving.
- Proactively report test readiness and URLs to the user.

---

## 6. Risks & Assumptions

| ID | Statement | Risk | Validation Path |
| :--- | :--- | :--- | :--- |
| **ASSUMPTION-1** | Nano Banana model generates consistent 4×4 sprite sheet on flat `#FF00FF` magenta chroma. | Generation might require 1-2 prompt retries for ideal 4×4 layout. | Inspect raw output; verify grid bounding boxes before inbox ingestion. |
| **ASSUMPTION-2** | Mustard puddle should reduce player friction (grease/slide) rather than slowing like syrup. | Too much sliding might cause uncontrollable pit falls in small rooms. | Cap slide duration to 1.8s and ensure flippers can still impart full directional force. |
