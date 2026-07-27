# Game-dev rules

Durable, cross-game guidance for the games in `src/game/`. These are **rules**,
not plans: they outlive any one wave and should be read before starting work in
the area they cover, not after.

A plan doc (`*_PLAN.md` next to the game) says *what we are doing this month*.
A rules doc says *how this studio builds this kind of thing, and what it has
already learned the hard way*. When a wave finishes, the durable lesson moves
here and the plan doc gets retired.

| Doc | Read it before |
| --- | --- |
| [procedural-level-generation.md](procedural-level-generation.md) | touching any level/map/maze generator, or adding a knob to one |
| [game-research/](game-research/README.md) | designing or tuning any Pinball Knight system — 12 reference-game deep dives (loops, drop/stat/balance math, perf) with per-game "Lessons for Pinball Knight" sections |

Worked example: [../maze-generation-investigation-2026-07-26.md](../maze-generation-investigation-2026-07-26.md)
runs this whole workflow over the Pinball Knight floor generator — census,
findings, fix, validation loop — and is the shortest way to see what the steps
below actually look like in practice.

## The two rules that apply to every doc in here

1. **Verify every "X does not exist" claim in an outside plan against the code
   before costing it.** Externally drafted plans are written from a partial
   read. `MAZE_OVERHAUL_PLAN.md` opens with a table of four such premises that
   were wrong, two of which would have funded work that was already shipped.
   `ABILITY_FX_PLAN.md` hit the same wall. Budget an hour of reading before you
   budget a week of work.

2. **Measure before you fix, and measure the quantity — not a proxy for it.**
   Every number in this folder was produced by a census over N seeds, not by
   reading the source and reasoning about it. A knob whose *value* looks right
   can still be dead because nothing on the live path reads it; only a
   measurement over generated output catches that.
