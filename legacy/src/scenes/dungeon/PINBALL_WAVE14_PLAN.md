# Pinball Knight — Wave 14 Plan

Scope: the merchant, item legibility, ramp vaults, wall-breaking, floor structure,
pinball-table feel, and the zombie's silhouette.

Everything below was verified against the real code (and, where noted, against the
running game in headless chromium). File:line references are to
`src/scenes/dungeon/` unless stated otherwise.

Companion docs — read first, they are the record of what is already built:
`PINBALL_ROADMAP.md`, `PINBALL_HYBRID_PLAN.md`.

---

## Part 0 — Direct answers to the three questions

These needed research, not work. Answering them here so the reasoning behind the
waves below is on the record.

### 0.1 "What qualifies being able to break a wall?"

**Two different systems**, both gated purely on momentum speed. No weapon, no
button, no action — you break walls by *arriving fast enough*.

| | Cracked secret band | Ordinary wall ("kool-aid") |
|---|---|---|
| Speed needed | `SECRET_BREAK_SPEED = 7` (`constants.ts:656`) | `WALL_BREAK_SPEED = 15` (`constants.ts:664`) |
| What qualifies | Tile marked `T_CRACKED` at generation | Any interior `T_WALL` **with floor one tile beyond in your direction** (`secrets.ts:103-107`) |
| Visual tell | **Yes** — jagged fissure + gold glints (`build.ts:299-325`) | **None** |
| Reward | Gold + a random power-up + possible Speed Witch (`secrets.ts:23-28, 67-82`) | Just the shortcut |
| Count | 2 at L1 → 5 from L7 (`constants.ts:667-669`), plus 5–10 launch-target bands |

Cracked bands are chosen where a wall has **floor on two opposite sides**
(`generator.ts:255-256`), so breaking one always opens a real shortcut, and picks
are spaced ≥8 Manhattan apart.

The 15 u/s ordinary-wall break is close to unreachable in practice: it also needs
walkable floor exactly *one* tile beyond, but `thickenWalls` makes every band **two**
tiles thick (`generator.ts:290-305`). So it only fires where a band was already
thinned by room-carving or the artery widener. **This is a latent dead feature** —
see Wave C.

### 0.2 "Is the maze size always the same?"

**No — it grows with depth, then hard-caps.** `constants.ts:1170-1171`:

```
cellsW = min(17 + ceil(level * 1.4), 33)
cellsH = min(12 + level, 25)
```

Final tile grid is `(4·cellsW + 2) × (4·cellsH + 2)`, and 1 tile = 1 world unit.

| Level | Tiles | Note |
|---|---|---|
| 1 | 78 × 54 | |
| 5 | 98 × 70 | |
| 11 | 134 × 94 | width caps here |
| 13+ | 134 × 102 | **both capped — every floor identical in size forever** |

Shape varies too: windiness cycles `[1.0, 0.3, 0.65]` by `(level-1) % 3`
(`constants.ts:1140`), braid rises to a 0.4 cap, rooms 3→8, prefabs 3→6.

So floors differ meaningfully up to L13 and are same-size-different-topology after.
The stale comment at `constants.ts:1167` claims L1 is "~72×52" — it's 78×54. Fix it.

### 0.3 "With ramps we can't jump over the maze wall"

Confirmed, and the cause is **not** the hop's reach.

- Reach is `RAMP_HOP_MAX = 4.75` units; a wall band is 2.0 units. Geometrically
  fine — the constant's own comment says it "clears a 2-thick band + a corridor".
- The real cause is **aim**. Ramps are placed on `"straight"` topology
  (`decorate.ts:430`), which by definition points **along** the corridor, parallel
  to the walls (`decorate.ts:174-180`). Then `openLaunchTargets` *guarantees*
  ≥`MIN_RUNWAY = 3` open tiles on that exact ray (`decorate.ts:190-191`).
- `startRampHop` scans far→near and takes the first walkable
  (`player.ts:1252-1258`), so `d = 4.75` is open floor on the very first sample.
  You land 4.75 units down the same lane. **There is never a wall on the ray to
  clear.**
- Reinforcing the weak read: `RAMP_HOP_HEIGHT = 1.1` is *exactly* `WALL_H = 1.1`
  (`constants.ts:402`, `:194`). The arc only ever grazes the top of a wall, and
  only instantaneously. Compare `TRAPDOOR_HEIGHT = 1.8`.

Fix is directional, not numerical. See Wave C.

---

## Wave A — The merchant (highest value per line changed)

**Symptom:** rides the edge of the maze, rarely seen.

**Diagnosis — three compounding defects, all confirmed:**

1. **It cannot path.** `updateMerchant` (`npc.ts:313-349`) is straight-line
   repulsion. `bfsDistances`/`flowStep` are imported (`npc.ts:39`) but used only by
   the frog. A repulsion-steered agent in a maze always ends up in the corner
   topologically furthest from the pursuer — on a rectangle, that's the perimeter.
2. **The wall-bounce is dead code while fleeing.** `npc.ts:344-345` negates the
   blocked heading component, but `npc.ts:331-333` unconditionally overwrites the
   heading with raw away-from-player on the very next tick whenever you're within
   `MERCHANT_FLEE_RANGE = 4`. So it presses *into* the wall and `moveCircle`'s
   per-axis clamp (`collision.ts:180, 197`) turns the blocked component into pure
   tangential slide. The slide sign is stable while you stay on one side of it →
   it rides that wall in one direction indefinitely.
3. **It starts pinned.** `core.ts:1040` asks `nearestOpenTile(grid, start, 6)`
   intending "a few tiles out", but that helper returns the 6th walkable tile in
   the **r=1 ring** (`core.ts:1161-1175`) — about 1 unit away, already deep inside
   the flee range. It is fleeing from frame one, in a near-deterministic direction.

**Also:** `MERCHANT_FROM_LEVEL = 2` (`constants.ts:619`), so it never appears on
floor 1 at all — verified live. And `n.shopped` is set (`npc.ts:321`) but read
nowhere except debug telemetry, so the "once shopped it mills about" comment at
`npc.ts:310` describes behaviour that does not exist.

**Plan:**

- **A1. Give it a flow field.** Flee along `flowStep` on a BFS field seeded from
  the player and inverted, so it routes *around* corners instead of pressing into
  them. The helper already exists and is already imported.
- **A2. Make the bounce authoritative.** When blocked, commit to the tangential
  heading for a short dwell (~0.4s) that flee mode may not overwrite. This alone
  kills the wall-riding even without A1.
- **A3. Spawn it properly.** Fix the call site to request a genuinely distant tile
  (ring r≥5), or add a `minRadius` argument to `nearestOpenTile`. Consider a
  separate audit of that helper's other callers — the `n`-th-walkable semantics are
  a trap.
- **A4. Make it findable.** It should be an event you can *seek*: a cart-bell SFX
  on a timer that gets louder with proximity, and/or a HUD edge-marker. Right now
  it flees out of the viewport in the first two seconds and is gone.
- **A5. Honour `shopped`.** After a purchase, drop to amble speed permanently —
  it has your gold, it has no reason to keep running.
- **A6. Decide: floor 1?** Currently absent. Recommend leaving it from L2 so the
  first floor stays a clean tutorial, but the bell (A4) makes it worth revisiting.

**Verification:** re-run the position tracer — assert the sampled x/z spread covers
a real fraction of the floor extent, and that it is catchable while sprinting.

---

## Wave B — Items: make effects legible, cut Multi-Ball

**The real inventory is bigger than "10":** 10 potions (`items.ts:156-179`),
14 cards (`cards.ts:63-84`), 8 weapons, 3 gear slots.

**Diagnosis:** the good ones are good because the *world* shows the effect, not the
HUD. Curve Shot works because you watch the bullets bend (`projectiles.ts:241-249`).
Freeze is the best in the game because every enemy visibly tints and stops
(`zombie.ts:163-167`). The bad ones are pure arithmetic.

Invisibility ranking (worst first):

| Item | Mechanic | Why it's invisible |
|---|---|---|
| **All 14 cards** | `damageFlat`/`damageMult`/`cooldownMult`/`onHit` in `aggregateCards` (`cards.ts:111-126`) | Socketing +60% damage changes *nothing* on screen |
| **Rage** | ×2 damage (`combat.ts:66`) | No tint, no bigger slash, no damage number |
| **Shield** | invulnerability early-return (`combat.ts:476`) | No bubble — reads as "enemies missed" |
| **Helmet / armor** | silently soak (`items.ts:198-221`) | `destroyed` is returned but no VFX consumes it |
| **Boots** | ×1.18 speed (`player.ts:1697`, `BOOTS_SPEED_FACTOR`) | Real effect, zero indication |
| **Ball Form** | sets `ironT`+`turboT`+`springT` | One shake at pickup, then nothing |
| **Haste** | ×1.45 move | Felt, not seen — no trail |
| **Magnet Boots** | repel + magstrip launch | Only visible near a crawler or a strip |

**Plan:**

- **B1. Delete Multi-Ball.** ~25 sites, fully mapped, **no test references**.
  Order: `items.ts:138,173-174,181` → `state.ts:57-58,458-462,622,718-719` →
  `core.ts:49,1218,1352-1388,1551,1651-1654,1741,1749-1750,1783` →
  `player.ts:1936-1978` → `hud-diablo.ts:459`, `ui.ts:404`, `dispose.ts:40-48`,
  `decorate.ts:137`, `cel-painter.ts:2215`, `constants.ts:1247-1250`.
  **TRAP:** `player.ts:529-545` / `constants.ts:519` "MULTIBALL FRENZY" is the
  *bounce-combo* bonus — a different feature. Do not delete it. Rename it to
  `FRENZY` in the same pass to remove the collision permanently.
- **B2. One world-space tell per buff.** The rule going forward: *if it has a
  timer, it has a look.* Shield → a visible bubble shell + a spark on each blocked
  hit. Rage → red blade trail and a heavier hit flash. Haste → speed lines /
  afterimage (the aura system at `player.ts:236` already exists, just drive it from
  `hasteT` too). Ball Form → actually change the knight to the ball silhouette.
- **B3. Make cards visible on the weapon.** At minimum, tint the slash colour by
  the dominant socketed card (`onHit: chill` → cold blade, `burn` → ember). The
  slash already has a `slashColor` hook (`items.ts:56-65`).
- **B4. Add `description` to `PotionDef`.** It has none (`items.ts:142-154`), which
  is why the mechanic text is hand-duplicated in three places (`hud-diablo.ts:455-466`,
  `core.ts:1546-1553`, `ui.ts:399-408`). Add it once, thread into `showPickupNote`,
  delete the duplicates. Today the *shop* explains items better than picking them
  up does — pickup shows only a name.
- **B5. Fix the buff-tile lie.** `hud-diablo.ts:458` uses `turboT` as the proxy for
  "Ball Form", but the Speed Witch (`npc.ts:278-279`) and the flipper-charge ability
  (`abilities.ts:89`) set `turboT` *without* `ironT` — so both light up a tile
  labelled "Ball Form" incorrectly. Track the three timers separately.
- **B6. Give boots a tell or cut them.** +18% speed with no indication is the
  definition of an item that "doesn't do anything visible."

---

## Wave C — Ramps that actually vault, and walls worth breaking

**C1. Perpendicular ramps (the actual fix for the jump complaint).**
Add a `"vault"` placement class: a ramp on a corridor tile aimed **across** the
band, chosen only where `[wall band] → [floor]` lies within `RAMP_HOP_MAX`. This is
a `decorate.ts` change (new topology/aim rule + a budget), not a physics change.
Keep some ramps along-corridor — they're a good dash pad — but the floor should
guarantee at least 2 vault ramps so the mechanic is discoverable.

**C2. Make the hop read as a jump.** `RAMP_HOP_HEIGHT` must exceed `WALL_H`.
Raise to ~1.7 and add a shadow that shrinks with altitude — that shadow is what
sells airborne-ness in an iso view.

**C3. Validate the landing.** `updateHop` lerps blind and only endpoint-checks at
launch (`player.ts:1252-1259`); if no landing is found the hop is *silently
skipped* and you get only the flat dash. Make the failure explicit (a stumble, or
fall back to the along-corridor hop) so it never feels like the button did nothing.

**C4. Make ordinary wall-breaking reachable.** It currently needs 15 u/s *and*
floor one tile past a two-tile band — nearly impossible by construction (see 0.1).
Either (a) probe two tiles ahead so it works on real bands, or (b) drop the
concept and lean entirely on cracked bands. **Recommend (a)** — a genuine
"smash through anything at full speed" is the most pinball thing in the game.

**C5. Teach the crack.** Cracked bands have a good visual tell already, but nothing
teaches that *speed* is the key. Add a one-time hint the first time the player
bounces off a cracked band below `SECRET_BREAK_SPEED`.

---

## Wave D — Actual pinball structure

Per `PINBALL_ROADMAP.md`, the *parts* are done — 16 kinds, all placed, rendered and
physics-wired, plus lit bumpers, jackpot, drop-target banks, flipper aim-assist,
booster lanes, three-zone floors. **Do not re-propose those.** What's missing is
one layer up: the table's *topology*.

**D1. Chain placement — the keystone.** This is the one item from the roadmap's own
open list that was never built, and it's the root cause of "it doesn't feel like a
pinball machine." The corridor deal has an explicit **anti-clustering rule**:

```
decorate.ts:765   if (parts.some(q => |q.i-cand.i| + |q.j-cand.j| < 3)) continue; // spacing
```

Parts are also validated only *negatively* — `openLaunchTargets` guarantees a
launcher isn't aimed at rock, but **nothing is ever placed because another part is
in its trajectory.** A pinball table is precisely the opposite: a bumper exists to
feed the slingshot that feeds the ramp.

Replace the spacing rule with a **chain seeder**: place a launcher, trace its exit
ray, and place a receiver (bumper/deflector/mirror) where the ray lands — then
recurse 2–4 links. Keep spacing only as a fallback for leftover budget.
This is the single highest-impact change in this document.

**D2. Orbits / loops.** No closed circuit exists. The 4 corner deflectors in big
rooms (`decorate.ts:596-607`) are independent point-triggers, not a loop with a
completion event. Add a real orbit: a ring of banked corners around a room with a
"loop completed" scoring event.

**D3. Parallel rollover lanes + lane change.** Booster lanes are single-file rows of
3 same-aimed pads (`decorate.ts:808-810`). Real tables have 3–5 *parallel* lanes
with per-lane lit state. Add lane arrays with rollover lights, and lane-change on
the dodge key — instantly recognisable as pinball.

**D4. Skill shot + plunger.** Nothing hooks the floor-entry moment, and the start
area is deliberately made *calm* (`decorate.ts:740` skips parts within Manhattan 4
of start). Give each floor a plunger lane: spawn on a spring, one lit target,
bonus for hitting it on the launch. This makes every floor *open* like a pinball
table instead of like a maze.

**D5. Named shots + combo identity.** Combos count any bounce/part hit generically
(`constants.ts:344, 519-521`). Give shots identities (ramp→orbit→bank) and score
named combos. This is what turns motion into *play*.

**D6. Lit-shot indicator.** The light vocabulary today is bumper-gold, bank
green/red, flipper-gold. There's no "shoot here now" — the thing that makes a real
table legible at a glance.

**D7. Cheap cleanups.** `decorate.ts:521` claims some bumpers swap to slingshots;
the code never does (bumper rooms are 100% bumpers). Either implement or delete the
comment.

---

## Wave E — The zombie stops being a blob

**Root cause is measurable.** Sprites are painted at 128px then crushed to a 52px
grid (`sprite.ts:158-205`). Anything thinner than ~2.5 painted px disappears. The
zombie's ribs are 1.8px wide (`cel-painter.ts:1034`), claws 1.6px, teeth 1.5px —
**all of its detail is sub-pixel after the crush.** The knight survives because its
features are wide, hard shapes.

Confirmed visually in-game: the knight reads instantly at gameplay zoom (red plume,
bright steel, gold trim) while zombies read as pale smudges on the floor.

Same rig (`figure.ts:353`), used very differently:

| | Knight | Zombie |
|---|---|---|
| Shoulder→hip | 17→9 (ratio 1.9), **plus pauldrons** | 13→8 (ratio 1.6), nothing |
| Silhouette breakers | plume, pauldrons, faulds, tassets, greaves | **none** — a quad torso + 2 tubes + an oval head |
| Hard-black anchor | T-visor, "the only pure-INK on the figure" (`:506`) | 4px sockets — ~2 dots after the crush |
| Palette | steel 19-21 + gold 16 + blood 11-13 (3 hue families) | skin **all within indices 6-9**, rags 26-29 |
| Backlight rim | `{ backlight: 30 }` on torso + helm | **none** |
| Clips | idle 4, walk 8, run 8, attack 4, roll 4, ball 4 | idle 2, walk 6, death 4 — **no run/attack** |
| Walk animation | swing, roll, lean, plumeLag | bob/stride/lurch only — **arms never move** |

**Plan, in impact order:**

- **E1. Silhouette, not detail.** Add ≥4px structural breaks: an asymmetric broken
  shoulder spur, a hanging jaw that breaks the head's oval, one long trailing rag
  drawn *behind* the body. This is what pauldrons/plume do for the knight.
- **E2. Hard-black facial anchor.** A single pure-ink void ≥8×6px for jaw+sockets
  with the glowing pupils inside it. The knight's own comment calls this its most
  load-bearing readability feature.
- **E3. Backlight.** One-line change at `cel-painter.ts:1028` and `:960` —
  `{ backlight: 30 }`. Free separation from the dark floor; already proven.
- **E4. Break the palette out of the green band.** Add bone-white ribs/skull —
  `R_BONE [20,21,22]` already exists at `figure.ts:52` and the zombie never uses it.
  A light value against green is what makes limbs separate.
- **E5. Widen the rig + lengthen arms.** `shoulderW 13` vs `hipW 8` is a barrel;
  arms need to break the torso outline (`armReach` is 26 in profile, 16 otherwise).
- **E6. Articulate the walk.** The `swing`/`roll` pose channels already exist in
  `figure.ts`; the zombie walk just doesn't use them (~10 lines).
- **E7. Give the Reaper real art.** It's the last tint-only reskin in the roster —
  it borrows the ghost sheet with `REAPER_TINT` (`core.ts:1684-1690`).

Note: size is *not* the problem (brute/boss scale the same body fine), and the
52px crush is shared with the knight, which reads well.

---

## Suggested sequencing

| | Wave | Why here | Rough size |
|---|---|---|---|
| 1 | **A** merchant + **B1** cut Multi-Ball | Pure bug/deletion, unblocks a clean base | S |
| 2 | **E1-E4** zombie silhouette/palette/backlight | Highest visual return per line; self-contained | S–M |
| 3 | **C1-C3** vault ramps | Directly answers a felt complaint | M |
| 4 | **B2-B5** buff legibility | Makes existing content feel real | M |
| 5 | **D1** chain placement | The keystone — biggest change to how the game *plays* | M–L |
| 6 | **D3-D5** lanes, plunger, named shots | Builds on D1's chains | L |

Waves 1–4 are cleanup and legibility: the game already has the content, it just
doesn't *show* it. Waves 5–6 are the real design work.

## Wave 14b — D2-D5 + the holo cards (SHIPPED)

Everything deferred above is now built, plus a card-art overhaul.

- **D2 ORBITS** — the four corner rails of a big room are now one tagged
  CIRCUIT (`orbit` + `orbitSeq`), not four unrelated point-triggers. Railing
  them in clockwise order without lapsing completes a LAP; laps ladder in value
  across a floor. A partial ring has its tags stripped at generation, so an
  un-completable circuit can never ship (unit-tested).
- **D3 ROLLOVER LANES** — a new `rollover` part kind, dealt in PARALLEL banks
  of 3 across a corridor with open floor on both sides so you roll *through*
  them. Each lane has its own lamp; light them all to clear the bank. Tapping
  dodge performs the classic LANE CHANGE, rotating which lanes are lit.
- **D4 PLUNGER + SKILL SHOT** — every floor now OPENS by firing the knight into
  play, aimed at a lit skill target. Hit it inside the window for a bonus. The
  floor used to start with you standing still in a deliberately calm corner,
  which is a maze's opening, not a machine's.
- **D5 NAMED SHOTS** — every meaningful hit now records a shot IDENTITY
  (ramp/orbit/bank/lane/target/skill/trapdoor) into the live combo chain, and
  sequences are matched against a named-combo table (ORBIT RUNNER, THE CIRCUIT,
  GRAND TOUR…). Each name pays once per floor so hearing it stays an event.
  All of it lives in `shots.ts`, so player.ts stays physics.

- **HOLO CARDS** — the tavern's cards are now painted with a port of the
  congress/senate card engine (`trading-client/frontend/src/lib/holoCardEngine.js`),
  in `render/holo-card.ts`. Same 63:88 ratio painted at 512×716 onto a canvas,
  same anatomy (stage pill, name, PWR, energy emblem, bevelled art window,
  plaque, moves box, stats strip, rarity + set footers), same stacked rarity
  treatment (foil stripes → metallic wash → etched engraving → tiled
  reverse-holo → one `overlay` foil pass), same seeded LCG so a card's speck
  field never churns. The one deliberate divergence: the original swaps in a
  shared three.js plane for a GLSL tilt shader, but this game already owns a
  WebGL context, so the tilt is a CSS 3D transform plus a pointer-tracked glare
  — same feel, no context arbitration.

## Open questions for the user

1. **Cards (B3):** 14 cards with no visual is a lot of surface. Make them visible,
   or fold them down to fewer, stronger, visible ones?
2. **Merchant on floor 1 (A6):** keep L1 as a clean tutorial, or let it show up?
3. **Ordinary wall-breaking (C4):** repair it into a real mechanic, or drop it and
   let cracked bands be the only breakable thing?
4. **D scope:** D1 alone will change the game's feel substantially. Worth doing and
   playing before committing to D3–D5.
