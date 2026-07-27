# Vampire Survivors (poncle, 2021–) — Research Report

**Why this game is in the research set.** Vampire Survivors is the most thoroughly dissected stat-scaling game in the modern arcade-ARPG space — its damage, cooldown, curse, and economy math is documented stat-by-stat on a community wiki maintained against datamines — and it is the canonical proof that a browser-tech engine can ship thousands of on-screen entities: it was built solo in [Phaser 3 (HTML5)](https://en.wikipedia.org/wiki/Vampire_Survivors) with default assets, sold tens of millions of copies, and only later migrated to Unity for platform reach. Pinball Knight shares both problems exactly: a card/stat system that needs a clean multiplicative formula architecture, and a WebGPU renderer that wants hundreds of enemies at a fixed 60Hz timestep. VS's answers — hard entity caps with offscreen recycling, pickup consolidation (the gem merge), a single global damage multiplier with per-weapon stat masks, and an opt-in difficulty stat that players *buy* — are all directly transplantable.

Sources are inline. Facts from the [Vampire Survivors Wiki](https://vampire.survivors.wiki/) reflect community documentation of shipped behavior (much of it verified against decompiles, e.g. the [vampiresurvivors-modding damage-system notes](https://deepwiki.com/lukeod/vampiresurvivors-modding/4.4-damage-system)); anything not confirmed by poncle or the wiki is flagged as community-derived.

---

## 1. Core loop — the 30-minute run

### Structure

- A run is a fixed-length survival session, typically **30:00** ([Mad Forest](https://vampire.survivors.wiki/w/Mad_Forest) time limit; some stages differ). There is no exit condition other than the clock or death.
- Enemies stream in continuously; all weapons **fire automatically**. The only moment-to-moment input is movement.
- At **30:00 the Reaper spawns** and rushes the player: **655,350 HP × player level, 65,535 damage per hit, speed 1,200**, with **one additional Reaper per minute** past the limit ([The Reaper](https://vampire.survivors.wiki/w/The_Reaper)). Death *is* the run clock — the timer is enforced by an enemy, not a fade-out, which lets advanced players fight the clock itself (Infinite Corridor halves all enemy health, making Reaper kills possible).
- Surviving to the end pays a flat **500 gold** bonus ([The Reaper](https://vampire.survivors.wiki/w/The_Reaper)).

### XP gems and the gem-merging trick

Every kill drops an [Experience Gem](https://vampire.survivors.wiki/w/Experience_Gem):

- **Blue** gems: up to 2 XP. **Green**: up to 9 XP. **Red**: anything beyond.
- **Gem cap = 400 on the ground.** Past that, *no more gems drop*; all further XP is **accumulated into a single red gem** instead. The wiki and community explicitly describe this as an anti-slowdown measure — one sprite absorbs unbounded value. Players experience it as a jackpot: walking over the accumulated red gem grants 3–5 levels at once.
- Gems idle on the floor also merge over time (a Jan 2022 patch fixed "gems sometimes not merging if the player stands still for a long time" — i.e., idle-consolidation is a deliberate mechanism, not an accident).
- Collection radius is the **Magnet** stat; Vacuum pickups and certain weapons (Gorgeous Moon) sweep the whole floor.
- XP gained on pickup is multiplied by the **Growth** stat.

The design consequence: the *value* ledger is decoupled from the *entity* ledger. Nothing of gameplay worth is ever lost to the entity cap; only sprites are.

### Level-up: 3–4 choices from a weighted pool

On level up the game pauses and offers **3 or 4 options** ([Level up](https://vampire.survivors.wiki/w/Level_up)):

- Chance of a 4th option: `chanceFourth = 1 − (1 / totalLuck)` — Luck at 100% (base) gives 0; +50% Luck gives a 1/3 chance.
- Options are drawn rarity-weighted, no repeats within one level-up. Documented pool weights currently total 9,500 (weapons 8,130 / passives 1,370).
- Inventory is hard-capped at **6 weapons + 6 passives**. Once full, only owned items are offered; once everything is maxed, level-ups pay out gold or floor chicken instead.
- Meta-purchasable QoL verbs: **Reroll**, **Skip**, **Banish** (remove an item from this run's pool) — each bought as PowerUp ranks.

### XP curve

Documented on [Level up](https://vampire.survivors.wiki/w/Level_up):

| Band | XP-to-next increment |
|---|---|
| To level 2 | 5 XP base |
| Levels 2–20 | +10 per level |
| Levels 21–40 | +13 per level |
| Level 41+ | +16 per level |

Plus two **checkpoint walls**: level 20 costs an extra **600 XP** and level 40 an extra **2,400 XP**, each compensated by **+100% Growth** until the next level — a deliberate "pause, then surge" pacing beat mid-run.

### Weapon + passive pairing and evolutions

Per [Evolution](https://vampire.survivors.wiki/w/Evolution):

- **Evolution recipe** = base weapon at **max level** + a specific **passive item** in inventory (many recipes require the passive maxed too, some only require possession) + open a **Treasure Chest** containing an evolution-type reward. The 10:00 boss chest is the classic trigger.
- Canonical examples: Whip + Hollow Heart → Bloody Tear; King Bible + Spellbinder → Unholy Vespers; Lightning Ring + Duplicator → Thunder Loop.
- Only one weapon evolves per ordinary chest; special multi-reward chests can trigger up to five at once.
- **Unions** merge two maxed weapons into one (no passive catalyst, frees a slot); **Gifts** grant extra items without consuming anything.

This turns the passive slots into a *build-commitment language*: taking Spellbinder is implicitly declaring a Bible build. Recipes are hidden-but-learnable, which converts wiki-reading and experimentation into meta progression.

### Why near-zero input still produces decisions

Attacking is automatic, but the player continuously makes:

1. **Draft decisions** — every level-up is a 3–4-way pick under slot pressure (6+6 cap) and recipe planning (which passives enable which evolutions).
2. **Positioning decisions** — movement is the only combat verb, so kiting, aura placement (Garlic/Santa Water), and lane-cutting through the horde carry the moment-to-moment skill.
3. **Routing decisions** — stages contain fixed pickups, coffins, and light sources worth detouring for; the 10:00/25:00 boss chests set the tempo.
4. **Greed decisions** — Curse, chest-opening timing, and staying inside the horde for gem density are all risk-for-income trades.

Galante's design method was famously improvisational — grabbing sprite packs and coding attack patterns "mercenary"-style, keeping the janky look because chaos on screen *was* the fantasy ([Game Developer on the Game Informer interview](https://www.gamedeveloper.com/design/vampire-survivors-development-sounds-like-an-open-source-fueled-fever-dream)). The lesson is that the decision layer lives entirely in drafting + movement; everything else can be automated without losing the ARPG feel.

---

## 2. The stat math

### Damage architecture

The community-documented model (wiki + [decompile notes](https://deepwiki.com/lukeod/vampiresurvivors-modding/4.4-damage-system)) is:

```
finalDamage ≈ weaponBaseDamage(level) × totalMight × perWeaponModifiers
```

- **Might** starts at **100%** (the panel shows the delta: "+30%" = 130% total). All Might sources — characters, PowerUps, passives, Arcanas — **stack additively** into `totalMight`, which then multiplies base damage. Hard cap: **1000% total** ([Might](https://vampire.survivors.wiki/w/Might)).
- **Per-weapon coefficients** exist as special cases — e.g. SpellStrike gets a further **×1.25 on Might**; Pugnala gains +1% Might per level, uncapped.
- Because Might is a pure multiplier, it is worth more on high-base-damage weapons (Death Spiral, Hellfire) — the wiki states this explicitly. Weapon *level-ups* raise the base term (e.g. Garlic: 5 → 15 damage over 8 levels), so per-weapon growth and global growth are cleanly separated.
- Note: the wiki does not publish one closed-form equation covering crits/per-hit variance; the shape above (base × global × per-weapon) is the documented architecture, with exact per-weapon behavior on each weapon's page.

### The six kinetic stats — and per-weapon stat masks

Beyond Might: **Cooldown** (fire interval, cap −90%), **Amount** (+projectiles, cap +10), **Area** (cap +900%), **Speed** (projectile speed, cap +400%), **Duration** (cap +400%), plus **Armor** (flat damage reduction, cap 50) and **Magnet**. (Caps per the [Golden Egg](https://vampire.survivors.wiki/w/Golden_Egg) hard-cap list.)

The crucial pattern: **every weapon declares which stats it ignores**, documented per weapon page. Example — [Garlic](https://vampire.survivors.wiki/w/Garlic) "ignores Amount, Duration, and Speed"; it scales only with Might (damage) and Area (aura size), and its 1.3s cooldown works as a *per-enemy re-hit interval*, not a fire rate. This mask system is why a shared stat pool works across ~60 wildly different weapons: stats are global, but each weapon subscribes to a subset. Players learn the masks and stop wasting picks (Duration is dead weight on a Garlic build).

### Curse — the self-imposed difficulty knob

[Curse](https://vampire.survivors.wiki/w/Curse) multiplies four enemy quantities by its percentage: **max health, move speed, spawn frequency, and wave quantity**. Base is 100%; documented mechanics:

- `effectiveSpawnInterval = spawnInterval / totalCurse` — +100% Curse literally doubles spawn rate.
- Health multiplier applies immediately to newly spawned enemies; speed/quantity effects apply at the next minute tick.
- Sources stack additively: PowerUp (+10%/rank ×5), Skull O'Maniac passive (+10%/level ×5), character bonuses (+10–50% flat or +0.5–1%/level uncapped).
- **Absolute on-screen cap: 500 enemies regardless of Curse and Charm.**

Why players *pay gold* for a stat that makes the game harder: more spawns = more kills = more gems and gold. Curse is a throughput knob disguised as a difficulty knob — the wiki says so verbatim ("more enemies and higher frequency of waves greatly increases … Experience Gems"). It only backfires when your DPS can't clear the denser horde, which makes it self-balancing.

### Economy stats

- **Growth** — % XP per gem (PowerUp: +3%/rank ×5).
- **Greed** — % gold from all sources (+10%/rank ×5).
- **Luck** — % chance-based everything: 4th level-up option (formula above), chest reward tiers, drop rates (+10%/rank ×3).

### Infinite scaling: Golden Eggs and Limit Break

- **[Golden Eggs](https://vampire.survivors.wiki/w/Golden_Egg)**: each egg permanently adds a small random stat bump to one character — +1% to Might/Speed/Duration/Area/Luck/Growth/Greed/Curse/MoveSpeed, −0.5% Cooldown, +1 MaxHealth, +0.1 Recovery/Armor/Amount/Revival/Reroll, etc. Bought at 10,000 gold from the in-stage merchant (late-save gating) or dropped 5-at-a-time by a defeated Reaper. There is **no design cap** — the only ceiling is float32 max (3.402823E+38 eggs), though the functional stat caps above (Might +900%, Cooldown −90%, Amount +10 …) still bound most of them. Eggs convert *surplus gold* into *permanent drift upward*, deliberately letting long-term players trivialize content.
- **[Limit Break](https://vampire.survivors.wiki/w/Limit_Break)** (Great Gospel relic): once a build is fully maxed, level-ups offer per-weapon over-cap boosts instead of gold — Might +0.3/0.5/1% **uncapped**, Area to 1000%, Speed to 300%, Duration +100ms steps to weapon-specific 2–15s caps, Amount to 20, Pierce +1 (cap 5–10), Crit chance to 100%. This makes XP income valuable for the entire run instead of going dead after minute ~20.

---

## 3. Wave/enemy math

### The minute-by-minute wave script

Per [Enemies](https://vampire.survivors.wiki/w/Enemies), each stage ships a literal timetable: **one wave per minute**, each wave defining an enemy roster, a **minimum alive amount**, and a **spawn interval**. The spawner is quota-based:

- If alive count < wave minimum → spawn until quota filled.
- If alive count ≥ minimum → spawn one of each enemy type in the wave per interval tick.

[Mad Forest](https://vampire.survivors.wiki/w/Mad_Forest)'s script (abridged) shows the shape of the curve:

| Minute | Wave content | Min alive | Interval |
|---|---|---|---|
| 0:00 | Pipistrellos | 15 | 1.0s |
| 1:00 | Zombies + bats; 1st boss (chest → evolution + 4 upgrades) | 30 | — |
| 2:00 | Mixed bats; Bat Swarm event ×3 | 50 | 0.5s |
| 5:00 | Mudmen; Mantichana boss; Flower Wall event (30s) | 10 | — |
| 10:00 | Giant Mantichana boss, evolution chest | 10 | — |
| 11:00 | **Skeletons — 300 minimum, 0.1s interval** | 300 | 0.1s |
| 15:00 | Giant Werewolf boss; Flower Wall (60s, 80%) | — | — |
| 20:00 | Giant Mummy boss; Bat Swarms (70%) | — | — |
| 25:00 | Giant Blue Venus boss (kill unlocks Hyper); Flower Wall ×5 | — | — |
| 30:00+ | The Reaper, +1 per minute | — | — |

Note the 11:00 wave: minimum 300 at 0.1s interval — the script deliberately slams into the entity cap as a *set-piece*. Swarm events (bat walls, flower rings) are scripted formation spawns layered on top of the ambient waves, with per-minute probabilities and repeat counts.

### Enemy HP scaling

- **`HP × playerLevel`** multiplier, applied **at spawn time only** — an enemy alive when you level does not retro-scale ([Enemies](https://vampire.survivors.wiki/w/Enemies)). Difficulty therefore tracks *your* progress, not just the clock, and freshly spawned enemies are always the relevant threat.
- **× Curse** health multiplier on top (immediately, at spawn).
- Stage modifiers multiply again: Mad Forest **Hyper mode = enemy HP ×3, enemy & player speed ×2, gold ×1.5, +0.2 Luck**; Inverse mode = HP ×3 escalating +0.05/min, gold ×3.

### The enemy cap and offscreen recycling

- **Periodic spawning stops at 300 alive**; only bosses and scripted map events can exceed it ([Enemies](https://vampire.survivors.wiki/w/Enemies)). Absolute ceiling **500** regardless of Curse/Charm ([Curse](https://vampire.survivors.wiki/w/Curse)).
- Enemies **spawn just outside the screen** and **despawn when the player moves far enough away** — the horde is a bubble that travels with the player. Combined with the quota system, a despawned enemy is immediately "replaced" by the spawner refilling the wave minimum at the new screen edge. The player perceives an infinite, inescapable horde; the simulation only ever tracks a few hundred.
- Bosses are exempt: they never despawn, and are **teleported back to the screen edge** if left behind — scripted threats cannot be outrun.

### Elites and the timeout

Minute-marked bosses ("Giant X") carry the chest/Arcana rewards and function as tempo gates. The final elite is the Reaper itself: unkillable by ordinary means (655,350 HP × level, and its HP× level term means over-leveling doesn't help), so the 30:00 mark stays a wall for 99% of players while remaining *technically* a boss with counterplay (Clock Lancet freeze, Infinite Corridor half-HP) for the top end.

---

## 4. Performance engineering — thousands of sprites in a browser engine

### What the Phaser build actually did

- The game is **Phaser 3 + Rex UI plugins**, built by one developer from default/bought assets ([Phaser newsletter](https://phaser.io/newsletter/issue-169), [Wikipedia](https://en.wikipedia.org/wiki/Vampire_Survivors)).
- **Hard entity caps everywhere**: 300-enemy periodic-spawn cap / 500 absolute; **400-gem floor cap**. These are gameplay-visible constants, i.e. the performance budget is enforced in *game rules*, not renderer heroics.
- **Gem-merge consolidation**: past 400 gems, all further XP folds into one red accumulator gem; idle gems merge over time ([Experience Gem](https://vampire.survivors.wiki/w/Experience_Gem), Jan 2022 patch note). This is the game's signature trick: unbounded reward, bounded sprites.
- **Despawn-and-refill horde bubble** (section 3): simulation cost is O(cap), never O(everything spawned so far).
- **Object pooling**: the Unity build has a centralized object pool under its Core scene object, and community teardown credits "well optimized object pooling" for the enemy counts ([Unity Case Study: Vampire Survivors](https://medium.com/@simon.nordon/unity-case-study-vampire-survivors-806eed11bebb)); the same pattern is standard Phaser practice for exactly this genre ([Phaser performance guidance](https://generalistprogrammer.com/tutorials/phaser-performance-optimization-guide): pooling for bullets/enemies/particles, texture atlases, minimized texture swaps).
- **Sprite batching / atlas**: Phaser's WebGL renderer batches consecutive sprites sharing a texture, so keeping the pixel-art on shared atlases keeps the whole horde to a handful of draw calls. *Poncle has not published draw-call budgets or atlas layouts* — treat specifics here as ecosystem-standard practice rather than confirmed VS internals. (Community tests put Phaser at ~2,800+ draw calls at 60fps, so a batched horde is far inside budget.)
- Uniform enemy behavior helps as much as rendering: almost every enemy just walks at the player at fixed speed — no pathfinding, no per-enemy AI state. Cheap ticks are what make 300+ entities × 60Hz viable in JS.

### The Unity migration — and what stayed the same

- The **Engine Update** shipped **August 17, 2023** on PC after ~a year of parallel development ([GamesRadar](https://www.gamesradar.com/vampire-survivors-dev-asked-if-hell-ever-use-unity-again-lol-no-thank-you/)).
- Galante's stated motive was **platform reach, not raw PC performance**: HTML5 "limited where it could be deployed — the mobile version was absolutely unplayable," and the team wanted mobile and console ports from one codebase ([GamesRadar](https://www.gamesradar.com/vampire-survivors-dev-asked-if-hell-ever-use-unity-again-lol-no-thank-you/)). Community coverage also credits sprite/collision volume as a motive ([foro3d](https://foro3d.com/en/2026/february/vampire-survivors-changes-engine-to-optimize-sprites.html)).
- **What stayed the same**: the entire design layer — caps, wave scripts, gem economy, stat math — carried over intact; the Unity build reproduces the Phaser game's behavior to the point that wiki formulas remained valid across the port. The teardown of the Unity build shows conventional architecture (state machines, DI, a central object pool, Unity Burst in the plugin list) rather than exotic tech ([Unity Case Study](https://medium.com/@simon.nordon/unity-case-study-vampire-survivors-806eed11bebb)).
- Epilogue: asked in a Reddit AMA whether he'd use Unity again after the 2023 runtime-fee affair, Galante answered "**lol no thank you!**" ([GamesRadar](https://www.gamesradar.com/vampire-survivors-dev-asked-if-hell-ever-use-unity-again-lol-no-thank-you/)) — the engine was a distribution decision, and a browser-tech game demonstrably scaled to genre-defining success before any native engine was involved.

---

## 5. Meta progression

### PowerUps: escalating, refundable gold sinks

Per [PowerUps](https://vampire.survivors.wiki/w/PowerUps):

- ~28 PowerUps, each a small permanent stat rank: Might +5%/rank ×5 (200g base), Cooldown −2.5% ×2 (900g), Amount +1 ×1 (5,000g), Revival ×1 (10,000g), Curse +10% ×5 (1,666g), Greed +10% ×5 (200g), plus utility verbs (Reroll/Skip/Banish ranks).
- **Cost formula (post-0.7.2, documented):**

  ```
  Price = InitialPrice × (1 + Bought) + ⌊20 × 1.1^TotalBought⌋
  ```

  where `Bought` = ranks already owned of *that* PowerUp and `TotalBought` = ranks owned across *all* PowerUps. The per-PowerUp term is linear (0.7.2 changed markup from percentage to flat, killing purchase-order optimization); the global `1.1^TotalBought` fee term is the long-tail sink — total cost of everything is **27,148,513 gold**, of which 24.7M is the global fee.
- **Fully refundable** at the push of a button (minus rounding). This is load-bearing design: players can respec the entire meta layer to, e.g., dump everything into Greed/Curse for a farming run, then refund and rebuild for a boss attempt. Zero regret ⇒ players engage with the sink freely.
- Maxed PowerUps can be individually *disabled* without refunding — the meta layer doubles as a self-handicap panel.

### Unlock-by-quest, widening not strengthening

- Nearly all content — characters, weapons, stages, relics, Hyper/Inverse modes — unlocks via in-run achievements ("survive 20 minutes with X", "evolve Y", "defeat the 25:00 boss") rather than purchases. Golden Eggs and PowerUps are the only pure gold→power paths.
- Most unlocks **widen the option space instead of raising the power floor**: a new character is a different starting weapon + one stat quirk (and often a *penalty*, e.g. +Curse characters); a new stage is a different wave script and modifier set; new weapons enter the same shared draft pool. Egg farming is the one genuinely unbounded power channel, and it's gated behind late-save conditions (5,000+ eggs / 1M gold for the merchant) precisely so it only trivializes the game for players who have already finished it.
- The Reaper/Hyper/Inverse ladder shows the pattern: beating the 25:00 boss unlocks Hyper mode (×3 enemy HP, ×1.5 gold) — the *reward for winning is a harder, richer version of the same stage*, not a bigger number on the player.

---

## 6. Lessons for Pinball Knight

### 6.1 Damage formula architecture: `base × global × per-weapon`, with stat masks

Adopt VS's three-layer shape for the card/stat system:

```
finalDamage = cardBaseDamage(level)            // per-card growth (like weapon levels)
            × globalMight                       // one additive-accumulated global multiplier
            × perSourceCoefficient              // per-card/per-skill tuning knob (SpellStrike's 1.25×)
```

- Accumulate every +damage% source (legacy perks, socketed cards, skill-tree nodes) **additively into one `totalMight`**, then multiply once. VS proves this stays legible across dozens of sources; multiplicative chains are where balance dies. Put a documented hard cap on the total (VS: 1000%).
- Give every damage source an explicit **stat mask** — which of {cooldown, amount, area, projectile speed, duration} it consumes — exactly like Garlic's "ignores Amount, Duration, Speed." With 22 enemy families and card-socketed gear, masks are what let one shared stat pool serve wildly different attack shapes, and they create learnable build knowledge (Duration cards are dead on aura builds). Encode the mask in the card/skill definition, not in scattered `if`s.
- VS's per-stat hard caps (Cooldown −90%, Amount +10, Area +900%) are the guardrails that make infinite meta-scaling (eggs/legacy perks) safe. Since `cardDef()` deltas already scale both ways, add caps *at the aggregation step*, not per source.

### 6.2 Entity cap + offscreen recycle for maze hordes

- Pick a hard alive-enemy cap tuned to the WebGPU frame budget (VS: 300 soft / 500 absolute) and enforce it in the *spawner*, so the budget is a game rule, not a renderer prayer. Scripted events (boss rooms) may exceed it briefly, ambient spawning never.
- Recycle, don't simulate: despawn enemies beyond ~1.5 screens and let the wave quota respawn them at the new frontier. In a maze this is even more natural than in VS's open fields — corridors behind the knight are dead space. Bosses/elites get the VS exemption: teleport-to-edge instead of despawn.
- Use a **quota spawner** (per-wave `minAlive` + `spawnInterval`, top-up to quota) rather than fire-and-forget spawn events. It self-heals after the player clears a room and makes density a single tunable per floor-minute.
- Apply enemy HP scaling **at spawn time only** (VS's `HP × playerLevel`), so mid-fight scaling never mutates live entities and the fixed-timestep sim stays deterministic.

### 6.3 Gem-merge-style pickup consolidation

- Cap ground pickups (VS: 400) and fold overflow into a single **accumulator entity** per pickup class — one "fat" gold pile / card-shard bundle that stores unbounded value. Players read it as a jackpot, the renderer reads it as one quad.
- Add idle merging: pickups that coexist in a cell/radius for >N seconds merge. In a maze, merge per-corridor-segment so loot walls form at chokepoints — a free reward-legibility win.
- Never let the cap destroy value, only sprites. VS's rule — XP is *always* credited somewhere — is why the cap is invisible to players.

### 6.4 Curse-style opt-in difficulty

- Add a purchasable/socketable **Curse stat** that multiplies enemy HP, speed, spawn frequency, and wave minimums — and honestly advertise the payoff (more drops, more XP, more card shards). `effectiveSpawnInterval = baseInterval / totalCurse` is a one-line implementation.
- It must be self-balancing the way VS's is: throughput reward, not flat reward, so it only pays if the build can actually clear the denser horde. This is the cheapest replayability multiplier in the genre — same content, player-selected intensity — and it slots naturally into Pinball Knight's legacy meta-perks (a refundable Curse rank) and card sockets (a Skull O'Maniac-style card).
- Keep the absolute entity cap sovereign over Curse (VS: "capped at 500 regardless of Curse and Charm") so the difficulty knob can never break the frame budget.

### 6.5 Pooling / atlas / pipeline budgets for the WebGPU renderer

- **Pool everything that churns** — enemies, projectiles, pickups, damage numbers, VFX. VS ran its horde through a centralized pool in both engines; at 60Hz fixed timestep, allocation churn is the JS-side equivalent of the pipeline stalls already traced in this project.
- **One atlas, few pipelines.** VS's horde renders fast because every sprite shares texture state, so the whole scene batches into a handful of draw calls. For Pinball Knight the translation is direct: since frame stalls were traced to **WebGPU pipeline count**, the VS lesson is that hundreds of enemies must not mean hundreds of pipeline/bind-group permutations — 22 families × 8 sub-type bundles should be one sprite pipeline + one atlas + per-instance data (tint/scale/frame index in an instance buffer), not per-family materials. Precompile the handful of pipelines at load; never create one mid-run.
- **Make enemy ticks trivially cheap.** VS enemies have no AI beyond "walk at player at fixed speed," and that uniformity — not rendering tricks — is what buys 300+ entities. Reserve per-entity intelligence for elites; let the horde be a flow field / potential-field crowd (which the maze codebase already favors).
- **Spend caps before cleverness.** Every VS number that matters (300/500/400) is a cap. Decide the entity, pickup, and projectile budgets that hold 60Hz on the worst target device, enforce them in game rules, and only then optimize the renderer.

### 6.6 Structural borrows

- **A Reaper, not a timer**: end runs (or floors) with an escalating unkillable-in-practice enforcer instead of a hard cutoff — it preserves fantasy, creates a top-end challenge (VS's Infinite Corridor counterplay), and "+1 Reaper per minute" is a beautifully cheap escalation curve.
- **Evolution-style recipes** for cards: card-at-max-level + specific second card/gear + a chest/altar event → transformed card. Hidden-but-learnable recipes convert community knowledge into retention, and the "passive slot as build declaration" pattern maps directly onto gear sockets.
- **Luck's 4th-choice formula** (`1 − 1/totalLuck`) is a ready-made way to make a Luck stat feel real in the run-scoped skill-tree draft.
- **XP checkpoint walls** (VS's level 20/40: big XP wall + temporary +100% Growth) are a cheap mid-run pacing beat for the run-scoped tree.
- **Refundable meta**: make legacy meta-perks refundable at par. VS shows zero-regret respec *increases* engagement with the gold sink; the escalating global-fee formula (`⌊20 × 1.1^TotalBought⌋`) keeps the sink deep anyway.
- **Widen, don't strengthen**: prefer unlocks that add enemy families, floor modifiers, and cards to the pool over raw power. VS's "reward for winning is Hyper mode — the same stage, harder and richer" is the exact template for post-clear maze floors.

---

### Source index

- Wiki mechanics: [Might](https://vampire.survivors.wiki/w/Might) · [Curse](https://vampire.survivors.wiki/w/Curse) · [Enemies](https://vampire.survivors.wiki/w/Enemies) · [Experience Gem](https://vampire.survivors.wiki/w/Experience_Gem) · [Level up](https://vampire.survivors.wiki/w/Level_up) · [Evolution](https://vampire.survivors.wiki/w/Evolution) · [PowerUps](https://vampire.survivors.wiki/w/PowerUps) · [Golden Egg](https://vampire.survivors.wiki/w/Golden_Egg) · [Limit Break](https://vampire.survivors.wiki/w/Limit_Break) · [The Reaper](https://vampire.survivors.wiki/w/The_Reaper) · [Mad Forest](https://vampire.survivors.wiki/w/Mad_Forest) · [Garlic](https://vampire.survivors.wiki/w/Garlic) · [Weapons](https://vampire.survivors.wiki/w/Weapons)
- Decompile/datamine: [vampiresurvivors-modding damage system](https://deepwiki.com/lukeod/vampiresurvivors-modding/4.4-damage-system)
- Engine & development: [Wikipedia — Vampire Survivors](https://en.wikipedia.org/wiki/Vampire_Survivors) · [GamesRadar — Unity migration & Galante quotes](https://www.gamesradar.com/vampire-survivors-dev-asked-if-hell-ever-use-unity-again-lol-no-thank-you/) · [Game Developer — development history](https://www.gamedeveloper.com/design/vampire-survivors-development-sounds-like-an-open-source-fueled-fever-dream) · [Simon Nordon — Unity Case Study teardown](https://medium.com/@simon.nordon/unity-case-study-vampire-survivors-806eed11bebb) · [Phaser newsletter #169](https://phaser.io/newsletter/issue-169) · [foro3d — engine switch coverage](https://foro3d.com/en/2026/february/vampire-survivors-changes-engine-to-optimize-sprites.html) · [Phaser performance guide (ecosystem practice)](https://generalistprogrammer.com/tutorials/phaser-performance-optimization-guide) · [Barclays — poncle interview](https://games.creative.barclays/resource-hub/games/industry-insights/how-vampire-survivors-became-a-hit-when-creator-poncle-was-ready-to-give-up/)
