# 🏰 Pinball Knight — Progression Tiers, Boss Roster & Themed Biomes Blueprint

> **Status:** Brainstorming & Architecture Blueprint (Review Only — No Code Implemented)  
> **Target Subsystem:** `ThreeJS/src/game/pinball-knight/` (Items, Bosses, Spawning, Themes & Movesets)  
> **Date:** 2026-09-15  
> **Methodology:** Verified-Claim Plan Methodology (VCPM) & Evidence-Driven Blueprint (`.agents/plan-verification-standard.md`)

---

## 1. Executive Summary & Problem Diagnosis

### 1.1 Observed Symptoms in Existing Code
1. **Unfiltered Item & Power-up Spawning (Level 1 "Mash-Up")**:
   - In `ThreeJS/src/game/pinball-knight/maze/decorate.ts:315-326`, `rollLevelItems(rng)` takes **no floor or level parameter**.
   - `WEAPON_POOL` (9 weapons: `stick`, `mace`, `chair`, `greatsword`, `warhammer`, `wreckingball`, `gun`, `bow`, `flamethrower`) is shuffled uniformly at every depth. A player on Floor 1 can find a Warhammer, Flamethrower, or Wrecking Ball immediately.
   - `POTION_POOL` (10 potions: `rage`, `haste`, `shield`, `gold`, `ballform`, `freeze`, `multiball`, `curveshot`, `magnetcore`, `laser`) is also shuffled uniformly without level gates. Endgame power-ups like `laser` or `ballform` spawn on Floor 1.
2. **Boss Repetition & Reachability Defect**:
   - In `ThreeJS/src/game/pinball-knight/spawn/floor-populate.ts:173-198`, a boss is spawned **on every single floor** to gate the exit.
   - In `ThreeJS/src/game/pinball-knight/boss-kinds.ts:925-942`, `bossForBiome(themeFor(level).name, passFor(level))` selects a boss using `passFor(level)`. On Floors 1–25 (the entire standard cycle), `pass` is always `0`.
   - Consequently, **the same boss spawns 5 floors in a row**:
     - Floors 1–5: Reaper King × 5
     - Floors 6–10: Broodmother × 5
     - Floors 11–15: Overlord × 5
     - Floors 16–20: Archivist × 5
     - Floors 21–25: Dragon × 5
   - The second half of the roster (`cerberus`, `pinball_boss` / Tilt Titan, `trex`, `jade_buddha`, `doppelganger`, `six_armed_god`) **never appears anywhere in the 25-floor cycle**; they only unlock in endless NG+ passes past Floor 26.
3. **Random Monster Spawns Without Maze/Boss Correlation**:
   - In `ThreeJS/src/game/pinball-knight/spawn/factory.ts:740-754`, `themedHordePick` uses `THEME_HORDE_BIAS = 55%`.
   - The remaining **45% of every spawn falls through** to a giant global list checking `level >= FROM_LEVEL`.
   - Because expansion monsters have low level requirements (`BURGER_FROM_LEVEL = 2`, `HIGHWAY_PATROL_FROM_LEVEL = 2`, `DRACULA_FROM_LEVEL = 3`, `CLAM_FROM_LEVEL = 3`), fast-food mutants, 1950s cops, and aquatic mobsters spawn randomly inside the medieval Cold Crypt next to skeletons and the Reaper King.

---

## 2. The 5-Tier Progression Matrix

The 25-floor descent is divided into 5 distinct Tiers (5 floors per tier). Each tier has a dedicated thematic biome, correlated monster ecology, progressive weapon/item pool, tailored potion power-ups, and two distinct boss encounters (Mid-Boss and Tier Apex Boss).

```
Tier 1 (F1–F5)   : Cold Crypt       → Mid: Cerberus (F3)        | Apex: Reaper King (F5)
Tier 2 (F6–F10)  : Rotting Warren   → Mid: Tilt Titan (F8)      | Apex: Broodmother (F10)
Tier 3 (F11–F15) : Bloodworks       → Mid: T-Rex (F13)          | Apex: Overlord (F15)
Tier 4 (F16–F20) : Arcane Deep      → Mid: Jade Buddha (F18)    | Apex: Doppelgänger / Archivist (F20)
Tier 5 (F21–F25) : Magma Abyss      → Mid: Six-Armed God (F23)  | Apex: Ancient Dragon (F25)
```

---

## 3. Detailed Tier Breakdown

### 🛡️ Tier 1: Novice / Scavenger (Floors 1 – 5) — *The Cold Crypt*

- **Biome & Visual Theme**: Gothic catacombs, cold grey flagstones, iron torches, mossy stone walls, ancient sarcophagi.
- **Correlated Bosses**:
  - **Floor 3 (Mid-Boss)**: `cerberus` (Three-Headed Hellhound) — introduces lunging jaw grab, struggle escape mechanic, and hellfire breath.
  - **Floor 5 (Apex Boss)**: `reaper_king` (The Reaper King) — scythe cleaves, orbiting skulls, skull barrage, teleport fire spray.
- **Curated Monster Ecology**:
  - *Primary Horde*: Shambling Zombies (`zombie` sub-types: Shambler, Lurcher, Crawler, Hulk).
  - *Specialists*: `bat` (flying harassment), `ghost` (phasing corridor ambusher), `crawling_hand` (foot-grab pin), `wisp` (elusive blinker), `mimic` (rare treasure disguise).
  - *Strict Exclusions*: Zero modern/urban, fast-food, aquatic, or cyber monsters.
- **Weapon Drops (`WEAPON_TIERS[1]`)**:
  - `stick` (Fast, low durability club — basic scavenged bludgeon).
  - `chair` (Improvised tavern furniture, 360° wide knockback sweep — essential for peeling dense zombie hordes).
  - `bow` (Introductory ranged weapon — 2-target corridor piercing, teaching linear projectile kiting).
  - *(Player always starts with rusty `sword` and fallback `fists`)*.
- **Potions & Power-ups (`POTION_TIERS[1]`)**:
  - `health` (Restores 3 hearts — guaranteed on every floor).
  - `gold` (+25 instant coins — kickstarts early tavern economy).
  - `haste` (Speed & attack cooldown boost — helps navigate early narrow corridors).
- **Movesets & Active Skills**:
  - `flippercharge` (Default Q): Pinball dash — teaches kinetic momentum and wall ricochets.
  - `arcanepulse` (Default E): 360° radial pulse — safety burst when cornered by zombie hordes.

---

### 🕷️ Tier 2: Scout / Vermin Hunter (Floors 6 – 10) — *The Rotting Warren*

- **Biome & Visual Theme**: Toxic sewers, damp brickwork, overgrown moss, spider egg sacs, oiled runways.
- **Correlated Bosses**:
  - **Floor 8 (Mid-Boss)**: `pinball_boss` (Tilt Titan) — giant high-RPM chrome steel sphere, boosted flattening charge, arena ricochet.
  - **Floor 10 (Apex Boss)**: `broodmother` (The Broodmother) — web-slow traps, venom spit, spider add summons.
- **Curated Monster Ecology**:
  - *Primary Horde*: `spider` (fast scurriers), `webspinner` (deploys sticky web hazards), `slime` & `toxic_slime` (acid splits).
  - *Specialists*: `croaker` (leaping swamp hazard), `hound` (line-dash chargers), `rotortail` (buzzing flyers), `sapper` (drains marble charges), `pit_peeper` (stink cloud debuff), `magnet` (disrupts movement).
- **Weapon Drops (`WEAPON_TIERS[2]`)**:
  - Unlocks `mace` (Heavy bludgeon, 45 durability — crushes chitin carapaces and slime cores).
  - Unlocks `gun` (Ballistic firearm, fast 16-speed bullet — high-rate single-target kiting against fast spiders and chargers).
  - *Retains Tier 1 weapons in pool*.
- **Potions & Power-ups (`POTION_TIERS[2]`)**:
  - Unlocks `rage` (2× damage — vital against tankier swarm threats).
  - Unlocks `freeze` (Halts enemies for 6s — critical crowd-control on slippery oiled floors).
  - Unlocks `curveshot` (Bending projectile trajectories — curving bullets/arrows around Warren corners).
- **Movesets & Active Skills**:
  - Unlocks `slickfield` (Spills oil: enemies skid out of control while knight glides with zero friction).
  - Skill Tree Rank 2 node upgrades become affordable.

---

### 🩸 Tier 3: Veteran / Iron Knight (Floors 11 – 15) — *The Bloodworks*

- **Biome & Visual Theme**: Iron foundry, crushing pistons, boxing glove corridors, blood gutters, steam vents.
- **Correlated Bosses**:
  - **Floor 13 (Mid-Boss)**: `trex` (Tyrannosaurus Rex) — shades-wearing beast with brutal tail whip slams and screen-shaking charges.
  - **Floor 15 (Apex Boss)**: `overlord` (Bloodworks Overlord) — dual cleaving axes, ground fissure shockwaves, heavy armor.
- **Curated Monster Ecology**:
  - *Primary Horde*: `brute` (armored juggernauts), `goblin` (aggressive flankers), `pin` (pinball skittle guards).
  - *Specialists*: `bloater` (kamikaze fire exploder), `chomper` (rooted biting chokepoint turret), `jester` (erratic acrobat), `stiltneck` (high-reach striker), `platypus` (iron tail shockwaves), `hydrant_hound`.
- **Weapon Drops (`WEAPON_TIERS[3]`)**:
  - Unlocks `greatsword` (Heavy heft 1.7, wide cleaving arc, 5 base damage — devours clustered brute lines).
  - Unlocks `flamethrower` (Rapid 2-pellet fire hose, 42 ammo — melts dense waves in meat-grinder corridors).
  - *Retains prior weapon pools*.
- **Potions & Power-ups (`POTION_TIERS[3]`)**:
  - Unlocks `shield` (6s invulnerability — panic escape from boxing glove gauntlets and heavy hammer slams).
  - Unlocks `magnetcore` (Vacuum dynamo — rips metal shields and crushes mechanical enemies).
  - Unlocks `regen` (Alchemical craft brew / rare secret room find — slow health restoration).
- **Movesets & Active Skills**:
  - Unlocks `magnetaura` (Pulls ground items, coins, and keys toward the player while in motion).
  - Keystone masteries become accessible in Skill Tree: `bloodprice` (cast with hearts when mana is 0) and `cinderwake` (burn ground at high speed).

---

### 🔮 Tier 4: Master / Void Arcanist (Floors 16 – 20) — *The Arcane Deep*

- **Biome & Visual Theme**: Celestial observatory, octagonal mirror halls, glowing arcane sigils, deep purple/gold crystal pillars.
- **Correlated Bosses**:
  - **Floor 18 (Mid-Boss)**: `jade_buddha` (The Laughing Jade Buddha) — massive leaping belly slam AoE, returning jade fan boomerang.
  - **Floor 20 (Apex Boss)**: `doppelganger` (The Doppelgänger) — corrupted dark reflection of the knight wielding dark pinball charges and void blade flurries (or `archivist` with arcane orb barrages).
- **Curated Monster Ecology**:
  - *Primary Horde*: `golem` (crystalline sentinels), `spitter` (ranged magic bolts), `crystalback` (kinetic reflector).
  - *Specialists*: `necromancer` (raises endless skeleton adds), `warden` (projects protective shields on allies), `medusa` (petrifying gaze), `spinning_top` (armored gyro rammer), `sumo_ninja` (shuriken stumbler), `void_slime` (gravitational singularity).
- **Weapon Drops (`WEAPON_TIERS[4]`)**:
  - Unlocks `warhammer` (Maximum single-target siege devastation: 7 damage, 3.4 knockback, heft 2.1 — pulverizes crystalbacks and stone golems).
  - High-tier dropped gear spawns with pre-socketed monster essence cards (`cards.ts`) and boosted rarity (Rare / Epic).
- **Potions & Power-ups (`POTION_TIERS[4]`)**:
  - Unlocks `ballform` (Full pinball transformation — momentum never bleeds, 3× kinetic ram damage).
  - Unlocks `multiball` (Two echo knights spawn and mirror attacks).
  - Unlocks `venomcoat` & `static` (Weapon coatings for chain-lightning arcs and lethal venom).
- **Movesets & Active Skills**:
  - Unlocks `timecrawl` (Temporal dilation — slows enemy animation and projectiles by 70% for 3s).
  - Unlocks `bladestorm` (5s orbiting ring of razor crescents shredding enemies in close combat).

---

### 🌋 Tier 5: Mythic Champion (Floors 21 – 25+) — *The Magma Abyss*

- **Biome & Visual Theme**: Volcanic caldera, rivers of molten lava, crumbling basalt bridges, fire geysers, brimstone smoke.
- **Correlated Bosses**:
  - **Floor 23 (Mid-Boss)**: `six_armed_god` (Mahadeva Asura) — six bronze arms, roaring mouth fire spray, 6–12 golden dagger fan volley.
  - **Floor 25 (Final Climax Boss)**: `dragon` (The Ancient Dragon) — aerial flight, wide cone inferno breath, molten rockfall.
- **Curated Monster Ecology**:
  - *Primary Horde*: `magma_slime` (fire hazard trail), `bloater` (napalm explosions), volcanic `golem`.
  - *Specialists*: `dracula` & `dracula_bat` (vampire lord siphon and bat form), `corvid_bomber` & `sky_falcon` (aerial dive-bombers dropping napalm/bombs), `zippo` (lighter flame breath), `cigarette` (cherry scorcher).
- **Weapon Drops (`WEAPON_TIERS[5]`)**:
  - Unlocks `wreckingball` (360° sweep, damage scales directly with pinball momentum velocity).
  - Legendary weapons roll with maximum 4 card sockets and elevated upgrade levels (+2 to +4).
- **Potions & Power-ups (`POTION_TIERS[5]`)**:
  - Unlocks `laser` (Beam ricochet form — ultra-high speed wall ricochets slicing entire rooms).
  - Unlocks `elixir` (Full heal + permanent +2 max hearts for the remainder of the run).
  - Unlocks `stoneskin` (50% incoming damage mitigation).
- **Movesets & Active Skills**:
  - Maximum Ability Ranks (Rank 4 & 5).
  - Synergy keystones operating at peak efficiency (`overdrive` momentum cooldown + `kineticfocus` momentum power).

---

## 4. Architectural & Code Blueprint

### 4.1 Tier Mapping Definition (`items.ts`)
```ts
export const WEAPON_TIERS: Record<number, WeaponId[]> = {
  1: ["stick", "chair", "bow"],
  2: ["stick", "chair", "bow", "mace", "gun"],
  3: ["stick", "chair", "bow", "mace", "gun", "greatsword", "flamethrower"],
  4: ["stick", "chair", "bow", "mace", "gun", "greatsword", "flamethrower", "warhammer"],
  5: ["stick", "chair", "bow", "mace", "gun", "greatsword", "flamethrower", "warhammer", "wreckingball"],
};

export const POTION_TIERS: Record<number, PotionId[]> = {
  1: ["gold", "haste"],
  2: ["gold", "haste", "rage", "freeze", "curveshot"],
  3: ["gold", "haste", "rage", "freeze", "curveshot", "shield", "magnetcore"],
  4: ["gold", "haste", "rage", "freeze", "curveshot", "shield", "magnetcore", "ballform", "multiball"],
  5: ["gold", "haste", "rage", "freeze", "curveshot", "shield", "magnetcore", "ballform", "multiball", "laser"],
};

export function tierForFloor(floor: number): number {
  if (floor <= 5) return 1;
  if (floor <= 10) return 2;
  if (floor <= 15) return 3;
  if (floor <= 20) return 4;
  return 5;
}
```

### 4.2 Level Decoration (`maze/decorate.ts`)
Update `rollLevelItems` to accept `floor: number`:
```ts
export function rollLevelItems(rng: () => number, floor = 1): RolledItem[] {
  const tier = tierForFloor(floor);
  const weaponPool = WEAPON_TIERS[tier];
  const potionPool = POTION_TIERS[tier];
  const buffs = shuffled(potionPool, rng).slice(0, 3);
  return [
    ...shuffled(weaponPool, rng).slice(0, WEAPONS_PER_LEVEL).map((id) => ({ kind: "weapon", id })),
    ...GEAR_ITEMS.map((id) => ({ kind: "gear", id })),
    { kind: "potion", id: "health" }, // Guaranteed heal
    ...buffs.map((id) => ({ kind: "potion", id })),
  ];
}
```

### 4.3 Boss Scheduling Engine (`boss-kinds.ts` & `floor-populate.ts`)
Instead of `bossForBiome` returning a single guardian for all 5 floors of a biome, implement a precise floor schedule:

```ts
export const FLOOR_BOSS_SCHEDULE: Record<number, BossKind> = {
  3: "cerberus",
  5: "reaper_king",
  8: "pinball_boss",
  10: "broodmother",
  13: "trex",
  15: "overlord",
  18: "jade_buddha",
  20: "doppelganger", // or archivist
  23: "six_armed_god",
  25: "dragon",
};

export function isBossFloor(floor: number): boolean {
  return floor in FLOOR_BOSS_SCHEDULE;
}

export function guardianFor(floor: number): BossSpec {
  const kind = FLOOR_BOSS_SCHEDULE[floor] ?? fallbackGuardianFor(floor);
  return BOSSES[kind];
}
```

### 4.4 Themed Horde Spawning (`spawn/factory.ts` & `maze/prefabs.ts`)
1. **Strengthen Biome Boundaries**:
   - In `factory.ts`, ensure `themedHordePick` routes 100% of spawns through the active `theme.enemies` table (or raises `THEME_HORDE_BIAS` to 90%+ with remaining 10% strictly drawing from the biome's family pool, NOT from global burgers/cops).
2. **Assign Expansion Monsters to Proper Thematic Biomes**:
   - Aquatic Mobsters (`shark_trapper`, `clownfish_mob`, `octopus_gunner`, `clam`, `crab`) can either:
     - Form an alternate water/aquarium sub-biome, OR
     - Group with Warren sewers / Arcane fountains.
   - Cyber / Cops (`highway_patrol`, `riot_cop`, `robo_cop`) can correlate to a dedicated machinery theme or bonus floor.
   - Fast-Food Mutants (`burger`, `fries`, `milkshake`, `hotdog`) can appear in special kitchen/tavern deltas or Warren food traps.

---

## 5. Verification Plan (Pre-Execution Test Matrix)

1. **Unit Tests (`items.test.ts`)**:
   - Verify `tierForFloor(1..5) === 1`, `tierForFloor(6..10) === 2`, etc.
   - Verify `rollLevelItems(rng, 1)` NEVER produces warhammer, flamethrower, or wreckingball.
   - Verify `rollLevelItems(rng, 1)` NEVER produces laser, ballform, or multiball.
   - Verify `rollLevelItems(rng, 25)` can produce full arsenal.
2. **Boss Roster & Reachability Tests (`boss-roster.test.ts` & `unlocked-depths.test.ts`)**:
   - Verify that all 11 bosses appear within the first 25 floors.
   - Verify that NO boss is fought twice on consecutive floors.
   - Verify depth select metadata accurately displays the exact boss for floors 3, 5, 8, 10, 13, 15, 18, 20, 23, 25.
3. **Monster Theme Cohesion Tests (`spawn/factory.test.ts`)**:
   - Spawn 1000 monsters on Floor 1–5: Assert 0 fast-food, 0 cops, 0 alien robots.
   - Verify that all spawned monsters match `THEMES.crypt.enemies`.

---

## 6. Open Design Decisions & Questions for User Feedback

1. **Non-Boss Floors (Floors 1, 2, 4, 6, 7, 9, etc.)**:
   - Currently, every floor's stairs are locked by a boss.
   - **Question**: On non-boss floors, should the stairs be:
     - **Option A (Recommended)**: Guarded by an **Elite Champion / Mini-Boss** (e.g. an oversized Hulk Zombie, Elite Brood Spider, or Golem Sentinel with extra HP and a mini skull badge)?
     - **Option B**: Unlocked immediately upon clearing 60% of the room's horde or finding a dungeon key?
2. **Boss Rotation for The Arcane Deep (Floor 20)**:
   - Arcane Deep currently has 3 bosses: `archivist`, `jade_buddha`, and `doppelganger`.
   - With Jade Buddha at Floor 18, which boss should be the Floor 20 Apex Boss?
     - **Option A (Recommended)**: `doppelganger` (Dark mirror reflection of the knight — dramatic climax).
     - **Option B**: `archivist` (Scholarly spellcaster with arcane orb rings).
3. **Expansion Monsters (Aquatic Mobsters, Cops, Fast-Food Mutants)**:
   - The codebase has ~30 expansion monsters (aquatic fish mafia, cartoon burgers/fries, cops).
   - **Question**: Would you like these segregated into secret/bonus rooms and distinct themed floors, or integrated into specific tiers (e.g., Fast Food & Cops in Warren sewers, Aquatic in an Arcane sunken temple)?
