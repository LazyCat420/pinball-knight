# Enter the Gungeon — Design Research

**Studio:** Dodge Roll (published by Devolver Digital) · **Released:** April 2016, major free updates through 2019 (Supply Drop, Advanced Gungeons & Draguns, A Farewell to Arms) · **Engine:** Unity, 2D top-down.

Enter the Gungeon is in the research set because it is the closest published analogue to Pinball Knight's core promise: a top-down, procedurally generated dungeon crawler where *movement itself is the defense mechanic*. Pinball Knight has already borrowed its two most visible ideas — the front-half-i-frame dodge roll and the unkillable pursuer (Lord of the Jammed → our Reaper) — but the durable value is underneath: a level generator that plans the floor as an abstract graph *with deliberately injected loops* before any tiles exist ([boristhebrave's write-up](https://www.boristhebrave.com/2019/07/28/dungeon-generation-in-enter-the-gungeon/) is the definitive external analysis); a hidden anti-streak stat (**Magnificence**) that quietly throttles high-tier drops; a per-floor **DPS cap** on bosses that lets the designers ship absurdly strong guns without letting them delete boss fights; and a **synergy** table of ~350 bespoke item-pair upgrades that turns a flat loot pool into a combinatorial one. Every one of those maps directly onto an open Pinball Knight problem: maze loop density for momentum play, card-drop pity/streak control, burst pinball damage vs boss pacing, and card socket combos.

---

## 1. Core loop and the risk economy

### 1.1 Floor structure

A standard run is 5 main chambers (Keep of the Lead Lord → Gungeon Proper → Black Powder Mine → Hollow → Forge), plus a 6th (Bullet Hell) and several secret/branch floors (Oubliette, Abbey of the True Gun, Resourceful Rat's Lair, R&G Dept.) ([wiki: Bosses](https://enterthegungeon.wiki.gg/wiki/Bosses)). Every chamber has the same skeleton:

- **Entrance** (elevator down from the previous floor).
- **Combat rooms** — doors seal, waves spawn, doors open on clear. Rooms re-lock only once; cleared rooms are safe thereafter.
- **Two treasure rooms**, each holding one locked chest; per floor **one chest holds a gun and the other holds a passive/active item** ([wiki: Chests](https://enterthegungeon.wiki.gg/wiki/Chests)). Treasure-room chests are always locked — a key is the tax on guaranteed loot.
- **One shop** (fixed vendor stocking keys, blanks, ammo, heart containers, plus 3 random items/guns).
- **Boss room** behind a hub, boss choice drawn from a per-floor pool of 3.
- Optional injected rooms: secret rooms, side vendors, shrines, NPC jail cells, elevator-shortcut rooms (see §2.3).

The elevator down is one-way: the risk economy is entirely "spend now or bank for a floor you haven't seen."

### 1.2 The three-currency risk economy

The genius of Gungeon's economy is that its three consumables convert into each other only through *risk*:

- **Casings (money)** drop from kills and room clears, and are spent at the shop. There is no carry-over between runs; unspent casings at death are pure waste, which pushes players to spend late-floor money on anything.
- **Keys** open locked chests and locked doors. Room-clear pickup rolls give a key with weight ~24% *when* a pickup drops at all (see the drop table below). Keybullet Kin — a fleeing enemy that despawns if you're slow — makes keys a *skill-check* drop. Every floor forces the "spend my key on the gun chest or the item chest?" decision, and the shop sells keys so casings can buy out of key-starvation.
- **Blanks** are the panic button (full mechanics in §3.3). You get a floor-refill (topped up to 2 at each new chamber), so hoarding across floors is impossible past 2 — the game *wants* you to spend them.

Room-clear rewards: there is a **20% chance (30% in co-op)** that a pickup spawns on room clear; when one does, the type weights are roughly **Half Heart 36.06%, Key 24.36%, Blank 10.64%, Armor 6.09%, Money 6.09%, Full Heart 4.35%, Ammo 3.05%**, remainder misc ([wiki: Pickups](https://enterthegungeon.wiki.gg/wiki/Pickups)). Community documentation (dev-confirmed on the Steam forums) describes the *item*-drop chance as `(1 + Coolness − Curse)%` base, **+9% per cleared room without a reward, capped at 80%, resetting to base when a reward drops** ([Steam: dev answer on drops](https://steamcommunity.com/app/311690/discussions/0/371919771761318788/)) — i.e. a classic pity timer. Ammo drops roll separately: **6% on floor 1, 8.5% on floors 2–3, 9% on floors 4+**, ×1.5 in co-op, ×(1 + Curse/20) ([wiki: Pickups](https://enterthegungeon.wiki.gg/wiki/Pickups)).

- **Curse** is the fourth, inverted currency: taking cursed items/shrine deals raises Curse, which raises mimic odds and spawns "Jammed" (buffed, red-black) enemies more often; at Curse 10 the unkillable **Lord of the Jammed** spawns and follows you for the rest of the run. Risk is literally a stat.
- **Coolness** (from a few items) lowers active-item cooldowns and raises drop luck — the mirror image of Curse.

### 1.3 Boss pacing and Boss Rush

Each boss drops casings, a quality-weighted reward, and **Hegemony Credits** (meta-currency); a **no-hit boss kill doubles the credits and awards a Master Round** (a permanent +1 heart container per floor's boss, one per floor) ([wiki: Bosses](https://enterthegungeon.wiki.gg/wiki/Bosses)). Master Rounds are the purest expression of Gungeon's design: the reward for defense is more capacity to be aggressive.

**Boss Rush** is a separate mode: floors reduced to entrance → boss rooms → exit, no chests, no shops, keys/casings useless, **and the DPS cap is removed** ([wiki/fandom: Boss Rush](https://enterthegungeon.fandom.com/wiki/Boss_Rush)). First entry free, 3 Hegemony Credits thereafter. It demonstrates that the DPS cap is a *pacing* tool for the main game, not a difficulty constant — when the mode is "prove you can dodge," the cap goes away.

### 1.4 Meta progression widens, it doesn't strengthen

Hegemony Credits are spent in the Breach hub with the vendor Ox & Cadence: purchases **add guns/items to the future drop pool** rather than granting stat upgrades ([wiki: Hegemony Credit](https://enterthegungeon.wiki.gg/wiki/Hegemony_Credit)). Other unlocks (new characters, shortcut elevators, NPC rescues that add vendors to future floors) are all *access* and *variety*, not power. The run is always winnable from a fresh save; a veteran's advantage is knowledge plus a wider pool. This is the accepted best practice for keeping a roguelike's difficulty honest — contrast Rogue Legacy-style stat metaprogression, which forces retuning the whole game around expected grind. Dodge Roll's stated post-launch philosophy was accessibility over power creep: "I'd much rather have the headline be 'Gungeon changes the game so everyone can play it'" ([Dave Crooks, Vooks interview](https://www.vooks.net/enter-the-gungeon-dev-dave-crooks-speaks-with-vooks/)).

---

## 2. Level generation — flows, injection, composites, loops

Everything in this section is from [Boris the Brave's decompilation-backed analysis](https://www.boristhebrave.com/2019/07/28/dungeon-generation-in-enter-the-gungeon/) (mirrored/summarized at [80.lv](https://80.lv/articles/studying-dungeon-generation-in-enter-the-gungeon)), the best public documentation of the generator. Dodge Roll's stated goal: **"approximate a Zelda dungeon with each generation."**

### 2.1 Stage 1 — the flow graph (topology before geometry)

Generation starts from a **flow**: a hand-authored abstract graph of room *roles* with no positions or sizes. Each stage ships several flow templates (e.g. the Hollow has 4, Gungeon Proper has 8) and picks one at random. Node types:

- **Normal** combat rooms (chosen from templates later),
- **Hub** rooms (large, many exits),
- **Connector** rooms (no enemies, often environmental hazard set-pieces),
- **Reward** rooms and the **Boss** room,
- Pre-specified **entrance / exit / shop**.

Crucially, flows are trees *plus extra edges that create loops*, and many chests sit **behind one-way drops on those loops** — you see the reward, commit to the loop, and can't back out: deliberate "risk – no reward" pacing built into topology. Because flows are hand-authored, speedrunners memorize the small set per stage and predict the boss's direction from the first two rooms — a knob the designers clearly accepted: authored macro-structure, generated micro-structure.

### 2.2 Room templates

Nearly **300 hand-built room templates per stage** carry exits (exact door coordinates + facing), enemy spawns, decoration, and hazards. The generator picks a template per node matching stage and role, avoiding duplicates on a floor. ("It was never the plan for Joe to make so many of the rooms, but plans are ephemeral in game development.") The generator never invents combat spaces — it *arranges* authored ones. This is why every Gungeon room fights well: cover density, pillar spacing, and door sightlines were placed by a human.

### 2.3 Stage 2 — node injection

After the flow is chosen, extra nodes are **injected** at valid attachment points, each with a probability and preconditions:

- **Secret rooms: 90% chance one is injected per floor; placed at a dead end, with a 1/5 probability of instead attaching to any random room.** Their entrance is a crack-textured wall section that only reveals under a blank or explosion — so the *reveal* mechanic (blanks, §3.3) and the *placement* rule reinforce each other: check dead ends, pop a blank.
- Side vendors, jail-cell NPC rescues, fireplaces (Oubliette entrance), shortcut elevators — gated on save-state preconditions (curse level, characters rescued, master rounds held).

Injection is the generalizable trick: content gating lives in a declarative list of (probability, precondition, attachment rule) entries, not inside the generator core.

### 2.4 Stage 3 — composites, then layout

The flow (now with injected nodes) is decomposed into **composites**: repeatedly find the *smallest remaining loop* and cut it out as one composite; whatever remains is split into loopless trees. Each composite is laid out independently, then composites are assembled (most-connected composite placed first; disconnected pieces either abutted for a short path or joined by pathfinding corridors).

- **Tree composites**: depth-first; pick an exit pair (existing room's free exit × new room's exit), translate the new room so the doors align, check overlap, backtrack and re-pick on failure (max 3 attempts per room before regenerating choices).
- **Loop composites** get a bespoke algorithm — evidence of how much the developers valued loops: rooms are appended alternately to *either end* of a growing chain; early exit-pair picks are random with a preference for opposing walls (W-E / N-S); past the halfway point the picker increasingly favors exit pairs that **bring the two open ends of the loop closer together**; finally the two ends are joined either by a small generated rectangular room or a pathfound corridor **4–30 tiles long** (up to 50 in the Mine).

Corridors between rooms are otherwise short and generated; rooms themselves are never procedurally deformed.

### 2.5 Why this matters

Boris's conclusion: many generators get *pacing* right (tree-shaped, lock-and-key friendly) and many get *compactness/loops* right (cave/agent generators), but almost none get both — Gungeon does, precisely because loops are first-class objects from the abstract-graph stage all the way down to a dedicated loop-layout routine. Loops are what make a combat floor feel like a place rather than a corridor quiz: they enable flanking, retreat routes, and "circle back for the chest" decisions.

---

## 3. Bullet-hell combat math

### 3.1 The core ratio: bullets slower than you

The un-secret secret of Gungeon (and the genre): **enemy bullets travel slower than the player moves.** Player move speed is 7 units/s for every character ([wiki: Movement Speed](https://enterthegungeon.wiki.gg/wiki/Movement_Speed)); the bulk of standard enemy shots (Bullet Kin family) travel visibly slower than a walking player, and an enemy's projectile speed is a fixed property of the enemy type, not of the floor — later floors get harder by *density and pattern complexity*, not by faster bullets ([wiki: Projectile Speed](https://enterthegungeon.wiki.gg/wiki/Projectile_Speed); exact per-enemy speeds are not published on the wiki — treat specific ratios as community-estimated). Fast projectiles exist (Gun Nut sword arcs, sniper lasers) but are always telegraphed heavily and used sparsely. Consequences:

- Positioning is always a valid answer; the roll is for when position fails.
- Patterns can be *dense* because they are slow — the player reads a moving wall, not a hitscan.
- Player bullets are much faster than enemy bullets, so aiming feels crisp while dodging feels readable.

### 3.2 The dodge roll

The roll lasts **~0.7 s total; the first half grants full invulnerability (save a frame or two at the very start), the second half is vulnerable recovery** ([wiki: Dodge Roll (Move)](https://enterthegungeon.wiki.gg/wiki/Dodge_Roll_(Move))) — ≈20 i-frames then ≈20 vulnerable frames at 60 Hz (frame counts are a community derivation from the 0.7 s figure, not datamined). You can fire the instant the roll ends, and the roll travels a fixed distance with no cooldown, but the vulnerable back half means rolling *into* a dense wave is a commitment. The roll also hops over low obstacles and knocks over tables (deployable cover). Crooks explicitly framed it as Souls-style i-frames: "it has invincibility frames like Dark Souls, so you can dodge-roll straight through the bullets" ([Windows Central interview](https://www.windowscentral.com/enter-gungeon-interview)). Pinball Knight has already shipped this exact split; the note here is the *ratio* (50/50 safe/vulnerable) and the zero-cooldown / fixed-distance choices are what keep it from being a spammable invulnerability button — the punish is baked into the move, not into a meter.

### 3.3 Blanks — the panic button done right

Per [wiki: Blank](https://enterthegungeon.wiki.gg/wiki/Blank):

- Effect on use: **erases every enemy bullet in the room**, briefly suppresses enemy firing, **knocks back enemies within a 7-tile radius, deals 10 damage** in that radius, and **reveals all secret-room walls in the room**.
- Economy: **topped up to a minimum of 2 at the start of every chamber** (items can raise the floor minimum); extra blanks drop from room clears at ~10.64%-of-a-20% roll, appear in shops and secret rooms.
- Instant, no resource bar, activated on a dedicated button.

The design lessons: (a) the panic tool is *floor-scoped*, so hoarding is capped and using one is never wrong twice; (b) it double-functions as the exploration tool (secret walls), so even flawless players spend them; (c) it deals trivial damage — it buys *time and space*, never kills. Boss fights are implicitly balanced around "the player probably holds 2 blanks."

### 3.4 How enemy patterns are composed

Enemy and boss attacks are authored as parameterized bullet scripts (Unity behaviors) composing a small vocabulary — aimed shots, aimed spreads (e.g. 3-shot fans with a mirrored fan behind the player), rotating radial sprays with alternating spin direction, expanding rings that force a roll or blank, accelerating spiral volleys, and splitting shells (one big bullet bursts into 8, each bursting into 8 again) — see the attack inventories on [Bullet King](https://enterthegungeon.wiki.gg/wiki/Bullet_King) and [Old King](https://enterthegungeon.wiki.gg/wiki/Old_King). The harder "Old King" variant literally reuses the Bullet King's script with tighter timing, faster ring speed, and overlapping layers — difficulty as *parameter changes on shared patterns*, not new code. (The underlying script format is not officially documented; the pattern-vocabulary reading is community/datamine-derived, e.g. via the modding community's `BraveBulletScript` APIs on the [modding wiki](https://enterthegungeon.wiki.gg/wiki/Modding/Once_More_Into_The_Breach/Synergies).)

Two composition rules recur everywhere:

1. **Aimed + fixed hybrid**: a radial (position-independent) layer plus an aimed (position-dependent) layer, so standing still and pure orbiting both fail.
2. **Telegraph scales with lethality**: slow dense walls get no windup; fast single shots get long windups.

---

## 4. Gun and item system

### 4.1 Quality tiers and chest odds

Every gun/item has a quality: **D, C, B, A, S** ([wiki: Quality](https://enterthegungeon.fandom.com/wiki/Quality)), and chests come in matching colors (brown/D, blue/C, green/B, red/A, black/S, plus rainbow). What a chest contains is decided by *floor-dependent* quality weights, post-AG&D ([wiki: Chests](https://enterthegungeon.wiki.gg/wiki/Chests)):

| Floor | D | C | B | A | S |
|---|---|---|---|---|---|
| 1 (Keep) | 35% | 32% | 20% | 9% | 4% |
| 2 / Oubliette | 10% | 37% | 40% | 9% | 4% |
| 3 / Abbey | 2% | 26% | 54% | 12.5% | 5.5% |
| 4 (Hollow) | 2% | 20% | 50% | 20% | 8% |
| 5 (Forge) | 0% | 10% | 42.5% | 35% | 12.5% |

Note the shape: the floor curve mostly moves mass from D/C into B — A+S together only climb from 13% to 47.5% by the final shop floor. Even at the end, roughly half of the loot is mid-tier; jackpots stay jackpots. A **rainbow chest** (8 pedestal items spanning B–S, pick one in Rainbow Mode) replaces a normal chest with probability **0.0333%** ([wiki: Chests](https://enterthegungeon.wiki.gg/wiki/Chests)). Destroying a chest instead of unlocking it gives a salvage roll (mostly junk, small chance of a downgraded item) — a documented pressure-release for keyless players.

### 4.2 Magnificence — the documented anti-streak brake

**Magnificence** is a hidden counter that suppresses runaway high-tier streaks ([wiki/fandom: Quality](https://enterthegungeon.fandom.com/wiki/Quality); the formula was surfaced by community datamining and is reproduced on the wiki):

- **+1 Magnificence** the first time you pick up any **A or S quality** gun/item (re-picking the same instance doesn't count again).
- **Chest Magnificence**: at floor generation, set to the number of red/black chests generated on the floor; opening or destroying one of *those specific* chests decrements it. (So the floor's own generated jackpot chests pre-count against you until resolved.)
- Whenever a floor reward (generated chest, room-clear chest, boss reward, shop item) rolls **A or S**, it has a chance to be **downgraded**, with:

```
P(downgrade) = 1 − (0.006260342 + 0.9935921 · e^(−1.626339 · M))
```

where `M` = total Magnificence. At M=0 that's ≈0% downgrade; at M=1 ≈80%; at M=2 ≈96%; asymptote ≈99.4%. In practice: **the game gives you roughly one "free" jackpot, then makes the second nearly impossible from random sources for the rest of the run** — without ever touching the *displayed* odds, and without blocking A/S from fixed sources. Players experience it as "runs have one god-item," which keeps run identity ("this is my Yari Launcher run") while preventing snowballs.

The complement is the **pity** side: the room-clear reward chance ramps +9% per dry room (cap 80%, reset on payout — §1.2), and the first-chest odds table guarantees early floors are D/C-heavy so a lucky floor-1 black chest feels miraculous rather than expected.

### 4.3 Ammo as the balance valve

Guns never get weaker; they run out. Every gun except starters has finite ammo; ammo boxes restore a fraction of max, drop rarely (6–9% per room clear, §1.2), and single-purchase in shops. Because **ammo pickups refill the *currently held* gun**, choosing when to hold a strong gun during pickup is itself a decision. The result: S-tier guns are *rationed* rather than nerfed — the Yari Launcher can be the best gun in the game because you get ~500 shots of it per run, not infinite. Starter guns have infinite ammo, so the floor of player power is constant and the ceiling is metered. Dev commentary on drop tuning confirms ammo drops were deliberately kept independent of "how empty your guns are" to avoid rewarding spray-and-pray ([Steam: dev answer](https://steamcommunity.com/app/311690/discussions/0/364040961436804784)).

### 4.4 Synergies — combinatorial loot without new items

The AG&D update added **~350 synergies**: bespoke effects that trigger when specific items/guns coexist in the inventory ([wiki: Synergies](https://enterthegungeon.wiki.gg/wiki/Synergies)). Mechanics worth stealing:

- A synergy is announced loudly (blue arrow over the player, named popup — e.g. duct-taping thematically), and the Ammonomicon highlights which owned items are synergizing. Discovery is the reward; the UI makes sure you *notice*.
- Two structural kinds: "complete the set" (all named parts required) and "one from column A + one from column B" (any gun of a group + any passive of a group).
- Effects are usually *transformations of an existing gun* (new projectile, new behavior, stat block change), not flat stat buffs — so a synergy changes how the run plays.
- **Synergy factor**: the drop system *cheats toward* synergies — a hidden multiplier starting at **≈1.7999882** boosts the chance that a newly generated gun/item completes a synergy with your current loadout, decaying with each synergy acquired (negligible after 2) ([wiki: Synergies](https://enterthegungeon.wiki.gg/wiki/Synergies)). So the game actively engineers the "no way, these two combo!" moment about twice per run, then stops forcing it.

---

## 5. Boss design

### 5.1 The DPS cap

Every boss outside Boss Rush has a **damage-per-second cap, evaluated over a 3-second sliding window**; damage above the cap in that window is discarded ([wiki: Bosses](https://enterthegungeon.wiki.gg/wiki/Bosses)). Documented values (A Farewell to Arms / Classic):

| Floor | DPS cap (AFtA) | (Classic) |
|---|---|---|
| Keep / Oubliette | 30 | 25 |
| Gungeon Proper / Abbey | 42 | 35 |
| Black Powder Mine / Rat's Lair | 60 | 50 |
| Hollow / R&G Dept. | 70 | 58 |
| Forge | 78 | 65 |
| Bullet Hell | 80 | 70 |

Rules: a **single hit is capped at 3× the floor cap**; **co-op raises the cap by 70%**; a handful of "moment" weapons (Glass Cannon, Makeshift Cannon, Yari Launcher, Boxing Glove 3-star punch, High Kaliber souls) bypass it, as does **any single projectile dealing ≥1000** ([wiki: Bosses](https://enterthegungeon.wiki.gg/wiki/Bosses)). The cap guarantees a *minimum fight duration* — the player must survive N seconds of pattern regardless of loot luck — while the bypass list preserves designed power fantasies. Players who never check the wiki mostly never notice; the fight just "feels appropriately long." This is the single most transferable boss mechanic in the game.

### 5.2 Phases and patterns

Bosses are 3-per-floor pools with authored multi-phase scripts; phase changes are HP-threshold-driven and typically add a pattern layer or swap the movement mode rather than reskinning. Patterns follow §3.4's grammar at higher density: radial + aimed layers, ring bursts that mandate roll/blank, splitting shells (Bullet King's 8→8 cascade) ([wiki: Bullet King](https://enterthegungeon.wiki.gg/wiki/Bullet_King)). Harder variants of a boss reuse the script with tightened parameters (Old King vs Bullet King). Boss intro cards, health bars, and arena entrances are fixed rituals — pattern-reading starts from a calm baseline.

### 5.3 Co-op scaling

In co-op: **enemy/boss HP +40%** ([wiki: Co-op](https://enterthegungeon.wiki.gg/wiki/Co-op)), **boss DPS cap +70%** ([wiki: Bosses](https://enterthegungeon.wiki.gg/wiki/Bosses)), room-clear pickup chance 20%→30% and ammo drops ×1.5 ([wiki: Pickups](https://enterthegungeon.wiki.gg/wiki/Pickups)). Player 2 is the Cultist, a co-op-exclusive character; a downed partner leaves a ghost that can be revived at a bleeding-out altar. Note the asymmetry: HP scales less than the theoretical 2× damage output, but the DPS cap scaling (+70%) is what actually keeps boss durations similar — the cap, not the HP pool, is the pacing authority.

---

## 6. Lessons for Pinball Knight

### 6.1 Loop injection for maze generation — plan loops in graph-land

We already grow a circuit first and let the maze fill in (track-first generation). Gungeon's lesson is the *next* level up: plan the floor as an abstract room-role graph, hand-author a small set of flow templates per depth band (entrance / combat / hub / connector / reward / boss), and treat loops as first-class composites with their own layout pass. Concretely:

- **Loops matter more for us than for Gungeon**: a momentum knight cannot stop-and-turn cheaply, so dead ends are a *physics tax* — every dead end forces a kill of all built-up speed. Target a higher loop density than Gungeon's; use its composite trick (repeatedly cut the smallest loop out of the flow, lay each loop out with the "close the two open ends" heuristic, join with a 4–30-tile corridor) to guarantee every generated floor has N ≥ 2 traversable circuits, and prefer opposing-wall door pairs in loops so a bouncing player can carry speed through.
- **Injection, not entanglement**: secret rooms, shrines, vendor nooks, and Reaper-delay rooms should be a declarative injection list — (probability, precondition, attach-at-dead-end-vs-anywhere) — bolted onto the flow after it's chosen. Gungeon's numbers are a fine starting point: 90% one secret room per floor, dead-end-biased with a 1/5 anywhere-override. Dead ends are bad for our momentum game *except* as secret-room anchors — that converts the physics tax into a treasure tell.
- **Rooms are authored, floors are arranged.** Gungeon's ~300 templates/stage is why its combat spaces fight well. Our per-tile surface system means templates should carry surface paint (boost lanes, damp pockets) the way Gungeon rooms carry cover — the generator should never be inventing bounce geometry.
- **One-way drops onto loops** are Gungeon's "see the chest, commit to the loop" trick — a natural fit for launch chutes: a chute that fires you onto a lower loop you can't climb back out of is exactly this, and it's cheap for us because chutes already exist.

### 6.2 A Magnificence-style brake for card drops

Cards are our A/S items. Adopt both halves of Gungeon's streak control:

- **Anti-streak (Magnificence)**: keep a hidden per-run counter `M`; +1 the first time a high-tier (or high-shine) card instance is picked up, plus pre-count the floor's generated jackpot sources. When a drop rolls high-tier, downgrade with probability `1 − (a + b·e^(−k·M))` — Gungeon's constants (a=0.00626, b=0.99359, k=1.62634) give the "one free jackpot, second nearly never" curve and are a sane default. Critically, apply it only to *random* sources; leave boss-guaranteed and crafted cards exempt, as Gungeon exempts fixed rewards.
- **Pity (dry-streak ramp)**: mirror the room-clear rule — base drop chance +9%-points per cleared room with no drop, cap ~80%, reset on payout. Cheap to implement, invisible, and it kills the "ten dry rooms" complaint without changing average yield much.
- Keep the **floor-quality table shape**: shift mass from low to *mid* tier as depth grows; let top-tier climb slowly (Gungeon: 13% → 47.5% A+S over five floors). Depth should promise "better," not "jackpot."

### 6.3 DPS caps for bosses vs burst pinball damage

Pinball Knight's damage is inherently *burst-shaped* — a full-speed booster-chain hit is our Glass Cannon. Without a cap, boss fights collapse to "line up one big bounce." Adopt the Gungeon cap wholesale:

- Per-floor **DPS cap over a 3 s sliding window** (scale values to our HP economy; Gungeon's 30→80 across six floors is the shape), **single-hit cap = 3× the floor cap**, **co-op cap ×1.7 with boss HP ×1.4** — Gungeon's exact co-op pairing keeps duo fight length close to solo.
- Keep a **bypass list** as a designed reward: one or two legendary cards / a max-speed "perfect launch" hit may pierce the cap, like the Makeshift Cannon. The fantasy of one huge pinball hit should survive; the *strategy* of only huge hits shouldn't.
- Remove the cap in any boss-rush mode, exactly as Gungeon does — there the whole test is dodging.
- Excess damage should be *discarded silently* (no "IMMUNE" popup). Gungeon proves players read a capped fight as "correctly paced," not "cheated," as long as no UI rubs it in.

### 6.4 A blank-style panic tool

We have i-frame rolls but no room-scale reset. Add a blank equivalent — "Shockwave," "Parry Bell," whatever fits — with Gungeon's exact economics:

- **Instant, dedicated button; clears all enemy projectiles in the room; ~7-tile knockback; trivial damage (bought time, never a kill).** For us the knockback double-serves: it can *also* reset the knight's own velocity or repel the Reaper for 2–3 seconds, which is the momentum-game version of "stop the bullets."
- **Refill to a minimum of 2 per floor** — floor-scoped stock kills hoarding and lets boss patterns assume "player probably holds 2."
- **Overload it with the exploration function**: our blank should reveal secret-room walls (and maybe ping card-bearing corpses), so even flawless players spend them. Single-purpose panic buttons rot in the inventory; Gungeon's doesn't because it's also a metal detector.

### 6.5 Synergy pairs for cards

Our socketed cards are Gungeon's passives; the missing layer is the pair table:

- Author **bespoke named pairs** (start with ~30, not 350): card A + card B socketed together transforms a behavior — not "+10%" but "your bounce now chains lightning between the last two walls hit." Transformations, not stat stacks, following Gungeon.
- **Announce loudly**: named banner + persistent icon, and highlight partner cards in the collection UI. The discovery moment is the content.
- **Cheat the drops toward completion**: implement a synergy factor — multiply the weight of any dropping card that would complete a pair with socketed cards by ~1.8, decaying to 1.0 after two completed synergies per run. Two engineered "wow" moments per run, then honest RNG.
- Support the "one from group A + one from group B" form (any *fire* card + any *bounce* card) — it scales far better than strict pairs with our `spidersilk#4s`-style leveled instances, since the group predicate can ignore level/shine.

### 6.6 Smaller transplants worth taking

- **Master Round analogue**: a permanent +1 max-HP token for a no-hit boss kill, one per floor — rewards defense with license for aggression, and is trivially checkable in our fixed-timestep sim.
- **Casings burn at death** (no run-to-run banking) keeps the shop tempting late; pair with a Keybullet-Kin-style *fleeing* key carrier — in a momentum game, "chase the runner before it despawns" is a delicious physics challenge.
- **Curse as opt-in risk stat** feeding the Reaper: cursed cards make the Reaper spawn earlier/faster — we already own the Lord-of-the-Jammed analogue, so Gungeon's Curse gives it a tunable dial instead of a fixed timer.
- **Difficulty via parameters, not new content**: harder variants of an enemy family should be the same attack script with tighter numbers (Old King ≡ Bullet King + parameter deltas). With 22 enemy families this doubles apparent content nearly for free.
- **Meta unlocks widen the card pool only.** No purchased stat power. Gungeon's Breach model — credits from bosses (doubled for no-hit), spent to add cards/relics to future drop pools and to unlock shortcut elevators — maps 1:1 onto our tavern hub.

---

## Sources

- [Dungeon Generation in Enter The Gungeon — BorisTheBrave.com](https://www.boristhebrave.com/2019/07/28/dungeon-generation-in-enter-the-gungeon/) (primary for §2)
- [80.lv — Studying Dungeon Generation in Enter The Gungeon](https://80.lv/articles/studying-dungeon-generation-in-enter-the-gungeon)
- Wiki (wiki.gg): [Chests](https://enterthegungeon.wiki.gg/wiki/Chests) · [Bosses](https://enterthegungeon.wiki.gg/wiki/Bosses) · [Blank](https://enterthegungeon.wiki.gg/wiki/Blank) · [Pickups](https://enterthegungeon.fandom.com/wiki/Pickups) · [Synergies](https://enterthegungeon.wiki.gg/wiki/Synergies) · [Dodge Roll (Move)](https://enterthegungeon.wiki.gg/wiki/Dodge_Roll_(Move)) · [Movement Speed](https://enterthegungeon.wiki.gg/wiki/Movement_Speed) · [Projectile Speed](https://enterthegungeon.wiki.gg/wiki/Projectile_Speed) · [Co-op](https://enterthegungeon.wiki.gg/wiki/Co-op) · [Hegemony Credit](https://enterthegungeon.wiki.gg/wiki/Hegemony_Credit) · [Bullet King](https://enterthegungeon.wiki.gg/wiki/Bullet_King) · [Old King](https://enterthegungeon.wiki.gg/wiki/Old_King)
- Wiki (fandom): [Quality / Magnificence](https://enterthegungeon.fandom.com/wiki/Quality) · [Boss Rush](https://enterthegungeon.fandom.com/wiki/Boss_Rush)
- Interviews: [Dave Crooks — Vooks](https://www.vooks.net/enter-the-gungeon-dev-dave-crooks-speaks-with-vooks/) · [Windows Central](https://www.windowscentral.com/enter-gungeon-interview) · [Gameranx](https://gameranx.com/features/id/48447/article/enter-the-gungeon-interview-with-dodge-rolls-dave-crooks-the-past-present-and-future/)
- Dev forum answers on drop tuning: [room-reward pity ramp](https://steamcommunity.com/app/311690/discussions/0/371919771761318788/) · [ammo drop independence](https://steamcommunity.com/app/311690/discussions/0/364040961436804784)

**Provenance note:** floor odds tables, DPS caps, Magnificence formula, synergy factor, and blank stats are reproduced from the community wikis (datamine-backed but not officially published by Dodge Roll). Frame-count conversions of the 0.7 s roll and per-enemy bullet-speed ratios are community approximations and are marked as such above. The flow/composite generation account is from decompilation analysis by Boris the Brave, corroborated by developer quotes within that article.
