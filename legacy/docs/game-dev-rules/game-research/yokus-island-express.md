# Yoku's Island Express — Pinball as Traversal in a Connected World

**Game:** Yoku's Island Express (Villa Gorilla, published by Team17, May 2018 — PC/Switch/PS4/XB1)
**Why it is in the research set:** Yoku's Island Express is the closest published relative to Pinball Knight's core bet — pinball physics lifted out of the cabinet and used as the *primary means of moving through a designed, explorable world*. Villa Gorilla spent roughly five years solving exactly the problems Pinball Knight faces: how to embed flippers, bumpers, rails and chutes into open terrain instead of a bounded table; how to stitch dozens of "tables" into one seamless metroidvania map; how to keep a physics-launched avatar readable and fair; and — most importantly — how to remove pinball's defining punishment (the drain) so that physics that occasionally betrays the player never feels like theft. The game won the [BAFTA for Debut Game](https://en.wikipedia.org/wiki/Yoku%27s_Island_Express) and is broadly credited by critics with making a "playful, natural" hybrid out of two genres that should not fit together. Every one of its solutions maps onto a live design question in Pinball Knight.

Primary sources: the [Game Developer (Gamasutra) level-design deep dive with lead designer Linus Larsson](https://www.gamedeveloper.com/design/combining-pinball-with-platforming-to-build-the-levels-of-i-yoku-s-island-express-i-), the [PCGamesInsider interview with co-founder Jens Andersson](https://www.pcgamesinsider.biz/indie-interview/66425/getting-physical-why-villa-gorillas-debut-game-is-the-open-world-pinball-title-yokus-island-express/), two interviews with art director/co-founder Mattias Snygg ([3WIREL, 2017](https://3wirel.com/2017/04/08/interview-with-mattias-snygg-villa-gorilla-on-yokus-island-express/) and [The Ball is Wild](https://theballiswild.net/inside-yoku/)), plus design-focused reviews ([Hardcore Gaming 101](https://www.hardcoregaming101.net/yokus-island-express/), [Entertainium](https://entertainium.co/2018/06/29/pinball-and-platforming-make-a-fantastic-pairing-in-yokus-island-express/), [Wikipedia's development history](https://en.wikipedia.org/wiki/Yoku%27s_Island_Express)). No GDC talk by Villa Gorilla appears to exist; where a claim comes from community analysis rather than the developers, it is marked as such.

---

## 1. The core design problem: making two flipper buttons traverse a world

### The false start: modes

Villa Gorilla (founded Stockholm 2013 by Jens Andersson, ex-Starbreeze programmer, and Mattias Snygg, ex-Starbreeze art director) started from a production constraint, not a design thesis: they had no animator, so they decided to ["make a game about a ball"](https://en.wikipedia.org/wiki/Yoku%27s_Island_Express). Pinball followed naturally. Their first architecture was the obvious one — and it failed:

- **Two separate modes.** A "Flipper Mode" (you control the ball and flippers, classic pinball) and an "Adventure Mode" (you walk around as Yoku between tables). Per [Larsson in Game Developer](https://www.gamedeveloper.com/design/combining-pinball-with-platforming-to-build-the-levels-of-i-yoku-s-island-express-i-), this "felt very disconnected" — two games taped together.
- **The fix: simultaneous control.** "We decided the player should be able to control Yoku and the flippers at the same time." One control scheme, always active: stick walks the beetle, two buttons/triggers fire flippers. The avatar (Yoku, a dung beetle) is tied to the ball by a short rope, so the ball is never an abstract projectile — the *character* is the ball, permanently.
- An earlier prototype (*Pinball Stories*) taught them the priority ordering: during playtesting they concluded it must be ["an adventure game with pinball mechanics, rather than a pinball game with adventure elements"](https://en.wikipedia.org/wiki/Yoku%27s_Island_Express) — a decision strong enough that they scrapped a planned iOS release and, per [Snygg](https://theballiswild.net/inside-yoku/), "decided to not show this older version of the game to anyone at all and scrapped it."

The deeper realization, from [Larsson](https://www.gamedeveloper.com/design/combining-pinball-with-platforming-to-build-the-levels-of-i-yoku-s-island-express-i-): playtesters found the game felt most unique not inside the polished pinball tables but in the *transition areas between them*. "Beautiful tables weren't enough to make an interesting game." That observation drove the pivot from "pinball levels plus corridors" to a fully open metroidvania world where pinball furniture is embedded everywhere.

### Flippers as world furniture, color-coded by button

The load-bearing control trick: **every flipper and slingshot in the world is color-coded to the button that fires it** — [yellow = right trigger, blue = left trigger](https://gamefaqs.gamespot.com/pc/206092-yokus-island-express/faqs/75982/basics-and-tips) (left shift / right shift on keyboard). This decouples flipper identity from flipper *position*: a "left-button" flipper can sit anywhere, face any direction, even [shoot you straight up or down](https://theballiswild.net/inside-yoku/) — the player never has to work out which button owns it, they just read the color. All same-colored flippers on screen fire together, which the designers exploit for multi-flipper sequences and which the player experiences as one coherent verb ("blue!") rather than N separate devices.

Consequences worth internalizing:

- **The mapping is global and never changes.** Two buttons, two colors, whole game. The skill ceiling comes entirely from timing, aim and layout — never from control complexity.
- **Walking is deliberately weak.** Yoku cannot jump; the ball rolls slowly uphill. Walking exists for fine positioning and low-stakes exploration; all *meaningful* traversal goes through pinball physics. This forces the designers to route everything interesting through the physics — there is no "just walk around it" escape hatch, so the physics layer never atrophies into a gimmick. (Snygg: players accepted no-jump because ["you don't really know what to expect from the game when you start off"](https://theballiswild.net/inside-yoku/) — a new hybrid gets to set its own contract.)
- **Trust is the currency.** Snygg, in [3WIREL](https://3wirel.com/2017/04/08/interview-with-mattias-snygg-villa-gorilla-on-yokus-island-express/): a critical discovery was building player trust so they wouldn't "hesitate to throw yourself off a cliff in fear of being punished." A traversal-physics game only works if players *commit* to launches; anything that punishes commitment teaches hesitation, and hesitation kills a momentum game.

### What replaces the drain

Classic pinball's failure loop — ball drains between the flippers, you lose a life — is structurally incompatible with traversal (you can't "lose" your own body). Yoku's replacement, assembled from [Game Developer](https://www.gamedeveloper.com/design/combining-pinball-with-platforming-to-build-the-levels-of-i-yoku-s-island-express-i-), [HG101](https://www.hardcoregaming101.net/yokus-island-express/) and reviews:

1. **Drains become thorn/spike gutters.** The "out lane" at the bottom of a challenge area is lined with thorns. Falling in doesn't kill you — it knocks a few fruit (currency) out of you and pops you back onto the playfield, usually right at the flippers.
2. **Scores, combos, lives and timers were deleted wholesale.** Larsson: the team stripped traditional pinball mechanics and replaced them with exploration rewards — fruit went from being "score" to ["currency that could interact with our gameworld"](https://www.gamedeveloper.com/design/combining-pinball-with-platforming-to-build-the-levels-of-i-yoku-s-island-express-i-).
3. **Completion is permanent.** Per [HG101](https://www.hardcoregaming101.net/yokus-island-express/): "all of your completed boards stay completed" — unlike *Kirby's Pinball Land* or *Sonic Spinball*, failure never re-locks solved content. You can only ever lose seconds and pocket change, never progress.

---

## 2. World and level design for momentum

### Tables stitched into a map

The island is one seamless 2D space, but it is authored as **dozens of discrete pinball "tables" connected by traversal corridors, rails and one-way pipes**. Design rules the team documented in the [Game Developer piece](https://www.gamedeveloper.com/design/combining-pinball-with-platforming-to-build-the-levels-of-i-yoku-s-island-express-i-):

- **One screen = one solvable problem.** "Pinball is fast-paced and full of random movement," so a challenge whose solution lives several screens away is unreadable at ball speed. Each table's goal, targets and hazards are contained within roughly one screen; multi-screen structure exists only *between* tables, at walking pace or on rails.
- **Tables went horizontal.** Real pinball is portrait-oriented; the game runs in widescreen, so tables were laid out "more horizontal than vertical" to keep the whole problem on screen. Layout followed the display, not the cabinet.
- **Hook-shaped recirculation.** Levels feature "flippers at the bottom and hook-shaped paths designed to bring the player back to the zone with ease" — i.e., every launch trajectory that *misses* is curved back toward the flippers. The pinball cabinet's implicit guarantee (the ball always returns to the flippers) is rebuilt in open terrain with geometry. Missed shots recirculate; they don't strand you.
- **Exits as skill shots.** A table's exits are specific lanes/holes; hitting the right one is the "shot." Optional exits and [tunnels "give you a choice whether or not to switch to a different area"](https://theballiswild.net/inside-yoku/) — table exits double as map topology.

### One-way flow, rails as roads, and backtracking

- **One-way valves are everywhere.** Pipes, drop-downs and long launch lines let designers make forward progress fast and irreversible-in-one-direction, then supply a separate cheap return path. Community analyses widely note the world is a directed graph at ball speed and an undirected one at walking speed (community observation, not developer-stated).
- **The Beeline** is the fast-travel system: an unlockable, fruit-purchased network that ["flings you across multiple stops... through elaborate shortcuts and bounces reminiscent of a Rube Goldberg machine"](https://www.hardcoregaming101.net/yokus-island-express/). Two things matter: (a) fast travel is itself *diegetic pinball* — you watch yourself ricochet along rails through the world, which maintains spatial knowledge instead of teleport-erasing it; (b) it unlocks too late, which reviewers consistently flagged.
- **The honest failure to copy:** backtracking was the game's single most-criticized element. [Wikipedia's reception summary](https://en.wikipedia.org/wiki/Yoku%27s_Island_Express) collects it: retreading completed tables was "tedious," and Nintendo Life said route-finding "can feel like groping around in the dark." Re-traversing a pinball table in the *unintended direction* is slow and fumbly, because every table is tuned for one flow direction. The map screen also under-served a physics world — it showed rooms, not flows.

### Readability at ball speed

(Largely community-derived analysis; the developers' own statements are the screen-containment and color-coding rules above.)

- **Color is reserved for interaction.** Snygg's hand-painted world is deliberately soft and low-saturation, treating the whole island as ["a huge unique texture"](https://3wirel.com/2017/04/08/interview-with-mattias-snygg-villa-gorilla-on-yokus-island-express/); saturated blue/yellow is *reserved* for flippers and slingshots, and collectibles glow. Interactive furniture pops because the palette budget was spent on it.
- **The camera leads the launch.** The camera is loosely coupled with generous lookahead on launches and locks onto the active table region while a challenge is in progress, so the flippers rarely leave the screen while you're using them (community observation from reviews/footage).
- **Rails and chutes telegraph themselves.** Launch lines are drawn as visible tracks in the terrain before you ride them — you can read a route like a road. This is what makes ball-speed traversal *plannable* rather than reactive.

---

## 3. The failure-cost philosophy

This is the game's most-praised design decision, and it is explicit, not accidental.

- **There is no death, no lives, no game over, no fail state.** The only penalty in the entire game is dropping a few fruit when you hit thorns/drains — and fruit is abundant and instantly recollectable. [Entertainium](https://entertainium.co/2018/06/29/pinball-and-platforming-make-a-fantastic-pairing-in-yokus-island-express/) and [Critical Hit](https://www.criticalhit.net/review/yokus-island-express/) both single this out as the mechanism that "removes one of the most frustrating things about pinball."
- **Why it is essential:** in a physics game the player is not fully in control of outcomes — a bounce can genuinely betray you. Punishing hard for outcomes the player only partially controls reads as unfairness, and unfair punishment teaches players to stop committing to launches (Snygg's cliff-trust point again). Villa Gorilla's answer was to make the *retry loop* the punishment: fail a shot, you're back at the flippers in ~2 seconds, minus pocket change. One reviewer compared it to Rayman Origins' philosophy of "letting the player try again as quickly as possible after a mistake" ([GameFAQs review](https://gamefaqs.gamespot.com/switch/206157-yokus-island-express/reviews/178778)).
- **Retry proximity is the real mechanic.** The hook-shaped recirculation geometry (§2) means failure *physically returns you to the attempt point*. Low penalty + zero walk-back = players attempt hard shots dozens of times without resentment. The difficulty of pinball is fully preserved — you still miss shots constantly — but the cost per miss approaches zero.
- **Where challenge actually lives** (since it can't live in survival):
  - **Skill-shot scarabs:** scarab beetles sit "towards the outside" of many tables and require completing "some form of skill challenge a number of times" for bonus fruit ([GameFAQs 100% guide](https://gamefaqs.gamespot.com/pc/206092-yokus-island-express/faqs/75982/100-completion)) — repeated precision shots, purely optional.
  - **Collectible hunts:** 80 Wickerlings (many needing a Noisemaker blast to reveal), 30 mailboxes, 10 wallet upgrades, treasure maps purchasable with fruit that mark chest locations ([HG101](https://www.hardcoregaming101.net/yokus-island-express/)).
  - **Hard optional shots gate secrets**, not progress: bonus areas hide behind low-percentage trajectories the mainline never requires.
  - **Post-launch, a Randomize mode (2021)** reshuffled the order of all unlocks over the same world, with Normal/Hard/Very Hard seeds — enough replayable depth that it has [its own speedrun.com board](https://www.speedrun.com/yier) ([Steam announcement](https://store.steampowered.com/news/app/334940/view/2985312084708594024)).
- **The cost of going too soft:** some players found the mainline *too* frictionless — a [Medium critique](https://shieldgenerator7.medium.com/yokus-island-express-is-great-terrible-at-the-same-time-a160cc55a4a) argues the near-zero stakes flatten tension for players who want mastery pressure. Yoku had no combat to absorb that pressure; an ARPG does.

---

## 4. Physics tuning

Documented directly by Snygg ([The Ball is Wild](https://theballiswild.net/inside-yoku/), [3WIREL](https://3wirel.com/2017/04/08/interview-with-mattias-snygg-villa-gorilla-on-yokus-island-express/)):

- **Custom engine, custom 2D physics.** Villa Gorilla built a proprietary engine ("Underware") with its own 2D physics rather than adopting a stock engine — pinball feel was too central to delegate.
- **The tuned parameter set:** "We tweaked around a lot with **the gravity of the world, the friction on different surfaces, how much spin the ball should retain**." Note *per-surface friction* — Yoku already had material-differentiated surfaces, the same axis Pinball Knight's rubber/ice/mud/brass system explores.
- **The critical rule — freeze physics before mass-producing levels:** "if you keep tweaking those parameters, the older areas of the game world that you already built maybe won't work anymore." Every authored table encodes trajectory assumptions; a global gravity or restitution change silently breaks every previously-tuned shot in the world. They settled parameters early and then treated them as immutable.
- **Determinism as feel, not tech:** there is no public statement about fixed timesteps or determinism guarantees, but the design implies shot repeatability — scarab challenges require repeating the same shot several times, which is only fair if identical inputs give near-identical trajectories. (Community inference, not developer-stated.)
- **Fairness furniture:** bumpers and slingshots are placed to *add* energy on the player's behalf and to recirculate the ball toward flippers, not to randomize it into hazards. Compared to real pinball, the game is light on chaotic elements (pop-bumper clusters) in mandatory paths — chaos is decoration or bonus-fruit territory, and mandatory paths are dominated by deterministic furniture: flippers, rails, chutes, one-way pipes. (Community observation from reviews/footage.)
- **Iteration discipline:** "properly fine looking and working levels were scrapped because they weren't fun enough" — layout iteration happened *within* frozen physics, and fun-of-shot outranked sunk art cost.

---

## 5. Progression: abilities as traversal unlocks

Classic metroidvania hard gates, all expressed through the ball ([HG101](https://www.hardcoregaming101.net/yokus-island-express/), [Wikipedia](https://en.wikipedia.org/wiki/Yoku%27s_Island_Express)):

| Unlock | What it gates |
|---|---|
| **Slug Vacuum** | Suck up explosive slugs; use them to blast rocks, clear blocked paths, and *self-boost* into areas no flipper reaches — a portable impulse source |
| **Noisemaker (party horn)** | Reveals hidden Wickerlings and triggers world reactions — an "interrogate the environment" verb, gates collectibles more than paths |
| **Dive Fish** | Underwater traversal — an entire hidden layer of the map opens; classic region-scale hard gate |
| **Sootling Leash** | Grapple onto flower anchor points with full 360° swings — converts stored momentum into direction changes mid-air |
| **Beeline access** | Fast travel network, bought per-node with fruit |
| **Paid flippers/paths** | Some flippers and route-openings are *purchased with fruit* on the spot — economy converts optional skill-shot income into traversal infrastructure |

Two gating currencies coexist cleanly:

- **Hard gates** are binary item checks (no dive fish → no underwater region), used for region-scale pacing, exactly as in any metroidvania.
- **Soft gates are physics skill.** Many chests, scarabs and Wickerlings are reachable from the moment you can see them — *if* you can hit a hard shot. The Randomize mode and speedrun community demonstrate how much of the world is actually skill-gated rather than item-gated: runners route around intended order using precise shots (community-derived). Soft gates give skilled players texture without blocking anyone.
- Fruit sits between the two: it is earned by skill (scarabs, drains avoided, exploration) and spent on hard infrastructure (beeline nodes, flippers, treasure maps), letting skill *purchase* convenience.

---

## 6. Lessons for Pinball Knight

Pinball Knight already goes beyond Yoku on several axes (combat, co-op, procedural floors, per-tile materials). Yoku's lessons are about the traversal contract.

### 6.1 Embedding flipper/booster furniture into maze geometry

- **Bind furniture to inputs by color, not by position.** Yoku's single best trick. If Pinball Knight ever adds player-triggered flippers/kickers (as opposed to passive boosters), give every triggerable device a global two-tone color code bound to two buttons, and *never* vary the mapping per room. Procedural generation makes this even more important than in Yoku: in generated rooms the player can't memorize layouts, so device→input identity must be instantly readable from color alone.
- **Spend the palette on the furniture.** Keep 16-bit dungeon tiles low-saturation and reserve the two signal colors + emissives for interactive pinball furniture (boosters, flippers, arc rails, launch chutes). Rule of thumb from Yoku: if a screenshot is greyscaled, the interactive furniture should be the brightest survivors.
- **One screen, one problem.** The track-first generator should ensure any *shot* (booster chain, arc entry, chute alignment) is fully visible within one camera frame at the point where the player commits to it. Multi-room structure belongs to the maze graph; single-room structure belongs to the physics puzzle. Never require the player to aim at something off-screen at ball speed.
- **Generate hook-shaped recirculation around skill shots.** Where the generator places a demanding shot (booster gauntlet, arc jump), it should also place return geometry that funnels *misses* back to the attempt point — Yoku's "flippers at the bottom, hook-shaped paths back" rule as a generator post-pass. A missed shot that dumps the knight three rooms back is a walk-back penalty in disguise.

### 6.2 Drain-free failure for a momentum ARPG

- **Yoku's equation: penalty ≈ pocket change + ~2 seconds; retry point = the flipper you just missed from.** Pinball Knight has corpse-runs (death → run back to loot your corpse). That is a *combat* death penalty and can stay — but keep it strictly for combat. **Physics must never kill or corpse-run the player.** A bad bounce into spikes should cost gold/fragments scattered on the spot (instantly re-collectable, Yoku-style), never HP-to-zero into a corpse-run. If a betrayed bounce can trigger the ARPG death penalty, players will stop committing to launches — and hesitation is fatal to a momentum game (Snygg's cliff-trust principle).
- **Practical split:** enemy damage → HP → corpse-run; environmental pinball hazards (drain pits, spike gutters) → currency knock-out + eject back onto the playfield near the entry flipper/booster. Keep the two ledgers visibly separate so players learn "physics is safe to gamble on; monsters are not."
- **Preserve completion.** Yoku's "completed boards stay completed": cleared rooms, opened chutes and unlocked one-way valves should never re-lock on death within a floor. Losing progress *twice* (corpse + re-locked geometry) is the compound punishment Yoku existed to avoid.
- **Put mastery pressure in optional shots.** Yoku's scarabs = repeat a precision shot N times for bonus currency. Pinball Knight equivalent: optional skill-shot shrines per floor (thread the arc backwards, chain three boosters without touching ground) paying out cards/fruit-equivalent — challenge for those who want it, invisible tax on nobody. This also answers the Medium critique: an ARPG's combat already supplies stakes, so traversal can afford to be Yoku-soft.

### 6.3 One-way flow and rail roads for the track-first generator

- **The track IS the beeline.** Yoku bolted fast travel on late and got dinged for it; Pinball Knight's track-first generation can bake it in from floor one. Treat the grown pinball circuit as the floor's *highway*: high-speed, low-friction, largely hazard-free once entered, with maze rooms as side streets. Backtracking across a cleared floor should mean "get on the track," and riding it should be a diegetic Rube-Goldberg joyride, not a teleport — Yoku proved players love watching the transit and it preserves their mental map.
- **Direction-tag the circuit.** Yoku's worst reviews were about re-traversal against the intended flow. The generator should explicitly mark each track segment's cheap direction and guarantee a cheap *counter-flow* path (a parallel walking corridor, a return chute, or a reversing booster unlocked after first clear). Test floor graphs for "cost to return to entrance from anywhere" the way Yoku never did.
- **One-way valves are pacing tools, not traps.** Launch chutes (already sealed via TrackMask) are one-way valves; use them to make *forward* progress feel irreversible and exciting, but every one-way drop needs a discoverable return loop within a couple of rooms, or co-op partners get separated with no fix.
- **Exits as shots.** Yoku made moving *between* areas itself a skill shot (choose the exit lane). In generated rooms, room-exit chutes with alternate lanes (easy lane → corridor; hard lane → shortcut/secret) turn plain doorways into pinball decisions for free.

### 6.4 Readability when the avatar moves at ball speed

- **Contain, telegraph, lead.** The three Yoku camera/readability rules: (1) challenge fits the screen at commit time; (2) rails/chutes are drawn as visible roads *before* you ride them — the player should be able to plan a route by reading the track like a map; (3) camera lookahead follows velocity, and during a flipper/booster sequence the camera holds the playfield so the furniture never scrolls off mid-shot. At fixed 60Hz with WebGPU, camera lookahead proportional to velocity is cheap and transformative (community-derived from Yoku analysis, but consistent with every high-speed 2D game).
- **Freeze the physics constants, then generate.** Snygg's hardest-won lesson maps directly onto procedural generation: gravity/restitution/friction-per-material (rubber/ice/mud/brass) and booster/flipper impulse are *the level format*. Every generated floor encodes trajectory assumptions about them. Lock them behind a versioned config; any change invalidates the generator's tuning corpus and every seeded playtest. Yoku froze constants to protect hand-built tables; Pinball Knight must freeze them to protect the *generator's* implicit tables — and the fixed 60Hz timestep already gives the repeatability Yoku could only imply.
- **Chaos is optional-content seasoning.** Yoku kept randomizing furniture (pop-bumper clusters) out of mandatory paths; mandatory routes ran on deterministic furniture (flippers, rails, chutes). Generator rule: the critical path through a floor uses deterministic impulse furniture; bumper-chaos fields go in treasure rooms and arenas where a wild bounce is fun, not route-breaking.
- **Yoku's Randomize mode is the closing argument:** a hand-built pinball world tolerated full unlock-order randomization well enough to sustain a speedrun community — evidence that pinball traversal and procedural remixing are compatible, provided the physics contract and the input contract (two buttons, two colors) never change underneath the player.

---

### Sources

- [Combining pinball with platforming to build the levels of Yoku's Island Express — Game Developer (Linus Larsson)](https://www.gamedeveloper.com/design/combining-pinball-with-platforming-to-build-the-levels-of-i-yoku-s-island-express-i-)
- [Getting physical: Villa Gorilla interview — PCGamesInsider (Jens Andersson)](https://www.pcgamesinsider.biz/indie-interview/66425/getting-physical-why-villa-gorillas-debut-game-is-the-open-world-pinball-title-yokus-island-express/)
- [Interview with Mattias Snygg — 3WIREL (2017)](https://3wirel.com/2017/04/08/interview-with-mattias-snygg-villa-gorilla-on-yokus-island-express/)
- [Inside Yoku: Interview with Mattias Snygg — The Ball is Wild](https://theballiswild.net/inside-yoku/)
- [Yoku's Island Express — Wikipedia (development, reception)](https://en.wikipedia.org/wiki/Yoku%27s_Island_Express)
- [Yoku's Island Express — Hardcore Gaming 101](https://www.hardcoregaming101.net/yokus-island-express/)
- [Pinball and platforming make a fantastic pairing — Entertainium](https://entertainium.co/2018/06/29/pinball-and-platforming-make-a-fantastic-pairing-in-yokus-island-express/)
- [Yoku's Island Express review — Critical Hit](https://www.criticalhit.net/review/yokus-island-express/)
- [Basics and Tips / 100% Completion — GameFAQs guide (flipper color coding, scarabs, collectibles)](https://gamefaqs.gamespot.com/pc/206092-yokus-island-express/faqs/75982/basics-and-tips)
- [Yoku's Island Express review (Rayman Origins comparison) — GameFAQs](https://gamefaqs.gamespot.com/switch/206157-yokus-island-express/reviews/178778)
- [Yoku's Island Express is Great & Terrible at the Same Time — Medium critique](https://shieldgenerator7.medium.com/yokus-island-express-is-great-terrible-at-the-same-time-a160cc55a4a)
- [Randomize mode announcement — Steam News](https://store.steampowered.com/news/app/334940/view/2985312084708594024) · [Randomizer leaderboard — speedrun.com](https://www.speedrun.com/yier)
- [Merges delightful pinball platforming with metroidvania — TheSixthAxis preview](https://www.thesixthaxis.com/2018/05/01/yokus-island-express-merges-delightful-pinball-platforming-with-metroidvania/)
