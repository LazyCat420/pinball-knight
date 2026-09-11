# Implementation Plan — Danny DeVito Inspired Monster ("Blaster Frank")

**Target Project**: `pinball-knight` (Three.js version)  
**Date**: 2026-09-11  
**Status**: PLAN ONLY (Awaiting User Review & Approval — DO NOT IMPLEMENT YET)  
**Methodology**: Strictly compliant with [`plan-verification-standard.md`](file:///home/lazycat/github/projects/sun/.agents/plan-verification-standard.md) (VCPM Claim Triage & Quality Gates)  
**Render Asset**: 16-Bit Nano Banana Sprite Sheet Generated on `#00FF00` Chroma Green & Embedded  

---

## 1. Problem Statement & Character Concept

The user requested adding a new monster inspired by **Danny DeVito** (embodying his iconic Frank Reynolds persona: *"So anyway, I started blastin'!"*):
- **Visual Identity**: Short, stout, rotund goblin-like rogue with a balding head, wild gray/black hair tufts on the sides, thick round spectacles, and an unbuttoned rumpled trenchcoat over an untucked collared shirt.
- **Weapon of Choice**: A snub-nosed chrome revolver that he clutches with twitchy, chaotic energy.
- **Signature Behavior**:
  1. **Shoots in the Air**: Points his revolver straight up into the ceiling/sky, firing loud volleys with comic muzzle flashes; moments later, falling bullets / ceiling shrapnel crash down onto the floor with target shadow reticles.
  2. **Random Misfires**: His gun goes off unpredictably while walking or idling, recoiling and sending stray ricocheting bullets bouncing across dungeon walls.

---

## 2. Visual Sprite Sheet Preview (Generated & Chroma-Ready)

Generated using **Nano Banana** on pure uniform chroma green (`#00FF00`) with zero ground lines, zero floor shadows, zero dividing grid lines, and zero text banners for clean Sprite-Forge transparency extraction:

![Blaster Frank Sprite Sheet](/home/lazycat/.gemini/antigravity-ide/brain/e9d59216-6eca-4313-a866-a558302582cb/blaster_frank_sheet_1789149818575.jpg)

### Animation Grid Breakdown (4×4 Grid, 16 Frames, 256×256 per cell)
1. **Row 0 (`idle`) — 4 frames**:
   - Short, stout idle bob, chest heaving, round spectacles glinting, stubby revolver held ready at waist level.
2. **Row 1 (`walk`) — 4 frames**:
   - Frantic, energetic waddling stride forward, arms pumping, trenchcoat tails flapping behind.
3. **Row 2 (`attack`) — 4 frames**:
   - Points revolver straight up above his head, unhinged grinning grimace, fires a loud shot into the ceiling with a bright yellow/orange muzzle flash, staggering back from the recoil.
4. **Row 3 (`death`) — 4 frames**:
   - Cartoon spiral dizzy eyes in his glasses, spins around in comic defeat, drops his smoking revolver, slips backwards, and lands flat on his back with a puff of smoke.

---

## 3. Atomic Claim Classification Matrix (VCPM Standard)

| ID | Claim Statement | Classification | Evidence / Source / Validation Path |
|---|---|---|---|
| `CLAIM-1` | `state.ts:EnemyKind` defines all monster kinds and can accommodate `"blaster_frank"` | **Verified Fact** | Inspect [`state.ts:400-425`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/state.ts#L400-L425) |
| `CLAIM-2` | Audio gun effect `sfxGun()` already exists in the engine sound system | **Verified Fact** | Inspect [`entities/projectiles.ts:797`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/projectiles.ts#L797) |
| `CLAIM-3` | Wall-ricocheting bullet physics with bounce limits and spark VFX exist in `projectiles.ts` (`fireCopBullet`) | **Verified Fact** | Inspect [`entities/projectiles.ts:785-815`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/projectiles.ts#L785-L815) |
| `CLAIM-4` | Debug screen chips enforce maximum 8 characters (`CHIP_CHARS <= 8`), allowing `"BLASTFRK"` (8 chars) | **Verified Fact** | Inspect [`gui/screens/debug.ts:137`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/gui/screens/debug.ts#L137) |
| `CLAIM-5` | Centralized monster death hook in `entities/combat.ts:killZombie` allows triggering death effects and final gun drop discharge | **Verified Fact** | Inspect [`entities/combat.ts:1115-1138`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/combat.ts#L1115-L1138) |
| `CLAIM-6` | Procedural fallback cel-painter in `render/monsters/` enables instant rendering before and alongside Sprite-Forge compilation | **Verified Fact** | Inspect [`render/sheet-painters.ts:175-185`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/render/sheet-painters.ts#L175-L185) |
| `CLAIM-7` | Random misfire timer (`z.misfireT`) can tick in `entities/zombie.ts` and fire stray ricochet bullets without desyncing AI movement | **Testable Claim** | Unit test verifying misfire countdown triggers `fireWildBullet` and resets timer with jitter |
| `CLAIM-8` | Sky-blast volley creates visual shadow reticles on the floor 0.85s prior to falling bullet ground impact | **Testable Claim** | Unit test verifying shadow marker creation, delay expiration, and damage splash radius |
| `CLAIM-9` | Pinball collision (`p.momSpeed > 0`) into Blaster Frank can trigger a guaranteed instant panic misfire | **Testable Claim** | Unit test simulating pinball player impact and asserting stray bullet launch |
| `CLAIM-10` | Reagents `ironshard` (35%) and `steelpin` (30%) fit gun/bullet monster theme and brew properly | **Verified Fact** | Inspect [`reagents.ts:27-29, 130-159`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/reagents.ts#L27-L29) |
| `ASSUMPTION-1` | Blaster Frank will appear on Floor 3+ (Factory, Tavern, or City dungeon biomes) with a spawn weight of 1.2 | **Assumption** | Risk: Difficulty pacing. Validation: Check level encounter tables in `dungeon-levels.ts`. |
| `ASSUMPTION-2` | Sky-blast falling bullets deal 2 damage to player and 3 friendly-fire damage to nearby monsters caught in the blast zone | **Assumption** | Risk: Unintended monster wiping. Validation: Tuning test in `entities/blaster-frank.test.ts`. |

*Metrics: 7 Verified Facts (58%), 3 Testable Claims (25%), 2 Assumptions (17%), 0 Unverifiable Claims (0%). Passes VCPM ≥80% Gate.*

---

## 4. Gameplay Mechanics & Combat Tuning

### Core Combat Attributes
- **Kind**: `"blaster_frank"`
- **HP**: `24` (stocky and durable)
- **Radius**: `0.42` (wider stout hit cylinder)
- **Movement Speed**: `0.95×` base speed (erratic hurried waddle)
- **Movement Policy**: `"kite"` (maintains distance to fire into the air)
- **Pain / Stagger Chance**: `0.55` (staggers momentarily, but stagger has 40% chance to trigger an accidental panic discharge!)
- **Contact Damage**: `1` damage if player runs into him directly

### Signature Ability 1: "Sky-Blasting Volley" (Shooting in the Air)
1. **Telegraph & Windup (0.50s)**:
   - Frank halts his waddle, raises his revolver straight up to the ceiling.
   - Text popup: `"BLAM!"` or `"SO ANYWAY..."` floating comic text above his head.
2. **Discharge**:
   - `sfxGun()` plays; yellow/orange muzzle sparks (`0xf59e0b`) burst at his gun barrel.
   - Recoil knocks Frank back `0.25` units.
   - 2 to 3 bullet rounds fly straight up into the ceiling.
3. **Falling Impact (0.85s delay)**:
   - Circular shadow decals / warning reticles appear on the floor around the player's current location (radius `0.75`).
   - Bullets slam down from above into the marked zones:
     - Ground dust + spark explosion (`state.vfx?.burst(..., 0xf59e0b, 12, 1.8)`).
     - Deals `2` damage to player if within radius.
     - Deals `3` damage to any other enemy caught in the crossfire (hilarious collateral chaos).

### Signature Ability 2: "Chaotic Trigger Misfires" (Gun Goes Off Randomly)
1. **Autonomous Jitter Countdown**:
   - While Frank is alive, a timer `z.misfireT` counts down (`3.0s + Math.random() * 4.0s`).
   - When it reaches zero, his gun unexpectedly fires a wild stray round in a completely random angle (`0 to 2π`).
2. **Impact & Pinball Reactions**:
   - If the pinball knight rams Frank at high speed (`p.momSpeed > 0`), the shock causes an instant 100% panic misfire!
   - If Frank takes damage from weapons, 40% chance of sudden misfire.
3. **Wild Ricocheting Bullets**:
   - Stray bullets travel at high velocity (`WARDEN_BULLET_SPEED * 0.9`).
   - Ricochets off walls up to 2 times, sparking and bouncing before dissipating.

### Death Event: "The Final Blunder"
- When reduced to 0 HP, Frank drops his smoking revolver.
- As the gun clatters against the stones, it discharges one final stray round into the dungeon ceiling with a loud bang, smoke puff, and shower of sparks.
- Drops: `ironshard` (35%), `steelpin` (30%).

---

## 5. Implementation Roadmap & File Map

### Phase 1: Sprite-Forge Preparation & Build
1. Create source folder:
   - `ThreeJS/src/game/pinball-knight/tools/sprite-forge/sources/blaster_frank-2026-09-11/alt-takes/`
   - Save master sheet and `README.md`.
2. Author prep script:
   - `ThreeJS/src/game/pinball-knight/tools/sprite-forge/prep/prep-blaster-frank.mjs`
   - Key out `#00FF00` pure chroma green.
   - Slice 4×4 grid cells (`idle`, `walk`, `attack`, `death`).
   - Generate `inbox/blaster_frank-S.png` and `inbox/blaster_frank-S.json`.
3. Compile with Sprite-Forge:
   - Run `npm run sprites` (`FORGE_PUBLISH=1 vitest run src/game/pinball-knight/tools/sprite-forge`).
   - Output published assets to `public/sprites/monsters/blaster_frank-S.png` and `.json`.

### Phase 2: Procedural Fallback Cel-Painter
- Create `ThreeJS/src/game/pinball-knight/render/monsters/blaster-frank.ts`:
  - `makeBlasterFrankPaints()`: Procedural figure rendering featuring round spectacles, balding scalp with hair tufts, rumpled trenchcoat, and snub-nosed revolver.
- Register in `render/sheet-painters.ts` and `render/monster-portrait.ts`.

### Phase 3: Projectile & Combat Engine Integration
- `entities/projectiles.ts`:
  - `fireSkyBlast(x, z, targetX, targetZ)`: Upward ceiling shot + delayed falling ground impact.
  - `fireWildBullet(x, z, angle)`: Stray ricocheting bullet.
- `entities/zombie.ts`:
  - `STATS.blaster_frank`: Radius 0.42, contactRange 5.5, windup 0.50, cooldown 2.8, ranged: true.
  - Update loop: Ticking `z.misfireT`, sky-blast execution, recoil knockback.
- `entities/combat.ts`:
  - `DMG_BY_KIND.blaster_frank = 2`.
  - Death FX in `killZombie` with weapon clatter and final smoke discharge.
- `entities/enemy-rules.ts`:
  - `MOVEMENT_BY_KIND.blaster_frank = "kite"`.
- `entities/stagger.ts`:
  - `PAIN_BY_KIND.blaster_frank = 0.55`.

### Phase 4: State, Spawning, & Bestiary
- `state.ts`: Add `"blaster_frank"` to `EnemyKind`.
- `spawn/factory.ts`: `HP_BY_KIND.blaster_frank = 24`, add factory instantiation.
- `spawn/kind-skin.ts`: `blaster_frank: { scale: 0.95 }`.
- `reagents.ts`: Drops in `ENEMY_DROPS`.
- `bestiary.ts`: Bestiary card definition (`icon: "🔫"`, label `"Blaster Frank"`).
- `render/card-styles.ts`: `KIND_STYLE.blaster_frank = "iron"`.
- `boot/sheets.ts` & `boot/manifest-inventory.ts`: Dynamic sheet inventory loader registration.
- `gui/screens/debug.ts` & `debug-panel.ts`: Debug panel spawn chip (`BLASTFRK` / "Frank").

### Phase 5: Automated Testing & Verification
- Dedicated test suite: `ThreeJS/src/game/pinball-knight/entities/blaster-frank.test.ts`:
  - Verified STATS, HP, damage, movement policy, stagger pain.
  - Test sky-blast launch, delay timer, and ground shockwave.
  - Test misfire timer countdown and random angle generation.
  - Test pinball collision panic misfire trigger.
  - Test reagent drops and procedural cel-painter outputs.
- Run full test suite: `npm run test`.

### Phase 6: Git Worktree, Push & Synology NAS Container Deployment
- Git worktree: `.worktrees/wt-blaster-frank` on branch `feat/blaster-frank`.
- Commit all changes: `git commit -m "feat(pinball-knight): add Blaster Frank Danny DeVito inspired monster"`.
- Merge to `main` and push to GitHub `origin main`.
- Redeploy container: `npm run deploy` (or `npm run deploy -- --only=pinball-knight --skip-pull`).
- Verify live container health and HTTP 200 OK.
