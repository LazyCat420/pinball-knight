# Implementation Plan — 5 Weird & Funny American-Style Monsters ("Aaahh!!! Real Monsters" Tribute)

**Target Project**: `pinball-knight` (Three.js Web version)  
**Date**: 2026-09-11  
**Status**: PLAN ONLY (Awaiting User Review & Approval — DO NOT IMPLEMENT YET)  
**Methodology**: Strictly compliant with [`plan-verification-standard.md`](file:///home/lazycat/github/projects/sun/.agents/plan-verification-standard.md) (VCPM Claim Triage & Quality Gates)

---

## 1. Problem Statement & User Intent

The user requested creating 5 new random monsters inspired by the iconic 90s cartoon style of ***Aaahh!!! Real Monsters*** (weird, grotesque yet hilarious anatomy, strange misplaced body parts, goofy expressions) combined with classic **American pop-culture / urban street tropes** (hot dogs, baseball caps, fire hydrants, chrome toasters, gym tube socks).

---

## 2. Monster Roster & Visual Concepts

### Monster 1: `pit_peeper` (The Pit Peeper / Armpit Larry)
- **Visual Concept**: Hairy, lumpy orange sewer critter with NO eyes on its face (just a big dopey grinning mouth with crooked teeth). Instead, two gigantic, bloodshot googly eyeballs on long rubbery stalks poke directly out of its hairy armpits. Wears striped vintage American tube socks on its feet.
- **Locomotion (`flanker`)**: Awkward, bow-legged waddle, flapping its arms up and down to adjust its armpit eye sightlines.
- **Attack**: Swings a stinky, weighted gym tube sock flail that deals blunt damage and releases green sweat droplets.
- **Death**: Pops like an overripe stink bomb, emitting a localized green funk cloud that slows the player by 35% for 2.5s.
- **Biome**: Sewer & Crypt.

### Monster 2: `dumpster_dan` (Dumpster Dan / Trashbag Gremlin)
- **Visual Concept**: Heavy-duty green/yellow wrinkled municipal trash bag body tied at the neck like a hunchback cowl. Wears a backwards red/blue trucker/baseball cap, has mismatched googly eyes on its belly, a zipper mouth with yellow jagged teeth, and clutches a half-eaten ballpark hotdog as a club.
- **Locomotion (`chase`)**: Bouncy, crinkly shuffling run with squeaky plastic audio cues.
- **Attack**: Whacks with the hotdog club and tosses slippery yellow banana peels onto the floor (triggers slip-and-spin pinball physics).
- **Death**: Bag ruptures with a cartoon rip; spills crushed aluminum soda cans and crumpled newspapers that act as momentary mini-bumpers.
- **Biome**: Sewer & Factory.

### Monster 3: `toaster_gremlin` (Toaster Gremlin / Pop-Tart Pete)
- **Visual Concept**: Gangly, hunchbacked purple goblin with long rubbery arms and a shiny 1950s 2-slice chrome American countertop toaster for a head. Glowing red-hot heating coils shine through the toaster slots.
- **Locomotion (`kite`)**: Jerky, mechanical stepping stride, keeping distance from the rolling knight.
- **Attack**: Pulls down its side lever with a mechanical "CLINK!", coils flare bright orange, then "DING!" launches twin flaming breakfast pastries (toast missiles) leaving a spark trail.
- **Death**: Heating element short-circuits violently; both burned toasts launch straight into the ceiling while the body collapses into smoking toaster parts and pastry crumbs.
- **Biome**: Factory & Arcade.

### Monster 4: `lip_flapper` (Lip Flapper / Madame Kiss)
- **Visual Concept**: Tribute to Oblina — a tall, spindly black-and-red candy-striped accordion stalk topped with colossal, exaggerated red wax cartoon lips equipped with shiny metal dental braces, wearing a tilted mini-fedora.
- **Locomotion (`orbiter`)**: Smooth serpentine gliding / accordion compression and stretching.
- **Attack**: "THE BIG SLURP" — Opens its giant lips wide to inhale, creating a suction vortex (gravity pull) that drags the pinball knight inward, followed by a loud "SMACK" kiss that plasters cartoon lipstick prints across the screen, confusing/reversing movement controls for 1.5s.
- **Death**: Deflates like an untied balloon with a frantic, whistling raspberry fart sound, rocketing in erratic spiral loops before flattening into a limp rubber sheet on the floor.
- **Biome**: Hall & Arcane.

### Monster 5: `hydrant_hound` (Hydrant Mutt / Buster)
- **Visual Concept**: Classic heavy cast-iron red American city fire hydrant that has sprouted four stocky bulldog paws, drooling bulldog jowls with an underbite, floppy ears made from yellow leather work gloves, and two brass side hose nozzles.
- **Locomotion (`chase`)**: Stubby bulldog trot with loud heavy iron clanking sounds.
- **Attack**: "HYDRO BLAST" — Aggressive charge; when close or impacting a barrier, both side valve nozzles blast pressurized water torrents outward, pushing the player across the room with strong pinball momentum impulse!
- **Death**: Top pentagonal valve nut blows off with a loud "POP!", launching an upward water geyser fountain that douses the surrounding tiles and cleanses nearby hazard pools.
- **Biome**: Sewer & Garden.

---

## 3. Atomic Claim Classification Matrix (VCPM Standard)

| ID | Claim Statement | Classification | Evidence / Source / Validation Path |
|---|---|---|---|
| `CLAIM-1` | `state.ts:EnemyKind` supports adding `"pit_peeper"`, `"dumpster_dan"`, `"toaster_gremlin"`, `"lip_flapper"`, `"hydrant_hound"` | **Verified Fact** | Inspect [`state.ts:360-408`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/state.ts#L360-L408) |
| `CLAIM-2` | All 9 compile-enforced `Record<EnemyKind, X>` tables must be populated for each new kind (`STATS`, `HP_BY_KIND`, `ENEMY_DROPS`, `DMG_BY_KIND`, `MOVEMENT_BY_KIND`, `PAIN_BY_KIND`, `KIND_INFO`, `KIND_STYLE`, `KIND_PORTRAIT`) | **Verified Fact** | Inspect [`ANY_IMAGE_TO_CHARACTER.md:374-387`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/tools/sprite-forge/docs/ANY_IMAGE_TO_CHARACTER.md#L374-L387) |
| `CLAIM-3` | Floor hazard spawning (`spawnFloorFx`) supports floor decals and custom hazard types like banana peel slips and stink clouds | **Verified Fact** | Inspect [`entities/floor-fx.ts:1050-1080`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/floor-fx.ts#L1050-L1080) |
| `CLAIM-4` | Ranged projectiles like toast missiles can be registered in `items.ts:ProjectileKind` union and rendered via existing projectile pipeline | **Verified Fact** | Inspect [`items.ts:27`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/items.ts#L27) |
| `CLAIM-5` | Inward suction (gravity well) and control reverse status effects can be applied to `player.ts` via duration timers (`lipFlapConfusionT`) | **Testable Claim** | Unit test verifying player velocity vector modification during suction and inverted input vectors during confusion |
| `CLAIM-6` | Procedural fallback cel-painters in `render/monsters/` allow full gameplay and test execution before and alongside Sprite-Forge art generation | **Verified Fact** | Inspect [`render/sheet-painters.ts:140-195`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/render/sheet-painters.ts#L140-L195) |
| `CLAIM-7` | Debug chip tags in `gui/screens/debug.ts` must be $\le 8$ characters (`PITPEEP`, `DUMPSTER`, `TOASTER`, `LIPFLAP`, `HYDRANT`) | **Verified Fact** | Inspect [`gui/screens/debug.ts:137`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/gui/screens/debug.ts#L137) |
| `CLAIM-8` | Vitest test shards and build pipeline will compile with zero registry drift | **Testable Claim** | Run `pnpm test` and `pnpm run build` |
| `ASSUMPTION-1` | The 5 monsters should be implemented and tested incrementally or in a phased rollout to ensure art generation quality and balance | **Assumption** | Risk: Scope size. Validation: Clarify rollout preference with user. |
| `ASSUMPTION-2` | Monsters will spawn across depths matching their biomes (Sewer, Crypt, Factory, Hall, Garden) according to `prefabs.ts` theme pools | **Assumption** | Risk: Spawn dilution. Validation: Check themed enemy weights in `prefabs.ts`. |

*Metrics: 6 Verified Facts (60%), 2 Testable Claims (20%), 2 Assumptions (20%), 0 Unverifiable Claims (0%). Passes VCPM $\ge 80\%$ Gate.*

---

## 4. Technical Implementation Steps

### Phase 1: Engine Foundation & Data Contracts
1. Add new kinds to `state.ts:EnemyKind`:
   ```typescript
   | "pit_peeper"
   | "dumpster_dan"
   | "toaster_gremlin"
   | "lip_flapper"
   | "hydrant_hound"
   ```
2. Update the 9 mandatory `Record<EnemyKind, X>` tables:
   - `entities/zombie.ts`: `STATS` (HP, speed, attack intervals, detection ranges)
   - `spawn/factory.ts`: `HP_BY_KIND` and `spawnKind` switches
   - `reagents.ts`: `ENEMY_DROPS` (thematic reagents: Stinky Lint, Banana Peel, Chrome Spring, Wax Lips, Brass Cap)
   - `entities/combat.ts`: `DMG_BY_KIND` and on-death hook branches
   - `entities/enemy-rules.ts`: `MOVEMENT_BY_KIND` (`pit_peeper: "flanker"`, `dumpster_dan: "chase"`, `toaster_gremlin: "kite"`, `lip_flapper: "orbiter"`, `hydrant_hound: "chase"`)
   - `entities/stagger.ts`: `PAIN_BY_KIND` (stagger resistances)
   - `bestiary.ts`: `KIND_INFO` (lore descriptions, tips, quotes)
   - `render/card-styles.ts`: `KIND_STYLE` (card borders, fonts, colors)
   - `render/monster-portrait.ts`: `KIND_PORTRAIT`
3. Wire debug panel in `gui/screens/debug.ts` with 8-char chips.

### Phase 2: Procedural Cel-Painters & Fallback Art
1. Create cel-painters in `ThreeJS/src/game/pinball-knight/render/monsters/`:
   - `pit-peeper.ts`
   - `dumpster-dan.ts`
   - `toaster-gremlin.ts`
   - `lip-flapper.ts`
   - `hydrant-hound.ts`
2. Wire each painter in `render/sheet-painters.ts` and `boot/sheets.ts`.

### Phase 3: Pixel Art Generation & Sprite-Forge Pipeline
1. Generate 4×4 16-bit SNES action sheets on `#FF00FF` magenta or `#00FF00` chroma using Nano Banana (`generate_image`):
   - Row 0: `idle` (4 frames)
   - Row 1: `walk` (4 frames)
   - Row 2: `attack` (4 frames)
   - Row 3: `death` (4 frames)
2. Author prep scripts (`prep-pit-peeper.mjs`, etc.), crop and clean chroma fringes.
3. Commit into `public/sprites/<name>-S.png` and `.json`.

### Phase 4: Unique Mechanics & Hazard Integration
1. `pit_peeper`: Stink cloud hazard on death with speed debuff.
2. `dumpster_dan`: Banana peel floor traps that cause player spinout.
3. `toaster_gremlin`: Toast projectile firing logic and explosive crumbs.
4. `lip_flapper`: Suction pull physics and lipstick kiss control reversal timer.
5. `hydrant_hound`: High-pressure water jet propulsion physics.

### Phase 5: Testing, Merge, & Container Deployment
1. Write dedicated unit tests for all 5 monsters.
2. Verify all 366+ test suites pass across shards.
3. Merge worktree branch to `main` and push to GitHub `origin main`.
4. Run `npm run deploy -- --skip-pull` to redeploy the container to Synology NAS.
5. Verify HTTP 200 OK and container health.
