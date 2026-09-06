# The Pinball Dungeon — scaling the maze into linked machines

**Status:** active. Written 2026-09-06 against `ThreeJS/` at `3f169dfb`.
**Supersedes nothing.** Read `src/game/pinball-knight/OPEN_WORK.md` first — this
plan adds rows to that backlog rather than replacing it.

The brief: *the maze should become a scalable pinball dungeon made of playable
machines, not a larger field with more scattered boosters.* This document keeps
that goal and rewrites the route to it, because measuring the tree first moved
most of the proposed work from "build" to "already built" — and turned up three
dead paths that no amount of new content would have fixed.

---

## 1. What the measurement says

Five seeds per depth, built through `dev/headless-floor.ts buildHeadlessPlan`,
which mirrors `spawn/floor-authoring.ts authorFloor` draw for draw:

| depth | walkable tiles | parts | **machines** | parts in a machine | ungrouped |
|---|---|---|---|---|---|
| L1  | 2,211  | 53.6  | **0.60** | 1.4 | 38% |
| L8  | 4,812  | 138.2 | **2.00** | 5.4 | 53% |
| L16 | 9,957  | 226.6 | **2.00** | 5.2 | 58% |
| L24 | 16,126 | 289.0 | **2.00** | 5.4 | 58% |

**The floor grows 7.3× in walkable area from L1 to L24. The machine count goes
0.60 → 2.00 and then stops.** Parts do scale with area (53.6 → 289.0), and
they scale as *loose furniture*: parts belonging to an authored machine are
**5.4 of 289 = 1.9%** at L24, unchanged since L8. At L20 a single kind — the
bumper — is 119 of 271 parts, 44% of everything on the floor.

That is the brief's complaint, measured. The generator's answer to "bigger
floor" is *more scattered boosters*, literally. `ASSEMBLY_BUDGET = 2` in
`maze/decorate.ts:562` is the whole of it, and it is a constant, not a function
of depth or area.

### 1.1 Three dead paths, found while measuring

These matter more than the budget constant, because each is a shipped system
that cannot run.

**(a) The corridor budget is overrun before its own layers execute — and it is
a regression with the correct formula still written down two thousand lines
away.**

`decorate.ts:2747` reads `const corridorBudget = partBudget;`. The comment at
`decorate.ts:1256`, describing how the budget is supposed to work, states the
formula it should be:

> `corridorBudget = partBudget + parts.length - circuitPartCount` (:2471) is the
> count at which corridor filling STOPS, and room parts are already in
> `parts.length` when it is computed — so the corridor still gets its full
> `partBudget` and room parts are pure addition on top.

`git log -L` on that line finds the change. Commit **`83bc0a01`** — *"feat(maze):
enforce 3-wide minimum corridors, fluid flow reachability simulation and doorway
funnels"* — did this:

```diff
-  const corridorBudget = partBudget + parts.length - circuitPartCount;
+  const corridorBudget = partBudget;
```

Nothing in that commit's subject is about part budgets. `circuitPartCount` is
still computed at `decorate.ts:2607` and is now **unused** — the dead variable is
the tell. The comment survived pointing at a line number that no longer holds it.

The consequence, measured:

| depth | `corridorBudget` | `parts.length` when the chain pass is reached | chains seeded |
|---|---|---|---|
| L1  | 8.0  | 20.0 | **0** |
| L8  | 27.8 | 52.8 | **0** |
| L16 | 39.0 | 72.0 | **0** |
| L24 | 46.6 | 97.4 | **0** |

`decorate.ts:2779` is `for (let chain = 0; chain < chainCount && parts.length <
corridorBudget; chain++)`. The condition is false **on entry**, at every depth,
on all 20 floors measured. So `CHAIN_LINKS`, `CHAIN_TRIES`, `chainOk`, and the
"where does the knight actually ARRIVE?" link-placement loop never execute — and
`chain`-tagged parts are 0.0 per floor across the census. The corridor *deal* at
`decorate.ts:2859` is guarded by the same expression and is dead for the same
reason.

The comment at `decorate.ts:2563` says the spine "is its OWN LAYER — the
corridor budget is measured AFTER it, so the spine never strips the deal". The
measurement says the opposite: the spine alone (13.6 → 63.6 parts) overruns the
budget by 2.1× and every layer behind it is starved. This is the
"a dead path hides more than one defect" shape — the chain pass is the *second*
defect standing behind the first.

**(a2) "Boosters lead nowhere" — investigated, and NOT substantiated. Do not
build against it.**

The brief's other complaint — *"making sure the boosters make sense and they're
not just leading to nowhere"* — was measured with a new instrument
(`dev/ride-census.ts`) that traces every launcher's exit ray and classifies the
landing. It first reported **28% of launchers leading nowhere at L24**. That
number was wrong, and the way it was wrong is the most useful thing in this
section.

`nowhere` means "no part found within `maxTrace` tiles". `maxTrace` was 12,
picked by nobody for any reason. Sweeping it at L24 over the same 5 seeds:

| `maxTrace` | 12 | 20 | 30 | 60 | 200 |
|---|---|---|---|---|---|
| `nowhere` | 15% | 7% | 2% | **0%** | **0%** |

**It collapses to zero.** The median distance from a launcher to the next part
along its own exit ray is **3 tiles**. Every launcher does feed something; a
minority feed something further away than the cutoff I invented. The headline
measured the constant, not the dungeon.

What the same instrument establishes that *is* trustworthy, because these are
properties of what is found rather than of how far you looked:

- **`duel` = 0% and `blindjump` = 0% on all 20 floors.** `breakLaunchDuels`
  works, and every jump pad has floor to land on. There are no launcher
  softlocks and no silently-degraded jumps.
- **`runwayViolations` = 0** on every floor, in every run — the positive control
  that says the tracer walks the grid correctly.
- Median hand-off distance **3 tiles**, i.e. the floor is dense in receivers.

This instrument produced **three** false findings before producing a true one,
and all three are now written into its header so they are not rediscovered:
`boostcurve` reported 100% "fires into a wall" (its heading is a non-cardinal
tangent an integer ray cannot follow); `jumppad` reported the same (it is aimed
at rock **by design** and flies over it); and `nowhere` itself. `maxTrace` is now
a required-thought parameter and `sweepTrace()` exists so that any future claim
in terms of `nowhere` must ship with the sweep proving it does not evaporate.

**The standing conclusion: there is no measured evidence that boosters lead
nowhere.** If the complaint is real it is about how a ride *feels* — arriving at
a bumper 11 tiles later is a hand-off on paper and dead air in the hand — and
that is a question for a played floor, not for a grid tracer. It is filed as an
open question, not as a defect with a fix attached.

**(b) `plan.rooms` is empty on every floor measured.** `rooms = 0.0` at L1, L8,
L16 and L24. The whole room-archetype layer — `bumper` / `speedway` / `arena` /
`vault` furnishing, the bumper diamond, the mid-wall bumpers — does not run on a
track-first floor.

**(c) Therefore the ORBIT LAP — the game's flagship loop shot — can never
fire.** The only producer of `orbit` / `orbitSeq` is the four-corner rail ring at
`decorate.ts:1381`, gated on a `bumper`/`speedway` room of ≥6×6. With no rooms,
there is no producer: **parts tagged `orbit` = 0.0 per floor, at every depth.**
`shots.ts hitOrbitRail()` reads `part.orbit` and returns on its first line for
every call it will ever receive. Its lap ladder, its `ORBIT_GOLD +
(laps-1)*ORBIT_LAP_BONUS` payout, its toast, its `recordShot("orbit")` and every
named combo containing `"orbit"` are unreachable code in the shipped game.

The `orbit` **assembly** *is* placed, ~1 per floor. Its parts carry `asm`, not
`orbit`/`orbitSeq`, so it does not feed the lap counter either. The reader stayed
on the field the writer left.

**(d) `asm` never reaches the runtime.** `assembly-place.ts partsOf()` stamps
`asm: AssemblyRef` onto every machine part. `render/pinball-parts.ts` builds the
runtime `PinballPart` and copies `bank, seq, lit, phase, spin, variant, field,
orbit, orbitSeq, lane, laneSeq` — and not `asm`. Grep confirms the only readers
of `asm` anywhere are `dev/pattern-census.ts` and `dev/floor-svg.ts`. **At
runtime, nothing can say "these six parts are one machine."**

So the brief's *"each with a readable entrance, a controlled ride, a player
decision, a reward, and a safe exit"* is currently impossible to express not
because the vocabulary is missing, but because machine identity is discarded one
step before the code that would use it.

---

## 2. What the brief proposes that already exists

This is the main correction. Building these again would be a rewrite, not a
feature.

| Brief calls for | Already in the tree |
|---|---|
| A shared `RideSegment` contract | `maze/assembly.ts` — `AssemblyPart`, authored relative facings, rotation/mirror algebra pinned by tests |
| Explicit `entry`/`exit`/`branch` ports | `AssemblyPort { ci, cj, dir, way: in\|out\|both, flow, minSpeed, tag }`; `dir` is the travel vector, documented |
| Movement roles (Launch/Carry/Turn/Bounce/…) | `PartRole = drive \| turn \| score \| rebound \| hazard \| dress`, plus `PortFlow = ballistic \| eject \| impact` — a *better* model than the brief's, because it separates momentum semantics from part identity |
| Speed bands, not unconditional floors | `AssemblyPort.minSpeed`; `entities/rail.ts` over-cap + decay; the booster jam guard on `PinballPart` |
| Machine blueprint layer with validation | `maze/assembly-lib.ts` (8 machines) + `maze/assembly-check.ts` (`corner-missing-leg`, exit-into-rebounder, ports-on-boundary, parts-on-carved-floor) |
| Placement constraints, no-overlap, distance from start | `maze/assembly-place.ts` — route-seeded siting, `wantsRunway`, approach/exit/reachability scoring, own RNG stream |
| Deterministic seed behaviour | `maze/floor-seed.ts`; the router's separate stream, with the reason documented |
| Curved-wall lanes, kickers, rails, banked rides | `maze/arc-contract.ts`, `arc-sweeps.ts`, `entities/rail.ts` (earned, over-cap, decaying) |
| Scoops / faces / capture | `entities/maw.ts` — shipped: aimed-line swallow, hold beat, spit |
| Districts | `maze/archetypes.ts` — 5 floor archetypes (warrens / spine / greathall / cavern / ringkeep) |
| Drop-target banks, spinners, rollover lanes, pop nests, slings | all present as part kinds and as library machines |
| Debug overlays, footprints, route heatmaps | `dev/floor-svg.ts`, `dev/pattern-census.ts`, `dev/mega-floor.ts`, `__lab()` |
| Softlock protection | `breakLaunchDuels`, `breakFlowLoops`, the booster-jam guard, `openLaunchTargets` |

**What is genuinely missing is short:** machine identity at runtime, machine
*state*, a consequence channel, `capture`/`transfer` in the role vocabulary, a
declared recovery contract, and a machine budget that scales with the floor.

---

## 3. The corrected shape of the work

The brief's instinct — *"treat each new object as part of a machine loop, not
isolated scenery"* — is right, and it is blocked on one thread. Order the work
by that thread rather than by content family, because every set piece in the
brief (Loop Reactor, gargoyle scoop, corkscrew rail) is content **on** this
spine, and none of them can pay off without it.

### Phase 1 — the machine spine *(in progress)*

1. **Carry `asm` through the runtime seam.** One field in
   `render/pinball-parts.ts`, one field on `PinballPart`. Unlocks everything
   below.
2. **Per-machine state**, keyed by `asm.id`:
   `unlit → qualifying → lit → armed → collected → cooling`.
   - Per machine, not one global slot. Two machines on a floor progress
     independently — `state.orbitActive` cannot express that.
   - Sequence length **derived** from the machine's own `seq` parts. The
     hardcoded `% 4` in `hitOrbitRail` cannot express a 3-lane reactor or a
     6-corner ring.
   - Lapse **decays one step**; it does not confiscate. (The brief asks for this
     explicitly and it is the right call.)
   - Tier ladder on repeat; alternation multiplier across distinct machines.
3. **Capture / transfer in the role vocabulary**, plus a **recovery port**: a
   declared landing for a failed ride, so the no-softlock rule becomes structural
   rather than a runtime rescue.
4. **Two authored set pieces** — `LOOP_REACTOR` (three distinguishable loop
   shots on one machine id) and `GARGOYLE_SCOOP` (capture, qualified by a target
   bank, released through an authored `eject` port with a choice of exit).
5. **Contracts in `assembly-check.ts`:** a capture with no eject release is a
   softlock by construction; an eject that lands on an `impact` part is the
   worst feel bug a real table has.

### Phase 2 — consequence

A completed machine must change the dungeon, or it is a score checklist. The
cheapest honest first consequence reuses shipped art and shipped state: the
sealed vault chest (`lamp-puzzle.ts`) already has an `unlit → lit → open`
visual and two unlock routes. Completing a machine becomes a **third** route,
and arms an **Overcharge** window during which boosters run hot and payouts
ladder. That is one visible world change, on art that exists, with a state
machine that exists — not a new subsystem.

### Phase 1b — restore the corridor budget *(done, in this branch)*

Justified entirely on its own terms — a blame-confirmed regression that killed
two shipped passes — and **not** on §1.1a2, whose headline did not survive
verification. Shipped here as:

- `decorate.ts:2747` restored to `partBudget + parts.length - circuitPartCount`,
  with the measurement table and the blame recorded at the line so it cannot be
  quietly dropped a second time.
- `CHAINS_DEFAULT = 1` replaced by `chainsFor(walkable)` — one chain per ~2,500
  walkable tiles, floor 1, cap 8. The flat 1 was never a tuned number: the pass
  it configured had never run.

**Measured effect.** Chain parts per floor went `0.0 → 2.8 / 7.0 / 9.8 / 5.6`
(L1/L8/L16/L24) — the pass is alive. Regression suite (`floor-density`,
`floor-rules`, `circuit`, `floor-pipeline`) is **30/30 green, identical to the
pre-change baseline**, so the restored allowance does not break the density band.

**What it did NOT do:** it did not improve `nowhere`, which went 28% → 30% → 28%
across the two changes. That is the correct outcome for a number that turned out
to be an artefact, and it is recorded here because the change was originally
motivated by moving it. The layer split that came out of the same run is the
useful residue and is worth keeping:

| layer | launchers/floor (L24) | feeds |
|---|---|---|
| chain | 1.6 | **100%** |
| circuit | 5.8 | **100%** |
| machine | 1.4 | 86% |
| spine | 39.4 | 68% |
| deal | 11.6 | 38% |

The layers that place a part *because a launch arrives there* — chain and
circuit — are the only ones that hand off every time. The station spine is 66%
of all launchers on the floor. If a future playtest does substantiate the "leads
nowhere" feel, **the spine is where to look**, not the chain count.

### Phase 1c — scale the machine budget *(done, in this branch)*

Pulled forward from Phase 3 for one reason found by measurement: the flat
`ASSEMBLY_BUDGET = 2` made the machine library **anti-additive**. Adding a
machine to `assembly-lib.ts` did not put machines on more floors — it took a
slot from an existing one. Over the 36 floors `assembly-place.test.ts` uses, the
two machines added in this same branch left the total at 48 placements and took
their 3 slots out of `pop-nest` (8 → 3) and `kicker-lane` (11 → 9). Every future
machine would have paid that tax, so no amount of Phase 4 content could land.

`assemblyBudgetFor(walkable)` — one machine per ~3,000 walkable tiles, floor 2,
cap 6:

| depth | machines/floor before | after | parts in a machine | share of floor |
|---|---|---|---|---|
| L1  | 0.60 | 0.60 | 1.4 → 1.6  | 3.0% |
| L8  | 2.00 | 2.00 | 5.4 → 6.4  | 4.6% |
| L16 | 2.00 | **3.00** | 5.2 → 8.6  | 3.7% |
| L24 | 2.00 | **4.00** | 5.4 → **12.8** | **4.2%** |

**The floor of 2 is load-bearing and was 1 for one measured iteration.** With a
3,500 divisor and `Math.max(1, …)`, L1 and L8 both round to 1 — the change meant
to give deep floors more machines took one away from every shallow floor
(0.60 → 0.40, 2.00 → 1.00). A scaling rule has to be monotone against the
constant it replaces at *every* point it is defined, not only at the end that
motivated it. That is now stated at the constant.

Note also that the budget is a ceiling, not a promise: a floor budgeted 5
measured 3 placed, because the router rejects sites on fit/approach/exit. Closing
that gap is `placeAssemblies`' business and is not attempted here.

### Phase 3 — the rest of the scaling work

- Target a **travel-time budget** (an interaction every few seconds at pinball
  speed) rather than a tile count, now that the machine count can move at all.
- Raise the router's placement rate so a budget of 5 yields closer to 5.
- Promote `dev/ride-census.ts` from an instrument to a **gate** — but gate on
  `duel`, `blindjump` and `runwayViolations` (all currently 0 and all trace-length
  independent), **not** on `nowhere`. Gating on `nowhere` would pin an artefact.
- Investigate the empty `plan.rooms` (§1.1b). Either the room layer is
  deliberately superseded by track-first generation — in which case the orbit
  ring, the archetype furnishing and their tests are dead code that should be
  deleted or re-homed — or it is a regression. **It cannot be both, and the
  answer decides whether §1.1c is a bug or a removal.**

### Phase 4 — districts, transit, and the rest of the brief's catalogue

Rail rides, subways, diverters, upper playfields, mimic maws, rotating rooms.
All of it is content on the Phase 1-2 spine. None of it is worth authoring
before a completed machine can change something.

---

## 4. What this plan deliberately does **not** do

- **No `RideSegment` refactor.** The ports/roles/flow model already in
  `assembly.ts` is the same idea, is tested, and is better factored. A parallel
  contract would be a second source of truth.
- **No macro district layer yet.** `archetypes.ts` already varies floors; adding
  intra-floor districts before machines are legible would be decorating an
  anonymous floor.
- **No new part kinds in Phase 1.** `maw`, `trapdoor`, `magstrip`, `flipper`,
  `spinpad`, `rollover` are all already in `PartSpotKind` and mostly unused by
  the library. Compose before you add.

---

## 5. Verification

Every claim in §1 came from `dev/headless-floor.ts`, which mirrors the shipped
draw order — a harness that re-implements the pipeline instead is a recorded
scar (`maze/floor-pipeline.test.ts`). The two dead-path findings (§1.1a, §1.1c)
were confirmed by temporary instrumentation inside `decorate.ts`, run over 20
floors, then stripped and diffed back to byte-identical.

The census should become a permanent instrument in Phase 3: "machines per floor"
and "parts inside a machine" are exactly the numbers that would have caught this
plateau a month ago, and `dev/pattern-census.ts` already computes the second one
without anything asserting on it.

Open question this plan does not answer: **why `plan.rooms` is empty.** It is
filed in Phase 3 rather than guessed at.
