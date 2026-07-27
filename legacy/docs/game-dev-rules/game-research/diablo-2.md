# Diablo 2 (+ Lord of Destruction) — Systems Research

**Why this game is in the research set.** Pinball Knight already ships the visible half of Diablo 2's design — sockets, a rarity ladder, upgrade gambling, corpse runs, gambling vendors — but D2's real legacy is the *invisible* half: a preset-tile map generator that stays readable across thousands of runs, a nested drop-probability tree (Treasure Classes) that produces a decades-long item chase from a few small tables, and a stat engine whose 25fps frame quantization accidentally invented "breakpoints", one of the most-discussed optimization surfaces in ARPG history. This report digs into the documented math and generation theory behind those systems — most of it community reverse-engineering (Arreat Summit, diablowiki.net, The Phrozen Keep's data-table docs, Amazon Basin) rather than official disclosure, and flagged as such — so Pinball Knight can steal the mechanisms, not just the surface features.

Primary sources: [Erich Schaefer's Gamasutra Diablo II postmortem](https://www.gamedeveloper.com/design/gamasutra-classics-the-making-of-i-diablo-ii-i-) ([mirror](http://ksuweb.kennesaw.edu/~jprest20/cgdd2002/readings/postmortem_blizzards_diablo_ii.php.htm)), [David Brevik's GDC 2016 Diablo postmortem](https://gdcvault.com/play/1023469/Classic-Game-Postmortem), [BorisTheBrave's Diablo 1 dungeon-generation analysis](https://www.boristhebrave.com/2019/07/14/dungeon-generation-in-diablo-1/), [Reverse Design: Diablo 2 — Randomness](http://thegamedesignforum.com/features/RD_D2_5.html), [diablowiki.net](https://diablo2.diablowiki.net/), [The Phrozen Keep](https://d2mods.info/), [Maxroll's D2R resources](https://maxroll.gg/d2/resources/breakpoints-animations) (which re-verified classic mechanics for the 2021 remaster).

---

## 1. Map generation: preset tiles, random layout

### 1.1 The lineage — Diablo 1's four generators

D2's generator is best understood against its predecessor, which [BorisTheBrave reverse-engineered in detail](https://www.boristhebrave.com/2019/07/14/dungeon-generation-in-diablo-1/). Diablo 1 generates every level onto a **40×40 tile grid**, with a *different algorithm per tileset*:

- **Church** — place a few large rooms, connect with corridors, then decorate.
- **Catacombs** — pack rectangular rooms via subdivision/accretion.
- **Caves** — drunkard-walk style organic carving.
- **Hell** — generate one quadrant, mirror it for symmetry, patch in preset quest chunks.

Two Boris observations carry straight into D2 (and into Pinball Knight):

1. **Generate-and-test**: Diablo's generators are full of loops that simply *retry the whole level* if constraints fail (not enough floor tiles, quest room won't fit). Cheap, robust, and invisible to the player.
2. **Preset stamps inside random fields**: quest areas are hand-authored mini-maps stamped into the random layout, so authored setpieces coexist with procedural filler.

### 1.2 D2's three DRLG types

D2's engine (the "DRLG" — Dungeon Random Level Generator) classifies every area as one of three types, per [Phrozen Keep's modding documentation](https://d2mods.info/forum/kb/viewarticle?a=315) and the [levels.txt file format](https://d2mods.info/forum/viewtopic.php?t=42349):

| DRLG type | Used for | Method |
|---|---|---|
| **Type 1 — Maze** | Dungeons (Catacombs, Arcane Sanctuary, Durance…) | Randomly assemble hand-authored **rooms** (each a `.ds1` preset file) into a connected maze |
| **Type 2 — Preset** | Fixed maps (towns, Tristram, boss lairs) | Load one authored `.ds1`, optionally with randomized sub-chunks |
| **Type 3 — Outdoor** | Wilderness (Blood Moor, deserts, kurast) | Carve a bounded region into zones, join with hardcoded adjacency rules, fill with tile patterns |

The engine's spatial hierarchy is **Act → Level → Room → TileGrid → Tile → SubTile** ([Phrozen Keep](https://d2mods.info/forum/viewtopic.php?f=81&t=52463&view=previous)). The key idea: **the atom of randomness is the *room preset*, not the tile.** Blizzard's designers hand-built a library of room chunks per tileset — each with guaranteed-valid interior layout, decoration, and connection edges — and the generator's only real job is picking which chunks to use and how to wire them together. [Reverse Design](http://thegamedesignforum.com/features/RD_D2_5.html) calls this **"deck-of-cards" randomness**: shuffle a finite deck of authored chunks, versus "randomness within a range" used for coarse decisions (map dimensions between per-area X/Y min/max, feature placement kept a bounded distance — e.g. ~20 yards — from map edges to avoid collision glitches).

Outdoor areas are the least structured and the least documented; even modders describe overworld sizing as "quite hard… not at all as structured and easy to understand as maze generation" ([Phrozen Keep](https://d2mods.info/forum/viewtopic.php?f=81&t=52463&view=previous)). Community tooling like [squeek502's d2-map-investigation](https://github.com/squeek502/d2-map-investigation) and [d2-mapper](https://github.com/mgalos999/d2-mapper) exists precisely because the layouts are seed-deterministic (see below) and worth predicting.

### 1.3 Seeds and persistence

Each game is created with a **map seed**; every area's layout is a pure function of (seed, area id, difficulty). Consequences the community exploits ([speedrun.com discussion](https://www.speedrun.com/d2lod/forums/bonqd)):

- Within one game session, re-entering an area gives the same layout; making a *new game* rerolls everything. This is D2's replay heartbeat — "new game" = "new world", at zero authoring cost.
- Single-player retains the seed per character, enabling "map fishing": players reroll until they get a short Countess or Meph layout, then keep it. **Layout quality is a farmable resource** — a fascinating emergent economy of map generation.
- Speedrunners and botters can predict exit directions from partial reveals because inter-room adjacency rules are constrained (e.g., certain levels' exits correlate with entrance orientation).

### 1.4 Waypoints and why semi-random maps stay readable

D2's answer to "random maps are disorienting" is a stack of *invariants* riding on top of the randomness:

1. **Fixed topology, random geometry.** The act's area graph never changes: Blood Moor always connects to Cold Plains, the Countess is always on Tower Level 5. Only the shape of each area rerolls. Players build a *route* mentally, and the generator only randomizes the *legwork*.
2. **Waypoints** — one per major area, at a random position but guaranteed present — convert exploration into permanent progress. Finding the waypoint is the real reward of first-clearing an area; afterwards the area collapses to a teleport node.
3. **Consistent tile vocabulary per tileset.** Because rooms are authored presets, door shapes, wall thicknesses, and landmark decorations are always drawn from the same deck; a player who has seen 20 Catacombs layouts sight-reads the 21st.
4. **Directional biases.** Many outdoor areas have a known macro-direction (e.g., the next-area exit tends to lie along the outer rim; monastery gate is along the road). Community guides teach these as "map tricks" — evidence the generator leaks just enough structure to be learnable, which is the design sweet spot: *learnable macro, unlearnable micro*.
5. **Bounded sizes.** Area dimensions roll within per-area min/max ([Area Size tables](https://diablo-archive.fandom.com/wiki/Area_Size_(Diablo_II))), so run length variance is capped. A "bad" Durance roll costs you a minute, not a run.

### 1.5 Design theory takeaway

The D2 generator is deliberately *unambitious*: it never tries to invent architecture, only to recombine it. Brevik's GDC postmortems ([GDC Vault](https://gdcvault.com/play/1023469/Classic-Game-Postmortem), [7 design lessons](https://www.gamedeveloper.com/design/7-design-lessons-from-the-history-of-diablo)) stress "find the fun early and iterate" — the tile-preset system is exactly that philosophy applied to level art: artists iterate on chunks that are guaranteed to appear, and the generator's failure modes are bounded by chunk quality. Randomness serves *pacing* (where's the exit? how big is this floor?) rather than *novelty*.

---

## 2. Game design theory: the loop, the tiers, the treadmill

### 2.1 Core loop

Kill → loot explodes on the floor → pick up → **identify** (a paid/consumable reveal step that adds a second anticipation spike per item) → compare/optimize → vendor/stash/trade → kill faster → repeat. Two structural notes:

- **The slot machine is the game.** Brevik's postmortem line of thinking (and the [Gamasutra design-lessons summary](https://www.gamedeveloper.com/design/7-design-lessons-from-the-history-of-diablo)): the loot drop is a variable-ratio reinforcement schedule, and everything else — combat, maps, difficulty — exists to space out pulls of the lever. The *unidentified* state is a second lever pull on the same item.
- **Loot is 3-stage anticipation**: (1) the drop sound/color on the floor, (2) the identify, (3) the "is the roll good" check within the item's stat ranges. Each stage can independently disappoint or delight. Pinball Knight's cards currently have ~1 stage (drop).

### 2.2 Difficulty tiers as content re-use

Normal → Nightmare → Hell replays the identical 5-act campaign three times with re-tuned numbers. What changes ([PureDiablo difficulty guide](https://www.purediablo.com/diablo-2/diablo-2-difficulty-levels), [diablowiki Resistance](https://diablo2.diablowiki.net/Resistance)):

- **Player resistance penalty**: 0 / **−40** / **−100** to all resists in Normal/NM/Hell. One number per tier turns "resists" from a stat you ignore into the single most important defensive chase in Hell.
- **Monster levels** re-derive from **area level** in NM/Hell (see §3.6), so every zone re-tunes automatically from a single column in `levels.txt`.
- **Monster immunities** appear in Hell (see §3.5) — forcing build diversification or party play.
- Death penalties scale: XP loss on death (5%/10% of current level's XP in NM/Hell, partially recoverable from the corpse), and merc/gear friction.
- NM/Hell also add XP-share and drop changes: Treasure Classes upgrade with mlvl, so the same zone drops a better slice of the item database.

The economic insight: **three difficulty tiers ≈ 3× content for ~1.05× authoring cost**, and the tier gates (resist penalty, immunities) are *systemic*, not per-zone hand-tuning.

### 2.3 The endgame chase

- **TC85 farming**: only areas with area level ≥ 85 can drop every item in the game ([DiabloDex area/TC guide](https://diablodex.com/Guides/Areas/)); this designates a farmable endgame *map pool* without building any new content.
- **Runes + runewords (LoD)**: 33 runes in a steeply geometric rarity ladder; specific socketed-base + rune-sequence recipes (Enigma, Infinity, Call to Arms) define build-enabling chase items ([runeword overview](https://diablo2.wiki.fextralife.com/Runewords)). Because runes are *currency-like* (deterministic effects, tradeable, upgradeable 3:1 at the cube), they became the de-facto player economy standard.
- **1.10 synergies** (§4.4) coupled character power to *total skill investment*, making rebuilds/alt characters a retention loop of their own.
- **Why the treadmill retains**: near-miss density. The drop system (§3) is tuned so that *something* interesting drops constantly (rares, mid runes), while the specific chase item stays 10³–10⁵ kills away. [Reverse Design](http://thegamedesignforum.com/features/RD_D2_5.html) estimates roughly "one TC87 item per thousand Baal kills" — the top of the ladder is reachable but only via volume, and Magic Find (§3.3) gives the player a *build lever* over the odds, converting grind into an optimization problem the player feels they control.

---

## 3. The drop math: Treasure Classes, MF, affixes, hit chance, scaling

> Everything in this section is community reverse-engineering of the game's data files (`TreasureClassEx.txt`, `MagicPrefix/Suffix.txt`, etc.) and disassembly — chiefly [The Phrozen Keep's TreasureClassEx docs](https://d2mods.info/forum/kb/viewarticle?a=410), the [diablowiki Item Generation Tutorial](https://diablo2.diablowiki.net/Item_Generation_Tutorial), and the [silospen drop calculator](https://dropcalc.silospen.com/). Treat exact values as v1.10+ LoD.

### 3.1 Treasure Classes: a weighted probability tree

Every monster maps (per difficulty) to a **Treasure Class** — a weighted list of up to 10 entries, where each entry is either a concrete item type or *another TC*. Rolling a drop is a weighted walk down this tree.

- Each TC has **Picks** = how many independent rolls to make (bosses have multi-pick TCs; Baal effectively drops 5-6 items). Negative Picks means "drop every listed entry" (used for guaranteed quest drops) ([Phrozen Keep](https://d2mods.info/forum/viewtopic.php?t=30636)).
- Each TC also has a **NoDrop** weight competing with the item entries. Probability of an entry = `Prob_i / (NoDrop + ΣProb)`.
- **NoDrop shrinks with player count.** The documented recomputation ([Phrozen Keep](https://d2mods.info/forum/viewtopic.php?t=67310)):

  ```
  n   = 1 + floor((players_in_game + nearby_partied_players) / 2)   // the "NoDrop exponent"
  p0  = NoDrop / (NoDrop + SumProb)
  NoDrop' = round( p0^n / (1 - p0^n) * SumProb )
  ```

  i.e. the chance of *nothing* is exponentiated by group size, then converted back to an integer weight. More players ⇒ more total drops, but each *entry's* relative odds are untouched. This is the cleanest known way to scale generosity without touching rarity ratios.
- TCs are arranged in **level bands** (`armo3, armo6, … armo87`; `weap3…`), and monster TCs **auto-upgrade** in NM/Hell to the band matching the monster's level — so drop tables re-tune themselves from mlvl without per-monster authoring.
- After the tree walk selects a *base item*, a separate **quality roll** (§3.3) decides unique/set/rare/magic, then **affix rolls** (§3.4) fill in stats. Item generation is a pipeline: *base → quality → affixes → per-affix value rolls* — four independently tunable layers.
- **Runes** live in chained TCs (`Runes 1` … `Runes 17`), each giving a small weight to its own pair of runes and a large weight to the next-lower TC — producing a geometric rarity curve where each rune tier is roughly 2-3× rarer than the last, and top runes reach 1-in-10⁴–10⁵ odds from ordinary monsters (see [silospen dropcalc](https://dropcalc.silospen.com/) for exact per-monster numbers). The Countess carries a special forced-rune TC, making her *the* deterministic rune-farming target — a deliberately placed "reliable slow faucet" next to the lottery.

### 3.2 Why a tree instead of a flat table

1. **Composability** — one shared `armo/weap/misc` band hierarchy serves 22+ monster families; fixing a band fixes every monster referencing it.
2. **Level-gating for free** — band membership by qlvl means content difficulty and loot quality co-scale via a single integer.
3. **Tunable "nothing"** — NoDrop as a first-class weight lets designers set drop *rate* independently of drop *composition*, and scale it with party size by exponent rather than by editing tables.

### 3.3 Quality roll and Magic Find diminishing returns

After base selection, the game rolls quality **in descending order: unique → set → rare → magic**; each stage failure cascades to the next ([Item Generation Tutorial](https://diablo2.diablowiki.net/Item_Generation_Tutorial), [GameFAQs MF mechanics guide](https://gamefaqs.gamespot.com/pc/197113-diablo-ii/faqs/55871)). Each stage's odds come from data-file base chances modified by mlvl vs qlvl and by **effective Magic Find**, which is the raw MF stat passed through a per-quality rational cap ([diablowiki](https://diablo2.diablowiki.net/Magic_find_diminishing_returns)):

```
EffectiveMF(unique) = MF * 250 / (MF + 250)     // asymptote 250
EffectiveMF(set)    = MF * 500 / (MF + 500)     // asymptote 500
EffectiveMF(rare)   = MF * 600 / (MF + 600)     // asymptote 600
// magic-quality MF is uncapped
```

At 100 MF you keep ~71% of it for uniques; at 400 MF only ~38%; 697 MF yields effective 184 ([PureDiablo](https://www.purediablo.com/diablo-2/magic-find-diminishing-returns)). Design intent, per community consensus: MF must stay worth stacking (player agency over the lottery) without letting a dedicated MF set trivialize rarity — and crucially the *harshest* cap is on the *most valuable* quality. The hyperbola `x·k/(x+k)` is D2's signature diminishing-returns primitive (it reappears in IAS math, §4.3).

Also note what MF does **not** do: it never increases the *number* of drops (that's player count via NoDrop), only shifts quality. Quantity and quality are separate dials.

### 3.4 Affix math: ilvl, qlvl, alvl, maglvl

Every generated item carries an **ilvl** (= mlvl of the dropping monster; [diablowiki Item level](https://diablo2.diablowiki.net/Item_level)); every base type has a **qlvl** (its position in the item ladder); every affix has a required **alvl**. The affix level actually used is derived ([community formula, PureDiablo/diablowiki](https://www.purediablo.com/forums/threads/a-few-problems-with-guides-about-item-affixes-and-level-requirements.188913/)):

```
ilvl = min(ilvl, 99);  if qlvl > ilvl: ilvl = qlvl
if maglvl > 0:               alvl = ilvl + maglvl
else if ilvl < 99 - qlvl/2:  alvl = ilvl - qlvl/2
else:                        alvl = 2*ilvl - 99
```

- The `ilvl − qlvl/2` term means **high-tier bases pay an affix-level tax** — a subtle balance lever ensuring elite bases don't automatically also roll the best affixes unless dropped by high monsters.
- **maglvl** (magic level bonus on circlets: Circlet +3, Coronet +8, Tiara +13, Diadem +18; wands/staves/orbs +1) lets specific "caster" bases roll affixes *above* their ilvl — a designed exception that made circlets a distinct chase category ([Affixes](https://diablo-archive.fandom.com/wiki/Affixes_(Diablo_II))).
- Affix *pools* are gated by alvl ≥ affix level; higher zones therefore unlock strictly larger affix decks. This is why "area level 85" matters as much for *rolls* as for *bases*.
- **Gambling** ([diablowiki Gambling](https://diablo2.diablowiki.net/Gambling)): gambled ilvl rolls uniformly in `[clvl−5, clvl+4]`; fixed quality odds of **unique 1/2000, set 1/1000, rare 10%, magic ~89.85%**, MF has *no effect*; exceptional/elite upgrade chances scale with (ilvl − qlvl). Gambling is thus a *gold sink with bounded odds* — a designed pressure-release valve for currency, deliberately worse than farming for chase items but reliable for rares.

### 3.5 Hit chance, resistances, immunities

**Chance to hit** ([Attack Rating](https://diablo-archive.fandom.com/wiki/Attack_Rating_(Diablo_II)), [Maxroll hit-chance](https://maxroll.gg/d2/resources/hit-chance-mechanics)):

```
CTH = 200% * [AR / (AR + DEF)] * [alvl / (alvl + dlvl)]
clamped to [5%, 95%]
```

Two rational terms multiplied: a *gear* term and a *level* term, both saturating at 100% each so their product tops out at 200% before the clamp. The level term is the anti-twink device — no amount of AR lets a level 10 reliably hit a level 80 — and the 5%/95% clamp guarantees both hope and risk always exist. (The much-criticized side effect: the level term makes melee accuracy feel bad all game, one reason later ARPGs dropped it — [player criticism thread](https://us.forums.blizzard.com/en/d2r/t/can-we-modify-the-attack-rating-formula-to-be-more-reasonable/161390).)

**Resistances**: damage taken multiplied by `(100 − res)/100`, res capped at 75 by default (raisable to 95 by gear), floored at −100. Difficulty penalties −0/−40/−100 (§2.2). **Immunity** = resistance ≥ 100 after difficulty modifiers; monsters in Hell commonly sit at 100-120 in one element.

**Immunity breaking** ([PureDiablo immunities guide](https://www.purediablo.com/strategy/monster-resistances-immunities-guide), [Maxroll](https://maxroll.gg/d2/resources/immunities)): only Conviction and Lower Resist can break an immunity, and they apply at **1/5 effectiveness** while the target is immune (e.g. Hell Fallen at 110 fire res need ≥55 of listed lowering to break; once below 100, further reduction applies at full value). This "reduction works, but at 20% through the wall" rule is an elegant middle ground between hard immunities (build bricked) and soft resists (immunities meaningless).

### 3.6 Monster scaling

- **NM/Hell**: `mlvl = area level` (champions +2, uniques +3) ([diablowiki Area Level](https://diablo2.diablowiki.net/Area_Level)) — and since ilvl = mlvl, the *zone* is the single source of truth for both danger and loot ceiling.
- **Player count** ([Player Settings](https://diablo2.diablowiki.net/Player_Settings)): monster HP and XP scale identically:

  ```
  Life = BaseLife * (players + 1) / 2      // +50% per extra player; 8p = 450% HP & XP
  ```

  Damage/AR do **not** scale with players in classic (only in D2R's later patches for melee) — so more players = spongier but not deadlier, biasing multiplayer toward efficiency play (`/players 8` solo XP farming).

### 3.7 Experience curves and penalties

([diablowiki Experience](https://diablo2.diablowiki.net/Experience), [PureDiablo](https://www.purediablo.com/diablo-2/diablo-2-experience))

- **Level-gap penalty**: if clvl and mlvl differ by more than 5, XP is scaled by roughly `clvl/mlvl` (documented for the character-above-monster direction; below-monster is more forgiving) — the anti-boost and anti-overfarm dial.
- **High-level wall**: past clvl 70, a flat percentage table multiplies all XP: **95.31% at 70**, decaying steeply through the 80s and 90s to low single-digit percentages by 98-99. Combined with an exponential XP-to-level curve, levels 98→99 famously take hundreds of hours. Level 99 is a *prestige* goal, not a power requirement (~all builds complete at 85-95).
- **Party split**: XP is multiplied by 1.5^(partysize-ish bonus) then split proportionally to member levels among partied players in range — rewarding grouped play ~35% over the sum of solo play, but only near the kill.

---

## 4. Character stat math and the 25fps skeleton

### 4.1 What the four stats do

(Values from [Arreat Summit basics](https://classic.battle.net/diablo2exp/basics/characterinfo.shtml) / [Character Attributes](https://diablo.fandom.com/wiki/Character_Attributes); per-class constants.)

- **Strength**: gear requirement gate + **+1% enhanced damage per point** to melee/throw weapon damage. Linear, no cap.
- **Dexterity**: gear gate + **+5 Attack Rating per point** (most classes) + ranged/some-melee %ED + block chance:

  ```
  Block% = BlockRating * (DEX − 15) / (clvl * 2)     // capped 75%
  ```

  Note the **clvl in the denominator** — block *decays* as you level unless you keep feeding DEX. A maintenance cost, not a one-time purchase.
- **Vitality**: life per point is per-class — Barbarian 4, Amazon/Paladin/Assassin 3, Sorceress/Necromancer/Druid 2. Because life is the only universal defense (resists cap, defense is unreliable per §3.5), the dominant strategy became "max damage stats minimally, dump everything else into VIT" — a known failure of the stat system (three of four stats are gates/thresholds, one is a dump).
- **Energy**: mana per point (Sorc 2, casters ~1.75-2, Barb 1). Almost never invested at endgame because mana-per-kill and mana-on-gear outscale it — the second dead stat.

Design verdict (widely shared in retrospectives): D2's *attribute* layer failed — D3 removed manual stats entirely — while its *skill/item* layers succeeded. The lesson is that per-point linear stats with hard gear gates collapse into a solved allocation.

### 4.2 The 25fps engine and breakpoints

D2 simulates at **25 fps**, and every animation takes an integer number of frames; therefore percentage speed stats (Faster Cast Rate, Faster Hit Recovery, Faster Block Rate, Increased Attack Speed) only matter when they cross a threshold that removes a whole frame ([diablowiki Breakpoints](https://diablo2.diablowiki.net/Breakpoints), [Maxroll](https://maxroll.gg/d2/resources/breakpoints-animations)). Example, Sorceress FCR (most spells):

| FCR | 0 | 9 | 20 | 37 | 63 | 105 | 200 |
|---|---|---|---|---|---|---|---|
| Cast frames | 13 | 12 | 11 | 10 | 9 | 8 | 7 |

So 37% and 62% FCR cast **identically**; 63% is a new tier. Consequences:

- Gear planning becomes a knapsack problem ("reach 105 FCR and 86 FHR with these slots"), a *hugely* popular metagame that emerged from a hardware limitation, not a design intent.
- Costs escalate super-linearly per frame (9→20→37→63→105→200): each frame removed is a bigger multiplicative speedup (12f→11f is +9% throughput; 8f→7f is +14%), and the stat price roughly doubles per tier — an implicit diminishing-returns curve made of stairs.
- FHR breakpoints govern hit-stun recovery; monsters putting you into repeated hit-recovery ("stunlock") made FHR tiers a survival stat, ensuring even defensive gearing has thresholds to chase.

### 4.3 IAS: diminishing returns before quantization

Attack speed runs through an extra squashing step before frame lookup (community-derived from disassembly, [diablowiki/Maxroll IAS docs](https://maxroll.gg/d2/resources/breakpoints-animations)):

```
EIAS = floor(120 * IAS / (120 + IAS))          // gear IAS, hyperbolic cap at 120
speed = base_anim_speed * (100 + EIAS + skill_IAS - WSM) / 100
frames = ceil(256 * base_frames / floor(speed * 256/100)) ... (per-weapon table)
```

i.e. the same `x·k/(x+k)` hyperbola as Magic Find, feeding into integer frame math, further modified by Weapon Speed Modifier per base weapon. Result: IAS breakpoints differ per weapon/skill/class and require calculators — universally considered *over*-complex. The layering (smooth diminishing curve → integer quantization) is instructive, the opacity is the cautionary tale.

### 4.4 Skill synergies (v1.10)

Each skill lists 1-3 synergy skills granting a per-hard-point bonus, e.g. each point in a synergy adds +12% damage to Zeal from Sacrifice, +5% from Fanaticism, etc. ([diablowiki Synergies](https://diablo2.diablowiki.net/Synergies)). Two crucial rules:

- **Only hard points count** — +skills gear does *not* feed synergies. This preserves gear value for the main skill while making the *build sheet itself* the synergy investment, preventing gear from double-dipping.
- Synergies converted "one-point-wonder" builds into 60-100-point commitments: a maxed skill + 2 maxed synergies consumes most of a character's ~110 lifetime skill points. This created build identity and rebuild/alt retention, at the cost of rigidity (fixed in D2R by cheap respecs).

---

## 5. Lessons for Pinball Knight

Pinball Knight already has the surface (sockets, rarity ladder, gamble, corpse runs). These are the *mechanisms* underneath D2 worth porting — or explicitly rejecting.

### 5.1 Drop math for the card/rarity system

1. **Restructure drops as a TC-style tree, not flat per-enemy tables.** Give each of the 22 enemy families a small weighted list whose entries are mostly *shared band TCs* (`cards_lvl1..N`, `gear_lvlN`, `gold`, `NoDrop`). One shared band per floor-depth range means retuning a depth retunes every family at once, and adding a card automatically injects it everywhere its band is referenced.
2. **Make NoDrop a first-class weight, and scale it by co-op party size with the exponent trick.** `p_nothing^n` for n players preserves *rarity ratios* exactly while raising drop volume — the correct multiplayer generosity knob, and trivially cheap at 60Hz. D2's rule that party scaling touches quantity (NoDrop) while MF-style stats touch quality is worth copying wholesale: **separate the quantity dial from the quality dial.**
3. **Adopt the `x·k/(x+k)` hyperbola for any stackable "luck" stat**, with a *lower* asymptote for higher rarities (D2: 250 unique / 500 set / 600 rare). It's smooth, cheap, self-capping, and lets players stack luck forever without ever breaking the top of the ladder. If cards or legacy perks grant drop luck, run them through this before the quality roll.
4. **Quality rolls should cascade downward** (mythic→…→common, first success wins). This makes each tier's tuning independent and makes "luck" stats affect all tiers coherently with one pass.
5. **Split card generation into pipeline stages** like D2's base→quality→affix→value-roll: card family → shine/level → bonus rolls. Pinball Knight's `#4s`-style instance IDs already encode level+shine — adding a third stage (a small random roll *within* a range on one stat) would add D2's "check the roll" third anticipation beat. Caveat from Reverse Design: **narrow ranges on high-impact stats frustrate** (the +1 vs +2 skills problem); randomize wide low-impact ranges, keep high-impact values deterministic per tier.
6. **Add an ilvl/alvl analogue: floor depth stamps dropped cards.** D2's `ilvl = mlvl = area level` chain means the zone is the single source of truth for the loot ceiling. Deep floors should unlock card *pools* (alvl gating), not just raise quantities — this makes depth itself the chase, and creates the "TC85 zone" effect: designate the deepest band as the only place the full card set drops, and players will farm depth for its own sake.
7. **Give the upgrade gamble a Countess.** D2 pairs the lottery (random high-rune drops) with one deterministic slow faucet (Countess forced-rune TC, cube 3:1 upcombining). If upgrade materials or high-shine cards are pure lottery, add one boss/vendor that reliably trickles the low tier plus a lossy combine recipe — the *pity system that predates pity systems*, and it also creates a farming route (map knowledge → §5.2).
8. **Keep gambling MF-immune and odds-fixed** (D2: unique 1/2000, no MF effect). The gamble vendor should be a gold sink with *worse* expected value than play, priced so it stays a use for surplus currency rather than the optimal strategy.

### 5.2 Map generation for a maze-with-momentum game

1. **Preset chunks over per-tile noise.** Pinball Knight's maze already grows a circuit track-first; D2's lesson is to make the *authored chunk* the unit of randomness. A hand-built library of momentum setpieces — banked S-curves, chute+booster combos, bounce chambers with material flooring — with typed connection sockets (Pinball Knight already has a socket contract for track geometry) gives guaranteed-fun local physics with global variety. The generator's job shrinks to chunk selection + wiring, and "generate-and-test with full retry" (Boris's D1 observation) is a perfectly respectable validity strategy at maze scale.
2. **Fixed topology, random geometry.** Keep the floor-to-floor structure invariant (boss every N floors, one guaranteed exit, kitchen/vendor rooms on known cadence) and randomize only the in-floor layout. D2 proves players tolerate — enjoy — infinite geometric reshuffling as long as the *route-level* map in their head never invalidates.
3. **Waypoints for corpse runs.** Pinball Knight has corpse recovery; D2's corpse-run pain is bounded by waypoints. A once-per-floor checkpoint (discovered, then permanent for the session) converts death from "replay everything" to "replay the local leg", which is what makes corpse-run economies feel fair rather than punitive.
4. **Leak learnable macro-structure.** D2's exits bias along rims/roads and the community treasures these "map tricks". In a maze game: bias the exit to the far side of the circuit, keep boosters pointing net-clockwise, etc. — invariants skilled players can read at a glance. Learnable macro + unlearnable micro is the readability formula.
5. **Expose the seed, persist it per run, and let layout be farmable.** D2's map-fishing shows players treat a good layout as loot. Since Pinball Knight already uses `--seed` for the maze (and knows it doesn't pin the bot), surfacing seeds as shareable "daily circuit" challenges is nearly free — and a seeded-deterministic DRLG is also the regression-test harness for the generator.
6. **Bound layout variance.** Per-depth min/max floor sizes (D2's per-area size ranges) cap the cost of a bad roll. In a momentum game, also bound *derived* quantities: minimum straightaway count, maximum dead-end density — physics-feel constraints belong in the validator, not the generator.

### 5.3 Stat math at fixed 60Hz: adopt, adapt, avoid

1. **Breakpoints will happen to you whether you design them or not.** At a fixed 60Hz timestep, any cooldown/animation measured in ticks quantizes exactly like D2's 25fps frames. D2's lesson is to *surface* this: publish the tiers ("attack speed tiers: 0/15/35/70%"), make each tier a felt jump, and price tiers super-linearly. The alternative — pretending a +7% attack-speed card did something when it didn't cross a tick — is the worst outcome: D2 at least let calculators expose the truth. At 60Hz the frames are 2.4× finer than D2's, so tiers can be denser and less brutal — but they should still be *named tiers*, not raw percentages.
2. **Do not port the IAS pipeline.** Hyperbola → per-weapon modifier → integer table lookup was opaque enough to require third-party calculators. One squashing function, one quantization step, published table. That's the budget.
3. **Adopt the hyperbolic soft cap as the house diminishing-returns curve** for restitution bonuses, speed stacking, luck, cooldown reduction: `eff = x*k/(x+k)`. It needs no clamps, composes with itself, and the single constant `k` *is* the balance dial. This matters doubly in a physics game: Pinball Knight already hit the "damp guard can never beat a speed floor" bug — hyperbolic caps on bounce/speed stats are structurally incapable of runaway, unlike percentage stacks that must be clamped after the fact.
4. **Avoid pure dump stats.** D2's STR/DEX-as-gates + VIT-as-dump + ENE-as-dead is the canonical failed stat layer. If run-scoped skill points buy attributes, every attribute needs either a breakpoint ladder of its own or a second effect (D2's DEX-block formula, where the value *decays with level* and must be maintained, is a clever if player-hostile template).
5. **Steal the two-term hit/effect formula shape** `200% * gear/(gear+defense) * lvl/(lvl+lvl)` if any accuracy/proc contest exists (e.g. card proc chance vs enemy tier): two saturating rational terms + hard 5-95% clamps guarantee no interaction is ever certain or hopeless. But *skip the level term for player attacks* — it's the part D2 players hated.
6. **Hard-point-only synergies for the skill tree.** If cards or gear can grant +skill effects, D2's rule — gear boosts the skill's output, but only *invested* points feed synergies — cleanly prevents double-dipping and keeps the run-scoped tree meaningful next to card power. Synergies are also the cheapest way to turn 20 skills into 200 builds: N skills + M synergy links, zero new content.
7. **Difficulty tiers via systemic gates, not stat inflation alone.** D2's −40/−100 resist penalty and Hell immunities re-theme identical content by *changing which stats matter*. Pinball Knight's surface materials are the natural analogue: deeper tiers could globally shift friction/restitution baselines (the "Hell penalty" applied to physics) and introduce enemies immune to specific card damage types with a 1/5-effectiveness break rule — forcing kit diversity exactly the way Hell immunities force elemental diversity, without bricking a build outright.
8. **XP anti-farm dials**: the `clvl/mlvl` gap penalty and the post-70 percentage wall are the two knobs that keep D2's level 99 prestigious for 25 years. For legacy meta-perks, a steep late-curve percentage table (not a hard cap) is the proven way to make the last tiers aspirational while keeping every run non-zero progress.

### 5.4 The one-sentence summaries

- **Drops**: quantity and quality are separate dials — NoDrop^players for quantity, hyperbolic-capped luck for quality, cascading quality rolls, depth-stamped pools.
- **Maps**: author the chunks, randomize the wiring, fix the topology, leak the macro, seed everything.
- **Stats**: at a fixed timestep you are building a breakpoint game — so publish the staircase, cap with hyperbolas, and never ship a dump stat.

---

## Sources

- [Erich Schaefer, "Postmortem: Blizzard's Diablo II" (Gamasutra, 2000)](https://www.gamedeveloper.com/design/gamasutra-classics-the-making-of-i-diablo-ii-i-) · [full-text mirror](http://ksuweb.kennesaw.edu/~jprest20/cgdd2002/readings/postmortem_blizzards_diablo_ii.php.htm)
- [David Brevik, "Classic Game Postmortem: Diablo" (GDC 2016)](https://gdcvault.com/play/1023469/Classic-Game-Postmortem) · [7 design lessons from the history of Diablo](https://www.gamedeveloper.com/design/7-design-lessons-from-the-history-of-diablo)
- [BorisTheBrave, "Dungeon Generation in Diablo 1"](https://www.boristhebrave.com/2019/07/14/dungeon-generation-in-diablo-1/)
- [Reverse Design: Diablo 2 — Randomness](http://thegamedesignforum.com/features/RD_D2_5.html)
- Phrozen Keep (data-file reverse engineering): [TreasureClassEx docs](https://d2mods.info/forum/kb/viewarticle?a=410) · [NoDrop mechanics](https://d2mods.info/forum/viewtopic.php?t=67310) · [Picks](https://d2mods.info/forum/viewtopic.php?t=30636) · [preset levels / DRLG hierarchy](https://d2mods.info/forum/kb/viewarticle?a=315)
- diablowiki.net: [Item Generation Tutorial](https://diablo2.diablowiki.net/Item_Generation_Tutorial) · [MF diminishing returns](https://diablo2.diablowiki.net/Magic_find_diminishing_returns) · [Item level](https://diablo2.diablowiki.net/Item_level) · [Area Level](https://diablo2.diablowiki.net/Area_Level) · [Player Settings](https://diablo2.diablowiki.net/Player_Settings) · [Experience](https://diablo2.diablowiki.net/Experience) · [Breakpoints](https://diablo2.diablowiki.net/Breakpoints) · [Synergies](https://diablo2.diablowiki.net/Synergies) · [Gambling](https://diablo2.diablowiki.net/Gambling) · [Resistance](https://diablo2.diablowiki.net/Resistance)
- Maxroll D2R resources (remaster-verified mechanics): [Breakpoints & Animations](https://maxroll.gg/d2/resources/breakpoints-animations) · [Hit Chance](https://maxroll.gg/d2/resources/hit-chance-mechanics) · [Immunities](https://maxroll.gg/d2/resources/immunities) · [Player Settings](https://maxroll.gg/d2/resources/player-settings)
- [silospen drop calculator](https://dropcalc.silospen.com/) · [Fenriradramelk's MF Mechanics Guide (GameFAQs)](https://gamefaqs.gamespot.com/pc/197113-diablo-ii/faqs/55871)
- [PureDiablo: MF diminishing returns](https://www.purediablo.com/diablo-2/magic-find-diminishing-returns) · [Monster Resistances & Immunities](https://www.purediablo.com/strategy/monster-resistances-immunities-guide) · [Experience](https://www.purediablo.com/diablo-2/diablo-2-experience) · [affix-level corrections thread](https://www.purediablo.com/forums/threads/a-few-problems-with-guides-about-item-affixes-and-level-requirements.188913/)
- Community map tooling: [squeek502/d2-map-investigation](https://github.com/squeek502/d2-map-investigation) · [mgalos999/d2-mapper](https://github.com/mgalos999/d2-mapper) · [speedrun.com PRNG discussion](https://www.speedrun.com/d2lod/forums/bonqd)
- [Arreat Summit (classic.battle.net) character basics](https://classic.battle.net/diablo2exp/basics/characterinfo.shtml) · [Diablo Fandom: Character Attributes](https://diablo.fandom.com/wiki/Character_Attributes) · [Attack Rating](https://diablo-archive.fandom.com/wiki/Attack_Rating_(Diablo_II))

*All formulas above are community reverse-engineering of the game's data tables and binaries (v1.10+ LoD baseline), not official Blizzard documentation; where sources disagree or precision is uncertain (rune TC ratios, IAS pipeline details, XP penalty table tails), this report says so inline.*
