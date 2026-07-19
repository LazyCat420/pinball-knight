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
  maxRound,
  WEDGES,
  WEDGE_COUNT,
  R_BULL,
  R_OUTER_BULL,
  R_TREBLE_IN,
  R_TREBLE_OUT,
  R_DOUBLE_IN,
  DARTS_PER_ROUND,
  PAYOUT_BANDS,
} from "./darts";

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

  it("pushes an average round", () => {
    expect(payoutFor(30).mult).toBe(1);
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
