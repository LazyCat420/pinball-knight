# Doom — Speed as the Core Verb, Legibility as Law, and the Engineered Frame

**Why this game is in the research set.** Doom is the closest thing game development has to a
complete syllabus in one package: classic Doom (1993) and Doom II are the canonical texts on
making *movement itself* the fun (the player is one of the fastest things in the game), on level
design rules that are still quoted verbatim thirty years later (Romero's contrast/landmark/flow
rules), on building an enemy roster as a legible speed × HP × attack-pattern matrix with an
emergent system (infighting) layered on top, and on performance engineering under brutal
constraints (BSP precomputation, zero-overdraw wall rendering, fixed-point math, hard per-frame
budgets). Doom (2016) then adds the missing modern chapter: how to build a resource economy that
*pulls* an already-fast player toward danger instead of away from it. Pinball Knight is a
momentum-physics ARPG on a fixed 60 Hz timestep with a WebGPU renderer whose stalls come from
pipeline count — nearly every one of these lessons maps directly.

---

## 1. Classic Doom's core loop and pacing — movement speed as the core verb

### The numbers

Classic Doom runs its simulation at **35 tics per second** (half the 70 Hz VGA refresh), and the
player's movement values are documented on the Doom Wiki's
[Player](https://doomwiki.org/wiki/Player) page:

| Mode | Input base | Speed |
|---|---|---|
| Walk forward | 25 | 8.33 map units/tic ≈ **291.66 mu/s** |
| Run forward | 50 | 16.67 map units/tic ≈ **583.33 mu/s** |
| SR40 (run + strafe-40) | 50 fwd + 40 strafe | vector length 64 ≈ **128 % of run**, ~747 mu/s |
| SR50 (run + strafe-50) | 50 fwd + 50 strafe | vector length 70.7 ≈ **141 % of run**, ~824.94 mu/s |

The player's collision radius is 16 map units, so at full run Doomguy covers roughly **18 body
widths per second** — for scale, that's a 32-unit-wide actor crossing a typical 256-unit room in
under half a second. Monsters' *walk* speeds top out around 15–16 units per movement step; only
projectiles are meaningfully faster than the player.

**Straferunning** ([Straferunning](https://doomwiki.org/wiki/Straferunning)) exists because the
engine caps forward and sideways momentum *separately* (forward ≤ 50, strafe ≤ 50) and never
normalizes the combined vector. SR40 = √(40² + 50²) = 64 at 38.7° off forward; SR50 = √(50² + 50²)
= 70.7 at 45°, and the max running jump gap grows from 181 to 196 map units. What began as an
integration bug became a beloved skill verb: speed had headroom above the "intended" cap, and
mastery of movement — not aim — became the expert ceiling. The community formalized it into named
techniques with tool-assisted variants ([SR-50 automation](https://doomwiki.org/wiki/SR-50_automation)).

### Why fights stay fast

- **No reload, near-instant weapon switch, no sprint toggle in the modern sense** — every verb is
  available every frame. The loop is *move → shoot → move*, never *stop → manage → resume*.
- **Dodgeable projectiles**: most monster attacks are visible fireballs slow enough to sidestep at
  player speed, so incoming damage is a spatial problem you solve by moving, not a stat check.
  Hitscanners (zombies, chaingunners) are the exception and are deliberately fragile (20–70 HP).
- **Momentum and friction**: player movement carries inertia (thrust applied per tic, decayed by
  friction), so movement has a skill texture — circle-strafing is a rhythm, not a strafe-lock.
- **Keys and doors as pacing valves, not stops**: blue/yellow/red key gating turns a level into a
  loop structure — you sweep outward for a key, then flow back through now-familiar space, often
  with new monsters teleported in ("cleared" space is never guaranteed safe). Backtracking at
  583 mu/s takes seconds, so gating adds structure without adding downtime.
- **Secrets as a second scoring layer**: Romero made "several secret areas on every level" a hard
  rule (see §2). Secrets reward players who read walls, textures, and automap shapes — they turn
  the level geometry itself into content, and the end-of-level tally (kills/items/secrets %) makes
  thoroughness a visible score.

The result is pacing where the *player* is the tempo-setter. Doom never takes control of the
camera, never plays a cutscene mid-level, and never makes you slower than the fun speed.

Sources: [Player](https://doomwiki.org/wiki/Player), [Straferunning](https://doomwiki.org/wiki/Straferunning),
[Doom rendering engine](https://doomwiki.org/wiki/Doom_rendering_engine) (35 Hz tic system).

---

## 2. Level design theory — Romero's rules and the E1M1 loop

### Romero's design rules

While building episode 1 (*Knee-Deep in the Dead*), John Romero worked to an explicit rule set he
has restated in interviews and talks for decades (summarized at
[Helldorado's write-up of Romero's tips](https://www.helldoradoteam.com/2018/12/19/john-romeros-level-design-tips/)
and in the [Chubzdoomer video breakdowns](https://archive.org/details/doom-level-design-chubzdoomer_202005-500202)):

1. **Always change floor height when you change floor textures** — material changes are physical,
   not decals; the world reads as constructed, not painted.
2. **Use border/trim textures between different wall segments and at doorways** — seams are
   deliberate, transitions are marked.
3. **Be strict about texture alignment** — sloppy alignment breaks the illusion of place.
4. **Conscious use of contrast everywhere** — light against dark, cramped against open, low
   ceilings against tall ones. Contrast is the pacing tool *inside* a level: E1's bright computer
   rooms dumping into pitch-dark nukage mazes, tight corridors bursting into tall halls.
5. **If the player can see an area (e.g. outside), they should be able to get there** — visible
   space is a promise; teasing reachable space drives exploration.
6. **Several secret areas in every level** — always reward the curious.
7. **Design for flow: the player should revisit areas several times** so they build a mental 3D
   model of the level — interconnection over corridor-chains.
8. **Create easily recognizable landmarks in several places** for navigation — a uniquely shaped
   room, a distinctive light fixture, a view of a landmark through a window.

Community analyses of E1M1 ([soulsphere's "The design of E1M1"](https://soulsphere.org/apocrypha/e1m1/),
[Lee Millington's E1M1 breakdown](https://lajmillington.wordpress.com/2016/02/01/the-design-of-doom-e1m1/))
add the corollaries Romero has voiced in interviews: avoid symmetric rooms (symmetry reads as
artificial and kills navigation-by-landmark), give fights multiple entrances and exits, and let
the player *see* important destinations (the exit, a key, a weapon on a pedestal) before they can
reach them, so the level poses a question the player answers with movement. (These corollaries are
interview/community-derived phrasing rather than a single canonical numbered list — treat the
eight rules above as the documented core.)

### How E1M1-style loops teach the map

E1M1 "Hangar" is a teaching machine ([soulsphere](https://soulsphere.org/apocrypha/e1m1/)):

- The opening room shows a **window onto the zig-zag nukage room** — you see armor on a platform
  you can't reach yet (rule 5: visible = reachable, eventually; also a secret tease).
- The level is a **loop, not a line**: main room → corridor → zig-zag room → exit room, with side
  pockets (the computer room, the secret armor courtyard) hanging off the loop. You pass through
  the main room more than once, from different directions, and it looks different each time —
  that's rule 7 working.
- **Height variation everywhere**: stairs up to the exit, the raised armor platform, the sunken
  nukage. Height differences double as combat design (monsters above/below you) and as landmark
  design.
- The whole thing is **small and dense**. Doom levels front-load their identity in the first ten
  seconds — E1M1 is an "exciting statement of intent," playable in under a minute, mastered over
  dozens of runs.

The general theory: **interconnection converts geometry into knowledge**. A linear map is consumed
once; a looped map with landmarks and contrast is *learned*, and learned space is where movement
mastery (and speedrunning) lives.

Sources: [Helldorado — Romero's tips](https://www.helldoradoteam.com/2018/12/19/john-romeros-level-design-tips/),
[soulsphere — The design of E1M1](https://soulsphere.org/apocrypha/e1m1/),
[Millington — DOOM and the Level Design of John Romero](https://lajmillington.wordpress.com/2016/02/01/the-design-of-doom-e1m1/),
[eev.ee — You should make a Doom level, part 2](https://eev.ee/blog/2015/12/30/you-should-make-a-doom-level-part-2/),
[Doom Wiki — Tips for creating good WADs](https://doomwiki.org/wiki/Tips_for_creating_good_WADs).

---

## 3. Enemy design math — the roster as a rock-paper-scissors matrix

### The stat matrix

HP values from the [Doom Wiki monster pages](https://doomwiki.org/wiki/Monster); pain chance from
[Pain state](https://doomwiki.org/wiki/Pain_state). Speed values are the `speed` field from the
executable's monster info tables (per-monster Doom Wiki pages / DeHackEd documentation) — listed
here as engine-table values, in map units per movement step:

| Monster | HP | Pain chance /255 | Speed | Attack type |
|---|---:|---:|---:|---|
| Zombieman | 20 | 200 (78 %) | 8 | hitscan (1 bullet) |
| Shotgun guy | 30 | 170 (67 %) | 8 | hitscan (3 pellets) |
| Heavy weapon dude (chaingunner) | 70 | 170 (67 %) | 8 | hitscan (sustained) |
| Imp | 60 | 200 (78 %) | 8 | projectile (3–24 dmg) + claw |
| Demon (pinky) / Spectre | 150 | 180 (70 %) | 10 | melee only |
| Lost soul | 100 | 256 (100 %) | 8 (charge much faster) | ramming melee |
| Cacodemon | 400 | 128 (50 %) | 8 (flying) | projectile + bite |
| Hell knight | 500 | 50 (17 %) | 8 | projectile + melee |
| Baron of Hell | 1000 | 50 (17 %) | 8 | projectile + melee |
| Revenant | 300 | 100 (39 %) | 10 | homing projectile + punch |
| Mancubus | 600 | 80 (31 %) | 8 | projectile spread (paired fireballs) |
| Arachnotron | 500 | 128 (50 %) | 12 | rapid plasma projectiles |
| Pain elemental | 400 | 128 (50 %) | 8 (flying) | spawns lost souls |
| Arch-vile | 700 | 10 (3 %) | **15** | line-of-sight blast + *resurrects corpses* |
| Spider Mastermind | 3000 | 40 (13 %) | 12 | hitscan (super chaingun) |
| Cyberdemon | 4000 | 20 (5 %) | **16** | rockets (splash) |

Design readings of the matrix:

- **HP, pain chance, and speed are three independent dials.** The scariest monsters are not just
  high-HP — the arch-vile is *fast* (nearly player walk speed), nearly *unstunnable* (3 %), and
  changes the board state (resurrection). The pinky is mid-HP but melee-only, so it's a moving
  wall, not a threat at range. Threat = f(speed, stun-resistance, attack geometry), not HP alone.
- **Pain chance is the stagger economy.** Every damage event rolls `random(0–255) < painChance`;
  success interrupts the monster's attack. High-pain-chance monsters (imps, zombies) can be
  *stunlocked* by rapid weak hits — this is why the chaingun "suppresses" cacodemons (50 % per
  bullet) while barely tickling a baron (17 %) and never stopping an arch-vile (3 %). Multi-hit
  attacks (7-pellet shotgun, 20-pellet SSG) roll pain once per component, so they almost always
  stagger. Pain chance is the single stat that converts DPS into *crowd control*, and lowering it
  is how Doom makes elite monsters feel relentless without touching their damage
  ([Pain state](https://doomwiki.org/wiki/Pain_state)).
- **Hitscan vs projectile is the positioning game.** Projectile monsters are solved by movement
  (strafe the fireball); hitscanners are solved by *priority and cover* (kill the chaingunner
  first, break line of sight). Doom II's encounter design is largely the art of mixing the two so
  neither pure kiting nor pure cover-camping works.
- **Damage dice** ([Damage](https://doomwiki.org/wiki/Damage)): the engine's `P_Random` table
  drives everything. Pistol/chaingun bullets: **5–15 in steps of 5** (`(1d3)×5`). Shotgun:
  **7 pellets × 5–15 = 35–105** ([Shotgun](https://doomwiki.org/wiki/Shotgun)). Super shotgun:
  **20 pellets × 5–15**, ~175–245 realistic total, 2 shells
  ([Super shotgun](https://doomwiki.org/wiki/Super_shotgun)). Imp fireball: **3–24**. BFG tracer:
  nominal 15–120 (sum of 15 × 1d8), but because the RNG is a fixed 256-entry table, real totals
  only land in **49–87** — a documented case of the RNG's periodicity narrowing the distribution
  ([Damage](https://doomwiki.org/wiki/Damage)). Rocket direct hit is 20–160 plus radius damage
  (per the [rocket launcher page](https://doomwiki.org/wiki/Rocket_launcher)). Note the pattern:
  wide dice (×3 spread on bullets, ×8 on rockets) make every hit slightly uncertain, which keeps
  even rote encounters from being fully scripted.

### Infighting — the emergent system

[Monster infighting](https://doomwiki.org/wiki/Monster_infighting) falls out of three tiny rules:
monsters don't check friendlies before firing; a monster damaged by another actor retargets that
actor; and monsters are **immune to their own species' projectiles** (but not hitscan), with
hell knights and barons coded as mutually immune. Consequences:

- Players can *farm* mixed monster groups by baiting crossfire — a free resource (ammo saved,
  damage outsourced) earned through positioning skill.
- The arch-vile is one-sided: no monster will ever target it, so it's always the player's problem.
- Same-species groups stay coherent (projectile immunity), so a pack of imps remains a pack — the
  designer can rely on group composition surviving contact.

The lesson: a *cheap* rule (retaliate against whoever hurt you) plus a *guard rail* (same-species
projectile immunity) produced one of the most celebrated emergent systems in games — one that
rewards player positioning, creates spectacle, and self-balances big encounters.

---

## 4. Performance engineering — how Doom hit its frame rate in 1993

Target: 320×200×8-bit on 386/486-class DOS machines, simulation locked at 35 Hz. The definitive
reference is Fabien Sanglard's [*Game Engine Black Book: DOOM*](https://fabiensanglard.net/gebbdoom/)
([Google Books](https://books.google.com/books/about/Game_Engine_Black_Book_DOOM.html?id=wel6DwAAQBAJ));
mechanics below are also documented on the Doom Wiki's
[Doom rendering engine](https://doomwiki.org/wiki/Doom_rendering_engine) page.

### The pipeline

1. **Precompute at build time.** Maps are compiled offline by a *node builder* into a **BSP tree**.
   All the expensive spatial reasoning — how to split the world so it can be traversed in strict
   front-to-back visual order from any viewpoint — is paid once, at map-build time, never at
   runtime. Runtime "visibility" is just a tree walk.
2. **Front-to-back traversal with occlusion tracking.** The renderer walks the BSP from the
   camera's leaf outward, drawing near geometry first. As solid (one-sided) wall segments are
   drawn, the engine records which screen columns are now fully covered; any later seg falling in
   covered columns is skipped entirely. **Walls have zero overdraw** — each screen column of wall
   is written exactly once. When every column is closed, rendering stops, no matter how much level
   remains behind the wall.
3. **Sectors, not polygons.** The world is 2D linedefs + sectors with floor/ceiling heights —
   a 2.5D representation. No look up/down, no rooms over rooms: the constraint *was* the
   optimization. Restricting the world representation made perspective-correct texture mapping
   collapse into constant-Z column/row draws.
4. **Visplanes.** Floors/ceilings are accumulated as *visplanes* — horizontal runs sharing
   height + light + texture — and flushed as horizontal spans. Vanilla has a **static limit of
   128 visplanes**; exceeding it crashes to DOS ("No more visplanes"), and the limit existed
   precisely to cap per-frame work and memory ([Visplane](https://doomwiki.org/wiki/Visplane)).
   A companion limit: **256 drawsegs** (wall segments per frame). These hard budgets pushed *map
   authors* to build render-friendly geometry — the tooling enforced the frame budget socially.
5. **Sprites ride the same structures.** Things live in per-sector lists; visible sprites are
   gathered during the BSP walk, sorted, and drawn as masked columns clipped against the stored
   wall segs — reusing the wall renderer's clipping data instead of a separate depth buffer.
   (There is no Z-buffer anywhere in the engine.)
6. **Fixed-point math and lookup tables.** All world math is **16.16 fixed point**; trigonometry
   is table lookups (finesine, tangent-to-angle). No FPU required, and — a lesson the trading
   stack relearns constantly — no NaNs: every value stays in a bounded integer domain.
7. **Graceful degradation as a user control.** Doom shipped a *low-detail mode* (half horizontal
   resolution) and a shrinkable view window — the original resolution scaler. When the budget
   can't be met, reduce pixels, never simulation rate.

### The general lessons

- **Precompute everything the runtime doesn't need to decide.** Doom's frame is fast because the
  hard problem (visibility ordering) was solved offline.
- **Cull before you draw, and stop early.** Track what's already covered; the best triangle is the
  one never submitted.
- **Choose a world representation that makes your renderer's inner loop trivial**, even if it
  constrains design (2.5D sectors → constant-Z spans).
- **Hard per-frame budgets, enforced by tooling.** 128 visplanes / 256 drawsegs are crude, but
  they made "too expensive to render" a *build error*, not a shipped stutter.
- **Reuse one spatial structure for everything** — rendering, sprite clipping, collision line
  checks all lean on the same BSP/blockmap data.
- **Degrade resolution, never tick rate.**

---

## 5. Doom (2016) — the push-forward loop

Source: id Software's GDC 2018 talk by Kurt Loudy and Jake Campbell,
["Embracing Push Forward Combat in DOOM"](https://www.gdcvault.com/play/1024940/Embracing-Push-Forward-Combat-in)
([YouTube](https://www.youtube.com/watch?v=2KQNpQD8Ayo)), and analyses at
[Game Developer](https://www.gamedeveloper.com/game-platforms/pushing-push-forward-combat-with-gameplay)
and [Game Wisdom](https://game-wisdom.com/critical/pushing-push-forward-combat).

### Rejecting the genre's resting states

The team explicitly cut the mechanics that make shooters *stop*: regenerating health (rewards
hiding), reloading (a pause verb), and cover systems (rewards distance). Their stated principle:
**if the player ever feels the need to stop engaging — hide, run away, wait to recover — that's a
design bug to fix**.

### Resource faucets placed inside danger

The replacement economy makes the *enemy crowd* the supply depot:

- **Glory kills**: sustained damage puts a demon into a highlighted **stagger state**; closing to
  melee range triggers a short finisher that **drops health**. The health you need is at arm's
  length from the thing trying to kill you — low health now *steers you inward*, reversing the
  retreat instinct.
- **Chainsaw**: consumes limited fuel to instantly kill a demon and **fountain guaranteed ammo**.
  It's an emergency faucet with a cost, so "out of ammo" is a decision point, not a failure state.
- (Doom Eternal completes the triad: flame belch → armor, and tightens ammo pools so the faucets
  are mandatory, turning the loop into explicit resource juggling.)

Because refills are *actions performed on enemies*, the optimal play and the exciting play
coincide: dive in, kill, refuel, keep moving. The stagger flash also doubles as legible crowd
telemetry — the arena constantly advertises where the next health pack is standing.

### Arenas vs corridors

Doom 2016 structures levels as **combat bowls connected by exploration corridors**. Arenas are
multi-level volumes with jump pads, ledges, monster closets and looped circulation — built for
circle-flow at speed, with no dead ends to be cornered in (Romero's interconnection rule,
verticalized). Corridors between them carry pacing, secrets (classic-Doom collectibles, in both
senses), and upgrade economy. Enemy *composition over count* drives arena difficulty: each demon
is a verb-shaped pressure (Pinkies deny lanes, Imps harass at range, Hell Knights collapse space),
so encounters are authored as pressure mixes inside geometry that always offers an escape vector.

---

## 6. Lessons for Pinball Knight

### 6.1 Momentum-as-core-verb changes level design

- **The player's speed is the content.** In Doom the expert ceiling is SR40/SR50 — speed *above*
  the intended cap, earned through input skill. Pinball Knight's equivalent already exists:
  boosters, launch chutes, and surface restitution. Make sure there is always a "faster line"
  through a floor that skilled bouncing unlocks — banked shots that skip corridors, chute chains
  that function like strafe-running. The bug-that-became-a-feature lesson: if players find an
  unintended speed tech that isn't breaking collision, consider keeping it.
- **Romero's rules translate almost verbatim to a maze-bounce game**:
  - *Contrast*: alternate tight ricochet corridors with open "pinball bowl" rooms; alternate
    high-friction (control) and low-friction (speed) surface regions. Contrast in *physics
    parameters* is Pinball Knight's version of light/dark.
  - *Change floor height/texture together* → **never change restitution or friction without a
    visible material change**. The player must be able to read bounce behavior from pixels before
    committing to a shot. A surface vocabulary mismatch is the pinball equivalent of misaligned
    textures.
  - *Landmarks + no symmetric rooms*: procedural mazes are landmark-poor by default. Guarantee
    each floor a few asymmetric set-piece rooms (the track-first circuit already helps) and
    distinctive fixtures so players navigate by memory, not only by minimap.
  - *Flow / revisit areas*: key-gated loops that route the player back through cleared space at
    speed are cheap in a momentum game — backtracking is fun when you can bounce through it.
    Design lock-and-key so the return trip uses a different physics line (e.g., a chute only
    enterable from the far side).
  - *Visible-but-unreachable*: show the loot/exit through a wall gap or across a pit the player
    can only cross with a banked launch — the level poses a question answered with momentum.
- **Keys/doors as pacing valves**: gate with keys, then *repopulate* traversed space (Doom's
  teleport-in ambushes) so loops stay alive. In co-op, keys carried by one player create natural
  escort/split dynamics.
- **Secrets**: reward physics mastery — walls that only break above a speed threshold, chutes
  hidden behind full-restitution bank shots. End-of-floor tallies (kills/secrets %) make
  exploration a score, which Doom proved players chase.

### 6.2 Enemy roster as a speed/HP/stagger matrix

- **Audit the 22 families on three axes: speed relative to a bouncing player, HP, and
  stagger/pain response.** Doom's table shows the axes must be *independent*: the roster needs a
  fast-fragile-interrupting enemy (chaingunner analogue), a slow wall (pinky), a flying harasser
  (cacodemon), and a rare fast-unstunnable board-state-changer (arch-vile: e.g., a necromancer
  that revives cleared rooms — the single strongest "kill this NOW" motivator in Doom).
- **Adopt pain chance explicitly.** Give every enemy a `painChance` rolled per damage event
  (or per *bounce impact*): high for fodder (stunlockable by rapid ricochets), low for elites so
  they wade through the pinball chaos. This one number converts the same damage output into
  different *feel* per enemy, exactly as Doom's 200-vs-10 spread does. For a bounce game the
  natural extension: impact momentum scales the roll, so a full-speed hit staggers what a glancing
  tap cannot.
- **Hitscan vs projectile → "instant threat" vs "dodgeable threat."** Pinball Knight's analogue:
  enemies whose attacks punish *position* (beams, aimed shots — kill-first priority targets, kept
  fragile) vs enemies whose attacks punish *predictable trajectories* (slow projectiles, floor
  hazards the player curves around). Mix both per room so neither pure orbiting nor pure hiding
  wins.
- **Wide damage dice**: Doom rolls 5–15 per bullet, 3–24 per imp fireball. A modest random spread
  (±30–50 %) on both sides keeps repeated encounters from resolving identically — cheap variety.
- **Infighting is nearly free and pays enormously**: (a) monsters don't check friendlies before
  attacking, (b) damaged monster retargets its attacker, (c) same-family projectile immunity so
  packs stay packs. In a game about ricochets — where the player can *physically knock enemies
  into each other* — friendly-fire retaliation would make positioning and bounce-lines produce
  emergent brawls. Keep the arch-vile exception in mind: the support enemy nobody else will kill
  must always remain the player's problem.

### 6.3 Resource faucets in melee range — rewarding aggressive bouncing

Doom 2016's core finding: **put the refill on the enemy's body and low resources become an
attack incentive.** For Pinball Knight:

- **Bounce-kill = glory kill.** Kills delivered by body impact / high-momentum collision (as
  opposed to ranged abilities) drop health orbs — or drop *more* of them. Now a hurt knight is
  pulled *into* the fray, which is exactly the fantasy of a pinball melee game.
- **Stagger state as the invitation.** Doom telegraphs "this enemy is now a health pack" with a
  flash. An enemy staggered by pain-chance (or by heavy impact) should visibly wobble and, if
  finished with a bounce, pay out bonus resources. This makes the pain-chance system (§6.2) and
  the economy one mechanism.
- **A chainsaw analogue**: one cooldown/charge ability that guarantees a kill + a mana/ammo
  fountain — the emergency valve that converts "out of resources" from a retreat trigger into a
  spend decision.
- **Never make the optimal play "wait."** No regenerating health while idle; if HP regen exists,
  tie it to kills or momentum (regen while above a speed threshold — "keep bouncing to live" is a
  perfect Pinball Knight rule). Audit every system with the id question: *does anything reward the
  player for stopping or leaving the fight?* Fix whatever does.
- **Arenas vs corridors in maze floors**: the track-first generator already grows a circuit —
  treat circuit chambers as Doom-2016 bowls (looped circulation, no cornerable dead ends, boosters
  as jump pads) and maze filler as the exploration/secret connective tissue. Author encounter
  difficulty by *composition* (lane-denier + harasser + elite), not by count.

### 6.4 Performance lessons for a WebGPU 2.5D renderer

Doom's playbook maps cleanly onto the known Pinball Knight constraint (frame stalls scale with
*pipeline count*, not scene size):

- **Precompute per floor, like a node builder.** The maze is static once generated: bake
  per-region visibility/adjacency (a room-and-portal graph is the top-down equivalent of a BSP),
  merge static wall/floor tiles into chunked meshes at generation time, and precompute anything
  per-tile the renderer would otherwise derive per frame. Generation time is the cheapest frame
  time you'll ever buy.
- **Cull early, stop early.** Doom stops rendering the instant all screen columns are closed. The
  equivalent: cull by room/portal reachability from the camera, not just frustum — in a maze,
  most of the floor is provably invisible, and enemies in unreachable rooms shouldn't even reach
  the draw-submission stage (Doom similarly gates monster AI on line-of-sight/sound waking).
- **One pipeline per material *class*, not per material.** Doom draws the entire world with
  essentially two inner loops (wall columns, flat spans) plus masked sprites. The WebGPU frame
  should look the same: a handful of pipelines (opaque tiles, sprites/masked, VFX/particles, UI),
  with per-material variation expressed as texture-atlas UVs and instance/uniform data — never as
  new pipeline permutations. This is the direct fix for the pipeline-count stall: pipeline count
  should be O(1) with respect to content, and every pipeline should be created (and ideally
  warmed with a dummy draw) at load, never mid-combat.
- **Batch by structure**: all static geometry per visible chunk in one instanced/merged draw; all
  sprites through one atlas'd instanced pipeline sorted once per frame (Doom's vissprite sort).
  State changes, like visplanes, should be *merged runs*, not per-object toggles.
- **Hard budgets enforced by tooling.** Doom's 128-visplane limit made expensive geometry a build
  error. Add generator-time asserts: max visible chunks from any camera cell, max simultaneous
  sprite count per room, max particle emitters per arena — fail floor generation loudly instead of
  shipping a stutter, exactly in the spirit of the existing headless screenshot/playtest harness.
- **Bounded numeric domains.** Doom's 16.16 fixed point wasn't just about missing FPUs — it meant
  no NaN/Inf ever entered the simulation. Pinball Knight's physics already knows (per the NaN
  fault-injection lesson) that a NaN bypasses `<` gates; clamping speeds/positions into known
  ranges at the seams is the modern equivalent.
- **Degrade resolution, never the 60 Hz tick.** Doom's low-detail mode and shrinkable view are the
  precedent: under load, drop render scale or VFX density; the fixed timestep is untouchable.

---

## Source list

- [Doom Wiki — Player](https://doomwiki.org/wiki/Player) · [Straferunning](https://doomwiki.org/wiki/Straferunning) · [SR-50 automation](https://doomwiki.org/wiki/SR-50_automation)
- [Doom Wiki — Pain state](https://doomwiki.org/wiki/Pain_state) · [Monster infighting](https://doomwiki.org/wiki/Monster_infighting) · [Damage](https://doomwiki.org/wiki/Damage) · [Shotgun](https://doomwiki.org/wiki/Shotgun) · [Super shotgun](https://doomwiki.org/wiki/Super_shotgun) · [Rocket launcher](https://doomwiki.org/wiki/Rocket_launcher)
- [Doom Wiki — Doom rendering engine](https://doomwiki.org/wiki/Doom_rendering_engine) · [Visplane](https://doomwiki.org/wiki/Visplane) · [Tips for creating good WADs](https://doomwiki.org/wiki/Tips_for_creating_good_WADs)
- Fabien Sanglard, [*Game Engine Black Book: DOOM*](https://fabiensanglard.net/gebbdoom/) ([Google Books](https://books.google.com/books/about/Game_Engine_Black_Book_DOOM.html?id=wel6DwAAQBAJ))
- Romero's rules: [Helldorado summary](https://www.helldoradoteam.com/2018/12/19/john-romeros-level-design-tips/) · [Chubzdoomer video breakdown (archive.org)](https://archive.org/details/doom-level-design-chubzdoomer_202005-500202) · [soulsphere — The design of E1M1](https://soulsphere.org/apocrypha/e1m1/) · [Millington — E1M1 analysis](https://lajmillington.wordpress.com/2016/02/01/the-design-of-doom-e1m1/) · [eev.ee — You should make a Doom level](https://eev.ee/blog/2015/12/30/you-should-make-a-doom-level-part-2/)
- Doom 2016: Loudy & Campbell, [GDC 2018 — Embracing Push Forward Combat in DOOM](https://www.gdcvault.com/play/1024940/Embracing-Push-Forward-Combat-in) ([YouTube](https://www.youtube.com/watch?v=2KQNpQD8Ayo)) · [Game Developer analysis](https://www.gamedeveloper.com/game-platforms/pushing-push-forward-combat-with-gameplay) · [Game Wisdom analysis](https://game-wisdom.com/critical/pushing-push-forward-combat) · [AI of DOOM (1993) — Game Developer](https://www.gamedeveloper.com/game-platforms/the-ai-of-doom-1993)
