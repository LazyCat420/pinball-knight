# Path of Exile — Systems Research

**Why this game is in the research set.** Path of Exile is the deepest systems-ARPG ever shipped: a ~1,300-node passive tree, a socketed-gem ability system, a barter economy where the money *is* the crafting material, and a seasonal endgame (the Atlas) whose entire difficulty curve is a player-operated risk/reward dial. Pinball Knight already ships miniature versions of several PoE systems — a small passive tree, floor modifiers, a flask belt, an upgrade gamble — so the value here is not "what features does PoE have" but *why its math works*: the additive/multiplicative bucketing that keeps a thousand damage sources balanceable, the hit-size-dependent armour formula, the opportunity-cost pricing of the passive tree, and the escalating-stakes crafting ladder. GGG has also been unusually public about its design theory, most notably Chris Wilson's GDC 2019 talk ["Designing Path of Exile to Be Played Forever"](https://www.gdcvault.com/play/1025784/Designing-Path-of-Exile-to) ([video](https://www.youtube.com/watch?v=pM_5S55jUzk)), which is effectively a manifesto for retention-through-depth rather than retention-through-chores.

---

## 1. Core loops

### 1.1 Campaign → Atlas

PoE has two sequential loops:

- **Campaign (Acts 1–10)**: a fixed, authored ~10–30 hour story arc that doubles as a build tutorial. It front-loads the systems one at a time (links, resistances, flasks, labyrinth/ascendancy) and stamps a permanent **−60% to all elemental resistances** on the character by its end ([PoE Wiki: Resistance](https://www.poewiki.net/wiki/Overcapped_resistance)) — a deliberate "gear debt" that makes early endgame gearing about *repairing* a deficit, not just stacking bonuses.
- **Maps / Atlas endgame**: procedurally generated areas consumed as *items*. The endgame is infinitely repeatable because every run is re-randomized on several independent axes at once — layout seed, monster composition, item drops, map mods, league mechanic content. Wilson's GDC talk calls this **"multiple overlapping axes of randomness"**: any single axis gets stale, but the cross-product doesn't ([GDC summary](https://gdconf.com/article/see-how-path-of-exile-was-built-to-be-played-forever-at-gdc-2019/)).

### 1.2 Leagues as the seasonal loop

Every ~3–4 months a **challenge league** launches: a fresh economy (everyone starts with nothing), one new headline mechanic, and a rebalance patch. The two most quotable theses from the GDC talk ([Game Developer coverage](https://www.gamedeveloper.com/design/video-designing-i-path-of-exile-i-to-be-played-forever)):

1. **Players will quit; design for the return, not the retention.** A predictable cadence ("new league every 13 weeks") converts churn into a heartbeat.
2. **Give players a reason to quit *before* they burn out.** A player who leaves satisfied comes back at the next league; a player ground into paste by infinite chores does not.

Mechanically, the league reset works because *character power is economy-denominated*: wiping the economy wipes power inflation without deleting anyone's standard-league characters. League mechanics that test well get merged into the core game at reduced frequency, so the base game accretes density every cycle — content reuse as a development strategy, also covered in the talk.

### 1.3 The currency-is-crafting loop

PoE has no gold. Its currency items — Orbs of Alteration, Chaos Orbs, Exalted Orbs, etc. — are **consumable crafting tools that players also use as money** ([Maxroll crafting resources](https://maxroll.gg/poe/resources/crafting-resources)). This single decision produces three loops at once:

- **Intrinsic value floor**: a Chaos Orb is always worth *at least* "one reroll of a rare item", so currency can never hyperinflate into meaninglessness the way gold does.
- **Built-in sink**: every craft destroys currency. The economy's faucet (drops) and sink (crafting) are the same object, so no artificial gold sinks (repair bills, taxes) are needed.
- **Trade tension**: every orb in your stash is simultaneously savings and ammunition. Spending it on a craft is a bet against the market price of the item you might have bought instead. Wilson has repeatedly framed protecting this "economic integrity" as a core obligation, even at revenue cost ([Massively OP interview coverage, 2026](https://massivelyop.com/2026/01/07/path-of-exile-co-creator-chris-wilson-discusses-his-mistakes-on-economic-integrity-in-online-rpgs/)).

---

## 2. The stat math

### 2.1 "Increased" (additive) vs "more" (multiplicative)

This is the foundation of all PoE balance ([PoE Wiki: Stat](https://pathofexile.fandom.com/wiki/Stat), [vhpg breakdown](https://www.vhpg.com/poe-more-vs-increased/)):

```
Damage = Base
       × (1 + Σ all "increased" − Σ all "reduced")   ← ONE additive bucket
       × Π (1 + each "more")  × Π (1 − each "less")  ← each source multiplies separately
```

- All **increased/reduced** modifiers — tree nodes, gear affixes, buffs — sum into a single pool before applying.
- Every **more/less** modifier is its own multiplier.

Worked example (from the community-standard illustration): base 1000 damage, already at 100% increased from gear/tree.

| Add this | Result | Marginal gain |
|---|---|---|
| +100% *increased* | 1000 × (1 + 2.0) = **3000** | +50% over the 2000 you had |
| +100% *more* | 1000 × (1 + 1.0) × (1 + 1.0) = **4000** | exactly ×2, always |

The design consequences:

1. **Additive stacking is self-diminishing.** The 10th "40% increased damage" node is worth far less *relative* damage than the 1st. This automatically pushes players to diversify (crit, attack speed, penetration, flat damage) instead of tunneling one stat — no hard caps needed.
2. **"More" is rationed by structure, not numbers.** Multiplicative power lives almost exclusively in scarce, slot-limited places: support gems (limited by sockets), keystones (limited by tree position), a handful of uniques. You can't stack 20 of them because the *slots* don't exist. The multiplier explosion is capped by geometry, not by balance patches.
3. **Balanceability.** GGG can print hundreds of new "increased" sources per league with low risk — they all drain into one diminishing pool. Every new "more" source is a big deal and is treated as such.

### 2.2 Damage effectiveness

Every skill has a **damage effectiveness** percentage that scales how much *flat added damage* (from gear, auras, support gems) it receives ([PoE Wiki: Damage effectiveness](https://pathofexile.fandom.com/wiki/Damage_effectiveness), [Maxroll damage guide](https://maxroll.gg/poe/getting-started/damage-for-beginners)):

- **Spells**: `final base = own base + (added damage × damage effectiveness)`.
- **Attacks**: `final base = (weapon base + added damage) × damage effectiveness`.

Skills that hit many times per cast (rapid-fire, channelled, multi-projectile) get low effectiveness (e.g. 30–60%); big slow slams get high (up to 200%+). This is the knob that stops universal flat-damage sources from making the fastest-hitting skill automatically the best — the classic ARPG failure mode. Hit *rate* and per-hit *augment scaling* are decoupled.

### 2.3 Hit chance, evasion, and the entropy system

Attacks can miss. The current wiki-documented hit formula ([PoE Wiki: Accuracy](https://pathofexile.fandom.com/wiki/Accuracy), [Evasion](https://pathofexile.fandom.com/wiki/Evasion)):

```
chance to hit = 1.25 × AA / (AA + (DE / 5)^0.9)      clamped to [5%, 100%]
  AA = attacker accuracy, DE = defender evasion
```

Two design details worth stealing:

- **Crits check twice**: a critical strike must *also* pass a second accuracy roll to confirm, so accuracy double-dips for crit builds — an intentional hidden cost on the crit archetype.
- **Entropy, not i.i.d. dice**: player evasion doesn't roll independently per hit. An entropy counter accumulates per incoming hit; a hit lands when the counter crosses 100. Result: with a 40% chance to be hit you are hit *almost exactly* 2 in 5 attacks — never an unlucky streak of 5 landed hits in a row, never a lucky immortality streak. Variance is removed from defence while keeping the average identical.

### 2.4 The armour formula — diminishing returns against big hits

The famous formula ([PoE Wiki: Damage reduction](https://www.poewiki.net/wiki/Physical_damage_reduction)):

```
DR = Armour / (Armour + 5 × RawDamage)        (capped at 90%)
```

> Version note: this is the post-3.16 constant; before the 3.16 defence rework the widely-cited community formula was `A / (A + 10·D)` ([old official-forum math thread](https://www.pathofexile.com/forum/view-thread/1468738)). Some mirrors still show the old constant — the *shape* of the curve, which is what matters here, is identical.

Properties of this curve:

- **DR depends on hit size.** 10,000 armour gives 67% reduction against a 1,000 hit, but only 29% against a 5,000 hit.
- **Absolute damage prevented asymptotes at Armour/5.** As the hit grows, `D × A/(A+5D) → A/5`. 20,000 armour can never prevent more than ~4,000 damage from one hit, no matter how huge the hit ([PoE Wiki example](https://www.poewiki.net/wiki/Physical_damage_reduction)).
- Therefore **armour is excellent against swarms of small hits and nearly worthless against boss slams** — the exact opposite of a flat "% physical reduction" stat. This is deliberate: it forces armour characters to still respect telegraphed big attacks, and it makes "many small hits" and "one big hit" mechanically different threats that demand different gear answers.

### 2.5 Resistances: capped, over-capped, and the EHP hockey stick

- Elemental resistances cap at **75%** by default; "+X% to maximum resistance" modifiers (rare, expensive) can raise the cap to at most **90%** ([PoE Wiki: Resistance](https://www.poewiki.net/wiki/Overcapped_resistance)).
- The campaign applies **−60% all elemental resistances** total (two −30% steps), so endgame gear must supply 135% per element just to sit at cap.
- Damage taken scales with `(1 − res)`, so effective HP scales with `1/(1 − res)`. Going 75%→80% res is not "5% better": damage taken drops from 25% to 20%, a **20% relative reduction** — each point near the cap is worth more than the last. Max-res is therefore the endgame chase stat, and "−X% maximum resistances" is one of the scariest map mods in the pool.
- Over-capping (e.g. 110% listed to hold 75% after a −35% curse) makes even "wasted" resistance valuable — resist on gear stays desirable forever.

### 2.6 Life, Energy Shield, and mana-as-defence

Three pools, three archetypes, each with structural — not merely numeric — tradeoffs:

- **Life**: default pool; scaled by flat life + one additive "% increased maximum life" bucket. For years the tree's life wheel was a mandatory tax (~150–200% increased), which GGG explicitly reduced in 3.16 by baking life into other nodes — a lesson in what happens when a defensive stat becomes a non-choice.
- **Energy Shield (ES)**: a larger pool that **recharges to full** after a delay if you avoid damage — burst-recovery instead of steady regen, so ES play is about creating recovery windows. The **Chaos Inoculation** keystone is the archetype's anchor: immune to chaos damage, but **maximum life becomes 1** — total commitment, structurally enforced.
- **Mana as a third life pool**:
  - **Mind Over Matter** (keystone): 30% of hit damage is taken from mana before life. With the 30/70 split, unreserved mana equal to `life × 3/7` maximizes the effect — a build-around ratio, not a passive bonus.
  - **Eldritch Battery** (keystone): energy shield protects **mana** instead of life — converting a defensive pool into a spending pool, enabling cost-hungry builds at the price of losing ES as a life buffer.

The pattern across all of these: PoE's defensive options are *rewirings of the damage-flow graph*, not resist percentages. Each one changes which map mods and monster types threaten you.

### 2.7 Flasks: recovery as a combat resource

PoE's five-slot flask belt is not a potion hotbar — it is a **charge economy**:

- Flasks hold **charges gained from kills** (and crits, per mods), spent per use. Recovery is therefore *earned by aggression*: a player who keeps killing keeps drinking, a player who turtles runs dry. Sustain scales with tempo, which is exactly the incentive an action game wants.
- Utility flasks (granted armour, speed, resists, ailment immunity) turned out to be *too* good: for years the community norm was "piano" — cycling all five on cooldown for near-permanent buffs. GGG's 3.15/3.16 flask rework (charge nerfs, enchants that auto-trigger conditionally) was a public admission that **any manual buff with near-100% uptime is a chore, not a decision**. The fix was to either make uptime genuinely partial or automate the trigger and price it elsewhere.
- Flasks are themselves **craftable items** (quality, prefix/suffix mods like "immune to freeze during effect"), pulling the belt into the same crafting economy as gear — five more slots of build expression.

*(Rework rationale is summarized from GGG's 3.15–3.16 patch communications and community coverage; the charge mechanics are on [PoE Wiki: Maps-era flask pages via the Fandom mirror](https://pathofexile.fandom.com/wiki/Flask).)*

---

## 3. The passive tree

The PoE 1 tree has roughly **1,300+ allocatable nodes** shared by all classes; classes differ only in starting position. Characters get ~99–123 points from levels and quests ([PoE Wiki: Passive skill](https://pathofexile.fandom.com/wiki/Passive_skill)).

### 3.1 How a 1,300-node graph stays navigable

The tree is legible because it has exactly four node ranks with distinct visual weight and function:

1. **Small passives** (~90% of nodes): +10 stats, 8–12% increased something. Individually boring *on purpose* — they are the road surface.
2. **Notables**: named, larger icons, bigger effects. They are the *signposts*: players plan routes notable-to-notable and read a cluster's identity from its notable's name ([Fandom: Passive skill](https://pathofexile.fandom.com/wiki/Passive_skill)).
3. **Keystones**: rule-changers at the graph's periphery. They are the *landmarks* — most build names are literally keystone names ("CI occultist", "MoM archmage").
4. **Travel/attribute nodes**: pure +10 attribute nodes connecting clusters.

**Travel nodes are the pricing mechanism.** Every point spent walking is a point not spent on power, so a cluster's real cost = its nodes + the path to it. Distance from your class start *is* the balance dial: GGG can nerf an archetype for one class without touching numbers, purely by graph surgery. A power budget denominated in *pathing* rather than in per-node point costs is what lets 1,300 nodes coexist without a spreadsheet of prices.

**Clusters are themed** (one wheel = "axe damage", "totem life", "mana regen"), so the macro-read of the tree is ~200 clusters, not 1,300 nodes. Depth without illegibility.

### 3.2 Respec scarcity

Respec is per-point, via quest-reward refund points and **Orbs of Regret** ([PoE Wiki: Respec](https://www.poewiki.net/wiki/Respec)). Tuning intent: cheap enough to fix a mistake or pivot a dozen points, expensive enough that converting a level-90 character into a different archetype costs more than levelling a new one. Consequences:

- Choices are *decisions*, with weight; the tree read is a real skill.
- Rerolling is content — the "play forever" loop feeds on new characters, and league resets re-level everyone anyway.
- PoE 2 moved to cheap gold respecs, an acknowledged concession that scarcity taxes experimentation for newer players. The tension is real; pick your side deliberately.

### 3.3 Keystone design theory: huge upside + structural downside

The canonical keystone template is **a rule change you build around, with a drawback you must engineer away** — never a plain stat trade. The classics:

| Keystone | Upside | Structural downside |
|---|---|---|
| Chaos Inoculation | Immune to chaos damage | Maximum life = 1 (forces full ES) |
| Blood Magic | No mana problems ever | You *have no mana* — costs paid in life |
| Resolute Technique | Hits can't miss | Your hits can never crit (kills a whole scaling axis) |
| Avatar of Fire | 50% of all damage converted to fire | Deal **no** non-fire damage at all |
| Mind Over Matter | 30% of hits taken from mana first | Mana is now a defence — spend it and you're squishy |
| Unwavering Stance | Cannot be stunned | Cannot evade — you *will* be hit |
| Elemental Equilibrium | Huge resist penalty on enemies for other elements | Hitting with an element buffs their resist to it — demands a two-element loop |
| Pain Attunement | 30% more spell damage on low life | You must *live* below 35% life |

([Fandom: Passive skill — keystones](https://pathofexile.fandom.com/wiki/Passive_skill); the "one positive, one negative, changes how the game is played" framing is GGG's own.)

Why the drawback must be **structural**: a numeric tax ("+40% damage, −10% life") is a spreadsheet question with a single right answer. A structural drawback ("you have no mana") is a *design constraint on the rest of the build* — it recruits gear slots, gem choices, and other tree nodes into answering it. One keystone thereby generates dozens of distinct builds, each defined by *how* it paid the cost.

---

## 4. Skill gems + support gems

### 4.1 The composable-ability machine

Abilities are items: an **active skill gem** socketed in gear, modified by every **support gem** in linked sockets (up to 5 supports — the "6-link" chase). ~250 active gems × ~150 supports, gated by **tags** (a support with the `Projectile` tag only affects projectile skills), yields combinatorial depth from a modest part count ([Fandom: Support gem](https://pathofexile-archive.fandom.com/wiki/Support_gem)).

Supports come in two flavors, and the second is the important one:

- **Numeric supports**: "supported skills deal X% *more* elemental damage" — each is its own multiplier (see §2.1), so a 6-link with five ~1.4× supports is ~5.4× damage. This is precisely where the rationed "more" multipliers live: your total multiplicative budget *is* your socket count.
- **Behavioral supports**: convert the skill into a different verb — Spell Totem (a turret casts it), Trap/Mine (placed, triggered), Greater Multiple Projectiles, Spell Echo (repeats), Cast on Critical Strike (triggers off another skill). One fireball gem is a nuke, a turret, a minefield, or an auto-caster depending on links. Behavior composition, not just number composition, is what makes the system feel generative.

Duplicate supports don't stack — the same support linked twice applies once, strongest wins ([Fandom: Support Gems](https://pathofexile-archive.fandom.com/wiki/Support_Gems)) — so depth comes from *different* combinations, not repetition.

### 4.2 Cost multipliers: paying for "more"

Every support historically carried a **mana multiplier** (now "cost and reservation multiplier"), e.g. ×130%, ×140% — and they **stack multiplicatively** across links. A 6-link's cost can balloon 3–5×, and the multiplier applies to reservation too ([Fandom: Support gem](https://pathofexile-archive.fandom.com/wiki/Support_gem)). This is the elegant part: the same socket that grants a multiplicative damage bonus levies a multiplicative sustain cost, so the 6-link power curve is *paid for* in the mana economy — feeding back into MoM/EB/Blood Magic decisions from §2.6. Power and cost ride the same exponent.

### 4.3 Skills as items

Because the ability is a *thing you socket* rather than a class feature: any class can use any skill (class identity comes from tree position and ascendancy, not a skill list); gems level independently by XP and gain **quality** (small bonuses, another gambling target via Gemcutter's Prisms); and skills are tradeable — a build's core loop can literally be bought, sold, and drop as loot.

---

## 5. Item crafting math

### 5.1 The mod system

- Rare items: up to **3 prefixes + 3 suffixes**; magic items 1+1 ([Fandom: Modifiers](https://pathofexile.fandom.com/wiki/Modifiers)). Prefixes are (roughly) "power" mods (flat damage, life, ES%), suffixes "utility" (resists, attributes, speed). The split is a *composition constraint*: you cannot have six damage mods, and the triple-resist suffix block competes with attack speed and crit — gearing is a knapsack problem per slot.
- Every mod has **tiers** (T1 best; life alone spans ~9+ tiers), gated by **item level**: an ilvl-50 drop physically cannot roll T1 life. Area level → item level → accessible tiers is the vertical progression spine ([RPGStash crafting guide](https://www.rpgstash.com/blog/how-to-craft-every-item-in-path-of-exile)).
- Rolls come from a **weighted pool**: each mod has a spawn weight conditioned on the item's tags; `P(mod) = weight / Σ eligible weights`. High-tier mods carry low weights, so tier rarity is tuned per-mod, not globally. The exact weights are datamined and exposed by [Craft of Exile](https://www.craftofexile.com/faq) — the community *requires* this transparency to price crafts, which is itself a lesson: hidden odds + high stakes reads as rigged.

### 5.2 The gamble ladder

The orbs form a ladder of escalating stakes — each rung risks more accumulated value ([Maxroll crafting resources](https://maxroll.gg/poe/resources/crafting-resources), [MmoGah basic crafting](https://www.mmogah.com/news/poe/poe-basic-crafting-guide)):

| Rung | Orb | Action | What's at stake |
|---|---|---|---|
| 1 | Transmutation | white → magic (1–2 mods) | pennies |
| 2 | Alteration | reroll magic | pennies per roll, but rolls compound |
| 3 | Augmentation | add 2nd mod to magic | small |
| 4 | Regal | magic → rare, +1 mod | your good alt-roll can be "bricked" by a bad third mod |
| 5 | Chaos / Alchemy | reroll rare / white → rare | the whole item |
| 6 | Exalted | add one mod to a rare | an expensive orb gambled on a 5-mod item's open slot |
| 7 | Annulment | remove a *random* mod | may delete the best mod |
| 8 | Divine | reroll numeric values within current tiers | value-perfection gambling on a finished item |
| — | Vaal | corrupt: random outcome, item **locked forever** | can brick or transcend; irreversibility is the thrill |
| 9 | Mirror | perfect copy (copy can't be modified) | endgame trophy; the original becomes an economy asset |

Design properties of the ladder:

1. **Stakes scale with sunk value.** Early rungs are slot machines with pocket change; an exalt slam on a near-finished item risks days of accumulated luck. The *same act* (click orb) spans five orders of magnitude of tension.
2. **Every rung is also money** (§1.3), so "should I craft or sell the orbs" is a live question at every step.
3. **Corruption is the commitment device**: Vaal Orbs offer upside (extra implicit, +1 sockets, white sockets) at the price of *permanence* — the item can never be modified again. Irreversibility, not just odds, generates the emotion.

### 5.3 Determinism valves

Pure RNG at these stakes would be intolerable, so PoE sells determinism at a premium:

- **Essences**: guarantee one named mod while rerolling the rest — a fixed anchor in the storm ([Maxroll](https://maxroll.gg/poe/resources/crafting-resources)).
- **Fossils**: reshape the weight table itself (block tags, boost tags) — you buy a *biased* die, not a result.
- **Influence (Shaper/Elder/conqueror bases)**: adds an exclusive mod pool to a base — access-gating as a value tier.
- **Fracturing Orb**: on a 4+-mod rare, permanently locks one random existing mod against all future rerolls ([PoE Wiki: Fractured item](https://www.poewiki.net/wiki/Fractured)) — converts one past lucky roll into a safe foundation for further gambling.
- **Bench metacrafts** ("prefixes cannot be changed", multi-mod): expensive locks that let you scour/reroll half the item safely.
- **Harvest** "more likely" crafts: ~10× weight boost to a mod group — purchased odds, still not certainty ([Maxroll](https://maxroll.gg/poe/resources/crafting-resources)).

The pricing rule underneath all of them: **determinism must cost more than the expected value of gambling for the same result.** If the guaranteed path were EV-cheaper, the slot machine — and the drop-driven economy behind it — would die. The valves exist to put a *ceiling on variance*, not to remove it.

---

## 6. The map / Atlas system

### 6.1 Maps are items you roll like gear

Endgame areas drop as **map items** in **16 tiers** (tier ≈ area level 68–83+). Maps have rarity and take the *same* prefix/suffix system as equipment — up to 3+3 mods ([PoE Wiki: Map](https://www.poewiki.net/wiki/Maps), [Fandom: Map](https://pathofexile.fandom.com/wiki/Map)). Every map mod does two things simultaneously:

- **Raises danger**: monster damage/speed/life, extra projectiles, player −max resistances, no life/mana regen, reduced recovery…
- **Raises reward** via three yield stats: **increased item quantity (IIQ)**, **increased item rarity (IIR)**, and **monster pack size**.

Because *the player rolls the map with the same orbs used on gear* (alch, chaos, vaal), the crafting gamble and the difficulty dial are one interface. "Alch and go" is the baseline; Vaal-corrupting maps to **8 mods** is the high-stakes end ([vhpg 8-mod maps](http://www.vhpg.com/complete-maps-with-eight-mods/)).

### 6.2 Pack size is the compounding knob

Community-consensus map math: **pack size beats quantity** because it multiplies the *number of monsters*, and each monster then rolls drops with quantity/rarity applied — pack size × per-monster yield compounds, while IIQ alone is linear ([Mapping guide](https://expcarry.com/poe-mapping-guide-map-tiers-modifiers-sustain)). Dangerous mods deliberately grant the most pack size, so the reward gradient points directly into the risk gradient. *(Community-derived reasoning; GGG does not publish the exact drop pipeline.)*

### 6.3 Stacked investment

On top of the map's own mods, players stack per-run investment: **scarabs** (consumables forcing league mechanics into the map, multiple at once), **fragments** (+quantity), historically **sextants** (charged mods on Atlas regions; retired as a system in 3.24 — [PoE Wiki: Map](https://www.poewiki.net/wiki/Maps)), plus the **Atlas passive tree** (~100+ points earned by completing maps) that lets each player *specialize the entire endgame* toward chosen mechanics and block the ones they dislike ([PoE Vault Atlas guide](https://www.poe-vault.com/guides/atlas-of-worlds-map-guide)). The Atlas tree is meta-progression over *content selection*, orthogonal to character power — two players at the same character level can be farming effectively different games.

The strategic equilibrium the game teaches ([aoeah Atlas strategies](https://www.aoeah.com/news/3984--poe-326-best-atlas-tree--mapping-strats-secrets-of-the-atlas)): **run the highest juice you can clear without wasting portals** — each map allows six portals (deaths/re-entries), so the failure cost is soft but real. Difficulty is never assigned; it is *purchased*, and over-purchasing is punished in yield-per-hour, not in a game-over screen.

---

## 7. Lessons for Pinball Knight

Concrete, math-first takeaways, mapped onto systems the game already ships.

### 7.1 Two-bucket stat math for cards and gear

Adopt PoE's bucketing wholesale for the card/socket system:

```
stat = base × (1 + Σ increased_from_cards_and_gear) × Π (1 + more_i)
```

- **Cards, gear affixes, small tree nodes → the additive bucket.** Stacking five crit cards then self-diminishes (5th card adds less relative power than the 1st), which (a) makes diverse drops valuable, (b) means card **level/shine deltas** (which scale both ways) can be balanced once, in one pool, instead of interacting multiplicatively with everything.
- **"More" multipliers only in slot-limited structures**: keystone tree nodes, one-per-run legacy perks, and floor-modifier rewards. The multiplicative budget is then capped by slot geometry, exactly like PoE's socket count. Never print "X% more damage" on a farmable card.
- Label the two kinds distinctly in UI text from day one ("increased" vs "more" is a *vocabulary*, and PoE proves players learn it).

### 7.2 Keystones with structural drawbacks for the skill tree

The 12-node, 3-branch run tree should end each branch in a PoE-style keystone: **rule change + drawback the build must engineer around**, never a stat tax. Pinball-native candidates:

- *Perpetual Motion*: wall restitution is always ≥ 1 (you never lose speed to bounces) — but you **cannot brake or stop**; standing still is no longer a state.
- *Dead Weight*: +100% more contact damage scaling from momentum — but boosters and launch chutes **no longer affect you** (your speed must come from your own descent lines).
- *Glass Bell*: all damage you take is doubled if you're moving slowly, immune to contact damage above a speed threshold — inverts the safety relationship with speed.

The test for a good drawback: does it change which *cards, surfaces, and routes* the player wants? If it only changes a number, it's a tax, not a keystone.

### 7.3 Hit-size-dependent armour

Pinball Knight already deals momentum-scaled damage; give monsters (and the knight) PoE's armour curve:

```
DR = armour / (armour + k × hit_damage)     // absolute prevention caps at armour/k
```

This makes armour strong against chip damage (grazing bounces, swarm pokes) while boss slams and max-speed knight impacts punch through — preserving the fantasy that a full-speed line through a monster pack *matters* regardless of their armour, and that telegraphed big hits threaten tanky builds. It also gives the card system two genuinely different defensive axes (flat armour vs % reduction) instead of one.

### 7.4 Resistance-style EHP and floor-mod danger

- If floors deal typed damage, cap resists (e.g. 75%) and make "+max res" a rare chase affix; the `1/(1−r)` hockey stick means each point near cap is a *felt* upgrade — cheap late-game chase content.
- Copy the **campaign resistance penalty**: each descent milestone applies −X% resists, so deeper floors create gear debt that drops then repair. Progression pressure without new mechanics.
- Make one of the six floor modifiers "−max res" tier: the scariest PoE map mods are the ones that attack the *cap*, not the total.

### 7.5 Floor-modifier math: pay risk, get compounding reward

Wire the six floor modifiers PoE-style:

- Every dangerous mod grants yield on **three axes**: drop quantity (linear), drop rarity (linear), and **monster density** (compounding — more monsters × per-monster quantity). Make density the reward on the nastiest mods so the greed gradient points into danger.
- Let players **roll floor mods with a consumable** (the crafting loop *is* the difficulty dial — one interface), and offer a Vaal-style "corrupt the floor" that rerolls to 8 mods *or* bricks it, irreversibly.
- Failure cost should be soft and pre-priced: PoE's six portals → e.g. limited revives per floor that also gate loot-out. Over-juicing punishes yield-per-hour, never progress.

### 7.6 Crafting currency for the upgrade gamble

Replace/augment the current upgrade gamble with a small orb ladder whose items are also the trade/score currency:

1. **Reroll orb** (cheap, common): reroll a card's numeric values within tier — the Divine.
2. **Augment orb**: add a random affix to an item with an open slot — the Exalt; stakes scale automatically with how good the item already is.
3. **Fracture orb** (rare): permanently lock one random existing affix against future rerolls — the determinism valve that converts past luck into foundation.
4. **Corrupt orb**: big upside table (extra socket, +1 card level cap, white-socket analog) but the item is **locked forever**, win or lose.

Rules from PoE: destruction-on-use makes every orb both savings and ammunition; determinism must cost more than gambling's EV; and **publish the odds** — PoE's crafting scene runs on Craft of Exile's exposed weights, and hidden odds at high stakes read as rigged.

### 7.7 Support-card sockets with cost multipliers

For cooldown/mana abilities, add PoE's support-gem trade: a socketed "support card" grants a *more* multiplier or a behavior change (ability fires on wall-bounce; ability leaves a trap at each bounce point) **and multiplies the ability's mana cost/cooldown** (×1.3–1.5 each, stacking multiplicatively). Power and sustain cost riding the same exponent is what makes mana/cooldown reduction cards valuable instead of dead stats — and behavior-changing supports (bounce-triggered casts are extremely pinball-native) generate more builds than numeric ones.

### 7.8 Damage effectiveness for multi-hit abilities

Any ability or card interaction that hits many times per activation (multi-bounce strikes, DoT trails) should receive flat added damage at a reduced **effectiveness %** printed on the ability. Without this knob, the fastest-hitting ability always wins the flat-damage lottery — PoE's single most transferable balance tool for an action game.

### 7.9 Entropy instead of dice at 60Hz

If dodge/block/miss chance ever enters the game: use PoE's **entropy accumulator** (counter += chance per event; trigger at 100) rather than i.i.d. rolls. At a fixed 60Hz timestep with contact events firing in bursts, independent rolls produce visible streaks; entropy gives the exact average with bounded variance, is trivially deterministic for the fixed-timestep sim, and replays/co-op stay fair.

### 7.10 Flask belt: charges from kills, not timers

Pinball Knight's flask belt should adopt PoE's charge economy rather than cooldowns: flasks refill **from kills** (or from high-speed impacts — momentum as the "crit" analog), so recovery is earned by playing aggressively and starving in passive play. Two PoE warnings to heed:

- **Avoid flask piano.** If a utility flask's uptime can approach 100% by mashing, it stops being a decision and becomes RSI. Either size charges so uptime is genuinely partial (~40–60%), or add PoE-3.16-style *conditional auto-trigger enchants* as a craftable luxury ("use when you drop below 50% HP", "use on entering a boss room") — automation as an earned affix, not a default.
- **Make flasks craftable items** in the same orb economy as gear (§7.6): quality, one prefix + one suffix ("+X% effect", "immune to burning during effect", "gains charges on wall-bounce"). Five slots of the belt become five more build-expression slots at near-zero new-system cost.

### 7.11 Pitfalls PoE also teaches (anti-lessons)

- **Mandatory stats become invisible taxes.** PoE's tree once demanded ~150–200% increased life on every build; GGG spent a whole patch (3.16) unwinding it. If every Pinball Knight build takes the same 4 of 12 tree nodes, those nodes are not choices — fold them into base stats and print new choices.
- **Hidden odds at high stakes read as rigged.** The crafting scene only functions because weights are exposed (Craft of Exile). Publish the gamble ladder's odds in-game.
- **Respec pricing is a real fork.** PoE 1's scarcity makes choices weighty but punishes experimentation; PoE 2 went cheap and lost some decision gravity. For a run-scoped 12-node tree, scarcity *within the run* (no respec mid-floor, cheap between floors) probably captures both halves.
- **One axis of randomness goes stale; ship the cross-product.** A random maze alone will be "solved" as a feel; maze × floor mods × drop tables × a rotating twist is what stays fresh.

### 7.12 The seasonal frame

From the GDC talk, for whenever runs become seasons: predictable reset cadence beats content volume; let players *finish* (a reason to quit satisfied is a reason to return); and stack randomness axes — maze seed × floor mods × drops × a rotating "league" twist — because the cross-product, not any single axis, is what reads as infinite.

---

## Sources

- Chris Wilson, ["Designing Path of Exile to Be Played Forever"](https://www.gdcvault.com/play/1025784/Designing-Path-of-Exile-to), GDC 2019 ([YouTube](https://www.youtube.com/watch?v=pM_5S55jUzk), [GDC preview](https://gdconf.com/article/see-how-path-of-exile-was-built-to-be-played-forever-at-gdc-2019/), [Game Developer coverage](https://www.gamedeveloper.com/design/video-designing-i-path-of-exile-i-to-be-played-forever))
- [PoE Wiki: Physical damage reduction / Armour](https://www.poewiki.net/wiki/Physical_damage_reduction) · [Armour math guide](https://www.poewiki.net/wiki/Armour/math) · [official-forum armour math thread](https://www.pathofexile.com/forum/view-thread/1468738)
- [PoE Wiki: Resistance / Overcapped resistance](https://www.poewiki.net/wiki/Overcapped_resistance) · [Respec](https://www.poewiki.net/wiki/Respec) · [Maps](https://www.poewiki.net/wiki/Maps) · [Fractured items](https://www.poewiki.net/wiki/Fractured)
- [Fandom Wiki: Stat](https://pathofexile.fandom.com/wiki/Stat) · [Damage effectiveness](https://pathofexile.fandom.com/wiki/Damage_effectiveness) · [Passive skill](https://pathofexile.fandom.com/wiki/Passive_skill) · [Modifiers](https://pathofexile.fandom.com/wiki/Modifiers) · [Accuracy](https://pathofexile.fandom.com/wiki/Accuracy) / [Evasion](https://pathofexile.fandom.com/wiki/Evasion) · [Support gem](https://pathofexile-archive.fandom.com/wiki/Support_gem)
- [Maxroll: Damage for Beginners](https://maxroll.gg/poe/getting-started/damage-for-beginners) · [Crafting Resources](https://maxroll.gg/poe/resources/crafting-resources)
- [Craft of Exile FAQ (mod weights)](https://www.craftofexile.com/faq) · [vhpg: More vs Increased](https://www.vhpg.com/poe-more-vs-increased/) · [vhpg: 8-mod maps](http://www.vhpg.com/complete-maps-with-eight-mods/)
- [PoE Vault: Atlas map guide](https://www.poe-vault.com/guides/atlas-of-worlds-map-guide) · [ExpCarry mapping guide](https://expcarry.com/poe-mapping-guide-map-tiers-modifiers-sustain) · [aoeah 3.26 Atlas strategies](https://www.aoeah.com/news/3984--poe-326-best-atlas-tree--mapping-strats-secrets-of-the-atlas)
- [Massively OP: Chris Wilson on economic integrity (Jan 2026)](https://massivelyop.com/2026/01/07/path-of-exile-co-creator-chris-wilson-discusses-his-mistakes-on-economic-integrity-in-online-rpgs/)

*Community-derived approximations are flagged inline; exact drop-pipeline math and current spawn weights are datamined (Craft of Exile), not officially published.*
