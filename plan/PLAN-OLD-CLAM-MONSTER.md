# Implementation Plan — Old Clam Monster with Mustache & Sunglasses ("Old Clam")

**Target Project**: `pinball-knight`  
**Status**: PLAN ONLY (Awaiting User Review & Approval — DO NOT IMPLEMENT YET)  
**Render Asset**: 16-bit Pixel Art Sprite Sheet Generated & Embedded  

---

## 1. Monster Concept & Visual Design

Add a brand-new ranged/trajectory-disruptor enemy to `pinball-knight`: **Old Clam** (`EnemyKind "clam"`).

### Visual Identity
- **Weathered Bivalve Shell**: Sturdy scalloped clam shell with aged ridges and pearlescent interior mantle.
- **Old-Timer Face**: Wrinkled grumpy grandfather clam face peeking out from the shell.
- **Signature Accessories**:
  - **Dark Sunglasses**: Sleek black shades reflecting the dungeon torches.
  - **Bushy Walrus Mustache**: Thick drooping gray mustache hanging down over the lower shell lip.
- **Living Pearl Core**: Contains a lustrous giant iridescent pearl inside its mouth that it lobs as an elastic projectile.

### Visual Sprite Sheet Preview (Generated & Chroma-Ready)

Generated on a pure, uniform chroma green (`#00FF00`) background with zero ground lines, zero borders, and zero shadows for clean Sprite-Forge transparency extraction:

![Old Clam Monster Sprite Sheet](/home/lazycat/.gemini/antigravity-ide/brain/878e1b68-7679-4a65-bf9d-283c58c7185a/clam_sheet_1788812615351.jpg)

### Animation Grid Breakdown (4×4 Grid, 16 Frames)
1. **Row 1 (`idle`)**: Clam resting on the floor, shell slightly cracked open, sunglasses and mustache peeking out, subtle breathing motion as the shell sways.
2. **Row 2 (`walk` / shuffle)**: Clam scuttles across the floor on little stubby legs/mantle, wobbling forward with shell bobbing.
3. **Row 3 (`attack`)**:
   - Frame 1: Shell snaps wide open, revealing wrinkled face, mustache, and sunglasses.
   - Frame 2: Winds back and exposes a giant glowing iridescent pearl in its mouth.
   - Frame 3: Expels / spits the pearl projectile forward with high velocity.
   - Frame 4: Snaps shell shut with a hearty "clack" recovery.
4. **Row 4 (`death`)**:
   - Frame 1: Impact hit, shell cracks violently.
   - Frame 2: Sunglasses fly off and mustache droops as head collapses.
   - Frame 3: Loose pearls spill and roll out across the floor.
   - Frame 4: Cracked, empty shell halves rest flat and motionless on the stones.

---

## 2. Gameplay Mechanics & Combat Integration

### Core Stats
- **`EnemyKind`**: `"clam"`
- **HP**: 8 (sturdy mollusk shell)
- **Radius (`r`)**: 0.38
- **Movement Speed**: 0.85× baseline zombie speed (slow, deliberate scuttle)
- **Movement Policy (`enemy-rules.ts`)**: `"sniper"` or `"skirmish"` (maintains distance from the knight to line up pearl shots)
- **Attack Range**: 7.0 tiles
- **Attack Windup**: 0.65s (shell opens wide, pearl glows in mouth telegraph)
- **Attack Cooldown**: 3.2s
- **Pain / Stagger Chance (`stagger.ts`)**: 0.35

### Signature Mechanic: "Pearl Deflection & Trajectory Screw"
1. **Pearl Projectile Spawning (`spitPearl`)**:
   - Clam launches a shimmering, iridescent pearl projectile (`kind: "pearl"`) at `CLAM_PEARL_SPEED = 7.5` u/s.
   - 3D sphere mesh with glowing pearlescent material and subtle highlight.
   - The pearl can ricochet off dungeon masonry walls up to 2 times (`pr.bounces = 2`), pinging around narrow corridors like a billiard ball.
2. **Player Contact & Trajectory Deflection**:
   - When a pearl hits the Pinball Knight:
     - Inflicts **slight damage** (`CLAM_PEARL_DAMAGE = 1`).
     - **Trajectory Disruption (Pinball Deflection)**: Computes the outward normal vector from the pearl to the player:
       ```ts
       const dx = p.x - pr.x;
       const dz = p.z - pr.z;
       const dist = Math.hypot(dx, dz) || 1;
       const nx = dx / dist;
       const nz = dz / dist;
       const curSpeed = p.momSpeed || 0;
       p.momX = nx;
       p.momZ = nz;
       p.momSpeed = Math.max(curSpeed * 1.1, CLAM_PEARL_BOUNCE_SPEED); // e.g. 12.0 u/s
       p.bounceCombo = (p.bounceCombo || 0) + 1;
       ```
     - Instantly overrides the knight's momentum vector, bouncing the knight away at high speed and throwing off whatever path or flipper trajectory they were aiming for!
     - Visual Juice: Shimmering pearl spark burst (`state.vfx?.burst(..., 0xf1f5f9, 12, 1.6)`).
     - Audio: Bumper chime sound effect (`sfxTarget(1.2)`).

### Shell Defense State Machine ("Clack & Guard")
- **Closed Shell**: While idle or walking, the clam's scalloped shell covers its body. Direct frontal melee or ram attacks suffer 70% damage reduction or deflect the knight with a metallic shell clack.
- **Open Shell**: During the 0.65s attack windup, the shell swings wide open, exposing its tender wrinkled face and vulnerable pearl core to full damage.

### Loot & Economy (`reagents.ts`)
- Thematic coastal/mollusk drops:
  - `pearl: 0.75` (valuable iridescent gemstone for crafting & score)
  - `chitin: 0.40` (scalloped shell fragments)

---

## 3. Clean Worktree & Zero-Conflict Architecture

- Branch from latest `origin/main` (`49d88560`).
- Dedicated Git worktree: `.worktrees/wt-old-clam` on branch `feat/old-clam-monster`.
- Isolated new files:
  - `ThreeJS/src/game/pinball-knight/render/monsters/clam.ts` (cel-painter fallback)
  - `ThreeJS/src/game/pinball-knight/tools/sprite-forge/prep/prep-clam.mjs` (prep script)
  - `ThreeJS/src/game/pinball-knight/entities/clam.test.ts` (unit tests)
  - `ThreeJS/public/sprites/clam-S.json` and `clam-S.png` (baked sprite assets)
- Shared registry edits strictly append entries to compile-enforced tables.

---

## 4. Architecture & File Touchpoints

### A. Core Registries & Types
1. **[state.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/state.ts)**:
   - Add `"clam"` to `EnemyKind` union.
2. **[items.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/items.ts)**:
   - Add `"pearl"` to `ProjectileKind` union.
3. **[constants/enemies.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/constants/enemies.ts)**:
   - Add `CLAM_HP = 8`, `CLAM_R = 0.38`, `CLAM_SPEED_FACTOR = 0.85`, `CLAM_FIRE_RANGE = 7.0`, `CLAM_WINDUP = 0.65`, `CLAM_COOLDOWN = 3.2`, `CLAM_PEARL_DAMAGE = 1`, `CLAM_PEARL_SPEED = 7.5`, `CLAM_PEARL_BOUNCE_SPEED = 12.0`, `CLAM_PEARL_BOUNCES = 2`, `CLAM_RATIO = 16`, `CLAM_FROM_LEVEL = 2`.
4. **[entities/projectiles.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/projectiles.ts)**:
   - Add `pearlAssets()` returning iridescent sphere geometry and material.
   - Add `export function spitPearl(x: number, z: number, dx: number, dz: number): void`.
   - In hostile collision check (`updateProjectiles`):
     - Check `pr.kind === "pearl"`, apply `hitPlayerRanged(pr.damage, pr.x, pr.z)`.
     - Apply trajectory bounce deflection to `p.momX`, `p.momZ`, `p.momSpeed`, `p.bounceCombo`.
     - Trigger pearl shimmer VFX burst and `sfxTarget()`.
5. **[entities/zombie.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/zombie.ts)**:
   - Add `clam` to `KIND_DEFAULTS` (`ranged: true`, `bodyR: CLAM_R`, `windup: CLAM_WINDUP`, `cooldown: CLAM_COOLDOWN`, `contactRange: CLAM_FIRE_RANGE`).
   - In attack release dispatch: add `else if (z.kind === "clam") spitPearl(z.x, z.z, ux, uz);`.
6. **[entities/enemy-rules.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/enemy-rules.ts)**:
   - Set movement policy: `clam: "sniper"`.
   - Add `MOMENTUM_GATES.clam` entry describing the closed-shell defense and pearl deflection behavior.
7. **[entities/stagger.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/stagger.ts)**:
   - Set stagger resistance: `clam: 0.35`.
8. **[spawn/factory.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/spawn/factory.ts)**:
   - Add `clam: CLAM_HP` to `MOB_HP`.
   - Add spawn case: `makeSkinned("clam", x, z, baseSpeed * CLAM_SPEED_FACTOR)`.
9. **[spawn/kind-skin.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/spawn/kind-skin.ts)**:
   - Set scale: `clam: { scale: 1.15 }`.
10. **[boot/sheets.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/boot/sheets.ts)**:
    - Add `"clam"` to `EnemySheetKey`.
    - Add `"clam"` to lazy sheets array and map: `clam: "clam"`.
11. **[boot/manifest-inventory.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/boot/manifest-inventory.ts)**:
    - Register `clam: ["S"]`.
12. **[boot/lazy-sheets.test.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/boot/lazy-sheets.test.ts)**:
    - Add `"clam"` to `ALL_KEYS`.
13. **[bestiary.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/bestiary.ts)** & **[reagents.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/reagents.ts)**:
    - Add bestiary entry: `"Old Clam"`, icon `🦪`, blurb `"Grumpy geriatric bivalve with sunglasses and mustache that spits bouncy trajectory-deflecting pearls"`.
    - Add reagents drops (`pearl`, `chitin`).
14. **[render/card-styles.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/render/card-styles.ts)** & **[render/monster-portrait.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/render/monster-portrait.ts)**:
    - Register clam card style and monster portrait.
15. **[render/sheet-painters.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/render/sheet-painters.ts)**:
    - Add procedural cel-painter fallback for clam.

---

## 5. Verification Plan

### Automated Tests
- `pnpm test ThreeJS/src/game/pinball-knight/entities/clam.test.ts`:
  - Unit test verifying clam spawning, stats, and states.
  - Unit test verifying `spitPearl` spawning, life, and wall ricochet.
  - Unit test verifying pearl player collision: slight damage applied, deflection vector applied to `player.momX` / `player.momZ`, and speed increased to `CLAM_PEARL_BOUNCE_SPEED`.
- `pnpm test ThreeJS/src/game/pinball-knight/boot/lazy-sheets.test.ts`:
  - Confirms lazy sheet manifest registry passes.
- Full project test suite:
  - `pnpm test` (verifies all 340+ test files remain green).
- Production build validation:
  - `pnpm run build` in `ThreeJS/`.

### Deployment & Distribution
- Commit changes on `feat/old-clam-monster`, merge cleanly to `main`, and push to GitHub.
- Copy built sprite assets (`clam-S.json`, `clam-S.png`) to `dist/pinball-knight-windows-x86_64/assets/sprites/`.
- Redeploy Synology NAS container: `npm run deploy` from repository root.
- Proactively notify user that both the Windows executable and web container at `http://10.0.0.16:8789` are ready for testing.
