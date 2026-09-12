# Implementation Plan — Pancake Monster ("Flapjack Fiend")

**Target Project**: `pinball-knight` (Three.js version)  
**Date**: 2026-09-12  
**Status**: PLAN ONLY (Awaiting User Review & Approval — DO NOT IMPLEMENT YET)  
**Methodology**: Strictly compliant with [`plan-verification-standard.md`](file:///home/lazycat/github/projects/sun/.agents/plan-verification-standard.md)

---

## 1. Problem Statement & User Intent

Introduce a delicious, jovial, yet dangerous breakfast behemoth to **Pinball Knight**: the **Pancake Monster** (EnemyKind: `"pancake"`). This expands the beloved food/fast-food monster roster alongside the Burger Beast (`burger`), Fry Sentinel (`fries`), Toxic Shake (`milkshake`), and Walking Espresso (`espresso`).

---

## 2. Visual Identity & Cel-Painter Architecture

### Visual Character Design
- **Body**: A tall, wobbly stack of 3–4 thick, golden-brown buttermilk pancakes with lightly toasted edges and spongey texture.
- **Topping**: A melting golden-yellow pat of butter perched on the crown, with expressive cartoon eyes / gooey melted smile.
- **Syrup**: Cascading ribbons of translucent, glossy amber maple syrup dripping down the sides of the stack and pooling beneath it.
- **Locomotion & Animation**:
  - `idle`: Rhythmic, squishy breathing bob; the butter pat wobbles and syrup beads slowly drip down.
  - `walk`: Flapjack squish-and-leap gallop — squashes flat like an accordion on floor contact, then springs tall into the air as it hops forward, leaving sticky syrup drool droplets.
  - `attack`: Reared-back stack flip — the top pancake curls back and flings spinning mini-flapjacks like frisbees, or spews a dollop of steaming, sticky maple syrup!
  - `death`: Defeated pancake collapse — the stack topples over in dramatic fashion, splattering into fluffy cake crumbs and a wide, sticky golden maple syrup floor puddle.

---

## 3. Combat Mechanics & Gameplay Role

| Metric | Proposed Value | Rationale |
| :--- | :--- | :--- |
| **HP** | `6` | Tankier than the burger (`4`) and fries (`5`); a thick, hearty breakfast stack. |
| **Body Radius** | `0.40` | Sizable target with a wide circular base. |
| **Speed Factor** | `0.80` | Deliberate, bouncy hop movement; slightly slower than average. |
| **Movement Pattern** | `"kite"` / `"strafer"` | Hops into range, loiters to fling flapjacks and syrup, then repositions. |
| **Attack Range** | `6.8` tiles | Ranged zoning threat. |
| **Attack Windup** | `0.50` s | Visual squish-and-recoil before flipping projectiles. |
| **Attack Cooldown** | `2.5` s | Measured attack cadence. |
| **Projectile 1: Flapjack Disc** | Fast flying mini-pancake (`speed: 7.2`, `dmg: 1`) | Spinning golden disc that ricochets off solid walls or shatters on contact. |
| **Projectile 2: Maple Syrup Glob** | Lobbed amber syrup dollop (`speed: 6.0`, `dmg: 1`) | On impact with ground or player, splashes into a **Sticky Syrup Puddle**. |
| **Floor Hazard: Syrup Puddle** | Radius `1.8`, Life `6.0s` | **High-Friction Sticky Hazard**: Drastically reduces player rolling speed/momentum (requires strong flipper launch or bumper bounce to break free), and slows down any enemy entering it. |
| **Death Burst** | `"syrup"` puddle trigger | Collapses into an amber syrup puddle with butter steam motes and crumb particles. |
| **Dungeon Floor Availability** | Floor 2+ (Ratio `18`) | Joins the food monster roster starting on Floor 2/3. |

---

## 4. Proposed Changes File-by-File

### Core Engine & State Types
- [MODIFY] `src/game/pinball-knight/state.ts`
  - Add `"pancake"` to `EnemyKind`.
  - Add `"syrup"` to `FloorFxKind`.
- [MODIFY] `src/game/pinball-knight/items.ts`
  - Add `"pancake_disc"` and `"syrup_glob"` to `ProjectileKind`.

### Constants & Configuration
- [MODIFY] `src/game/pinball-knight/constants/enemies.ts`
  - Define `PANCAKE_HP`, `PANCAKE_R`, `PANCAKE_SPEED_FACTOR`, `PANCAKE_FIRE_RANGE`, `PANCAKE_KITE_RANGE`, `PANCAKE_WINDUP`, `PANCAKE_COOLDOWN`, `PANCAKE_DAMAGE`, `PANCAKE_DISC_SPEED`, `PANCAKE_SYRUP_SPEED`, `PANCAKE_SYRUP_RADIUS`, `PANCAKE_SYRUP_LIFE`, `PANCAKE_RATIO`, `PANCAKE_FROM_LEVEL`.
- [MODIFY] `src/game/pinball-knight/constants/index.ts`
  - Re-export pancake constants.

### Rendering
- [NEW] `src/game/pinball-knight/render/monsters/pancake.ts`
  - Procedural cel-painter `makePancakePaints`:
    - Ramps: Buttermilk pancake gold/tan, toasted rim dark brown, butter pat creamy yellow, syrup glossy amber, eye black/white.
    - Frames for `S`, `N`, `E` directions across `idle`, `walk`, `attack`, `death`.
- [MODIFY] `src/game/pinball-knight/render/sheet-painters.ts`
  - Register `pancake: makePancakePaints`.
- [MODIFY] `src/game/pinball-knight/render/monster-portrait.ts`
  - Register `pancake` portrait entry in `KIND_PORTRAIT`.
- [MODIFY] `src/game/pinball-knight/render/card-styles.ts`
  - Register `pancake: "chitin"`.

### Gameplay Systems & Rules
- [MODIFY] `src/game/pinball-knight/entities/enemy-rules.ts`
  - Add `pancake: "kite"` to `MOVEMENT_BY_KIND`.
- [MODIFY] `src/game/pinball-knight/entities/stagger.ts`
  - Add `pancake: 0.5` to `PAIN_BY_KIND`.
- [MODIFY] `src/game/pinball-knight/entities/zombie.ts`
  - Add `pancake` to `STATS` with ranged combat flags.
  - In `updateZombies`, add attack dispatch branch invoking `launchPancakeAttack(z.x, z.z, ux, uz)`.
- [MODIFY] `src/game/pinball-knight/entities/projectiles.ts`
  - Add geometries/materials for mini flapjacks and syrup drops.
  - Implement `launchPancakeAttack`: spawns either spinning mini-pancake or lobbed syrup glob.
  - Projectile update & impact:
    - Wall hit: butter/syrup burst particle VFX.
    - Player hit: damage, web/sticky slow, and spawn syrup splash.
- [MODIFY] `src/game/pinball-knight/entities/floor-fx.ts`
  - Add `"syrup"` handling to ground rendering (glossy amber puddle with golden bubble motes).
  - Add sticky drag interaction: slows player rolling speed and chills/slows walking zombies.
- [MODIFY] `src/game/pinball-knight/entities/combat.ts`
  - Add `pancake: PANCAKE_DAMAGE` to `DMG_BY_KIND`.
  - Add `triggerPancakeSyrupSpill(x, z)` on pancake monster death.
- [MODIFY] `src/game/pinball-knight/boot/wiring.ts`
  - Wire pancake death handler into floor hazard spawns.

### Spawning, Bestiary, and Debug
- [MODIFY] `src/game/pinball-knight/spawn/kind-skin.ts`
  - Add `pancake: { scale: 1.1 }` for satisfying stack presence.
- [MODIFY] `src/game/pinball-knight/spawn/factory.ts`
  - Register `pancake: PANCAKE_HP` in `HP_BY_KIND`, add `spawnKind`, `isKindAvailableAtLevel`, and horde ratio logic.
- [MODIFY] `src/game/pinball-knight/bestiary.ts`
  - Add `KIND_INFO.pancake` entry with title "Flapjack Fiend", lore description, and mechanics bullet points.
- [MODIFY] `src/game/pinball-knight/reagents.ts`
  - Add `pancake: [{ id: "slimegel", chance: 0.35 }, { id: "sugar", chance: 0.3 }]` drops.
- [MODIFY] `src/game/pinball-knight/boot/sheets.ts`
  - Add `"pancake"` to `SheetKey`, `ALL_KEYS`, `BACKFILL`, and level tables.
- [MODIFY] `src/game/pinball-knight/boot/lazy-sheets.test.ts`
  - Add `"pancake"` to test registry.
- [MODIFY] `src/game/pinball-knight/debug-panel.ts` & `src/game/pinball-knight/gui/screens/debug.ts`
  - Add debug spawn button with short label `"Pancake"`.

### Test Suite
- [NEW] `src/game/pinball-knight/entities/pancake.test.ts`
  - Comprehensive unit test suite.

---

## 5. Verification Plan

### Automated Tests
Run Vitest on all affected suites:
```bash
npx vitest run src/game/pinball-knight/entities/pancake.test.ts
npx vitest run src/game/pinball-knight/boot/lazy-sheets.test.ts
npx vitest run src/game/pinball-knight/entities/burger.test.ts
```

Run full type check and game build:
```bash
npm run typecheck
npm run build
```

### NAS Deployment & Verification
- Commit all changes on a dedicated git worktree (`.worktrees/wt-pancake` on branch `feat/pancake-monster`).
- Merge into `main`, push to GitHub, and deploy to Synology NAS container:
  ```bash
  npm run deploy
  ```
- Verify container HTTP response `200 OK` on `http://10.0.0.16:8789`.
- Confirm Windows `.exe` readiness in `dist/pinball-knight-windows-x86_64/`.
