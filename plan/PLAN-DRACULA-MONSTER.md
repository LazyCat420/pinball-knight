# Implementation Plan — Count Dracula & Bat Final Form Monster

**Target Project**: `pinball-knight`  
**Date**: 2026-09-07  
**Status**: PLAN ONLY (Awaiting User Review & Approval — DO NOT IMPLEMENT YET)  
**Render Asset**: 16-bit Retro Pixel Art Sprite Sheet Generated with Nano Banana & Ready  
**Methodology**: Strictly compliant with [`plan-verification-standard.md`](file:///home/lazycat/github/projects/sun/.agents/plan-verification-standard.md) (VCPM Claim Triage & Quality Gates)

---

## 1. Problem Statement & User Intent

The user requested adding a classic Gothic horror monster to `pinball-knight`:
> *"make a monster that is dracula and he drains your blood when he dies he turns into a bat and you have to kill him as a bat as the final form. make it a new monster please in pinball knight . use nano banana for the sprites."*

### Key Requirements
1. **Visual Identity**: Count Dracula in aristocratic gothic vampire attire (high-collared flowing black cloak with crimson silk lining, pale skin, fangs, red glowing eyes).
2. **Nano Banana Asset**: Generated as a 16-bit pixel art sprite sheet on clean chroma `#00FF00` background.
3. **Blood Drain Mechanic**: Dracula latches onto or channels a blood siphon on the knight, dealing damage over time and healing himself.
4. **Death Transformation (Two-Phase Boss/Elite)**: Upon reaching 0 HP in his humanoid form, Dracula bursts into a dark vortex and transforms into his **Final Form: Dracula Bat**, which must be slain to complete the encounter.
5. **Reagents & Progression**: Yields vampire fangs, bat wings, and grim bones upon final defeat.

---

## 2. Visual Design & Nano Banana Sprite Sheet

### Visual Sprite Sheet (Generated & Chroma-Ready)
Generated with Nano Banana on pure uniform chroma green (`#00FF00`) with zero ground lines, zero borders, and zero shadows for Sprite-Forge transparency extraction:

![Count Dracula Vampire Lord Sprite Sheet](/home/lazycat/.gemini/antigravity-ide/brain/878e1b68-7679-4a65-bf9d-283c58c7185a/dracula_sheet_1788838569578.jpg)

### Animation Grid Breakdown (4×4 Grid, 16 Frames)
- **Row 0 (`idle`)** [Frames 0..3]: Facing South — Aristocratic vampire count poised with high-collared cape billowing gently, crimson eyes gleaming.
- **Row 1 (`walk`)** [Frames 4..7]: Facing South — Predatory gliding stride forward across the floor, cape trailing in his wake.
- **Row 2 (`attack` / blood drain)** [Frames 8..11]: Facing South — Cloak flares open, lunges forward with clawed grasp and bared fangs while crimson blood tendrils siphon vital energy.
- **Row 3 (`death` & bat transformation)** [Frames 12..15]: Defeated stagger, clutches chest, spins into his swirling cloak, and erupts into a dark purple smoke vortex as a vampire bat with glowing eyes emerges and ascends.

---

## 3. Atomic Claim Classification Matrix (VCPM Standard)

Per [`plan-verification-standard.md`](file:///home/lazycat/github/projects/sun/.agents/plan-verification-standard.md), all technical assertions are triaged:

| ID | Claim Statement | Classification | Evidence / Source / Validation Path |
|---|---|---|---|
| `CLAIM-1` | `state.ts:EnemyKind` defines all monster kinds and can accept `"dracula"` and `"dracula_bat"` | **Verified Fact** | Inspect [`state.ts:342-388`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/state.ts#L342-L388) |
| `CLAIM-2` | Pinball Knight already has flying bat physics (`BAT_HOVER_Y`, sine-wave horizontal wobble `BAT_WOBBLE_FREQ`) in `entities/zombie.ts` | **Verified Fact** | Inspect [`entities/zombie.ts:1405-1462`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/zombie.ts#L1405-L1462) |
| `CLAIM-3` | Deferred spawning on death exists in engine via `drainPendingMinis` / `drainPendingSummons` in `spawn/factory.ts` | **Verified Fact** | Inspect [`spawn/factory.ts:101-122`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/spawn/factory.ts#L101-L122) and [`sim/simulate.ts:159`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/sim/simulate.ts#L159) |
| `CLAIM-4` | Killing Dracula Phase 1 can queue the bat transformation via callback in `entities/combat.ts:killZombie` | **Testable Claim** | Unit test verifying `onDraculaTransform(x, z)` triggers when Dracula HP $\le 0$ |
| `CLAIM-5` | Dracula's blood drain siphon deals 1 damage per 0.4s to the knight and restores 1 HP to Dracula up to max HP | **Testable Claim** | Unit test verifying player HP reduction and Dracula HP regeneration during siphon |
| `CLAIM-6` | Siphon breaks if player rolls/dashes beyond range (1.8 tiles) or if Dracula is staggered | **Testable Claim** | Unit test in `dracula.test.ts` testing tether distance cutoff and stagger interrupt |
| `CLAIM-7` | Dracula's Final Form (Bat) spawns with flying altitude, sine wobble, scale 1.35, crimson tint `0xff2244`, and 12 HP | **Testable Claim** | Test checking spawn properties, altitude, and stats of Dracula Bat |
| `CLAIM-8` | Slaying Dracula Bat triggers vampire death VFX (`state.vfx?.burst`, `state.vfx?.smoke`) and drops Dracula's loot (`fang`, `batwing`, `grimbone`) | **Testable Claim** | Test verifying loot drop on bat kill and no duplicate loot on Phase 1 |
| `CLAIM-9` | Debug console and panel need label override `DRACULA` (7 chars $\le 8$) and `DRAC-BAT` (8 chars $\le 8$) | **Verified Fact** | [`gui/screens/debug.ts:219`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/gui/screens/debug.ts#L219) (`CHIP_CHARS = 8`) |
| `ASSUMPTION-1` | Dracula appears on floor 8+ (Crypt / Catacombs / Castle biomes) with elite ratio | **Assumption** | Risk: Difficulty pacing. Validation: Check `floorBudgets` and monster rosters. |
| `ASSUMPTION-2` | During Phase 1 death animation, Dracula is untargetable and invulnerable to prevent combo overkill from deleting the bat phase before it spawns | **Assumption** | Risk: Rapid multi-ball pinball hits interrupting the transformation. Validation: Guard `damageZombie` against dying state. |

*Metrics: 4 Verified Facts (36%), 5 Testable Claims (45%), 2 Assumptions (18%), 0 Unverifiable Claims (0%). Passes VCPM ≥80% Gate.*

---

## 4. Proposed Architecture & System Design

```
                     ┌─────────────────────────────────────────┐
                     │          PHASE 1: COUNT DRACULA         │
                     │  - High-Collared Vampire Nobleman       │
                     │  - HP: 22, Melee & Blood Siphon Channel │
                     │  - Siphons player HP -> Heals Dracula   │
                     └────────────────────┬────────────────────┘
                                          │
                                          │ Humanoid HP Reaches 0
                                          ▼
                     ┌─────────────────────────────────────────┐
                     │          DEATH TRANSFORMATION           │
                     │  - Dramatic Cloak Swirl & Smoke Vortex  │
                     │  - Invulnerable During Transformation   │
                     │  - End-of-step Spawn Queue Hand-off    │
                     └────────────────────┬────────────────────┘
                                          │
                                          │ Erupts from Shadow Vortex
                                          ▼
                     ┌─────────────────────────────────────────┐
                     │      PHASE 2 (FINAL FORM): DRACULA BAT  │
                     │  - Empowered Demonic Vampire Bat        │
                     │  - HP: 12, Fast Evasive Flutter & Wobble│
                     │  - Dive Attacks & High Flight Altitude  │
                     └────────────────────┬────────────────────┘
                                          │
                                          │ Bat Slain
                                          ▼
                     ┌─────────────────────────────────────────┐
                     │            TRUE DEFEAT & LOOT           │
                     │  - Crimson & Ash VFX Burst              │
                     │  - Drops: Vampire Fangs, Bat Wings,     │
                     │    Grim Bone & Run Gold                 │
                     └─────────────────────────────────────────┘
```

---

## 5. Detailed Component Plan

### A. Core Constants & State
- [`state.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/state.ts):
  - Add `"dracula"` and `"dracula_bat"` to `EnemyKind`.
  - Extend `Zombie` with Dracula siphon fields: `draculaDrainT?: number`, `draculaDrainTarget?: boolean`.
- [`constants/enemies.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/constants/enemies.ts):
  - `DRACULA_HP = 22`, `DRACULA_R = 0.45`, `DRACULA_SPEED_FACTOR = 0.95`.
  - `DRACULA_DRAIN_RANGE = 1.8`, `DRACULA_DRAIN_TICK = 0.4`, `DRACULA_DRAIN_DURATION = 1.6`.
  - `DRACULA_DRAIN_DAMAGE = 1`, `DRACULA_DRAIN_HEAL = 1`, `DRACULA_DRAIN_COOLDOWN = 3.2`.
  - `DRACULA_BAT_HP = 12`, `DRACULA_BAT_R = 0.35`, `DRACULA_BAT_SPEED_FACTOR = 1.45`.
  - `DRACULA_BAT_SCALE = 1.35`, `DRACULA_BAT_TINT = 0xff2244`.
  - `DRACULA_FROM_LEVEL = 8`, `DRACULA_RATIO = 12`.

### B. Combat & Transformation Hooks
- [`entities/dracula.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/dracula.ts) (NEW):
  - Logic for Dracula's blood drain channel (`updateDraculaSiphon(z, p, dt)`).
  - Tether check: if distance $> 1.8$ or `z.staggerT > 0`, cancel drain.
  - Spawns blood siphon motes flying from player to Dracula.
  - Heals Dracula $+1$ HP per tick up to `z.maxHp`.
- [`entities/combat.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/combat.ts):
  - In `killZombie(z)`:
    - If `z.kind === "dracula"`: Fire `onDraculaTransform?.(z.x, z.z, z.speed)`. Do not drop full boss loot yet (drops only basic coins).
    - If `z.kind === "dracula_bat"`: True kill! Drop full Dracula reagents and trigger ash burst.
- [`spawn/factory.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/spawn/factory.ts):
  - Implement `queueDraculaBat(x, z, speed)` and `drainPendingDraculaBats()`.
  - Spawns the Dracula Bat at Dracula's exact coordinate with crimson smoke and flutter sound.
- [`sim/simulate.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/sim/simulate.ts):
  - Hook `drainPendingDraculaBats()` in the post-combat frame drain loop.

### C. Sprite-Forge & Rendering
- **Source Directory**: `ThreeJS/src/game/pinball-knight/tools/sprite-forge/sources/dracula-2026-09-07/`
- **Prep Script**: `prep-dracula.mjs` slices 4×4 grid into 16 frames:
  - Row 0: `idle` (4 frames)
  - Row 1: `walk` (4 frames)
  - Row 2: `attack` (4 frames)
  - Row 3: `death` (4 frames)
- **Publish**: `FORGE_PUBLISH=1 npx vitest run src/game/pinball-knight/tools/sprite-forge/inbox.test.ts`
- **Atlas Output**: `ThreeJS/public/sprites/dracula-S.png` and `dracula-S.json`
- **Dist Copy**: Bundle into `dist/pinball-knight-windows-x86_64/assets/sprites/`.
- **Procedural Cel-Painter Fallback**: `render/monsters/dracula.ts` (Aristocratic cape, pale skin, scarlet lining, fanged jaw, bat flutter death).

### D. Roster, Bestiary & Debug Integration
- [`bestiary.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/bestiary.ts):
  - Register `dracula`: "Count Dracula" (icon 🧛).
  - Register `dracula_bat`: "Dracula's Bat Form" (icon 🦇).
- [`reagents.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/reagents.ts):
  - `dracula_bat`: `fang` (0.45), `batwing` (0.40), `grimbone` (0.25).
- [`gui/screens/debug.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/gui/screens/debug.ts) & [`debug-panel.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/debug-panel.ts):
  - `dracula: "Dracula"` (7 chars $\le 8$).
  - `dracula_bat: "DracBat"` (7 chars $\le 8$).

---

## 6. Verification & Testing Plan

1. **Unit & Logic Tests (`dracula.test.ts`)**:
   - `registers Dracula and Dracula Bat across all roster tables with correct stats and values`.
   - `initiates blood siphon within 1.8 tiles, drains player HP, and heals Dracula`.
   - `breaks blood siphon when player rolls away beyond 1.8 tiles or staggers Dracula`.
   - `transforms into Dracula Bat when humanoid Dracula HP reaches 0`.
   - `verifies Dracula Bat flies with hover elevation, sine wobble, and high speed`.
   - `rewards Dracula reagents only upon slaying the final Bat form`.
   - `verifies procedural cel-painter fallback produces complete 3-facing animation clips`.
2. **Regression & Safety Tests**:
   - Run `lazy-sheets.test.ts` to confirm cold-state and lazy-loading atlas consistency for all monsters.
   - Run `debug-console.test.ts` and `debug-panel.test.ts` to confirm chip character constraints ($len \le 8$).
3. **Build & NAS Deployment**:
   - Production Vite build via `pnpm --prefix ThreeJS build`.
   - Push to GitHub `origin main`.
   - Redeploy container via `npm run deploy`.
   - Proactively notify user that both native Windows executable and web container are ready for testing.
