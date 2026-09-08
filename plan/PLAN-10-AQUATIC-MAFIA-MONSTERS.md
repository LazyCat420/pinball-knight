# Implementation Plan — 10 Aquatic & Mafia Fish Monsters

**Target Project**: `pinball-knight`  
**Date**: 2026-09-07  
**Status**: PLAN ONLY (Awaiting User Review & Approval — DO NOT IMPLEMENT YET)  
**Methodology**: Strictly compliant with [`plan-verification-standard.md`](file:///home/lazycat/github/projects/sun/.agents/plan-verification-standard.md) (VCPM Claim Triage & Quality Gates)

---

## 1. Problem Statement & User Intent

The user requested creating a themed expansion of **10 aquatic sea-creature monsters** inspired by the Old Clam (`clam`) and Knife Crab (`crab`):
> *"can we make 10 more monsters that are like the clam monster but different fish/dolphins/sharks/octopus monsters they all have different weapsons some guns/projectiles/hooks to reel you in like the shark has a fishing pole to try to trap you. the dolphin has legs and arms and is wearing jeans with sunglasses and he tries to punch you, the fish monsters are just different types of tropical fish that are hybrid mafia guys so its like a fish wearing a mob suit with a hat shooting a gun but do like 4 different types of tropical fish for the monsters. make all the monsters like how we did for the others with nano banana for the pinball knight game"*

### Core Themes & Archetypes
1. **The Shark Trapper (`shark_trapper`)**: Great white shark fisherman with a deep-sea casting rod that launches a hook and **reels the knight toward its jaws**.
2. **The Dolphin Brawler (`dolphin_brawler`)**: Bipedal dolphin wearing 90s blue jeans, sneakers, and sunglasses; rushes down the knight with a 3-hit boxing combo and fin uppercut.
3. **The Octopus Mob Boss (`octopus_gunner`)**: Cephalopod Don ("Don Tentacolo") in a pinstripe trenchcoat with 8 tentacles wielding revolvers; 8-way bullet barrage and ink cloud smokescreens.
4. **Tropical Mafia Fish 1 — Clownfish Tommy-Gunner (`clownfish_mob`)**: Orange/white clownfish in pinstripe suit and fedora with cigar; rapid 4-round tommy-gun strafe bursts.
5. **Tropical Mafia Fish 2 — Lionfish Enforcer (`lionfish_mob`)**: Spiky lionfish in mob waistcoat; wide 5-way venom spine shotgun blast inflicting poison slow.
6. **Tropical Mafia Fish 3 — Anglerfish Hitman (`anglerfish_mob`)**: Deep-sea anglerfish in dark trenchcoat; flashes bioluminescent lure (stun pulse) followed by high-velocity magnum snipe.
7. **Tropical Mafia Fish 4 — Pufferfish Capo (`pufferfish_mob`)**: Rotund pufferfish in tight double-breasted suit; fires blunderbuss spike slugs and explodes into a 360° spine ring on death or high-speed pinball impact.
8. **Aquatic Mobster 8 — Swordfish Duelist (`swordfish_mob`)**: Sleek swordfish in Italian silk suit; fires speargun bolts and performs sudden piercing rapier bill lunges.
9. **Aquatic Mobster 9 — Moray Eel Extortionist (`moray_mob`)**: Coiled green moray eel in mob sleeve; dual electric revolver orbs that leave shock hazard pools on the floor.
10. **Aquatic Mobster 10 — Seahorse Tommy-Gunner (`seahorse_mob`)**: Upright armored seahorse in fedora; arcing water mortar cannon that lobs shells over walls.

---

## 2. Monster Roster & Detailed Mechanics

### Summary Table

| ID | EnemyKind | Display Name | Icon | Role | Primary Weapon / Mechanic | Projectile |
|---|---|---|---|---|---|---|
| 1 | `shark_trapper` | Shark Trapper | 🦈 | Hook Trapper | Casts fishing rod, hooks player, and reels player to jaws | `fishing_hook` |
| 2 | `dolphin_brawler` | Dolphin Brawler | 🐬 | Rushdown Boxer | 3-hit boxing combo (jab-cross-uppercut) + pinball launch | Melee |
| 3 | `octopus_gunner` | Octopus Boss | 🐙 | Bullet Hell / Smoke | 8-tentacle radial revolver spray + blinding ink pool | `octo_bullet` |
| 4 | `clownfish_mob` | Clownfish Mob | 🐠 | Burst Skirmisher | 4-round tommy-gun burst + strafe kiting | `fish_bullet` |
| 5 | `lionfish_mob` | Lionfish Mob | 🐡 | Spread Shotgun | 5-way venom spine shotgun + poison slow tick | `lion_spine` |
| 6 | `anglerfish_mob` | Anglerfish Mob | 🐟 | Stun & Snipe | Flashbang lure pulse stun + piercing magnum bullet | `magnum_bullet` |
| 7 | `pufferfish_mob` | Pufferfish Capo | 🐡 | Heavy / Detonator | Blunderbuss spike slug + 360° death spike explosion | `puffer_slug`, `puffer_spike` |
| 8 | `swordfish_mob` | Swordfish Mob | 🗡️ | Duelist | Harpoon speargun bolt + telegraphed rapier lunge | `spear_bolt` |
| 9 | `moray_mob` | Moray Eel Mob | ⚡ | Electric Hazard | Dual shock orbs that leave persistent electric pools | `electric_bullet` |
| 10 | `seahorse_mob` | Seahorse Mob | 🐴 | Arcing Artillery | High-angle water mortar lobbed over dungeon walls | `water_mortar` |

---

### Detailed Behavior Profiles

#### 1. `shark_trapper` (Hook & Reel Trapper)
- **HP**: 24 | **Body Radius**: 0.50 | **Speed**: 0.85 u/s
- **AI Behavior**: Kites at medium range (4.5–6.0 u).
- **Hook Cast**: Casts fishing line with an anchor hook (`fishing_hook`, speed 4.5 u/s, life 1.5s).
- **Tether & Reel**: On connecting with the player, deals 1 snag damage and tethers the knight. Reeling vector pulls player towards shark at 5.5 u/s for 1.2s.
- **Jaws Chomp**: If player enters melee contact ($< 1.0\text{ u}$), shark executes a heavy bite for 3 damage.
- **Counterplay**: Line breaks if player performs a dodge-roll, attacks with any melee weapon, or staggers the shark.

#### 2. `dolphin_brawler` (Rushdown Boxer)
- **HP**: 20 | **Body Radius**: 0.45 | **Speed**: 1.35 u/s
- **AI Behavior**: Aggressive rushdown chase with lateral weave/bobbing.
- **Boxing Combo**:
  - Punch 1 (Left Jab): 0.2s windup, 1 damage.
  - Punch 2 (Right Cross): 0.25s follow-up, 1 damage.
  - Punch 3 (Fin Uppercut): 0.4s telegraphed windup, 2 damage, launches player with pinball bumper force (`p.momSpeed = 6.0 u/s`, vertical hop).
- **Super Armor**: Poise prevents minor stagger during the 3rd punch windup.

#### 3. `octopus_gunner` (Area Denial & Ink Cloud)
- **HP**: 30 | **Body Radius**: 0.55 | **Speed**: 0.70 u/s
- **AI Behavior**: Stately boss-like patrol in room centers.
- **Tentacle Barrage**: Fires 8 bullets radially at 45° increments (`octo_bullet`, speed 2.8 u/s, 1 damage).
- **Ink Smokescreen**: Discharges a dark black ink pool (`FloorFx: "ink"`, radius 2.2 u, duration 4.0s). Inside the ink, knight speed is reduced by 35% and visibility is darkened.

#### 4. `clownfish_mob` (Tommy-Gun Skirmisher)
- **HP**: 14 | **Body Radius**: 0.38 | **Speed**: 1.05 u/s
- **AI Behavior**: Strafes left/right perpendicular to player line-of-sight.
- **Tommy Gun Burst**: 0.35s aim telegraph, then rapid 4-round burst (`fish_bullet`, speed 4.0 u/s, interval 0.08s, 1 damage each).

#### 5. `lionfish_mob` (Venom Spine Shotgunner)
- **HP**: 18 | **Body Radius**: 0.42 | **Speed**: 0.90 u/s
- **AI Behavior**: Approaches to close-mid range (3.0 u).
- **Spine Spread**: Fires 5 venomous spines in a 40° fan (`lion_spine`, speed 3.2 u/s, 1 damage).
- **Venom Debuff**: Hit players suffer a 2.0s poison slow (1 damage tick per second + 20% walk speed penalty).
- **Barbed Hide**: Standing melee attacks deal 0.5 thorn reflection damage to player unless struck at pinball speed ($> 5.5\text{ u/s}$).

#### 6. `anglerfish_mob` (Flashbang & Sniper)
- **HP**: 16 | **Body Radius**: 0.40 | **Speed**: 0.80 u/s
- **AI Behavior**: Stays in shadows at long range ($> 5.0\text{ u}$).
- **Bioluminescent Flash**: Lure glows intensely for 0.6s, then flashes a bright radial pulse (radius 3.8 u). Any knight facing the anglerfish receives a 0.5s screen-flash disorientation.
- **Sniper Shot**: Immediately shoots a high-velocity piercing bullet (`magnum_bullet`, speed 5.8 u/s, 2 damage).

#### 7. `pufferfish_mob` (Blunderbuss & Explosive Detonator)
- **HP**: 26 | **Body Radius**: 0.50 | **Speed**: 0.75 u/s
- **AI Behavior**: Slow, waddling heavy enforcer.
- **Blunderbuss Slug**: Fires a heavy explosive slug (`puffer_slug`, speed 2.6 u/s, 2 damage) that detonates into tiny quills on contact.
- **Spike Nova on Death**: When reaching 0 HP, or when hit by the knight at pinball speed ($> 7.5\text{ u/s}$), swells up with an audible hiss and detonates into an 8-way ring of spikes (`puffer_spike`, 1 damage).

#### 8. `swordfish_mob` (Fencing Lunge & Speargun)
- **HP**: 18 | **Body Radius**: 0.42 | **Speed**: 1.15 u/s
- **AI Behavior**: Mobile duelist, alternates between distance and rapier charges.
- **Speargun Bolt**: Fires a fast straight harpoon (`spear_bolt`, speed 5.0 u/s, 1 damage).
- **Rapier Lunge**: Telegraphed fencing crouch for 0.4s, followed by an instantaneous linear dash thrust (reach 2.8 u, 2 damage) that pierces shield block.

#### 9. `moray_mob` (Electric Shock Trapper)
- **HP**: 17 | **Body Radius**: 0.40 | **Speed**: 1.00 u/s
- **AI Behavior**: Sinuous serpentine movement, weaves around obstacles.
- **Shock Orbs**: Fires twin crackling electric spheres (`electric_bullet`, speed 3.0 u/s, 1 damage) that leave persistent electric pools on the floor (`FloorFx: "shock"`, radius 1.2 u, duration 3.0s).
- **Floor Trap**: Stepping in an electric pool interrupts sprint charge and deals 1 damage.

#### 10. `seahorse_mob` (Arcing Artillery Cannon)
- **HP**: 15 | **Body Radius**: 0.36 | **Speed**: 0.95 u/s
- **AI Behavior**: Floating altitude, hovers gracefully over low obstacles.
- **Water Mortar**: Lobs a high-angle water mortar shell in a ballistic parabolic arc (`water_mortar`, 2 damage) that ignores intervening walls and targets the player's predicted landing zone. Leaves a temporary water puddle.

---

## 3. Atomic Claim Classification Matrix (VCPM Standard)

| ID | Claim Statement | Classification | Evidence / Source / Validation Path |
|---|---|---|---|
| `CLAIM-1` | `state.ts:EnemyKind` defines all enemy families and can accommodate the 10 aquatic kinds | **Verified Fact** | Inspect [`state.ts:360-391`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/state.ts#L360-L391) |
| `CLAIM-2` | `items.ts:ProjectileKind` union supports adding custom projectile types for aquatic enemies | **Verified Fact** | Inspect [`items.ts:27`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/items.ts#L27) |
| `CLAIM-3` | Reverse knockback / reel pull can be executed by setting `p.momX` and `p.momZ` towards enemy origin | **Verified Fact** | Formula in [`entities/magnet.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/magnet.ts) and pinball physics in `sim/simulate.ts` |
| `CLAIM-4` | 3-hit melee combo with multi-stage timers and animations exists in engine | **Verified Fact** | Verified in [`entities/player.ts:210`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/player.ts#L210) and [`entities/combat.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/combat.ts) |
| `CLAIM-5` | Lingering hazard pools on floor can be created using `FloorFx` and `addFloorFx` in `entities/floor-fx.ts` | **Verified Fact** | Inspect [`entities/floor-fx.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/floor-fx.ts) (`hostile: true`) |
| `CLAIM-6` | Radial bullet novas (Octopus 8-way, Pufferfish 8-way) can spawn projectiles with angles $k \cdot \frac{2\pi}{N}$ | **Testable Claim** | Unit test verifying 8 projectiles spawn with equidistant velocity vectors |
| `CLAIM-7` | Arcing mortar projectiles can simulate parabolic height arc $y = 4h \cdot t(1-t)$ and ignore low wall raycasts | **Testable Claim** | Unit test in `aquatic-monsters.test.ts` verifying mortar flight and landing coords |
| `CLAIM-8` | Fishing hook reel pull breaks when player executes dodge-roll (`rollT > 0`) or damages shark | **Testable Claim** | Unit test verifying hook tether cancellation conditions |
| `CLAIM-9` | Debug console and panel labels must satisfy `CHIP_CHARS <= 8` via `LABEL_OVERRIDE` | **Verified Fact** | Verified in [`debug.ts:137`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/gui/screens/debug.ts#L137) |
| `CLAIM-10` | Procedural fallback cel-painters in `render/monsters/aquatic/` provide complete visual coverage even prior to sprite sheet generation | **Testable Claim** | Test verifying each monster paints S/N/E facings without throwing |
| `ASSUMPTION-1` | Aquatic mafia monsters spawn primarily in Water/Aqueduct/Sewer/Ocean biomes starting from Floor 3 onwards | **Assumption** | Risk: Spawn pacing across levels. Validation: Wire level ranges in `keysForFloor` and `spawn/factory.ts`. |
| `ASSUMPTION-2` | 10 monsters can share a consolidated entity module `entities/aquatic-monsters.ts` to keep code footprint compact and maintainable | **Assumption** | Risk: File size. Validation: Modularize helper classes/functions cleanly under 800 lines. |

*Metrics: 6 Verified Facts (50%), 4 Testable Claims (33%), 2 Assumptions (17%), 0 Unverifiable Claims (0%). Passes VCPM ≥80% Gate.*

---

## 4. Proposed Technical Implementation Steps

### Phase 1: Engine Architecture & Registrations
1. **Core Type Definitions**:
   - Update `EnemyKind` in `state.ts` with all 10 kinds.
   - Update `ProjectileKind` in `items.ts` with the new projectile identifiers.
   - Add state fields to `Zombie` in `state.ts` for hook tethering, combo phases, and lure charges.
2. **Constants (`constants/enemies.ts`)**:
   - Declare HP, body radii, movement speeds, attack ranges, windups, and projectile damages for all 10 monsters.
3. **Core Table Registrations**:
   - `entities/enemy-rules.ts`: Movement types (`"chase"`, `"kite"`, `"strafe"`) and momentum gates.
   - `entities/stagger.ts`: Stagger pain resistances (`PAIN_BY_KIND`).
   - `entities/combat.ts`: Melee contact damage (`DMG_BY_KIND`).
   - `entities/zombie.ts`: Add rows to `STATS`.
   - `spawn/factory.ts`: `HP_BY_KIND`, `spawnKind`, `spawnHordeMember`.
   - `spawn/kind-skin.ts`: Visual scales and display tints in `KIND_SKIN`.
   - `bestiary.ts`: Names, lore labels, and icons in `KIND_INFO`.
   - `reagents.ts`: Loot tables in `ENEMY_DROPS`.
   - `debug-panel.ts` & `gui/screens/debug.ts`: Add `LABEL_OVERRIDE` entries ($\le 8$ characters):
     - `shark_trapper`: `"Shark"`
     - `dolphin_brawler`: `"Dolphin"`
     - `octopus_gunner`: `"Octopus"`
     - `clownfish_mob`: `"ClownMob"`
     - `lionfish_mob`: `"LionMob"`
     - `anglerfish_mob`: `"Angler"`
     - `pufferfish_mob`: `"Puffer"`
     - `swordfish_mob`: `"SwordMob"`
     - `moray_mob`: `"Moray"`
     - `seahorse_mob`: `"Seahorse"`

### Phase 2: Entity Logic & Mechanics (`entities/aquatic-monsters.ts`)
- **Hook & Reel Subsystem**: Shark line casting, tether tracking, player pulling force towards shark, line break on roll/hit.
- **Boxing Combo Subsystem**: Dolphin 3-hit sequence with jab/cross/uppercut and vertical pinball launch.
- **Bullet Hell & Spreads**: Octopus 8-way radial spray, Lionfish 5-way shotgun spread, Clownfish 4-round tommy-gun burst.
- **Hazard Deployers**: Octopus ink cloud smokescreen, Moray electric puddles (`FloorFx`).
- **Detonation & Mortar**: Pufferfish spike nova on death, Seahorse parabolic mortar lob.

### Phase 3: Procedural Cel-Painters (`render/monsters/aquatic/`)
- Author procedural cel-painters for all 10 monsters supporting `S`, `N`, `E` facings and `idle`, `walk`, `attack`, `death` animations.
- Register in `render/sheet-painters.ts` and `render/monster-portrait.ts`.

### Phase 4: Sprite-Forge & Pixel Art Pipeline
- When the user approves and the image generation service has capacity, generate 16-bit arcade pixel art sprite sheets for all 10 monsters on chroma `#00FF00`.
- Ingest via `sprite-forge/prep/` scripts and publish to `public/sprites/` and Windows bundle `dist/pinball-knight-windows-x86_64/assets/sprites/`.

### Phase 5: Automated Testing & Verification
- Author `ThreeJS/src/game/pinball-knight/entities/aquatic-monsters.test.ts`.
- Verify:
  - Table registrations across all 10 monsters.
  - Shark hook and reel mechanics, distance cutoff, and line break triggers.
  - Dolphin 3-hit combo and uppercut pinball launch speed.
  - Octopus radial bullet burst and ink cloud duration.
  - Lionfish poison slow application.
  - Anglerfish flash stun and sniper bullet trajectory.
  - Pufferfish death spike explosion.
  - Seahorse parabolic mortar arc.
  - Regression test suites (`lazy-sheets.test.ts`, `bestiary.test.ts`, `debug-console.test.ts`, `debug-panel.test.ts`).
  - Full build check: `npm run build` with 0 errors.

### Phase 6: Push & NAS Redeployment
- Commit changes, merge into `main`, push to GitHub.
- Redeploy to Synology NAS using `npm run deploy`.
- Verify HTTP 200 on all container endpoints.
- Proactively notify user of test readiness for both web container and native Windows executable.

---

## 5. What Is Explicitly Out of Scope
- Modifying Rodrigo's repositories (`prism-service`, `portal-service`, `tool-service`, etc.).
- Adding water swimming physics to the knight (the dungeon remains top-down stone/aqueduct pinball tiles).
- Replacing existing monsters (`clam`, `crab`, `fish_feet` remain untouched as complementary aquatic enemies).

---

## 6. Open Questions & User Review Items
1. **Pacing / Batching Preference**: Would you prefer implementing all 10 monsters at once in a single comprehensive rollout, or in two batches of 5 (e.g., Batch 1: Shark, Dolphin, Octopus, Clownfish, Lionfish; Batch 2: Anglerfish, Pufferfish, Swordfish, Moray, Seahorse)?
2. **Reel-In Trapper Mechanics**: For the Shark's fishing rod, if you get hooked, should you be able to break the line by pressing the Dodge Roll button (Space/Shift) or hitting with your weapon, or should there be a tug-of-war mechanic?
3. **Pufferfish Explosion**: Should the Pufferfish explosion damage other nearby monsters (friendly fire) as well as the player?
4. **Art Generation Timing**: The image generation endpoint reported temporary capacity exhaustion during testing; we can generate procedural cel-painters first so all 10 are immediately playable, then backfill Nano Banana sprite sheets once the endpoint is available, or wait until images generate. Which do you prefer?
