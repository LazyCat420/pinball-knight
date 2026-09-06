/**
 * RIDE CENSUS — the instrument's own tests.
 *
 * `ride-census.ts` produced THREE false findings before it produced a true one
 * (its header names all three: `boostcurve` scored 100% "fires into a wall",
 * `jumppad` the same, and "28% of every launcher leads nowhere" — which was a
 * statement about `maxTrace`). It had no tests. An untested instrument that has
 * already lied three times is the least trustworthy thing in the tree, and its
 * numbers were quoted to the user and then retracted.
 *
 * Every fixture here is HAND-BUILT: an all-wall grid with named floor tiles
 * carved into it, and a `parts` list written by hand. That is deliberate and it
 * is the only thing that makes these tests worth anything — a generated floor's
 * expected answer can only be computed by the code under test, so a test driven
 * by one asserts that the census agrees with itself. Here the expected verdict
 * is derivable by reading the fixture, on paper, without running anything.
 *
 * Each `it` asserts ONE property of ONE fixture. Every one of them was shown
 * NON-VACUOUS by breaking `ride-census.ts` and watching it go red — the
 * mutation that kills each test is named in its comment. A test that passes
 * against a deliberately broken implementation measures nothing.
 */
import { describe, it, expect } from "vitest";
import { rideCensus, sweepTrace, MIN_RUNWAY, RIDE_KINDS } from "./ride-census";
import { T_FLOOR, T_STAIRS, type Grid } from "../engine/grid";
import type { LevelPlan, PartSpotKind, PinballPartSpot } from "../maze/decorate";

// ── Fixture kit ────────────────────────────────────────────────────────────

/** All-wall grid (T_WALL is 0, so a zeroed array is solid rock) with the listed
 *  tiles carved to floor. Same idiom as `maze/decorate.test.ts`. */
function grid(w: number, h: number, floors: ReadonlyArray<readonly [number, number]>): Grid {
  const g: Grid = { w, h, t: new Uint8Array(w * h), shapes: new Uint8Array(w * h) };
  for (const [i, j] of floors) g.t[j * w + i] = T_FLOOR;
  return g;
}

/** A horizontal run of floor on row `j`, inclusive of both ends. */
function row(j: number, i0: number, i1: number): Array<[number, number]> {
  const f: Array<[number, number]> = [];
  for (let i = i0; i <= i1; i++) f.push([i, j]);
  return f;
}

/**
 * The census reads `plan.parts` and nothing else on the plan, so a fixture plan
 * carries only that. Cast rather than fill in twelve unused fields: naming the
 * one field the instrument touches is itself part of the test's claim.
 */
function planOf(parts: PinballPartSpot[]): LevelPlan {
  return { parts } as unknown as LevelPlan;
}

/** A part spot with the four facing components defaulted to 0. */
function part(
  p: { i: number; j: number; kind: PartSpotKind } & Partial<PinballPartSpot>,
): PinballPartSpot {
  return { dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0, ...p };
}

/** The trace length used wherever the test is NOT about the trace length. Long
 *  enough that every fixture ray reaches its real terminus, so no verdict here
 *  is an artefact of the cutoff. */
const LONG = 30;

const east = { dirI: 1, dirJ: 0 } as const;

// ── The six verdicts, one fixture each ─────────────────────────────────────

describe("rideCensus — verdicts", () => {
  /**
   * FEEDS. Corridor on row 2; a booster at (2,2) firing east; a bumper three
   * tiles along its ray at (5,2). The launch hands off.
   *
   * Non-vacuous: replacing the `into` branch's `"feeds"` with `"nowhere"`
   * fails this (feeds 1 → 0).
   */
  it("scores a booster with a bumper on its exit ray as `feeds`, naming the receiver", () => {
    const g = grid(12, 6, row(2, 1, 10));
    const plan = planOf([
      part({ i: 2, j: 2, kind: "booster", ...east }),
      part({ i: 5, j: 2, kind: "bumper" }),
    ]);
    const c = rideCensus(g, plan, LONG);

    expect(c.feeds).toBe(1);
    expect(c.total).toBe(1); // the bumper is not a RIDE_KIND, so it is not censused
    expect(c.verdicts).toHaveLength(1);
    expect(c.verdicts[0]).toMatchObject({ verdict: "feeds", into: "bumper", runway: 3 });
  });

  /**
   * WALL. The same corridor cut short: floor runs out two tiles ahead of the
   * booster, which is below MIN_RUNWAY, and there is no part to catch it.
   *
   * Non-vacuous: widening the runway test to `runway < 0` fails this
   * (wall 1 → 0). The fixture's runway is asserted against MIN_RUNWAY rather
   * than against the literal 2, so the test states the RELATION it depends on.
   */
  it("scores a booster with less than MIN_RUNWAY ahead and no part as `wall`", () => {
    const g = grid(12, 6, row(2, 1, 4));
    const plan = planOf([part({ i: 2, j: 2, kind: "booster", ...east })]);
    const c = rideCensus(g, plan, LONG);

    expect(c.wall).toBe(1);
    expect(c.verdicts[0].verdict).toBe("wall");
    expect(c.verdicts[0].runway).toBeLessThan(MIN_RUNWAY);
  });

  /**
   * DUEL. Two boosters down one corridor pointing at each other: each one's
   * exit ray lands on the other, whose own exit ray points straight back.
   *
   * Non-vacuous: forcing the duel test to `false` (always `feeds`) fails this
   * (duel 2 → 0). Both ends are asserted, because a duel that only registers
   * from one side would still pass a `duel >= 1` check.
   */
  it("scores two launchers facing each other down one corridor as `duel`, from both ends", () => {
    const g = grid(12, 6, row(2, 1, 10));
    const plan = planOf([
      part({ i: 2, j: 2, kind: "booster", dirI: 1, dirJ: 0 }),
      part({ i: 6, j: 2, kind: "booster", dirI: -1, dirJ: 0 }),
    ]);
    const c = rideCensus(g, plan, LONG);

    expect(c.duel).toBe(2);
    expect(c.feeds).toBe(0);
    expect(c.verdicts.map((v) => v.verdict)).toEqual(["duel", "duel"]);
  });

  /**
   * NOWHERE. Eighteen tiles of clear corridor and not one part on it. The ray
   * reaches its real terminus well inside `LONG`, so this is a property of the
   * floor and not of the cutoff — the distinction the header exists to make.
   *
   * Non-vacuous: replacing the final `"nowhere"` with `"feeds"` fails this.
   */
  it("scores a long clear runway with no part anywhere on it as `nowhere`", () => {
    const g = grid(24, 6, row(2, 1, 20));
    const plan = planOf([part({ i: 2, j: 2, kind: "booster", ...east })]);
    const c = rideCensus(g, plan, LONG);

    expect(c.nowhere).toBe(1);
    expect(c.feeds).toBe(0);
    expect(c.verdicts[0].runway).toBeGreaterThanOrEqual(MIN_RUNWAY); // not a `wall` in disguise
    expect(c.verdicts[0].runway).toBeLessThan(LONG); // and not truncated by the cutoff
  });

  /**
   * VAULTS. A jump pad flush against a two-tile wall band with corridor beyond
   * it. `jumppad` is aimed at rock BY DESIGN — the question is whether there is
   * anywhere to land, and here there is.
   *
   * Non-vacuous: forcing `vaulting` to `false` fails this (vaults 1 → 0, the
   * pad is scored `wall` instead) — which is exactly the second false finding
   * in the header, reproduced.
   */
  it("scores a jumppad over a wall band with floor beyond it as `vaults`, landing past the band", () => {
    const g = grid(12, 6, [...row(2, 1, 3), ...row(2, 6, 9)]);
    const plan = planOf([part({ i: 3, j: 2, kind: "jumppad", ...east })]);
    const c = rideCensus(g, plan, LONG);

    expect(c.vaults).toBe(1);
    expect(c.blindjump).toBe(0);
    expect(c.wall).toBe(0);
    expect(c.verdicts[0].landing).toEqual({ i: 6, j: 2 }); // the far side, not the band
  });

  /**
   * BLINDJUMP. The same pad with nothing beyond the band but dead rock.
   * `startRampHop` degrades to a flat dash when it finds no clear landing, so
   * this is the jump that silently becomes a shove.
   *
   * Non-vacuous: hard-coding the vault verdict to `"vaults"` fails this
   * (blindjump 1 → 0). Distinguishing it from the `vaults` fixture above is
   * the whole point — the two differ by four floor tiles.
   */
  it("scores a jumppad with no floor beyond the band as `blindjump`", () => {
    const g = grid(14, 6, row(2, 1, 3));
    const plan = planOf([part({ i: 3, j: 2, kind: "jumppad", ...east })]);
    const c = rideCensus(g, plan, LONG);

    expect(c.blindjump).toBe(1);
    expect(c.vaults).toBe(0);
  });
});

// ── What the tracer must NOT give a verdict to ─────────────────────────────

describe("rideCensus — untraceable kinds get no verdict", () => {
  /**
   * A `boostcurve`'s heading is a non-cardinal tangent taken from the route it
   * was placed along. Stepping `i + dirI * s` with a fractional `dirI` walks off
   * the lane on step one, so a straight integer ray cannot measure it — and the
   * first version of this file reported every one of them as "fires into a
   * wall" for exactly that reason. It must be COUNTED and not SCORED.
   *
   * Non-vacuous — VERIFIED, and this one needed a second look: emptying the
   * `UNTRACEABLE` set does NOT fail this test, because the fractional facing is
   * then caught by the cardinal guard instead and the outcome is identical.
   * That is a real belt-and-braces property, so this test states it as such —
   * removing BOTH guards fails it (the curve is scored `feeds`). The test that
   * pins the named set on its own is the next one.
   */
  it("counts a boostcurve with a fractional tangent as `untraceable`, with no verdict", () => {
    const g = grid(12, 6, row(2, 1, 10));
    const plan = planOf([
      part({ i: 2, j: 2, kind: "boostcurve", dirI: 0.707, dirJ: 0.707 }),
      part({ i: 5, j: 2, kind: "bumper" }),
    ]);
    const c = rideCensus(g, plan, LONG);

    expect(c.untraceable).toBe(1);
    expect(c.total).toBe(0);
    expect(c.verdicts).toEqual([]);
    const scored = c.feeds + c.wall + c.duel + c.nowhere + c.vaults + c.blindjump;
    expect(scored).toBe(0);
    expect(c.byKind).toEqual({});
  });

  /**
   * The `UNTRACEABLE` set is keyed on the KIND, and has to be: a curve is
   * unmeasurable by a straight ray because of what it IS, not because of what
   * its tangent happened to round to. This curve carries a perfectly cardinal
   * facing down a clear corridor with a bumper three tiles along it — every
   * arithmetic guard in the tracer would wave it through — and it must still be
   * counted rather than scored.
   *
   * Non-vacuous — VERIFIED: emptying the `UNTRACEABLE` set fails this
   * (untraceable 1 → 0, total 0 → 1, and the curve is scored `feeds`). This is
   * the assertion the previous test could not make.
   */
  it("counts a boostcurve as `untraceable` even when its facing IS cardinal", () => {
    const g = grid(12, 6, row(2, 1, 10));
    const plan = planOf([
      part({ i: 2, j: 2, kind: "boostcurve", ...east }),
      part({ i: 5, j: 2, kind: "bumper" }),
    ]);
    const c = rideCensus(g, plan, LONG);

    expect(c.untraceable).toBe(1);
    expect(c.total).toBe(0);
    expect(c.feeds).toBe(0);
    expect(c.verdicts).toEqual([]);
  });

  /**
   * The same guard, reached the other way: a kind that IS traceable in general
   * but happens to carry a fractional facing. `boostcurve` is in a named set;
   * this one is caught by the arithmetic (`|di| + |dj| !== 1`), which is the
   * guard that protects every kind the named set has not heard of yet.
   *
   * Non-vacuous: changing the cardinal guard to a condition that never fires
   * (`!== -1`) fails this — the ramp is then traced with fractional steps and
   * scored `wall`.
   */
  it("counts any non-cardinal facing as `untraceable`, not only the named kinds", () => {
    const g = grid(12, 6, row(2, 1, 10));
    const plan = planOf([part({ i: 2, j: 2, kind: "ramp", dirI: 0.707, dirJ: 0.707 })]);
    const c = rideCensus(g, plan, LONG);

    expect(c.untraceable).toBe(1);
    expect(c.total).toBe(0);
    expect(c.verdicts).toEqual([]);
  });
});

// ── The exit leg of a two-leg kind ─────────────────────────────────────────

describe("rideCensus — a corner is traced along the leg it LEAVES by", () => {
  /**
   * A `boostcorner` is ENTERED along `dir` and LEAVES along `dir2`. This fixture
   * is built so the two answers are opposites and cannot be confused: `dir`
   * points north into solid rock, `dir2` points east down a corridor at a
   * bumper three tiles away.
   *
   * Non-vacuous — VERIFIED: with `exitDir` reduced to `return [p.dirI, p.dirJ]`
   * this test goes red on all three assertions at once (feeds 1 → 0, the corner
   * scored `wall`, and `runwayViolations` 0 → 1). That is the failure mode the
   * function's own docblock describes: "a corner that banks perfectly into a
   * target bank would be scored as firing into the wall behind it".
   */
  it("traces a boostcorner along `dir2`, so a corner banking into a bumper `feeds`", () => {
    const g = grid(12, 6, row(2, 1, 8)); // (3,1) north of the corner is rock
    const plan = planOf([
      part({ i: 3, j: 2, kind: "boostcorner", dirI: 0, dirJ: -1, dir2I: 1, dir2J: 0 }),
      part({ i: 6, j: 2, kind: "bumper" }),
    ]);
    const c = rideCensus(g, plan, LONG);

    expect(c.feeds).toBe(1);
    expect(c.verdicts[0]).toMatchObject({ verdict: "feeds", into: "bumper", runway: 3 });
    expect(c.runwayViolations).toBe(0);
  });
});

// ── The positive control ───────────────────────────────────────────────────

describe("rideCensus — `runwayViolations` is a control that can fire", () => {
  /**
   * A control that cannot fire is not a control, so it is tested BOTH ways on
   * two fixtures that differ only in the launcher's position.
   *
   * Non-vacuous: hard-coding `exempt = true` fails the second case (1 → 0), and
   * removing the `runway < MIN_RUNWAY` branch fails it too.
   */
  it("reports 0 on a well-formed fixture", () => {
    const g = grid(12, 6, row(2, 1, 10));
    const plan = planOf([
      part({ i: 2, j: 2, kind: "booster", ...east }),
      part({ i: 5, j: 2, kind: "bumper" }),
    ]);
    expect(rideCensus(g, plan, LONG).runwayViolations).toBe(0);
  });

  it("reports non-zero for a non-exempt launcher flush against rock", () => {
    // The same booster, moved to the last floor tile of the corridor: the tile
    // ahead of it is rock, so its runway is 0 — something `openLaunchTargets`
    // guarantees cannot happen on a real floor.
    const g = grid(12, 6, row(2, 1, 3));
    const plan = planOf([part({ i: 3, j: 2, kind: "booster", ...east })]);
    const c = rideCensus(g, plan, LONG);

    expect(c.runwayViolations).toBe(1);
    expect(c.wall).toBe(1);
    expect(c.verdicts[0].runway).toBe(0);
  });
});

// ── The exemptions ─────────────────────────────────────────────────────────

describe("rideCensus — parts exempt from the A1 runway repair", () => {
  /**
   * A spine booster, a launch-chute pad and an assembly member are all aimed by
   * something other than the topology, and `openLaunchTargets` leaves all three
   * alone. Scoring them `wall` is right; ACCUSING the tracer for them is not.
   *
   * Non-vacuous — VERIFIED: with `exempt` forced to `false`, `runwayViolations`
   * goes 0 → 3 and this test goes red. `wall` is asserted alongside so the test
   * cannot pass by the parts having been skipped entirely.
   */
  it("does not raise `runwayViolations` for a spine, chute or assembly launcher", () => {
    const g = grid(16, 10, [...row(2, 1, 3), ...row(4, 1, 3), ...row(6, 1, 3)]);
    const plan = planOf([
      part({ i: 3, j: 2, kind: "booster", ...east, spine: true }),
      part({ i: 3, j: 4, kind: "booster", ...east, chute: true }),
      part({ i: 3, j: 6, kind: "booster", ...east, asm: { id: 1, name: "popnest", role: "drive" } }),
    ]);
    const c = rideCensus(g, plan, LONG);

    expect(c.runwayViolations).toBe(0);
    expect(c.wall).toBe(3);
    expect(c.verdicts.map((v) => v.exempt)).toEqual([true, true, true]);
    expect(c.verdicts.map((v) => v.layer)).toEqual(["spine", "chute", "machine"]);
  });

  /**
   * A `vault`-flagged ramp is aimed at a band on purpose and flies it, exactly
   * like a `jumppad`, so it is judged by its far side and never reaches the
   * runway branch at all.
   *
   * Non-vacuous: dropping `p.vault` from `vaulting` fails this (vaults 1 → 0,
   * scored `wall`).
   */
  it("judges a vault-flagged ramp by its far side, so it is never a runway violation", () => {
    const g = grid(12, 6, [...row(2, 1, 3), ...row(2, 6, 9)]);
    const plan = planOf([part({ i: 3, j: 2, kind: "ramp", ...east, vault: true })]);
    const c = rideCensus(g, plan, LONG);

    expect(c.vaults).toBe(1);
    expect(c.runwayViolations).toBe(0);
    expect(c.wall).toBe(0);
  });
});

// ── The headline defect: `nowhere` is a statement about `maxTrace` ─────────

describe("rideCensus — `maxTrace` sensitivity", () => {
  /**
   * ONE fixture, two trace lengths, opposite verdicts. A single booster with a
   * receiver twenty tiles down an otherwise empty corridor:
   *
   *   maxTrace 12 → `nowhere`   (the receiver is beyond the cutoff)
   *   maxTrace 30 → `feeds`     (the same floor, looked at further)
   *
   * This is the exact mechanism behind "28% of every launcher leads nowhere",
   * the finding this file made and retracted. Nothing about the fixture changes
   * between the two calls, so any reading of `nowhere` that does not quote its
   * `maxTrace` is a reading of the constant.
   *
   * Non-vacuous: ignoring the `maxTrace` parameter (tracing to a fixed 999)
   * fails the first half (nowhere 1 → 0).
   */
  it("scores one unchanged fixture `nowhere` at maxTrace 12 and `feeds` at maxTrace 30", () => {
    const g = grid(34, 6, row(2, 1, 30));
    const plan = planOf([
      part({ i: 2, j: 2, kind: "booster", ...east }),
      part({ i: 22, j: 2, kind: "bumper" }), // twenty tiles along the ray
    ]);

    const short = rideCensus(g, plan, 12);
    expect(short.nowhere).toBe(1);
    expect(short.feeds).toBe(0);
    expect(short.maxTrace).toBe(12); // the census carries its own cutoff

    const long = rideCensus(g, plan, 30);
    expect(long.feeds).toBe(1);
    expect(long.nowhere).toBe(0);
    expect(long.maxTrace).toBe(30);
    expect(long.verdicts[0]).toMatchObject({ into: "bumper", runway: 20 });
  });

  /**
   * REGRESSION — the bug these tests found (see the `truncated` comment in the
   * source). The near-miss slop reads the neighbours of the tile where the
   * trace STOPPED; on a ray the budget cut short, that tile is wherever the
   * constant ran out. So a part sitting beside the cutoff tile was scored a
   * hand-off, and vanished again at a longer trace.
   *
   * Here the bumper sits at (14,3), lateral to the tile a 12-long trace stops
   * on. Before the fix this fixture read `feeds` at 12 and `nowhere` at 20 —
   * looking FURTHER found FEWER hand-offs.
   *
   * Non-vacuous: deleting the `truncated` branch fails this (feeds 1, nowhere 0
   * at maxTrace 12).
   */
  it("does not count a part beside the cutoff tile as a near miss (the ray never stopped there)", () => {
    const g = grid(34, 6, [...row(2, 1, 30), [14, 3]]);
    const plan = planOf([
      part({ i: 2, j: 2, kind: "booster", ...east }),
      part({ i: 14, j: 3, kind: "bumper" }), // beside the tile a 12-trace stops on
    ]);

    for (const maxTrace of [12, 20, 30]) {
      const c = rideCensus(g, plan, maxTrace);
      expect({ maxTrace, nowhere: c.nowhere, feeds: c.feeds }).toEqual({ maxTrace, nowhere: 1, feeds: 0 });
    }
  });

  /**
   * The near-miss slop itself, on a ray that genuinely ENDS. A booster fires
   * down a corridor that stops at rock, with a bumper one tile off the side of
   * the last floor tile — the player arrives beside it, which is a hand-off in
   * practice. This is the behaviour the `truncated` guard must not have
   * destroyed, so it is pinned separately from the regression above.
   *
   * Non-vacuous: removing the CATCH_SLOP scan fails this (feeds 1 → 0).
   */
  it("still counts a part one tile off the end of a ray that really stops there", () => {
    const g = grid(16, 8, [...row(2, 1, 8), [8, 3]]);
    const plan = planOf([
      part({ i: 2, j: 2, kind: "booster", ...east }),
      part({ i: 8, j: 3, kind: "bumper" }),
    ]);
    const c = rideCensus(g, plan, LONG);

    expect(c.feeds).toBe(1);
    expect(c.verdicts[0]).toMatchObject({ verdict: "feeds", into: "bumper", runway: 6 });
  });
});

// ── The sweep ──────────────────────────────────────────────────────────────

describe("sweepTrace", () => {
  /**
   * Four boosters down four parallel corridors with their receivers at 8, 23
   * and 31 tiles, and one with no receiver at all. Every trace length in the
   * sweep therefore resolves a different number of them, so the sweep MOVES —
   * a monotonicity assertion over a constant vector is a tautology.
   */
  const LENGTHS = [5, 12, 20, 30, 60] as const;
  function fourCorridors() {
    const g = grid(40, 12, [...row(2, 1, 35), ...row(4, 1, 35), ...row(6, 1, 35), ...row(8, 1, 35)]);
    const plan = planOf([
      part({ i: 2, j: 2, kind: "booster", ...east }),
      part({ i: 10, j: 2, kind: "bumper" }), // 8 tiles
      part({ i: 2, j: 4, kind: "booster", ...east }),
      part({ i: 25, j: 4, kind: "bumper" }), // 23 tiles
      part({ i: 2, j: 6, kind: "booster", ...east }),
      part({ i: 33, j: 6, kind: "bumper" }), // 31 tiles
      part({ i: 2, j: 8, kind: "booster", ...east }), // no receiver, ever
    ]);
    return { g, plan };
  }

  /**
   * Non-vacuous: returning `lengths.slice(1)` fails the length assertion, and
   * hard-coding the row's `maxTrace` fails the echo.
   */
  it("returns exactly one row per requested length, each carrying its own length", () => {
    const { g, plan } = fourCorridors();
    const rows = sweepTrace(g, plan, LENGTHS);

    expect(rows).toHaveLength(LENGTHS.length);
    expect(rows.map((r) => r.maxTrace)).toEqual([...LENGTHS]);
    expect(rows.map((r) => r.total)).toEqual([4, 4, 4, 4, 4]); // the same four launchers each time
  });

  /**
   * MONOTONICITY — the property that makes the sweep readable as evidence.
   *
   * Looking further can only RESOLVE a launcher, never un-resolve one, so
   * `nowhere` must fall (or hold) as `maxTrace` grows and `feeds` must rise (or
   * hold). This did NOT hold before the `truncated` fix: on a real generated
   * floor (seed 4 of the 14×11 maze) `nowhere` ran [7, 5, 6, 6, 6, 6, 6] and
   * `feeds` [6, 8, 7, 7, 7, 7, 7] over lengths [4, 8, 12, 20, 30, 60, 200].
   *
   * Both the exact vector and the general property are asserted: the vector
   * proves the sweep moves, the property is what a reader of `sweepTrace`
   * relies on.
   *
   * Non-vacuous — VERIFIED: deleting the `truncated` branch fails this (the
   * `nowhere` vector reads [0, 1, 1, 2, 1], which is not monotone).
   */
  it("reports `nowhere` monotonically non-increasing and `feeds` non-decreasing in maxTrace", () => {
    const { g, plan } = fourCorridors();
    const rows = sweepTrace(g, plan, LENGTHS);

    expect(rows.map((r) => r.nowhere)).toEqual([4, 3, 3, 2, 1]);
    expect(rows.map((r) => r.feeds)).toEqual([0, 1, 1, 2, 3]);

    for (let k = 1; k < rows.length; k++) {
      expect(rows[k].nowhere).toBeLessThanOrEqual(rows[k - 1].nowhere);
      expect(rows[k].feeds).toBeGreaterThanOrEqual(rows[k - 1].feeds);
    }
  });
});

// ── Guards on the fixture kit itself ───────────────────────────────────────

describe("the fixture kit says what it means", () => {
  /**
   * If `T_FLOOR` ever stops being what `grid()` writes, every fixture above
   * silently becomes an all-rock grid and every launcher reads `wall` — a
   * whole-file false green with no failing assertion anywhere. Pin the two tile
   * codes the tracer treats as open against the engine's own constants.
   */
  it("carves tiles the tracer counts as open", () => {
    const g = grid(4, 4, [[1, 1]]);
    expect(g.t[1 * 4 + 1]).toBe(T_FLOOR);
    expect(g.t[0]).not.toBe(T_FLOOR);
    expect(T_FLOOR).not.toBe(T_STAIRS);
  });

  /** Every kind these fixtures launch with must actually be censused, and the
   *  receiver kind must NOT be — otherwise `total` and `feeds` mean something
   *  other than what the tests above read them as. */
  it("uses launcher kinds the census scores and a receiver kind it does not", () => {
    for (const k of ["booster", "jumppad", "boostcorner", "boostcurve", "ramp"]) {
      expect(RIDE_KINDS.has(k)).toBe(true);
    }
    expect(RIDE_KINDS.has("bumper")).toBe(false);
  });
});
