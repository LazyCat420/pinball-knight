# 🪩 Pinball Hybrid Maze — Implementation Checklist

*(2026-07-17. The living build checklist for the "pinball machine" overhaul.
Grounded in a full read of generator/decorate/prefabs/pinball-parts/player/
constants — reconciled against what's ALREADY built so we tune/connect rather
than rebuild. Companion to PINBALL_ROADMAP.md §2.5.)*

## Already built — DO NOT rebuild (verified in code)
- Growing-tree maze with **windiness** (bushy↔winding) + **braid** (loops) knobs
  (`generator.ts:126`), deterministic seeded; `thickenWalls` → **2-wide corridors**.
- **Topology classifier** + kind→topology deal + Manhattan-3 spacing
  (`decorate.ts:166,186,427-469`) — parts land where they play.
- **4 room archetypes** (bumper quincunx / speedway ramp-lane / arena / vault)
  that already CLUSTER furniture (`decorate.ts:234-309`).
- **13 rotatable/mirrorable prefab stamps** via shuffle-bag incl. open chambers
  (oilworks/parlor/bullring/mirrormaze/pitroom/boulevard) (`prefabs.ts:40-168`).
- **4 FloorThemes** → prefab pool + part deal + enemy mix (`prefabs.ts:247-276`).
- **16 part/hazard kinds** placed+rendered+physics-wired; ramp already redesigned
  (wedge+rails+arrows, done 2026-07-17). Flippers ALREADY auto-catapult on
  contact; targets ALREADY have a `done` broken state (`state.ts:298`).
- Momentum/friction/restitution model: global `PINBALL_FRICTION=0.9` with oil
  (friction 0) + magstrip (speed cap) exceptions (`player.ts:1014-1170`).
- Reachability heavily tested (`generator.test.ts`, `prefabs.test.ts`).

## Confirmed gaps this overhaul closes
No intra-floor zones · no per-tile friction field · no part chaining/orphan
removal · no player-activated flippers · no lit-bumper/jackpot · no target
sequence · magstrip only slows (no accelerate lane) · no openness metric.

---

## Slice 1 — Part legibility ✅ (magstrip/electric/spinpad done 2026-07-17)
Flat floor-stickers now have vertical presence: magstrip = two tall coil pylons +
inward braking chevrons; electric = tall prong pylons + central emitter rod;
spinpad = raised turbine blades + glowing gold hub. (oil stays intentionally flat
— it's a slick; slingshot/target already read fine.)
The flat "floor sticker" parts don't read in iso like the ramp used to. Give
them raised silhouettes + bright directional emissive + a clear idle animation.
- Files: `render/pinball-parts.ts` (buildOil, buildMagStrip, buildSpinPad,
  buildSlingshot, buildTarget as needed) + `updatePinballParts`.
- Audit each builder against the ramp bar; the worst offenders are the FLAT ones
  (oil slick, magstrip band, electric plate). Add rims/posts/arrows/glow.
- Verify: headless `__dungeonParts()` + `__dungeonWarp` screenshot each kind.

## Slice 2 — Open playfield ✅ (done 2026-07-17)
Rooms are the bounce-able area; made them bigger + more numerous + more prefab
chambers + more braid loops (all reachability-preserving, 104 tests still green):
ROOM_MIN/MAX_CELLS 2/4→3/6, ROOMS 2·0.5·5→3·0.8·8, braid 0.1+.035·l→0.14+.04·l
(cap .32→.4), prefabCount 2→3 base / 4→6 cap (`constants.ts`, `core.ts`). Deferred
the risky corridor-widen pass — the wide "launch district" comes with Slice 9 zones.
Momentum needs room to chain. Levers (no new maze algo needed):
- Raise room budget + open-prefab count on pinball floors; raise `braid` (loops).
- Add a **corridor-widen pass**: after thicken, widen chosen main runs to 3 tiles
  so a ball banks instead of pinching (guard reachability).
- Per-theme **openness** field on `FloorTheme`.
- Files: `core.ts` (level gen params), `maze/generator.ts` (widen pass),
  `maze/prefabs.ts` (theme openness). Tests: reachability stays green + a new
  openness-ratio assertion in `generator.test.ts`.

## Slice 3 — Chain + no-orphan placement ✅ (runway validation done 2026-07-17)
Corridor-dealt LAUNCH parts (ramp/spring/slingshot/flipper) are validated at
placement: need ≥3 open tiles of runway in the fire direction, else flip to the
opposite open side, else skip the candidate — no more "launches into a wall a
tile away" orphans. Inline in the deal loop so room/prefab parts stay intact
(`decorate.ts launchRunway` + deal loop). New test in `decorate.test.ts`.
(Positive clustering — parts that actively feed each other — folded into Slice 9
zones, which places the launch→core→drain chain deliberately.)
- **Chain validation pass** in `decorate.ts`: for each launch part (ramp/spring/
  slingshot/flipper), require something (bumper/part/target) within N tiles down
  its launch trajectory; else relocate or drop it.
- **Orphan cull**: a part with no partner in range is removed.
- Bias corridor deal toward small clusters near junctions.
- Test: `decorate.test.ts` — no launch part left aimed into a bare wall.

## Slice 4 — Per-surface friction map ✅ (done 2026-07-17)
`PINBALL_FRICTION` is now multiplied by the openness of the tile you're on:
open room/junction (3-4 nbrs) = FRICTION_OPEN 0.35 (fast highway, holds speed),
straight corridor (2) = 1.0, dead-end pocket (≤1) = FRICTION_TIGHT 2.1 (bleeds
you for control). Derived at runtime from `isWalkable` neighbours in
`updatePinball` (`constants.ts` bands + `player.ts`) — no new grid state; Slice 9
zones can override per-zone. Verified: coasts slowly in the open, no errors.
- Add a per-tile friction multiplier (a `Uint8`/`Float` grid overlay or a
  fast/slow tile-set) read in `updatePinball`. ramp/room = low (fast), tight
  corridor = high (control). `constants.ts` bands + `player.ts` friction read.
- Ties into Slice 9 zones (zone stamps the surface).

## Slice 5 — Bumper lit/unlit + jackpot ✅ (done 2026-07-17)
Bumpers count `hits`; at BUMPER_LIT_HITS (3) one LIGHTS — burns gold, kicks
harder (BUMPER_KICK_LIT 5.6 vs 3.2), pays BUMPER_LIT_GOLD. Light JACKPOT_BUMPERS
(5, or all if fewer) → `fireJackpot`: floor-wide burst damage + JACKPOT_GOLD +
flash + a 3s `jackpotT` glow window, then every bumper resets to re-light.
`state.bumperTotal/bumpersLit/jackpotT`, `PinballPart.hits`; dome glows gold when
lit (`pinball-parts.ts`). Verified headless: a rammed bumper turns gold.
- Add `hits`/`lit` to the bumper `PinballPart` (`state.ts`). Unlit = small bounce;
  lit (3 hits or target-break) = big bounce + VFX + score mult. All bumpers in a
  room cluster lit → **jackpot**: a ~3s room-wide extra-damage window + flash.
- `state.ts` + `player.ts` (bumper branch) + `pinball-parts.ts` (lit glow).

## Slice 6 — Target sequence lock ✅ (done 2026-07-17)
Drop-target BANK: one row of 3 wall-mounted targets (`bank`/`seq`/`lit` on the
part) placed on a shared wall run (`decorate.ts` best-effort). Hit them in 1-2-3
order to LIGHT them (green); a wrong-order hit resets the whole bank (red);
lighting all 3 pays BANK_CLEAR_GOLD + flash. Separate from the scattered
break-them-all objective (excluded from targetsTotal). Render: banked eyes glow
green-lit / red-armed. New bank-structure test; 105 pass.
- Give a room's targets an ordered `sequence` index; hitting out of order resets.
  Completing 1-2-3 fires a reward (prize/door/jackpot assist).
- `state.ts` (target `seq`) + `decorate.ts` (assign) + `player.ts` (hit logic).

## Slice 7 — Flipper telegraph + redirect ✅ (done 2026-07-17) (RECONCILE)
Flippers already auto-catapult, and Q/E are abilities, so NO key rebind. Instead:
the flipper exit is now AIM-ASSISTED — the paddle angle BLENDED with your approach
line (0.72 paddle / 0.38 approach, so a good entry aims the shot but it can't
reverse you). Plus a telegraph: the gold striking edge breathes "live" and flares
on swing (`player.ts` flipper branch + `pinball-parts.ts` edgeMat glow).
Flippers already auto-catapult on contact. Q/E are abilities now, so DON'T
rebind. Instead: make the flipper **redirect momentum along the paddle angle by
approach** (aim-assist) + a clear pre-swing telegraph + a stronger snap. Only add
a key-activation if playtest wants it (candidate: hold RMB near a flipper).
- `player.ts` flipper branch + `pinball-parts.ts` telegraph.

## Slice 8 — Momentum lanes ✅ (done 2026-07-17) (RECONCILE)
A new part kind touches dozens of enums/tests, and magstrip must keep slowing —
so lanes are a PHYSICS glide instead: while railing fast and not steering, the
player eases toward the walkable centre of the corridor cross-section (probe a
wall on each perpendicular side; nudge away from the near one via moveCircle), so
you rail down the middle like a pinball lane instead of scraping a wall. Only
fires in corridors (wall on exactly one side), never rooms. `constants.LANE_CENTER_PULL`
+ `player.ts updatePinball`.
Magstrip currently SLOWS (anti-speed) — don't repurpose it. Add lane behaviour as
paired **guide strips** (or a new lightweight "channel" concept): two rails 1 tile
apart, 3-4 long, that funnel a moving player to the centre and hold speed down
the lane (center-channel feel). Placed as a lane, not singletons.
- `decorate.ts` (lane placement) + `player.ts` (funnel force) + `pinball-parts.ts`.

## Slice 9 — Three-zone floors ✅ (done 2026-07-17) — ALL SLICES COMPLETE
A room's archetype is now chosen by its distance from the start (stairs sit at
the far end), so every floor reads as a loop: LAUNCH district near start
(speedway ramp lanes) → MACHINE core in the middle (bumper arenas to bounce +
rack the jackpot) → DRAIN lane far by the stairs (arena/vault — the fight + the
reward). The corridor-friction (Slice 4) and enemy-density (BFS) gradients
already ride distance, so this ties the spatial pacing together — reachability
untouched (only archetype selection changed). `decorate.ts furnishRooms` + a
zoning test. Deferred (pure taste, not blocking): per-zone corridor WIDTH carve
+ making the core the single densest band.
Partition each floor into **launch district → machine core → drain lane** by
BFS-distance bands from start→stairs: launch = wide + ramps + low friction + few
enemies; core = open bumper arena + dense enemies; drain = tight + flippers/
mirrors + boss/reward. Zone drives room-archetype choice, corridor width,
friction surface, and enemy density.
- `decorate.ts` + `generator.ts` + `core.ts`. The capstone that uses slices 2/4/5/8.

---

## Wave 10 — "still a box maze" follow-up ✅ (2026-07-17)
User feedback after Slices 1-9: open rooms still read boxy; ramps / booster lanes
/ curved lanes not landing. Root causes were the deferred widen pass + no
accelerating element + curves only as tiny corner wedges. Closed:

- **Booster part (NEW kind `booster`)** — a Sonic speed-booster pad: snaps your
  heading to its arrow + FLOORS your speed (works from a cold walk, starting a
  ride). The genuinely-missing accelerator (magstrip only ever slowed). Enum +
  `BOOSTER_*` constants + `buildBooster` (neon walkway pad, scrolling chevrons) +
  physics branch + `sfxSpin`. Fires from both the momentum and walk paths.
- **Booster LANES** — a dedicated layer (like target banks) lays rows of 3
  adjacent pads down a straight run, all aimed the same way, so a floor has real
  speed channels. ~3 lanes/floor (verified 60/60 seeds). Its own layer, off the
  part budget. `decorate.ts` lane search + `boosterLanes` extra.
- **Speedway = ramp→booster CHAIN** — speedway rooms now alternate ramp/booster
  down the long axis (was ramps only), so the room rails you end-to-end.
- **Curved playfield perimeter** — big open (bumper/speedway) rooms get banked
  deflector rails in all four inner corners, so a fast ball sweeps the room edge
  like a rounded pinball table instead of slamming square walls. Visible curved
  lanes in the open rooms (verified ~1/floor). `furnishRooms`.
- **Corridor-widen artery** (the deferred Slice 2/9 pass, finally done) —
  `widenMainArtery` traces the start→stairs BFS gradient and widens it to 3 tiles
  (carves wall→floor only, reachability-preserved). Kills the uniform 2-wide box
  feel; every downstream stage (topology/parts/arc-corners/render) sees the wide
  highway. Runs in `core.ts` after thicken, before decorate. New invariant test.
- **Fix 1 — wall-break text overlap** — `showToast` now single-slots (evicts the
  prior toast + cancels its timers) so chained "SECRET WALL SMASHED" messages no
  longer pile up on top of each other.
- **Fix 2 — Ragnarok floating combo numbers** — replaced the static centred ×N
  flash with `spawnFloatingCombo`: a small bold ×N at the knight's SCREEN pos
  (via new `camera.worldToScreenPx`) that floats up, shrinks, fades, waterfall-
  stacks, tier-colours (white→yellow→orange→red/gold) + shakes on big chains.

Verify: tsc clean (dungeon), 110 vitest pass, `next build` green. No WebGL
screenshot harness in this repo — needs in-browser playtest.

**DEFERRED (separate feature, not this wave):** the Card system + Tavern hub
(pinball_knight_plan.md Part 2) — a whole new `src/scenes/tavern/` scene + card
data model + persistent runState. Large enough to warrant its own build pass;
untouched here to keep this wave focused on the "feels like a box maze" fix.

---

## Wave 11 — face, movement, big rooms, CARDS + TAVERN ✅ (2026-07-17)
Second round of user feedback ("face better / old bearded man whose helmet breaks
Doom-style; ride shouldn't scrape the wall; big rooms end up empty; now do
pinball_knight_plan.md Part 2"). All shipped:

- **Doom-style health face** (`hud-face.ts`) — the knight is now a grizzled OLD
  man with a grey beard + bald pate under the helm. The helmet BREAKS in stages
  as HP drops (crest knocked off → dome cracks → plates shatter showing grey hair
  → helm gone, bare bloody face → dead). `helmetStageOf` / `paintScalp` /
  `paintBeard` + a stage-driven `paintHelmet`.
- **Lane centring rebuild** (`player.ts` + `LANE_PROBE_MAX`/`LANE_CENTER_PULL`) —
  the ride actively CENTRES in the corridor cross-section (measures wall
  clearance each side, nudges to the midpoint, works even while steering) instead
  of scraping one wall. Fixes "it just rides against the wall".
- **Big rooms filled** (`decorate.ts furnishRooms`) — bumper rooms now lay a
  staggered GRID of bumpers scaled to area (a 12×12 room → ~20 pins, was 5);
  speedway rooms lay 2-3 PARALLEL ramp→booster lanes; arena/vault get wall-mid
  bumpers. No more empty chambers.
- **CARD SYSTEM** (plan Part 1) — new `cards.ts` (16 cards, 4 rarities, stat /
  on-hit / pinball-synergy modifiers). `WeaponDef.cardSlots` + `WeaponState.cards`
  (`items.ts`). Cards DROP from kills (`rollCardDrop`, rarity-gated, one legendary
  per run), render as rarity-tinted floor cards (`cel-painter cardItem`), and
  pick up → auto-socket into the active weapon or stash. `playerDamage` runs every
  hit through the socketed aggregate (percent → flat → pinball-synergy); on-hit
  CHILL (slow) + BURN (DoT) via new `Zombie.chillT/dotT` in `zombie.ts`; cooldown
  card speeds ranged fire. `cards.test.ts` (9 tests).
- **TAVERN hub** (plan Part 2) — new `tavern.ts`: a between-floor overlay (pauses
  the sim like the shop via `state.tavernEl`) opened on stair descent. Four
  stations: ⚔ Armory (socket/un-socket stashed cards), 🍺 Bar (buy cards + reroll,
  repair weapon, add a card slot), 🔨 Blacksmith (forge 2 commons→1 rare, reroll a
  card, repair gear), 📜 Notice Board (run stats + DESCEND). Run-persistent
  `state.cardStash` survives floor rebuilds; resets on a new run.

Verify: tsc clean (dungeon), 119 vitest pass, `next build` green, face rendered to
PNG. Tavern is DOM-verified via build/tsc (no jsdom in-repo — needs in-browser
playtest); the plan named a 3D scene but a DOM overlay reuses the loadout state
and pauses cleanly, matching the existing shop.

---
**Cadence:** one slice at a time → tsc + vitest + headless screenshot → commit +
deploy → user tests → next slice. Update this file's ⬜/✅ as we go.
