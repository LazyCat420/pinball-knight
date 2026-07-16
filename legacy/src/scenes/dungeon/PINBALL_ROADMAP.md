# 🪩 Pinball-Crawler Hybrid — Checklist & Roadmap

*(2026-07-16. Companion to BLUEPRINT.md, which stops at the 2026-07-14 rounds.
This doc reconciles the playtest asks + brainstorm list against what the code
actually contains as of commit `bcd1271`.)*

> **STATUS UPDATE (2026-07-16, same day):** Waves A–F below are **BUILT** in a
> single implementation pass. §2's checklist is annotated with ✅. What shipped:
> glove/oil/spinpad/slingshot/target/trapdoor parts (`state.PinballPartKind`,
> `decorate.classifyTopology` pools, `render/pinball-parts.ts` builders,
> `player.touchPinballParts` + `entities/hazards.ts`); the six Wave-B monsters
> as tinted reskins (`core.RESKIN`) with bespoke behaviours in `zombie.ts` +
> momentum gates in `combat.ts`; prefab stamps + shuffle bag + 4 floor themes
> (`maze/prefabs.ts`); curved deflector rails + the trapdoor coaster
> (`player.startRide`); the Magician/Witch/Frog (`entities/npc.ts`); the five
> Wave-F potions + multiball + frenzy/strike/target/bonus-room score glue.
> Deliberately deferred: flipper tiles (gloves cover the fantasy), angle
> mirrors, pit/electric/fire-vent/magnet-strip floor hazards, Rolling Cart
> Merchant (needs a shop), Curve Shot / Magnet Boots, real boss antechamber
> prefab (shipped as a brute-guard pack at the stairs), and bespoke cel-paints
> for the reskinned monsters (sprite-forge follow-up).

---

## 1. What is ALREADY BUILT (verified in code — don't rebuild these)

| System | Where | Notes |
| ------ | ----- | ----- |
| Pinball momentum core | `entities/player.ts` | Flat wall bounce preserves speed (0.94), corner slam accelerates (1.12 + kick), 22 u/s cap, gentle friction, steerable |
| Bounce combo + style kills | `player.ts`, `combat.ts` | Combo counter w/ 1.6s window; kills carried by momentum pay combo-scaled gold |
| Ball form + ram | `player.ts` | Full overcharge → tuck into ball, ram zombies w/ knockback |
| Pinball parts ×4 | `state.ts`, `maze/decorate.ts`, `render/pinball-parts.ts`, `player.ts` | **bumper** (junctions, radial pop), **spring** (dead-end plunger, 16 u/s), **ramp** (dash pad, speed floor + steer lock), **deflector** (banked corner rail). Topology-placed, animated, SFX'd |
| Room archetypes ×4 | `maze/generator.ts` `carveRooms`, `decorate.ts` `furnishRooms` | bumper chamber / speedway / arena / vault — carved over the backtracker pre-thicken so connectivity is free |
| Secret smash-walls | `generator.ts` `crackSecretWalls`, `secrets.ts` | Solid at walk, shatter at momentum ≥ 7; every launcher clears the bar |
| Enemy roster ×8 | `state.ts` `EnemyKind`, `zombie.ts` | zombie, spider, brute, spitter, **ghost** (phases walls = brainstorm "Phase Ghost"), **bat** (sine-weave flyer), **slime** (splits into 2 minis = brainstorm "Jelly Split"), **reaper** |
| The Death Dealer | `constants.ts` REAPER_*, `zombie.ts` | Already exists under that exact name — spawns at 110s, phases walls, accelerates forever, unkillable. The Spelunky ghost |
| Floor grade | `constants.ts` GRADE_*, `fps.ts`, `ui.ts` | S–D on pace/carnage/style, gold payout per grade |
| Wall moves, dodge roll | `player.ts` | wall-kick / wall-ride grind / pounce; Gungeon-style roll w/ i-frames |
| Buff potions | `items.ts` | health / rage / haste / shield / gold — the extension seam for new power-ups |
| Dead-end reward logic | `decorate.ts` | Springs aim OUT of dead ends; vault rooms hold guarded prizes |

**Brainstorm items that are already done** (map them, don't duplicate):
Classic Bumpers ✅ · Speed Lanes ✅ (ramp) · Secret walls ✅ · Jelly Split ✅
(slime) · Phase Ghost ✅ (ghost — lacks only the "materialize window" damage
rule) · Death Dealer ✅ (reaper) · Style bonuses ✅ · Floor-end grade ✅ ·
Bounce-combo multiplier ✅ (window exists; no on-screen multiplier flash yet).

---

## 2. NOT built — the gap checklist

### From the playtest asks
- [ ] 🥊 **Boxing-glove walls** — wall-mounted piston gloves that punch you (and enemies) across the room
- [ ] 🛢️ **Oil-spill floor boosters** — frictionless slicks: momentum preserved, steering nearly dead
- [ ] 🎩 **The Magician** — periodic unkillable NPC that teleports you somewhere random and laughs
- [ ] 🧩 **Prefab/component maze generation** — reusable room + hallway *shapes* with no-repeat variety (today: plain backtracker + 4 rect archetypes; hallways are all identical corridors)
- [ ] ⌒ **Curved walls** — real pinball-machine arcs (today the *deflector part* fakes one corner; wall geometry is 100% boxes)
- [ ] 🎢 **Trap doors → rollercoaster ramps** — floor doors that drop you onto a scripted high-speed rail ride

### From the brainstorm (new, grouped by cost)
**Parts/hazards** (cheap — the part seam already exists):
- [ ] Spin pad (random-direction fling) · [ ] Slingshot gate (paired-bumper double-speed ping) · [ ] Flipper tiles · [ ] Target bullseyes (hit all 5 → door/prize) · [ ] Angle mirrors · [ ] Pit tile (reset + penalty) · [ ] Electric grid (rhythm floor) · [ ] Fire vents (timed jets) · [ ] Magnet strip (crawl zone)

**Monsters** (medium — EnemyKind seam exists):
- [ ] Bumper Goblin (bounces YOU like a bumper) · [ ] Pinwheel Spinner (angle-dependent deflect) · [ ] Brick Golem (wall until speed-hit, shatters into ricochet shards) · [ ] Magnet Crawler (pulls you in) · [ ] Bowling Pin Crew (formation, chain knockback) · [ ] Web Spinner (slow webs, bumpers shake free) · [ ] Chomper Plant (corridor blocker) · [ ] Ghost materialize-window rule

**NPCs** (medium):
- [ ] Magician · [ ] Speed Witch (HP-for-speed trade) · [ ] Oracle Frog (map peek in dead ends) · [ ] Rolling Cart Merchant (needs a shop system first — defer)

**Generation** (big):
- [ ] Prefab stamp library · [ ] Seeded floor themes (archetype pools per depth) · [ ] Connector-hallway mini-challenges · [ ] Boss antechamber before the stairs · [ ] Mirror Maze / Magician's Parlor / Slalom / Gauntlet / Pit Room archetypes

**Power-ups & score glue** (cheap-medium):
- [ ] Iron Core (timed ram-damage buff) · [ ] Turbo Charge · [ ] Spring Legs (bounce restitution up) · [ ] Freeze Ray · [ ] Multi-Ball ghosts · [ ] On-screen multiplier flash + MULTIBALL FRENZY streak bonus · [ ] Floor score target → bonus room unlock
- Curve Shot / Magnet Boots — defer (depend on magnets + projectile rework)

---

## 3. Build plan — six waves, each shippable alone

Ordering rationale: A and B ride existing seams (fast, visible wins), C is the
generation rebuild everything later stamps into, D–F layer content on top.

### Wave A — Hazard & part expansion (the part seam)
Every new part is the same 4-touch recipe the existing four prove out:
1. `state.ts` — extend `PinballPartKind` (+ per-part fields if needed)
2. `maze/decorate.ts` `classifyPartSpot` — a topology rule for where it lands
   (gloves want wall faces on long straights; oil wants open rooms/corridor
   runs; spin pads want junction centres; slingshots want 2-wide gaps)
3. `render/pinball-parts.ts` — a builder + an animate hook
4. `entities/player.ts` part loop (~line 450) — the physics on touch/trigger

Contents: **boxing glove** (timed piston: `fireT` cycle, hits player AND
enemies in its lane via `combat.damageZombie` — first part that's also a
weapon), **oil slick** (a *zone*, not a point: `PINBALL_STEER × 0.1`,
friction ≈ 0, walking entry converts to momentum — the cheap "wheee" part),
**spin pad**, **slingshot gate**, **target bullseyes** (per-room counter →
door unlock or prize spawn — first *objective* part). Flipper tiles: prototype
last, only if gloves don't already scratch the itch (a glove IS a flipper with
a clearer read).
*Tests:* part-placement topology rules in `decorate.test.ts`; oil steering
math in `player.test.ts`.

### Wave B — Pinball-reactive monsters (the EnemyKind seam)
Recipe per monster: `EnemyKind` union + stats block in `constants.ts` (the
`*_RATIO` / `*_FROM_LEVEL` convention) + behaviour branch in `zombie.ts` +
cel-painter sheet + spawn table entry.
Priority order (each teaches the player a different momentum lesson):
1. **Bumper Goblin** — contact = bumper kick on the player (reuse BUMPER_KICK
   math verbatim); low HP; only dies to momentum hits — the walking tutorial
   for "hit things fast"
2. **Bowling Pin Crew** — spawn 6 in triangle formation; knockback chains
   (a shoved pin damages pins it collides with; wall slam = bonus) — reuses
   existing knockback, needs pin-vs-pin collision pass
3. **Brick Golem** — inert wall-tile actor until hit ≥ SECRET_BREAK_SPEED
   (reuse the secret-wall gate), death spawns 3 ricocheting shard projectiles
4. **Chomper Plant** — stationary corridor gate, snap telegraph, knocked open
   only by a speed hit
5. **Magnet Crawler** — radial pull force on the player each tick; wall
   contact snaps the tether
6. **Web Spinner** — web glob projectile → `webbedT` slow on player; touching
   any bumper/spring clears it (makes parts defensive tools)
7. **Ghost materialize rule** — vulnerability window after its attack lands
*Tests:* golem speed-gate + goblin kick vectors in `ghost.test.ts`-style
colocated tests.

### Wave C — Prefab maze generation (the big one)
Goal: "reuse component parts (rooms/hallway shapes) without repeating the same
pattern over and over."
- **`maze/prefabs.ts`** — a stamp library. A prefab = a small tile matrix
  (pre-thicken cell space, like `carveRooms` output) + anchor metadata (part
  spots, spawn spots, prize spots, door cells). Room prefabs (Slalom S-curve,
  Gauntlet, Pit Room, Mirror Maze, Magician's Parlor, Boss Antechamber, plus
  the existing 4 archetypes re-expressed as stamps) AND hallway prefabs
  (S-bend, switchback, wide boulevard with a centre island, squeeze).
- **Placement** — keep the backtracker as the connective skeleton (it already
  guarantees solvability); stamp prefabs over it exactly the way `carveRooms`
  does (only carve floor, never add wall over corridor → connectivity by
  construction). Hallway prefabs replace straight corridor runs ≥ N cells.
- **No-repeat variety** — a seeded **shuffle-bag** per floor: each prefab id
  enters the bag with rotation/mirror variants (×4–8 variants each, free);
  drawing without replacement until empty guarantees a floor never repeats a
  stamp before it's used everything, and the bag reshuffles across floors with
  the level seed.
- **Floor themes** — depth-seeded theme table gating the prefab pool + palette
  accents + enemy-ratio overrides (e.g. 1–2 Crypt, 3–4 Sewer/oil-heavy,
  5+ Hellfire/fire-vent-heavy). Cheap: it's a pool filter, not new art.
- **Dead-end economics** — every dead end draws from {spring (already), prize,
  Oracle Frog, trapdoor} so exploration always pays.
- **Boss antechamber** — always stamped adjacent to the stairs room from
  depth 3+; brute-pack + arena furniture now, a real boss later.
*Tests:* `generator.test.ts` gains: every prefab stamp preserves full
reachability; shuffle-bag never repeats within a floor; stairs BFS-distance
rule survives stamping.

### Wave D — Curved walls + trapdoor coasters (the showpiece)
- **Curved walls** — new tile flag for *convex corner arcs*: where two wall
  bands meet at an L, replace the corner cap with a quarter-cylinder segment
  (`build.ts` already special-cases wall heights per neighbour; this is one
  more case). Collision: `collision.ts` gains circle-vs-arc for flagged
  corners — bounce normal is radial, so a fast player entering the curve
  *sweeps around it* like a pinball return lane. This upgrades every corner
  the deflector part can't cover, and Mirror-Maze/Slalom prefabs get them by
  default. Physics note: a swept curve should behave like the deflector
  (keep speed ×1.03), NOT like a corner pocket (no accel farming loop).
- **Trap doors → rollercoaster** — a `Trapdoor` tile (rendered as a bordered
  hatch): step on it at ≥ ramp speed (or after a 0.4s creak if slow) → it
  flips open → **`coaster.ts`**: a seeded Catmull-Rom spline threaded along
  the maze's wall-top graph (2–4 s ride), player control locked, camera
  follows, i-frames on, sparks + wind SFX, exits by *launching* you at spring
  speed at a far tile (shuffle-bag picks: near-vault / near-stairs / mid-horde
  for risk-reward). Mechanically a teleport with a ride — all state mutation
  happens at exit, so it can't desync combat.
*Tests:* arc-collision reflection math; spline endpoints always land on
walkable tiles.

### Wave E — NPCs
- **The Magician** 🎩 — every MAGICIAN_PERIOD (~45 s, jittered), spawns in
  view-edge smoke, bows, teleports the PLAYER to a shuffle-bag tile (biased:
  60% neutral, 25% treasure-adjacent, 15% trouble), laughs (`audio.ts` gets a
  cackle), vanishes. Unkillable + untargetable (reuse the reaper's immunity
  path in `combat.ts`). Momentum is preserved through the teleport — landing
  at 20 u/s in a bumper chamber is the feature. Suppressed while the reaper
  is out (two uncontrollable actors at once reads as unfair).
- **Speed Witch** — secret-room NPC (spawns only behind cracked walls —
  finally a *reason* to hunt them): pay half current HP → 30 s
  turbo+spring-legs buff. One trade per floor.
- **Oracle Frog** — dead-end NPC: touch → 3 s minimap reveal of the route to
  the stairs (UI already draws a map? if not, a compass ping is the v1).
- Rolling Cart Merchant — **deferred** until a gold-shop exists.

### Wave F — Power-ups & score glue
- New potions on the existing `PotionId` seam: **Iron Core** (ram damage ×3,
  20 s), **Turbo Charge** (PINBALL_FRICTION → 0, steer ×1.5, 10 s), **Spring
  Legs** (wall restitution → 1.05 flat, 15 s), **Freeze Ray** (all enemies +
  timed parts frozen 6 s).
- **Multi-Ball** — 2 ghost knights offset ±0.8 tiles mirroring player
  momentum, dealing ram damage only, 12 s. (Render = tinted player sheet;
  no AI needed.)
- **Score glue** — on-screen ×N multiplier flash per bounce-combo step;
  "MULTIBALL FRENZY" banner + gold at 5 part-hits inside one combo window;
  per-floor score target (scaled from grade thresholds) that unlocks one
  bonus-room door (a locked vault prefab from Wave C).

---

## 4. Verification per wave (house rules)

- Colocated `*.test.ts` for pure logic only (generator/collision/part math) —
  run `npm test`.
- Visual/feel changes: the headless Playwright harness (swiftshader; **poll
  sim time, don't sleep** — sim caps at 0.1 s per rendered frame). Screenshot
  every new part/monster/prefab from the fixed camera before calling it done.
- Commit + push before any deploy; the tree must be clean (parallel sessions
  touch this repo).
