# Implementation Plan — 1960s Cartoon Zippo Lighter Monster ("Pyro Zippo")

**Target Project**: `pinball-knight`  
**Status**: PLAN ONLY (Awaiting User Review & Approval — DO NOT IMPLEMENT YET)  
**Render Asset**: 16-bit 1960s Rubber-Hose Cartoon Sprite Sheet Generated & Embedded  

---

## 1. Monster Identity & Visual Design

Add a new ranged/area denial enemy to `pinball-knight`: **Pyro Zippo** (`EnemyKind "zippo"`).

The creature is an animated vintage 1960s chrome flip-top Zippo lighter come to life in classic rubber-hose cartoon style.
- **Body & Lid**: Shiny chrome-silver rectangular lighter case with a hinged lid that flips open.
- **Limbs**: Skinny cartoon noodle arms with 4-fingered white rubber-hose gloves, and skinny legs with rounded cartoon shoes.
- **Living Flame Face**: The lit fire burning at the top of the chimney wick IS the creature's expressive cartoon face, featuring vintage 1960s cartoon pie/oval eyes and a grinning mouth flickering playfully within the flames.
- **Attack Signature**: Pops its lid wide open, pulls out a vintage glass liquor bottle / moonshine jug with a cork, chugs the alcohol down into its wick reservoir, puffs up red-hot, and then **exhales / blows a searing cone of fire breath** toward the knight.

### Visual Sprite Sheet Preview (Generated & Chroma-Ready)

Generated on a pure, uniform chroma green (`#00FF00`) background with zero ground lines, zero borders, and zero shadows for artifact-free transparency extraction:

![1960s Cartoon Zippo Lighter Monster Sprite Sheet](/home/lazycat/.gemini/antigravity-ide/brain/a5065001-71bf-4a83-a63d-388b09e8dc16/zippo_lighter_sheet_1788769694702.jpg)

### Animation Grid Breakdown (4×4 Grid, 16 Frames)
1. **Row 1 (`idle`)**: Bouncing gently in place, lid tilted open, cartoon flame face smiling and looking around, white gloved hands resting on hips.
2. **Row 2 (`walk`)**: High-stepping rubber-hose cartoon stroll, noodle legs walking forward, lid bobbing up and down.
3. **Row 3 (`attack`)**:
   - Frame 1: Lighter lid snaps open wide, reaches behind back and pulls out a glass alcohol bottle.
   - Frame 2: Uncorks bottle and tips it back, chugging down the alcohol into the wick.
   - Frame 3: Flame face flares up red-hot, cheeks puffed full of fuel.
   - Frame 4: Exhales forcefully, blowing a roaring stream of flame projectiles forward.
4. **Row 4 (`death`)**:
   - Frame 1: Struck, flame face gets dizzy cartoon 'X' eyes with a puff of gray smoke.
   - Frame 2: Flame face shrinks into a tiny wisp.
   - Frame 3: Lighter body sits down limp on its bottom.
   - Frame 4: Lighter body tips flat on its back, lid loose, completely snuffed out.

---

## 2. Gameplay Mechanics & Combat Integration

### Core Stats
- **`EnemyKind`**: `"zippo"`
- **HP**: 6 (sturdy chrome steel casing)
- **Radius (`r`)**: 0.36
- **Movement Speed**: 0.90× baseline zombie speed (bouncy, rhythm-stepped cadence)
- **Movement Policy (`enemy-rules.ts`)**: `"kite"` or `"strafe-kite"` (maintains ~3.5–5.0 tiles distance to line up fire breath)
- **Attack Range**: 5.5 tiles
- **Attack Windup**: 0.55s (drinking alcohol animation + flame flaring up telegraph)
- **Attack Cooldown**: 2.2s (recovering after the fire exhale)
- **Base Fire Damage**: 1 per flame projectile + 1 burn damage tick after 1.0s (`burnT = 1.8s`)
- **Pain / Stagger Chance (`stagger.ts`)**: 0.50

### Signature Move: "Firewater Chug & Flame Breath"
1. **Telegraph / Windup (0.55s)**:
   - When in range and line of sight, the Zippo stops and begins drinking from its alcohol bottle.
   - Visual Tell: Fiery spark burst at its wick (`state.vfx?.sparks(...)`), flame turns bright orange/blue.
   - Sound: Liquid chugging / cork pop sound effect + building flame roar.
2. **Flamethrower Blast (`launchZippoFlameBreath`)**:
   - Fires 4–5 flaming plasma projectiles (`"zippo_flame"`) in an expanding fan cone (-0.22, -0.10, 0, +0.10, +0.22 rad) moving at speed 7.2 u/s.
   - Each fireball creates glowing ember particles and sizzles along its trajectory.
   - On impact with the knight: inflicts 1 damage, knocks the knight back slightly, and sets them burning (`p.burnT = 1.8s`).
   - On impact with walls: bursts into bright orange sparks and smoke.

### Loot & Economy (`reagents.ts`)
- Thematic drops from a metallic lighter with flint and fuel:
  - `brimstone: 0.35` (combustible sulfur / fire reagent)
  - `bone_splinter: 0.20` (flint striker pieces)

---

## 3. Clean Worktree & Zero-Conflict Merge Strategy

> [!IMPORTANT]
> **Zero Merge Conflict Protocol**:
> To ensure flawless parallel development and prevent any conflicts with existing worktrees (`wt-shared-author-release`, `wt-crawling-hand-monster`, etc.):
> 1. Branch from latest `origin/main` (`07be9623`), which already cleanly incorporates `fix/shared-author-release`, `fix/intro-tavern-loading`, Buddha boss, Fry fix, and Crawling Hand.
> 2. Dedicated worktree: `.worktrees/wt-zippo-lighter-monster` on branch `feat/zippo-lighter-monster`.
> 3. New files are completely isolated:
>    - `ThreeJS/src/game/pinball-knight/render/monsters/zippo.ts` (cel-painter)
>    - `ThreeJS/src/game/pinball-knight/tools/sprite-forge/prep/prep-zippo.mjs` (prep script)
>    - `ThreeJS/src/game/pinball-knight/entities/zippo.test.ts` (unit tests)
>    - `ThreeJS/public/sprites/zippo-S.json` and `zippo-S.png` (built assets)
> 4. Shared registry edits strictly append entries at the bottom of expansion sections in the 9 compile-enforced tables without reordering or modifying existing keys.
> 5. Merges to `origin/main` or integration worktrees will be clean three-way merges with 0 textual or semantic conflicts.

---

## 4. Architecture & File Touchpoints

### A. Core Registries & Types (The 9 Compile-Enforced Tables)
1. **[state.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/state.ts)**:
   - Add `"zippo"` to `EnemyKind` union.
2. **[constants/enemies.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/constants/enemies.ts)**:
   - Define `ZIPPO_HP = 6`, `ZIPPO_R = 0.36`, `ZIPPO_SPEED_FACTOR = 0.90`, `ZIPPO_FIRE_RANGE = 5.5`, `ZIPPO_WINDUP = 0.55`, `ZIPPO_COOLDOWN = 2.2`, `ZIPPO_DAMAGE = 1`, `ZIPPO_FLAME_SPEED = 7.2`, `ZIPPO_RATIO = 16`, `ZIPPO_FROM_LEVEL = 2`.
3. **[entities/zombie.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/zombie.ts)**:
   - Add `zippo` to `STATS` table (`ranged: true`, `bodyR: ZIPPO_R`, `windup: ZIPPO_WINDUP`, etc.).
   - In attack dispatch: add `else if (z.kind === "zippo") launchZippoFlameBreath(z.x, z.z, ux, uz);`.
4. **[spawn/factory.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/spawn/factory.ts)**:
   - Add `zippo: ZIPPO_HP` in `HP_BY_KIND`.
   - Add `case "zippo": return makeSkinned("zippo", x, z, baseSpeed * ZIPPO_SPEED_FACTOR);` in `spawnKind()`.
5. **[reagents.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/reagents.ts)**:
   - Add `zippo: [{ reagent: "brimstone", p: 0.35 }, { reagent: "bone_splinter", p: 0.20 }]` in `ENEMY_DROPS`.
6. **[entities/combat.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/combat.ts)**:
   - Add `zippo: ZIPPO_DAMAGE` in `DMG_BY_KIND`.
   - On death: spawn fire spark and smoke burst (`state.vfx?.burst(...)`, `state.vfx?.smoke(...)`).
7. **[entities/enemy-rules.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/enemy-rules.ts)**:
   - Add `zippo: "kite"` in `MOVEMENT_BY_KIND`.
8. **[entities/stagger.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/stagger.ts)**:
   - Add `zippo: 0.50` in `PAIN_BY_KIND`.
9. **[bestiary.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/bestiary.ts)**:
   - Add entry for `"zippo"`: `label: "Pyro Zippo"`, `icon: "🔥"`, `blurb: "1960s cartoon flip-top lighter with a dancing flame face. Chugs alcohol to fuel intense flamethrower breath."`.
10. **[render/card-styles.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/render/card-styles.ts)**:
    - Add `zippo: "fire"` in `KIND_STYLE`.
11. **[render/monster-portrait.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/render/monster-portrait.ts)**:
    - Add `zippo: { paints: makeZippoPaints }` in `KIND_PORTRAIT`.

### B. Projectiles & Weapons
12. **[items.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/items.ts)**:
    - Add `"zippo_flame"` to `ProjectileKind`.
13. **[entities/projectiles.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/projectiles.ts)**:
    - Implement `zippoFlameAssets()`: orange-yellow glowing sphere material + geometry.
    - Implement `launchZippoFlameBreath(x, z, dx, dz)`: 5-fireball fan with ember particles.
    - In projectile collision / update loop: handle `"zippo_flame"` hitting player (deals damage, applies burn ticks) and hitting walls (ember splash).

### C. Sprite Forge, Manifests & Cel Painter
14. **[tools/sprite-forge/prep/prep-zippo.mjs](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/tools/sprite-forge/prep/prep-zippo.mjs)**:
    - Ingest the generated 16-frame sheet from `brain/a5065001-71bf-4a83-a63d-388b09e8dc16/zippo_lighter_sheet_1788769694702.jpg`.
    - Key out `#00FF00` pure green to clean alpha.
    - Write to `sources/zippo-2026-09-07/` and `inbox/zippo-S.json` + `inbox/zippo-S.png`.
15. **Compile sprites**:
    - Run `node prep-zippo.mjs` and `npm run sprites` to produce `public/sprites/zippo-S.json` and `public/sprites/zippo-S.png`.
16. **[boot/manifest-inventory.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/boot/manifest-inventory.ts)**:
    - Add `zippo: ["S"]` to `IMPORTED_FACINGS`.
17. **[boot/sheets.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/boot/sheets.ts)**:
    - Register `zippo` in `SheetKey` and `IMPORTED_ART`.
18. **[render/monsters/zippo.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/render/monsters/zippo.ts)**:
    - Author procedural fallback cel-painter (chrome body, open flip lid, white cartoon gloves, dancing flame face, bottle chug, and collapse death).
19. **[render/sheet-painters.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/render/sheet-painters.ts)**:
    - Register `zippo: makeZippoPaints` in `SHEET_PAINTERS`.

### D. Debug UI
20. **[gui/screens/debug.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/gui/screens/debug.ts)** and **[debug-panel.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/debug-panel.ts)**:
    - Add `LABEL_OVERRIDE.zippo = "Zippo"` and `"🔥 Zippo"` spawn button in enemy spawner grid.

---

## 5. Verification Plan

### Automated Tests
1. **New Dedicated Vitest Suite**: `ThreeJS/src/game/pinball-knight/entities/zippo.test.ts`:
   - Verify `zippo` presence and valid values in all 9 compile-enforced `Record<EnemyKind, ...>` tables.
   - Verify `launchZippoFlameBreath` fires 5 projectiles in a fan with correct speed and lifespan.
   - Verify `zippo_flame` damages player, triggers burn timer, and spawns fiery embers.
   - Verify sprite sheet manifest `public/sprites/zippo-S.json` exists with all 4 clips (`idle`, `walk`, `attack`, `death`).
   - Verify procedural fallback painter compiles and renders cleanly.
2. **Sprite Contract Suite**:
   - `npm run sprites` (`FORGE_PUBLISH=1 vitest run src/game/pinball-knight/tools/sprite-forge`).
3. **Full TypeScript Typecheck**:
   - `npx tsc --noEmit` (proves all 9 `Record<EnemyKind, ...>` tables and kinds are 100% complete).
4. **Existing Regression Suites**:
   - `npx vitest run src/game/pinball-knight/entities/milkshake.test.ts`
   - `npx vitest run src/game/pinball-knight/entities/crawling-hand.test.ts`

### Build & Manual Verification
- Run `npm run build:threejs`.
- Push to GitHub and deploy to Synology NAS: `npm run deploy`.
- Test on Web (`http://10.0.0.16:8789`) and native Windows executable (`dist/pinball-knight-windows-x86_64/pk-game.exe`):
  - Open debug menu (`` ` ``).
  - Click `🔥 Zippo` to spawn the lighter monster.
  - Observe 60s cartoon animations: bouncy idle/walk, popping open and drinking alcohol bottle, and blasting fire breath.

---

## 6. Open Questions for the User

1. **In-Game Display Name**:
   - Option A: **"Pyro Zippo"** (Charming retro cartoon feel)
   - Option B: **"Zippo Lighter"** (Literal and straightforward)
   - Option C: **"Firewater Zippo"** (Highlights the alcohol-drinking gimmick)
2. **Fire Breath Mechanics**:
   - Should the fire breath be a **5-shot fan burst** (shotgun style), or a **rapid continuous stream** (like a stream of 6 consecutive fireballs while walking)?
3. **Alcohol Bottle Appearance**:
   - In the generated art we have a vintage glass bottle labeled "ALCHO" with cork stopper. Would you like a small dropped "empty bottle" item left on the floor after it drinks, or simply a visual drinking animation?
