# Plan: Better Zombie Replacement & 10 Zombie Variations

## 1. Goal & Background
The user requested:
> *"make a better zombie to replace the zombie monster we have and make 10 more variations"*

Currently in **Pinball Knight** (Three.js Web edition):
- The baseline `zombie` uses an old East-only sprite sheet (`zombie-E.png`) or procedural canvas cel-painter variants (`makeZombiePaints`). It lacks a dedicated South-facing (`S`) retro arcade pixel art sprite sheet.
- `zombie-types.ts` contains an 8-subtype system (`shambler`, `runner`, `lurcher`, `hulk`, `midget`, `crawler`, `flailer`, `hobbler`) that applies stat/speed/behavior multipliers over the baseline `zombie` kind.
- The game also features standalone variant families (e.g. `cop-variants`: `riot_cop`, `highway_patrol`, `detective_cop`, `robo_cop`; and `slime-variants`: `magma_slime`, `toxic_slime`, `frost_slime`, `void_slime`).

We will:
1. **Replace Baseline Zombie with a Vastly Better 16-Bit Retro Pixel Art Sprite**:
   - Create a brand new 4×4 retro arcade pixel art sprite sheet facing South (`zombie-S.png` & `zombie-S.json`), with crisp 16-bit aesthetics: decayed rot-green flesh, ragged purple/leather burial shroud, bared yellow teeth, glowing hollow eye sockets, exposed ribs/spine.
   - Authored animations: `idle` (4 frames), `walk` (4 frames), `attack` (4 frames), `death` (4 frames).
   - Update procedural cel-painter fallback in `render/cel-painter.ts` / `render/monsters/zombie.ts`.
   - Update `manifest-inventory.ts` to register `zombie: ["S", "E"]`.
2. **Implement 10 Distinct Zombie Variations**:
   - Provide 10 diverse, recognizable zombie archetypes with distinct combat behaviors, visual silhouettes/tints, movement AI, and unique mechanics.

---

## 2. The 10 Zombie Variations

| # | Variation Name | Archetype / Theme | Visual Features | Mechanics / Gameplay Trait | Movement Policy |
|---|---|---|---|---|---|
| 1 | **Plague Shambler** (`plague`) | Putrid rot-oozing corpse | Neon green pustules, rot slime drips | Leaves a slowing rot puddle on death | `chase` |
| 2 | **Grave Knight** (`armored`) | Decayed crypt warrior | Rusted steel helm & breastplate | Gates head-on momentum strikes (`MOMENTUM_GATES`), deflects light hits | `chase` |
| 3 | **Bloated Corpse** (`bloated`) | Swollen gas-filled carcass | Huge distended belly, purple varicose veins | Explodes on death in a violent toxic splatter damaging nearby actors | `lurch` |
| 4 | **Frenzy Ghoul** (`frenzy`) | Rabid blood-starved sprinter | Crimson flayed skin, bloodshot red eyes | Sprints faster as its HP drops (`painMult: 1.25`, dodges ranged attacks) | `flanker` |
| 5 | **Crypt Crawler** (`crawler`) | Prone legless ambusher | No legs, dragging arms, floor hugging | Waits in ambush until close, lunges forward (`bounce-immune`) | `ambusher` |
| 6 | **Frostbitten Husk** (`frost`) | Glacial frozen corpse | Pale cyan ice-rimed flesh, frozen frost shards | Chills knight on contact, reducing turn speed; ice burst on shatter | `chase` |
| 7 | **Charred Revenant** (`charred`) | Smoldering burned skeleton | Burnt black bone, glowing embers, smoke motes | Fire-resistant; ignites adjacent oil puddles | `chase` |
| 8 | **Plague Screamer** (`screamer`) | Shrieking herald | Open dislocated jaw, dilated white eyes | Emits a concussive screech upon sighting player, disorienting steering | `kite` |
| 9 | **Grave Clutcher** (`clutcher`) | Long-limbed grasping ghoul | Elongated clawed fingers, tattered grave wraps | Latches onto the knight on hit, halting momentum for 1.2s | `leaper` |
| 10 | **Abomination Hulk** (`abomination`) | Two-headed mutant behemoth | Massive twin-headed torso, exposed rib cage | Massive knockback, ground pound AoE shockwave, killable only on fast ride | `chase` / `tank` |

---

## 3. Implementation Options for the 10 Variations

### Architecture Option A: Expanded Sub-Type System (`zombie-types.ts`) — *Recommended*
- **Design**: The 10 variations live inside the `zombie` kind family via `zombie-types.ts`.
- **How it works**:
  - Each variation is a `ZombieTypeDef` with dedicated multipliers (`speedMult`, `hpMult`, `scale`, `bodyRMult`, `reachMult`, `windupMult`, `painMult`), movement AI (`flanker`, `ambusher`, `leaper`, `kite`, etc.), and special rules (`bounce-immune`, `speed-only`, `dodges-ranged`, explosive death, frost chill, grab slow).
  - Integrates seamlessly into the horde generator (`pickZombieType`, `variantIndicesFor`).
  - Keeps the core `EnemyKind` union clean without exploding the 9 compile-enforced `Record<EnemyKind, ...>` tables.
  - Visual distinction is achieved via procedural tinting/scaling and `ZOMBIE_VARIANTS` silhouette pieces (helmets, stumps, boils, second heads).

### Architecture Option B: 10 Standalone `EnemyKind`s (like `cop-variants` & `slime-variants`)
- **Design**: Each of the 10 variations becomes a dedicated first-class `EnemyKind` (e.g. `zombie_toxic`, `zombie_armored`, `zombie_bloated`, etc.).
- **How it works**:
  - Each gets separate entries in `EnemyKind`, `STATS`, `DMG_BY_KIND`, `HP_BY_KIND`, `bestiary.ts` (10 new bestiary cards), `reagents.ts` (drops), `debug-panel.ts` (10 spawn buttons), `spawn/factory.ts`, `kind-skin.ts`, and individual cel-painters / sprite sheets.
  - Gives each variation its own entry in the bestiary and independent spawn weights, but adds 10 new rows across 9 tables.

---

## 4. Execution Workflow (Once Approved)

1. **Git Worktree**: Create dedicated worktree `.worktrees/wt-zombie-overhaul` on branch `feat/zombie-overhaul`.
2. **Sprite Generation**:
   - Generate baseline South-facing 4×4 pixel art sheet (`zombie-S`).
   - Run sprite-forge prep, border cleaning, and publish to `public/sprites/zombie-S.png` and `.json`.
   - Update `manifest-inventory.ts` to `zombie: ["S", "E"]`.
3. **Procedural Cel-Painters**:
   - Modernize `makeZombiePaints` with support for all 10 variant features (helmets, pustules, frozen frost, charred smoke, conjoined heads, etc.).
4. **Logic & Variation Implementation**:
   - Implement the 10 variations according to the selected architecture (Option A or Option B).
   - Wire death triggers (bloated explosion, toxic puddle, frost burst) in `combat.ts` and `boot/wiring.ts`.
5. **Testing & Diagnostics**:
   - Write comprehensive unit tests in `entities/zombie-overhaul.test.ts` asserting all 10 variations' stats, movements, death triggers, and sprite sheets.
   - Run vitest across the full test suite.
6. **Merge & Deploy**:
   - Merge `feat/zombie-overhaul` to `main`.
   - Push to GitHub `origin/main`.
   - Run `npm run deploy` to redeploy `pinball-knight-web` to Synology NAS.
   - Notify user of test readiness at `http://10.0.0.16:8789`.

---

## 5. Open Questions for User Clarification

1. **Architecture Preference**:
   - Do you prefer the 10 variations as **Sub-Types** inside the `zombie` kind (Option A: integrated into the horde spawning system with specialized behavior/stats/tints), or as **10 standalone `EnemyKind`s** (Option B: like `slime-variants` with 10 separate bestiary cards and debug spawner buttons)?
2. **Visual Style for Baseline Zombie**:
   - Do you prefer a classic decayed rot-green zombie with torn clothing and glowing eyes, or something more grotesque (e.g. skeleton-hybrid, gore-heavy)?
3. **Any specific variation mechanics you'd like to customize?**
   - Are there specific abilities (like explosions, acid puddles, helmet deflections, or screaming alerts) you want emphasized?
