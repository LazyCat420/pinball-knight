# Implementation Plan — Doppelgänger Boss (Evil Mirror of Pinball Knight)

## 1. Executive Summary & Character Concept

### Core Concept
The **Doppelgänger** is the corrupted, dark reflection of Pinball Knight. Born from the shattered mirrors and arcane dimensional rifts of the dungeon, the Doppelgänger wears twisted obsidian/abyssal-steel armor and wields an evil jagged rune blade.

Most importantly, **he fights like Pinball Knight**:
- He rolls into a high-speed, ricocheting dark pinball to slam the player against walls.
- He swings an ominous greatsword that cleaves through the arena and emits dark shockwaves.
- In Phase 2, he enters **"Eclipse Overdrive"**, multiplying his ricochet bounces, accelerating his roll speed, and summoning shadow phantom illusions.

### Identity & Placement
- **Boss ID / Kind**: `doppelganger`
- **Sheet Key**: `doppelganger`
- **Display Name**: `THE DOPPELGÄNGER`
- **Toast Title**: `⚔️ THE DOPPELGÄNGER ⚔️`
- **Tagline**: `corrupted shadow reflection, dark pinball ricochet, void blade flurry`
- **Biome Assignment**: `arcane` (The Arcane Deep — parlor floors, mirrors, teleports, and trick lanes)
- **Sprite Scale**: 2.10 (slightly larger, imposing shadowy silhouette)
- **Base Stats**: HP Multiplier: `1.45`, Speed Multiplier: `1.15`

---

## 2. Visual & Sprite Art Specification (Nano Banana)

### Layout & Sprite-Forge Standards
- **Grid Layout**: 4 columns × 4 rows (16 frames, 1024×1024 total, 256×256 per cell).
- **Background**: Perfectly uniform flat `#FF00FF` magenta chroma field (edge-to-edge, zero ground lines, zero border artifacts).
- **Style**: 16-bit SNES top-down pixel art with crisp outlines and rich shading.
- **Reference**: Inversion of Pinball Knight (`docs/art/forged-knight/armor-six-view-reference.png`).

### Visual Details
- **Armor**: Deep blackened steel / obsidian plate armor with jagged silhouette, sharp pauldrons, curved breastplate, and glowing violet/crimson etched runes.
- **Helm**: Pointed bascinet helm with an ominous horizontal glowing visor slit (radiating dark purple or crimson light) and trailing shadowy smoke plume.
- **Weapons**: Corrupted jagged greatsword crackling with dark energy and a spiked void buckler/shield.

### Row-by-Row Frame Architecture
- **Row 0 (`idle`, frames 0..3)**:
  - 4 frames: Menacing stance, heavy breathing with rising dark violet smoke wisps, sinister eye slit pulse, sword rested pointing down.
- **Row 1 (`walk`, frames 4..7)**:
  - 4 frames: Aggressive armored stalk forward, dragging/raising dark blade, heavy strides kicking up dark shadow embers.
- **Row 2 (`attack`, frames 8..11)**:
  - 4 frames: High-energy leaping cleave swing with greatsword, leaving a trailing arc of void energy and creating a dark shockwave.
- **Row 3 (`death`, frames 12..15)**:
  - 4 frames: Stagger back, armor fractures with blinding light bursting through seams, greatsword shatters, dissolving into dark smoke and collapsed armor plates.

---

## 3. Boss Moveset & Phase Design

### Phase 1 (100% – 50% HP)
1. **Shadow Pinball Charge (`pinballCharge`)**:
   - The Doppelganger tucks into a dark obsidian spiked ball with violet flame trails.
   - Launches across the arena with high velocity (`speed: 26`), flattening the player and knocking them back (`launch: 28`).
   - Ricochets off 1 maze wall on impact.
   - Interval: 1.4s–2.2s, Telegraph tell: 0.85s–1.2s.
2. **Void Helm-Splitter Slam (`slam`)**:
   - Telegraphed ground circle at the player's feet (`radius: 2.8`, `damage: 2`, `launch: 24`, `color: 0x9900ff`).
   - Leaps into the air and crashes down with his blade, creating a crater shockwave.
   - Interval: 4.2s, Telegraph tell: 0.85s.
3. **Shadow Mirror Clones (`summon`)**:
   - Summons 1–2 phantom shadow illusions of himself (`count: 1`, `maxAlive: 2`).
   - These clones mimic erratic movements and distract the player.

### Phase 2: "ECLIPSE OVERDRIVE" (≤ 50% HP)
- **Announcement**: `🚨 ECLIPSE UNLEASHED: VOID MULTIBALL 🚨`
- **Speed**: Increased by +30% (`speedMult: 1.40`).
- **Enhanced Shadow Pinball Charge**:
  - Blazing speed (`speed: 32`, `damage: 4`, `launch: 32`).
  - Max bounces increased to **2 wall ricochets**.
  - Tighter intervals (0.8s–1.5s) and faster telegraph (0.55s–0.85s).
- **Enhanced Void Slam**:
  - Deals 3 damage with an **echo shockwave** (`delay: 0.35s`, `radius: 3.2`, `damage: 2`).
- **Dark Void Nova (`nova`)**:
  - Expanding ring of dark energy radiating outward from the boss (`radius: 5.0`, `sweep: 0.8s`, `color: 0xaa00ff`).

---

## 4. Architectural & File Changes

### 1. Sprite Asset Generation & Processing
- Generate 1024×1024 sheet with `generate_image` tool.
- Save master take to `ThreeJS/src/game/pinball-knight/tools/sprite-forge/sources/doppelganger-2026-09-11/alt-takes/`.
- Create `ThreeJS/src/game/pinball-knight/tools/sprite-forge/prep/prep-doppelganger.mjs`:
  - Matte `#FF00FF` magenta chroma background.
  - Apply 4px perimeter ring of pure background.
  - Calculate tight bounding box per cell.
  - Export `inbox/doppelganger-S.json` and `inbox/doppelganger-S.png`.
- Run Sprite-Forge publish to compile to `ThreeJS/public/sprites/doppelganger-S.json` and `.png`.

### 2. Registry & Inventory Wiring
- [`ThreeJS/src/game/pinball-knight/boot/manifest-inventory.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/boot/manifest-inventory.ts):
  - Add `doppelganger: ["S"]` to `IMPORTED_FACINGS`.
- [`ThreeJS/src/game/pinball-knight/boot/sheets.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/boot/sheets.ts):
  - Add `"doppelganger"` to `SheetKey` union, `SHEET_KEYS` set, `IMPORTED_ART` mapping, and `levelArtNeeded`.

### 3. Procedural Fallback Cel-Painter
- [`ThreeJS/src/game/pinball-knight/render/monsters/doppelganger.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/render/monsters/doppelganger.ts):
  - Create `makeDoppelgangerPaints()` drawing an obsidian knight with glowing visor and dark greatsword for offline headless testing.
- [`ThreeJS/src/game/pinball-knight/render/sheet-painters.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/render/sheet-painters.ts):
  - Wire `doppelganger: makeDoppelgangerPaints`.

### 4. Boss Roster & Moveset Wiring
- [`ThreeJS/src/game/pinball-knight/boss-kinds.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/boss-kinds.ts):
  - Add `"doppelganger"` to `BossKind` union.
  - Register `BOSSES.doppelganger` with full Phase 1 and Phase 2 movesets.
- [`ThreeJS/src/game/pinball-knight/bestiary.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/bestiary.ts):
  - Add entry if applicable to bestiary listings.

---

## 5. Verification Plan

### Automated Tests
1. **New Suite**: `ThreeJS/src/game/pinball-knight/entities/doppelganger.test.ts`:
   - Verify boss kind definition, stats, and phase 2 threshold.
   - Verify procedural painter frames (idle, walk, attack, death).
   - Test `pinballCharge` and `slam` execution and state mutations.
2. **Existing Suite**: `ThreeJS/src/game/pinball-knight/boss-roster.test.ts`:
   - Update `expectedBosses` to include `doppelganger`.
   - Validate reachability across depth schedule.
3. **Full Project Suite**: Run `pnpm test` (all 360+ test files).
4. **Production Build**: Run `pnpm build` in `ThreeJS`.

### Git & Deployment Workflow
1. Work in dedicated worktree `.worktrees/wt-doppelganger-boss` on branch `feat/doppelganger-boss`.
2. Commit with descriptive message and merge cleanly to `main`.
3. Push to GitHub origin: `git push origin main`.
4. Deploy container to Synology NAS: `npm run deploy -- --skip-pull`.
5. Verify health check at `http://10.0.0.16:8789/health` and HTTP 200 at `http://10.0.0.16:8789/`.
