# Hotline Miami — Mechanics Research Report

**Games covered:** Hotline Miami (Dennaton Games, 2012) and Hotline Miami 2: Wrong Number (2015), both built in GameMaker at a fixed timestep — the same engine class as Pinball Knight's fixed 60Hz loop (the decompiled score code even ticks at 60/sec).

**Why this game is in the research set:** Hotline Miami is the reference implementation of a top-down, one-hit-kill combat loop where *speed of iteration replaces health as the difficulty valve*: the player dies constantly, restarts in under a second, and treats each room like a physics/timing puzzle to be solved and then executed flawlessly. Its lessons map unusually directly onto Pinball Knight: both are top-down games where momentum and collision (there: thrown weapons and doors; here: pinball bounces) knock enemies into a stunned state machine, where the environment itself is weaponized, and where a quadratic combo economy rewards chaining kills within a decaying timer. It is the best-documented case study of how brutally simple AI, interactive level furniture, and instant restart combine into a game that feels simultaneously surgical (planned) and frantic (executed).

---

## 1. The core game loop

### Plan → execute → die → R → retry

The loop is: study the floor layout through walls and windows, pick an entry point and weapon plan, execute a burst of violence lasting seconds, die to a single mistake, press **R**, and be back at the start of the floor with no loading screen, no death animation to sit through, no lives system. [VideoGamer's Phill Cameron described it as "five seconds of action that you can lose yourself in for five hours"](https://en.wikipedia.org/wiki/Hotline_Miami) — the canonical description of the rhythm.

Key structural facts:

- **One-hit lethality both ways** (with a nuance — see §2) means every level is beatable in principle without taking damage, and every death is the player's fault. Wikipedia's summary of the design: players can ["quickly restart the current stage after death, allowing them to rethink their strategy"](https://en.wikipedia.org/wiki/Hotline_Miami).
- **Checkpoints are per-floor, not per-level.** Each new floor/section of a multi-storey level is a checkpoint; dying resets only the current floor. [ZTGD's review](https://ztgd.com/reviews/hotline-miami/) notes the game "ditches lives and has each new section of a level serve as a checkpoint" — players may die a dozen-plus times per floor while learning the route, but the restart is so cheap that frustration never accumulates.
- **Restart is a single keypress (R), available at all times**, not just on death — score-chasers voluntarily reset mid-attempt the instant a run stops being optimal. This turns death from a punishment into an editing tool.
- Dennaton explicitly designed for early difficulty: ["games that literally slap you in the face the first couple of times you play are the games that really make me want to go on"](https://www.pcgamer.com/hotline-miami-interview-dennaton-games-on-creating-carnage-to-delight-and-disgust/), and the game surfaces "instant R to Restart" as a core feature.

### Why it feels both surgical and fast-paced

Two clocks run against each other:

1. **The planning clock is unlimited.** Standing outside a doorway costs nothing except score (Time Bonus and Mobility decay — see §6). You can peek sightlines, watch patrol loops, and count enemies for as long as you like.
2. **The execution clock is brutal.** The combo multiplier decays within a few seconds of the last kill (see §6), enemies converge on gunfire, and knocked-down enemies stand back up. The moment you commit, the optimal play is continuous forward motion.

The score system is the bridge: caution is *allowed* but *taxed*, so mastery expresses itself as compressing the plan into one unbroken kill-chain. The music (looping, high-BPM synthwave that does not restart on death) keeps the arousal level pinned across dozens of retries — a widely-cited reason the retry loop feels like a trance rather than a grind ([Horror Obsessive retrospective](https://horrorobsessive.com/2022/10/23/hotline-miami-turns-ten/)).

### Score, grades, and unlocks

- Levels are graded **F− to A+** in HM1; the [decompiled grade table](https://hotlinemiami.fandom.com/wiki/Scoring) is linear in fifteenths of the level's max score: C− = 6/15, B = 10/15, **A+ = 14/15 and up**. HM2 adds an **S grade at roughly 2.6× the C-grade score**.
- High scores unlock new **masks** (per-level mutators: longer combo window, lethal doors, lethal punches, faster walk, more ammo…) and new weapons entering the random spawn pool — the meta-progression is horizontal (new toys and modifiers), not vertical (no stat growth). Notably, [mask perks were not in the original design and were added late in development](https://80.lv/articles/hotline-miami-creators-discussed-its-design-past-and-future).
- The results screen also assigns a **playstyle title** from a priority list computed off action counts (e.g. Combo Master for a 12x+ combo, Door Man for 4+ door slams, Executioner for 5+ ground executions) — pure flavor, but it teaches players the verbs the scoring system loves ([Scoring wiki, decompiled priority table](https://hotlinemiami.fandom.com/wiki/Scoring)).

---

## 2. How weapons work

### The "one-hit-kill" that is secretly a 1–2 HP system

The marketing says one-hit-kill; the code says **Energy Points**. Per the [Energy Points wiki](https://hotlinemiami.fandom.com/wiki/Energy_Points) (decompile-derived):

- The player and standard enemies **randomly spawn with up to 2 energy points** (player: rolled at level start; enemies: on floor load).
- **Melee weapons instantly kill** standard enemies regardless of EP. **All non-Magnum firearms deal 1 damage per tracer; the Magnum always deals 2.** So a full-EP player can occasionally survive one stray bullet — an invisible mercy roll that makes the game feel fairer than true one-hit-kill without the player ever seeing a health bar.
- **Executions restore the player's energy points** (up to the max of 2) — aggression literally heals.
- HM2 simplified it: all firearms one-shot enemies, the player always has 2 EP (3 with the Rufus/Earl masks), and only the Magnum bypasses player EP.
- Heavies (Thugs), dogs, and boss melee always instantly kill the player — asymmetric exceptions used as puzzle pieces.

### The three weapon classes

Per the [Weapons wiki](https://hotlinemiami.fandom.com/wiki/Weapons) — 28 melee weapons, 17 firearms, 10 throwables:

| Class | Kill | Noise | Range | Ammo | Notes |
|---|---|---|---|---|---|
| **Melee** (bat, knife, katana, pipe…) | Instant on standard enemies | Silent — no alert | Touch | Infinite | Swing speed and arc vary per weapon; silence makes melee the stealth/route-control tool |
| **Firearms** (shotgun, M16, Uzi, Magnum…) | 1 dmg/tracer (Magnum 2) | **Gunfire alerts every non-static enemy on the floor** | Screen+ | Finite, no reloading from pockets — you swap guns instead | Silenced pistol/Uzi exist as the exception that proves the noise rule |
| **Throwables** (knife, ninja star, brick, hammer, bottle…) | Sharp = kill; blunt = knockdown | Silent | Thrown | Single use | "Between the Melee and Firearm weapon types; they lack melee attacks, but grant a guaranteed kill or knock down when hitting their target" |

- **Every weapon can be thrown** (right mouse button). A thrown *lethal-tagged* weapon (knife, ninja star) kills; a thrown *blunt* one (bat, gun, bottle) **knocks the target down** — this is the load-bearing stun verb (§4). It doesn't matter whose weapon it was; [being hit by a non-lethal thrown weapon knocks an enemy over regardless of source](https://hotlinemiami.fandom.com/wiki/Execution).
- **Fists, the unbroken pool cue, and the beer can only knock down, never kill** — bare hands force you into the knockdown → ground-execution loop, which is slower but scores higher and restores EP.
- **Special counters:** Thugs/Heavies ignore normal melee and punches (they use a separate blood system — §6); **Dodgers** sidestep all projectiles and thrown items and can *only* be killed with melee ([Dodger wiki](https://hotlinemiami.fandom.com/wiki/Dodger)) — "basically the opposite of a Thug." Rock-paper-scissors enemy gating without any damage numbers.

### The pickup/drop economy

- Enemies drop their weapon where they die; the floor becomes a constantly rewritten weapon map. Guns come with whatever ammo is left — there is no reload-from-inventory, so **an empty gun's remaining value is as a thrown stun projectile**, after which you take the victim's weapon. The throw-gun → punch/execute → take-their-gun cycle is the game's signature weapon rotation.
- Weapon spawn at level start is partly randomized, which Dennaton kept deliberately: it forces plan improvisation between retries of the same floor.
- HM2's Hard Mode prices the throw economy explicitly: [every gun picked up off the ground holds only 65% of its remaining ammo (rounded down), reapplied on every throw](https://hotlinemiami.fandom.com/wiki/Hard_Mode) — so throwing low-capacity guns (Magnum drops to 1 round, double-barrel to 0) becomes non-viable. A clean example of tuning one scalar to reshape a whole tactical layer.
- **Flexibility score** (§6) directly pays you for cycling weapons, so the economy is score-reinforced, not just ammo-forced.

---

## 3. How the interactive map works

### Doors are weapons

Per the [Door wiki](https://hotlinemiami.fandom.com/wiki/Door):

- Doors open when walked through **or when shot** — bullets physically push them.
- **Hitting a standard enemy with a swinging door knocks them over** (the "Door Slam", worth 480 + 300·n points, n = alerted enemies), setting up a ground execution. With the **Don Juan mask, doors become lethal** and a door-wall kill is worth 2,200 points — an entire high-score archetype ("Door Man" playstyle) built on one interactive object.
- **Closed doors block enemy line of sight; open doors don't.** Doors also stop bullets — but a known quirk: [enemies in "hide/cover" idle can see through doors and will empty their magazines into them](https://hotlinemiami.fandom.com/wiki/Door), which players exploit to drain ammo. Even the bug is a tactic.
- The classic opening move of the whole game: stand beside a door, knock, or body-slam through it into the guard behind — the door is simultaneously entry, shield, and first weapon.

### Windows/glass are one-way pressure valves

Per the [Glass wiki](https://hotlinemiami.fandom.com/wiki/Glass):

- Glass **blocks movement but not line of sight or projectiles**. It breaks when hit by a bullet or melee swing; broken glass still blocks movement.
- Level designers use it to "create areas that enemies can fire at the player from without the player being able to go too close to them" — i.e., glass converts a maze wall into a ranged-combat lane while forbidding the melee answer. Community consensus holds that **glass-heavy levels (e.g. Dead Ahead) are among the hardest in the series** because the player's melee toolkit is neutralized across glass.
- Shooting through a window you just broke, or luring melee enemies to path the long way around a glass wall you can shoot through, are core sightline puzzles.

### Room-by-room clearing as puzzle structure

- Floors are subdivided into rooms with narrow doorways; **corridors and doorframes are chokepoints where enemy pursuit queues up single-file**, so pulling a crowd to a doorway and swinging melee as they funnel in is the fundamental crowd-control pattern.
- Because gunfire aggros the whole floor (§5), the level layout *is* the difficulty dial: a floor with tight rooms rewards loud chain-pulls into a chokepoint; an open-plan floor with windows punishes noise and rewards silent melee routing.
- Line of sight is honest and symmetric — the camera can pan ahead (shift-look) to scout, so planning happens with the same information the AI uses. The "puzzle" feel comes from patrol paths + sightlines + weapon spawns forming a solvable ordering problem: *which* room first, *which* weapon in hand at each doorway.

---

## 4. How stunning works — the knockdown state machine

Hotline Miami's stun layer is a small, explicit state machine documented on the [Execution wiki](https://hotlinemiami.fandom.com/wiki/Execution):

**Knockdown causes (all physical/impact verbs):**
1. Hit by a swinging **door** (unless Don Juan makes it lethal),
2. Hit by a **non-lethal thrown weapon** (any blunt object, including empty guns — source irrelevant, enemies can knock each other down),
3. **Punched** with fists, or struck with the briefcase or drill (dedicated knockdown-only melee).

**Two downed states:**
- **"Starfished"** — knocked flat on their back: vulnerable to *every* execution move.
- **"Slumped"** — knocked into a wall: can be finished with a foot/fist execution or by hitting them with any weapon, melee or firearm.

**Timeout and recovery:** a downed enemy "will only stay knocked down for a few seconds before getting back up and **attempting to find a weapon**" — recovery is not a return to the previous state but a re-entry into the AI's weapon-seeking behavior (per the [Dennaton AI blog](http://dennaton.blogspot.com/2012/11/hotline-miami-ai.html), a knocked-over enemy adopts *random* wander unless it finds a melee weapon, in which case it becomes a *patroller*). The stun creates a soft timer: execute now, or fight the same enemy again with whatever weapon it picked up.

**Executions (kill on a downed enemy):**
- Ground executions are slow, animated, character-locked kills. Crucially, **the player is fully vulnerable during the execution animation** — gunfire, melee, and dogs can kill you mid-execution. High-value, high-exposure.
- Point values (HM1): unarmed ground execution **600 + 400·n**; armed **1,000 + 400·n**; brick **1,400 + 400·n**; mercy kill on a crawler **1,200 + 400·n** (n = enemies watching). Executions also **restore energy points** (§2).
- HM2 finishing moves take **~0.5–2 seconds** depending on weapon, long enough that [players complain executions break combos in HM2's stricter timer](https://steamcommunity.com/app/274170/discussions/0/617330227196045088/) — a real tuning tension between spectacle and chain-flow.
- **Human shield variant:** with a one-handed firearm, the execute key instead grabs the downed enemy as a bullet-proof shield (still vulnerable to melee/dogs/rear attacks); pressing again snaps the neck.
- **Standing execution (throat rip):** Jacket can execute an *un-downed* standard mobster point-blank while unarmed (600 + 400·n); the Willem mask makes it also steal the victim's weapon.

The elegance: **knockdown, execution, doors, and throws are all one economy.** A thrown empty gun = a ranged stun = a queued execution = restored health = a Boldness/exposure score event, and every link is legible to the player.

---

## 5. Enemy AI — simplicity as a speed feature

The primary source is Dennaton's own developer blog post, [Hotline Miami AI](http://dennaton.blogspot.com/2012/11/hotline-miami-ai.html), plus the community-decompiled [Enemy Behaviour wiki](https://hotlinemiami.fandom.com/wiki/Enemy_Behaviour).

### One enemy, a handful of behavior states

Dennaton built essentially **one enemy type with behavioral variations** rather than many enemy classes. Default behaviors (assignable per-enemy in the level editor):

- **Static/Idle:** stands still until it has *visual* contact; **does not react to gunfire** (exception: police faction reacts to gunfire even when static). Idle sub-flavors (sitting, smoking, phoning, pissing, hiding-behind-cover) are pure dressing over the same trigger.
- **Patrol:** walks forward, and on hitting any solid obstacle **turns 90° left**. That is the entire pathing algorithm — patrol routes are an emergent property of level geometry, not authored splines. Dogs and Thugs are hard-wired patrollers.
- **Random:** wanders at random with occasional stops, may cross rooms — deliberately unpredictable so memorized routes stay slightly unsafe between retries.

### Alert/pursuit logic

- Triggers: **line of sight** or (for non-static enemies) **the sound of gunfire**. On alert, melee enemies pursue; gun enemies fire when they have LOS and **pursue to the player's last known position** when they lose it. If pursuit finds nothing, they *return to their default behavior* — the whole FSM is 3 states: Default → Fire → Pursue ([Enemy Behaviour](https://hotlinemiami.fandom.com/wiki/Enemy_Behaviour)).
- **Reaction time scales with distance**, by design: per the [Dennaton blog](http://dennaton.blogspot.com/2012/11/hotline-miami-ai.html), gunmen far away "immediately jump around and kill you," while a gunman at close range takes "**about a second** to get their guns pointed in your direction" — an explicit risk/reward window that makes closing distance the correct aggressive play. (No frame-exact numbers were ever published; treat "about a second" as the only dev-stated figure.)
- Dennaton **rejected visual telegraphing of AI state** (no alert icons, no different sprites per behavior) and chose "varied" over "believable" when the two conflicted ([Wikipedia, development](https://en.wikipedia.org/wiki/Hotline_Miami)) — uncertainty about which behavior an enemy is running is itself part of the difficulty.
- Knocked-down enemies re-enter the FSM by weapon: no weapon → random wander; melee weapon found → patroller. Enemy state is thus *dynamic across a single fight*, produced by the physics of dropped weapons, not scripting.

### Why the simplicity matters

Every AI rule is cheap enough to evaluate at 60Hz on dozens of agents, deterministic enough to plan against ("that guard turns left at the couch"), and just noisy enough (random wanderers, distance-scaled reactions) that plans need real-time adjustment. The AI never needs to be smart because **the player dies in one hit** — lethality substitutes for intelligence. HM2's Hard Mode makes enemies "more intelligent" almost entirely by **turning up awareness radius and reaction/turn speed**, not by adding behaviors ([Hard Mode wiki](https://hotlinemiami.fandom.com/wiki/Hard_Mode)).

---

## 6. Numbers and math (decompile-verified where noted)

All formulas below are from the community-maintained [Scoring](https://hotlinemiami.fandom.com/wiki/Scoring) and [Points](https://hotlinemiami.fandom.com/wiki/Points) wiki pages, which quote the decompiled GameMaker source (the game shipped un-obfuscated; GM decompilers are well established). Items marked *(community approx.)* are player-measured, not code-derived.

### Combo scoring (HM1, decompiled)

Runs on every kill after the first in a chain:

```
comboscore += (100 + combo * 125) * combo
```

so the increment for landing the Nth combo kill is `125N² + 100N` — quadratic in chain length. The wiki's per-tier values match: 2x = 700, 3x = 1,425, 5x = 3,625, 10x = 13,500, 15x = 29,625, 28x = 100,800. This is why "a 10x combo gives more points than two 5x combos" (13,500 + accumulation vs 2 × 3,625) and why score play is entirely about one long chain per floor.

- **Combo timer:** kills extend it; **knockdowns reset the timer but don't add to the count**; certain kills (Don Juan door kills, thrown-knife/shuriken kills) refresh the timer without incrementing the combo ([Scoring wiki](https://hotlinemiami.fandom.com/wiki/Scoring)). The exact HM1 window was never published; *(community approx.)* estimates cluster around **2–4 seconds** per kill. HM2 shipped a **longer base window** than HM1, Hard Mode lengthens it "by a lot", and the **Zack mask** lengthens it further in both games ([Zack Mask wiki](https://hotlinemiami.fandom.com/wiki/Zack_Mask)).
- HM2 restricted extension to **lethal kills only** — door bashes, punches, and non-lethal throws no longer extend the chain ([Steam discussion](https://steamcommunity.com/app/274170/discussions/0/617330227196045088/)) — widely considered a feel regression worth learning from.

### Time bonus (HM1, decompiled)

```
timebonus = floor((18000 - global.time) * 0.5)   // global.time in 60Hz ticks
```

Starts at **9,000 points, decays 30 points/second, hits 0 at 300 seconds** — a gentle slope: speed matters, but one A+ combo (~13k at 10x) outweighs the entire time bonus. Time keeps ticking during the walk back to your car after the last kill.

### Mobility (HM1, decompiled)

Per kill: `floor(point_distance(medianx, mediany, killx, killy)) * 2` — twice the distance (in pixels/units) between the player's median position and the kill location. Standing in one doorway and funneling everyone to you is the anti-Mobility strategy; the metric pays roaming.

### Kill values (HM1, n = number of alerted/witnessing enemies)

From the [Points wiki](https://hotlinemiami.fandom.com/wiki/Points):

| Action | Points |
|---|---|
| Melee kill, unalerted target | 200 + 100·n |
| Melee kill, alerted target | 400 + 200·n |
| Gun kill | 180 + 180·n |
| Sharp thrown kill (unarmed target) | 300 + 300·n |
| Sharp thrown kill (armed target) | 800 + 800·n |
| Blunt thrown (brick/hammer) kill | 1,800 + 500·n |
| Door slam knockdown | 480 + 300·n |
| First melee knockdown | 600 + 400·n |
| Unarmed ground execution / throat rip | 600 + 400·n |
| Armed ground execution | 1,000 + 400·n |
| Mercy kill (crawling enemy) | 1,200 + 400·n |
| Don Juan door wall-kill | 2,200 |
| Thug kill | 790 |

Note the systematic asymmetry: **melee pays more when seen, guns pay more when unseen** (unalerted gun kills score above alerted ones) — the score gently pushes melee toward brawls and guns toward ambush, i.e. toward *interesting* usage of each. The witness multiplier (**"Exposure"**) makes performing kills in front of a crowd the single biggest Boldness source.

HM2 flattened kills to static values: **1,000 execution / 800 melee / 600 gun / 500 nail gun / 400 flamethrower**.

### Other hard numbers

- **Grades (HM1):** level max score × k/15; C− = 6/15, A+ = 14/15. **HM2 S-grade ≈ 2.6× the C score.**
- **Energy points:** player/enemies spawn with **0–2 EP random**; non-Magnum guns deal 1/tracer, Magnum 2; executions restore EP ([Energy Points](https://hotlinemiami.fandom.com/wiki/Energy_Points)).
- **Thug (Heavy) health:** starts with **120 blood**; dies at blood < 0 **or after 7 bullet hits**; bleed-out rate `BloodLoss = (1 + Hits) * 0.25` per tick with tick interval shrinking as hits accumulate — i.e., each additional bullet accelerates bleed-out multiplicatively.
- **Knockdown duration:** "a few seconds" (never published exactly; *(community approx.)* ~3s).
- **Close-range gunman aim time:** "about a second" (dev-stated, [Dennaton blog](http://dennaton.blogspot.com/2012/11/hotline-miami-ai.html)).
- **Hard Mode gun pickup penalty (HM2):** ammo × **0.65** rounded down, on every pickup including your own throws.
- **HM2 execution animation length:** ~0.5–2 s depending on weapon *(community approx.)*.

---

## 7. Lessons for Pinball Knight

Ordered roughly by expected impact.

### 7.1 Momentum is your thrown weapon — build the knockdown economy on it
HM's deepest system is that *any blunt impact* (thrown gun, door, fist) produces a downed enemy who can be executed for bonus points **and restored health**. Pinball Knight already has the impact source HM had to fake with thrown bottles: **the knight's own body at speed**. Concrete mapping:
- Define a **knockdown speed threshold**: colliding with an enemy above speed X knocks them into a `starfished` state (HM's flat-on-back); clipping them below X or shoulder-checking them into a wall gives `slumped` (shorter stun, still executable). Two stun states, like HM, is enough — more is noise.
- Give knockdowns a **visible few-second timeout** after which the enemy gets up *changed* (HM: goes looking for a weapon; PK: enraged, or repositioned) so the stun is an action deadline, not a freebie.
- **Ground executions** (walk up to a downed enemy at low speed + press interact, or simply run them over a second time) should pay the HM triple dividend: bonus score, a resource refund (mana/HP/cooldown tick, mirroring HM's EP restore), and a vulnerability window while executing. That last part matters: HM executions being interruptible is what keeps them a decision instead of a ritual.

### 7.2 One-hit is really 2HP with an invisible mercy roll — steal the Energy Points trick
HM feels like one-hit-kill but secretly gives the player 0–2 random energy points, guns do 1 damage each, and executions heal. If Pinball Knight ever wants a "hardcore" floor modifier or a glass-cannon build, copy this exactly: advertise one-hit, implement 2HP with aggression-based healing. Players consistently perceive it as fair one-hit-kill while surviving ~one mistake. Also steal the **asymmetric exceptions** (Magnum does 2, Heavies ignore melee, Dodgers ignore projectiles): a couple of hard counters per enemy roster creates weapon-choice puzzles without any damage-number tuning. PK's 22 enemy families could each pick one immunity/vulnerability from a small shared vocabulary (immune-to-bounce-damage / only-killable-at-speed / dodges-ranged, etc.).

### 7.3 Doors and interactive tiles: make maze furniture a weapon with a score line
HM's door is the model interactive tile: it blocks sightlines when closed, is opened by movement *or projectiles*, knocks down anyone it hits, and has a named score event ("Door Slam") plus a build-around modifier (Don Juan = lethal doors). For PK's proc-gen mazes:
- Swinging doors on maze edges that the knight can **blast through at speed**, slamming enemies on the far side into knockdown — the pinball equivalent of HM's door-breach opener. A door the knight has just smashed open should also **block or deflect enemy projectiles** briefly.
- Give every interactive tile family its own score accolade (Door Slam / Booster Kill / Ice-Slide Kill) and let **one card or meta-perk upgrade one tile type to lethal** (Don Juan pattern). This is a proven build-archetype generator: HM players specialized entire routes around lethal doors.
- HM's glass is the sibling lesson for PK walls: a wall type that **passes projectiles/sight but blocks movement** (portcullis, arrow-slit, broken railing) turns maze topology into ranged-combat routing, and HM demonstrates it should be used sparingly — glass-heavy floors were the series' most hated-hard.

### 7.4 Combo scoring on bounce chains: use the quadratic + decaying timer, and let *impacts* refresh it
Adopt HM1's structure wholesale, since it's decompiled and proven: per-chain-kill increment `a·N² + b·N` (HM: a=125, b=100), a short per-kill timer (~2–4s equivalent; tune to PK's traversal speed), and quadratic growth so one 10-chain beats two 5-chains. Two HM-specific refinements matter for PK:
- **HM1 let non-kill impacts (knockdowns, door slams) refresh the timer without incrementing the count; HM2 removed that and players hated it.** For PK: wall bounces, booster hits, and knockdowns should *sustain* the chain timer (they're the traversal glue between kills) while only kills *grow* it. This makes long banked shots across the maze combo-viable.
- Sell timer extension as build content: HM's Zack mask ("Longer Combo Window") was one of its most-used masks. A PK card/perk that extends the bounce-chain window is a guaranteed pick-rate hit.
- Add HM's **witness multiplier**: kills scored while other enemies have line of sight pay `+k per watcher`. In a maze this directly rewards diving into rooms rather than doorway-cheesing, and it needs no new systems — just the aggro list you already have.

### 7.5 Restart speed is a mechanic, not QoL — and checkpoint at the floor
HM's single most-copied lesson: death → R → replaying within a fraction of a second, music never stops, no score-screen or dialog on the death path. For PK this argues for: instant respawn at the **floor entrance** (HM checkpoints per floor of a level — exactly PK's dungeon-floor structure) for run modes where death isn't permadeath; zero-friction "restart floor" binding for score/challenge modes; and keeping the audio layer running across deaths. Given PK's fixed 60Hz sim, the technical requirement is that a floor reset is a state-reinit, not a scene reload. HM proves players will accept extreme lethality *only* at this iteration speed — the two must ship together.

### 7.6 AI: buy speed with dumbness, and scale difficulty with awareness, not intellect
HM ran dozens of 60Hz agents on three states (default/fire/pursue), patrols that just turn 90° left at obstacles, and distance-scaled reaction time (~1s at close range). For PK's momentum game the transferable rules: give ranged enemies a **dev-tuned aim delay that shrinks with distance** so a fast knight closing the gap gets HM's "inside their reaction window" thrill; let alerted enemies pursue only to **last-known-position** so bounce-routing around corners genuinely sheds aggro; and make PK's Hard-equivalents raise *awareness radius and turn speed*, never add new behaviors (HM2 Hard Mode's approach). Also consider HM's boldest choice — **no alert-state telegraphing** — at least for elite enemies: not knowing if a monster is a patroller or a sleeper is cheap, deep difficulty.

### 7.7 Tax caution through score, never forbid it
HM lets you plan forever but bleeds Time Bonus (30 pts/sec), pays Mobility per-kill by distance traveled, and pays Flexibility for weapon variety. PK should tax camping the same way: time-decay on floor score, distance-weighted kill bonuses (trivial to compute from the physics state), and a variety bonus across cards/abilities used. HM shows the weights matter: its time bonus (9k max) is deliberately smaller than one good combo (~13k+), so speed never outranks stylish chaining. Keep PK's bounce-chain combo as the top of the score hierarchy for the same reason.

### 7.8 Playstyle titles close the loop
HM's end-screen titles (Door Man, Executioner, Combo Master, Invisible Man…) are a priority-ordered switch over action counters — an afternoon of work — yet they teach the scoring vocabulary and give players an identity to chase. With PK's card/build system, per-floor titles derived from action counts (Bumper Baron, Wallbreaker, Untouchable) would double as soft tutorialization of which verbs the score system rewards.

---

## Primary sources

- [Dennaton dev blog — Hotline Miami AI](http://dennaton.blogspot.com/2012/11/hotline-miami-ai.html) (first-party AI design)
- [PC Gamer — Dennaton interview](https://www.pcgamer.com/hotline-miami-interview-dennaton-games-on-creating-carnage-to-delight-and-disgust/) · [80.lv — creators discuss design](https://80.lv/articles/hotline-miami-creators-discussed-its-design-past-and-future) · [GameMaker 10-year anniversary interview](https://www.youtube.com/watch?v=P7TCjSAHKjQ)
- [Wikipedia — Hotline Miami](https://en.wikipedia.org/wiki/Hotline_Miami) (development history, critical reception)
- Hotline Miami Wiki (community, decompile-informed): [Scoring](https://hotlinemiami.fandom.com/wiki/Scoring) · [Points](https://hotlinemiami.fandom.com/wiki/Points) · [Execution](https://hotlinemiami.fandom.com/wiki/Execution) · [Weapons](https://hotlinemiami.fandom.com/wiki/Weapons) · [Energy Points](https://hotlinemiami.fandom.com/wiki/Energy_Points) · [Door](https://hotlinemiami.fandom.com/wiki/Door) · [Glass](https://hotlinemiami.fandom.com/wiki/Glass) · [Enemy Behaviour](https://hotlinemiami.fandom.com/wiki/Enemy_Behaviour) · [Hard Mode](https://hotlinemiami.fandom.com/wiki/Hard_Mode) · [Zack Mask](https://hotlinemiami.fandom.com/wiki/Zack_Mask) · [Dodger](https://hotlinemiami.fandom.com/wiki/Dodger)
- Community: [Steam — HM1 scoring breakdown](https://steamcommunity.com/app/219150/discussions/0/846961716267860830/) · [Steam — HM2 combo changes](https://steamcommunity.com/app/274170/discussions/0/617330227196045088/) · [ZTGD review (checkpoints/restart)](https://ztgd.com/reviews/hotline-miami/) · [Horror Obsessive retrospective](https://horrorobsessive.com/2022/10/23/hotline-miami-turns-ten/)
