# Implementation Plan — Milkshake Monster ("Toxic Shake" / Master Shake Inspired)

## Overview
Add the third member of the fast-food trio to `pinball-knight`: **Milkshake** (`EnemyKind "milkshake"`), inspired by Master Shake.
The monster is an animated fast-food milkshake cup with yellow dishwashing rubber gloves for hands, a bent drinking straw on its lid, and a signature ranged attack that sprays toxic, corrosive milkshake at the player.

---

## 1. Monster Specification & Anatomy

### Visual Identity
- **Body**: White tapered milkshake cup with rim band / fast-food logo stripes.
- **Lid & Straw**: Domed/flat translucent lid with a bent drinking straw (pink-and-white striped) pointing forward/upward.
- **Arms & Hands**: Distinct bright yellow rubber dishwashing gloves (elbow-length style) that wave erratically or grasp forward when spraying.
- **Face**: Impatient, expressive cartoon eyebrows, darting eyes, and mouth on the front face of the cup.
- **Attack Motion**: Leans back, bends its straw or tilts its cup forward, thrusting its yellow dishwashing gloves forward to spray a barrage/stream of bubbling, frothy toxic milkshake.
- **Death Animation**: Cup splits and crumples, yellow dishwashing gloves fall limp, straw snaps back, and a large puddle of toxic milkshake splashes and sizzles onto the floor.

---

## 2. Gameplay Mechanics & AI

### Core Stats
- **`EnemyKind`**: `"milkshake"`
- **HP**: 6 (sturdier than fry sentinel, durable plastic cup)
- **Radius (`r`)**: 0.38
- **Speed Factor**: 0.85 (deliberate hovering / gliding cadence)
- **AI Behavior**: `"kite"` or `"strafe-kite"` — keeps distance from the knight (~3.5 tiles) while seeking line-of-sight to spray toxic milkshake.
- **Attack Range**: 6.0 tiles.
- **Windup / Cooldown**: 0.45s windup (gargling/sloshing anticipation), 2.2s cooldown.

### Attack: Toxic Milkshake Spray (`shake_spray` / `shake_sludge`)
- **Projectile**: Liquid toxic globules or continuous cone stream emitted from straw/mouth.
- **Visuals**: Toxic pastel green / radioactive pink frothy liquid droplets with trail particles.
- **Contact Effect**: 1 damage on hit + brief toxic slowness or damage-over-time tick.
- **Puddle Hazard**: Upon impact with floor/wall, spawns lingering toxic milkshake residue that damages/slows if walked on for ~2.5s.

### Death & Drops
- **Death VFX**: Slosh burst + toxic puddle residue (using existing rot/spore puddle shader/particle logic from `combat.ts`).
- **Loot Drop Table**: Drop rates tuned in `reagents.ts` (e.g. `brimstone: 0.25`, `rotflesh: 0.15`).

---

## 3. Architecture & Code Touchpoints

### Step 1: Worktree Setup
- Branch `feat/milkshake-monster` in dedicated worktree `.worktrees/wt-milkshake-monster` off clean `origin/main` (commit `ce34f811`).

### Step 2: Types & Constants
- `src/game/pinball-knight/state.ts`: Add `"milkshake"` to `EnemyKind`.
- `src/game/pinball-knight/items.ts`: Add `"shake_spray"` to `ProjectileKind`.
- `src/game/pinball-knight/constants/enemies.ts`: Add `MILKSHAKE_HP`, `MILKSHAKE_R`, `MILKSHAKE_FIRE_RANGE`, `MILKSHAKE_SPRAY_SPEED`, `MILKSHAKE_DAMAGE`, etc.

### Step 3: Procedural Fallback Painter
- `src/game/pinball-knight/render/monsters/milkshake.ts`: Authored cel-painter with:
  - White tapered cup body, lid, striped bend straw, yellow dishwasher glove hands.
  - Idle bob, walk tilt, spray windup & burst, and crumple splash death frames.

### Step 4: Sprite Sheet Generation via DeepMind & Sprite-Forge
- Generate reference sprite sheet:
  - 4 rows (Idle, Walk, Spray Attack, Death Collapse), 16 frames total.
  - White cup, yellow dishwashing gloves, straw, flat chroma green background (`#00FF00`).
- Run sprite-forge prep and build:
  - `node src/game/pinball-knight/tools/sprite-forge/prep/prep-milkshake.mjs build`
  - `npm run sprites`
  - Target assets: `public/sprites/milkshake-S.json` and `public/sprites/milkshake-S.png`.

### Step 5: Combat, AI & Projectiles
- `src/game/pinball-knight/entities/projectiles.ts`:
  - `launchMilkshakeSpray(x, z, dx, dz)`: multi-droplet spray burst with toxic splash on impact.
- `src/game/pinball-knight/entities/zombie.ts`: Ranged attack dispatch for `milkshake`.
- `src/game/pinball-knight/entities/combat.ts`: Damage values, hit processing, and toxic death splash.
- `src/game/pinball-knight/entities/enemy-rules.ts`: `"kite"` movement rule.

### Step 6: Manifest, Bestiary & Debug Screen
- `src/game/pinball-knight/bestiary.ts`: Bestiary card for "Toxic Shake" (`icon: "🥤"`).
- `src/game/pinball-knight/boot/sheets.ts` & `manifest-inventory.ts`: Sheet registration and lazy loader integration.
- `src/game/pinball-knight/gui/screens/debug.ts`: Debug spawner button `"Shake"`.

### Step 7: Automated Tests
- Authored test suite `ThreeJS/src/game/pinball-knight/entities/milkshake.test.ts`:
  - Verify stats, projectile spawning, spray direction, collision damage, and drop rates.
  - Verify lazy sheet manifest and painter mappings.

### Step 8: Build, Deploy & Executable Sync
- Build production bundle with Vite.
- Synchronize sprite assets to `dist/pinball-knight-windows-x86_64/assets/sprites/`.
- Push to GitHub `origin/main`.
- Deploy container to Synology NAS (`http://10.0.0.16:8789`).
- Notify user with web container URL and native Windows executable path (`dist/pinball-knight-windows-x86_64/pk-game.exe`).
