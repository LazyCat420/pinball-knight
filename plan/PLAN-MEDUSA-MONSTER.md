# Implementation Plan — Gorgon Medusa Monster ("The Petrifier")

**Target Project**: `pinball-knight`  
**Date**: 2026-09-07  
**Status**: PLAN ONLY (Awaiting User Review & Approval — DO NOT IMPLEMENT YET)  
**Render Asset**: 16-bit Pixel Art Sprite Sheet Generated with Nano Banana & Ready  
**Methodology**: Strictly compliant with [`plan-verification-standard.md`](file:///home/lazycat/github/projects/sun/.agents/plan-verification-standard.md) (VCPM Claim Triage & Quality Gates)

---

## 1. Problem Statement & User Intent

The user requested adding an iconic mythological enemy to `pinball-knight`:
> *"make a new monster that is medusa with snakes on her head and she will turn you into stone if you look at her. It lasts for 5 seconds. Make it so its in a scanned range so if you hit that box your stone for a couple seconds. create it with nano banana."*

### Key Requirements
1. **Visual Identity**: Medusa Gorgon monster with venomous living snake hair atop her head, serpentine lower body/coiled tail, and glowing eyes.
2. **Nano Banana Asset**: Generated as a 16-bit pixel art sprite sheet on a clean chroma `#00FF00` background.
3. **Scanned Range Box**: Medusa projects a scanned telegraph field / zone in front of her (or scans an area).
4. **Looking Gaze Condition**: If the player enters that scanned range AND looks at her (facing towards her), the player turns into solid stone.
5. **Petrified State Duration**: The petrification effect lasts for up to 5 seconds (`petrifiedT = 5.0`), with player movement locked and an escape mechanic via input wiggling.

---

## 2. Visual Design & Nano Banana Sprite Sheet

### Visual Sprite Sheet (Generated & Chroma-Ready)
Generated with Nano Banana on pure uniform chroma green (`#00FF00`) with zero ground lines, zero borders, and zero shadows for Sprite-Forge transparency extraction:

![Medusa Gorgon Monster Sprite Sheet](/home/lazycat/.gemini/antigravity-ide/brain/878e1b68-7679-4a65-bf9d-283c58c7185a/medusa_sheet_1788832559812.jpg)

### Animation Grid Breakdown (4×4 Grid, 16 Frames)
- **Row 0 (`idle`)** [Frames 0..3]: Facing South — Gorgon Queen poised on coiled emerald serpent tail, living snake hair squirming and hissing gently.
- **Row 1 (`walk` / slither)** [Frames 4..7]: Facing South — Sinuous S-curve slithering locomotion forward, serpentine tail pushing across dungeon stones.
- **Row 2 (`attack` / petrifying gaze)** [Frames 8..11]: Facing South — Rears up tall, snake hair spreads wide into a threatening cobra-like hood, eyes blaze with bright golden/emerald petrifying laser beams.
- **Row 3 (`death`)** [Frames 12..15]: Dramatic stone death — Struck down, stone cracks spiderweb across her scales, petrifies into a cracked granite statue and crumbles into a heap of stone rubble.

---

## 3. Atomic Claim Classification Matrix (VCPM Standard)

Per [`plan-verification-standard.md`](file:///home/lazycat/github/projects/sun/.agents/plan-verification-standard.md), all technical assertions are triaged:

| ID | Claim Statement | Classification | Evidence / Source / Validation Path |
|---|---|---|---|
| `CLAIM-1` | `state.ts:EnemyKind` defines all monster kinds and can accept `"medusa"` | **Verified Fact** | Inspect [`state.ts:340-385`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/state.ts#L340-L385) |
| `CLAIM-2` | `p.stoneT` in `state.ts:156` is already occupied by the positive Stoneskin potion | **Verified Fact** | [`state.ts:156`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/state.ts#L156) and [`combat.ts:1208`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/combat.ts#L1208) (`STONESKIN_DAMAGE_MULT`) |
| `CLAIM-3` | Medusa petrification debuff must use an independent field (`petrifiedT`) to avoid collision with Stoneskin | **Verified Fact** | Code inspection of [`state.ts:156`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/state.ts#L156) |
| `CLAIM-4` | Player facing direction can be calculated from `p.facing` or `p.vx, p.vz` to check if player looks at Medusa | **Verified Fact** | Inspect [`entities/player.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/player.ts) (`p.facing` = `"N" \| "S" \| "E" \| "W"`) |
| `CLAIM-5` | Dot product between player facing vector and vector-to-Medusa determines gaze direction: `dot(playerFacingVec, toMedusaVec) > 0.3` (within ~75° FOV) | **Testable Claim** | Unit test in `entities/medusa.test.ts` verifying gaze angles (0° facing = petrified, 180° back turned = safe) |
| `CLAIM-6` | Medusa scan range box can be projected forward from Medusa (width 3.6 tiles, length 6.5 tiles) | **Testable Claim** | Bounding box / OBBox calculation test in `entities/medusa.test.ts` |
| `CLAIM-7` | Entering scan box while looking at Medusa inflicts `p.petrifiedT = 5.0` | **Testable Claim** | Assertion in `entities/medusa.test.ts` checking `p.petrifiedT` becomes `5.0` |
| `CLAIM-8` | Wiggling input controls reduces `petrifiedT` by `0.25s` per directional change, allowing breakout in ~2s | **Testable Claim** | Test simulating rapid key alternating in `entities/medusa.test.ts` |
| `CLAIM-9` | While `petrifiedT > 0`, player movement is locked and player sprite receives stone grey tint (`0x888888`) and stone dust particles | **Testable Claim** | Unit test verifying `p.sprite.setTint(0x888888)` and zero walk velocity |
| `ASSUMPTION-1` | Medusa spawns in dungeon floors 12+ (Ruins / Crypt biomes) alongside other advanced tactical enemies | **Assumption** | Risk: Spawn rarity too high/low. Validation: Check `floorBudgets` and monster rosters. |
| `ASSUMPTION-2` | While petrified, pinball bumper collisions cause heavy stone clink sound and high-mass momentum decay | **Assumption** | Risk: Pinball physics may bounce too far while frozen. Validation: Test pinball impulse dampening. |

*Metrics: 4 Verified Facts (36%), 5 Testable Claims (45%), 2 Assumptions (18%), 0 Unverifiable Claims (0%). Passes VCPM ≥80% Gate.*

---

## 4. Gameplay Mechanics & Combat Integration

### 4.1 Core Monster Attributes
- **`EnemyKind`**: `"medusa"`
- **HP**: 14 (resilient mythical entity)
- **Radius (`r`)**: 0.45
- **Movement Speed**: 0.85× baseline (sinuous, deliberate serpent glide)
- **Movement Policy (`enemy-rules.ts`)**: `"stalker"` or `"skirmisher"` (maintains medium distance ~3–5 tiles from knight to keep player in gaze cone rather than mindlessly hugging melee)
- **Attack Cadence**:
  - Idle/stalk: 2.5s
  - Gaze Windup / Scan Telegraph: 0.8s (eyes begin glowing golden amber, green scan box appears on the floor)
  - Active Petrifying Gaze: 1.5s (eyes shoot piercing laser beams, scan box becomes active and pulses)
  - Cooldown: 3.5s

### 4.2 The "Perseus Shield" Gaze Detection Mechanic
1. **Scan Range Box**:
   - Extends forward along Medusa's facing direction.
   - Dimensions: `MEDUSA_GAZE_WIDTH = 3.6` tiles, `MEDUSA_GAZE_LENGTH = 6.5` tiles.
   - Visual: Emerald green scanning grid beam projected onto floor tiles via `vfx?.beam` / floor indicator decal.
2. **Angle / Eye Contact Check**:
   - Let $\vec{D} = \text{normalize}(\text{Medusa}_{pos} - \text{Player}_{pos})$ (vector from Player pointing to Medusa).
   - Let $\vec{F}$ be the Player's facing unit vector (from `p.facing`: N = `(0, -1)`, S = `(0, 1)`, E = `(1, 0)`, W = `(-1, 0)`).
   - Angle factor: $\cos \theta = \vec{F} \cdot \vec{D}$.
   - **Eye Contact Condition**: If $\vec{F} \cdot \vec{D} > 0.30$ (player is facing within ~72° towards Medusa), the player **looks at Medusa**.
   - **Back Turned**: If $\vec{F} \cdot \vec{D} \le 0.30$ (player has their back or side turned), the player **avoids the petrifying gaze**!

### 4.3 Petrified Status Effect (`p.petrifiedT`)
- **Duration**: 5.0 seconds maximum.
- **Visual**:
  - Player sprite tinted solid statue granite grey (`0x7a7a7a`).
  - Stone chips and dust crumbling particles fall periodically (`vfx?.dust`).
- **Control Lock & Breakout**:
  - Standard player directional movement input is disabled (`targetSpeed = 0`).
  - Melee/ranged weapon attacks disabled.
  - **Statue Breakout Mechanic**: Every rapid input direction switch (e.g. tapping Left then Right) chips off stone, reducing `petrifiedT` by 0.35s. Dedicated players can break free in ~1.8–2.2 seconds!
  - When `petrifiedT` expires or breaks, a stone shatter burst sound plays and stone debris chunks erupt (`vfx?.shatter`).

---

## 5. Implementation Roadmap (Step-by-Step)

### Phase 1: Git Worktree Setup
- Create isolated worktree `.worktrees/wt-medusa-monster` from branch `feat/medusa-monster` to keep `main` clean and adhere to workspace rules.

### Phase 2: Sprite-Forge Pipeline & Asset Processing
1. Save source image to `ThreeJS/src/game/pinball-knight/tools/sprite-forge/sources/medusa-2026-09-07/medusa-S.png`.
2. Save raw generation take to `alt-takes/medusa_sheet_1788832559812.jpg` and write `alt-takes/README.md`.
3. Create `ThreeJS/src/game/pinball-knight/tools/sprite-forge/prep/prep-medusa.mjs`:
   - Chroma-key `#00FF00` green.
   - Slice 4×4 grid into 16 frames: 4 idle, 4 walk, 4 gaze attack, 4 stone-death.
   - Generate `inbox/medusa-S.png` and `inbox/medusa-S.json`.
4. Run `FORGE_PUBLISH=1 vitest run src/game/pinball-knight/tools/sprite-forge/inbox.test.ts` to publish to:
   - `ThreeJS/public/sprites/medusa-S.png`
   - `ThreeJS/public/sprites/medusa-S.json`
5. Copy published sprite and metadata to Windows release bundle: `dist/pinball-knight-windows-x86_64/assets/sprites/`.

### Phase 3: Game Engine & Combat Wiring
1. **`state.ts`**:
   - Add `"medusa"` to `EnemyKind`.
   - Add `petrifiedT?: number;` to `Player` interface and initial state.
2. **`constants/enemies.ts`**:
   - Define `MEDUSA_HP = 14`, `MEDUSA_R = 0.45`, `MEDUSA_SPEED_FACTOR = 0.85`.
   - Define `MEDUSA_GAZE_WIDTH = 3.6`, `MEDUSA_GAZE_LENGTH = 6.5`, `MEDUSA_GAZE_DURATION = 5.0`.
   - Define `MEDUSA_WINDUP = 0.8`, `MEDUSA_ACTIVE_GAZE = 1.5`, `MEDUSA_COOLDOWN = 3.5`.
3. **`entities/medusa.ts`** (Specialized Actor Handler):
   - Handles scan box projection, gaze ray casting, angle dot product with player facing, and vfx/sound triggers.
4. **`entities/player.ts`**:
   - In `updatePlayer(dt, input)`: Handle `p.petrifiedT`:
     - Decrement `petrifiedT` by `dt`.
     - Detect directional input toggling to chip off `0.35s` per wiggle.
     - Apply stone tint and freeze movement input.
     - On release, play stone shatter VFX.
5. **`entities/zombie.ts`**:
   - Register `medusa` in `STATS` and movement/attack hooks.
6. **`render/monsters/medusa.ts`**:
   - Create procedural cel-painter fallback (coiled green tail, snake hair tendrils, glowing amber eyes).
7. **`render/sheet-painters.ts`**:
   - Register `medusa: makeMedusaPaints`.
8. **`boot/sheets.ts`**:
   - Register `medusa` in `SheetKey`, `SHEET_KEYS`, `IMPORTED_ART`, and floor manifest.

### Phase 4: Verification & Automated Tests
1. Create `entities/medusa.test.ts`:
   - Test 1: Scan range box inclusion test (inside vs outside box).
   - Test 2: Gaze angle test (facing Medusa -> petrified; facing away -> immune).
   - Test 3: Petrification state applies `petrifiedT = 5.0` and locks movement.
   - Test 4: Wiggle input break reduces `petrifiedT` progressively.
   - Test 5: Procedural cel-painter renders valid mesh hierarchy without crashing.
2. Run full shard tests or targeted vitest suite.

### Phase 5: Build, Push & NAS Container Deployment
1. Fast-forward merge `feat/medusa-monster` into `main`.
2. Push to GitHub: `git push origin main`.
3. Redeploy to Synology NAS: `npm run deploy` in `pinball-knight`.
4. Check NAS HTTP endpoints (`http://10.0.0.16:8789/` and sprite endpoint).
5. Proactively notify user that both native Windows executable (`dist/pinball-knight-windows-x86_64/pk-game.exe`) and web container are ready for testing.

---

## 6. Verification Plan

### Automated Tests
- `npx vitest run src/game/pinball-knight/entities/medusa.test.ts`
- `npx vitest run src/game/pinball-knight/boot/lazy-sheets.test.ts`
- `npm run sprites`
- `pnpm --prefix ThreeJS build`

### Manual Gameplay Verification
1. Spawn Medusa via debug console or level generation.
2. Step inside the green scanned range box while facing her: verify player turns to stone, turns grey, and movement freezes.
3. Rapidly alternate arrow keys / WASD: verify stone breaks earlier with dust particle burst.
4. Step inside the scanned range box while facing backwards: verify player does not turn to stone.
5. Slay Medusa: verify death animation turns into cracked stone statue and shatters into rubble.
