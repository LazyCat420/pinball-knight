# Maze Generation Overhaul — checklist (2026-07-24)

Working checklist for the maze/level-generation wave, merged from an externally
drafted plan plus items found while shipping the curved-wall boosters.

**Every claim below has been checked against the code.** The draft was written
from a partial read and four of its premises are wrong in ways that change the
work — those are called out inline, because two of the tracks get *much* smaller
once you know what already exists. (Same lesson as ABILITY_FX_PLAN.md: verify
every "X does not exist" claim in an outside plan before costing it.)

---

## Corrections to the draft

| Draft claim | Reality |
|---|---|
| "Give `PrefabAnchor` a facing vector derived from `rotatePrefab` orientation" | **Not needed, and it wouldn't work.** A prefab anchor is `{i, j, kind}` (decorate.ts:118) and deliberately carries no direction: part facing is assigned LATER from local corridor topology (`classify` → deadend/straight/corner/junction, decorate.ts:218-229) and can then be *re-aimed again* by the runway-repair pass. Stamp rotation never reaches the part's `dirI/dirJ`. The anti-parallel check therefore needs **no prefab plumbing at all** — it runs as a post-pass over the final `PinballPartSpot[]`, where the real facings already live. |
| "Room archetypes are dropped after `buildMaze`, so the map can't label them" | **False / stale.** `core.ts:1414` stashes them: `state.levelRooms = plan.rooms.map(r => ({…, kind: r.kind}))`. The MAP_PLAN TODO this quotes has been done. |
| "Room *intent* isn't enforced during placement" | **Mostly false.** `furnishRooms` (decorate.ts:740+) already furnishes per archetype: `speedway` lays a ramp→booster→ramp lane **aimed down-flow** (with an explicit `KICKBACK_CHANCE` and a comment about the "speed up that sends you back" bug), `bumper` lays a staggered field that keeps the spine lane clear, `arena`/`vault` get corner geometry + prizes. The genuine gap is narrower: the separate **prefab-stamp pass** is intent-blind. |
| "Add a runtime cycle detector + destabilising impulse" | **80% already shipped.** `notePocketBounce` (player.ts, `POCKET_RADIUS 1.4 / POCKET_BOUNCES 5 / POCKET_DAMP 0.62 / POCKET_WINDOW 1.1`) is exactly that detector. It is only wired to **wall** bounces — not to part triggers. Wire it up rather than building a second one. |

Confirmed as written: `PrefabAnchor` has no facing; `stampFrom` has a
`mortarClash` rejection loop with `FOCUS_TRIES = 12`; `pickFocusCells` places
`n = 2` unweighted zones at ≥35% separation; `themeFor` is `(level-1) % 4`;
`archetypeFor` is `(level-1) % 5`; archetypes set `braidMult`/`braidGradient`
but **not** windiness — windiness is a flat 3-cycle by depth
(`WINDINESS_CYCLE = [1.0, 0.3, 0.65]`, constants.ts:1610).

---

## Track 0 — Test trust

- [x] **The intermittent failure: FOUND, MEASURED, FIXED.** It was
      `roulette.test.ts > never needs the emergency correction — the search
      finds a real trajectory`, and it had nothing to do with the dungeon work.
      `planSpin` searches for a *genuine* trajectory that lands on the
      already-drawn pocket by sweeping launch speeds under `SEED_TRIES` scatter
      seeds; if every sweep misses it falls back to a visible "correction", and
      the test forbids that. It is unseeded `Math.random`, so it is a dice roll.
      Measured over 30 000 spins: **one sweep misses with q ≈ 0.041**, failures
      go as `q^SEED_TRIES`, so at `SEED_TRIES = 3` the rate was **2/30 000**
      → across the test's 300 spins, a **~2% chance of a red suite per run**
      (matches the observed ~1-in-33). Raised to 6 → **0/30 000**, ~4e-9.
      The extra sweeps only run on the path that was already failing, so the
      cost is nil. Pinned by a `SEED_TRIES >= 6` guard test, because the
      300-spin test can only catch rates around 1e-3 and would never have
      caught this one.
      **Method worth reusing:** it would not reproduce idle (20/20 clean) — it
      took a scripted stress loop (12 full-suite runs against 14 CPU burners) to
      catch it, and then a standalone Monte Carlo to size the fix rather than
      guess it. Do not "fix" a flake you have not measured.
- [ ] **Watch for the same shape elsewhere.** Any test asserting a *probabilistic
      search always succeeds* has this failure mode. `darts.test.ts` runs a
      40 000-round unseeded Monte Carlo asserting RTP ∈ [1.05, 1.35] — measured
      clean at 40/40 runs, so it is well-centred today, but it is the same class
      and worth a margin check if the payout curve is ever retuned.
- [ ] **`toucan-game.test.ts` monkey-patches `global.Math.random = () => 0.5`
      and never restores it.** Harmless under vitest's per-file isolation, but
      it is a landmine if isolation is ever turned off for speed.
- [ ] **Smoke tests before more generation work.** The generation pipeline has
      no cheap "does a floor come out sane" gate that runs per-floor; the deep
      invariants live in a few heavy `it`s (vitest.config.js already raises
      `testTimeout` to 30 s for them). Add a fast smoke pass (N floors ×
      {reachable, has start+stairs, no orphan parts, no anti-parallel pair}).

## Track A — Booster feedback loops ✅ SHIPPED

The bug was real and COMMON: measured over 200 generated floors, **54.5% carried
at least one launch duel** (346 in total, ~1.7 per floor). Nothing damped them —
part cooldowns are short (a booster's is 0.18s), a launch part also stamps a
steer lock so you cannot drive out, and the pocket-rattle guard only watched
wall bounces.

- [x] **`breakLaunchDuels(g, parts)`** (decorate.ts, pure + tested) runs as the
      LAST pass that touches a facing — after placement, after the A1 runway
      repair, after the post-sweep re-aim. A duel is: facings anti-parallel, on
      the same fire axis, pointing at each other, within `DUEL_RANGE` (12), with
      **nothing but floor between them**. That last clause is the one the draft
      omitted and the one that matters — two opposed launchers with a wall
      between them are harmless and must not be churned.
      *(On this grid every launch facing is a unit cardinal, so the draft's
      dot-product tests collapse to exact integer comparisons — no thresholds to
      tune. And the second dot test is redundant: if a fires at b and the
      facings oppose, b necessarily fires at a.)*
- [x] Resolution, cheapest first: **re-aim** to any cardinal with runway that
      doesn't start a fresh duel (including a straight REVERSE — a duel needs
      anti-parallel facings, so flipping one makes the pair *parallel*, i.e. a
      chain, which is the good thing); else **demote to a bumper** but only on a
      junction, since KIND_TOPOLOGY requires it; else **remove**.
      Measured cost across 200 floors: ~243 re-aimed, 101 demoted, **2 removed**
      (13 691 → 13 689 parts). The floor keeps its furniture.
- [x] **A SPINE part never yields.** Learned the hard way: re-aiming one to
      escape a duel points it backward and breaks the connected route's
      down-flow invariant, which decorate.test.ts pins. A spine-vs-spine duel is
      left to the runtime guard instead.
- [x] Tests: hand-built corridors for each branch (head-on, wall between, out of
      range, facing away, perpendicular, vault-exempt, spine-exempt) plus a
      30-seed sweep asserting zero surviving duels on real floors. Census: 0/200
      floors after the pass.

## Track D — Runtime safety net ✅ SHIPPED

- [x] Part triggers now feed `notePocketBounce`. `updatePinball` snapshots
      `bounceCombo` around `touchPinballParts` and notes a rattle when it moves —
      every part trigger bumps it via `onPartTrigger`, so no new plumbing and no
      import cycle back into pinball-collide. This is the net for what static
      analysis cannot see: a smashed cracked wall reshaping a lane mid-run, a
      marble material, a pair that only lines up once you arrive at speed.
- [x] Arc KICKERS wired into the same guard (they were bypassing it — a hole I
      introduced in the boosters wave: two facing kicker bands across a narrow
      lane are the same standing wave).
- [ ] Optional polish: add a small angular jitter to the damped exit as well as
      the speed cut. A pure speed cut still leaves the *geometry* periodic.

## Track B — Level variety ✅ SHIPPED

- [x] **Windiness per archetype.** `FloorArchetype.windiness: [min, max]`, rolled
      per floor by `windinessFor(level, arch, rng)`, replacing the flat
      `WINDINESS_CYCLE[(l-1) % 3]`. Ranges are chosen to agree with each macro
      shape rather than fight it: spine 0.85–1.0 (branches stay dead-endy so the
      highway keeps its monopoly on speed), greathall 0.2–0.5 (bushy rind around
      the chamber), cavern 0.1–0.4 (short and branchy by nature), warrens
      0.5–0.9, ringkeep 0.6–0.8. **Level 1 is pinned to 1.0** — the familiar
      backtracker floor — for the same continuity reason the old cycle opened
      there. Measured: a Cavern now draws **19 distinct windiness values over 20
      floors**; before, every Cavern in the game was identical in texture.
- [x] **Per-run theme order.** `themeIndexFor(level, runSeed)` shuffles the four
      theme slots per run AND per cycle-of-four, so floors 1/5/9 are no longer
      always the Crypt, while no theme repeats inside any block of four.
      `runSeed 0` returns the identity order, i.e. exactly the old behaviour, so
      seedless callers (tests, tools) are unaffected.
      **The trap:** core.ts's `BIOMES` are paired with `THEMES` **by index** —
      a floor's colour grade is supposed to match its furniture pool — so
      `biomeFor` now reads the same `themeIndexFor` rather than its own modulo.
      Shuffling one without the other would silently decouple palette from
      content.

## Track C — Density and room intent

- [x] **Weighted hot zones.** `pickFocusCells` now returns `[cellX, cellY, bias]`
      with the first zone dominant (bias 1) and each later one deliberately
      weaker (1.5–2.5×, inflating its distances so it loses candidates in
      `nearestFocus`). Two equal zones gave every floor two matching blobs of
      activity — symmetric and predictable enough that the density gradient
      stopped reading as pacing. Now: one loud region, one quieter satellite.
- [ ] **Intent-aware prefab stamps.** BLOCKED ON ORDERING, and the blocker is
      worth writing down: room *kinds* are assigned inside `furnishRooms`, which
      runs in `decorateMaze` — but `stampPrefabs` runs BEFORE that, in
      `startLevel`, on the raw pre-thicken grid. At stamp time the rooms exist
      (`rawRooms`) but their archetypes do not. Doing this properly means
      hoisting the kind assignment (a distance-from-start fraction plus the
      doorstep and forced-vault rules) out of `furnishRooms` into something both
      passes can call, then passing per-zone tags into `stampFrom`. Not hard,
      but it is a refactor of a load-bearing function rather than the additive
      change the draft implies — and rooms are ALREADY intent-furnished, so the
      remaining win is only over the corridor stamps.

## Track E — Carried over from the boosters/FX wave

- [ ] **Kicker feel tuning** — needs a real monitor. Currently 45% of qualifying
      convex sweeps + always 3 on the island, cap 10/floor; kick is +2.6 u/s
      flat with a 9 u/s exit floor (a bumper is +3.2).
- [ ] **Should kickers join the bumper light/JACKPOT loop?** They tick the combo
      and pay 1g but never light. Wiring them in changes jackpot pacing.
- [ ] Kickers only fire while riding momentum; bumpers fire from a cold walk.
      Intentional asymmetry — confirm.
- [x] **Magnet Aura + Time Crawl** moved off the FAT ring band onto thin
      wave-front lines plus a sigil. Magnet's sigil counter-rotates against its
      collapsing rings for the full 4s; Time Crawl's turns almost imperceptibly
      (0.16 rad/s) for its 3s — the sigil's graduated rim ticks read as a CLOCK
      FACE, which is the one shape that says "time" instead of "an area effect".
- [x] **Blade Storm colour** unified to steel (`#c8ccd4`) across the ability
      table, the Diablo HUD buff chip and the classic HUD buff strip — it was
      blood red in the HUD while the world drew steel crescents.
