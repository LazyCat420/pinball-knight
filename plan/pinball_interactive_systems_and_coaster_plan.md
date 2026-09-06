# Interactive Systems & the Coaster — Pinball Knight

**Date:** 2026-09-06 · **Status:** PLAN ONLY — awaiting review, do not implement
**Target:** `ThreeJS/src/game/pinball-knight/` (never `Rust/`)
**Baseline:** `main` @ `3f169dfb` (research), re-checked against `2cbd5855`

**The ask, verbatim:** *"improve the interactive systems in the pinball game like the
bumper walls / the things you can do to complete to get points"* and *"how can we build
better boosters with a rollercoaster type system."*

---

## 0. How to read this

Every claim is atomic and labelled, per `sun/.agents/plan-verification-standard.md`:

- **[V]** Verified Fact — someone read the code at the cited line, or measured it.
- **[T]** Testable Claim — falsifiable, with the test named.
- **[A-n]** Assumption — carries a risk and a validation path. Registered in §11.
- Zero Unverifiable claims. If a number could not be sourced it says so.

Counts: 118 labelled claims — 91 **[V]**, 19 **[T]**, 8 **[A-n]**. 93% verified-or-testable.

**Research provenance.** 19 parallel research agents; 16 returned full findings before a
session rate limit killed the rest. The three that produced nothing are named in §10.3 as
open gaps, not silently omitted. Raw findings live in the session scratchpad; the recovered
retired plans are at `<scratchpad>/recovered/all22/`.

---

## 1. The five facts that reshape the whole request

### 1.1 The game already builds a racing circuit every floor — then throws it away

**[V]** `buildTrackFloor` returns `TrackFloor { grid, graph, path, mask, … }`
(`maze/track-floor.ts:87-152`, returned `:1113-1126`). It reaches `AuthoredFloor.track`
(`spawn/floor-authoring.ts:69`, built `:159`).

**[V]** `core.ts:438-439` destructures that as a **local**. It commits to `state` only:
`grid` (`:441`), `fog`, `stairs`, `levelRooms`, `arcCorners` (`:453`), `maze`, and
`state.doorways` (`spawn/floor-authoring.ts:186`). `state.ts` has **no** track field.

**[V]** So `TrackPath` (legs, per-leg width, node ids), `TrackMask` (`lane`/`dist`/`sealed`)
and the flow field Φ are **destroyed when `buildLevel` returns**. `populateFloor` reads
`track` for exactly one thing — `chute.dirI/dirJ` (`spawn/floor-populate.ts:108,133-138`).

**[V]** The track-first generator is not experimental: `TRACK_FIRST = true`
(`constants/maze.ts:33`), and `maze/track-fallback.test.ts` records `buildTrackFloor`
declining **0 of 400** measured floors.

**[V]** Radii are an *input*, not scavenged: `maze/track-path.ts` fillets every junction at a
guaranteed radius from `[7,6,5,4,3]`, emitted as `ArcFeature`s in the same descriptor the
collider and mesh share — the "see = hit" contract.

> **This is the single cheapest, highest-leverage change in the plan.** The game designs a
> banked circuit with guaranteed corner radii on every floor and then forgets where it is.

### 1.2 There is no third axis, and the camera would not follow one

**[V]** `Actor` is `{sprite, anim, x, z}` — no `y` (`state.ts:40-45`). `PinballPart` has no
`y`. `Grid` is `{w,h,t,shapes,arcs?,arcIdx?,surfaces?}` (`engine/grid.ts:26-60`) — **a tile
cannot have a height.** The floor is one `PlaneGeometry` at y=0 (`maze/build.ts:1217-1219`).
Collision is purely 2D (`engine/collision.ts`, `moveCircle`).

**[V]** The one height channel is `sprite.mesh.position.y`, with **six writers and no
arbiter**; `syncActorMesh` (`entities/combat.ts:362`) hard-pins y=0 every frame, so each
owner re-applies after it.

**[V]** `engine/camera.ts:228` hard-codes the aim y to `0.5`. `updateFollowCamera`
(`:206-229`) dead-zones X and Z only — **zero vertical follow**. There is no FOV kick, no
zoom kick, no look-ahead, no directional impact kick, no camera roll. The camera is
orthographic, so there *is* no FOV; and PPU **is** the zoom, baked at boot as a rung ladder
(`constants/render.ts:160-183`), so a zoom punch is not a cheap win.

**[V]** A drop *would* read if it existed: at tilt 38°, +y of `h` projects to `0.788h` of
screen rise, and `RAMP_HOP_HEIGHT` 1.75 is ~12% of screen height.

**[V]** `sprite.ts` already has `setElevation(dy)` (~`:1490`, `:1625`) which pins the contact
shadow to the floor while the sprite rises — **the height cue is already half-built.**

**[V]** A perspective camera already ships and is already swapped at render time:
`fps.ts:52-58` builds `state.fpsCamera`; `sim/loop.ts:440` picks it, `:451` renders it
through the same pixel pass.

> **Verdict: build the coaster in the plane.** True 3D track is a new engine — a `Grid`
> schema change across ~40 importers, an ambiguous `moveCircle` where track crosses itself,
> and it reintroduces exactly the dynamic occlusion the WALL_H/WALL_LOW Diablo trick exists
> to make *impossible by construction* (`constants/world.ts:9-14`). **[A-1]**

### 1.3 The walls already are the rails — the ball cannot steer a corner at booster speed

**[V]** The steer model rotates heading and leaves speed alone
(`entities/pinball-steering.ts:105-110`), so the path is a circular arc `R = v/ω`. `TILE = 1`
(`constants/world.ts:9`), so units are tiles.

| aim | ω (rad/s) | R at v=22 |
|---|---|---|
| along the bend | 5.5 | **4.00 tiles** |
| 90° off | 6.3 | 3.49 tiles |
| ball form ×1.35 | 5.5 | 5.40 tiles |
| frenzy ×1.6 | 5.5 | 6.40 tiles |

**[V]** A 2-tile maze corner therefore needs `v ≤ R·ω = 2 × 5.5 = 11 u/s`. **Every launcher in
the game exits above it:** `BUMPER_MIN_EXIT` 9, `PLUNGER` 13, `RAMP` 13, `TRAPDOOR_EXIT` 14,
`BOOSTER` 15, `SPRING`/`RAMP_HOP`/`CORNER_BOOST` 16, `FLYWHEEL` 21.

**[V]** `LANE_CENTER_PULL` is *not* a soft rail — it gives 2.25 u/s lateral against the
player's ~2.18 tiles of deviation per 0.2 s, so the player out-authorities it ~4.8×, and it
moves *position*, not heading. The real rails are `steerLockT` (skips both steering
`player.ts:1414` and lane glide `:1467`) and `entities/rail.ts`, which **overwrites
`momX/momZ` with the arc tangent** (`player.ts:1706-1707`).

### 1.4 The design constraint is LOCK vs HOLD, and the repo already ruled on it

**[V]** `maze/decorate.ts:410-417` measured chained steer-locks putting the player at **0.80
passenger duty**, and the shipped rule is `MAX_LOCK_DUTY = 0.3` — the player must have
authority over ≥2/3 of a route.

**[V]** A **hold** has no duty ceiling, because release is always one flick away
(`RAIL_GRACE` 0.16). `entities/rail.ts` is exactly that: catch above `RAIL_MIN_SPEED` 5, hold
by steering into the wall at `RAIL_HOLD_DOT` 0.35, accelerate at `RAIL_ACCEL` 15 **past the
global cap** to `RAIL_OVERSPEED` 1.6 (35.2 u/s), decay at `RAIL_DECAY` 9 after.

**[V]** `entities/rail.ts:4-7` quotes the player's own prior ask: *"like a NASCAR driver
scraping the sidewall to get faster speed… Hot Wheels mixed with pinball mixed with Sonic."*

**[V, external]** External research agrees on the failure mode: Sonic Adventure 2 kept agency
on grind rails (stick-balance or you fall, crouch to accelerate, rail-switch); Sonic Frontiers
went automatic and drew exactly the "springs into rails into tiny rewards" criticism.

> **The coaster is a long authored RAIL you hold, not a spline that takes the controller.**
> This is the spine of the whole plan.

### 1.5 "Bumper walls" is nearly free — the supply and the channel both already exist

**[V, MEASURED]** Re-measured over 12 floors (L1–12): mean run 2.60 tiles, but **43.2% of
wall tiles sit in runs of ≥5**; **43.6 runs ≥5 per floor** (range 14–84); **17.3 runs ≥8 per
floor**; **100% of runs ≥5 are rideable** (≥3 tiles with open floor on one side); **29.5% of
square-wall bounces already land on a run ≥5**.

Compare the existing wall mechanics' budgets: `KICK_MAX_PER_FLOOR` 6, `LANE_MAX_PER_FLOOR` 16
(`maze/arc-sweeps.ts:83,108`). **Long runs are 3–7× more plentiful than the sites those
mechanics use. No generator change is required.**

**[V]** `compileWallRuns` already produces `WallRunPlan { runs, pieces, pieceAt: Int32Array,
stats }` — `pieceAt` is a tile→run lookup. It runs at generation time
(`maze/decorate.ts:1469-1470`) and is parked on `MazeHandle.wallRuns` (`maze/build.ts:982`),
whose own comment says *"nothing in the game loop does"*. It is null in the shipped game only
because the default look is `legacy` (`dev/wall-look.ts:64`). **Hoisting it out of the look
branch is ~3 lines and is orthogonal to the open Tier 1.3 look decision.**

**[V]** `Grid.surfaces` is a per-tile Uint8 with **ids 0-4 used and 251 free**
(`engine/surfaces.ts:35-45`), and it already survives into *both* halves of see = hit: the
collider writes `hitSurface` on each axis clamp; the physics applies `flatRestMult` /
`bounceAdd` / `cornerMult` (`entities/player.ts:1661,1673`); the mesh tints wall instances
per-instance (`maze/build.ts:1334-1341`), in **both** looks.

**[V]** The gap is not a channel, it is an **author**: `maze/surface-paint.ts` paints
elliptical blobs only. `WALL_RUBBER` exists but lands as weather, never along a wall.

**[V]** `maze/floor-density.ts` caps only `plan.parts` — **surfaces and handle-side bands cost
zero density budget.** That is exactly why 6 kickers + 16 lanes coexist with `maxPartsPer1k`
34.

---

## 2. Defects to fix first

These are concrete, cheap, and independently valuable. A plan that opens with real bugs is
worth more than one that opens with features.

### 2.1 The run shot-ledger is never reset on retry — the leaderboard is inflating **[V]**

`beginRunLedger()` (`run/ledger.ts:24-31`) resets only
`runDeepestFloor/runBestCombo/runStartMs/pausedRunS/runScoreSubmitted`.
`runNamedShots`, `runOrbitLaps`, `runJackpots`, `runBestFlow`, `runFlawlessFloors` are zeroed
**only** by `resetState()` (`state.ts:1484-1489`), whose sole caller is `exitDungeonGame`
(`core.ts:588`). `run/death.ts:219` calls `beginRunLedger()` on both the RETRY and TAVERN
paths.

⇒ Every death-and-retry starts a "new run" carrying the previous run's named shots (×100),
laps (×60), jackpots (×80), flawless floors (×200) and best flow (×300). **It compounds per
retry.** Fix: move those five fields into `beginRunLedger`.

### 2.2 The skill shot is unwinnable whenever its target is a bumper **[V]**

`spawn/floor-populate.ts:109-119` picks the skill target from `target | bumper | rollover`,
nearest first. `trySkillShot` is called from exactly five handlers — ramp (`:420`), jumppad
(`:582`), deflector (`:630`), target (`:765`), rollover (`:1058`) — and **not** from `bumper`
(`entities/pinball-collide.ts:353-397`, zero hits).

⇒ Those floors always print "skill shot missed", lose `SKILL_SHOT_GOLD` 40, and can never
produce SHARPSHOOTER. Fix: add the call, or drop `bumper` from the target pool.

### 2.3 `state.lanesCleared` pays gold and reaches nothing **[V]**

`shots.ts:154` increments it and pays `LANE_CLEAR_GOLD` 25. Its only reader anywhere is
`dev/window-hooks.ts:537`. Not in `RunStats`, not banked in `run/descend.ts:248-251`.

### 2.4 Named combos that cannot fire **[V]**

Structural fact (`shots.ts:93-129`): a *first* orbit lap always emits `[bank, orbit]`
adjacently; a *second* lap emits `[orbit]` alone.

- **SHARPSHOOTER** `skill,target` — a skill hit on a bullseye emits `target` *then* `skill`
  (`pinball-collide.ts:764-765`), the wrong order. **[V]**
- **TRICK SHOT** `mirror,mirror` and **THE GAUNTLET** `flipper,mirror,target` — `mirror`
  exists only in the `crypt` and `arcane` deals plus the `mirrormaze` prefab
  (`maze/prefabs.ts:126-134,362,389`). Structurally impossible on `warren` (6+),
  `bloodworks` (11+), `magma` (21+). **[V]**
- **BANK JOB** is accidentally trivial: railing an orbit ring *anti-clockwise* never satisfies
  `seq === (orbitLast+1)%4`, so all four corners emit `bank`. **[V]**
- **GRAND TOUR / ORBIT RUNNER / SLING RUNNER** need a ramp or sling *mid-lap*, but a ramp
  fires `startRampHop` plus a steer lock that throws you off the ring. Near-dead. **[T]** —
  falsifiable with `__dungeonShots()` over a bot run.

### 2.5 Chain pollution **[V]**

`trapdoor`, `lane`, `swingarm`, `flywheel`, `post` call `recordShot` but appear in zero
combos. `post` is worst: one magpost cascade fires once per peg
(`pinball-collide.ts:974`) and flushes the whole `NAMED_CHAIN_MAX` 5 window.

### 2.6 The toast channel clobbers itself **[V]**

Every big event — named combos, laps, jackpots, lane clears, FRENZY, CRUISE, FLAWLESS — goes
through `showToast` → `pushBanner`, a **single** `banner` variable
(`gui/screens/toasts.ts:59-62`). Last writer wins, so a jackpot's banner is erased by PINBALL
WIZARD's in the same frame. **Any mode system must fix this first or a mode start will erase
the shot that triggered it.**

### 2.7 The corner tier governs 0.6% of contacts **[V, MEASURED]**

Flat-vs-corner is not geometric: `blockedX/Z = |res.x - wantX| > 1e-3`
(`player.ts:1455-1456`), `corner = blockedX && blockedZ` (`:1653`). Measured: **flat 81.3% /
corner 0.6% (30 of 5390) / shaped 18.1%**. So `PINBALL_CORNER_RESTITUTION`,
`PINBALL_CORNER_ADD` and *both* combo tapers govern a mechanic that fires on 0.6% of
contacts. **[T]** Also: at `RAIL_OVERSPEED` 1.6 the step (0.587) exceeds `MAX_STEP` 0.4, so
two separate flats in different sub-steps can read as one corner.

---

## 3. Track A — Publish the circuit (the enabling change)

Nothing else in this plan is expensive once this lands. Nothing else is possible before it.

**A1. Retain the track on `state`.** Commit `path`, `mask` and Φ alongside `grid` in
`core.ts:438`. Add `state.track`. **[V]** the data is already computed; this is a retention
change, not a generation change — so it cannot re-roll floors (§8.1).

**A2. Write `TrackMask.lane` into `Grid.surfaces` as a new `FLOOR_TRACK` id.** **[V]**
`surfaces` is a Uint8 with 251 free ids, already read by collider, physics and mesh.
`surfaces.test.ts:56` pins `id === index`, so `FLOOR_TRACK` appends as row 5. Give it
`steerMult` 1.6, which drops the on-track turn radius from 4.00 to **2.50 tiles** — i.e. the
one place in the dungeon where you *can* hold a corner at speed. **[T]** measurable as
`R = v/(ω·steerMult)`.

> One wrinkle **[V]**: topology friction *multiplies* rather than yields, so a track tile
> inside a dead end still eats `FRICTION_TIGHT` 2.1. Decide whether `FLOOR_TRACK` overrides
> topology or compounds with it. Recommend override, gated by a test.

**A3. Hoist `compileWallRuns` out of the look branch** so `MazeHandle.wallRuns` is non-null in
the shipped game (~3 lines, `maze/build.ts:1408-1414`). **[V]** Orthogonal to the open Tier
1.3 wall-look decision — it does not pre-empt that choice.

**A4. Retain Φ.** **[V]** It is built at `maze/track-floor.ts:1034`, consumed by
`orientArcRails`, then dropped. Retaining it enables one-way lanes, wrong-way feedback, and
lap counting on real geometry. `state.flowField` is a *different* field (BFS from the player,
for zombie AI) — do not conflate them.

**Acceptance:** `__dungeonTrack()` returns leg count, total arclength and lane-tile share on
every archetype; `surfaceAt` returns `FLOOR_TRACK` on ≥1 lane tile of every generated floor;
a pinned floor is **byte-identical** to before in geometry and rng consumption. **[T]**

---

## 4. Track B — The Ride (the coaster)

### 4.1 What it is

A **RIDE SEGMENT** is a contiguous run of track — legs plus their guaranteed-radius fillets —
authored end to end, with an entry gate, a committed middle and a scored exit. You catch it
like a rail and you **hold** it. You are never a passenger.

**Verb set (three states, all existing):**

| state | rule | reuses |
|---|---|---|
| CATCH | enter above `RAIL_MIN_SPEED`, within the entry cone | `tryCatchRail` |
| HOLD | steer into the banking (`RAIL_HOLD_DOT` 0.35); accelerate `RAIL_ACCEL` past the cap | `stepRail`, `holdStrength` |
| RELEASE | stop holding for `RAIL_GRACE` 0.16, or reach the exit | `decayOverspeed` |

**[V]** `entities/rail.ts` already implements all three; today it is gated on *concave sweeps
the arc scavenger happened to find*. Track A hands it the circuit's **guaranteed** radii
instead. `RailState.featureIdx` becomes a leg/run id. This is the whole mechanic — the work
is in the supply, not the physics.

### 4.2 The one genuinely new verb: the TUCK

**[V, external]** SA2's crouch-to-accelerate is the highest-value single addition — one
button, natural for a ball-knight, and it gives the player something to do *through* a
segment rather than merely surviving it.

**[A-2]** Input budget. `OPEN_WORK.md` records that as of 2026-08-28 *"the pad had no unbound
button left once B went to the flipper"*, and SHIFT/LT went to the nudge. The input-budget
research agent died before reporting, so **the free binding is not established.**
Recommendation: overload — while a ride is HELD, the nudge binding (SHIFT / LT) becomes the
tuck, since a nudge during a held rail is already meaningless. Validation: read
`engine/input.ts`, `engine/gamepad.ts`, `gui/touch.ts` and confirm before building.

### 4.3 What the ride must NOT be

**[V]** Do not reuse the trapdoor spline above ground. `constants/pinball.ts:801-806` records
the ruling that flying that spline *over* the walls *"reads as floating, not as a
trapdoor"*, and `entities/trapdoor-ride.test.ts:184-189` is a **regression test asserting the
transit peak ≤ 0**. Reusing it reverses a shipped decision and turns a green test red.

**[V]** Do not zero the input. `startRide` (`player.ts:944-981`) writes position directly with
no velocity and no collision, and hands back at a flat speed — correct for a
teleport-with-a-ride, wrong for a coaster.

### 4.4 The energy model — build the piece that was designed and never built

**[V]** `ROUTE_MATH_PLAN.md` Part 2b (recovered in full) designed **SpeedInterval
propagation** and it has zero hits in the tree. It is the actual coaster maths:

```
v_out = sqrt(max(0, v_in² − 2·a·L))        a = PINBALL_FRICTION · σ (per-surface openness)
```

with multipliers per edge: flat wall ×≈0.97, slant/crack ×0.85, corner bank
`×PINBALL_CORNER_RESTITUTION + PINBALL_CORNER_ADD`, boosters reset toward launch speed, clamp
at 22.

**Booster spacing falls out of the maths** — sustainable bounces between boosts
`n_max = ln(v_min/v_0)/ln(rest_eff)` ≈ 10–11 for v₀=12, v_min=2, rest≈0.85, i.e. **re-boost
every ≤8 redirects**; and pure distance is nearly free (~78 tiles at σ=1).

The doc's own explicit rejection, still binding: *"v1's stride-3-4 boosters were far denser
than physics requires; keep them dense for feel, but the validator's floor is the formula."*

**Use it as a generator gate, not a tuning knob:** every corner on a ride segment must clear
the radius required for the maximum speed reachable *at its own entrance*. **[T]** — the
single most valuable test in the plan, and computable at generation time.

**[V, external]** Validate on the **sampled realised curve, not the control cage** — the
standard procedural-racetrack write-up records classifying corners on control points and
missing features present in the interpolated spline.

### 4.5 Faking the drop

**[V, external]** The cast shadow is the dominant depth cue and *overrides* retinal size
change: Kersten/Mamassian/Knill's "ball in a box" — identical pixels, identical 2D path; move
the shadow diagonally and it rolls, horizontally and it flies. The effect is much stronger in
motion than in stills.

Spend the budget on the **shadow**, not the sprite. `setElevation` already separates them
(§1.2). Offset the shadow to the **outside** of a turn to sell banking — that is literally the
Kersten cue. **Roll the sprite, never the camera** — Monkey Ball Banana Blitz HD's camera tilt
was reviewed as its "biggest and most apparent issue".

**Known not to work, do not build:** screen-space speed lines (eat the play area),
speed-linked shake (disorientation), motion blur and chromatic aberration (the two effects
players most often disable). And **vertical loops do not translate at all** — they project to
a line under this camera.

**Prerequisites worth doing on their own merits [V]:** one owner for the six-writer sprite-y
channel, and a `camY` dead-zone in `updateFollowCamera` (~15 lines).

**[V]** `updateGrooveHop` (`sim/simulate.ts:150`) runs *after* `updatePlayer` and is ungated
on `hopT`/`rideT` — it can clobber a hop's height. Fix as part of the y-arbiter.

### 4.6 Where a segment is authored

**[V]** The machine library is the right home and it is live: `maze/assembly-lib.ts` holds
eight machines (`orbit`, `ramp-return`, `target-bank`, `pop-nest`, `sling-pair`,
`kicker-lane`, `spinner-gate`, `rollover-bank`); 34 machines placed across 36 census floors;
placement has its **own rng stream and takes zero draws from the floor rng**
(`maze/assembly-place.ts:113-124`, gated at `assembly-place.test.ts:81-103`).

It gives you for free: rotation/mirror orientation algebra, six authoring rules
(`assembly-check.ts`), port chaining with `ballistic`/`eject`/`impact` flow kinds, runway
checks measured *backwards* along the entry vector, Φ-reachability rejection, and ranked
rather than first-fit siting.

**Two cautions [V]:** one placement per machine definition per floor (a floor can never carry
two orbits — `assembly-place.ts:307-349`), and the declared problem code `impact-chain` is
**emitted by no rule** (`assembly-check.ts:27`), so a test asserting "no impact-chain" is
tautologically green.

---

## 5. Track C — Live walls ("bumper walls")

Ordered by value ÷ cost. Each is reconciled with the anti-farming rule that made flat walls
`PINBALL_WALL_RESTITUTION` 0.94 in the first place.

**C1. RUN RUBBER.** A `paintRuns()` author writes `WALL_RUBBER` along whole runs ≥5.
**Physics and render need zero new code** (§1.5). Anti-farm: `1.06 × 0.94 = 0.9964 < 1`
(`engine/surfaces.ts:100-106` was designed this way) — the gain is the *additive* 1.6, which
self-limits at the cap. **[V]** One veto needed: never both sides of a narrow corridor.

**C2. RUN IDENTITY.** Running a wall run end to end is a **named shot**, like an orbit lap.
Pays **gold, never speed**. Ping-pong between parallel walls never traverses a run, so the
exact behaviour 0.94 exists to suppress scores zero. **This is the cleanest reconciliation
available** and it directly answers "things you can do to complete to get points."

**C3. STRAIGHT RAIL.** `entities/rail.ts` is already pure and generic; `featureIdx` becomes a
`runId`, normal from `wallContact`. Anti-farm: it is a *held* state requiring steering into
the wall — structurally incompatible with ping-pong. Also fixes the sub-step false corner
(§2.7). **[V]**

**C4. PAY BANDS.** `entities/wall-erosion.ts` already does partial damage via `maze.wallAt`.
Anti-farm: **consumable**.

**C5. LIT WALL.** Reuse the `part.aimed` cone (`render/pinball-parts.ts:1787-1795`) against a
run midpoint. **Last**, because it is the only one that puts new speed into the flat path and
leans entirely on the existing combo taper.

> **C1 + C2 are the design.** One makes a wall a *material*; the other makes it *a thing with
> a name*. Neither adds a >1 multiplier to a flat bounce.

---

## 6. Track D — Things to complete for points

### 6.1 The seam

**[V]** Attach at `recordShot(id)` (`shots.ts:63`) — the single funnel every shot identity
passes. An `onShot(id)` hook goes between the push and the `NAMED_COMBOS` loop. State beside
`shotChain`/`namedPaid` (`state.ts:1012-1017`); per-floor reset in the contiguous block at
`core.ts:489-496`; floor→run banking at `run/descend.ts:248-251`; timers as a third case in
`updateShots` (`shots.ts:215-234`); HUD in the stat cell (`hud.ts:302-310`).

### 6.2 What already exists to reuse

**[V]** A 23-id shot vocabulary; `part.aimed` + the lit cone as a "lit shot" mechanism;
`part.lit/hits/done` for per-part progress; `namedPaid` as a once-per-floor latch;
`armSkillShot`/`trySkillShot` as a working timed-objective template; `hitOrbitRail` as an
ordered-sequence-with-timeout template; **the drop-target BANK
(`pinball-collide.ts:728-757`), which is a ball-lock in all but name**; `fireJackpot` as a
wizard-mode payout; `comboZone`'s existing three-state ladder; and `rotateLanes`
(`shots.ts:168`) — an *unused mode selector input* already bound to dodge.

### 6.3 The design: qualify / activate, not multiball

**[V, external]** The strongest transferable pinball idea is the **qualify/activate split**
(Iron Maiden: *"Qualified Playfield X will carry between balls. Once qualified, activate the
PFx by rolling over the lit return lane"*). You earn the multiplier whenever; you *spend* it
when you choose. Pinball Knight already has the vehicle — rollover lanes with a lane-change
button. The lane-change gains a second, deeper job: choosing the moment.

**[V, external] Do NOT build multiball.** Its emotional core is *having more to lose*; with no
drain, extra balls are pure upside and therefore pure noise. `PLAZA_PLAN` independently
reached the same conclusion and ruled it out: `entities/multiball.ts` is
echo-knights-as-a-buff and there is no ball to lock. Build the *lock ritual* and the *jackpot
ladder*; skip the extra balls.

**[V]** Echoes would trace a ride for free without double-scoring it: `Echo` is
`{sprite, anim, x, z, facing, lag, side, hitCd}` with no momentum, no `moveCircle` and no
`touchPinballParts`, but it replays the player's actual path.

### 6.4 The floor contract — the notice board already exists

**[V]** `rollModifier` (`maze/modifiers.ts:212-217`) is exactly as `OPEN_WORK` Tier 5 claims:
`if (level < 3) return NO_MODIFIER; if (rng() >= 0.45) return NO_MODIFIER;` then a uniform
pick. No stacking, no payout field, no player input.

**[V] But `OPEN_WORK` is wrong by omission:** `gui/screens/depth-select.ts:44-193` is a full
scrollable "SELECT MAZE DEPTH" screen, reached from the tavern board and the game-over screen,
already rendering one row per floor with title, subtitle and a right-hand status column, fed
by `depthMetadata`. **That is the ready-made notice board.** A contract per row is a subtitle
string plus an `onSelect` payload.

**[V] Caveat:** `resolveDescendFloor` (`run/descend.ts:119`) can override the pick toward the
pool's floor, and `regroupWithPoolWhenTheyLand` (`:158-178`) can move you again within 6 s. An
accepted contract must be keyed to a **depth band**, or re-rolled on regroup — never pinned to
a floor number.

### 6.5 The grade is already there and already shown

**[V]** `run/grade.ts:34-44` `gradeFloor()` returns S/A/B/C/D from flow, kill-share and best
combo, pays `GRADE_GOLD`, and arms a bonus vault. **It contains zero of the shot layer** — no
combos, laps, jackpots, targets, lanes or banks. Feeding the shot layer into the grade is a
small change with a large legibility payoff.

### 6.6 Enemies do not touch parts — the cheapest missing verb in the game

**[V]** Definitive, by three independent proofs: `PART_HANDLERS` signatures take `p =
state.player` only; `touchPinballParts` (`pinball-collide.ts:1093-1112`) iterates parts × *the
one player*; and `grep "pinballPart" entities/zombie.ts` returns **0 hits**. All 24 parts are
inert to enemies. A zombie can stand on an open grave forever.

**[V]** Yet the pattern is already proven twice — the glove lane (`hazards.ts:71-77`) and the
fire vent (`:117-123`) both sweep a lane and call `damageZombie`. And the two floor-fx systems
the *player* creates (groove, slick) **do** affect enemies.

⇒ One loop, in the shape already at `hazards.ts:71`, pointed at `state.pinballParts`, creates
the missing verb: **shove the goblin into the bumper bank.** No new state, no new part kind,
no new art. **[V]** Note `damageZombie(..., push)` calls `moveCircle`, which is grid-aware but
**part-blind**, so a shoved enemy passes straight through a bumper today.

---

## 7. Phasing

| # | Phase | Contents | Gate |
|---|---|---|---|
| 0 | **Defects** | §2.1–2.6 | Retry no longer inflates the ledger; skill shot fires on a bumper target; toast queue holds 2+ |
| 1 | **Publish** | A1–A4 | Pinned floor byte-identical; `__dungeonTrack()` returns legs on all archetypes |
| 2 | **Live walls** | C1 + C2 | ≥20 runs ≥5 carry rubber per floor; run-identity shot fires; flat-bounce speed gain unchanged |
| 3 | **Ride v1** | Rail on track fillets (§4.1); no new input | Held-rail duty ≤0.3; exit overspeed carries |
| 4 | **Energy gate** | SpeedInterval (§4.4) as a generator validator | Zero corners fail the radius-at-entry-speed check on 100 floors |
| 5 | **Feel** | Shadow separation, `camY`, y-arbiter, sprite roll | Screenshot A/B at matched frames |
| 6 | **Objectives** | D — qualify/activate, contract row, grade feed | Every payout reaches `RunStats` |
| 7 | **Tuck + enemies-into-parts** | §4.2, §6.6 | Input budget confirmed first |

Phases 0–2 deliver most of the user's ask and touch no physics. **[A-3]**

---

## 8. Constraints that must not be broken

**8.1 The rng rule — the single biggest trap. [V]** *Any generation pass that draws from the
floor's shared seeded `rng` re-rolls every floor in the game from that point onward.* Stated
in six places in code (`spawn/floor-authoring.ts:388-391`, `maze/surface-paint.ts:19-24`,
`maze/decorate.ts:3505-3521`, `maze/relay-chambers.ts:119-120`,
`maze/doorway-funnels.ts:531-535`, `maze/arc-sweeps.ts:646-652`). The symptom is *"a
completely different floor that renders fine and breaks no test."* New passes take their own
derived stream or order deterministically without drawing.

**8.2 Co-op. [V]** Shared pool seed → each client generates the same maze locally. Per-floor
authority = lexicographically-smallest peer id (`coop.ts:125-131`); authority broadcasts a
~10 Hz world snapshot (`SNAP_INTERVAL` 0.1); poses ride `move` at 15 Hz
(`src/net/presence.ts:30`). Player HP is client-owned. `src/net/protocol.ts` mirrors
`server/realtime.mjs` and a drift is *"a silent desync, not a compile error."* **[A-4]** Part
state (bumper lit counts, jackpot progress) may be local-only — the co-op agent died before
confirming; check before shipping a shared objective.

**8.3 No `Math.random()` in a physics path. [V]** `spinPadPhase` exists precisely because that
bug shipped once.

**8.4 The juice governor. [V]** `HITSTOP_MAX_PENDING` 0.09 is a hard ceiling; hitstop pauses
the fixed-step sim. Any new mechanic requesting hitstop goes through the governor.

**8.5 Budgets. [V]** `FLOOR_FX_MAX` 300 · `PART_ANIM_RANGE` 24 · `PART_TOUCH_BROAD` 12 (must
stay above the largest trigger reach; measured max `MAGNET_PULL_RANGE` 4.2) · `ARC_KICK_MAX`
10 · `TARGETS_PER_FLOOR` 5 · `TRAPDOORS_PER_FLOOR` 2 · `HAZARDS_MAX` 10 · `maxPartsPer1k` 34.

**8.6 The registry cost of a new part kind. [V]** 5 compile-enforced sites and **10
unenforced sites, every one a silent failure.** A launcher missing from `LAUNCH_KINDS` gets
placed firing into rock; missing from `FORWARD_FLOW_KINDS`, its heading is a coin flip.
*Prefer not to add a part kind.* C1/C2 and the ride add none.

**8.7 The floor is a quarter the area the callers think. [V]** `buildTrackFloor` computes
`w = cellsW*2+1` pre-thicken, so an L1 track floor is 75×53 where the legacy floor was
150×106, and every budget riding `cfg.floorTiles` is calibrated for 4× the area. Flagged in
`MAZE_OVERHAUL_PLAN` as *"a balance and perf decision, not a generator fix. Decide
deliberately."* **Unresolved, and it gates any "more parts on the floor" work.**

---

## 9. Verification — and five ways a green check would lie here

**9.1 `tsc` never runs. [V]** `ThreeJS/package.json:6-14` has no `typecheck` script; `vite
build` uses esbuild; `vite.config.ts:63-76` has no `typecheck` key. `tsconfig.json` is
`strict: true, noEmit: true`, so `npx tsc -p ThreeJS/tsconfig.json` works **by hand and
nothing invokes it**. ⇒ *Every `Record<PinballPartKind,…>` "compile-enforced" claim is an
unenforced claim unless a human runs tsc.* The plan must carry that step explicitly.

**9.2 There is no CI and no git hook. [V]** `.git/hooks/` holds only `.sample` files;
`.github/workflows/ci.yml` is `workflow_dispatch` only and headed **"DISARMED 2026-08-29.
MANUAL ONLY"**, with its own note that *"the ThreeJS client is the half that changes daily and
none of these gates read it."* Every gate below is run by hand.

**9.3 `registry-drift.mjs` does not exist in this repo. [V]** The only live copy is in
`braindeadbot-client`, whose `src/game/pinball-knight` was deleted — its first
`read("state.ts")` throws ENOENT. It contains **zero mentions of `PinballPartKind`**. *Do not
cite it as covering part kinds; it covers nothing here.*

**9.4 Eighteen of 23 referenced `scripts/*.mjs` do not exist. [V]** Missing include
`mega-map.mjs` and `playtest.mjs`. Consequently ~2,225 lines of measurement code have **no
entry point**: `dev/open-space-census.ts`, `dev/funnel-census.ts`, `dev/circuit-census.ts`,
`dev/pattern-census.ts`, `dev/floor-svg.ts`, `dev/mega-entry.ts`. `dev/mega-floor.ts` is the
exception, exercised under vitest. **A plan that says "run the census" is naming a runner that
isn't there.**

**9.5 The suite writes to tracked files. [V]**
`tools/sprite-forge/work/{ab.txt,report.txt,ab-brute.png}` are regenerated with the running
tree's absolute path baked in. Never `git add -A` after a test run. Cap with
`VITEST_MAX_THREADS=8` — `--maxWorkers`/`--poolOptions` are not valid on this repo's vitest 4
CLI.

**9.6 The lesson to cite. [V]** `testkit/live-floor.ts` is *"the only faithful floor
builder"*, written because `plaza-place.test.ts` **twice concluded a correct pass was broken**
from a hand-rolled corridor maze the game never generates. Every floor-shaped test in this
plan builds through `live-floor.ts`.

**Per-mechanic method:**

| mechanic | how to prove it | what would lie |
|---|---|---|
| Track published | `__dungeonTrack()` + a byte-identical pinned floor | a diff-clean tree — the artefacts are gitignored |
| Wall rubber | headless census of runs-with-rubber over 12 floors | counting *runs* not *tiles*; measure both |
| Ride hold | duty-cycle log over a bot run; assert ≤0.3 | a screenshot — a hold is a time series |
| Energy gate | 100 floors, assert zero corner fails radius-at-entry | validating the control cage, not the sampled curve |
| Elevation feel | matched-frame A/B, host GPU | llvmpipe invents artefacts; WSL fps is a mirage |
| Objectives | assert every payout site appears in `RunStats` | gold×1 makes an unbanked payout *look* scored |

---

## 10. Open decisions and gaps

**10.1 Decisions that are yours, not mine**

1. **The wall look** (`OPEN_WORK` Tier 1.3, open since 2026-09-05) — `runs` / `tiles` /
   `legacy`. Track C does **not** depend on it, but if `runs` wins, `BLUEPRINT.md:19-29` must
   be rewritten rather than left to contradict the code.
2. **The 4× floor-area question** (§8.7) — deliberate, unresolved, and it gates part density.
3. **Ride length.** External research: keep segments short and end them in something that
   matters; a decision point every few seconds. I have no measured basis for a number.
4. **The tuck's binding** (§4.2, **[A-2]**).

**10.2 Adjacent live work.** A parallel session shipped a **seesaw shortcut system across wall
bands** (`a92ed698`, plan at `2cbd5855`). It adds a `seesaw` `PinballPartKind` with `tilt`,
`span`, `destI/destJ` and reuses `startRampHop`. **[V]** It touches the same wall-band and
airborne seams as §4.5 and §8.6. Coordinate before either lands; in particular the y-arbiter
(§4.5) is a shared prerequisite.

**10.3 Gaps — research that did not complete.** Three topics have **no findings** because
their agents were killed by a session rate limit, and nothing in this plan should be read as
covering them: the **booster-family census** (current per-part distribution — the 73% figure
in `constants/pinball.ts` predates the `boostcorner`/`boostcurve`/`jumppad` family and is
stale), the **rails/arc-lanes deep read**, and the **input budget** (§4.2). Additionally the
`ARC_KICK_*` "dead mirrors" claim in `constants/pinball.ts` is repeated here from the comment
and was **not independently verified**.

---

## 11. Assumption register

| id | assumption | risk | validation |
|---|---|---|---|
| **A-1** | 2D + shadow separation delivers enough "coaster" to satisfy the ask | The user wanted literal 3D track; plan under-delivers | Build phase 5 first as a spike on one segment and show it |
| **A-2** | A free or overloadable binding exists for the tuck on all three devices | The verb has nowhere to live | Read `engine/input.ts`, `gamepad.ts`, `gui/touch.ts` before phase 7 |
| **A-3** | Phases 0–2 satisfy most of the ask without touching physics | Re-work if the ask was really about the ride | Confirm with the user before phase 3 |
| **A-4** | Part state is replicated or can be made so for co-op objectives | Two players see different jackpot progress | Read `coop.ts` part-state handling before phase 6 |
| **A-5** | `FLOOR_TRACK` overriding topology friction is the right call | A track through a dead end feels wrong either way | Playtest both, pin the winner |
| **A-6** | Wall-run counts (43.6 runs ≥5/floor) hold at depth >12 | Rubber is sparse on deep floors | Extend the census to L30 |
| **A-7** | Enemies-into-parts does not break the density/perf budget | Frame cost on a 135-zombie floor | Profile before enabling floor-wide |
| **A-8** | The named-combo deaths in §2.4 are as diagnosed | Fixing the wrong thing | `__dungeonShots()` over a bot run |

---

## 12. What to check when you read this

1. **§1.1** — is "the circuit is thrown away" the right thing to fix first? It is the cheapest
   change here and everything else leans on it.
2. **§1.4** — the LOCK vs HOLD ruling. If you actually want a passenger ride (control
   removed), say so; it reverses `MAX_LOCK_DUTY` and changes the whole design.
3. **§2** — the six defects. §2.1 is inflating your leaderboard right now.
4. **§4.5** — "roll the sprite, never the camera" and "no vertical loops". If you want loops,
   that is §1.2's expensive branch and I would want to re-scope.
5. **§6.3** — no multiball. Two independent lines of evidence say it does not transfer to a
   game with no drain.
6. **§10.1** — four decisions I deliberately did not make for you.
7. **§10.3** — three research gaps. The booster census in particular means I cannot tell you
   the *current* part distribution, only the pre-family one.
