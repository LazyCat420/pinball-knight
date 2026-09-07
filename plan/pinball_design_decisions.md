# Design decisions — the four forks, and what the user chose

**Date:** 2026-09-06. **Status:** binding. These came from the user directly, in
response to four questions each posed with costed alternatives. They constrain
everything in `pinball_dungeon_machines_plan.md`; where the two disagree, this
file wins.

Recorded separately from the plan because a decision and an analysis age
differently. The analysis will be superseded; these four answers are the
product direction and should outlive it.

---

## 1. Floor scale — **richer, not bigger**

> Cap floor growth near current mid-depth size and spend everything on density
> of machines, loops and set pieces.

Rejected: growing floors further with a districts/transit layer; and splitting
the two by depth.

**What this means concretely**
- `constants/level.ts` currently saturates at 96×72 cells ≈ 27,985 tiles /
  11,818 walkable at L23-24. That ceiling comes **down**, not up.
- Machine density target rises from ~4 at depth toward **8-10 per floor**.
- Traversal time per floor should FALL. Interactions per minute should RISE.
- **The "districts / hubs / return-network / transit" layer from the original
  brief is deprioritised, not cancelled.** It was the answer to "how do we make
  a huge floor legible"; the user has chosen not to have huge floors. Revisit
  only if a later playtest says mid-size floors feel cramped.

**Why it is the right call, in one line:** the measured problem was never that
floors were too small — it was that a 6.8× bigger floor carried the same 2
machines. Fixing density is strictly cheaper than making sprawl navigable.

**Open risk:** capping floor size changes every floor and every existing seed.
It also interacts with `assemblyBudgetFor(walkable)` — a smaller walkable count
lowers the machine budget unless the divisor comes down with it. **Both must
move together, in one commit, with a census diff.** Doing one without the other
produces *fewer* machines on *smaller* floors, i.e. the exact opposite of the
intent.

---

## 2. Machine consequence — **all four**

The user selected every option offered, in this order:

| # | Consequence | Lifetime | Status |
|---|---|---|---|
| 1 | **Open the vault** — a third route to the sealed chest | cumulative | in build |
| 2 | **Overcharge window** — hot boosters, laddered payouts | windowed | in build |
| 3 | **Unlock a shortcut** — a gate opens, the floor graph changes | permanent-for-floor | designed, not built |
| 4 | **Change enemy behaviour** — shields drop / horde / boss vulnerable | windowed | designed, not built |

1 and 2 reuse shipped art and shipped state (`lamp-puzzle.ts`'s chest already
has `unlit → lit → open`), which is why they go first. 3 and 4 need a gate
entity, a floor-graph edit, a minimap layer and combat hooks.

**The binding constraint this places on the code:** `machine-effects.ts` must be
a **registry of named effects** reacting to the `collected` event, not a
hardcoded branch. Its abstraction has to express all four lifetimes above —
cumulative, windowed, and permanent-for-floor — or adding 3 and 4 later is a
rewrite rather than a registration. It should also leave room for an effect that
**asks a question** rather than applying a change, because of decision 4 below.

**Watch item:** with 8-10 machines per floor (decision 1), a windowed effect
that re-arms on every completion becomes permanently on. Re-arming must
explicitly EXTEND, REFRESH, or be IGNORED-while-active — a choice, made and
tested, not an accident.

---

## 3. The room layer — **restore it**

> Rooms are the grammar that says "this region is an arena".

`plan.rooms` is empty on every floor measured, which killed the whole
room-archetype furnishing layer and — through it — the 4-corner ORBIT rail ring,
the only producer of `orbit`/`orbitSeq`. So `shots.ts hitOrbitRail()`, the
flagship loop shot with its lap ladder and named combos, **has never fired in
the shipped game**.

Rejected: deleting the dead layer and getting loops only from `LOOP_REACTOR`
machines.

**Decisive reason:** the user asked for "finer loops". Restoring rooms is the
route to the loop mechanic that already exists, is already tested, and has
simply never been reachable.

**Constraints on the restoration**
- Must work at **1,747 walkable tiles (L1)** as well as 11,818 (L24). Under
  decision 1 floors get smaller, so a restoration that only produces rooms on
  large floors is not a restoration.
- Must not starve the machine layer. `inRoom()` excludes room tiles from the
  machine router's site scan, so rooms and machines compete for the same ground.
  Machines-per-floor must be measured before and after; current baseline
  0.60 / 2.00 / 3.00 / 4.00 at L1/L8/L16/L24.

**Separate finding to surface regardless of outcome:** if
`floor-pipeline.test.ts` and the determinism tests exercise only the LEGACY
branch while the game takes the TRACK-FIRST branch, then the pipeline's tests
cover a path the game does not run. That is a bigger problem than the room layer.

---

## 4. Risk — **real stakes, opt-in**

> Push-your-luck exists but you must choose to enter it. Skilled players get a
> ceiling; cautious players lose nothing by declining.

Rejected: the punishing variant (losing carried gold/items/HP), and the
generous one (risking only the pending bonus).

**The three rules this sets**
1. **Opt-in.** Never forced, never a surprise. Declining costs nothing and must
   remain a complete way to play.
2. **Real stakes.** Something already earned *this floor* can be lost — not the
   run, not the inventory. Something banked within the sequence.
3. **Repeated cash-out decisions** under escalating, *visible* pressure.

**The natural host** is `GARGOYLE_SCOOP`: a `capture` maw behind a target bank
with **two authored eject exits on different vectors** (`gullet-west` /
`gullet-east`). The release being a CHOICE is why it was authored that way.
Break the bank → enter the mouth → held for a beat → choose safe or escalate.

**The two things that decide whether this is buildable at all**
- **What is genuinely at stake.** If gold turns out to have no spend path — a
  live question under investigation — then "risk your gold" is not stakes and
  the mechanic needs a different currency (a multiplier, vault progress, a
  carried charge, an ally).
- **The decision must fit inside a capture beat.** That hold is the entire UI
  budget. If communicating the choice needs a modal or slow-motion, that is a
  real finding about whether the mechanic fits this game's speed.

**Frequency:** with 8-10 machines per floor, a risk moment on every scoop stops
being special. How often it should be available is an open number.

---

## What these four decisions kill

Worth stating, so nobody rebuilds them:

- **The districts / hubs / transit / return-network layer.** Deprioritised by
  decision 1. It solved a problem the user has chosen not to have.
- **"Very large / endgame floors — a table made of tables."** Same reason.
- **A travel-time budget for large floors.** Traversal should shrink, not be
  budgeted.
- **Punishing death-stakes designs.** Explicitly rejected in decision 4.
