# The pinball dungeon — what to improve next, ranked

**Status:** active. Written 2026-09-06 against `machines` at the merge with
`main` (`475f564d`). **Companion to** `pinball_dungeon_machines_plan.md` (the
analysis) and `pinball_design_decisions.md` (the four binding user decisions —
where this file and that one disagree, that one wins).

This is the checklist that was asked for and not delivered on the first pass.
It is rebuilt from measurements taken after the merge, not from the earlier
run — several of whose headline numbers were retracted, and one of whose
instruments was found to be building a floor the game does not ship.

---

## How to read a row

Every claim carries its evidence class, because the expensive mistakes on this
branch all came from a number whose class was never stated:

| class | means |
|---|---|
| **MEASURED** | a number produced this session, by the harness pinned to the shipped path, with the seeds and depths given |
| **INFERRED** | a cause proposed for a measured effect. Not yet confirmed by instrumenting the code it accuses |
| **JUDGED** | a design opinion. No measurement would settle it |
| **OPEN** | a question with no answer yet, filed rather than guessed at |

## Where the numbers come from

`dev/headless-floor.ts buildHeadlessPlan`, which mirrors
`spawn/floor-authoring.ts authorFloor` draw for draw and is pinned to it
part-for-part by `dev/headless-floor.test.ts`. **7 depths x 10 seeds** (L1, L4,
L8, L12, L16, L20, L24; seeds 1, 424242, 0x6057, 987654321, 5150, 77, 31337,
8080, 12345, 99999). Per-floor means:

| depth | walkable | parts | **parts/1k** | machines | in a machine | chain | circuit | spine | bumper |
|---|---|---|---|---|---|---|---|---|---|
| L1  | 1,757  | 56.9  | **32.4** | 1.20 | 3.2  | 2.7  | 5.0  | 13.0 | 6.3   |
| L4  | 2,575  | 83.1  | **32.3** | 1.50 | 4.3  | 3.0  | 10.1 | 18.6 | 9.7   |
| L8  | 4,532  | 145.1 | **32.0** | 1.90 | 5.0  | 3.6  | 16.4 | 29.6 | 49.3  |
| L12 | 6,013  | 190.5 | **31.7** | 2.00 | 5.9  | 6.4  | 20.8 | 35.8 | 64.9  |
| L16 | 7,976  | 243.4 | **30.5** | 3.00 | 9.2  | 8.5  | 22.2 | 46.6 | 96.0  |
| L20 | 10,469 | 301.3 | **28.8** | 3.10 | 9.9  | 12.1 | 25.6 | 62.9 | 123.1 |
| L24 | 11,740 | 310.0 | **26.4** | 4.00 | 12.4 | 6.3  | 26.7 | 55.2 | 135.4 |

Two things in that table are the whole of items 1 and 2 below: the
`parts/1k` column falls monotonically, and the `chain` and `spine` columns turn
over between L20 and L24.

---

## 1. Deep floors are emptier per unit area than shallow ones — MEASURED

`parts/1k walkable` runs **32.4 -> 26.4** from L1 to L24, monotone across all
seven depths. A floor 6.7x the area of L1 carries 5.4x the parts. The player
experience of that is more walking between fewer things, at exactly the depths
where the game is supposed to be at its densest.

**INFERRED cause.** The part budget is
`min(PARTS_BASE + (level-1)*PARTS_PER_LEVEL, PARTS_MAX) + walkable/600`. The
first term SATURATES at `PARTS_MAX`; only the second scales, and it scales at
1 part per 600 tiles against a floor whose content wants far more. So the flat
term is diluted exactly as the floor grows. This is the same shape as the
`ASSEMBLY_BUDGET = 2` finding — a constant standing in for a function of area —
one layer up.

**What to do.** Decision 1 already answers it and is stronger than a budget
tweak: *cap floor growth near current mid-depth size and spend everything on
density.* `constants/level.ts` saturates at 96x72 cells (~11.7k walkable);
that ceiling comes DOWN.

⚠️ **The two must move in ONE commit.** `assemblyBudgetFor(walkable)` and
`chainsFor(walkable)` both divide walkable, so shrinking floors without
lowering their divisors produces FEWER machines on SMALLER floors — the exact
opposite of the intent. Ship the size cap, the two divisors and a census diff
together, and check the L1 end as well as the L24 end (the machine budget's
floor of 2 is load-bearing and was briefly 1 for one measured iteration).

**Cost:** medium. **Risk:** every floor and every existing seed changes.

## 2. Chain and spine yield turn over at L24 — MEASURED, cause INFERRED

`chain` parts per floor: 2.7, 3.0, 3.6, 6.4, 8.5, **12.1**, **6.3**. `spine`:
13.0, 18.6, 29.6, 35.8, 46.6, **62.9**, **55.2**. Both peak at L20 and fall at
L24 while walkable grows 12%. Every other layer (`circuit`, machines, bumpers)
keeps climbing.

A non-monotone content layer is not a tuning question, it is a symptom. The
shape is the same one §1.1a of the machines plan diagnosed and half-fixed: a
budget consumed before the late passes run. That fix restored the chain pass at
L1-L20; L24 looks like it is still starving.

**INFERRED**, and the accusation names a specific line: `corridorBudget` at
`decorate.ts:2747` and the `parts.length < corridorBudget` guards behind it.
**Confirm before fixing** — instrument `decorate.ts` at L24 for chains
attempted vs seeded vs abandoned, run 10 seeds, strip the instrumentation and
diff it back to byte-identical, as the first pass did. Do not tune a constant
against a cause that has not been confirmed.

**Cost:** small to measure, unknown to fix. **Value:** high — the chain pass is
the ONLY one that places a part *because a launch arrives there*, so it is the
layer that answers "the boosters lead nowhere".

## 3. 44% of a deep floor is one part kind — MEASURED

`bumper` is 135.4 of 310.0 parts at L24 (43.7%), against 6.3 of 56.9 at L1
(11%). The share grows monotonically with depth. This is the brief's original
complaint — "a larger field with more scattered boosters" — surviving
everything done to date, and it is *worse* at the depths the branch made
denser.

**What to do.** The final density clamp already walks the parts list in two
passes and already knows which kinds are loose furniture; a per-kind share
ceiling is a third pass in the same place, culling the over-represented kind
first. That is much cheaper than teaching the placer to want variety, and it
composes with item 1 rather than competing with it.

**JUDGED:** a ceiling around 25-30% for any single kind. There is no
measurement that sets that number; it is a starting point to playtest.

**Cost:** small. **Risk:** low — the clamp's exemption set already protects
everything structural, and `isStructuralPart` is now one tested predicate.

## 4. Machine density is at ~40% of the stated target — MEASURED

Decision 1 sets the target at **8-10 machines per floor**. Measured: 1.2, 1.5,
1.9, 2.0, 3.0, 3.1, 4.0.

`assemblyBudgetFor` is `walkable/3000`, floor 2, cap 6 — so even a perfect
router tops out at 6. But raising it is the SECOND move, not the first: at L1
the budget is 2 and the floor lands **1.2**, so the router is already the
binding constraint at the shallow end. Raising a ceiling the placer cannot
reach buys nothing.

**Order:** measure the router's rejection reasons (fit / approach / exit /
`wantsRunway`) at L1 and L24, raise the placement rate, and only then move
`ASSEMBLY_PER_WALKABLE` and `ASSEMBLY_MAX`. `gargoyle-scoop`'s `wantsRunway: 6`
is the most expensive footprint, and lowering it trades the maw's trigger speed
(`MAW_SWALLOW_SPEED`) for placement rate — a design call, not a tuning knob.

**Cost:** medium. **Blocks:** decision 4's risk mechanic, whose frequency
question ("a risk moment on every scoop stops being special") only becomes real
at 8-10 machines a floor.

## 5. The tsc baseline hides real defects — MEASURED, and it just did

`npx tsc --noEmit` reports **198 errors** on this branch (199 on `main`), and
`next.config.js` sets `ignoreBuildErrors`, so nothing runs it. This session
found a genuine defect sitting inside that baseline: `dev/floor-svg.ts`'s
`FAMILY` is declared `Record<PartSpotKind, …>` and was missing `seesaw`,
`catapult` and `cannon`, so every one of them was drawn on a debug floor plan
with an undefined colour. **The type system had caught it. Nobody could see the
catch.**

**What to do.** A ratchet, not a cleanup: a check that fails when the error
count RISES, seeded at today's number. That is cheap, it is the only thing that
makes the remaining 198 shrink monotonically, and it converts every future
compile-enforced registry (there are nine `Record<EnemyKind, …>` tables) from
decoration back into a gate.

**Cost:** very small. **Value:** high, and demonstrated rather than argued.

## 6. The room layer runs on one archetype in five — MEASURED (previous pass)

Rooms exist on 45% of floors; the four-corner ORBIT rail ring forms on 30%, and
it is the ONLY producer of `orbit`/`orbitSeq`. So `shots.ts hitOrbitRail()` —
the lap ladder, the `ORBIT_GOLD + (laps-1)*ORBIT_LAP_BONUS` payout, the named
combos — is unreachable on 70% of floors.

Decision 3 is **restore it**, and rejects deleting the layer. Constraints from
that decision: it must work at L1's ~1,750 walkable as well as L24's ~11,700,
and it must not starve the machine router (`inRoom()` excludes room tiles from
the machine site scan, so rooms and machines compete for the same ground —
measure machines-per-floor before and after against the baseline in the table
above).

**OPEN, and it should be answered first:** does `floor-pipeline.test.ts` and
the determinism suite exercise the LEGACY branch while the game takes the
TRACK-FIRST branch? If so the pipeline's tests cover a path the game does not
run, which is a bigger problem than the room layer and changes how this work is
verified.

## 7. Two loop systems that do not feed each other — JUDGED

`hitOrbitRail` reads `part.orbit`; the machine layer reads `part.asm`. The
`orbit` ASSEMBLY is placed ~2 times a floor at L24 and its parts carry `asm`,
not `orbit`, so it does not feed the lap counter. Two lap mechanics, one
reachable on 30% of floors and one on all of them, with separate windows,
separate payouts and separate combos.

**Decide, do not build both:** either the rail ring becomes an authored machine
(and `hitOrbitRail`'s ladder is re-expressed as a machine tier), or the machine
layer learns to stamp `orbit`/`orbitSeq` on a ring-shaped machine. Item 6's
answer changes which is cheaper, so sequence it after.

## 8. One-shot parts cannot tier — MEASURED (from the code, not a floor)

`target` sets `done` permanently and never re-arms, so a `target-bank` machine
qualifies once per floor and can never reach tier 2. `target-bank` is placed
0.3-1.8 times a floor depending on depth, so this is live on real floors today.

**Needs a ruling, not a patch:** re-arm one-shot kinds when the machine enters
`cooling`, or exclude one-shot kinds from a machine's sequence entirely. The
first makes targets repeatable everywhere, which changes non-machine scoring
too; the second silently shrinks some machines' sequences and interacts with
`machineTotal`'s distinct-`seq` derivation.

## 9. Promote `dev/ride-census.ts` to a gate — small, and specified

Gate on `duel`, `blindjump` and `runwayViolations`. All three are currently 0
on every floor measured and all three are independent of trace length.

⚠️ **Do NOT gate on `nowhere`.** It collapses from 15% to 0% as `maxTrace` goes
12 -> 60 on the same floors, so gating it would pin an artefact of a constant
nobody chose. `sweepTrace()` exists to make any future claim in its terms carry
the sweep that shows it does not evaporate.

## 10. Decision 4's risk mechanic is not built, and is blocked on a question

`GARGOYLE_SCOOP` was authored with two eject exits on different vectors
(`gullet-west` / `gullet-east`) precisely so the release could be a CHOICE, and
`machine-effects.ts` declares a `prompt` lifetime for an effect that asks a
question instead of applying a change. Neither is implemented.

**OPEN, and it decides whether the mechanic is buildable at all:** *does gold
have a spend path?* If it does not, "risk your gold" is not stakes, and the
mechanic needs a different currency — a multiplier, vault progress, a carried
charge, an ally. Answer that before authoring anything.

**Second constraint, from the same decision:** the decision must fit inside the
capture hold. If communicating it needs a modal or slow motion, that is a real
finding about whether push-your-luck fits this game's speed — report it rather
than building the modal.

## 11. `core.ts` is at its ratchet cap — MEASURED

595 lines against the 595 cap in `core-boundary.test.ts`. The next change there
must extract something first. Worth knowing before planning any of the above,
because several of them (item 7 especially) would naturally want to touch it.

## 12. The new HUD readout has never been played — OPEN

`hud-machines.ts` and the column it feeds are unit-tested for every phase and
tie-break, and have not been in front of a player for one second. Everything
about it that matters — is the pip row readable in peripheral vision, does the
armed bar draw the eye, does the column collide with the boss bar on a small
grid — is a question for the hand, not the suite.

**Play it on Windows, not WSL** (WSL is llvmpipe and its frame timings are a
mirage), mute the game, and check it at a small window as well as a large one:
the HUD is authored for a 600x338 design box and the one genuine clipping
failure this layer has had was a bar that only overflowed on a narrow grid.

---

## What is deliberately NOT on this list

- **Districts, hubs, transit, return networks.** Deprioritised by decision 1.
  They solved "how do we make a huge floor legible" and the user has chosen not
  to have huge floors.
- **A `RideSegment` refactor.** `maze/assembly.ts`'s ports/roles/flow model is
  the same idea, is tested, and is better factored. A parallel contract would
  be a second source of truth.
- **New part kinds.** `maw`, `trapdoor`, `magstrip`, `flipper`, `spinpad` and
  `rollover` are all in `PartSpotKind` and mostly unused by the machine
  library. Compose before adding.
- **Anything justified by "boosters lead nowhere".** That headline did not
  survive verification: `nowhere` was an artefact of an arbitrary `maxTrace`,
  and the median hand-off distance is 3 tiles. Item 2 and item 3 are the honest
  versions of the complaint underneath it.
