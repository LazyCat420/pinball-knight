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

## Slice 7 — Flipper telegraph + redirect ⬜ (RECONCILE)
Flippers already auto-catapult on contact. Q/E are abilities now, so DON'T
rebind. Instead: make the flipper **redirect momentum along the paddle angle by
approach** (aim-assist) + a clear pre-swing telegraph + a stronger snap. Only add
a key-activation if playtest wants it (candidate: hold RMB near a flipper).
- `player.ts` flipper branch + `pinball-parts.ts` telegraph.

## Slice 8 — Momentum lanes ⬜ (RECONCILE)
Magstrip currently SLOWS (anti-speed) — don't repurpose it. Add lane behaviour as
paired **guide strips** (or a new lightweight "channel" concept): two rails 1 tile
apart, 3-4 long, that funnel a moving player to the centre and hold speed down
the lane (center-channel feel). Placed as a lane, not singletons.
- `decorate.ts` (lane placement) + `player.ts` (funnel force) + `pinball-parts.ts`.

## Slice 9 — Three-zone floors ⬜ (the big structural loop)
Partition each floor into **launch district → machine core → drain lane** by
BFS-distance bands from start→stairs: launch = wide + ramps + low friction + few
enemies; core = open bumper arena + dense enemies; drain = tight + flippers/
mirrors + boss/reward. Zone drives room-archetype choice, corridor width,
friction surface, and enemy density.
- `decorate.ts` + `generator.ts` + `core.ts`. The capstone that uses slices 2/4/5/8.

---
**Cadence:** one slice at a time → tsc + vitest + headless screenshot → commit +
deploy → user tests → next slice. Update this file's ⬜/✅ as we go.
