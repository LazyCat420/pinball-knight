# Plan: Animated Sprite Sheets for Tavern Keepers & Roaming Maze Merchant

**Document Status**: Proposed (Planning Mode — Awaiting User Review)  
**Branch**: `feat/tavern-merchant-sprites`  
**Worktree**: `.worktrees/wt-tavern-merchant-sprites`  
**Date**: 2026-09-10  
**Authority Mode**: `Plan` (Read-only / Proposal; no implementation or generation until approved)

---

## 1. Executive Summary & Problem Definition

- **Current State (Verified Fact)**:
  - In `ThreeJS/src/scenes/tavern/npcs.ts` (lines 72–81, 154–157), all 5 Tavern Keepers are rendered using single-frame static cel-painter bitmaps borrowed from dungeon NPCs:
    1. `forge` (Weaponsmith): Uses `merchant` cel-paint (the Mad Hatter wizard!) with procedural sine translation for hammering.
    2. `bar` (Potions / Alchemist): Uses `witch` cel-paint with procedural sine sway for wiping glasses.
    3. `dealer` (Card Dealer): Uses `magician` cel-paint with procedural jitter for dealing cards.
    4. `armory` (Armorer): Uses `frog` cel-paint with procedural vertical bobbing.
    5. `gambler` (Casino Tout): Uses `tout` cel-paint with procedural tilt for dart throwing.
  - In `ThreeJS/src/game/pinball-knight/entities/npc.ts` (lines 61–68, 88–98), the Roaming Maze Merchant is described as "a shop on wheels that slides the floor", but is also rendered via `createStaticSprite(NPC_PAINTS["merchant"])` — a single static sprite sliding across tiles without frame animation.
  - While `public/sprites/merchant-S.json` exists in `inbox/` as a Mad Hatter wizard, it lacks a mobile cart/pack locomotion animation, and is not wired into `entities/npc.ts`.

- **Target State (Testable Claim)**:
  1. Author 5 dedicated, comical, and highly expressive 4×4 animated sprite sheets for all Tavern Keepers, perfectly tailored to what they do and sell:
     - **Weaponsmith** (`tavern_smith`): Burly, soot-covered dwarf blacksmith with glowing tongs and an oversized forge hammer that slams down on the anvil with sparks.
     - **Alchemist / Barmaid** (`tavern_alchemist`): Twitchy goblin/fox mixologist shaking bubbling, color-shifting potion flasks and burping purple smoke.
     - **Card Dealer** (`tavern_dealer`): Suave raccoon/fox illusionist card-shark with bridge card shuffles and glowing trick card reveals.
     - **Armorer** (`tavern_armorer`): Clumsy bulldog knight in heavy plate armor whose visor constantly falls down over his snout, buffing a mirror shield.
     - **Casino Tout / Gambler** (`tavern_gambler`): Flamboyant crow hustler flipping gold coins, shaking giant casino dice, and aiming darts at the wall.
  2. Author 1 dedicated 4×4 animated sprite sheet for the **Roaming Maze Merchant** (`maze_merchant`):
     - An eccentric travelling peddler pedaling/pushing a rickety wooden shop cart with brass wheels, lanterns, hanging pots, and a ringing counter bell.
  3. Process all 6 sprite sheets through Nano Banana (`generate_image`), clean and slice in `sprite-forge` into `sources/` and `inbox/`, compile via `npm run sprites` to `public/sprites/`, register in `manifest-inventory.ts`, and integrate into runtime rendering in `npcs.ts` and `entities/npc.ts`.

---

## 2. Evidence & Baseline Verification (Blueprint Layers)

| Claim ID | Statement | Classification | Evidence Source |
|---|---|---|---|
| CLAIM-1 | Tavern keepers currently use static 1-frame billboard cel-paints | Verified Fact | `ThreeJS/src/scenes/tavern/npcs.ts:154-157` (`createStaticSprite`) |
| CLAIM-2 | Weaponsmith currently reuses `merchant` cel-paint | Verified Fact | `ThreeJS/src/scenes/tavern/npcs.ts:73` |
| CLAIM-3 | Armorer currently reuses `frog` cel-paint | Verified Fact | `ThreeJS/src/scenes/tavern/npcs.ts:76` |
| CLAIM-4 | Roaming maze merchant currently uses static `merchant` cel-paint | Verified Fact | `ThreeJS/src/game/pinball-knight/entities/npc.ts:62, 93` |
| CLAIM-5 | `createActorSprite` supports multi-frame animated quads via `SpriteSheet` | Verified Fact | `ThreeJS/src/game/pinball-knight/engine/render/sprite.ts:1499` |
| CLAIM-6 | `loadImportedSheet` decodes `/sprites/<name>-<dir>.json` and `.png` | Verified Fact | `ThreeJS/src/game/pinball-knight/render/imported-paints.ts:43-69` |
| CLAIM-7 | `IMPORTED_FACINGS` in `manifest-inventory.ts` gates sheet loading | Verified Fact | `ThreeJS/src/game/pinball-knight/boot/manifest-inventory.ts:8-87` |
| CLAIM-8 | Existing keeper unit tests require `NPC_PAINTS[k.paintKey]` to remain valid | Verified Fact | `ThreeJS/src/scenes/tavern/npcs.test.ts:29-33` |

---

## 3. Character Design & Animation Layouts (4×4 Grid = 16 Frames Each)

Each sheet is generated at 1024×1024 with a 4×4 grid of 256×256 cells on `#FF00FF` magenta chroma background.

### 3.1 Tavern Weaponsmith (`tavern_smith-S`)
- **Station**: Forge / Anvil (`forge`)
- **Visual Silhouette**: Burly dwarf with thick braided ginger beard, soot smudges on nose/cheeks, thick leather blacksmith apron, heavy protective goggles resting on forehead, thick leather gloves.
- **Grid Layout**:
  - **Row 0: `idle` (4 frames)** — Resting heavy forging hammer on anvil/shoulder, deep chest breathing, lifting arm to wipe sweat from brow with forearm.
  - **Row 1: `hammer` / `work` (4 frames)** — Asymmetric two-handed swing: windup lifting glowing warhammer high overhead, holding at peak, slamming down onto anvil with impact sparks, recovery.
  - **Row 2: `inspect` / `bellows` (4 frames)** — Pumping hearth bellows with sparks rising, holding up a red-hot glowing sword blade to inspect the straightness with one eye closed.
  - **Row 3: `cheer` / `react` (4 frames)** — Beaming wide toothy grin, flexing massive bicep, presenting a polished spiked cleaver to the player with a friendly wink.

### 3.2 Tavern Alchemist / Barmaid (`tavern_alchemist-S`)
- **Station**: Potions Counter (`bar`)
- **Visual Silhouette**: Hyperactive, wide-eyed goblin or fox mixologist wearing a bandolier of volatile glowing potions, rolled-up shirtsleeves, brass magnifying monocle, and a stained bar apron.
- **Grid Layout**:
  - **Row 0: `idle` (4 frames)** — Shaking a glass flask, ears twitching, watching swirling neon liquid settle.
  - **Row 1: `brew` / `work` (4 frames)** — Pouring bubbling blue and yellow liquids between two beakers, sudden color change to frothing violet, steam puffing up.
  - **Row 2: `taste` / `fume` (4 frames)** — Sneaking a quick sip from a test tube, eyes bulging in shock, face turning green/cyan, comical smoke puff from ears.
  - **Row 3: `serve` / `react` (4 frames)** — Wiping down the counter with a bar towel, then sliding a frosty, bubbling health potion mug forward with two hands.

### 3.3 Tavern Card Dealer (`tavern_dealer-S`)
- **Station**: Card Table (`dealer`)
- **Visual Silhouette**: Sleek raccoon or phantom card-shark in a sharp green or purple velvet waistcoat, ruffled white cuffs, green dealer visor, and quick dexterous paws.
- **Grid Layout**:
  - **Row 0: `idle` (4 frames)** — Riffle shuffle between paws, leveling deck on table, sharp eyes scanning the player.
  - **Row 1: `deal` / `work` (4 frames)** — Dramatic bridge card cascade, cards arching through the air from one paw to the other without dropping one.
  - **Row 2: `trick` / `sleight` (4 frames)** — Snapping fingers, causing a fanned hand of 5 glowing holographic tarot cards to hover in midair.
  - **Row 3: `offer` / `react` (4 frames)** — Pulling a glowing golden Ace card from behind his ear / sleeve and presenting it forward with a flourish.

### 3.4 Tavern Armorer (`tavern_armorer-S`)
- **Station**: Armory Bench (`armory`)
- **Visual Silhouette**: Sturdy bulldog knight encased in comically oversized steel plate armor with brass trim; the helmet visor is slightly too loose.
- **Grid Layout**:
  - **Row 0: `idle` (4 frames)** — Standing at attention; the heavy steel visor suddenly clanks shut over his snout; he pauses and hurriedly nudges it back up with a metal gauntlet.
  - **Row 1: `polish` / `work` (4 frames)** — Vigorously buffing a massive kite shield with a polishing cloth until a bright gleam shines across the metal.
  - **Row 2: `hammer` / `repair` (4 frames)** — Using a ball-peen hammer to knock a dent out of a steel breastplate on the wooden armory bench.
  - **Row 3: `salute` / `react` (4 frames)** — Snapping a rigid armored salute and proudly lifting a feathery plumed helmet to offer to the player.

### 3.5 Tavern Casino Tout / Gambler (`tavern_gambler-S`)
- **Station**: Casino Cabinet & Wall Dartboard (`gambler`)
- **Visual Silhouette**: Flamboyant, dapper crow or gremlin hustler in a feathered bowler hat, gold chain necklaces, dice cufflinks, and spats.
- **Grid Layout**:
  - **Row 0: `idle` (4 frames)** — Flipping a gleaming gold coin high into the air, tracking it with his beak, and snapping it onto the back of his hand.
  - **Row 1: `dart` / `work` (4 frames)** — Leaning back to sight the wall dartboard, aiming dart with one eye closed, whip-snapping arm forward to throw dart.
  - **Row 2: `dice` / `shake` (4 frames)** — Rattling two giant red casino dice inside cupped hands next to his ear, blowing on them for luck.
  - **Row 3: `win` / `react` (4 frames)** — Leaping into the air as gold coins burst around him, enthusiastically pointing at the arcade cabinet screen.

### 3.6 Roaming Maze Merchant (`maze_merchant-S`)
- **Location**: Wandering dungeon corridors (`entities/npc.ts`)
- **Visual Silhouette**: Energetic nomadic merchant pushing/pedaling an overloaded rickety wooden tricycle shop cart. The cart is adorned with striped awning canvas, hanging lanterns, clattering brass pots, and a polished counter service bell.
- **Grid Layout**:
  - **Row 0: `idle` / `dwell` (4 frames)** — Resting cart, panting, wiping brow, reaching to ring the brass counter bell (`ding!`), glancing nervously left and right.
  - **Row 1: `roll` / `flee` (4 frames)** — Furiously pushing/pedaling the cart, little wheels spinning with motion lines, dust puffs kicking up behind as he flees from the player.
  - **Row 2: `swerve` / `corner` (4 frames)** — Cart tipping precariously onto two wheels during a sharp turn, gripping handlebars with wide eyes.
  - **Row 3: `shop` / `offer` (4 frames)** — Throwing open the wooden display shutters of the cart like a food truck, revealing glowing swords, potions, and cards, welcoming the player with waving hands.

---

## 4. Nano Banana Generation Prompts & Style Rules

Per `PROMPTS.md` and `.agents/AGENTS.md`:
- Pure `#FF00FF` magenta background edge-to-edge.
- 16-bit SNES pixel art, hard-edged cel shading, 1px dark contour outline.
- Zero floor shadows, ground lines, border boxes, text, or color charts.
- 4×4 grid layout (4 cols × 4 rows = 16 frames).

### Master Generation Prompts:

1. **Weaponsmith (`tavern_smith`)**:
   > `16-bit SNES-era pixel art sprite sheet of a fantasy dwarf weaponsmith blacksmith. 4 columns by 4 rows grid of 16 animation frames. Burly dwarf with ginger beard, leather apron, heavy goggles on forehead, thick gloves. Row 1: idle breathing, holding hammer on anvil, wiping sweat from forehead. Row 2: swinging heavy glowing warhammer overhead and slamming down on anvil with sparks. Row 3: working bellows and inspecting red-hot glowing sword blade. Row 4: toothy grin, flexing bicep, presenting masterwork sword. Solid pure magenta #FF00FF background edge-to-edge. No ground plane, no drop shadows, no text, no palette chart.`

2. **Alchemist / Barmaid (`tavern_alchemist`)**:
   > `16-bit SNES-era pixel art sprite sheet of an eccentric fantasy goblin potion alchemist bartender. 4 columns by 4 rows grid of 16 animation frames. Green goblin with big ears, brass monocle, stained apron, potion bandolier. Row 1: idle shaking potion flask with swirling liquid. Row 2: pouring bubbling liquids between beakers that steam and froth. Row 3: taking a sip of experimental potion, eyes bulging, purple smoke puffing from ears. Row 4: wiping bar counter with rag, sliding glowing potion mug forward with a wink. Solid pure magenta #FF00FF background edge-to-edge. No ground plane, no drop shadows, no text, no palette chart.`

3. **Card Dealer (`tavern_dealer`)**:
   > `16-bit SNES-era pixel art sprite sheet of a fantasy raccoon card dealer illusionist. 4 columns by 4 rows grid of 16 animation frames. Sharp raccoon wearing green dealer visor, purple velvet waistcoat, white cuffs. Row 1: idle riffling deck of cards between paws. Row 2: dramatic waterfall bridge card shuffle cascade in an arc. Row 3: snapping fingers, fanning glowing holographic cards hovering in air. Row 4: pulling glowing Ace card from sleeve and offering it forward. Solid pure magenta #FF00FF background edge-to-edge. No ground plane, no drop shadows, no text, no palette chart.`

4. **Armorer (`tavern_armorer`)**:
   > `16-bit SNES-era pixel art sprite sheet of a sturdy bulldog armorer knight in oversized plate armor. 4 columns by 4 rows grid of 16 animation frames. Stout bulldog in heavy steel knight armor and loose helmet visor. Row 1: idle standing, heavy visor falls over eyes, bulldog nudges visor back up. Row 2: vigorously buffing giant mirrored tower shield with cloth until it gleams. Row 3: hammering out dent on steel breastplate on workbench. Row 4: crisp salute, lifting feathery plumed helmet to offer to viewer. Solid pure magenta #FF00FF background edge-to-edge. No ground plane, no drop shadows, no text, no palette chart.`

5. **Casino Tout / Gambler (`tavern_gambler`)**:
   > `16-bit SNES-era pixel art sprite sheet of a flamboyant crow gambler hustler. 4 columns by 4 rows grid of 16 animation frames. Dapper black crow in feathered bowler hat, gold chains, dice cufflinks. Row 1: idle flipping gold coin high in air and catching on wrist. Row 2: squinting one eye to aim dart, throwing dart with whip motion. Row 3: shaking two large red casino dice in cupped hands and tossing. Row 4: celebrating with coins bursting in air, pointing with wing to slot machine. Solid pure magenta #FF00FF background edge-to-edge. No ground plane, no drop shadows, no text, no palette chart.`

6. **Roaming Maze Merchant (`maze_merchant`)**:
   > `16-bit SNES-era pixel art sprite sheet of a fantasy travelling peddler pushing a wheeled shop cart. 4 columns by 4 rows grid of 16 animation frames. Eccentric merchant pushing rickety wooden three-wheeled shop cart with canopy, lanterns, dangling pots, and brass bell. Row 1: idle panting, wiping brow, ringing counter bell. Row 2: frantically running and pushing rolling cart with spinning wheels and dust puffs. Row 3: cart swerving on two wheels around a corner with wide cartoon eyes. Row 4: opening wooden cart shutters to display glowing shop wares with welcoming wave. Solid pure magenta #FF00FF background edge-to-edge. No ground plane, no drop shadows, no text, no palette chart.`

---

## 5. Implementation Steps & Code Architecture

### 5.1 Sprite-Forge Ingest & Publish
1. Generate the 6 images using `generate_image`.
2. Save masters into `ThreeJS/src/game/pinball-knight/tools/sprite-forge/sources/<char>/alt-takes/`.
3. Create automated prep scripts `prep-tavern-npcs.mjs` and `prep-maze-merchant.mjs` in `sprite-forge/prep/`:
   - Magenta chroma cleanup (`#FF00FF`), edge artifact trimming.
   - Ink-tight bounding box detection for all 16 cells (4×4).
   - Write composite to `sources/<char>/<char>-S.png` and `inbox/<char>-S.png`.
   - Write sidecar JSON to `inbox/<char>-S.json` with rows:
     - Tavern keepers: `["idle", "work", "special", "react"]`
     - Maze merchant: `["idle", "roll", "swerve", "offer"]`
4. Run `npm run sprites` (`FORGE_PUBLISH=1`) to compile into `public/sprites/`.
5. Register in `ThreeJS/src/game/pinball-knight/boot/manifest-inventory.ts`:
   - Add `"tavern_smith": ["S"]`, `"tavern_alchemist": ["S"]`, `"tavern_dealer": ["S"]`, `"tavern_armorer": ["S"]`, `"tavern_gambler": ["S"]`, `"maze_merchant": ["S"]`.

### 5.2 Tavern Keepers Runtime Upgrade (`ThreeJS/src/scenes/tavern/npcs.ts`)
1. Extend `KeeperSpec`:
   - Add `sheetKey?: string` (e.g. `"tavern_smith"`, `"tavern_alchemist"`, etc.).
   - Retain `paintKey` for fallback so `npcs.test.ts` line 31 passes without disruption.
2. In `buildNpcs(scene: THREE.Scene)`:
   - Async/cached loader for imported sheets: `loadImportedSheet(k.sheetKey, "S")`.
   - If sheet loaded: construct `ActorSprite` via `createActorSprite(sheet, false)`.
   - If sheet unavailable: construct `createStaticSprite(NPC_PAINTS[k.paintKey])` (safe fallback).
3. In `update({ time, dt, vfx, focusId, playerX, onBeat }: NpcFrame)`:
   - Map each keeper's state to appropriate row and frame:
     - **Idle loop**:
       - Smith: plays row 1 (hammering) keyed to `HAMMER_PERIOD`. On beat impact (`p >= 0.8`), frame 2 strikes the anvil, triggering `onBeat("anvil")` and anvil sparks!
       - Alchemist: cycles row 0 and 1 (brewing/shaking).
       - Dealer: plays row 1 (bridge card cascade).
       - Armorer: cycles row 0 (visor falling and nudging up) and row 1 (shield buffing).
       - Gambler: plays row 1 (dart windup and throw) keyed to `DART_PERIOD`. On release (`p >= 0.66`), dart hits board, triggering `onBeat("dart")` and dartboard sparks!
     - **Attentive / Focus loop** (`focusId === k.id`):
       - When the player stands in front of their station, smoothly blend to Row 3 (react/greet):
         - Smith: flexes bicep and displays weapon.
         - Alchemist: slides bubbling potion forward.
         - Dealer: presents glowing card.
         - Armorer: stiff salute with plumed helmet.
         - Gambler: celebratory coin toss pointing to machine.
   - Retain smooth body flip mirroring (`scale.x = face`) so keepers turn toward their props when working and face the player when approached.

### 5.3 Maze Roaming Merchant Runtime Upgrade (`ThreeJS/src/game/pinball-knight/entities/npc.ts`)
1. In `spawnMerchant(i: number, j: number)`:
   - If `maze_merchant` sheet is loaded: build `ActorSprite(merchantSheet, false)` and attach to `m.sprite`.
   - Set initial phase to `"roll"`.
2. In `updateMerchant(n: Npc, dist: number, dt: number)`:
   - When fleeing (`fleeing = !n.shopped && dist < MERCHANT_FLEE_RANGE`):
     - Animate Row 1 (`roll` / frantic cart push) at fast FPS.
     - Play bell ring `sfxCartBell` on timer.
   - When stopped / dwelling (`n.dwellT > 0` or idle):
     - Animate Row 0 (`idle` / panting and bell ring).
   - When caught (`dist <= MERCHANT_CATCH_RANGE`):
     - Trigger toast: `showToast("🛒 THE WANDERING MERCHANT", "he swings open his mobile shop!")`.
     - Animate Row 3 (`offer` / cart shutters open, wares glowing).

---

## 6. Verification & Validation Plan

### 6.1 Automated Vitest Tests
- Run `pnpm test src/scenes/tavern/npcs.test.ts` — verify all 7 existing floor-plan and keeper tests pass.
- Run `pnpm test src/game/pinball-knight/engine/render/all-monsters-imported-pipeline.test.ts` — verify imported sheet pipeline integrity.
- New unit test `src/scenes/tavern/npcs-animated.test.ts`:
  - Asserts all 5 tavern keepers have defined `sheetKey` entries.
  - Asserts that when sprite sheets are present, `ActorSprite` is created and `setFrame` is invoked on animation ticks.
  - Asserts that strike beats fire `onBeat("anvil")` and `onBeat("dart")` at exact frame alignments.
- New unit test `src/game/pinball-knight/entities/merchant-animated.test.ts`:
  - Asserts roaming merchant transitions between `roll`, `idle`, and `offer` clips based on proximity and catch state.

### 6.2 Build & Deployment Validation
- Compile TypeScript: `pnpm build` in `ThreeJS/`.
- Git commit changes on worktree branch `feat/tavern-merchant-sprites`.
- Fast-forward merge or push to GitHub `main`.
- Deploy container to Synology NAS:
  `npm run deploy -- --only=pinball-knight --skip-pull`
- Probe HTTP health endpoint at `http://10.0.0.16:8789/` and verify 200 OK.

---

## 7. Open Questions for User Clarification

1. **Character Species / Visual Archetypes**:
   - Weaponsmith: Dwarf blacksmith (recommended) vs Orc/Goblin smith?
   - Alchemist: Goblin mixologist (recommended) vs Witch/Cat-girl brewer?
   - Card Dealer: Raccoon card-shark (recommended) vs Sleek vampire illusionist?
   - Armorer: Bulldog knight with falling visor (recommended) vs Turtle smith?
   - Casino Tout: Flamboyant crow gambler (recommended) vs Grinning gremlin?
   - Roaming Merchant: Tricycle peddler cart (recommended) vs Donkey/mule drawn cart?
2. **Animation Style**:
   - Do you prefer 4-frame loops (compact, punchy SNES arcade feel, fits 4×4 grid perfectly) for all 4 states per character?
