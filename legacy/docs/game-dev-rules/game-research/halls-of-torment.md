# Halls of Torment — Design Research for Pinball Knight

**Game:** Halls of Torment (Chasing Carrots, Early Access May 2023, 1.0 September 2024)
**Genre:** Survivor-like / horde survival with ARPG character progression
**Engine:** Godot (with hot paths moved to C++ and threads)

**Why this game is in the research set.** Halls of Torment is the closest existing answer to the question Pinball Knight is asking: "what happens when you bolt a real ARPG stat sheet onto a 30-minute horde-survival loop and wrap it in a retro Diablo skin?" Its two big innovations over Vampire Survivors are directly relevant to us: (1) a deep, tagged, two-bucket stat system where every hero consumes the *same* stat pool through *different per-level scaling coefficients* — one data table per hero makes a dozen genuinely different builds out of one engine; and (2) a meta-progression built almost entirely out of **quests** (600 challenges, each one an unlock) plus a **gear-retrieval** mechanic (the Well) that layers permanent, slot-based equipment onto disposable runs. Pinball Knight already shipped the HoT-inspired bestiary and run-grade systems; this report goes after the parts we have not copied yet — the stat math, the wave/agency design, and the extraction-style gear loop.

Sourcing note: the [Halls of Torment Wiki](https://hot.fandom.com/wiki/Halls_of_Torment_Wiki) is a community wiki, but its mechanics pages publish exact formulas (with worked examples and graphs) that the community has verified against data-mined values and in-game tooltips. Formulas below labeled "wiki-documented" come from there; anything I flag as *community approximation* is less certain. Developer intent comes from the [FullCleared interview](https://fullcleared.com/features/inside-halls-of-torment-an-interview-with-chasing-carrots/) and the [W4 Games interview](https://www.w4games.com/blog/w4-games-news-1/interview-with-chasing-carrots-developer-of-halls-of-torment-120).

---

## 1. Core loop

### Run structure

- A run ("round") is a **30-minute countdown** in one of 6 Halls plus a bonus chapter ([Hall](https://hot.fandom.com/wiki/Hall)). Kill mobs → collect XP gems → level up → draft traits → survive to 0:00, where the Hall's **Lord** (final boss) spawns. Killing the Lord ends the run as a win.
- The spawn schedule is **scripted, not simulated**: each Hall has a fixed wave timeline with named elites and bosses at fixed clock times. [Haunted Caverns](https://hot.fandom.com/wiki/Haunted_Caverns) (Hall 1):

  | Clock (time remaining) | Spawn | Type |
  |---|---|---|
  | 27:40 | Skeleton (Sturdy Elite) | Elite |
  | 24:00 | Imp Chieftain | Boss |
  | 19:45 | Skeleton (Shield Elite) | Elite |
  | 16:00 | Skeleton Lord | Boss |
  | 11:40 | Skeleton (Mage Elite) | Elite |
  | 08:00 | Lich | Boss |
  | 00:00 | Lord of Pain | Final Lord |

  Elites drop ability pickups (Tomes/Scrolls of Mastery); bosses are the run's "beats." The player always knows *when* the next spike comes — tension comes from the clock, not from RNG.

### The ability loop inside a run

- Abilities are **not** granted on level-up. They come from **Tomes/Scrolls of Mastery** — pickups at *fixed map locations* plus drops from the scripted elites ([Ability](https://hot.fandom.com/wiki/Ability)). This makes ability acquisition a routing/exploration decision: you detour through the horde to collect them. Up to **6 abilities** may be equipped per run.
- Each ability has its own trait ladder (§3) and up to 3 **Upgrades**, of which 2 are normally pickable per run — the 3rd is gated behind specific items/heroes (Ability Signets, Sage + Mark of Knowledge). Upgrades are offered by the *next* Tome pickup after hitting ability-trait Ranks III/VI, chaining exploration → drafting → exploration.
- Each Hall also hides a **Secret** — an environmental puzzle (blood trails, shrines, slaying enemies inside circles) that yields a Lord-killer relic; e.g. Haunted Caverns' Protective Pendant fires a guaranteed-crit projectile dealing **50% of the Lord's health regardless of Agony/Torment rank** ([Haunted Caverns](https://hot.fandom.com/wiki/Haunted_Caverns)). Secrets convert map knowledge into boss-fight power — a strong replay hook that costs one scripted setpiece per map.

### Agony and Torment (stacked difficulty layers)

- **Agony** is the per-Hall hard mode, unlocked by beating that Hall's Lord ([Agony](https://hot.fandom.com/wiki/Agony)). It adds an **Agony Meter/Rank**: the meter fills over time, +1 Rank per fill, max Rank 5. Wiki-documented pacing: **1 Agony Rank every 4m48s → Rank 5 at 24:00 of a 30:00 run**. Reviving drains the meter by 20% (a comeback valve). Agony Rank scales enemy count, enemy health, XP drops (per-Hall: +52.9% base XP/Rank in Hall 1 down to +13%/Rank in Hall 5), item rarity, and champion spawn rate.
- **Torment** is a further opt-in layer: each toggled-on **Artifact** (a run modifier retrieved from Agony Lords) adds +1 Torment Rank ([Torment](https://hot.fandom.com/wiki/Torment)). Per Rank: enemy health **×1.11**, enemy defense **×1.10**, enemy damage **+2%**, enemy speed **+1.5%**, XP **+5%**. Players self-select difficulty by choosing which artifacts to run — difficulty *is* the loadout.

### Quest-based meta (no unlock currency)

- Every unlock in the game — heroes, abilities, ability upgrades, traits, items, even gold grants — is tied to a **Quest**: a concrete in-run challenge ("kill X of Y", "reach 20:00 without taking damage", "defeat the Lich") ([Quest](https://hot.fandom.com/wiki/Quest)). There are **600 quests** organized into per-Hall boards, per-hero "Story" boards, and general Milestone boards ([Steam 100% guide](https://steamcommunity.com/sharedfiles/filedetails/?id=3005633351)).
- Two elegant details:
  - **Every completed quest also grants a global +0.3% XP multiplier** — so even a quest whose named reward you don't care about still nudges every future run. 600 quests ≈ up to +180% XP for a completionist.
  - A **Quest Tracker** lets you pin one quest and watch its progress live from the pause menu, turning any run into a directed mini-goal.
- Gold exists but is *not* the unlock gate — it is spent at the **Shrine of Blessings** (permanent stat boosts, §4) and on buying back retrieved items. The developers framed quests as the agency mechanism: they "ask the player to achieve specific things" and "unlock new content that open up new possibilities" ([FullCleared interview](https://fullcleared.com/features/inside-halls-of-torment-an-interview-with-chasing-carrots/)).

### The Well: gear extraction on a survivor loop

- Equipment found in chests during a run is **temporary by default**. The **Well** ([Item § Well](https://hot.fandom.com/wiki/Item)) converts it to permanent:
  1. Loot an unretrieved item from a chest mid-run.
  2. Walk to the Well (a physical spot in the level) and **send the item up** — this *depletes it for the rest of the run* (you fight on without it).
  3. Back in Camp, **buy the item from the Wellkeeper with gold**; it now lives in your Item Stash forever and can be equipped from run start.
- The Well itself is quest-unlocked ("The Wellkeeper" — free a caged NPC in Hall 2 by finding a key). You get **one retrieval (Bucket) per run** by default; **Extra Buckets** drop from champions. After killing the Lord, the Well warps next to you so a winning run always gets a comfortable extraction.
- Rarity gates the loop long-term: **Common** items retrieve via the Well; **Uncommon** (Agony-only drops) need a second unlocked shrine (Shrine of Archeologists, sharing the same Bucket pool); **Rare** (Torment-tier) items **cannot be retrieved at all** — top-tier gear stays run-only excitement.
- Net effect: a permanent, slot-based ARPG gear layer accumulates *through* the survivor loop, with a real in-run sacrifice (item goes dark this run) and a gold sink, instead of a separate shop. This is the single most-praised meta system in the game's reception ([Wikipedia](https://en.wikipedia.org/wiki/Halls_of_Torment)).

---

## 2. The stat system

HoT ships an ARPG-depth stat sheet in a genre that usually has 4 sliders. Full glossary on [Stats](https://hot.fandom.com/wiki/Stats): Health / Health Bonus / Regeneration / Block Strength / Defense / Defense Bonus (defensive); Damage, Range, Area & Cone Size, Attack Speed, Piercing, Multistrike, Duration, Force, Knockback (offensive); Crit Chance, Crit Chance Multiplier, Crit Bonus, Crit Bonus Multiplier; Movement Speed, XP Gain, Pickup Range (utility); plus Effect Chance/Effect Damage for the DoT statuses (Burn, Spark, Frost, Decay).

### The two-bucket formula (wiki-documented)

Every stat resolves the same way:

```
Final Stat = (Base Stat + Σ Base Bonuses) × (100% + Σ Multiplier Bonuses)
```

- **Base (flat) bonuses** add to the character's base value; **Multiplier (%) bonuses** all sum into one multiplier. So % bonuses are additive *with each other* but multiplicative *with the flat bucket*.
- Worked wiki example: Base Attack Speed 2/s, +0.3/s flat, +100% multiplier → **(2 + 0.3) × 2.0 = 4.6/s**.
- Design consequence the community leans on constantly: **flat "Base" bonuses are worth more the more % you stack** ("the higher the Base Value, the better the scaling via %Modifiers"). Rare flat-damage or base-crit sources become build-around chase items without any new mechanics.

### Tags

Stat bonuses can carry **tags** (Main Weapon, Summon, Physical, Projectile, Melee, a specific ability's name, …). A damage source collects all bonuses matching its tags plus all untagged bonuses, then splits them into the two buckets and sums ([Stats § Tags](https://hot.fandom.com/wiki/Stats)). Damage types (Physical/Magic/Fire/Lightning/Ice/Earth) never overlap, and DoT effects scale off **Effect Damage**, not Damage, and cannot crit ([Damage](https://hot.fandom.com/wiki/Damage)). This one indirection gives them trade-off traits like "+30% Damage (Summon), −10% Defense" for free.

### Crit and over-100% stats (wiki-documented)

```
Final Crit Damage = Damage × (1 + Crit Bonus × Crit Stacks)
```

Stats are allowed to exceed 100% and convert the overflow into **stacks** ([Game Mechanics](https://hot.fandom.com/wiki/Game_Mechanics)):

- **Multistrike is deterministic**: an accumulator per source. At 260% multistrike, each attack fires 2 extra strikes and the 0.6 fraction accrues; the emitted sequence loops 2, 3, 2, 3, 3. No RNG — good for feel and for co-op determinism.
- **Crit chance / effect chance are random** ("over-crit"): at 310% crit chance you always get 3 crit stacks with a 10% chance of a 4th. Wiki worked example: 50 damage, 310% crit chance, 220% crit bonus → 90% chance of 380, 10% chance of 490.

### Defenses (wiki-documented)

- **Block** is a pre-defense gate that negates a hit entirely: `Block Chance = min( ½·B/D, ½·√(B/D), 1 )` where B = Block Strength, D = incoming damage. Tooltip anchors: 100% block when damage ≤ B/4; 50% at damage = B; 20% at damage = 2.5B. Big hits punch through block builds by construction.
- **Defense** is percentage damage reduction with a soft-then-linear curve: `DR = sgn(Def)·(0.6 − 24/(|Def|+40)) + min(0.4, 0.004·Def)` (both terms in %×100). Example: 40 Defense → 46% DR. Above 100 Defense, effective HP grows **linearly at ~4.17% per point** — no hard cap, no runaway. Damage can never be reduced below 1. Negative defense (from trade-off traits) *increases* damage taken.
- **Regeneration** ticks 1 HP at a time; stacking regen shortens tick interval (readable, no big-number spam).

### Worked pipeline example (composite of wiki-documented pieces)

Take a Swordsman at level 30 with +20 flat weapon damage from gear, +80% Damage from traits/blessings, 150% multistrike, 120% crit chance, +100% crit bonus over his 65% base:

1. **Flat bucket:** 100 base + (0.5 × 30 levels) + 20 gear = 135.
2. **Multiplier bucket:** +0.5%/level × 30 = +15%, +80% traits → ×1.95 → **263 damage per swing**.
3. **Multistrike 150%** (deterministic): every swing doubles, and every 2nd swing triples (accumulator).
4. **Crit 120%** (random stacks): every hit crits once, 20% chance of a double-stack. Crit bonus final = 65% base × (1 + 1.00) = 130% → crit hit = 263 × (1 + 1.3 × stacks).

Every number above came from a data table (base stats, per-level rows, trait ranks, item affixes) flowing through one shared formula — no per-build code.

### Status effects (DoT layer)

The four **Elemental Effects** — [Burn](https://hot.fandom.com/wiki/Burn), Spark, Frost, Decay — are a parallel damage economy ([Damage](https://hot.fandom.com/wiki/Damage)):

- They scale off **Effect Damage/Effect Chance**, *not* Damage — so DoT builds draft different traits (elemental affinities: +10% Burn damage + 10% Burn chance per rank) and chase different gear than hit builds.
- **Effects cannot crit**, and direct damage types never overlap with effect types (Fire damage ≠ Burn damage; bonuses to one don't touch the other). The wall between the two economies is absolute, which keeps both balanceable in isolation.
- Effect chance above 100% uses the same random-stack overflow as over-crit, so effect stacking remains a meaningful axis far past "always procs."

### Force, knockback, and diminishing returns

- **Force** is a genius "catch-all scaler": per weapon/ability it boosts *something appropriate* — pierce count, duration, knockback, or the per-hit damage falloff. Falloff stats obey `Final = Base^(1/Force-ish exponent)` so they approach but never reach ×1.00 ([Game Mechanics § Force](https://hot.fandom.com/wiki/Game_Mechanics)).
- **Knockback** is a two-gate model: attack `Knockback Power` must meet the enemy's `Knockback Resistance`, then `Knockback Force` is injected as velocity: `velocity = Force/18 m/s` (the game's units: 1 m = 18 px). Enemies have a per-species `Movement Force` governing recovery. This is literally a pinball-physics-compatible spec.

### Per-character scaling coefficients — the headline idea

Every hero consumes the same stat pool but has (a) different base stats and (b) a tiny table of **per-level automatic bonuses**. Three examples from the wiki hero pages:

| | [Swordsman](https://hot.fandom.com/wiki/Swordsman) | [Archer](https://hot.fandom.com/wiki/Archer) | [Sorceress](https://hot.fandom.com/wiki/Sorceress) |
|---|---|---|---|
| Weapon | Zweihänder 45° cone | Bow, 3 arrows in 18° cone | Chain Lightning, 5 streaks |
| Health | 500 | 400 | 300 (and **0 regen**) |
| Base damage | 100 | 60 per arrow | 100 per streak |
| Attack speed | 0.9/s | 0.95/s | 0.75/s |
| Multistrike base | 1.00 | 3.00 | 5.00 |
| Crit | 20% / +65% | 33% / +200% | 20% / +100% |
| Per level | +0.5 flat weapon dmg, +0.015 m range, +0.1° area, +0.5% health, +0.5% damage | +0.25 flat bow dmg, +0.02 pierce, +0.2% move speed, +0.5% crit chance | +0.5 flat weapon dmg, +0.15 chain jumps, +4% multistrike per 10 levels |

Same trait pool, same items — but +% damage is worth different amounts per class because base values and flat-growth differ; crit traits are gold on the Archer and mediocre on the Swordsman; multistrike traits explode on the Sorceress. **Build diversity is achieved almost entirely in data tables, not code.** Additionally each hero flags certain shared traits as *strong/weak variants* (e.g. Archer gets the weak Vitality variant: +30 HP instead of +40) — a second, even cheaper differentiation knob.

Interview corroboration: items/stats-with-synergies were a day-one pillar — "We knew we wanted equipable items in the game with different stats and modifiers and interesting synergies to figure out. It's kind of a staple of ARPGs" ([FullCleared](https://fullcleared.com/features/inside-halls-of-torment-an-interview-with-chasing-carrots/)).

---

## 3. Trait / level-up design

Level-ups present a **draft of 3 traits** from a pool that is *structured*, not flat ([Trait](https://hot.fandom.com/wiki/Trait)):

- **Base Traits** (always in pool): 14 stat traits, each **Rank V max**, ranks gated at hero levels 0/5/15/30/50. Values are small and additive, and flat-vs-% is chosen deliberately per stat (defensive traits are mostly flat so they interact with the % blessings/items bucket):

  | Trait | Per rank (×5 ranks) | Bucket |
  |---|---|---|
  | Strength | +10% Damage | % |
  | Quick Hands | +6% Attack Speed | % |
  | Cunning Technique | +10% Crit Chance | % |
  | Ruthlessness | +10% Crit Bonus | % |
  | Collateral Damage | +6% Area | % |
  | Vanguard | +10% Range | % |
  | Channeling | +10% Force | % |
  | Vitality | +40 Base Health (hero-variant: 30/40/50) | flat |
  | Metabolism | +0.2/s Base Regeneration (0.15/0.2/0.25) | flat |
  | Parry | +2 Base Block Strength (2/3) | flat |
  | Thick Hide | +2 Base Defense (2/3) | flat |
  | Swift Feet | +0.2 m/s Base Movement Speed | flat |
  | Long Fingers | +20% Pickup Range | % |
  | Primal Energy | +10% Effect Damage (quest-gated) | % |

  Note the per-hero **strong/weak variants** (arrows on Vitality/Metabolism/Parry/Thick Hide) — the same trait is simply worth more or less depending on who you play, one more coefficient-level differentiation.
- **Elevated Traits** (quest-unlocked, join pool at levels 15/30/60, Rank III max): the spicy ones — +10% Multistrike, +0.15 *flat* Base Crit Bonus, elemental affinities (+10% Burn damage + 10% Burn chance), and **trade-off traits** (Demonic Exchange: +30% Summon damage / −10% Defense; Ethereal Shift: +30% Attack Speed (Melee) / −100% Damage (Projectile) — a build-defining exclusivity pick).
- **Growth Traits** (quest-unlocked): per-level-up compounding picks with 4 level-gated variants — e.g. Strength Growth: **+0.5% Damage per future level-up** if taken at levels 10–39, +0.7%/level at 40–69, +1.1%/level at 70–99, or a flat +30% "Final Growth" at 80. Picking one disables its siblings. Early pick = bigger integral, later pick = certainty; a clean risk/timing decision inside the draft.
- **Ability Traits**: each of the 6 equipped abilities has its own trait ladder, **Ranks I–X** gated at hero levels 8,16,24,…,80. Ranks III and VI unlock an **Ability Upgrade** pick; Ranks IX and X have **doubled effects** (late-game power spike). Trait categories unlock wider via per-ability **Mastery quests**.
- **Class Traits**: per-hero ladders (Ranks I–V at levels 5/15/25/40/60) in 3 categories; **only one Rank V may be picked per run** — the run's "ascension" moment. **Marks** (quest-unlocked cosmetic-slot items) let you borrow another hero's class traits, enabling cross-class hybrids.

### Stacking math

Nearly all trait % bonuses land in the shared **Multiplier bucket → additive with each other**, multiplicative only against (Base + flat). Crit is the deliberate exception (a separate multiplier, and Crit Bonus × Crit Chance multiply *each other's* value), which is why crit-stacking is the classic "multiplicative out" for veterans — see community discussion [maximize damage? Crit chance vs Crit bonus](https://steamcommunity.com/app/2218750/discussions/0/4845401032850194531/). Additive-by-default keeps 60+ trait picks per run from going exponential.

### Reroll / banish economy

There is no free reroll button. Selection manipulation is done with **Potions** — consumables brewed after finding herb ingredients hidden in levels ([Potion](https://hot.fandom.com/wiki/Potion)), each with a per-run capacity extended by finding Bottles in-run and by Blessing ranks:

| Potion | Effect | Base cap/run |
|---|---|---|
| Strong Wine | Reroll the whole trait selection | 10 |
| Potion of Oblivion | **Banish** a trait *and all its follow-ups* for the run (still pick afterwards) | 8 |
| Potion of Memories | **Pin** a trait so it stays offered until taken | 8 |
| Reverberant Tincture | Apply a chosen trait **twice** | 3 |
| Potion of Renewal | Reroll ability selection | 3 |
| Hallucinogenic Elixir | Reroll a chest's item selection | 3 |

Notable: banish removes an entire subtree (prerequisite-aware), and pin/memorize interacts with draft odds. The whole economy is itself content — ingredients are exploration rewards, capacity is a gold sink.

---

## 4. Item / gear system

- **Slots:** 6 equipment types — Helmet, Chest (armor), Gloves, Boots, Amulet, Ring — with **2 ring slots** ([Item](https://hot.fandom.com/wiki/Item)). Plus a 4-slot in-run **Bag**, 4 saved **Loadouts**, and non-equipment item classes: Bottles (potion capacity), Marks, Artifacts (Torment toggles).
- **Quality levels:** Common / Uncommon (Agony) / Rare (Torment). Chest roll rarity is a wiki-documented function of Torment Rank + Agony Rank, e.g. Standard chests: min rarity `⌊min(2, max(0, 0.08·(1+TR+AR)))⌋`, max rarity `⌊max(1, 0.86 + 0.07·(1+TR+AR))⌋`; Champion chests roll a tier higher. Practical anchors: standard chests can drop Rare from TR+AR ≥ 16; champion chests from ≥ 11.
- **Roll weighting is retention-aware:** base odds 4/2/1 by rarity, but items you already *equipped* are excluded, un-retrieved Commons get bonus weight, and **Uncommon/Rare variants only enter the pool after you've retrieved the Common variant** — the loot table itself pushes you around the extraction loop.
- **Growth vs Boost variants:** many Uncommon/Rare items come as either a flat "Boost" or a "Growth" version whose bonus scales with levels gained while worn (calibrated so Growth = Boost at level 100). Same item, two build philosophies.
- **Power-law items:** a documented family of items converts an input stat to an output stat via `Output = (Input/C)^r` with |r| < 1 for diminishing returns (e.g. Alchemist Goggles, Duelist's Spark) — stat-conversion chase gear with built-in soft caps.
- **Gear complements the draft:** equipment carries mostly **flat/base bonuses and tagged bonuses**, traits carry mostly **% bonuses** — so gear raises the base the trait-multipliers act on. Item hunting and trait drafting multiply each other rather than competing.
- **Blessings (permanent stat purchases):** the only pure gold sink for power ([Blessing](https://hot.fandom.com/wiki/Blessing)). ~27 blessings, most with 5 ranks, cost pattern per rank = **1×, 3×, 6×, 10×, 15× a per-stat base price**. Excerpt from the wiki table:

  | Blessing | Per rank | Rank costs (gold) | 5-rank total |
  |---|---|---|---|
  | Pickup Range | +20% | 200 / 600 / 1,200 / 2,000 / 3,000 | 7,000 |
  | Health Capacity | +10% | 400 / 1,200 / 2,400 / 4,000 / 6,000 | 14,000 |
  | Defense | +10% | 400 / 1,200 / 2,400 / 4,000 / 6,000 | 14,000 |
  | Crit Chance | +6% | 600 / 1,800 / 3,600 / 6,000 / 9,000 | 21,000 |
  | Damage | +10% | 800 / 2,400 / 4,800 / 8,000 / 12,000 | 28,000 |
  | Attack Speed | +6% | 1,000 / 3,000 / 6,000 / 10,000 / 15,000 | 35,000 |
  | Multistrike | +6% | 1,000 / 3,000 / 6,000 / 10,000 / 15,000 | 35,000 |
  | Revives (max 2) | +1 revive | 5,000 / 30,000 | 35,000 |
  | Extra Reverberant Tincture (max 2) | +1 charge | 50,000 / 75,000 | 125,000 |

  Stronger stats are priced higher per rank (attack speed and multistrike cost 5× what pickup range costs), roughly half the blessings are themselves quest-gated, and the priciest entries are potion-economy expansions rather than raw stats. Community estimate: full blessing buy-out is on the order of ~900k gold — a long-tail sink, *not* a wall in front of content (content is quest-gated instead).

---

## 5. Enemy / wave math, readability, performance

### Scaling model

HoT's difficulty inside a run is **schedule-driven, then multiplier-driven**:

- **Baseline (normal mode):** enemy composition and stats come from the scripted per-Hall wave timeline (§1); wave N enemies are simply *defined* stronger, denser, faster. There is no documented continuous per-second HP formula on normal — pressure ramps by script. (*Community understanding; the wiki documents no time-HP function for normal mode.*)
- **Agony Rank** (time-driven, +1 per 4m48s): scales enemy **count** and **health** per rank (exact per-rank multipliers not published), plus XP compensation per Hall (+13% to +52.9%/rank).
- **Torment Rank** (player-selected): exact multipliers per rank — HP ×1.11, Defense ×1.10, Damage +2%, Speed +1.5% ([Torment](https://hot.fandom.com/wiki/Torment)). Note damage/speed scale *far* slower than HP: harder modes make fights longer and denser, not instantly lethal — the player's dodge skill keeps its value.
- **Champions (elite layer, Agony+):** spawn on a timer — wiki-documented `Spawn Time = (150 − 9·AgonyRank) × 0.95^TormentRank` seconds, floor ~15.01s at Torment 30 + Agony V ([Champion](https://hot.fandom.com/wiki/Champion)). Champion HP uses the **Hall Strength** interpolation: `HallStrength = lerp(min, max, stage progress)`, `FinalHealth = BaseHealth + HallStrength × HealthMultiplier`, with per-Hall anchors from 500→19,000 (Hall 1) up to 10,000→150,000 (Boglands) ([Hall](https://hot.fandom.com/wiki/Hall)). One linear ramp per Hall, one multiplier per champion species — the entire elite HP curve is 2 numbers per map + 1 per enemy.
- **Champion drops are a pity-table:** an ordered priority list where each pickup's chance grows with TR+AR and has a per-run max-drop cap, with escalating gold amounts as guaranteed fallback ([Champion § Drops](https://hot.fandom.com/wiki/Champion)):

  | Pickup (priority order) | Base chance | +per TR+AR | Cap | Max/run |
  |---|---|---|---|---|
  | Extra Bucket | 5% | +1% | 20% | 2 |
  | Bottle Chest | 5% | +3% | 20% | 2 |
  | Tome of Mastery | 0% (from TR+AR 5) | +1% | 20% | 9 |
  | Champion Chest | 20% | +3% | 50% | 7 |
  | Scroll of Mastery | 30% | +4% | 60% | 9 |
  | 1,200 / 600 / 300 gold | 0% / 10% / 20% | +1–4% | 100% | — |
  | 150 gold (floor) | 100% | — | — | — |

  Elite kills always pay *something*, never flood a specific resource, and higher difficulty shifts the table toward the good stuff — difficulty scaling and reward scaling are the same table.

### XP curve (wiki-documented)

`XP(L) = ⌊(fa·xa^L + fb·xb^L + k_linear)·L + k_base⌋` per level, with per-Hall coefficients ([XP](https://hot.fandom.com/wiki/XP)):

| Hall | fa | xa | fb | xb | k_linear | k_base |
|---|---|---|---|---|---|---|
| I Haunted Caverns | 15 | 0.95 | 10 | 1.04 | 4 | −1 |
| II Ember Grounds | 25 | 0.95 | 10 | 1.04 | 5 | 1 |
| III Forgotten Viaduct | 35 | 0.95 | 10 | 1.04 | 6 | 3 |
| IV Frozen Depths | 45 | 0.95 | 10 | 1.04 | 7 | 4 |
| V Chambers of Dissonance | 55 | 0.95 | 10 | 1.04 | 8 | 5 |
| Final: The Vault | 60 | 0.96 | 10 | 1.04 | 10 | 6 |

Note the shape: an early-game term (`fa·0.95^L` — decays away), a late-game term (`10·1.04^L` — dominates), and a linear floor. Later Halls only raise the *early* coefficients, so level 1–20 pacing differs per map while the endgame curve is shared. Anchor: in Hall 3, level 100 → 53,679 XP increment, ~1.09M cumulative. Agony/Torment XP bonuses and the +0.3%/quest global multiplier push level cadence back up as difficulty rises, keeping the trait-draft drumbeat roughly constant.

### Readability & performance

- Hundreds-to-thousands of enemies stay readable through: strict silhouette/palette discipline per enemy family, **yellow outline = champion**, boss-only projectile patterns kept slow and geometric (arcs, rings, lanes — arcade-shooter heritage), and hit feedback that never occludes the player. Hitboxes are "sized in the player's favor" by policy ([FullCleared](https://fullcleared.com/features/inside-halls-of-torment-an-interview-with-chasing-carrots/)).
- Godot performance, from the developers directly: "thousands of sprites being generated and moved across the map... led to major slowdowns," fixed by "moving the most calculation heavy parts... to C++" and running code in separate threads — cited as a benefit of Godot being open source ([FullCleared](https://fullcleared.com/features/inside-halls-of-torment-an-interview-with-chasing-carrots/); engine-choice rationale in the [W4 Games interview](https://www.w4games.com/blog/w4-games-news-1/interview-with-chasing-carrots-developer-of-halls-of-torment-120)). A deeper technical talk exists: [A Peek Under the Hood: Technical Learnings from Halls of Torment](https://godotfest.com/talks/a-peek-under-the-hood-technical-learnings-from-halls-of-torment/) (GodotFest, Paul Lawitzki — project structure, programming patterns, performance profiling).
- Two revealing engine notes on the wiki ([Game Mechanics § Technical](https://hot.fandom.com/wiki/Game_Mechanics)): the game is **bound by single-core CPU performance**, and **spawn rate is capped per frame** — so a higher frame rate literally spawns enemies faster. That per-frame spawn budget is their density valve; the frame-rate coupling is the bug-shaped consequence of not fixing the timestep (Pinball Knight's fixed 60Hz sidesteps this class of bug entirely).
- Team context: ~7 people, ~6 months to demo, 6 more to Early Access; >1M copies sold in Early Access ([Wikipedia](https://en.wikipedia.org/wiki/Halls_of_Torment)).

---

## 6. What HoT changed vs Vampire Survivors — and why

1. **Manual aim / player agency.** VS auto-fires everything; positioning is the only verb. HoT gives every hero an **aimed main weapon** (mouse/stick-directed, with optional auto-aim assist) and derives its game-feel rules from vertical scrollers like DonPachi and Raiden: "the player should always stay in direct control of the character and be able to move in a precise manner," "we never unnecessarily impede the player's movement and hit boxes are sized in the player's favor" ([FullCleared](https://fullcleared.com/features/inside-halls-of-torment-an-interview-with-chasing-carrots/)). Skill expression = aim + kiting, not just pathing.
2. **Fewer weapons, deeper stats.** VS scales by weapon count and evolutions (dozens of weapons, shallow stats). HoT caps at 1 main weapon + up to 6 abilities (with up to 2 of 3 upgrades each — [Ability](https://hot.fandom.com/wiki/Ability)) and pushes all depth into the stat sheet, tags, and trait ladders. Wikipedia summarizes the stated goal: "a middle ground between the action of Vampire Survivors and the character progression of action RPGs" ([Wikipedia](https://en.wikipedia.org/wiki/Halls_of_Torment)).
3. **Retro-Diablo aesthetic as market positioning.** Pre-rendered isometric sprites emulating Diablo 1/2: "We haven't seen many other games trying to emulate that look, so we thought it could be something we could make our game stand out with." Atmosphere (dark, grim) was a differentiator against the genre's cartoon default.
4. **Quests instead of a gold shop as the primary meta.** VS's meta is currency → power-ups. HoT made gold a secondary sink (blessings, buy-back) and put *all content* behind directed challenges — meta-progression doubles as a tutorial for mechanics ("kill the Lich" teaches boss patterns; "retrieve item X" teaches the Well).
5. **A permanent gear layer** (Well/Stash/loadouts) on top of the disposable-run structure — VS has nothing equivalent; this is HoT's ARPG transplant and its stickiest system.
6. **What HoT did *not* do** (relevant gaps for us): no co-op (single-player only — all its deterministic-stack machinery is a free win for a game that *does* sync multiple players), no active cooldown abilities on buttons (all 6 ability slots auto-fire; only aim is manual — Pinball Knight's Q/E cooldown abilities are already a step *past* HoT on the agency axis), and no procedural levels (fixed handcrafted maps is what makes fixed spawn timelines and hidden Secrets work — a maze generator needs the density budget expressed in local terms instead, see §7.3).

---

## 7. Lessons for Pinball Knight

### 7.1 Per-character scaling coefficients: one stat pool, many builds

HoT proves you can run **one shared stat pool + one damage pipeline** and get wildly different builds from a *tiny per-archetype data table*: base stats + 3–5 per-level growth coefficients + strong/weak variant flags on shared traits. For Pinball Knight:

- Keep one canonical stat sheet (damage, crit chance/bonus, multistrike, area, attack/ability speed, range, pickup, move/**bounce**, defense/block, regen, effect damage). Give each build-defining axis (weapon kit, or even each of the 22 enemy-family card lines socketed as the "main" card) its own **per-level/per-floor coefficient row**, HoT-style: `+flat weapon damage/level` for a heavy build vs `+0.5% crit/level` for a precision build vs `+4% multistrike/10 levels` for a swarm build.
- Adopt the **two-bucket formula** literally: `Final = (Base + Σflat) × (1 + Σ%)`. Put flats on gear/cards, percents on traits/perks — that automatically makes card sockets and perk drafts multiply instead of compete, and makes rare flat-bonus cards late-game chase items with zero extra code. Since card instance IDs already encode level/shine, card deltas can feed the flat bucket cleanly.
- Copy the **tag system** for card sockets: bonuses tagged `Melee`, `Bounce`, `Ability:Q`, `Summon` etc. resolve by tag-match + untagged sum. One indirection funds trade-off cards ("+30% bounce damage, −10% defense") forever.
- Use HoT's **deterministic accumulator** for any stat allowed >100% (multistrike, proc chance). It's RNG-free, fits the fixed 60Hz timestep, and is trivially co-op-synchronous — random stacks (over-crit) can stay for damage spice only.
- Steal the **soft-cap curve shapes**: block as a separate full-negate gate scaled by damage ratio (`min(½·B/D, ½·√(B/D), 1)`), defense as saturating-then-linear DR, and power-law stat conversions `(Input/C)^r` for any "convert speed into damage"-style card. These give designers un-breakable knobs.

### 7.2 Quest-based unlocks beat currency grinds

- Convert Pinball Knight's meta unlocks (legacy perks, ability variants, card recipes) to **quest boards**: per-floor-theme boards, per-enemy-family boards (the bestiary already counts kills — quests are one predicate away), and milestone boards. HoT's rules worth copying exactly: *every* unlock has a named challenge; a **pinnable quest tracker** in the pause menu; and a tiny **global stacking reward per quest** (HoT: +0.3% XP each) so no quest is ever worthless.
- Keep gold/currency for **blessing-style permanent stat ranks** with the 1×/3×/6×/10×/15× escalating cost pattern and per-stat base prices reflecting stat power (HoT charges 5× more for multistrike ranks than pickup-range ranks). Gate the *strong* blessings behind quests too — money should never be the only wall in front of power.

### 7.3 Wave-density math for a momentum game

- **Script the timeline, don't simulate difficulty.** A visible countdown with named elite/boss beats at fixed timestamps (27:40 / 24:00 / 19:45 / …) gives players a plannable run and gives designers direct control over density — critical for Pinball Knight, where the knight *needs open lanes to build momentum*. Author spawn waves per floor as data, then apply difficulty as multipliers on top.
- **Separate the scaling axes the way HoT does:** HP scales hard (×1.11/rank), damage and speed scale soft (+2%, +1.5%/rank). In a momentum game this is doubly right: dense+tanky is fun to bowl through; dense+fast+lethal deletes the pinball fantasy. The 8 sub-type multiplier bundles can slot into exactly this role.
- **Elite pressure as a shrinking timer, not bigger waves:** champion timer `(150 − 9·AgonyRank)×0.95^TormentRank` seconds, with HP from a per-floor linear **Hall Strength** ramp (`lerp(min,max, floor progress) × per-species multiplier`). Two numbers per floor + one per enemy family = the entire elite curve. Pair with a **pity drop table** (priority list, chance grows per difficulty rank, per-run caps) so elite kills always pay.
- **Budget spawns per frame** like HoT — but hang the budget off the fixed 60Hz tick, not render frames, to avoid their documented frame-rate-changes-spawn-rate coupling. Their perf story (single-core bound; hot loops in C++/threads) maps to ours: keep enemy steering/mass updates out of the scripting layer and in the WebGPU/typed-array path.
- **An in-run difficulty meter with a comeback valve** (Agony meter: rank per 4m48s, revive −20%) is a cheap way to make long survivals spicy in endless/co-op modes.
- **Maze-local density budget** (*our proposal, translating HoT's numbers to procedural corridors*): HoT tunes density globally because its arenas are open; a maze must budget locally. Express the wave script as `active enemies per open tile within N tiles of the player`, cap spawns per 60Hz tick (HoT-style), and multiply the local cap by corridor width so momentum lanes stay open: e.g. cap ≈ `0.35 × open tiles in radius 12`, spawn ≤ 4/tick, elites always spawned *behind* the player's facing so the pinball line forward stays playable. The numbers are ours to tune; the *structure* — scripted timeline × local density cap × per-tick budget — is HoT's.

### 7.4 Trait draft mechanics worth porting

- **Rank-gated pools, not flat pools:** base traits available from level 0, elevated/trade-off traits entering at levels 15/30/60, and one exclusive "Rank V" class pick per run — the draft gets *more interesting* over a run instead of diluting. Pinball Knight's level-up draft (if/when added alongside the card system) should stage its pool the same way; the 22 enemy-family card lines can play the "elevated" role, entering the draft only after first bestiary kill of that family (quest system and draft system reinforcing each other).
- **Growth traits are the best risk knob in the genre:** a pick that pays `+X% per future level` forces a timing decision with zero extra UI. Directly portable to legacy perks or in-run card leveling ("this socket gains +0.5% damage per floor descended").
- **Banish/reroll as scarce, found consumables** (capacity 3–10 per run, expanded by meta purchases and in-run pickups) rather than a free button. HoT's subtree-aware banish (removes a trait *and its follow-ups*) is the right granularity for prerequisite trees.
- **Fallback rewards when the pool empties** (+50 gold / +100 health) — never show an empty draft.

### 7.5 Gear retrieval layered on runs

- Add a **Well-equivalent**: a physical extraction point (a well, a chute, a "send it home" pneumatic tube in the tavern fiction) where the player can bank **one monster-drop card per run** — at the cost of *losing that card's socket for the rest of the run*. That sacrifice is the whole design: extraction is a mid-run risk decision, not a menu checkbox. Extra "buckets" as rare elite drops; warp the well to the player after a boss kill so victories extract comfortably.
- Copy the **rarity-gated retrieval ladder**: commons extractable from the start; uncommons need a second unlocked mechanism; the top shine/level tier **never extractable** — keeps the best moments run-native and undercuts hoarding.
- Make the loot roller **retention-aware** like HoT's chest odds: exclude already-banked cards, up-weight un-banked commons, and only unlock a card's higher-shine variants in the drop pool *after* its common version is banked. The drop table itself then steers players around the extraction loop.
- Bank → **buy back with gold** → permanent stash with **saved loadouts**. The buy-back step is HoT's quiet masterstroke: it turns run gold into permanent-power purchases without a shop full of abstract upgrades, and prices the player's own loot.

### 7.6 One-line takeaways

- Depth lives in **data tables** (per-class coefficients, per-floor ramps), not in new systems.
- **Additive % within a bucket, multiplicative across buckets** — the only stacking rule you need at this scale.
- Difficulty should scale **HP hard, lethality soft** in any game where movement is the fantasy.
- **Every unlock is a challenge; every challenge pays twice** (named reward + global trickle).
- **Extraction with sacrifice** is the cleanest bridge between roguelite runs and ARPG gear permanence.

---

## Sources

- [Halls of Torment Wiki — Stats](https://hot.fandom.com/wiki/Stats) · [Game Mechanics](https://hot.fandom.com/wiki/Game_Mechanics) · [Damage](https://hot.fandom.com/wiki/Damage) · [Trait](https://hot.fandom.com/wiki/Trait) · [Quest](https://hot.fandom.com/wiki/Quest) · [Item](https://hot.fandom.com/wiki/Item) · [Blessing](https://hot.fandom.com/wiki/Blessing) · [Potion](https://hot.fandom.com/wiki/Potion) · [Agony](https://hot.fandom.com/wiki/Agony) · [Torment](https://hot.fandom.com/wiki/Torment) · [Champion](https://hot.fandom.com/wiki/Champion) · [Hall](https://hot.fandom.com/wiki/Hall) · [XP](https://hot.fandom.com/wiki/XP) · [Haunted Caverns](https://hot.fandom.com/wiki/Haunted_Caverns) · [Swordsman](https://hot.fandom.com/wiki/Swordsman) · [Archer](https://hot.fandom.com/wiki/Archer) · [Sorceress](https://hot.fandom.com/wiki/Sorceress) · [Ability](https://hot.fandom.com/wiki/Ability) · [Hero](https://hot.fandom.com/wiki/Hero)
- [Inside Halls of Torment: An Interview with Chasing Carrots — FullCleared](https://fullcleared.com/features/inside-halls-of-torment-an-interview-with-chasing-carrots/)
- [Interview with Chasing Carrots — W4 Games](https://www.w4games.com/blog/w4-games-news-1/interview-with-chasing-carrots-developer-of-halls-of-torment-120)
- [Halls of Torment — Wikipedia](https://en.wikipedia.org/wiki/Halls_of_Torment)
- [Halls of Torment — Godot Engine showcase](https://godotengine.org/showcase/halls-of-torment/) · [GodotFest talk: A Peek Under the Hood](https://godotfest.com/talks/a-peek-under-the-hood-technical-learnings-from-halls-of-torment/)
- Community: [Steam — crit chance vs crit bonus math](https://steamcommunity.com/app/2218750/discussions/0/4845401032850194531/) · [Steam — "BASE Damage" discussion](https://steamcommunity.com/app/2218750/discussions/0/6643422659549150007/) · [100% guide (quests/gear)](https://steamcommunity.com/sharedfiles/filedetails/?id=3005633351)
