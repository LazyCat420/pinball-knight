# Implementation Plan — Six-Armed Indian God Boss ("Asura" / "Mahadeva")

## Overview
Add a new multi-armed deity boss to `pinball-knight`: **The Six-Armed God** (`BossKind "six_armed_god"`), inspired by Vedic/Hindu martial iconography (e.g. Asura / fierce Rudra).
The boss features six articulated arms wielding ceremonial daggers and a signature mouth fire attack where it unleashes roaring streams of flame, combined with a synchronized 6-dagger fan throw.

---

## 1. Boss Identity, Art & Anatomy

### Visual Identity
- **Body & Skin**: Deep radiant bronze/obsidian skin with glowing sacred markings/runes.
- **Arms & Weapons**: Six arms radiating from torso in a dynamic stance:
  - Upper pair: Raising blazing ritual daggers overhead.
  - Middle pair: Holding crescent daggers ready to fling laterally.
  - Lower pair: Wielding forward-thrusting katars.
- **Head & Face**: Ornate gold mukut (high crown), glowing third eye on the forehead, and an unhinging mouth glowing with internal molten fire.
- **Attire**: Flowing red and gold celestial sashes/dhoti that ripple with levitation energy.
- **Scale**: `2.22` (fitting boss arena budget alongside Reaper King 2.17, T-Rex 2.17, Dragon 2.35).

---

## 2. Moveset & Combat Mechanics

### Move 1: Mouth Fire Breath (`mouthFire` / `teleportFire` variant)
- **Concept**: The deity hovers, expands its chest, and unleashes a concentrated spray of roaring flame projectiles directly from its mouth towards the knight.
- **Windup / Tell**: 0.75s telegraph. The boss's throat and head glow with incandescent orange flare, emitting smoke and flame motes before the fire leaves.
- **Execution**: Emits 7 high-speed fireball projectiles over 1.2s in a targeted spread arc.
- **Floor Hazard**: Flame impact spawns small lingering ground fire patches for 2.0s.
- **Spec**:
  ```ts
  mouthFire: {
    interval: 5.5,
    telegraph: 0.75,
    fireDuration: 1.2,
    fireSpeed: 11,
    damage: 2,
    shotCount: 7,
    color: 0xff4500,
  }
  ```

### Move 2: Six-Armed Dagger Volley (`daggerVolley`)
- **Concept**: The god brandishes all 6 arms simultaneously, flinging a synchronized barrage of 6 ornate daggers across the chamber.
- **Windup / Tell**: 0.7s telegraph. A pulsing crimson mandala ring expands on the ground, accompanied by the metallic chime of blades aligning.
- **Execution**: 6 daggers launch concurrently in a wide calibrated fan (or converging formation), traveling at speed 15, dealing 2 damage with pinball launch knockback.
- **Spec**:
  ```ts
  daggerVolley: {
    interval: 4.2,
    telegraph: 0.7,
    daggerCount: 6,
    speed: 15,
    damage: 2,
    launch: 18,
    spreadAngle: Math.PI / 3, // 60-degree fan
    color: 0xffd700,
  }
  ```

### Phase 2 Escalation (at 50% HP threshold)
- **Title**: `"🔥 ASURA UNLEASHES THE TANDAVA: DUAL FLAME & 12-DAGGER SPIRAL"`
- **Speed Multiplier**: 1.25x movement speed.
- **Upgraded Attacks**:
  - `mouthFire`: Reduced interval (3.8s), 9 shots, faster fire speed (14), higher damage (3).
  - `daggerVolley`: Reduced interval (3.0s), fires 12 daggers (6 outward primary volley followed immediately by 6 staggered offset blades).

---

## 3. Biome & Floor Reachability

- **Biome**: `magma` (Magma Abyss).
  - *Current Status*: The Magma Abyss currently only has 1 guardian (`dragon`, pass 0).
  - *Pass Integration*: Adding `six_armed_god` as the **second guardian** (`pass 1`) of `magma` ensures:
    - Pass 0 (Floors 21-25): The Ancient Dragon guards the abyss.
    - Pass 1 (Floors 46-50): The Six-Armed God guards the deep abyss.
  - Satisfies `boss-roster.test.ts` deterministic reachability audit without displacing any existing boss.

---

## 4. Conflict-Free Worktree & Git Strategy

To ensure zero conflicts during merge and deployment:
1. **Isolated Worktree**:
   - Create worktree `.worktrees/wt-six-armed-boss` from `origin/main` (commit `80791fd4`).
   - Branch: `feat/six-armed-god-boss`.
2. **Non-Invasive Registry Edits**:
   - `boss-kinds.ts`: Add `six_armed_god` to `BossKind` union and `BOSSES` table without editing other bosses' blocks.
   - `boot/sheets.ts`: Append `six_armed_god` to `IMPORTED_ART` and `SheetKey`.
   - `render/sheet-painters.ts`: Append entry to `SHEET_PAINTERS`.
   - `bestiary.ts` & `debug.ts`: Append card and debug button.
3. **Dedicated Asset & Code Files**:
   - `ThreeJS/src/game/pinball-knight/render/monsters/six-armed-god.ts` (new cel-painter).
   - `ThreeJS/src/game/pinball-knight/boss-six-armed-god.test.ts` (new dedicated test suite).
   - `ThreeJS/src/game/pinball-knight/tools/sprite-forge/prep/prep-six-armed-god.mjs` (new prep script).
4. **Clean Merge Protocol**:
   - Fetch latest `origin/main`.
   - Rebase `feat/six-armed-god-boss` onto `origin/main`.
   - Fast-forward merge into main branch.
   - Run deployment lock via `bash deploy.sh`.

---

## 5. Implementation Steps

1. **Step 1: Worktree & Branch Setup**
   - Create `.worktrees/wt-six-armed-boss` on `feat/six-armed-god-boss`.
2. **Step 2: Core Types & Spec Definitions**
   - Register `six_armed_god` in `src/game/pinball-knight/boss-kinds.ts`.
   - Define `DaggerVolleySpec` and `DaggerVolleyRt` in `boss-kinds.ts` and `boss-moves.ts`.
3. **Step 3: Attack Implementations in `boss-moves.ts` & `boss.ts`**
   - Implement `updateDaggerVolley` with 6-arm dagger fan projectile logic.
   - Wire mouth fire breath and dagger volley into `updateBossMoves` and `disposeBoss`.
4. **Step 4: Procedural Cel-Painter Fallback**
   - Author `src/game/pinball-knight/render/monsters/six-armed-god.ts`:
     - 6 articulated arms with glowing daggers.
     - Flaming mouth particle emission.
     - Third eye and radiant golden crown.
     - Idle, walk, attack, and death collapse animations.
   - Wire into `render/sheet-painters.ts`.
5. **Step 5: Sprite Sheet Generation & Sprite-Forge Pipeline**
   - Generate 4x4 sprite sheet via DeepMind generator tool on magenta `#FF00FF` chroma.
   - Prep script `prep-six-armed-god.mjs` to crop, center, and produce inbox JSON/PNG.
   - Run sprite forge compiler (`npm run sprites`) to output `public/sprites/six_armed_god-S.json` and `.png`.
6. **Step 6: Bestiary & Debug Integration**
   - Add Bestiary entry in `src/game/pinball-knight/bestiary.ts`.
   - Add Spawner button in `src/game/pinball-knight/gui/screens/debug.ts`.
7. **Step 7: Verification & Test Suites**
   - Run unit tests in `boss-six-armed-god.test.ts`.
   - Run census in `boss-roster.test.ts`.
8. **Step 8: Merge & Redeploy**
   - Rebase and merge to `main`.
   - Run `npm run deploy` to update the Synology NAS container.
