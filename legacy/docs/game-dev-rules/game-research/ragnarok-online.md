# Ragnarok Online — Cards, Refining, and the Math of Permanent Risk

**Why this game is in the research set:** Pinball Knight's two core meta-systems — monster-drop cards socketed into gear, and a refine gamble that can destroy the item — are explicitly modeled on Ragnarok Online (Gravity, 2002). RO ran these systems for two decades at MMO scale, so it is the best available dataset on what ultra-rare permanent sockets and break-on-failure upgrades do to an economy, to player psychology, and to build identity. This report documents how classic (pre-renewal) RO actually works, with real numbers from [iRO Wiki Classic](https://irowiki.org/classic/Main_Page), [iRO Wiki](https://irowiki.org/wiki/Main_Page), and [RateMyServer](https://ratemyserver.net/), and closes with concrete tuning takeaways for Pinball Knight's card drops, refine break-chances, multiplier tables, and stat curves. Where a number is community-measured rather than officially published, it is marked as such.

---

## 1. The Card System

### 1.1 How cards drop

- Almost every monster in the game can drop **its own card** at a base rate of **0.01%** (1 in 10,000 kills) — [iRO Wiki: Card System](https://irowiki.org/wiki/Card_System). The [Drop System](https://irowiki.org/wiki/Drop_System) page notes card rates on the order of 0.02% for some cards after server modifiers, vs. ~25% for a common junk drop from the same monster — a **spread of more than three orders of magnitude inside one monster's 8-slot drop table**.
- **MVP (boss) cards drop at the same 0.01% base**, but the monster spawns once per 1–8 hours per world ([iRO Wiki Classic: MVP](https://irowiki.org/classic/MVP)), is contested server-wide (MVPs are free-for-all), and loot priority goes to the top damage dealer ([Drop System](https://irowiki.org/wiki/Drop_System)). Effective supply is therefore *thousands of times* scarcer than a field-monster card: a farmable field monster might die 100,000+ times per day server-wide; an MVP dies at most ~24 times per day.
- Drop rates are further modified by a **level-difference penalty** (down to 50% of base rate if you out-level the monster by 30+) and by consumables like **Bubble Gum** (+100% drop rate for 30 min) — [Drop System](https://irowiki.org/wiki/Drop_System). Notably, the **LUK stat does not affect drop rates** — a persistent player myth the wiki explicitly debunks ([iRO Wiki Classic: Stats](https://irowiki.org/classic/Stats)).
- Secondary sources: **Old Card Album** (a gamble item that opens into one random *non-MVP* card) and player-to-player trade/vending — [iRO Wiki Classic: Card System](https://irowiki.org/classic/Card_System).

### 1.2 Slots per equipment type

Cards compound only into their own equipment category ([Card System](https://irowiki.org/classic/Card_System)):

| Equipment | Card slots |
|---|---|
| Weapons | **0–4** (only weapons exceed 1 slot) |
| Shield, Armor, Garment, Footgear, Accessory, Headgear (upper) | 0–1 |
| Lower headgear | none |

Two sub-mechanics matter:

- **Slotted vs. unslotted variants**: many weapons exist in an NPC-bought version and a rarer monster-dropped version with one extra slot (e.g. shop `Blade [3]` vs. dropped `Blade [4]`) — the slot count itself is a rarity axis ([Card System](https://irowiki.org/classic/Card_System)).
- **Socket Enchant**: an NPC service can *add* a slot to selected equipment, with success rates that fall as item rank rises, and failure risk — a second gamble layered on top of refining ([Refinement System — Socket Enchants](https://irowiki.org/classic/Refinement_System)).

### 1.3 Cards rename the gear (prefix/suffix system)

Every card carries a prefix or suffix that is stamped onto the item name when compounded — four Hydra cards make a *"Quadruple Bloody Blade"*. This is a free UI-level legibility system: veterans can read a linked item's entire card loadout from its name. Real examples from [iRO Wiki Classic: Card Reference](https://irowiki.org/classic/Card_Reference):

| Card | Effect | Prefix/Suffix |
|---|---|---|
| Hydra (weapon) | +20% damage vs Demi-Human | *Bloody* |
| Skeleton Worker (weapon) | +15% vs Medium size, +5 ATK | *Boned* |
| Minorous (weapon) | +15% vs Large size, +5 ATK | *Titan* |
| Vadon (weapon) | +20% vs Fire-element | *Flammable* |
| Santa Poring (weapon) | +20% vs Shadow-element | *Hallowed* |
| Thara Frog (shield) | −30% damage from Demi-Human | *Cranial* |
| Raydric (garment) | −20% Neutral-element damage | *Immune* |
| Marc (armor) | immune to Frozen | — |
| Angeling (armor) | armor becomes Holy-1 property | *Holy* |

### 1.4 Compounding is PERMANENT

From [Card System — Caution](https://irowiki.org/classic/Card_System), verbatim mechanics:

> "Once you install a card into an equipment, you cannot remove the card from equipment under any circumstance!"

And the interaction that defines RO's whole risk economy:

> "If equipment is destroyed because you failed when you tried to upgrade it, equipment AND all of the installed cards will be destroyed."

Consequences the wiki itself spells out: refine *first*, compound *after* — you buy or build the +7 weapon before you commit the card. (Combat "breakage" from skills like Sword Break merely disables the item and is repairable; cards survive that. Only refine failure annihilates.) Much later kRO/renewal patches added paid card-separation services with a destruction chance, but for the whole classic era, socketing was a one-way door.

### 1.5 Card effect taxonomy

The community's own organization of cards ([Card Reference](https://irowiki.org/classic/Card_Reference)) is effectively a design spec. Categories, with their standardized magnitudes:

| Category | Slot | Standard magnitude | Examples |
|---|---|---|---|
| **Flat stat** | armor/headgear/etc. | +1–3 to a stat, small HP/SP | Poring (+? LUK, junk tier), Apocalypse (+2 VIT) |
| **%damage vs race** | weapon | **+20%** per card, stackable | Hydra (Demi-Human), Goblin (Brute), Caramel (Insect) |
| **%damage vs element** | weapon | **+20%** | Vadon (Fire), Drainliar (Water), Kaho (Earth) |
| **%damage vs size** | weapon | **+15%** (+5 ATK) | Desert Wolf / Skel Worker / Minorous |
| **Crit vs race** | weapon | +10% crit damage, +7 crit rate | Assaulter, Cruiser, Dullahan |
| **%damage reduction vs race** | shield | **−30%** | Thara Frog, Khalitzburg, Anubis |
| **%damage reduction vs element** | garment | **−30%** (Neutral: 10–50%) | Raydric, Jakk, Marse; Deviling (−50% Neutral but **+50% from everything else**) |
| **%damage reduction vs size** | shield | −25% | Mysteltainn / Ogretooth / Executioner |
| **Status inflict on hit** | weapon | ~2–5% proc per hit | Snake (Poison), Skeleton (Stun), Magnolia (Curse) |
| **Status immunity/resist** | armor/accessory | immunity, or 20% resist | Marduk (Silence), Orc Hero (Stun), resist cards 20% |
| **Armor property change** | armor | body becomes element lv-1 | Angeling (Holy), Ghostring (Ghost), Evil Druid (Undead) |
| **Autocast** | weapon/armor | chance to auto-cast a skill on hit/when hit | see [Autocast](https://irowiki.org/classic/Autocast) |
| **Utility/economy** | varies | +10% EXP vs race (with **+20% damage taken** tradeoff), loot/food drops, +ASPD | EXP shoes, Doppelganger (+ASPD 0.1) |
| **Conditional on refine** | varies | bonus only at **+9/+10** ("high upgrade" cards) or only **below +5** ("low upgrade" cards) | Apocalypse (+800 HP at +9), Kavach Icarus (+10 flee, more if <+5) |
| **Stat-switching / set combos** | varies | +1 stat per 18 of another stat; multi-card set bonuses | Card Sets |
| **MVP cards** | varies | build-warping uniques | Ghostring (Ghost armor), Golden Thief Bug (immune to all magic, SP cost ×2), Doppelganger (ASPD), Tao Gunka (+100% HP, −50 DEF/MDEF) |

A few documented MVP/boss-tier card effects, to show how far the top of the curve sits above the +20% commons (effects cited where fetched; this tier is deliberately rule-breaking):

| Card | Slot | Effect (documented) |
|---|---|---|
| Golden Thief Bug | shield | Blocks **all** magic targeted at the wearer — hostile *and* friendly (no heals/buffs land) — at the price of doubled SP costs (community-documented staple; the defining WoE card) |
| Ghostring | armor | Armor becomes **Ghost property** — normal (Neutral) attacks do ×0.25 per the Lv-1 element table ([Element](https://irowiki.org/classic/Element)); the canonical "physical attackers now need a plan" card |
| Deviling | garment | −50% Neutral damage, **+50% from every other element** ([Card Reference](https://irowiki.org/classic/Card_Reference)) |
| Doppelganger | weapon | ASPD speed modifier 0.1 — one of the largest in the game ([ASPD](https://irowiki.org/classic/ASPD)) |
| Alice | shield | −40% from Boss-protocol monsters, **+40% from everything else** ([MVP](https://irowiki.org/classic/MVP)) |
| Abysmal Knight | weapon | +25% physical damage vs Boss-protocol monsters ([Card Reference](https://irowiki.org/classic/Card_Reference)) |

Note the pattern: MVP cards don't do "+40% instead of +20%" — they **change a rule** (element of your body, a whole damage channel blocked, a hard tradeoff). That's why a 0.01% drop on an 8-hour spawn stayed exciting for 20 years: the payoff is qualitative, not a bigger number on the same axis.

Design observations worth copying:

- **Magnitudes are standardized per category** (all race weapon cards are +20%, all race shields −30%, all size weapon cards +15%). Rarity within a category comes from *which monster carries it and how farmable it is*, not from bigger numbers. This kept 400+ cards balanced with a handful of constants.
- **Offense stacks multiplicatively with itself via slots** (4× Hydra), **defense can't** (1 shield slot). Offense gets depth, defense gets choice.
- **The best cards have a cost**: Deviling's −50% Neutral comes with +50% from all other elements; EXP cards add +20% damage taken; GTB doubles SP costs. Top-tier power is a *bet on the encounter*, not a stat stick.
- **Refine-conditional cards** ("works only at +9 or higher") deliberately couple the card system to the refine system, multiplying the value of surviving the +9 gamble.

### 1.6 Why 0.01% permanent sockets created RO's economy and identity

- A card is a **guaranteed-effect item behind a pure lottery**: everyone knows exactly what a Hydra card does; nobody can predictably get one. That splits the playerbase into farmers (sell the lottery ticket) and buyers (pay to skip variance), which *is* the economy. Cards were RO's reserve currency for 20 years.
- **Permanence sinks value.** Every compounded card exits the market; every failed +8 attempt destroys gear *and* cards. Without these sinks, 0.01% drops would still saturate a server within months. The refine failure rule is what kept even common cards priced.
- **Identity**: because the card, the slot count, and the refine level all print onto the item name, a "+9 Quadruple Bloody Blade" is a *biography* — the market can read exactly what was risked to make it.

---

## 2. The Refine / Upgrade System

Source: [iRO Wiki Classic: Refinement System](https://irowiki.org/classic/Refinement_System) and [RateMyServer refine tables](https://ratemyserver.net/index.php?page=misc_table_refine).

### 2.1 Structure

- All equipment refines from +0 to **+10** (classic cap). Cost per attempt scales with weapon level: Phracon (200z) + 50z for Lv-1 weapons up to Oridecon + 20,000z for Lv-4; Elunium + 2,000z for any armor.
- **Safety level** — guaranteed success up to:

| Item | Safe to | ATK per +1 | ATK per over-upgrade (above safe) |
|---|---|---|---|
| Weapon Lv 1 | **+7** | +2 | +3 |
| Weapon Lv 2 | **+6** | +3 | +5 |
| Weapon Lv 3 | **+5** | +5 | +7 |
| Weapon Lv 4 | **+4** | +7 | +13 (wiki marks this value uncertain) |
| Armor (all) | **+4** | ~0.66 DEF (displayed as 1) | — |

Note the double reward gradient: better weapons have a *lower* safe ceiling **and** a *bigger* per-level payoff, and every level past safe pays a premium (over-upgrade bonus). Risk is priced into the reward curve itself. Armor refine is deliberately weak in classic (+10 armor ≈ 6.6 DEF total, [RMS](https://ratemyserver.net/index.php?page=misc_table_refine)) — armor's real value is its card and its element, not its plus.

### 2.2 Success rates per attempt (classic, subscription servers)

From [iRO Wiki Classic: Refinement System](https://irowiki.org/classic/Refinement_System) (RateMyServer lists the same table with +9→+10 as 19% and Lv-4/armor +10 as 9% — the two sources disagree by one point; rAthena-lineage servers use 19/9):

| Attempt | Wpn Lv 1 | Wpn Lv 2 | Wpn Lv 3 | Wpn Lv 4 | Armor |
|---|---|---|---|---|---|
| +4 → +5 | 100% | 100% | 100% | 60% | 60% |
| +5 → +6 | 100% | 100% | 60% | 40% | 40% |
| +6 → +7 | 100% | 60% | 50% | 40% | 40% |
| +7 → +8 | 60% | 40% | 20% | 20% | 20% |
| +8 → +9 | 40% | 20% | 20% | 20% | 20% |
| +9 → +10 | 20% | 20% | 20% | 10% | 10% |

Cumulative odds of walking one item from +0 to the cap without a failure ([same source](https://irowiki.org/classic/Refinement_System)):

| Target | Wpn Lv 1 | Wpn Lv 2 | Wpn Lv 3 | Wpn Lv 4 / Armor |
|---|---|---|---|---|
| +7 | 100% | 60% | 30% | 9.6% |
| +8 | 60% | 24% | 6% | 1.92% |
| +9 | 24% | 4.8% | 1.2% | 0.384% |
| +10 | 4.8% | 0.96% | 0.24% | **0.0384%** |

**Failure = the item is permanently destroyed, with its cards, zeny, and ore** ([Refinement System](https://irowiki.org/classic/Refinement_System)). In classic there is no downgrade-instead-of-break at the NPC: past the safety line, every click is double-or-nothing. (A +10 Lv-4 weapon is a ~1-in-2600 artifact before even counting the cost of acquiring 10 attempts' worth of base items.)

### 2.3 Safety valves

- **Enriched Oridecon / Enriched Elunium** (cash shop / events): same break-on-failure rule but substantially better odds — e.g. +7→+8 goes 20%→40% on Lv-4 weapons, +4→+5 goes 60%→90% ([RMS enriched table](https://ratemyserver.net/index.php?page=misc_table_refine)). Cumulative +0→+10 on a Lv-4 weapon rises from 0.0384% to ~0.29% ([iRO Wiki Classic](https://irowiki.org/classic/Refinement_System)). This monetizes *variance reduction*, not power directly.
- **HD Oridecon / HD Elunium** (renewal): usable only at +7 and above; on failure the item is **not destroyed — it loses 1 refine level instead** ([RMS](https://ratemyserver.net/index.php?page=misc_table_refine)). This converts a ruin-risk into a grind-tax and is the direct ancestor of Pinball Knight's insurance cards.
- **Mastersmith's Upgrade Weapon skill**: +0.5% success per job level past 50 (up to +10% over the NPC) — a *player profession* whose product is literally better odds ([Refinement System](https://irowiki.org/classic/Refinement_System)).
- Renewal also opened **+11 to +20** with Bradium/Carnium at 18%→15% (weapons Lv 1–3) and 8%→5% (Lv-4/armor) per step, with downgrade-instead-of-break mechanics at some tiers ([RMS +11–20 table](https://ratemyserver.net/index.php?page=misc_table_refine)).

### 2.4 The psychology and economy of the +10 chase

The break rule makes the expected cost computable in *base items*, and the numbers are brutal. Derived directly from the per-step table above (expected items destroyed per finished product = 1 / P(clean run), since any failure sends you back to acquiring a fresh +0):

| Finished product | Wpn Lv 1 | Wpn Lv 2 | Wpn Lv 3 | Wpn Lv 4 / Armor |
|---|---|---|---|---|
| One +7 | 1 | ~1.7 | ~3.3 | ~10.4 |
| One +8 | ~1.7 | ~4.2 | ~16.7 | ~52 |
| One +9 | ~4.2 | ~20.8 | ~83 | ~260 |
| One +10 | ~21 | ~104 | ~417 | **~2,604** |

*(Computed from the [iRO Wiki Classic success table](https://irowiki.org/classic/Refinement_System); geometric expectation, ignores the ore/zeny per attempt. If the base item is itself a 0.5% drop, a +10 Lv-4 weapon is a ~500,000-kill artifact.)*

- The rate ladder has a **cliff shape** (100 → 60 → 40 → 20): players feel safe, then "slightly brave," then they're in casino territory. The famous community ritual — buying multiple copies of the base weapon and "sacrificing" them — exists because everyone learns the table above through loss.
- **The break rule is what makes the top end scarce**, not the success rate. If failures merely reset progress, +10s would only cost time. Because failures destroy the base item (often itself a rare drop), +10 supply is bounded by the drop economy, and a +10 carries provable sunk risk — that's why it signals status.
- **Refine-before-compound ordering** creates a second market: pre-refined clean gear trades at a superlinear premium over +0 gear, because the buyer is paying to skip realized risk before committing an irreplaceable card.
- **Balance lesson from renewal**: pushing the cap to +20 with cash-shop protection ores turned refine bonuses from "nice topper" into the dominant stat source (a +20 renewal armor gives **+60 DEF** vs classic's ~7 — [RMS](https://ratemyserver.net/index.php?page=misc_table_refine)), and endgame content had to be balanced around whales' +15s. Once content assumes high refines, the gamble stops being optional — the psychology inverts from "greed" to "obligation."

---

## 3. Gear and Drops

### 3.1 Weapon levels as the tier system

Weapon Level (1–4) is RO's tier axis; it drives refine reagent cost, safe limit, refine payoff (§2.1), and even the DEX→minimum-damage scaling (+1 / +1.2 / +1.4 / +1.6 min damage per DEX for Lv 1–4 — [Stats](https://irowiki.org/classic/Stats)). Lv-1/2 weapons are NPC-bought; Lv-3 weapons come from shops/drops and need monster-dropped Oridecon to refine; Lv-4 weapons are *never sold by NPCs* — they come from rare mob drops, MVPs, or quests. The tier system is thus enforced by *acquisition channel*, not by an item-level number.

### 3.2 Elemental weapons

Weapons can carry a permanent attack element via Blacksmith forging (element stones: Flame Heart / Mystic Frozen / Rough Wind / Great Nature) or a temporary one via Sage endows / elemental converters ([Card Reference — element cards note](https://irowiki.org/classic/Card_Reference)). The wiki explicitly ranks the options: a proper elemental weapon (element table, up to ×2) usually beats a +20% element card, *but the card stacks with endows*. Element is a whole parallel gear axis, and swapping weapons per dungeon is expected play.

### 3.3 Drop-rate philosophy and gamble items

- Drop tables are shallow (max 8 entries) but rates span 25% junk → ~1% usable gear → 0.1–0.01% chase items ([Drop System](https://irowiki.org/wiki/Drop_System)). Most kills pay *something* (junk sells to NPC — a steady zeny faucet); the chase item is what keeps you on the map.
- **Old Blue Box / Old Purple Box / Old Card Album**: monster-dropped lottery boxes that roll a random item from a huge pool (OCA: one random non-MVP card — [Card System](https://irowiki.org/classic/Card_System)). The tiering is instructive: OBB's pool is wide and mostly junk with a thin tail of good gear; OPB's pool is narrower and skews rare; OCA is the card-specific jackpot ticket. These matter because they convert *farming anywhere* into a ticket for *anything*, smoothing the brutal specific-drop variance — and because the boxes themselves trade, they let non-gamblers sell variance to gamblers. A natural product line for Pinball Knight's gambling tavern.
- **Dead Branch** deserves a mention as the inverse gamble: a cheap consumable that spawns a *random monster* — anything from a Poring to an MVP — turning a drop into a risk generator rather than a reward. Beloved, banned from towns, and a model for a tavern "summon a challenge" wager.
- **MVP mechanics** ([MVP](https://irowiki.org/classic/MVP), [Drop System](https://irowiki.org/classic/MVP)): spawn 1–8h after last death, free-for-all (no lockout, no instancing pre-renewal), summon slave mobs. The player with **highest damage contribution** is crowned MVP: bonus EXP plus **MVP reward items delivered directly to inventory**, while the corpse's normal drops (including any card roll) go to ground with loot priority to the top damage dealer. Contribution-based rewards on a contested spawn made MVP hunting a competitive endgame sport — and also RO's biggest source of kill-steal drama.

---

## 4. The Stat System Math

All from [iRO Wiki Classic: Stats](https://irowiki.org/classic/Stats) unless noted. Six stats, base 1–99.

### 4.1 The formulas

| Stat | Effects (exact classic formulas) |
|---|---|
| **STR** | Melee ATK +1 per point, **bonus ATK = ⌊STR/10⌋²** (so 50 STR → +25, 99→+81, 110→+121); weight +30; ranged +1 dmg per 5 STR |
| **AGI** | Flee +1 per point (**Flee = AGI + BaseLv**, dodge capped at 95% vs monsters); ASPD (see below) |
| **VIT** | **MaxHP +1%** per point; ~0.8 soft DEF per point (flat subtraction *after* percent DEF); −1% chance & duration for Stun/Poison/Silence/Bleed per point; healing-item potency +2%/point |
| **INT** | **MATK: min = INT + ⌊INT/7⌋², max = INT + ⌊INT/5⌋²**; MaxSP +1%; MDEF +1/point |
| **DEX** | **HIT = DEX + BaseLv**; **cast time × (1 − DEX/150)** → instant cast at 150 total DEX; bow/gun ATK: DEX +1/pt with bonus ⌊DEX/10⌋² (STR's formula, transplanted); melee +1 dmg per 5 DEX; raises minimum damage (tightens variance); minor ASPD |
| **LUK** | **CRIT = 1 + LUK × 0.3** (crit ignores DEF and Flee; katars ×2 crit); perfect dodge +0.1/pt; +1 ATK per 5 LUK; enemy LUK grants "crit shield": −1% incoming crit per 5 LUK |

ASPD ([iRO Wiki Classic: ASPD](https://irowiki.org/classic/ASPD)):

```
ASPD = 200 − (WD − (⌊WD·AGI/25⌋ + ⌊WD·DEX/100⌋)/10) · (1 − SM)
```

where `WD` = 50 × weapon's base delay (class+weapon specific) and `SM` = best speed modifier (potions 0.10–0.25, skills up to 0.30 — they don't stack; only the best applies). Hard cap **190 ASPD = 5 hits/sec**. AGI is worth 4× DEX for speed; weapon choice dominates both.

Cast time ([Skills](https://irowiki.org/classic/Skills)): `Cast = Base · (1 − DEX/150) · (1 − 0.15·Suffragium) · (1 − item%)` — the DEX term is a *linear* march to a hard breakpoint ("instacast at 150") that defined every caster build.

### 4.2 The stat point economy

- **Income** ([Stats](https://irowiki.org/classic/Stats)): leveling from x to x+1 grants `⌊x/5⌋ + 3` points. Total by 99: **1,225 earned + 48 from character creation = 1,273**.
- **Cost**: raising a stat from x to x+1 costs `⌊(x−1)/10⌋ + 2` points — i.e. 2 points per step in the 1–11 range rising to 11 per step at 92–99. Total cost 1→99: **628 points**.

The entire build system falls out of those two numbers: **1273 / 628 ≈ 2.03** — you can max *exactly two* stats and dust. A 99/99/dump build spends 1,256 of 1,273 points. Meanwhile the **⌊stat/10⌋² bonuses and breakpoints (every 10 STR/DEX/INT, 150-DEX instacast, 190 ASPD) make the *last* points in a maxed stat the most valuable**, so half-measures are punished: 90→99 costs ~110 points but crosses the ⌊/10⌋² thresholds where the quadratic term is steepest. High cost + convex payoff = forced specialization, no respec (stat resets essentially didn't exist in classic — [Stats](https://irowiki.org/classic/Stats)).

Every classic archetype is a direct solution to this knapsack (community-canonical builds, listed to show the pattern rather than as wiki-sourced data):

| Archetype | Primary pair | Breakpoint chased |
|---|---|---|
| Agi-crit Assassin | AGI 99 / LUK 90+ | 190 ASPD; katar ×2 crit; crit ignores Flee+DEF |
| VIT-spear Knight | STR 99 / VIT 90+ | HP pool ×~2 from VIT; soft-DEF flat reduction |
| Battle Blacksmith | STR 99 / DEX 90+ | ⌊STR/10⌋² = +81 ATK; HIT for 100% connect rate |
| "Instacast" Wizard | INT 99 / DEX ~120 total | DEX 150 with gear = zero cast time |
| Hunter | DEX 99 / AGI 90+ | DEX is the *damage* stat for bows; ASPD second |
| FS Priest | INT 99 / DEX or VIT | heal throughput vs. survivability fork |

Note that DEX appears in nearly every physical build (HIT = DEX + BaseLv against monster Flee that scales with monster level) — RO's one soft failure here: an accuracy stat that everyone must tax into is close to a hidden mandatory stat (see §6.5).

### 4.3 Size / element / race multiplier tables

Three independent multipliers apply to every physical hit: **size × element × race/size cards**.

**Weapon type vs. size** ([RMS size table](https://ratemyserver.net/index.php?page=misc_table_size), [iRO Wiki Classic: Size](https://irowiki.org/classic/Size)):

| Weapon | Small | Medium | Large |
|---|---|---|---|
| Fist / Rod | 100 | 100 | 100 |
| Dagger | **100** | 75 | 50 |
| 1H Sword / Katar¹ | 75 | **100** | 75 |
| Bow | 100 | 100 | 75 |
| Mace | 75 | 100 | 100 |
| 2H Sword / Spear² | 75 | 75 | **100** |
| Axe | 50 | 75 | **100** |

¹ Katars: 75/100/75. ² Spears reach 100 vs Medium while mounted on a Peco (community-documented). Weapon archetype = size specialization; magic ignores size entirely.

**Element vs. element** ([iRO Wiki Classic: Element](https://irowiki.org/classic/Element)): 10 elements, and each *defending* monster has an element **level 1–4** that scales the interaction. Key values (attack → defense):

| Matchup | Def Lv 1 | Lv 2 | Lv 3 | Lv 4 |
|---|---|---|---|---|
| Fire → Earth | ×1.5 | ×1.75 | ×2.0 | ×2.0 |
| Water → Fire | ×1.5* | ×1.75 | ×2.0 | ×2.0 |
| Wind → Water | ×1.75 | ×1.75 | ×2.0 | ×2.0 |
| Same element (e.g. Fire → Fire) | ×0.25 | ×0 | ×−0.25 | ×−0.5 (**heals**) |
| Neutral → Ghost | ×0.25 | ×0 | ×0 | ×0 |
| Holy → Undead | ×1.5 | ×1.75 | ×2.0 | ×2.0 |
| Holy → Shadow | ×1.25 | ×1.5 | ×1.75 | ×2.0 |
| Poison → Undead/Poison | ×0.5 / ×0 | ×0.25 / ×0 | ×0 | ×−0.25 (heals) |
| Neutral → anything non-Ghost | ×1.0 | ×1.0 | ×1.0 | ×1.0 |

*Water→Fire Lv1 is 1.5 in the classic table above (the elemental cycle is Fire>Earth>Wind>Water>Fire). The load-bearing constants are: **advantage = 1.25–2.0 scaling with defender element level; same-element = immune-to-absorb; Neutral = always 1.0 but nulled by Ghost; Holy/Shadow mutually punishing; Undead takes double from Holy/Fire and heals from Poison/Shadow.** Element level (not just element) is the depth knob: a Lv-4 Fire monster takes ×2 from Water but *absorbs* Fire.

**Race**: 10 races (Formless, Undead, Brute, Plant, Insect, Fish, Demon, Demi-Human, Angel, Dragon — [Element](https://irowiki.org/classic/Element) footer). Race carries **no innate multiplier** — it exists purely as a hook for cards (+20% weapon / −30% shield per §1.5). Race is the card system's content; size and element are the combat system's content.

---

## 5. Job / Class Progression

Sources: [iRO Wiki Classic: Levels](https://irowiki.org/classic/Levels), [Classes](https://irowiki.org/classic/Classes).

- **Two parallel levels**: Base Level (1–99) pays **stat points**; Job Level pays **1 skill point per level**. Different XP pools; monsters pay them in different ratios, so "where to grind" is itself a build decision.
- **Progression ladder**: Novice (job 10) → First Class (job cap 50) → Second Class (job cap 50; changeable from job 40, but waiting to 50 pays extra skill points and quest perks). At Base 99/Job 50, **Transcendence/rebirth** resets the character to level 1 with 100 starting stat points, re-climbs to 99, and unlocks the Transcendent Second Class with **job cap 70** → 20 extra skill points, exclusive skills, +25% HP/SP.
- **Skill points are a second scarcity economy**: a second-class character has ~49 + 49 = 98 points, but the class trees (with prerequisites chains, e.g. Bash 10 → Magnum Break) contain far more than 98 points of skills, and many skills only become good at level 10. Skill builds are as identity-defining as stat builds — and equally permanent (no free respec).
- **Classes also grant fixed stat bonuses at specific job levels** (each class's +stat schedule totals ~+18 by job 50, weighted toward its identity stat) — the class nudges but does not dictate the stat build.
- Death costs 1% of current-level Base *and* Job EXP ([Levels](https://irowiki.org/classic/Levels)) — progression itself is at stake in risky content, which keeps high-XP/high-risk maps genuinely tense.

---

## 6. Lessons for Pinball Knight

### 6.1 Card drop rates: scale RO's 0.01% by kills-per-session

RO's 0.01% is calibrated for a *persistent* character killing 500–2,000 monsters/hour, forever, in an economy with trade. A run-scoped ARPG floor might see 100–300 kills, and Pinball Knight cards persist across runs (that's the RO-like part). The invariant to copy is not the rate but the **expected kills per card**, rescaled to session length:

- RO: casual player ≈ 5–10 hours per *common* card, hundreds of hours per chase card, effectively "lifetime event" for an MVP card.
- Suggested mapping: common cards ≈ 1 per 1–2 runs (~0.5–1% per eligible kill), mid rarities ≈ 1 per 5–15 runs, top rarity ≈ 1 per 50+ runs *from drops* — and follow RO by making the top tier come from **boss-tier enemies with contribution rules in co-op** (top damage gets the roll, RO-MVP style) so rare cards have a story attached.
- Keep RO's two pressure valves: an **Old Card Album analog** at the gambling vendor (rolls a random non-boss card — converts zeny/meta-currency into bounded-variance card access) and a **Bubble Gum analog** (temporary drop-rate buff as a run pickup). RO shows you can leave direct rates brutal *if* a gamble-item channel exists.
- Copy the **"LUK doesn't affect drops" stance**: no drop-rate stat. RO's designers were right — a drop stat becomes mandatory tax gear and poisons build choice.

### 6.2 Refine: copy the cliff shape and the value ordering, not the exact odds

- RO's proven curve: **100% → ~60% → ~40% → ~20%** per step past safe, with better item tiers getting *lower* safe limits and *higher* per-plus payoffs plus an over-refine premium. Pinball Knight's "+3 safe" matches RO's Lv-4 weapon (+4 safe); adopt the tier-inverted safe limit (commons safe to +6/+7, best rarity safe to +3) so cheap gear is the *practice casino* and top gear is the *real* one — that's what teaches the system safely.
- **Break must destroy socketed cards too.** This is the single most load-bearing rule in RO's economy: it forces the refine-then-socket ordering, creates a market premium for pre-refined clean gear, and makes every high-refine carded item a visible trophy of survived risk. If cards were refunded on break, refine risk would only price the base item.
- Insurance cards = RO's **Enriched vs. HD split**, and both are worth having as *distinct* products: one card type that *raises the odds* (Enriched: still can break) and a rarer one that *converts break into −1 level* (HD). RO/renewal proof point: HD-style full protection at the top tier is what enabled +15+ power creep — so gate the HD-style card to at most one tier below max, or make it consume the card on failure.
- Display the +N in the item name and scale a **bonus roll on over-refines** (RO: +3/+5/+7/+13 extra ATK per over-upgrade by tier) so pushing past safe pays superlinearly — greed needs a visible reward gradient, not just a bigger sum.
- A starting table transposed from RO's ladder onto Pinball Knight's existing "+3 safe" rule (success per attempt; failure past safe breaks the item; numbers are the RO shape, offered as a tuning seed, not sourced):

| Attempt | Common (safe +5) | Rare (safe +4) | Epic/Legendary (safe +3) |
|---|---|---|---|
| → +4 | 100% | 100% | 60% |
| → +5 | 100% | 60% | 40% |
| → +6 | 60% | 40% | 40% |
| → +7 | 40% | 20% | 20% |
| → +8 (cap) | 20% | 20% | 10% |

That yields RO-like expected sacrifices (~1 in 10 epics survives to +6, ~1 in 100+ to cap) while commons stay a safe tutorial. If runs are short, the *rates* can stay the same and scarcity is tuned by how many attempts/ore a run yields.

### 6.3 Multiplier tables for 22 enemy families

RO runs three orthogonal axes; the sustainable constants are small:

- **Size axis** (physical only): 3 sizes × weapon archetype with values from {50, 75, 100}. This is cheap to implement, instantly legible, and in RO it's what differentiates weapon *classes* rather than individual items. Pinball Knight's weapon archetypes (and perhaps ball-speed bands — slow heavy hits as "axe vs Large") can use the exact 50/75/100 table.
- **Element axis**: RO's 10×10×4 matrix is far too big; ~80% of its cells are 1.0. The cells that carry the design: **advantage ×1.5–×2.0, same-element ×0.25→absorb, one "null" element vs normal damage (Ghost), one mutually-punishing pair (Holy/Shadow), and undead-heals-from-poison style inversions**. Four to five elements with defender "element level" (1–2 tiers scaling the advantage from ×1.5 to ×2 and the resistance from ×0.25 to absorb) reproduces the whole feel. Absorption (healing the enemy) is worth keeping — it's the only table entry players *never* forget.
- **Race/family axis**: leave it at ×1.0 innately and let the **22 enemy families exist purely as card hooks** (+20% vs family on weapon cards, −30% from family on shield-slot cards, ±crit vs family). RO proves a taxonomy needs no combat math of its own to matter — cards make it matter. Standardize magnitudes per category (all family-damage cards +20%, all family-defense cards −30%) and differentiate by *which* family's card is rare.
- Copy the **named-gear prefix** system: card compounding renames the item ("Bloody", "Titan", "Cranial"). With card IDs already encoding level/shine, the display name is free identity and free advertising in co-op.

### 6.4 Stat-cost curves that force build identity

- The magic ratio is **total points ≈ 2× the cost of maxing one stat** (RO: 1273 vs 628). Whatever Pinball Knight's run-scoped tree budget is, tune node costs so a full run can *complete about two branches* — that single ratio generates archetypes without any hard class gates.
- Use RO's cost shape — `cost(x→x+1) = ⌊(x−1)/10⌋ + 2` (2 rising to 11) — together with **convex payoffs** (⌊stat/10⌋² bonuses, hard breakpoints like 150-DEX instacast and the 190 ASPD cap). Rising cost alone encourages bland spreading; rising cost *plus* superlinear/breakpoint payoffs is what makes specialization correct. Give each branch one famous breakpoint ("instant cast at X" energy).
- Two parallel currencies (stat points from base level, skill points from job level, fed by different XP) is cheap depth: in Pinball Knight terms, floor-clearing XP vs. style/combo XP feeding two different economies.

### 6.5 RO mistakes to avoid

1. **Renewal refine creep**: raising the cap (+10→+20) and selling protection turned optional gambling into mandatory infrastructure (+60 DEF armor vs classic's ~7; content rebalanced around high refines). Keep the cap fixed forever; add breadth (new card categories, new conditional effects) instead of taller plusses.
2. **Dead and trap stats**: classic LUK was a near-dead stat outside crit-sin/forger niches (0.3 crit per point, 0.1 perfect dodge), and soft VIT-DEF became irrelevant at endgame because it's flat subtraction after percentage reductions. Every stat needs at least one archetype where it is the *primary* scaler, and flat defenses must not compete with percent defenses in the same slot. The mirror-image failure is the **hidden mandatory stat**: HIT = DEX + BaseLv means nearly every physical build tithes 40–60 points into DEX just to connect — a stat everyone buys is not a choice, it's a tax with extra steps. If Pinball Knight has an accuracy-like mechanic (e.g. bounce control), keep it off the stat sheet.
3. **One-sided defensive stacking**: RO capped dodge at 95% vs monsters and gave enemies "crit shield" from LUK — copy the idea that every avoidance stat has a hard cap and a counter-stat, or momentum-heavy builds will find the 100%-avoid corner.
4. **Uncontested boss spawns without contribution rules** caused RO's worst social friction (kill-stealing, MVP sniping — the last-hit-adjacent drama). Pinball Knight's co-op should award boss card rolls by *contribution* (RO's own MVP rule) or roll per-player, never to the luckiest last touch.
5. **No unsocketing… ever?** RO eventually sold card removal because 20 years of permanence plus power creep stranded players' investments. Permanence is correct for economy and drama — but pair it with Pinball Knight's existing card-level scaling ("deltas scale both ways") so an old socketed card can still *grow*, which is the pressure-release valve RO lacked.
6. **Uniform 0.01% across wildly different monsters** meant effective card price was set entirely by monster availability, producing degenerate farm-density metas. Since Pinball Knight controls spawn tables per floor, vary *card rate* by family rarity deliberately rather than letting maze-generation density decide card economics by accident.

---

## Appendix: RO's load-bearing constants (quick reference)

The whole design, compressed to the numbers that do the work:

| Constant | Value | Where |
|---|---|---|
| Card drop rate (base, incl. MVP) | **0.01%** | [Card System](https://irowiki.org/wiki/Card_System) |
| Weapon card slots / all other slots | 0–4 / 0–1 | [Card System](https://irowiki.org/classic/Card_System) |
| Race-damage weapon card / size card | +20% / +15% (+5 ATK) | [Card Reference](https://irowiki.org/classic/Card_Reference) |
| Race shield card / element garment card | −30% / −30% | [Card Reference](https://irowiki.org/classic/Card_Reference) |
| Status resist card (standard) | 20% | [Card Reference](https://irowiki.org/classic/Card_Reference) |
| Safe refine (wpn Lv 1/2/3/4, armor) | +7 / +6 / +5 / +4 / +4 | [Refinement System](https://irowiki.org/classic/Refinement_System) |
| Refine per-step odds past safe | 60 → 40 → 20 → (10 at Lv-4 +10) | [Refinement System](https://irowiki.org/classic/Refinement_System) |
| ATK per refine (wpn Lv 1/2/3/4) | +2 / +3 / +5 / +7 (over: +3/+5/+7/+13) | [Refinement System](https://irowiki.org/classic/Refinement_System) |
| Failure consequence | item + cards + ore destroyed | [Refinement System](https://irowiki.org/classic/Refinement_System) |
| STR/DEX bonus damage | ⌊stat/10⌋² | [Stats](https://irowiki.org/classic/Stats) |
| MATK range | INT+⌊INT/7⌋² … INT+⌊INT/5⌋² | [Stats](https://irowiki.org/classic/Stats) |
| HIT / FLEE | DEX + BaseLv / AGI + BaseLv (95% dodge cap) | [Stats](https://irowiki.org/classic/Stats) |
| CRIT | 1 + 0.3·LUK, minus target LUK/5 | [Stats](https://irowiki.org/classic/Stats) |
| Cast time | Base · (1 − DEX/150) | [Skills](https://irowiki.org/classic/Skills) |
| ASPD cap | 190 = 5 hits/sec | [ASPD](https://irowiki.org/classic/ASPD) |
| Stat raise cost | ⌊(x−1)/10⌋ + 2 (total 1→99 = 628) | [Stats](https://irowiki.org/classic/Stats) |
| Stat points by 99 | 1,273 ≈ 2 maxed stats | [Stats](https://irowiki.org/classic/Stats) |
| Size multipliers | {50, 75, 100}% by weapon type | [RMS size table](https://ratemyserver.net/index.php?page=misc_table_size) |
| Element advantage / same-element | ×1.5→×2.0 by def level / ×0.25→absorb | [Element](https://irowiki.org/classic/Element) |
| Skill points | 1 per job level; job caps 50 / 70 (trans) | [Levels](https://irowiki.org/classic/Levels) |
| Death penalty | −1% of current level's Base and Job EXP | [Levels](https://irowiki.org/classic/Levels) |
| Level-gap drop penalty | 100% within ±10 levels → 50% at ±30 | [Drop System](https://irowiki.org/wiki/Drop_System) |
| MVP respawn / reward rule | 1–8 h; top damage dealer gets MVP prizes + loot priority | [MVP](https://irowiki.org/classic/MVP) |

### Source index

- [iRO Wiki: Card System](https://irowiki.org/wiki/Card_System) · [iRO Wiki Classic: Card System](https://irowiki.org/classic/Card_System) · [Card Reference](https://irowiki.org/classic/Card_Reference)
- [iRO Wiki Classic: Refinement System](https://irowiki.org/classic/Refinement_System) · [RateMyServer: Refine Success Rates](https://ratemyserver.net/index.php?page=misc_table_refine)
- [iRO Wiki: Drop System](https://irowiki.org/wiki/Drop_System) · [iRO Wiki Classic: MVP](https://irowiki.org/classic/MVP)
- [iRO Wiki Classic: Stats](https://irowiki.org/classic/Stats) · [ASPD](https://irowiki.org/classic/ASPD) · [Skills (cast time)](https://irowiki.org/classic/Skills)
- [iRO Wiki Classic: Element](https://irowiki.org/classic/Element) · [Size](https://irowiki.org/classic/Size) · [RateMyServer: Size Table](https://ratemyserver.net/index.php?page=misc_table_size)
- [iRO Wiki Classic: Levels](https://irowiki.org/classic/Levels) · [Classes](https://irowiki.org/classic/Classes)
- Community-derived / approximate items are flagged inline (mounted-spear size bonus, Lv-4 over-upgrade ATK value, RMS-vs-irowiki 19%/20% discrepancy, session-scaled drop-rate suggestions in §6.1).
