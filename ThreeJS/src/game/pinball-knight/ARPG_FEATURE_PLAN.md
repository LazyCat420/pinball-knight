# ARPG feature research & plan — Halls of Torment / Diablo 2 / Path of Exile / Enter the Gungeon

_Written 2026-07-26. Two halves: **Part A** is the research (what each reference
game actually does, and which of it survives contact with a momentum game),
**Part B** is the build plan (waves, seams, effort/risk, test gates)._

Every claim about this codebase was checked against the source in
`src/game/pinball-knight/` on the date above. Paths are relative to that folder
unless noted. **The folder moved** — several memory notes and older docs still
say `src/scenes/dungeon/`; that path no longer exists.

---

## 0. Read this first — what is ALREADY shipped

The repeated failure mode in this project's plan docs is re-proposing something
that already exists under a different name. Everything in this table is live in
the working tree. **Do not put any of it in a feature list.**

| Reference-game mechanic you might reach for | Already here | Where |
|---|---|---|
| Gungeon **dodge roll** with i-frames on the front half, direction locked at commit, wall-vault | shipped | `entities/player.ts:347-435` (`ROLL_DURATION`, `ROLL_IFRAMES`, tumble trail) |
| D2 **corpse recovery** — die, your kit stays on the floor, go get it | shipped | `corpse-run.ts` (`CorpsePile`, `MAX_PILES_PER_FLOOR=12`, `canLoot`) |
| D2 **socketed items** — gear with slots you fill with modifiers | shipped as **cards** | `cards.ts` (`socketCard`, `aggregateCards`), `SLOTS_BY_RARITY` `items.ts:94` |
| D2 **item rarity ladder** (common→legendary) | shipped, but see §B2 | `items.ts:89-135` (`rollItemRarity`) |
| D2 **upgrade gamble** — stronger, but it can shatter the item | shipped | `items.ts:214-330` (`UPGRADE_SAFE_LEVEL=3`, `breakChance`, `insuredCards`) |
| D2 **gambling for kit / vendors / stash** | shipped as the **tavern** | `tavern.ts` (7 vendor counters), `../../scenes/tavern/` |
| D2 **Horadric-cube-style crafting** | shipped for potions | `reagents.ts` + `recipes.ts` (`canCraft`, flasks, gold cost) |
| PoE **passive tree** | shipped as run-scoped **skill tree** | `skills.ts` (12 nodes, 3 branches), `skill-runtime.ts` |
| PoE-ish **permanent meta-progression** | shipped as **legacy perks** | `legacy.ts` (5 gold-bought perks) |
| PoE **flask belt** | shipped | `economy/shop.ts:64-100` (`addToBelt`, `useBeltSlot`) |
| PoE **map mods** — a floor rolls modifiers that change its rules | shipped, but see §B1.3 | `maze/modifiers.ts` (6 modifiers, announced on the descent card) |
| HoT **bestiary / kill tracking** | shipped | `bestiary.ts` (`buildBestiary`, `bestiaryProgress`) |
| HoT **active abilities on cooldown + mana** | shipped | `abilities.ts` (6 abilities, Q/E slots, `getMana`) |
| HoT **run grade / score** | shipped | `gradeFloor()` `core.ts:1750`, `run-score.ts`, leaderboard POST |
| Gungeon **unkillable pursuer** | shipped as the **Death Dealer** | `spawnReaper()` `core.ts:1723`, timer-triggered via `REAPER_AFTER` |
| Gungeon **enemy variety through stat bundles** | shipped as **zombie sub-types** | `zombie-types.ts` (8 sub-types, pure multiplier bundle) |
| Floating damage numbers, blood, fog of war, minimap, co-op, boss | all shipped | `render/damage-text.ts`, `render/vfx.ts`, `fog.ts`, `hud-minimap.ts`, `coop.ts`, `boss.ts` |
| **Per-tile terrain physics** — walls and floors made of different materials | shipped 2026-07-26 | `engine/surfaces.ts`, `maze/surface-paint.ts`; see the note below |

Current content scale, for calibration: **22 enemy families** (`EnemyKind`,
`state.ts:277`) × 8 zombie sub-types, **25 monster cards** across 5 rarities
(`cards.ts:103`), **12 weapons** (`items.ts:136`), **16 potions**, **18 pinball
part kinds**, **5 floor archetypes**, **6 floor modifiers**, **6 abilities**,
**12 skill nodes**, **5 legacy perks**.

### Update 2026-07-26 — the surface system landed

Written after this document, and it changes what §B1.3 costs. Walls used to be
pure geometry: `Grid.t` said wall-or-floor, `Grid.shapes` said what shape, and
every physical property was a global constant or derived from topology, so
every wall in the game bounced identically and every floor dragged identically.

`Grid.surfaces` is now one byte per tile. Solid tiles read it as a
**WallSurface** (stone / rubber / ice / mud / brass — restitution, bounce-add,
corner gain, combo ticks), walkable tiles as a **FloorSurface** (stone / ice /
sand / steel / flowstone — friction, steering grip, walk speed). `moveCircle`
reports the struck tile's surface as `MoveResult.hitSurface`; `player.ts`
applies it at both bounce paths and at friction/steer/walk.
`maze/surface-paint.ts` stamps materials as contiguous patches from a floor
modifier's `surfaceMix`, on its own derived RNG so layouts stay bit-identical.
Index 0 of both tables is exactly neutral, so an unpainted floor plays as it
always did.

**What this unlocks:** every "the floor is made of X" idea in §B1.3 is now a
table entry rather than a system. `Frozen` and `Silted` shipped with it as
proof; `Magnetised`, `Brittle` and friends are the same shape. It does NOT
change the §B1.3 work itself — the modifier roll is still a roll, not a bet.

### The ranking filter used throughout this document

This is not an ARPG. It is a **momentum game wearing ARPG clothes**. Every
candidate below was scored against one question:

> Does it give the player a reason to go **faster**, take a **worse line**, or
> **commit** to a ride they can't cancel?

A mechanic that makes you stop and read a stat block is a tax on the core
fantasy. A mechanic that makes you take the bumper lane instead of the safe
corridor is the point. Two otherwise-excellent D2 systems (resistances,
immunities) fail this filter and are recommended against in §B5.

---

# PART A — Research

## A1. Halls of Torment — the retro-Diablo survivors-like

**The pillar:** it is *Vampire Survivors* with Diablo's clothes and an RPG's
legibility. Its reviewers consistently name the same reason it works: unlike
Vampire Survivors, **you are not at the mercy of the offer** — you retrieve
items from successful runs and equip them *before* descending, so a run starts
from a deliberate build rather than from a random draw. Build variety comes
from *predetermined synergies you set up*, not from the roll.

**Mechanics worth stealing:**

1. **The trait pool with tiered branches.** Traits have ranks (I–V). Each tier
   offers **two branches; you pick one and the other is locked out until the
   next tier**. Elevated traits only enter the pool at higher level. The pool
   *depletes* — once exhausted, base traits fill in. `Potion of Oblivion`
   removes an unwanted branch from the pool entirely, which is the player's
   lever on their own RNG.

   *Why it matters to us:* our `skills.ts` tree is **static** — every run spends
   points into the same 12 nodes in roughly the same order. There is no draft,
   no exclusion, no reason for two runs to diverge. This is the single largest
   "why does every run feel the same" gap in the game.

2. **Abilities from tomes at fixed hall locations**, plus scrolls dropped by
   elites. The ability is a *found object*, not a purchase.

3. **Agony / Shrine of Torment** — a dynamic difficulty meter that climbs
   automatically (~1 level per 5 minutes) and raises enemy stats, XP and rare
   drop rates together. Difficulty is a **dial with a payout**, not a menu
   setting.

4. **Character identity is mechanical, not cosmetic.** The Shield Maiden scales
   off Block Chance; the Exterminator wants burn; the Warlock wants summons.
   Eleven characters is eleven different build-space entrances.

5. **A transparent stat sheet** — base (white) vs final (green), with the
   formula stated: `FINAL = (base + bonus) × (1 + multipliers)`. Crit/DoT
   chances can exceed 100% and "overcrit". Legibility *is* a feature here.

**What does not transfer:** the survivors-like auto-attack loop. Our combat is
aimed and committed (heft, windup, recovery — `items.ts:60-80`), and that is
better for a momentum game.

## A2. Diablo 2 — itemization as the whole game

**The pillar:** the item *is* the build. Character level gates almost nothing;
what you found gates everything.

**Mechanics worth stealing:**

1. **Prefix/suffix affixes.** Magic items roll 25% prefix only / 50% suffix
   only / 25% both; rares roll up to 3 of each for six total. Each affix has
   its own weighted frequency and its own level gate. The consequence is that a
   *white* item is a lottery ticket, and two items with the same name are
   different objects.

   *Why it matters to us:* we have **no affix system at all** (`grep affix` →
   zero hits). A dropped Mace is bit-identical to every other Mace except for
   its rarity's socket count. Rarity currently buys **only card slots**
   (`SLOTS_BY_RARITY`, `items.ts:94`), and **gear doesn't even have rarity** —
   `GEAR` (`items.ts:342`) is three fixed entries with a fixed `absorb`.

2. **Rune words.** Specific runes, **in a specific order**, in a socketed item
   of the right type → a named item with bonuses far beyond the sum of parts.
   This is the mechanic that makes players hunt a *combination* rather than a
   stat.

   *Why it matters to us:* `WeaponState.cards` is an **ordered array** and
   `aggregateCards` already walks it (`cards.ts:191`). A "card word" is
   ~60 lines and needs no new data model.

3. **Magic find** — uncapped, with diminishing returns past ~v1.09 rates. A
   whole build axis that is not damage.

4. **Champion / unique monster packs with affixes** — Extra Fast, Cursed,
   Lightning Enchanted, Might aura. A pack you can *read from across the room*
   and decide to skip or fight.

   *Why it matters to us:* `ZombieTypeDef` (`zombie-types.ts:36`) is explicitly
   documented as "a multiplier bundle, not an EnemyKind". A monster affix is
   the same shape, applied on top. The data model is already the right one.

5. **Difficulty tiers** (Normal/Nightmare/Hell) that re-gate the whole item
   pool. NG+ as content, not as a slider.

**What does not transfer:** resistances and immunities. See §B5.

## A3. Path of Exile — combinatorics as content

**The pillar:** GGG's answer to "how do we ship 10,000 builds" is not to author
10,000 things; it is to author ~200 things that *multiply*.

**Mechanics worth stealing:**

1. **Support gems.** A support gem doesn't add a stat — it **changes what the
   skill does**: chain, fork, spell-cascade, cast-on-crit. In PoE 2 supports
   got a tier system where higher tiers carry *secondary effects* that create
   unique interactions with specific skills.

   *Why it matters to us:* every one of our 25 cards is an entry in a flat
   `CardModifier` struct (`cards.ts:32-59`) — 13 numeric fields. `bolt?: boolean`
   is the only card that changes *behaviour*, and it's a special case in
   `combat.fireBolt`. Cards are additive stat chips; they never make the
   weapon do a different thing. That is the ceiling on our build space.

2. **Currency is crafting.** There is no gold sink; the currency *is* the
   modification. Same inputs always give the same outputs at a vendor, so there
   is a deterministic floor under the gambling.

   *Why it matters to us:* `reagents.ts` + `recipes.ts` already implement this
   shape for potions. Extending it to cards/items is an extension, not a new
   system.

3. **Map mods as a bet.** You choose which mods to roll onto a map; nastier
   mods pay more. Difficulty is authored by the player.

   *Why it matters to us:* `maze/modifiers.ts` already computes exactly the
   right multipliers (`hordeMult`, `torchMult`, `hazardMult`, `bonusItems`,
   `dealBias`) and already announces them on the descent card — **but the
   player has no say**. It is rolled from the floor seed. Turning that roll
   into a choice is the cheapest large win in this entire document.

4. **Ascendancy** — one mid-progression irreversible specialization that
   re-frames the build.

**What does not transfer:** the 1,300-node passive tree and the trade economy.
Both need a player population and a spreadsheet culture we don't have.

## A4. Enter the Gungeon — the risk dial

**The pillar:** almost every source of power in Gungeon costs something
legible, and the cost compounds.

**Mechanics worth stealing:**

1. **Shrines.** One-shot Faustian bargains scattered through the floor. The
   real list is the best idea bank in this document:

   | Shrine | Input | Effect |
   |---|---|---|
   | Ammo | free | refill all ammo, **+3.5 curse** |
   | Fallen Angel | 1 heart container | +25% damage, **+1.5 curse** |
   | Cleanse | money (5 per curse point) | set curse to 0 |
   | Blood | 1 heart container | drain nearby enemies to heal |
   | Challenge | free | fight 3 waves → chest |
   | Dice | free | **one random positive AND one random negative**, from 14 |
   | Glass | free | 3 stones that block bullets but shatter on any damage |
   | Peace | your current gun | heal 1 heart |
   | Y.V. | 10 money, +10 each use | weapons randomly fire 2–4 bonus shots |
   | Junk | a junk item | an armour piece |
   | Hero | free | **sets curse to 9** |

   *Why it matters to us:* we have **zero shrines** (`grep shrine|altar` → zero
   hits). There is no place in the game where you choose to make yourself
   weaker for a payout. Every current power source is strictly positive except
   the weapon-upgrade gamble.

2. **Curse as a hidden compounding stat.** Curse makes enemies "Jammed" —
   glowing red-black, `hp × 3.5 + 10`, 50% faster move and fire, 33% shorter
   cooldowns, contact damage added, **but far better rewards**. At **10 curse
   the Lord of the Jammed spawns**: unkillable, chases you forever, and locks
   the shop out.

   *Why it matters to us:* the punisher **already exists**. `spawnReaper()`
   (`core.ts:1723`) builds an unkillable blood-red reaper that closes on you
   forever and is only escaped by the stairs. Today it is triggered by a timer
   (`REAPER_AFTER`). Giving it a **second trigger** is a one-line change, and
   Jammed enemies are a multiplier bundle on top of `zombie-types.ts`.

3. **Synergies.** Named, authored interactions between specific item pairs —
   not stat stacking. Finding a synergy feels like finding a secret.

4. **Master Rounds** — clear a floor without taking damage → permanent +1
   heart for the run. A skill reward, priced in nothing.

5. **The dodge roll's exact shape** — ~0.7s, invulnerable for the *first half
   only*, direction committed at input, 3 contact damage, table-slides. Worth
   recording because **we already match this design** (`player.ts:347-435`), and
   the front-half-only i-frames are the part people get wrong.

**What does not transfer:** bullet-hell density. Our camera is isometric with
occluding walls; a screen full of projectiles would be unreadable.

---

# PART B — The plan

Four waves, ordered by (value ÷ effort) and by how much they reuse a seam that
already exists. Each wave is independently shippable and independently
revertible.

## B1. Wave 1 — the risk layer (highest value, lowest effort)

The game has no downside economy. Every upgrade is free upside, so there is
never a decision, only an acquisition. This wave adds the three places a player
can choose to be in more trouble.

### 1.1 Shrines — `shrines.ts` (new) + `maze/decorate.ts`

Five to seven shrines, one per floor, placed as a landmark. The floor already
has exactly the right placement primitive: `stampLandmark()`
(`maze/prefabs.ts:637`) reserves a `ClaimRect[]` before the scatter passes run
— the assembly-placer plan (`NEXT_WAVE_PLAN.md` Track 2) documents why that
reserve-early ordering is load-bearing.

Proposed roster, adapted so each one bites on **momentum** rather than on ammo:

| Shrine | Input | Effect |
|---|---|---|
| **Anvil of Haste** | 1 heart | +20% damage for the run, **+2 curse** |
| **The Wheel** | free | one random buff **and** one random hex, drawn from a 12-entry table |
| **Blood Font** | 1 heart | drain every enemy within 8 tiles for HP, once |
| **Cleansing Basin** | 8 gold per curse point | curse → 0 |
| **The Gauntlet** | free | seals the room, 3 waves, → guaranteed epic+ card |
| **Glass Bearings** | free | 3 orbiting stones that block one hit each and shatter on any damage taken |
| **The Wager** | current weapon | a random weapon two rarities higher, unidentified |

Each shrine is a `PinballPartKind`-adjacent prop with a one-shot interaction —
the vault/chest interaction in `lamp-puzzle.ts` is the closest existing
precedent for "a floor prop that opens a modal choice".

**Effort:** ~1 session. **Risk:** low — new file, one decorate hook, no
existing behaviour changes.

### 1.2 Curse — `curse.ts` (new), wired to the Death Dealer

A single `state.curse: number`, sources and sinks in one file.

- Enemies roll **Jammed** at `min(0.05 × curse, 0.5)`. A Jammed enemy is a
  multiplier bundle applied over `ZombieTypeDef` — `hp × 3, speed × 1.4,
  damage × 1.5, dropMult × 3`, plus a red-black `baseTint`. Because
  `zombie-types.ts` is already "a stat bundle, not a kind", this composes: a
  Jammed Hulk is a real thing with no new enemy authoring.
- At **curse ≥ 10**, call the existing `spawnReaper()`. That function already
  does everything needed — unkillable, closes forever, cleared by the stairs
  (`core.ts:1723-1741`). Add a second call site next to the `REAPER_AFTER`
  timer and a distinct toast.
- At curse ≥ 10 the tavern merchant refuses to trade, mirroring Gungeon's
  shopkeeper. `tavern.ts:789 openVendorCounter()` is the one gate.
- **Curse must be visible.** Gungeon hides it and it is the most-complained-about
  thing about the mechanic. Put it on the HUD strip (`hud-wolf.ts` already owns
  a top strip for rampage/buffs).

**Effort:** ~half a session. **Risk:** low-medium — touches spawn, which the
co-op determinism tests (`coop-determinism.test.ts`) pin. Jam rolls must come
from the **seeded** floor RNG, not `Math.random()`, or co-op desyncs.

### 1.3 Descent contracts — turn `maze/modifiers.ts` from a roll into a bet

The highest value-per-line item in this document.

`maze/modifiers.ts` already defines six modifiers as pure multiplier bundles
over budgets `core.ts` computes, with an explicit design guarantee that
"nothing here can affect connectivity". Today it is rolled from the floor seed
and merely *announced*.

Change: at the tavern notice board, before descending, show **three offered
modifiers** and let the player stack any subset. Each carries a payout —
`goldMult` / `cardDropMult` / `curseDelta`. Blackout already gives
`bonusItems: 2` for `torchMult: 0.45`; that is the shape, it just isn't a
choice yet.

This needs: a `payout` field on `FloorModifier`, a stacking rule (multiply
multipliers, cap `hordeMult` so the horde budget can't blow past the 175-actor
cap), a board UI panel, and support for **more than one active modifier** —
the current code path assumes zero or one.

Add 4–6 more modifiers while in there, since the marginal cost is a table
entry: *Magnetised* (every wall banks you), *Brittle* (all walls breakable, all
enemies +50% damage), *Feast* (triple horde, triple drops), *Silent* (no
minimap, +2 card drops).

**Effort:** ~1 session. **Risk:** low — the module is DOM-free and tested
(`modifiers.test.ts`), and the multipliers are already clamped downstream.

### 1.4 Flawless floor → Master Round

Clear a floor without taking damage → permanent +1 max heart **for the run**.
`gradeFloor()` (`core.ts:1750`) already grades pace/carnage/style at exactly
the right moment; damage-taken is already tracked for the grade's inputs. This
is ~20 lines and it is the best possible reward for the skill the game actually
teaches.

**Effort:** ~1 hour. **Risk:** none.

## B2. Wave 2 — itemization depth (the D2 wave)

### 2.1 Affixes on weapons and gear

The gap: rarity buys socket count and nothing else, and gear has no rarity at
all. Two Legendary Warhammers are the same object.

Design, deliberately scoped to reuse the vocabulary we already have:

- An `Affix` is `{ id, label, kind: "prefix" | "suffix", tier, fromFloor,
  weight, modifier: CardModifier }`. **`CardModifier` is reused verbatim**
  (`cards.ts:32`) — 13 fields already plumbed through `aggregateCards` into
  every damage site. No new maths, no new display code.
- Roll count by rarity: common 0, rare 1, epic 2, legendary 3 — mirroring D2's
  prefix/suffix split (a prefix and a suffix can't both be the same slot).
- Gate affix tiers by floor, D2's `alvl` in miniature: `fromFloor` on the affix,
  filtered in the roll. This is what makes a deep-floor drop worth the trip.
- **Gear gets rarity too.** `GEAR` (`items.ts:342`) becomes rollable, with
  `absorb` scaling by rarity — that alone fixes "helmets stop mattering after
  floor 2".
- Name generation is the cheap dopamine: `"Vicious Warhammer of the Bear"`.

**Effort:** ~1 session. **Risk:** medium — touches the drop path
(`economy/loot.ts`, `maze/decorate.ts` armoury roll) and every place a
`WeaponState` is serialized (`corpse-run.ts` `CorpseItem`, co-op item sync
`coop.ts:366`, settings save). Bump the save-shape validation in
`settings-save.ts` / `corpse-run.ts` or old saves will fail-soft into empty.

### 2.2 Card words (D2 rune words × Gungeon synergies)

`WeaponState.cards` is an ordered array. A card word is a table:

```ts
{ id: "thunderhead", cards: ["wispspark", "tempestcrown", "crystalshard"],
  weapon: "melee", label: "THUNDERHEAD",
  bonus: { critChance: 0.25, bolt: true, damageMult: 1.4 } }
```

Checked in `aggregateCards` (`cards.ts:191`) after the per-card fold. Ship
8–12 words: some order-sensitive (true rune-word rules), some order-free pairs
(Gungeon synergies). The holo card renderer (`render/holo-card.ts`) and the
socket picker already exist; the word just needs a banner in the weapon panel
and a discovery toast.

This is the **best value-to-effort item in the whole document**: it multiplies
the existing 25-card roster into a combination space, needs no new data model,
and it is exactly the "finding a combination, not a stat" feeling both D2 and
Gungeon are famous for.

**Effort:** ~half a session. **Risk:** low — pure logic, colocated test.

### 2.3 Magic find, and a card-transmute recipe

- **`findMult`** as a new `SkillModifier` field, threaded into `rollCardDrop`
  (`cards.ts:312`) and `rollItemRarity` (`items.ts:118`). Sources: a skill node,
  a legacy perk, a shrine, an affix. Uncapped with soft diminishing returns, per
  D2. Gives the build a second axis that isn't damage.
  ⚠️ `rollCardDrop` has a documented trap: the affinity `rand()` is drawn
  *inside* the pick specifically so the drop **rate** doesn't move
  (`cards.ts:327-336`, pinned by `cards.test.ts`). A find multiplier must be
  applied at the same point in the stream or it will silently change drop rates.
- **Transmute:** 3 cards of rarity N → 1 of rarity N+1. `recipes.ts` already
  models input/output crafting; `lowerRarity()` already exists in `cards.ts:259`,
  so the upward function is symmetric. This is the sink for the 40 commons a
  deep run accumulates.

**Effort:** ~half a session each. **Risk:** low.

### 2.4 Champion packs

A `ChampionAffix` bundle applied to a spawn group, on top of kind and sub-type:
*Fleet* (×1.6 speed), *Ironhide* (×3 hp, ×0.7 speed), *Volatile* (explodes on
death), *Leech* (heals nearby foes), *Anchored* (immune to knockback — the one
that genuinely threatens a pinball build). Champions carry a visible aura tint
and drop `×4`.

This is where the difficulty *should* come from as floors deepen — right now
depth scaling is mostly "more of them, faster" via `LevelConfig`.

**Effort:** ~1 session. **Risk:** medium — spawn path + co-op determinism again.

## B3. Wave 3 — run-to-run variety (the HoT wave)

This wave answers "why does run 30 feel like run 3".

### 3.1 Trait draft on level-up

Replace the point-spend on a static tree with an **offer**. On level-up, draw
3 traits from a run-scoped pool; picking one **locks out** the tier's other
branch (HoT's rule, and it is the rule that makes the choice matter).

Keep `skills.ts`'s 12 nodes as the *guaranteed* backbone — they are the
teaching tree — and layer ~40 drafted traits above them. Author traits as
`SkillModifier` entries (`skills.ts:24`) so `aggregateSkills` needs no change;
the whole change is in the **offer and lock** layer, not the maths.

Add HoT's `Potion of Oblivion` analogue as a tavern purchase: remove a trait
branch from your pool permanently for this run. Player agency over their own
RNG is the thing HoT gets praised for.

**Effort:** ~1-1.5 sessions (40 traits is mostly authoring). **Risk:** low-medium
— `skills.test.ts` and `skill-runtime.ts` pin the aggregate; the UI in
`menu.ts` needs a new panel.

### 3.2 Champions of the order — pick your knight

Four starting knights, each a different entrance into the build space:

| Knight | Start kit | Skew |
|---|---|---|
| **Knight** (current) | sword, balanced | the baseline |
| **The Ram** | warhammer, +hp, −speed | momentum damage, `momentumScaling` |
| **The Quick** | bow, +speed, −hp | pierce/lane play, roll cooldown down |
| **The Adept** | staff/gun, +mana, starts with an ability | `abilities.ts` build |

`armor-styles.ts`, `render/knight-look.ts` and `knight-sheets.ts` already do
parametric knight art keyed on `weapon|look` with an LRU sheet cache, so the
art cost of a fourth knight is a palette and a starting `WeaponId` — not a
sprite sheet. Pair it with a legacy-perk unlock so it's a meta-progression
reward.

**Effort:** ~1 session. **Risk:** low.

### 3.3 Torment tiers (Agony + NG+)

One integer, `state.torment`, chosen at the notice board and unlocked by
clearing depth N. Each tier multiplies enemy hp/speed/damage **and** XP, gold,
drop rate and max card rarity together — HoT's Agony, which is the cleanest
version of this idea because the payout is baked into the same dial.

Pair with **descent shortcuts**: `loadResumeFloor` / `saveResumeFloor`
(`corpse-run.ts:209-227`, already called from `core.ts:1550`) means the game
*already persists* how deep you got. Exposing "start at floor 5" at the board
is mostly UI. This is Gungeon's elevator, and it is the fix for the deep-run
grind that Torment tiers would otherwise create.

**Effort:** ~1 session. **Risk:** low.

### 3.4 A real stat sheet

HoT's base-white/final-green sheet, with the formula printed. `menu.ts`
already has a Stats panel; today it shows run counters, not derived stats. The
player currently cannot see what their cards are actually doing — with affixes,
card words and traits landing, that becomes untenable.

**Effort:** ~half a session. **Risk:** none. **Do this in the same wave as
3.1 — not later.** Every wave above adds an invisible multiplier.

## B4. Wave 4 — research spikes (not scheduled)

### 4.1 Support cards (the PoE gem-link idea)

The highest ceiling and the most work. Split cards into:

- **Essence cards** — today's 25, flat `CardModifier` stats.
- **Support cards** — change *behaviour*: `chain` (hits arc to a second foe),
  `fork`, `nova` (hits become a small AoE), `ignite` (damage becomes a DoT),
  `echo` (a swing repeats at 40%), `siphon` (kills refund mana).

Two reasons this is a spike and not a plan: (a) each support needs a real hook
in `entities/combat.ts` / `entities/projectiles.ts`, not a table entry — this is
6–10 discrete engine changes; (b) socketing supports into *abilities*
(`abilities.ts`) rather than weapons is a second UI surface. `bolt?: boolean`
(`cards.ts:53`) is the existing proof-of-concept for exactly one of these, and
it is worth reading `combat.fireBolt` before committing, to see what one
behaviour card actually costs.

**Worth doing eventually.** It is the difference between a build space that
multiplies and one that adds.

### 4.2 Flask-style belt recharge

PoE flasks refill from kills, so you use them constantly instead of hoarding
them. `economy/shop.ts`'s belt is consumable-based, and the predictable result
is a player who ends a run with six unused potions. Charge-on-kill is a small
change to `useBeltSlot` with a large behavioural effect. Cheap; folded into any
wave.

### 4.3 An unidentified-item / gamble vendor

D2 gambling: buy an item you cannot see. The tavern has the vendor frame
(`tavern.ts:789`) and `rollItemRarity` already exists — this becomes real the
moment affixes (§B2.1) land, and is pointless before then.

## B5. Explicitly recommended AGAINST

- **Resistances and immunities (D2).** They fail the momentum filter twice: a
  resistance check is invisible at speed, and an immunity forces you to stop and
  switch weapons — the exact opposite of a committed ride. D2's own community
  regards Hell immunities as its worst-aged mechanic.
- **A second currency.** Gold, reagents, flasks and cards are already four
  economies. PoE's orb economy works because it *replaced* gold, not because it
  sat beside it. If card transmute (§B2.3) lands, it is the crafting currency.
- **A big passive tree.** PoE's 1,300 nodes need build guides to be legible.
  Our answer to combinatorial depth should be **card words** (§B2.2) and
  **support cards** (§B4.1) — depth from multiplication, not from node count.
- **Bullet-hell boss patterns.** Occluding isometric walls make dense projectile
  patterns unreadable. `boss.ts` should get *telegraph quality*, not
  projectile count.
- **A trade/economy layer, leagues, or seasons.** No player population.
- **Rebuilding anything in §0.**

## B6. Suggested order and gates

| # | Item | Effort | Risk | Why here |
|---|---|---|---|---|
| 1 | Descent contracts (§B1.3) | 1 sess | low | biggest change per line; modifiers.ts is already built and tested |
| 2 | Card words (§B2.2) | ½ sess | low | multiplies the existing card roster for free |
| 3 | Master rounds (§B1.4) | 1 hr | none | rewards the skill the game teaches |
| 4 | Shrines (§B1.1) | 1 sess | low | adds the missing downside economy |
| 5 | Curse + Jammed (§B1.2) | ½ sess | low-med | the punisher already exists |
| 6 | Affixes (§B2.1) | 1 sess | med | the real itemization gap; do after 1-5 so drops have somewhere to go |
| 7 | Stat sheet (§B3.4) | ½ sess | none | must land with or before 6 |
| 8 | Magic find + transmute (§B2.3) | ½ sess | low | needs 6 |
| 9 | Trait draft (§B3.1) | 1.5 sess | low-med | the run-variety fix |
| 10 | Champion packs (§B2.4) | 1 sess | med | depth scaling |
| 11 | Knights (§B3.2) | 1 sess | low | replay |
| 12 | Torment + shortcuts (§B3.3) | 1 sess | low | endgame; needs 6 and 10 to have anything to scale |

**Gates for every item** (the repo's standing rules):

1. `npx vitest run` — currently ~1400 tests, all green.
2. `npx tsc --noEmit 2>&1 | grep -c 'game/pinball-knight'` must stay **0**. The
   repo has ~6000 pre-existing tsc errors elsewhere; the total is not the gate.
3. Anything touching spawn or drops must keep `coop-determinism.test.ts` and
   `maze/floor-pipeline.test.ts` green — the latter pins buildability,
   solvability, determinism-by-seed and stairs placement.
4. **Seeded RNG only** in anything the horde or the floor sees. `Math.random()`
   in a spawn path is a co-op desync.
5. New generation behaviour ships **behind a flag, defaults bit-identical**, so
   existing floors don't reroll on merge (`ROUTE_MATH_PLAN.md` Part 8).
6. Real-browser check, not just headless: swiftshader runs at 2-5fps and cannot
   judge feel, and several bugs in this codebase's history (the shared bumper
   material, the 8192px atlas, the solid-cyan card tint) were **only** visible
   in a screenshot.

## B7. Open questions for the author

1. **Is curse visible or hidden?** Recommend visible. Gungeon hides it and it is
   the single most-complained-about thing about the mechanic.
2. **Do affixes apply to cards too, or only to weapons/gear?** Recommend
   weapons/gear only — cards are already the modifier layer, and affixing the
   modifiers is a legibility disaster.
3. **Do drafted traits (§B3.1) persist across floors within a run, or reset?**
   Recommend persist — the run is the unit, and `run/ledger.ts` already scopes
   progression that way.
4. **Torment tiers vs. just deeper floors?** They overlap. If depth already
   scales well after §B2.4, §B3.3 may only be worth the shortcut half.

---

## Sources

Reference-game research (accessed 2026-07-26):

- [The Secret Sauce of Survivors-Likes: Halls of Torment](https://medium.com/@sethtouchesgrass/the-secret-sauce-of-survivors-likes-why-games-like-halls-of-torment-are-so-addictive-94159b37a173)
- [Halls of Torment Review — FullCleared](https://fullcleared.com/reviews/halls-of-torment-review/)
- [Halls of Torment Review — Bullet Haven](https://bullethaven.com/review/halls-of-torment)
- [Halls of Torment: Game Mechanics + Tips & Tricks 1.0+ (Steam guide)](https://steamcommunity.com/sharedfiles/filedetails/?id=3034282250)
- [Halls of Torment Wiki — Trait](https://hot.fandom.com/wiki/Trait)
- [Diablo Wiki — Affix](https://www.diablowiki.net/Affix)
- [Diablo Wiki — Magic Find](https://diablo2.diablowiki.net/Magic_Find)
- [Project Diablo 2 Wiki — Item Affixes](https://wiki.projectdiablo2.com/wiki/Item_Affixes)
- [Diablo 2 Resurrected Runewords — TechRadar](https://www.techradar.com/how-to/diablo-2-resurrected-runewords-how-to-use-them-and-what-they-do)
- [Path of Exile 2 Wiki — Support Gems](https://pathofexile2.wiki.fextralife.com/Support+Gems)
- [PoE Vendor Recipe System — Wiki](https://pathofexile.fandom.com/wiki/Vendor_recipe_system)
- [Enter the Gungeon Wiki — Dodge Roll](https://enterthegungeon.wiki.gg/wiki/Dodge_Roll_(Move))
- [Enter the Gungeon Wiki — Shrines](https://enterthegungeon.wiki.gg/wiki/Shrines)
- [Enter the Gungeon Wiki — Curse](https://enterthegungeon.wiki.gg/wiki/Curse)
- [Enter the Gungeon Wiki — Lord of the Jammed](https://enterthegungeon.wiki.gg/wiki/Lord_of_the_Jammed)
- [Q&A: The guns and dungeons of Enter the Gungeon — Game Developer](https://www.gamedeveloper.com/design/q-a-the-guns-and-dungeons-of-i-enter-the-gungeon-i-)

Related in-repo docs: `PINBALL_KNIGHT_PLAN.md` (consolidated status),
`NEXT_WAVE_PLAN.md` (perf + assembly placer), `CARD_REWORK_PLAN.md`,
`MONSTER_CARD_PLAN.md`, `CONTENT_EXPANSION_PLAN.md`, `BLUEPRINT.md`
(architecture), `VERIFY_CHECKLIST.md` (manual QA).
