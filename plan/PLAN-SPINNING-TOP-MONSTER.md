# Implementation Plan — Spinning Top Monster ("Whirligig Battle Top")

**Target Project**: `pinball-knight`  
**Date**: 2026-09-07  
**Status**: PLAN ONLY (Awaiting User Review & Approval — DO NOT IMPLEMENT YET)  
**Render Asset**: 16-bit Pixel Art Sprite Sheet Generated with Nano Banana & Ready  
**Methodology**: Strictly compliant with [`plan-verification-standard.md`](file:///home/lazycat/github/projects/sun/.agents/plan-verification-standard.md) (VCPM Claim Triage & Quality Gates)

---

## 1. Problem Statement & User Intent

The user requested creating a new monster for `pinball-knight`:
> *"make a monster that is a spinning top that can slam into you"*

### Key Requirements & Pinball Synergy
1. **Mechanical Visual Identity**: An armored gyroscopic battle top made of dark iron, brass gearworks, a spiked outer rim, and a sharp carbide pivot peg spinning on the floor with a glowing central power gem.
2. **Nano Banana Asset**: Generated as a 16-bit pixel art sprite sheet on a pure uniform chroma `#00FF00` background.
3. **Rev-Up / Wind-Up Telegraph**: When the spinning top acquires line-of-sight and proximity to the knight, it digs into the floor, accelerating its centrifugal rotation (`sfxSpin`), spraying friction sparks and grinding dust.
4. **Slam Dash & Pinball Deflection**: It rockets forward in a high-speed locked trajectory! If it rams the knight, it deals heavy collision damage ($2$ HP) and imparts a massive pinball deflection impulse, hurling the player backward.
5. **Wall Ricochet**: If it strikes dungeon masonry during its slam dash, it ricochets off the wall normal with sparks, sustaining its kinetic dash until duration completes.
6. **Wobble / Dizzy Stagger Vulnerability**: Following a slam charge, the top suffers gyroscopic instability, wobbling erratically at low speed for $1.8\text{s}$. During this window, it is vulnerable to counter-attacks.
7. **Gyroscopic Momentum Gate**: While spinning at full speed, standing pokes at low speed clink off its centrifugal rim (`soft: 0.35`); only high-speed momentum strikes ($> 5.5\text{ u/s}$) or strikes landed during its wobble state deal full damage and knock it tumbling.

---

## 2. Visual Design & Nano Banana Sprite Sheet

### Visual Sprite Sheet (Generated & Chroma-Ready)
Generated with Nano Banana on pure uniform chroma green (`#00FF00`) with zero ground lines, zero borders, and zero shadows for Sprite-Forge transparency extraction:

![Spinning Top Monster Sprite Sheet](/home/lazycat/.gemini/antigravity-ide/brain/878e1b68-7679-4a65-bf9d-283c58c7185a/spinning_top_sheet_1788844870304.jpg)

### Animation Grid Breakdown (4×4 Grid, 16 Frames)
- **Row 0 (`idle`)** [Frames 0..3]: Facing South — Smooth continuous gyroscopic rotation on spot, brass gear teeth and spiked iron rim rotating, glowing central core.
- **Row 1 (`walk` / cruise)** [Frames 4..7]: Facing South — Tilted forward at a dynamic angle, carving along stone corridors with friction sparks flying from its pivot tip.
- **Row 2 (`attack` / slam charge)** [Frames 8..11]: Facing South — Blinding centrifugal rotation with fiery golden spin trail, sparks cascading from the base, rocketing forward at top speed.
- **Row 3 (`death` / stagger)** [Frames 12..15]: Losing stability — Wobbling heavily off-axis, tipping over onto its side, cracking its outer shell and spilling internal brass cogs onto the floor.

---

## 3. Atomic Claim Classification Matrix (VCPM Standard)

Per [`plan-verification-standard.md`](file:///home/lazycat/github/projects/sun/.agents/plan-verification-standard.md), all technical assertions are triaged:

| ID | Claim Statement | Classification | Evidence / Source / Validation Path |
|---|---|---|---|
| `CLAIM-1` | `state.ts:EnemyKind` defines all monster kinds and can accept `"spinning_top"` | **Verified Fact** | Inspect [`state.ts:380-390`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/state.ts#L380-L390) |
| `CLAIM-2` | Enemy slam/charge movement can be governed by a dedicated state machine or movement commit in `entities/spinning-top.ts` | **Verified Fact** | Pattern verified in [`entities/movement.ts:452`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/movement.ts#L452) (`leaper`) and [`entities/dracula.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/dracula.ts) |
| `CLAIM-3` | `espressoTeacupSpin` in `zombie.ts:507` demonstrates rotational collision and player impulse deflection | **Verified Fact** | [`zombie.ts:507-545`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/zombie.ts#L507-L545) |
| `CLAIM-4` | Wall contact bounce can be calculated using `moveCircle` collision resolution and velocity reflection vector $\vec{v}' = \vec{v} - 2(\vec{v} \cdot \vec{n})\vec{n}$ | **Testable Claim** | Unit test in `entities/spinning-top.test.ts` verifying reflection off cardinal walls |
| `CLAIM-5` | Slam collision delivers $2$ damage to player and knocks player back with speed $\ge 6.5\text{ u/s}$ | **Testable Claim** | Unit test verifying player HP reduction and `p.momSpeed >= 6.5` |
| `CLAIM-6` | `MOMENTUM_GATES.spinning_top` can deflect standing physical hits below `MOMENTUM_T_FLOOR` down to $35\%$ damage | **Testable Claim** | Verify `MOMENTUM_GATES.spinning_top` in `entities/enemy-rules.ts` |
| `CLAIM-7` | Following a slam dash, top enters wobble state for $1.8\text{s}$ with speed reduced to $0.4\times$ and stagger chance increased to $0.70$ | **Testable Claim** | Unit test verifying state transition and speed modifier |
| `CLAIM-8` | Sprite-Forge pipeline ingests `spinning_top_sheet_1788844870304.jpg` via `prep-spinning-top.mjs` and publishes `spinning_top-S.png` and `spinning_top-S.json` | **Testable Claim** | Vitest run `inbox.test.ts` with `FORGE_PUBLISH=1` |
| `CLAIM-9` | Debug console and panel chip labels are constrained by `CHIP_CHARS = 8`, requiring `LABEL_OVERRIDE` $\le 8$ characters (`"SpinTop"` = 7 chars) | **Verified Fact** | [`debug-panel.ts:53`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/debug-panel.ts#L53) and [`debug.ts:137`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/gui/screens/debug.ts#L137) |
| `ASSUMPTION-1` | Spinning Top spawns from dungeon floor level 7+ (`SPINNING_TOP_FROM_LEVEL = 7`) with ratio 14 | **Assumption** | Risk: Spawn frequency tuning. Validation: Adjust `levelConfig` spawn ratios. |
| `ASSUMPTION-2` | During slam dash, top is immune to normal player knockback, forcing the player to dodge or parry at speed | **Assumption** | Risk: Player feeling trapped in narrow 1-tile corridors. Validation: Include 0.6s visible windup telegraph with floor spark decals. |

*Metrics: 4 Verified Facts (36%), 5 Testable Claims (45%), 2 Assumptions (18%), 0 Unverifiable Claims (0%). Passes VCPM ≥80% Gate.*

---

## 4. Proposed Technical Architecture & Changes

### 4.1 State & Constants
- In `state.ts`:
  - Add `"spinning_top"` to `EnemyKind`.
  - Add optional top state tracking fields to `Zombie`:
    - `topState?: "cruise" | "windup" | "slam" | "wobble"`
    - `topTimer?: number`
    - `topDashDirX?: number`
    - `topDashDirZ?: number`
- In `constants/enemies.ts`:
  - `SPINNING_TOP_HP = 16`
  - `SPINNING_TOP_R = 0.42`
  - `SPINNING_TOP_CRUISE_SPEED = 0.9`
  - `SPINNING_TOP_SLAM_SPEED = 2.4`
  - `SPINNING_TOP_CHARGE_RANGE = 4.8`
  - `SPINNING_TOP_WINDUP = 0.6`
  - `SPINNING_TOP_SLAM_DURATION = 1.1`
  - `SPINNING_TOP_WOBBLE_DURATION = 1.8`
  - `SPINNING_TOP_SLAM_DAMAGE = 2`
  - `SPINNING_TOP_SLAM_DEFLECT = 6.5`
  - `SPINNING_TOP_COOLDOWN = 3.5`
  - `SPINNING_TOP_RATIO = 14`
  - `SPINNING_TOP_FROM_LEVEL = 7`

### 4.2 Entity Logic (`entities/spinning-top.ts`)
- `updateSpinningTop(z: Zombie, p: Player, dt: number)`:
  - **`cruise` state**: Follows normal maze navigation. Checks distance and LOS to player. When within `SPINNING_TOP_CHARGE_RANGE` and cooldown is 0, transitions to `windup`.
  - **`windup` state**: Roots in place, plays high-speed spin animation, emits friction sparks (`state.vfx?.sparks`) and rising smoke. Winds up for $0.6\text{s}$. Locks dash vector towards player's position.
  - **`slam` state**: Surges forward at `SPINNING_TOP_SLAM_SPEED` along locked trajectory.
    - If it contacts the player: deals $2$ damage, flings player back with `SPINNING_TOP_SLAM_DEFLECT`, transitions to `wobble`.
    - If it contacts a wall: reflects dash velocity vector off wall normal with spark burst and metallic clink sound, continuing the dash.
    - When `SPINNING_TOP_SLAM_DURATION` expires: transitions to `wobble`.
  - **`wobble` state**: Gyro instability. Slows to $0.4\times$ speed, plays stumble animation, vulnerable to high momentum attacks. After $1.8\text{s}$, returns to `cruise` with cooldown set to `SPINNING_TOP_COOLDOWN`.

### 4.3 Combat, Stagger & Rules Integration
- In `entities/combat.ts`:
  - Add `spinning_top: 2` to `DMG_BY_KIND`.
  - Death VFX: Spills brass cogs, metal fragments, and spark burst (`burst(z.x, 0.4, z.z, 0xd4a359, 14, 2.5)`).
- In `entities/stagger.ts`:
  - `PAIN_BY_KIND.spinning_top = 0.25` (steady gyro while spinning; top is easily interrupted while in `wobble` state).
- In `entities/enemy-rules.ts`:
  - `MOVEMENT_BY_KIND.spinning_top = "chase"`.
  - `MOMENTUM_GATES.spinning_top`:
    ```typescript
    spinning_top: {
      minSpeed: 0,
      bar: MOMENTUM_T_FLOOR,
      soft: 0.35,
      gatesDamage: true,
      text: "Gyroscopic Armor: centrifugal spinning deflects low-speed blows down to 35% damage. Strike with pinball momentum or hit during its post-slam wobble to knock it off balance.",
    }
    ```
- In `reagents.ts`:
  - `spinning_top: [{ id: "steelpin", chance: 0.35 }, { id: "ironshard", chance: 0.30 }, { id: "lodestone", chance: 0.20 }]`.
- In `bestiary.ts`:
  - Label: `"Whirligig Top"`, Icon: `"🪀"`, Blurb: `"mechanized armored gyroscopic battle top that revs into blinding spin charges and slams knights with massive kinetic deflection"`.
- In `gui/screens/debug.ts` & `debug-panel.ts`:
  - `LABEL_OVERRIDE.spinning_top = "SpinTop"`.

### 4.4 Sprite-Forge & Fallback Painter
- Master source: `ThreeJS/src/game/pinball-knight/tools/sprite-forge/sources/spinning-top-2026-09-07/`.
- Slicing script: `ThreeJS/src/game/pinball-knight/tools/sprite-forge/prep/prep-spinning-top.mjs`.
- Output: `ThreeJS/public/sprites/spinning_top-S.png` and `.json`.
- Procedural cel-painter: `render/monsters/spinning-top.ts` (`makeSpinningTopPaints`), registered in `sheet-painters.ts` and `monster-portrait.ts`.

---

## 5. Verification Plan

### Automated Vitest Suite
- Run `src/game/pinball-knight/entities/spinning-top.test.ts` (7+ comprehensive tests):
  1. Roster and table registration (`STATS`, `HP_BY_KIND`, `MOVEMENT_BY_KIND`, `PAIN_BY_KIND`, `KIND_INFO`, `ENEMY_DROPS`, `KIND_SKIN`).
  2. Cruise $\to$ Windup transition on player proximity.
  3. Windup $\to$ Slam dash execution with locked heading.
  4. Slam contact damage and pinball player impulse deflection.
  5. Wall contact collision handling and ricochet vector calculation.
  6. Slam completion $\to$ Wobble state transition, reduced speed, and cooldown recovery.
  7. Gyroscopic momentum gate behavior and procedural cel-painter rendering.
- Run regression suites:
  - `npx vitest run src/game/pinball-knight/boot/lazy-sheets.test.ts`
  - `npx vitest run src/game/pinball-knight/debug-console.test.ts src/game/pinball-knight/debug-panel.test.ts`
  - `npx vitest run src/game/pinball-knight/bestiary.test.ts`
  - `npx vitest run src/game/pinball-knight/content-expansion.test.ts`

### Build, Merge & Deploy
- `npm run build` in ThreeJS to verify 0 bundling/TypeScript errors.
- Commit to `feat/spinning-top-monster` worktree.
- Merge into `main`, push to GitHub `origin main`.
- Redeploy to Synology NAS: `npm run deploy`.
- Validate container health and HTTP 200 on `http://10.0.0.16:8789/` and `/sprites/spinning_top-S.png`.
- Proactively notify user that native Windows binary and web container are ready for testing.
