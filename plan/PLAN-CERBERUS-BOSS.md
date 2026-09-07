# Implementation Plan — Cerberus Boss ("The Three-Headed Hound of Hades")

## Overview
Add a new mythical three-headed hound boss to `pinball-knight`: **Cerberus** (`BossKind "cerberus"`, `EnemyKind "cerberus"`).
Cerberus guards the exit stairs of the Cold Crypt on Pass 1 (Floors 26–30), balancing the crypt roster alongside the Reaper King.
The boss features a signature **Jaws Grab & Thrash** mechanic: Cerberus lunges forward, catches the knight in its massive central jaws, violently thrashes the knight side-to-side while dealing chew damage, and flings/drops the knight to the floor unless the player rapidly spams buttons to break free. In addition, all three heads breathe streams of infernal hellfire (`mouthFire`).

---

## 1. Boss Identity, Art & Anatomy

### Visual Identity
- **Species & Stance**: Massive muscular quadruped hellhound with three articulated heads.
- **Three Heads**:
  - Central head: Dominant, wider snout, lunges forward for the bite grab and main thrash.
  - Left & Right heads: Snarling, angled laterally, snapping and spewing flanking hellfire.
  - Molten red/gold glowing eyes, smoking nostrils, and razor fangs with steel highlights.
- **Pelt & Accents**: Obsidian/slate stone-dark fur, glowing molten-crimson veins along the spine hackles, and a spiked iron collar with broken heavy chains.
- **Scale**: `2.20` (within boss arena budget alongside Reaper King `2.17`, T-Rex `2.17`, Six-Armed God `2.22`).

---

## 2. Moveset & Combat Mechanics

### Move 1: Jaws Grab & Thrash (`thrashGrab`) — Signature Mechanic
- **Concept**: Cerberus rears back its three heads with an intimidating roar, lunges forward, and clamps its jaws onto the knight. Cerberus holds the player, violently thrashes them side-to-side, and drops/flings them with heavy knockback if the player fails to break free in time.
- **Windup / Telegraph (0.75s)**: A menacing red jaw/pincer lane indicator pulses on the ground toward the knight; Cerberus gathers haunches and snarls.
- **Lunge**: Cerberus charges forward 4.5 tiles at speed 14 along the lane.
- **Grab Hitbox & Pinning**:
  - If the knight is within bite reach (radius 1.25) during the lunge:
    - `p.cerberusGrabT = 4.0` (4-second maximum hold duration).
    - `p.cerberusGrabEscape = 5` (requires 5 rapid button presses to escape).
    - `p.cerberusGrabHost = z` (locks to Cerberus).
    - Toast: `"🐕 CAUGHT IN CERBERUS'S JAWS! SPAM buttons to break free!"`
- **Thrash ("Thralls you around")**:
  - While grabbed, Cerberus vigorously thrashes its head side-to-side:
    - Lateral offset oscillates rapidly: `Math.sin(time * 24) * 0.45`.
    - Knight position is pinned to Cerberus's mouth offset.
    - Knight is locked in `"stumble"` animation (`momSpeed = 0`).
    - Screen shake triggers continuously (`state.shakeT = 0.15`).
    - Periodic chew/thrash damage ticks: 1 damage every 0.8s with blood/sparks VFX.
- **Struggle & Escape (Player Wins)**:
  - Spamming attack, dodge, or movement directions decrements `p.cerberusGrabEscape`.
  - Upon reaching 0:
    - Knight breaks loose immediately!
    - Cerberus recoils in brief stagger (`slipT = 0.8`, `cooldown = 1.5`).
    - Knight gains brief invulnerability iframes (`p.iframes = 0.5`).
    - Toast: `"✨ BROKE FREE FROM THE JAWS!"`
- **Drop / Fling (Duration Expires)**:
  - If `p.cerberusGrabT` reaches 0 before escaping:
    - Cerberus violently hurls/drops the knight downward onto the stone tiles.
    - Deals 2 heavy drop damage.
    - Launches player into pinball momentum channel (`launch = 20`).
    - Large dust burst and impact screen shake (`state.shakeT = 0.35`).
    - Toast: `"💥 DROPPED BY CERBERUS!"`
- **Spec**:
  ```ts
  thrashGrab: {
    interval: 6.5,
    telegraph: 0.75,
    distance: 4.5,
    lungeSpeed: 14,
    biteRadius: 1.25,
    grabDamage: 1,
    grabDuration: 4.0,
    escapeCount: 5,
    thrashTickInterval: 0.8,
    thrashDamage: 1,
    dropDamage: 2,
    launch: 20,
    color: 0xd02020,
  }
  ```

### Move 2: Triple Hellfire Breath (`mouthFire`)
- **Concept**: All three heads open wide and spew a simultaneous 9-projectile spray of roaring hellfire across an arc.
- **Windup / Telegraph (0.7s)**: Glowing orange embers ignite in the throats of all three heads.
- **Execution**: 9 fireballs launched over 1.2s in a spread arc (`spread: 0.45`, `speed: 12`, `damage: 2`).
- **Floor Hazard**: Flame projectiles leave small scorching fire embers for 2.0s upon tile contact.
- **Spec**:
  ```ts
  mouthFire: {
    interval: 5.5,
    telegraph: 0.7,
    fireDuration: 1.2,
    fireSpeed: 12,
    damage: 2,
    shotCount: 9,
    color: 0xff3300,
    spread: 0.45,
  }
  ```

### Phase 2 Escalation (at 50% HP threshold)
- **Title**: `"🔥 CERBERUS ENRAGES: INFERNAL THRASH & TRIPLE HELLFIRE"`
- **Speed Multiplier**: `1.25x` movement speed.
- **Upgraded Attacks**:
  - `thrashGrab`: Reduced interval (`4.5s`), faster lunge (`18 tiles/s`), faster telegraph (`0.55s`).
  - `mouthFire`: Reduced interval (`3.8s`), 12 flame shots at higher velocity (`14 tiles/s`), wider spread (`0.55`).

---

## 3. Biome & Floor Reachability

- **Biome**: `crypt` (The Cold Crypt / Underworld Catacombs).
- **Pass Distribution**:
  - Currently, `crypt` only has 1 guardian (`reaper_king`).
  - By adding `cerberus` as the **second guardian (`pass 1`)** of `crypt`:
    - **Pass 0 (Floors 1–5)**: The Reaper King guards the catacombs exit.
    - **Pass 1 (Floors 26–30)**: Cerberus guards the deeper underworld.
  - This perfectly matches the 2-guardian roster of `bloodworks` (Overlord, T-Rex), `arcane` (Archivist, Jade Buddha), and `magma` (Dragon, Six-Armed God).
  - Keeps `boss-roster.test.ts` 100% green and deterministic.

---

## 4. Worktree & Git Strategy

Following workspace rules for `sun/pinball-knight`:
1. **Dedicated Worktree**:
   - Create worktree `.worktrees/wt-cerberus-boss` on branch `feat/cerberus-boss` off `main`.
2. **Non-Invasive Registry Edits**:
   - `boss-kinds.ts`: Add `cerberus` to `BossKind`, define `ThrashGrabSpec`, register `BOSSES.cerberus`.
   - `state.ts`: Add `cerberus` to `EnemyKind`, add player fields `cerberusGrabT`, `cerberusGrabEscape`, `cerberusGrabHost`.
   - `boss-moves.ts`: Add `ThrashGrabRt`, `freshThrashGrab`, `updateThrashGrab`, `disposeThrashGrab`, `thrashGrabHoldsMovement`.
   - `boss.ts`: Wire `thrashGrab` into `BossState`, `updateBossMoves`, and movement lock check.
   - `entities/player.ts`: Implement grab thrash shaking, struggle input spam, tick damage, and drop fling.
   - `boot/sheets.ts` & `manifest-inventory.ts`: Register `cerberus` in `SheetKey`, `IMPORTED_ART`, and `IMPORTED_FACINGS`.
3. **Dedicated Asset & Code Files**:
   - `ThreeJS/src/game/pinball-knight/render/monsters/cerberus.ts` (procedural cel-painter fallback).
   - `ThreeJS/src/game/pinball-knight/boss-cerberus.test.ts` (dedicated Vitest unit suite).
   - `ThreeJS/src/game/pinball-knight/tools/sprite-forge/prep/prep-cerberus.mjs` (sprite-forge prep script).
   - `ThreeJS/src/game/pinball-knight/tools/sprite-forge/sources/cerberus-2026-09-07/` (source sheets and alt-takes).

---

## 5. Implementation Steps (Planned)

1. **Step 1: Worktree & Branch Setup**
   - Create `.worktrees/wt-cerberus-boss` on `feat/cerberus-boss`.
2. **Step 2: Core Types & Spec Definitions**
   - Register `cerberus` in `boss-kinds.ts` and `state.ts`.
   - Define `ThrashGrabSpec` and `ThrashGrabRt` in `boss-kinds.ts` and `boss-moves.ts`.
3. **Step 3: Signature Grab & Thrash Attack Implementation**
   - Implement `updateThrashGrab` in `boss-moves.ts`: lunge lane, jaw hitbox, grab initiation.
   - Implement player holding, thrash shake, button spam escape, chew tick damage, and fling/drop in `entities/player.ts`.
   - Wire movement locks into `boss.ts`.
4. **Step 4: Procedural Cel-Painter Fallback**
   - Author `src/game/pinball-knight/render/monsters/cerberus.ts`:
     - 3 articulated snarling heads, quadruped leg joints, spiked collar.
     - Idle panting, walk stride, lunge bite & thrash, and death collapse.
   - Wire into `render/sheet-painters.ts`.
5. **Step 5: Sprite Generation & Sprite-Forge Pipeline ("Nano Banana")**
   - Generate 4x4 master sprite sheet using the AI image generation tool on flat `#FF00FF` magenta chroma.
   - Store master and alt-takes in `sources/cerberus-2026-09-07/`.
   - Author `prep-cerberus.mjs` to slice, center, and output `inbox/cerberus-S.png` and `.json`.
   - Run `npm run sprites` to process through sprite-forge compiler into `public/sprites/cerberus-S.png` and `.json`.
6. **Step 6: Bestiary & Debug Screen Integration**
   - Add Bestiary card in `src/game/pinball-knight/bestiary.ts` (`icon: "🐕"`, label: `"Cerberus"`).
   - Add Debug spawner button `"Cerberus"` in `gui/screens/debug.ts`.
7. **Step 7: Automated Tests & Census Verification**
   - Create unit tests in `ThreeJS/src/game/pinball-knight/boss-cerberus.test.ts`.
   - Run `boss-roster.test.ts` to confirm reachability.
   - Run `npm run test` or targeted test suite.
8. **Step 8: Build, Deploy & Executable Sync**
   - Build Vite client bundle.
   - Synchronize sprites to `dist/pinball-knight-windows-x86_64/assets/sprites/`.
   - Commit and push to GitHub.
   - Redeploy container to Synology NAS (`npm run deploy`).
   - Report test readiness and Windows executable path.
