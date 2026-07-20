/**
 * Dartboard scoring tests.
 *
 * Darts is the only game here with no RNG in the outcome, which means the board
 * geometry IS the game. A ring boundary that's off by a hair, or a wedge index
 * that's rotated by one, is not a rounding error — it's the player aiming at one
 * number and being paid for another.
 */
import { describe, it, expect } from "vitest";
import {
  scoreAt,
  payoutFor,
  sweepSpeed,
  throwSpeed,
  dartSpeedRamp,
  wobbleRadius,
  applyWobble,
  yHalfRange,
  maxRound,
  WEDGES,
  WEDGE_COUNT,
  R_BULL,
  R_OUTER,
  R_OUTER_BULL,
  R_TREBLE_IN,
  R_TREBLE_OUT,
  R_DOUBLE_IN,
  X_SWEEP_AMPLITUDE,
  DARTS_PER_ROUND,
  PAYOUT_BANDS,
  TREBLE_20,
  SAFE_20,
} from "./darts";
import { createThrowMachine, FLIGHT, SETTLE_HOLD, type ThrowEvent } from "./darts-throw";
import { MIN_STAKE, MAX_STAKE_ABS, ROUNDS_PER_VISIT } from "./table";

/** A point at radius r along the centre of wedge index i. */
function atWedge(i: number, r: number): { x: number; y: number } {
  const ang = (i / WEDGE_COUNT) * Math.PI * 2;
  return { x: Math.sin(ang) * r, y: -Math.cos(ang) * r };
}

describe("the bulls", () => {
  it("dead centre is a bullseye worth 50", () => {
    const h = scoreAt(0, 0);
    expect(h.ring).toBe("bull");
    expect(h.points).toBe(50);
  });

  it("just outside the bull is the outer bull, worth 25", () => {
    const h = scoreAt(0, -(R_BULL + 0.01));
    expect(h.ring).toBe("outer-bull");
    expect(h.points).toBe(25);
  });

  it("the bull beats the outer bull, which beats most singles", () => {
    expect(scoreAt(0, 0).points).toBeGreaterThan(scoreAt(0, -(R_BULL + 0.01)).points);
  });

  it("bulls belong to no wedge", () => {
    expect(scoreAt(0, 0).wedge).toBe(0);
  });
});

describe("rings", () => {
  it("scores a single between the bull and the treble", () => {
    const p = atWedge(0, (R_OUTER_BULL + R_TREBLE_IN) / 2);
    const h = scoreAt(p.x, p.y);
    expect(h.ring).toBe("single");
    expect(h.points).toBe(WEDGES[0]);
  });

  it("trebles the middle band", () => {
    const p = atWedge(0, (R_TREBLE_IN + R_TREBLE_OUT) / 2);
    const h = scoreAt(p.x, p.y);
    expect(h.ring).toBe("treble");
    expect(h.points).toBe(WEDGES[0] * 3);
  });

  it("doubles the outer band", () => {
    const p = atWedge(0, (R_DOUBLE_IN + 1) / 2);
    const h = scoreAt(p.x, p.y);
    expect(h.ring).toBe("double");
    expect(h.points).toBe(WEDGES[0] * 2);
  });

  it("scores a single between the treble and the double", () => {
    const p = atWedge(0, (R_TREBLE_OUT + R_DOUBLE_IN) / 2);
    expect(scoreAt(p.x, p.y).ring).toBe("single");
  });

  it("misses beyond the board", () => {
    const h = scoreAt(0, -1.4);
    expect(h.ring).toBe("miss");
    expect(h.points).toBe(0);
  });

  it("a near miss just off the edge scores nothing", () => {
    // The whole tension of the double ring: the best band sits against the void.
    expect(scoreAt(0, -1.001).points).toBe(0);
  });
});

describe("wedges", () => {
  it("puts wedge 0 straight up", () => {
    const h = scoreAt(0, -0.7);
    expect(h.wedge).toBe(WEDGES[0]);
  });

  it("walks clockwise", () => {
    // One wedge clockwise from the top must be the next entry in the table.
    const p = atWedge(1, 0.7);
    expect(scoreAt(p.x, p.y).wedge).toBe(WEDGES[1]);
  });

  it("covers every wedge exactly once around the board", () => {
    const seen = new Set<number>();
    for (let i = 0; i < WEDGE_COUNT; i++) {
      const p = atWedge(i, 0.7);
      seen.add(scoreAt(p.x, p.y).wedge);
    }
    expect(seen.size).toBe(WEDGE_COUNT);
  });

  it("wraps cleanly at the top rather than leaving a dead slice", () => {
    // Just either side of straight up must both resolve to a real wedge — an
    // off-by-one in the angle wrap leaves a gap or double-counts a wedge.
    const eps = 0.02;
    expect(scoreAt(-eps, -0.7).wedge).toBeGreaterThan(0);
    expect(scoreAt(eps, -0.7).wedge).toBeGreaterThan(0);
  });

  it("gives wildly different values to neighbours", () => {
    // Adjacency is what punishes a near miss; a sorted board would forgive it.
    let bigJumps = 0;
    for (let i = 0; i < WEDGE_COUNT; i++) {
      const a = WEDGES[i];
      const b = WEDGES[(i + 1) % WEDGE_COUNT];
      if (Math.abs(a - b) >= 5) bigJumps++;
    }
    expect(bigJumps).toBeGreaterThan(WEDGE_COUNT / 2);
  });
});

describe("payout bands", () => {
  it("pays nothing for a poor round", () => {
    expect(payoutFor(0).mult).toBe(0);
    expect(payoutFor(29).mult).toBe(0);
  });

  it("pushes exactly at the safe line — three fat 20s", () => {
    // 3 × 20 = 60 is what playing it safe scores, and it must be a push: the
    // whole risk/reward reading depends on "keep your money" and "make money"
    // being different buttons.
    expect(payoutFor(60).mult).toBe(1);
    expect(payoutFor(54).mult).toBe(0);
  });

  it("rises with the score and never falls", () => {
    let prev = -1;
    for (let total = 0; total <= maxRound(); total += 5) {
      const m = payoutFor(total).mult;
      expect(m, `payout dipped at ${total}`).toBeGreaterThanOrEqual(prev);
      prev = Math.max(prev, m);
    }
  });

  it("three singles is a LOSS — the floor has to hurt", () => {
    // ~3 x 10 = 30 is a push at best; anything weaker must lose, or darts pays
    // for simply hitting the board.
    expect(payoutFor(3 * 6).mult).toBe(0);
  });

  it("caps below the theoretical maximum being trivially reachable", () => {
    // Max is 3 x treble-20 = 180. The top band starts at 120, so it demands a
    // genuinely strong round rather than a lucky one.
    expect(maxRound()).toBe(180);
    expect(PAYOUT_BANDS[0].min).toBeGreaterThan(maxRound() * 0.6);
  });

  it("has a band for every possible total", () => {
    for (let total = 0; total <= maxRound(); total++) {
      expect(payoutFor(total)).toBeDefined();
    }
  });
});

describe("sweepSpeed", () => {
  it("rises with the stake — a bigger bet is a harder throw", () => {
    expect(sweepSpeed(100)).toBeGreaterThan(sweepSpeed(5));
  });

  it("stays playable at the smallest stake", () => {
    expect(sweepSpeed(5)).toBeLessThan(1.5);
  });

  it("stays possible at the largest", () => {
    expect(sweepSpeed(100)).toBeLessThan(3);
  });
});

describe("round shape", () => {
  it("throws three darts", () => {
    expect(DARTS_PER_ROUND).toBe(3);
  });
});

describe("the Y sweep follows the chord of the board", () => {
  // The bug this fixes: X and Y both swept ±1, so the aim space was a SQUARE
  // over a ROUND board. Locking X near the rim left almost every Y a miss and
  // the player had thrown the dart away one press before they could know.
  it("gives the full height at the centre", () => {
    expect(yHalfRange(0)).toBeGreaterThan(1);
  });

  it("narrows as the aim moves out toward the rim", () => {
    expect(yHalfRange(0.9)).toBeLessThan(yHalfRange(0.5));
    expect(yHalfRange(0.5)).toBeLessThan(yHalfRange(0));
  });

  it("keeps every X lock playable — the window is never zero", () => {
    for (let x = -X_SWEEP_AMPLITUDE; x <= X_SWEEP_AMPLITUDE; x += 0.02) {
      expect(yHalfRange(x), `dead window at x=${x.toFixed(2)}`).toBeGreaterThan(0.1);
    }
  });

  it("still lets a centred aim overshoot the board and miss", () => {
    // A sweep that cannot leave the board is a sweep with no failure state.
    expect(yHalfRange(0)).toBeGreaterThan(R_OUTER);
  });

  it("covers the board's actual chord wherever you lock", () => {
    for (const x of [0, 0.3, 0.6, 0.85]) {
      expect(yHalfRange(x)).toBeGreaterThanOrEqual(Math.sqrt(1 - x * x));
    }
  });
});

describe("the unsteady hand", () => {
  it("is tighter than the treble band at the minimum stake", () => {
    // Small bets are where the throw is LEARNED, so trebles must be reliable.
    const trebleHalfWidth = (R_TREBLE_OUT - R_TREBLE_IN) / 2;
    expect(wobbleRadius(MIN_STAKE, 0)).toBeLessThan(trebleHalfWidth);
  });

  it("is wider than the treble band at the maximum stake", () => {
    // ...and big bets are where it stops being reliable. If the wobble does not
    // exceed the band it threatens it is decoration — the first tuning pass had
    // it at 0.066 and a perfect aimer still averaged 173 of a possible 180.
    const trebleHalfWidth = (R_TREBLE_OUT - R_TREBLE_IN) / 2;
    expect(wobbleRadius(MAX_STAKE_ABS, 0)).toBeGreaterThan(trebleHalfWidth);
  });

  it("leaves the fat single ring far more forgiving than the treble band", () => {
    // The safe line rides on the fat ring, so the gap between the two is the
    // whole reason a player has a choice to make.
    const fatRingHalfWidth = (R_TREBLE_IN - R_OUTER_BULL) / 2;
    const trebleHalfWidth = (R_TREBLE_OUT - R_TREBLE_IN) / 2;
    expect(fatRingHalfWidth / trebleHalfWidth).toBeGreaterThan(3);
  });

  it("outgrows even the fat ring by the last dart of a max-stake round", () => {
    // Asserted rather than merely tolerated. At 5g the safe line is exactly a
    // push; at 100g the third dart's wobble (0.180) has just overrun the fat
    // ring's half-width (0.170), which is why safe play measures 0.573 there.
    // At a small stake playing safe protects you; at a big one nothing does.
    const fatRingHalfWidth = (R_TREBLE_IN - R_OUTER_BULL) / 2;
    expect(wobbleRadius(MIN_STAKE, 0)).toBeLessThan(fatRingHalfWidth);
    expect(wobbleRadius(MAX_STAKE_ABS, DARTS_PER_ROUND - 1)).toBeGreaterThan(fatRingHalfWidth);
  });

  it("grows with the stake and with the dart number", () => {
    expect(wobbleRadius(100, 0)).toBeGreaterThan(wobbleRadius(5, 0));
    expect(wobbleRadius(50, 2)).toBeGreaterThan(wobbleRadius(50, 0));
  });

  it("is a HARD bound, so a dart never lands somewhere absurd", () => {
    // Bounded on purpose. An unbounded gaussian would occasionally fling a dart
    // across the board, which reads as the game cheating.
    const r = wobbleRadius(100, 2);
    for (let i = 0; i < 2000; i++) {
      const p = applyWobble(0.2, -0.4, r, Math.random);
      expect(Math.hypot(p.x - 0.2, p.y + 0.4)).toBeLessThanOrEqual(r + 1e-9);
    }
  });

  it("scatters in every direction rather than favouring one", () => {
    let left = 0;
    let up = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const p = applyWobble(0, 0, 0.1, Math.random);
      if (p.x < 0) left++;
      if (p.y < 0) up++;
    }
    expect(left / N).toBeGreaterThan(0.44);
    expect(left / N).toBeLessThan(0.56);
    expect(up / N).toBeGreaterThan(0.44);
    expect(up / N).toBeLessThan(0.56);
  });
});

describe("the sweep gets harder inside a round", () => {
  it("speeds up on each successive dart", () => {
    expect(dartSpeedRamp(1)).toBeGreaterThan(dartSpeedRamp(0));
    expect(dartSpeedRamp(2)).toBeGreaterThan(dartSpeedRamp(1));
  });

  it("leaves the first dart at the plain stake speed", () => {
    expect(throwSpeed(25, 0)).toBeCloseTo(sweepSpeed(25), 10);
  });

  it("keeps even the last dart of a max-stake round throwable", () => {
    // Past about 3.5 sweeps/second the bar is faster than human reaction and
    // the game stops being skill and becomes a slot machine with extra steps.
    expect(throwSpeed(100, DARTS_PER_ROUND - 1)).toBeLessThan(3.5);
  });
});

/**
 * ── The throw, end to end ───────────────────────────────────────────────────
 *
 * The state machine is the game. It used to be unreachable from a test at all:
 * `poke()` read a sweep value off a clock that only advanced inside `render()`,
 * so the mechanic could not be exercised without a browser. Now it is pure.
 */
describe("the aim / throw state machine", () => {
  /** Advance `dt` in 120Hz steps, collecting everything the machine emitted. */
  function run(m: ReturnType<typeof createThrowMachine>, seconds: number): ThrowEvent[] {
    const out: ThrowEvent[] = [];
    const step = 1 / 120;
    for (let t = 0; t < seconds; t += step) out.push(...m.tick(step));
    return out;
  }

  it("starts idle and only arms when a round begins", () => {
    const m = createThrowMachine(() => 0.5);
    expect(m.phase()).toBe("idle");
    expect(m.busy()).toBe(false);
    m.begin(10);
    expect(m.phase()).toBe("aim-x");
    expect(m.busy()).toBe(true);
  });

  it("walks aim-x → aim-y → flying → aim-x for the next dart", () => {
    const m = createThrowMachine(() => 0.5);
    m.begin(10);

    expect(m.press().map((e) => e.type)).toEqual(["lock-x"]);
    expect(m.phase()).toBe("aim-y");

    expect(m.press().map((e) => e.type)).toEqual(["release"]);
    expect(m.phase()).toBe("flying");

    const events = run(m, FLIGHT + 0.05);
    expect(events.some((e) => e.type === "land")).toBe(true);
    expect(m.phase()).toBe("aim-x");
    expect(m.darts()).toHaveLength(1);
  });

  it("holds the dart in the air for the whole flight rather than teleporting it", () => {
    // The old renderer pushed the dart into the board on the button press and
    // then sat on a 'flying' phase that drew nothing moving, so the throw was a
    // teleport followed by an unexplained pause.
    const m = createThrowMachine(() => 0.5);
    m.begin(10);
    m.press();
    m.press();
    expect(m.darts()).toHaveLength(0);
    expect(m.flight()).not.toBeNull();

    run(m, FLIGHT * 0.5);
    const mid = m.flight();
    expect(mid).not.toBeNull();
    expect(mid!.p).toBeGreaterThan(0.3);
    expect(mid!.p).toBeLessThan(0.7);
    expect(m.darts()).toHaveLength(0);

    run(m, FLIGHT);
    expect(m.flight()).toBeNull();
    expect(m.darts()).toHaveLength(1);
  });

  it("ends the round after exactly three darts and then unlocks", () => {
    const m = createThrowMachine(() => 0.5);
    m.begin(10);
    const all: ThrowEvent[] = [];
    for (let d = 0; d < DARTS_PER_ROUND; d++) {
      all.push(...m.press());
      all.push(...m.press());
      all.push(...run(m, FLIGHT + 0.05));
    }
    expect(m.darts()).toHaveLength(DARTS_PER_ROUND);
    expect(m.phase()).toBe("done");
    expect(all.filter((e) => e.type === "round-done")).toHaveLength(1);

    // The settle hold keeps the result on screen, then the table reopens.
    run(m, SETTLE_HOLD + 0.05);
    expect(m.phase()).toBe("idle");
  });

  it("swallows presses during flight, so mashing cannot skip or double-resolve", () => {
    const m = createThrowMachine(() => 0.5);
    m.begin(10);
    m.press();
    m.press();
    expect(m.phase()).toBe("flying");
    for (let i = 0; i < 20; i++) expect(m.press()).toEqual([]);
    run(m, FLIGHT + 0.05);
    expect(m.darts()).toHaveLength(1);
  });

  it("emits exactly one round-done however hard the button is mashed", () => {
    const m = createThrowMachine(() => 0.5);
    m.begin(10);
    const all: ThrowEvent[] = [];
    for (let i = 0; i < 400; i++) {
      all.push(...m.press());
      all.push(...m.tick(1 / 120));
    }
    expect(all.filter((e) => e.type === "round-done")).toHaveLength(1);
  });

  it("ticks the reticle faster at a bigger stake — the metronome IS the tell", () => {
    const slow = createThrowMachine(() => 0.5);
    const fast = createThrowMachine(() => 0.5);
    slow.begin(MIN_STAKE);
    fast.begin(MAX_STAKE_ABS);
    const count = (m: ReturnType<typeof createThrowMachine>): number =>
      run(m, 1).filter((e) => e.type === "tick").length;
    expect(count(fast)).toBeGreaterThan(count(slow));
  });

  it("resets completely between rounds", () => {
    const m = createThrowMachine(() => 0.5);
    m.begin(10);
    for (let d = 0; d < DARTS_PER_ROUND; d++) {
      m.press();
      m.press();
      run(m, FLIGHT + 0.05);
    }
    expect(m.total()).toBeGreaterThanOrEqual(0);
    m.begin(10);
    expect(m.darts()).toHaveLength(0);
    expect(m.total()).toBe(0);
    expect(m.phase()).toBe("aim-x");
  });
});

/**
 * ── The house invariant ─────────────────────────────────────────────────────
 *
 * `slots-game.ts` sets the rule: what a game shows and what it pays can never
 * disagree. Slots satisfies it by deciding up front. Darts satisfies it the
 * other way — the score is read off where the dart physically ended up — which
 * only holds if there is exactly ONE scoring call per dart and everything
 * downstream reads its result.
 */
describe("the score is whatever the dart actually hit", () => {
  function throwRound(seed: number, stake = 50): ReturnType<typeof createThrowMachine> {
    let n = seed;
    // Cheap deterministic LCG, so a failure is reproducible from its seed.
    const rng = (): number => {
      n = (n * 1664525 + 1013904223) % 4294967296;
      return n / 4294967296;
    };
    const m = createThrowMachine(rng);
    m.begin(stake);
    for (let d = 0; d < DARTS_PER_ROUND; d++) {
      for (let i = 0; i < 7 + d * 5; i++) m.tick(1 / 120);
      m.press();
      for (let i = 0; i < 11 + d * 3; i++) m.tick(1 / 120);
      m.press();
      for (let i = 0; i < 60; i++) m.tick(1 / 120);
    }
    return m;
  }

  it("stores the hit that scoreAt gives for the landing coordinate", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const m = throwRound(seed);
      for (const d of m.darts()) {
        expect(d.hit, `seed ${seed}`).toEqual(scoreAt(d.x, d.y));
      }
    }
  });

  it("totals the round as the sum of the darts stuck in the board", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const m = throwRound(seed);
      const sum = m.darts().reduce((n, d) => n + d.hit.points, 0);
      expect(m.total(), `seed ${seed}`).toBe(sum);
      expect(m.result().total, `seed ${seed}`).toBe(sum);
    }
  });

  it("pays the band belonging to that same total — no second calculation", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const m = throwRound(seed);
      const r = m.result();
      expect(r.mult, `seed ${seed}`).toBe(payoutFor(r.total).mult);
      expect(r.label, `seed ${seed}`).toBe(payoutFor(r.total).label);
    }
  });

  it("reports the same total in round-done as it leaves on the board", () => {
    let n = 7;
    const rng = (): number => {
      n = (n * 1664525 + 1013904223) % 4294967296;
      return n / 4294967296;
    };
    const m = createThrowMachine(rng);
    m.begin(100);
    let done: ThrowEvent | undefined;
    for (let d = 0; d < DARTS_PER_ROUND; d++) {
      for (let i = 0; i < 9; i++) m.tick(1 / 120);
      m.press();
      for (let i = 0; i < 13; i++) m.tick(1 / 120);
      m.press();
      for (let i = 0; i < 60; i++) {
        for (const e of m.tick(1 / 120)) if (e.type === "round-done") done = e;
      }
    }
    expect(done).toBeDefined();
    const evt = done as Extract<ThrowEvent, { type: "round-done" }>;
    expect(evt.total).toBe(m.darts().reduce((s, d) => s + d.hit.points, 0));
    expect(evt.mult).toBe(payoutFor(evt.total).mult);
  });

  it("never lands a dart further from the aim than the hand can shake", () => {
    // The visual contract: the sprite is drawn at (x, y) and the score was taken
    // at (x, y), and (x, y) is always near where the player locked. So the board
    // can never show a dart somewhere it did not score.
    for (let seed = 1; seed <= 40; seed++) {
      const m = throwRound(seed, MAX_STAKE_ABS);
      m.darts().forEach((d, i) => {
        const slack = wobbleRadius(MAX_STAKE_ABS, i) + 1e-9;
        expect(Math.hypot(d.x - d.aimX, d.y - d.aimY), `seed ${seed} dart ${i}`).toBeLessThanOrEqual(slack);
      });
    }
  });
});

/**
 * ── The economy ────────────────────────────────────────────────────────────
 *
 * The reason this file exists. `table.ts` names darts as the game most at risk
 * of becoming an unlimited gold faucet, and before this pass it WAS one: the
 * top band paid 6× for 120+, and a player who had learned the single fixed
 * sweep timing hit 180 every round.
 *
 *     6 rounds × 100g × (6.0 − 1) = +3000g per visit, against a floor income of
 *     80–200g. Twenty-one floors' worth of gold, per floor.
 *
 * The budget now is that a MASTER earns about one floor's income per visit, so
 * perfect-timing RTP must land in [1.05, 1.35]. These are the assertions that
 * hold the payout curve and the wobble to that, together — neither can be
 * retuned in isolation without this failing.
 */
describe("the per-visit economics", () => {
  /** An optimal player: locks dead on `aim`, and only the hand betrays them. */
  function simulate(aim: { x: number; y: number }, stake: number, jitter: number, rounds: number): number {
    let returned = 0;
    for (let r = 0; r < rounds; r++) {
      let total = 0;
      for (let i = 0; i < DARTS_PER_ROUND; i++) {
        const ax = aim.x + (Math.random() * 2 - 1) * jitter;
        const ay = aim.y + (Math.random() * 2 - 1) * jitter;
        const p = applyWobble(ax, ay, wobbleRadius(stake, i), Math.random);
        total += scoreAt(p.x, p.y).points;
      }
      returned += payoutFor(total).mult;
    }
    return returned / rounds;
  }

  const N = 40000;

  it("caps a master at roughly one floor's income per visit", () => {
    const r = simulate(TREBLE_20, MAX_STAKE_ABS, 0, N);
    expect(r, `perfect-timing RTP was ${r.toFixed(3)}`).toBeGreaterThan(1.05);
    expect(r, `perfect-timing RTP was ${r.toFixed(3)}`).toBeLessThan(1.35);

    const profit = ROUNDS_PER_VISIT * MAX_STAKE_ABS * (r - 1);
    // A floor yields 80–200g (GAMBLER_PLAN.md). Mastery is worth about one of
    // those — not the twenty-one the old curve paid.
    expect(profit).toBeGreaterThan(30);
    expect(profit).toBeLessThan(230);
  });

  it("leaves an ordinary player at about break-even", () => {
    // Optimal aim plus a realistic amount of timing error.
    const r = simulate(TREBLE_20, MAX_STAKE_ABS, 0.15, N);
    expect(r, `sloppy RTP was ${r.toFixed(3)}`).toBeGreaterThan(0.85);
    expect(r, `sloppy RTP was ${r.toFixed(3)}`).toBeLessThan(1.15);
  });

  it("makes playing safe a push at a small stake and a loss at a big one", () => {
    // This IS the risk/reward. Three fat 20s is 60, exactly the push line, and
    // at max stake your hand shakes too much to even hold the fat ring.
    expect(simulate(SAFE_20, MIN_STAKE, 0, 4000)).toBeCloseTo(1, 2);
    expect(simulate(SAFE_20, MAX_STAKE_ABS, 0, N)).toBeLessThan(0.8);
  });

  it("still pays the greedy line better than the safe one at every stake", () => {
    // If safe play ever beat treble play the game would have no reason to exist.
    for (const stake of [MIN_STAKE, 25, MAX_STAKE_ABS]) {
      expect(simulate(TREBLE_20, stake, 0, 8000)).toBeGreaterThan(simulate(SAFE_20, stake, 0, 8000));
    }
  });

  it("pays less per gold staked as the stake rises — the cap is self-enforcing", () => {
    // Because the wobble widens with the stake, the RTP curve slopes DOWN. A
    // player cannot buy a better return by betting more, which is what stops
    // the visit limit from being the only thing holding the economy up.
    const small = simulate(TREBLE_20, MIN_STAKE, 0, 8000);
    const big = simulate(TREBLE_20, MAX_STAKE_ABS, 0, 8000);
    expect(big).toBeLessThan(small);
  });

  it("never pays more than the old curve's floor, at any reachable total", () => {
    // A guard against someone re-steepening the bands later: 2× is the ceiling.
    for (const b of PAYOUT_BANDS) expect(b.mult).toBeLessThanOrEqual(2);
    expect(payoutFor(maxRound()).mult).toBeLessThanOrEqual(2);
  });
});
