# Plan: Ketchup & Mustard Condiment Monsters (Pinball Knight)

## Goal
Implement two new fast-food companion skirmisher monsters in `Pinball Knight`:
1. **Ketchup Monster (`ketchup`)**: "Baron von Ketchup" / "Sir Squirt" — a sentient red squeeze-bottle skirmisher that squirts sticky tomato paste globs that slow the player and leave sticky drag puddles.
2. **Mustard Monster (`mustard`)**: "Colonel Dijon" / "Mister Yellow" — a rapid-sprinting yellow squeeze-bottle skirmisher that fires pressurized streams of spicy stadium mustard and leaves grease-slick slip hazards.

Together, they expand the fast-food bestiary alongside **Burger Beast**, **Fry Sentinel**, **Toxic Shake**, and **Franken-Frank (Hotdog)** with a complementary "Sticky & Slick" crowd-control duo dynamic.

---

## Technical Architecture & Design

### 1. Visual Aesthetics & Sprite Generation
- **Sprite Art**:
  - Two dedicated 4×4 16-bit arcade pixel art sprite sheets on flat magenta `#FF00FF` backdrop.
  - `ketchup-S.png`: Crimson red ribbed plastic squeeze bottle, white screw cap, conical squirt nozzle, cartoon eyes, sneaker feet, and sauce splatter recoil.
  - `mustard-S.png`: Bright yellow ribbed squeeze bottle, yellow cap, angled intense eyes, sneakers, high-pressure jet recoil.
  - Clips: `idle` (bottle pulse & breathing), `walk` (sneaker dash), `attack` (body compression & nozzle squirt), `death` (bottle collapse & cap pop splatter).
- **Procedural Cel-Painters**:
  - `render/monsters/ketchup.ts`: Canvas 2D fallback painter rendering ribbed red bottle, white cap, sauce tip.
  - `render/monsters/mustard.ts`: Canvas 2D fallback painter rendering bright yellow bottle, yellow cap, spicy flecks.

### 2. Combat Mechanics & Projectiles
- **Ketchup Mechanics (`ketchup_glob`)**:
  - Projectile: High-viscosity arching red sauce glob traveling at `KETCHUP_SPEED` (~7.2).
  - Effect on hit: Knocks knight and applies sticky drag (`p.stinkSlowT = 2.0` or momentum dampening).
  - Floor Hazard (`ketchup`): Sticky puddle on the floor. Stepping into it heavily dampens player momentum (`momSpeed *= 0.55`).
  - Death: Detonates in a tomato splatter explosion, spawning a sticky ketchup puddle.
- **Mustard Mechanics (`mustard_jet`)**:
  - Projectile: High-pressure jet stream of yellow mustard (`mustard_glob`) traveling at `MUSTARD_SPEED` (~8.5).
  - Effect on hit: Deals damage and applies brief burning knockback.
  - Floor Hazard (`mustard`): Reuses/expands the existing `mustard` hazard: grease-slick slide that propels the knight uncontrollably (`momSpeed = Math.max(momSpeed, 12)`).
  - Death: Squeezes and pops in a yellow mustard burst, dealing AOE damage to surrounding monsters.

### 3. State & Registry Integration
- **`state.ts`**:
  - Add `"ketchup" | "mustard"` to `EnemyKind`.
  - Add `"ketchup"` to `FloorFxKind`.
- **`items.ts`**:
  - Add `"ketchup_glob"` to `ProjectileKind`.
- **`constants/enemies.ts`**:
  - Tuning constants:
    - `KETCHUP_HP = 5`, `KETCHUP_R = 0.36`, `KETCHUP_SPEED_FACTOR = 0.92`, `KETCHUP_FIRE_RANGE = 5.8`, `KETCHUP_KITE_RANGE = 3.2`, `KETCHUP_WINDUP = 0.45`, `KETCHUP_COOLDOWN = 2.4`, `KETCHUP_DAMAGE = 1`.
    - `MUSTARD_HP = 4`, `MUSTARD_R = 0.36`, `MUSTARD_SPEED_FACTOR = 1.05`, `MUSTARD_FIRE_RANGE = 6.4`, `MUSTARD_KITE_RANGE = 3.6`, `MUSTARD_WINDUP = 0.40`, `MUSTARD_COOLDOWN = 2.0`, `MUSTARD_DAMAGE = 1`.
- **`boot/sheets.ts` & `boot/manifest-inventory.ts`**:
  - Register `"ketchup"` and `"mustard"` in `SheetKey`, `SHEET_KEYS`, `BACKFILL`, `IMPORTED_ART`, `IMPORTED_FACINGS`.
- **`render/sheet-painters.ts`, `render/card-styles.ts`, `render/monster-portrait.ts`**:
  - Register painters and portrait entries.
- **`entities/enemy-rules.ts` & `entities/stagger.ts`**:
  - Rules: `ketchup: "kite"`, `mustard: "kite"`.
  - Stagger: `ketchup: 0.50`, `mustard: 0.45`.
- **`entities/projectiles.ts` & `entities/floor-fx.ts`**:
  - Implement `launchKetchupSquirts()`.
  - Implement canvas procedural texture for `ketchup` floor hazard.
- **`entities/combat.ts` & `boot/wiring.ts`**:
  - Add `triggerKetchupDeath` and `triggerMustardDeath` with VFX and hazard placement.
- **`entities/zombie.ts`**:
  - Add `ketchup` and `mustard` to `STATS` and `updateZombies` projectile branches.
- **`spawn/kind-skin.ts` & `spawn/factory.ts`**:
  - Register `scale: 1.0` in `KIND_SKIN`.
  - Add to `HP_BY_KIND`, `spawnKind`, `isKindAvailableAtLevel`, `previewHordeKind`, and horde rolls.
- **`bestiary.ts` & `reagents.ts`**:
  - Full bestiary blurbs, icons (🍅 / 🟡 or 🥫 / 🌭), and drops (`slimegel`, `rotflesh`, `glass`).
- **`gui/screens/debug.ts` & `debug-panel.ts`**:
  - Chips: `"Ketchup"` and `"Mustard"`.
- **Test Invariants**:
  - `fx/floor/decals.test.ts`: Include `"ketchup"` in canvas non-substance list.
  - `boot/lazy-sheets.test.ts`: Include `"ketchup"` and `"mustard"` in `ALL_KEYS`.

---

## Verification Plan

### Automated Tests
1. `src/game/pinball-knight/entities/ketchup.test.ts`:
   - Validates sprite manifest on disk.
   - Validates procedural fallback painter.
   - Validates projectile squirt attacks.
   - Validates sticky floor hazard creation on death.
2. `src/game/pinball-knight/entities/mustard.test.ts`:
   - Validates sprite manifest on disk.
   - Validates procedural fallback painter.
   - Validates high-pressure mustard attack.
   - Validates slick hazard creation and AOE monster damage on death.
3. Regression Test Suite:
   - `published.test.ts`
   - `lazy-sheets.test.ts`
   - `decals.test.ts`
   - `bestiary.test.ts`
   - `reagents.test.ts`
   - `debug-console.test.ts`
   - `mrt-coverage.test.ts`
4. Build Validation:
   - `npm run build` in `ThreeJS/`.
5. Deployment to Synology NAS:
   - `npm run deploy` deploying container to `http://10.0.0.16:8789`.
   - Health check with `curl -sI`.
