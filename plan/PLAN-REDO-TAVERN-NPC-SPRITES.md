# Plan: Redo Tavern NPC Sprite Animations (Eliminate "Flat Paper" Look)

**Document Version**: 1.0.0  
**Target System**: `pinball-knight` (Tavern Scene — ThreeJS)  
**Verification Standard**: Evidence-Driven Problem-Solving Blueprint & `.agents/plan-verification-standard.md`  
**Status**: PROPOSED (Waiting for User Review — No implementation until approved)

---

## 1. Problem Diagnosis & Evidence

- **[CONFIRMED]** In `src/scenes/tavern/npcs.ts`, 5 NPCs populate the tavern stations:
  1. `tavern_smith` (Weaponsmith at forge, anvil at `(-6.2, 0.62, -1.3)`)
  2. `tavern_alchemist` (Barmaid / Alchemist at counter `(6.6, -0.7)`)
  3. `tavern_dealer` (Card Dealer / Illusionist at table `(6.6, 4.4)`)
  4. `tavern_armorer` (Armorer at armor bench `(-5.35, 4.3)`)
  5. `tavern_gambler` (Casino Tout at cabinet & dartboard `(5.3, 6.0)`)

- **[CONFIRMED]** Why they currently look like "pieces of flat paper":
  1. **Flat Frontal Art Perspective**: The current master sheets (`sources/tavern_*-2026-09-10/`) lack 3/4 isometric depth, volumetric body thickness, and rim lighting. They were generated as flat 2D silhouettes without isometric foreshortening to match the Three.js camera.
  2. **Paper-Thin Horizon Squashing on Turns**: In `src/scenes/tavern/npcs.ts:262`:
     ```ts
     k.face = approach(k.face, want, 7, dt);
     k.mesh.scale.x = Math.abs(k.face) < 0.06 ? 0.06 * (want >= 0 ? 1 : -1) : k.face;
     ```
     When an NPC turns from their workstation to face the approaching player, `scale.x` is scaled smoothly from `+1` down through `0.06` to `-1`. This literally flattens the character into a 2D line edge-on like a spinning piece of paper.
  3. **Frame Density & Animation Motion**:
     - The active sheets use 4 frames per row. Some existing frames have subtle motion that reads as static cardboard when viewed at tavern camera zoom (`zoom < 1`).
     - The greeting state (Row 3, frames 12..15) is triggered when `attention > 0.35`, but the old art frames lacked expressive, energetic customer-facing poses (e.g. holding up a foaming mug, fanning cards, wiping a brow with tongs, waving a dart).

---

## 2. Solution Overview

We will upgrade the Tavern NPCs across two integrated dimensions:

1. **Art Overhaul with Nano Banana (`generate_image`)**:
   - Generate brand-new, ultra-detailed 16-bit arcade pixel art sprite sheets on pure solid `#00FF00` chroma green.
   - Design each character with **isometric 3/4 depth**, volumetric rim lighting (warm fire glow from hearths, lantern amber highlights, blue/purple arcane mana glows), and thick, readable silhouettes.
   - 4×4 grid layout (1024×1024 total, 256×256 per cell, 16 frames per NPC).
   - Dedicated 4-frame rows tailored to their tavern roles:
     - **Row 0 (Frames 0–3)**: `idle` — Rich idle breathing, head bob, holding primary tool, shifting weight.
     - **Row 1 (Frames 4–7)**: `work` — Active workstation cycle (hammering glowing blade on anvil, shaking bubbling potion beaker, cascade bridge card shuffle, clanking visor & buffing shield, aiming & throwing darts).
     - **Row 2 (Frames 8–11)**: `flourish` — Dramatic secondary work action (quenching steaming blade, potion puff explosion, floating glowing cards, testing shield edge, flipping gold coin in fingers).
     - **Row 3 (Frames 12–15)**: `greet` — Turning to player, energetic greeting emote (raising foaming stein, spreading cards with a bow, wiping brow and gesturing to forge, raising visor with a grin, waving a lucky dart).

2. **Render & Animation Polish (`src/scenes/tavern/npcs.ts`)**:
   - **Fix the Paper-Edge Flip**: Replace the linear scale-squash with a 3D turning arc (a subtle Y-axis yaw swivel + slight vertical dip hop `greetHop`), maintaining character visual volume so the sprite never flattens into an edge-on slice.
   - **Grounded Shadowing**: Ensure each keeper has a solid contact shadow blob scaled to their body width to root them into the tavern floorboards.
   - **Frame Sync**: Match the sprite frame progression to the audio/VFX strike beats (smith's hammer spark beat at frame 6, gambler's dart throw release at frame 6).

---

## 3. Detailed Character Specifications

### NPC 1: `tavern_smith` (The Dwarf Forge Master)
- **Visual Identity**: Burly dwarf blacksmith with a braided red beard, heavy leather forge apron with brass buckles, soot-stained rolled sleeves, iron tongs in off-hand, and a masterwork hammer.
- **Lighting**: Heavy orange/yellow under-glow from the forge hearth and flying anvil sparks.
- **Row 0 (`idle`)**: Resting hammer on anvil, chest heaving with deep breath, beard swaying.
- **Row 1 (`work`)**: Heavy two-handed hammer swing: raising high, slamming onto glowing steel with orange sparks, follow-through recovery.
- **Row 2 (`flourish`)**: Plunges smoking hot red blade into water trough with a blast of steam.
- **Row 3 (`greet`)**: Turns toward knight, lifts leather goggles onto forehead, gestures proudly at weapons rack.

### NPC 2: `tavern_alchemist` (The Goblin Potion Barmaid)
- **Visual Identity**: Lively goblin alchemist with pointed ears, brass spectacles, stained leather vest, flask bandolier, holding glassware with bubbling swirling liquids.
- **Lighting**: Luminescent green and cyan liquid glow reflecting on face and counter.
- **Row 0 (`idle`)**: Tapping fingers on counter, tail/ears twitching, eyeing colorful flasks.
- **Row 1 (`work`)**: Shaking cocktail shaker / alembic beaker vigorously, corking and wiping glass.
- **Row 2 (`flourish`)**: Mixture bubbles violently, pops with colorful magic sparks and a smoke ring.
- **Row 3 (`greet`)**: Slides a foaming wooden tankard forward, huge grin with pointed teeth, waving customer in.

### NPC 3: `tavern_dealer` (The Raccoon Card Mystic)
- **Visual Identity**: Suave raccoon illusionist in a purple velvet waistcoat, white shirt, monocle, and small top hat, holding an ethereal deck of glowing tarot/playing cards.
- **Lighting**: Mystic violet and gold card edge halos.
- **Row 0 (`idle`)**: Floating a single card back and forth between clawed fingers (aerial card spin).
- **Row 1 (`work`)**: Classic acrobatic card spring & cascade waterfall shuffle from left to right hand.
- **Row 2 (`flourish`)**: Fans out a full spread of glowing holographic cards that radiate golden particles.
- **Row 3 (`greet`)**: Sweeps hat off in a polite theatrical bow, extending a fan of face-down cards to pick.

### NPC 4: `tavern_armorer` (The Bulldog Bulwark)
- **Visual Identity**: Stout, muscular bulldog knight in burnished steel plate armor with brass trim, lion-crest surcoat, heavy iron gauntlets, holding an anvil hammer and heater shield.
- **Lighting**: Crisp specular glints off polished steel and brass armor plates.
- **Row 0 (`idle`)**: Standing at attention, clanking greaves, shifting heavy shield weight.
- **Row 1 (`work`)**: Hammering out a dent on a round iron shield, wiping metal filings with cloth.
- **Row 2 (`flourish`)**: Testing edge of a breastplate with armored thumb, nodding in satisfaction.
- **Row 3 (`greet`)**: Slams gauntlet to breastplate in salute, snaps visor up with a hearty toothy grin.

### NPC 5: `tavern_gambler` (The Raven Dart Tout)
- **Visual Identity**: Sleek raven/crow scoundrel in a dark feather-trimmed trenchcoat, leather gloves, holding brass-tipped darts and a pair of ivory dice.
- **Lighting**: Soft amber tavern lantern light highlighting feather sheen and brass dart points.
- **Row 0 (`idle`)**: Flipping a shiny gold doubloon over knuckles back and forth.
- **Row 1 (`work`)**: Sighting the dartboard with squinted eye, steadying breath, and snapping throw forward.
- **Row 2 (`flourish`)**: Shakes dice in closed palms, rolls across cabinet surface, pumps fist.
- **Row 3 (`greet`)**: Tips trenchcoat collar, points with feathered wing toward the casino cabinet with a sly wink.

---

## 4. Pipeline & Technical Implementation Plan

### Step 1: Nano Banana Asset Generation (5 Master Sheets)
- Generate 5 distinct 1024×1024 sprite sheets with Nano Banana on `#00FF00` chroma green.
- Validate isometric 3/4 angle, chunky pixel depth, and frame consistency.
- Archive raw takes into:
  - `src/game/pinball-knight/tools/sprite-forge/sources/tavern_smith-2026-09-11/alt-takes/`
  - `src/game/pinball-knight/tools/sprite-forge/sources/tavern_alchemist-2026-09-11/alt-takes/`
  - `src/game/pinball-knight/tools/sprite-forge/sources/tavern_dealer-2026-09-11/alt-takes/`
  - `src/game/pinball-knight/tools/sprite-forge/sources/tavern_armorer-2026-09-11/alt-takes/`
  - `src/game/pinball-knight/tools/sprite-forge/sources/tavern_gambler-2026-09-11/alt-takes/`

### Step 2: Sprite-Forge Preprocessing & Compilation
- Update `prep-tavern-and-maze-npcs.mjs` with new source paths and cell bounds.
- Execute prep build: `node src/game/pinball-knight/tools/sprite-forge/prep/prep-tavern-and-maze-npcs.mjs`.
- Run sprite publisher: `npm run sprites` (`FORGE_PUBLISH=1 vitest run ...`).
- Verify published outputs in `public/sprites/tavern_*-S.png` and `public/sprites/tavern_*-S.json`.

### Step 3: Tavern NPC Engine Tuning (`src/scenes/tavern/npcs.ts`)
- Replace the 2D linear scale-collapse flip with a volumetric turn transition:
  - Rotate slightly in Y (yaw) or ease mirror with a slight hop rather than dropping `scale.x` to 0.06.
- Hook Row 1 (`work`), Row 2 (`flourish`), and Row 3 (`greet`) animations cleanly into the keeper update loop.
- Synchronize beat callbacks (`anvil` and `dart`) with exact impact frame indices.

### Step 4: Verification & Deployment
- Run unit tests:
  - `pnpm exec vitest run src/scenes/tavern/npcs-animated.test.ts src/scenes/tavern/npcs.test.ts`
  - `pnpm exec vitest run src/game/pinball-knight/tools/sprite-forge/published.test.ts`
- Run production build: `pnpm run build`.
- Commit changes to worktree branch, merge to `main`, and push to GitHub.
- Redeploy to Synology NAS: `npm run deploy`.
- Verify live at `http://10.0.0.16:8789`.

---

## 5. Verification Checklist

- [ ] Automated tests: `npcs-animated.test.ts`, `npcs.test.ts`, and `published.test.ts` pass 100%.
- [ ] Build passes with zero errors: `pnpm run build`.
- [ ] All 5 tavern NPC PNG and JSON files exist in `public/sprites/` and load over HTTP 200.
- [ ] In-game manual verification:
  - Visit the Tavern scene in `http://10.0.0.16:8789`.
  - Walk up to each of the 5 stations (Forge, Bar, Dealer, Armorer, Gambler).
  - Confirm the NPCs have volumetric depth, do not collapse like paper on turns, and play fluid working & greeting animations.
