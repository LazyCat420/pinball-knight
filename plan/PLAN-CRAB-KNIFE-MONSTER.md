# Implementation Plan — Dapper Knife-Arm Crab Monster ("Sir Pinch-a-Lot")

**Target Project**: `pinball-knight`  
**Status**: PLAN ONLY (Awaiting User Review & Approval — DO NOT IMPLEMENT YET)  
**Render Asset**: 16-bit Pixel Art Sprite Sheet Generated & Ready  

---

## 1. Monster Concept & Visual Design

Add a brand-new melee slasher and flanking enemy to `pinball-knight`: **Dapper Knife Crab** (`EnemyKind "crab"`).

### Visual Identity
- **Aristocratic Carapace**: Vibrant crimson-orange shell with ornate scrollwork flourishes.
- **Victorian Accessories**:
  - **Classy Black Top Hat**: Tilted on its head with a silk band.
  - **Golden Monocle**: Rimmed gold lens with a tiny chain resting over its right eye, glinting during idle.
- **Lethal Knife Arms**: In place of standard crab claws, its two front chelae end in razor-sharp, gleaming steel butcher/chef blades.
- **Scuttling Multi-Legs**: 6 articulated crab legs enabling rapid sideways scuttling.

### Visual Sprite Sheet (Generated & Chroma-Ready)

Generated on pure uniform chroma green (`#00FF00`) with zero ground lines, zero borders, and zero shadows for clean Sprite-Forge transparency extraction:

![Dapper Knife Crab Monster Sprite Sheet](/home/lazycat/.gemini/antigravity-ide/brain/878e1b68-7679-4a65-bf9d-283c58c7185a/crab_knife_sheet_1788827345041.jpg)

### Animation Grid Breakdown (4×4 Grid, 16 Frames)
1. **Row 0 (`idle`)**: 4 frames facing South — Menacing posture, dapper bobbing, monocle glints on frames 3 & 4, knife arms held up and ready.
2. **Row 1 (`walk` / scuttle)**: 4 frames facing South — Classic sideways crab scuttle across dungeon stones, top hat bobbing, blades swaying in rhythm.
3. **Row 2 (`attack` / scissor-slash)**: 4 frames facing South:
   - Frame 1: Rears up, raising dual knife arms above the top hat in a dramatic telegraph.
   - Frame 2: Crosses the blades at the apex (scissor ready).
   - Frame 3: Slashes downward with a massive, gleaming white steel blade arc trail.
   - Frame 4: Sweeping follow-through slice with metal spark glint.
4. **Row 3 (`death`)**: 4 frames:
   - Frame 1: Lethal impact, shell fissures.
   - Frame 2: Carapace cracks, top hat and monocle pop off into the air.
   - Frame 3: Knife blades detach and clatter to the ground.
   - Frame 4: Crab flips on its back, cracked shell resting flat among broken accessories.

---

## 2. Gameplay Mechanics & Combat Integration

### Core Stats
- **`EnemyKind`**: `"crab"`
- **HP**: 10 (hard chitin armor)
- **Radius (`r`)**: 0.42
- **Movement Speed**: 1.1× baseline speed (quick, nimble sideways skitter)
- **Movement Policy (`enemy-rules.ts`)**: `"flank"` (circles the knight obliquely, cutting off angles rather than charging straight)
- **Attack Range**: 1.35 tiles (close-range melee slash)
- **Attack Windup**: 0.50s (rears up, raises knife blades, metallic gleam telegraph)
- **Attack Cooldown**: 2.4s
- **Pain / Stagger Chance (`stagger.ts`)**: 0.30
- **Level Spawn**: Dungeon Level 2+

### Signature Mechanic: "Dual-Knife Scissor Slash"
1. **Telegraph & Strike (`slashKnight`)**:
   - At ≤1.35 tiles, enters `windup` for 0.50s.
   - Executes a rapid cross-slash dealing **2 damage** (`CRAB_SLASH_DAMAGE = 2`).
   - Generates a visual slash trail arc (`vfx?.arc(...)`) and audio slice SFX.
2. **Laceration / Momentum Hobble**:
   - Getting caught in the scissor-slash briefly cuts the knight's momentum (`p.momSpeed *= 0.4`), forcing the player to fight from a standstill or burn a dash/potion to escape.
3. **Carapace Deflection (Rear/Flank Armor)**:
   - Integrated with `MOMENTUM_GATES.crab`: Hitting the crab's hard back shell deflects the player with a high bounce (`MOMENTUM_BOUNCE`), but frontal hits or hits during attack windup bypass the shell gate and deal direct damage.

---

## 3. Implementation Steps (Post-Approval)

### Step 1: Git Worktree Setup
- Follow sun workspace rule: create isolated worktree `.worktrees/wt-crab-monster` on branch `feat/knife-crab-monster`.

### Step 2: Sprite-Forge Pipeline & Asset Processing
1. Save source image to `sources/crab-2026-09-07/crab-S.png` and backup to `alt-takes/`.
2. Create `prep-crab.mjs` to extract and normalize the 4×4 grid (idle, walk, attack, death).
3. Run `npm run sprites` to ingest into `inbox/`, generate `public/sprites/crab-S.png` and `public/sprites/crab-S.json`.
4. Copy assets to Windows distribution directory `dist/pinball-knight-windows-x86_64/assets/sprites/`.

### Step 3: Game Engine & Combat Wiring
1. `state.ts`: Add `"crab"` to `EnemyKind`.
2. `constants/enemies.ts`: Define `CRAB_HP`, `CRAB_R`, `CRAB_SPEED_FACTOR`, `CRAB_SLASH_RANGE`, `CRAB_WINDUP`, `CRAB_COOLDOWN`, `CRAB_SLASH_DAMAGE`.
3. `entities/zombie.ts`: Add `crab` to `STATS`, melee attack routine, and sound hooks.
4. `entities/combat.ts`: Add `DMG_BY_KIND.crab = 2`, shell deflection messaging, and hit reaction.
5. `entities/enemy-rules.ts`: Register `crab: "flank"` in `MOVEMENT_BY_KIND` and `MOMENTUM_GATES.crab`.
6. `entities/stagger.ts`: Add pain stagger duration (`0.30`).
7. `spawn/factory.ts` & `spawn/kind-skin.ts`: Add spawn weights, floor unlock (floor 2+), and scaling.
8. `reagents.ts` & `bestiary.ts`: Add lore entry ("Sir Pinch-a-Lot"), monster card style (`"chitin"`), and drop table (`"chitin_shard"`, `"crab_meat"`, `"monocle_lens"`).
9. `render/monsters/crab.ts`: Build procedural cel-painter fallback (top hat, monocle, red shell, steel blades).
10. `boot/sheets.ts` & `boot/manifest-inventory.ts`: Register `"crab"` in `SheetKey` and `SHEET_KEYS`.

### Step 4: Automated Testing
1. Create `entities/crab.test.ts` testing:
   - Scissor-slash damage and range
   - Momentum hobble effect on player
   - Shell deflection gate vs front strike vulnerability
   - Windup telegraph state transitions
2. Run `lazy-sheets.test.ts` to ensure sheet inventory coverage.
3. Run `npm run sprites` and `pnpm build`.

### Step 5: Git Push & Synology NAS Deployment
1. Commit all changes on `feat/knife-crab-monster`.
2. Fast-forward merge into `main` and push to GitHub `origin/main`.
3. Run `npm run deploy` to build and redeploy the Docker container to Synology NAS.
4. Verify HTTP 200 OK on `http://10.0.0.16:8789`.
5. Notify user of test readiness for both Windows `.exe` and Web container.

---

## 4. Verification Plan

### Automated Tests
- `npx vitest run ThreeJS/src/game/pinball-knight/entities/crab.test.ts`
- `npx vitest run ThreeJS/src/game/pinball-knight/boot/lazy-sheets.test.ts`
- `npm run sprites`
- `pnpm --prefix ThreeJS build`

### Manual Verification Checklist
1. Encounter the crab on dungeon floor 2+.
2. Confirm top hat and monocle render crisply on both sprite sheet and procedural painter.
3. Observe sideways flanking movement behavior.
4. Test melee attack: verify 0.5s telegraph, scissor-slash animation, damage, and momentum cut.
5. Verify death animation: top hat and monocle fly off, blades drop.
