/**
 * Roulette pricing tests.
 *
 * The property that matters: EVERY bet on the table returns the same 18/19. A
 * single mispriced `pays` is invisible in play — the game looks fine, and a
 * player who happens to favour that bet quietly farms the house. Enumerating
 * all 19 pockets per bet is cheap and catches it exactly.
 */
import { describe, it, expect } from "vitest";
import {
  BETS,
  POCKETS,
  WHEEL_NUMBERS,
  colorOf,
  wins,
  settleBet,
  straightBet,
  spinWheel,
  exactRtp,
  thirdRange,
} from "./roulette";

const EXPECTED_RTP = WHEEL_NUMBERS / POCKETS; // 18/19

describe("pricing", () => {
  it("every table bet returns exactly 18/19", () => {
    for (const b of BETS) {
      expect(exactRtp(b), `"${b.label}" is mispriced`).toBeCloseTo(EXPECTED_RTP, 10);
    }
  });

  it("a straight-up on any number returns 18/19 too", () => {
    for (let n = 0; n < POCKETS; n++) {
      expect(exactRtp(straightBet(n)), `straight ${n} is mispriced`).toBeCloseTo(EXPECTED_RTP, 10);
    }
  });

  it("no bet ever returns 100% or more", () => {
    for (const b of [...BETS, ...Array.from({ length: POCKETS }, (_, n) => straightBet(n))]) {
      expect(exactRtp(b)).toBeLessThan(1);
    }
  });

  it("lands on the real single-zero house edge", () => {
    // ~5.26% — the number a physical single-zero wheel has.
    expect((1 - EXPECTED_RTP) * 100).toBeCloseTo(5.26, 1);
  });
});

describe("the wheel", () => {
  it("has 19 pockets: zero plus 1-18", () => {
    expect(POCKETS).toBe(19);
  });

  it("colours zero green and alternates the rest", () => {
    expect(colorOf(0)).toBe("green");
    expect(colorOf(1)).toBe("red");
    expect(colorOf(2)).toBe("black");
    expect(colorOf(17)).toBe("red");
    expect(colorOf(18)).toBe("black");
  });

  it("splits red and black evenly", () => {
    let red = 0;
    let black = 0;
    for (let n = 1; n <= WHEEL_NUMBERS; n++) colorOf(n) === "red" ? red++ : black++;
    expect(red).toBe(black);
  });

  it("only ever produces a real pocket", () => {
    for (let i = 0; i < 5000; i++) {
      const n = spinWheel();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(POCKETS);
      expect(Number.isInteger(n)).toBe(true);
    }
  });
});

describe("zero is the house's edge, and behaves like it", () => {
  it("loses every even-money bet", () => {
    expect(wins({ kind: "color", color: "red" }, 0)).toBe(false);
    expect(wins({ kind: "color", color: "black" }, 0)).toBe(false);
    expect(wins({ kind: "parity", odd: true }, 0)).toBe(false);
    // Zero is EVEN as an integer — treating it as such would hand the player a
    // free even-money win and wipe out the entire house edge.
    expect(wins({ kind: "parity", odd: false }, 0)).toBe(false);
    expect(wins({ kind: "half", high: false }, 0)).toBe(false);
    expect(wins({ kind: "third", index: 0 }, 0)).toBe(false);
  });

  it("still pays a straight-up bet on zero", () => {
    expect(wins({ kind: "straight", n: 0 }, 0)).toBe(true);
  });
});

describe("bet coverage", () => {
  it("halves split the numbers evenly and don't overlap", () => {
    let low = 0;
    let high = 0;
    for (let n = 1; n <= WHEEL_NUMBERS; n++) {
      const l = wins({ kind: "half", high: false }, n);
      const h = wins({ kind: "half", high: true }, n);
      expect(l && h, `${n} is in both halves`).toBe(false);
      expect(l || h, `${n} is in neither half`).toBe(true);
      if (l) low++;
      else high++;
    }
    expect(low).toBe(high);
  });

  it("thirds tile the wheel exactly once each", () => {
    for (let n = 1; n <= WHEEL_NUMBERS; n++) {
      const hits = ([0, 1, 2] as const).filter((i) => wins({ kind: "third", index: i }, n));
      expect(hits, `${n} is covered by ${hits.length} thirds`).toHaveLength(1);
    }
  });

  it("thirds cover 1-6, 7-12, 13-18", () => {
    expect(thirdRange(0)).toEqual([1, 6]);
    expect(thirdRange(1)).toEqual([7, 12]);
    expect(thirdRange(2)).toEqual([13, 18]);
  });
});

describe("settleBet", () => {
  it("names the pocket and the bet in the result", () => {
    const r = settleBet(BETS.find((b) => b.id === "red")!, 1);
    expect(r.multiplier).toBe(2);
    expect(r.label).toContain("1");
    expect(r.label).toContain("RED");
  });

  it("calls a zero out by name", () => {
    expect(settleBet(BETS[0], 0).label).toContain("ZERO");
  });

  it("pays a straight-up 18x, stake included", () => {
    expect(settleBet(straightBet(7), 7).multiplier).toBe(18);
  });
});

/**
 * ── The animation cannot disagree with the payout ───────────────────────────
 *
 * This is the property the whole roulette implementation exists to protect, and
 * it is the one that is genuinely at risk here: unlike a reel strip, the ball is
 * driven by a chaotic physical simulation with a deflector scatter in the middle
 * of it. `planSpin` is supposed to close that gap by SEARCHING launch speeds for
 * a trajectory that lands in the pocket the game already drew, rather than
 * bending a trajectory at the end.
 *
 * So the assertions are: the ball's final resting pocket equals the decision,
 * every time; it is genuinely seated (in the pocket ring, on the floor) rather
 * than merely near it; and the search really is finding natural solutions, so
 * the emergency correction never actually has to fire.
 */
import {
  planSpin,
  pocketAt,
  frameAt,
  simulateInto,
  R_POCKET,
  W_CRIT,
  DT,
  SEED_TRIES,
  type BallFrame,
} from "./roulette-physics";

describe("the ball lands where the game already decided", () => {
  it("settles in the decided pocket on every spin", () => {
    for (let i = 0; i < 400; i++) {
      const target = i % POCKETS;
      const spin = planSpin(target);
      const last = spin.frames[spin.frames.length - 1];
      expect(spin.pocket, `spin ${i} was aimed at ${target}`).toBe(target);
      expect(pocketAt(last.theta, last.rotor)).toBe(target);
    }
  });

  it("agrees with the payout for every bet on the table", () => {
    for (let i = 0; i < 120; i++) {
      const target = i % POCKETS;
      const bet = BETS[i % BETS.length];
      const spin = planSpin(target);
      // What the ball shows...
      const shown = pocketAt(
        spin.frames[spin.frames.length - 1].theta,
        spin.frames[spin.frames.length - 1].rotor,
      );
      // ...and what the table pays, settled independently.
      expect(settleBet(bet, shown).multiplier).toBe(settleBet(bet, target).multiplier);
      expect(settleBet(bet, shown).label).toBe(settleBet(bet, target).label);
    }
  });

  it("finishes genuinely seated in a pocket, not hovering near one", () => {
    for (let i = 0; i < 60; i++) {
      const last = planSpin(i % POCKETS).frames.slice(-1)[0];
      expect(last.phase).toBe("seated");
      expect(last.radius).toBeCloseTo(R_POCKET, 6);
      expect(last.height).toBe(0);
    }
  });

  it("keeps enough seed retries that the search effectively never fails", () => {
    // The guard on the test above. That test samples 300 spins, so it only
    // catches a search failure rate around 1e-3 or worse — and the rate that
    // actually bit us was 6.7e-5, which reddens the suite on ~2% of runs and
    // looks exactly like an unreproducible flake.
    //
    // MEASURED 2026-07-24 over 30 000 spins: a single launch-speed sweep misses
    // with q ≈ 0.041, and the search fails only when every seed's sweep misses,
    // so the rate is q^SEED_TRIES. 3 → 6.7e-5 (2% of runs red, confirmed by
    // re-measurement at 2/30 000). 6 → ~4e-9 (0/30 000). Pin the floor here
    // rather than re-running a 100-second Monte Carlo in the suite.
    expect(SEED_TRIES).toBeGreaterThanOrEqual(6);
  });

  it("never needs the emergency correction — the search finds a real trajectory", () => {
    // If this ever fails the game is still CORRECT (the correction guarantees
    // the pocket), but the ball would visibly slide during the settle, so it is
    // worth knowing about.
    for (let i = 0; i < 300; i++) {
      const spin = planSpin(i % POCKETS);
      expect(spin.natural, `spin aimed at ${i % POCKETS} fell back to a correction`).toBe(true);
      // Not toBe(0): the search lands the ball on the pocket centre exactly,
      // so what is left is one float ulp of angle wrap, well under the 1e-9 the
      // ramp needs to fire at all.
      expect(Math.abs(spin.correction)).toBeLessThan(1e-9);
    }
  });

  it("holds the outcome for the whole replay, not just the last frame", () => {
    // Sampling by wall-clock time is how the renderer reads the trajectory, so
    // the guarantee has to survive that path too — including past the end.
    const spin = planSpin(13);
    for (const t of [spin.duration - 0.001, spin.duration, spin.duration + 5]) {
      const f = frameAt(spin, t);
      expect(pocketAt(f.theta, f.rotor)).toBe(13);
    }
  });
});

describe("the physics behaves like a roulette wheel", () => {
  const spinOf = (): BallFrame[] => planSpin(7).frames;

  it("counter-rotates: the ball runs against the rotor", () => {
    const frames = spinOf();
    // On the track the ball's angle rises and the rotor's falls. That opposition
    // is the signature of a real wheel and the thing fake ones get wrong.
    const track = frames.filter((f) => f.phase === "track");
    expect(track.length).toBeGreaterThan(60);
    expect(track[track.length - 1].theta).toBeGreaterThan(track[0].theta);
    expect(track[track.length - 1].rotor).toBeLessThan(track[0].rotor);
  });

  it("keeps the rotor turning until the ball is down", () => {
    // A rotor that stalls first turns the settle into a static picture.
    const frames = spinOf();
    const seat = frames.findIndex((f) => f.phase === "seated");
    expect(frames[seat].rotor).toBeLessThan(frames[seat - 30].rotor);
  });

  it("only leaves the track once it is below the critical velocity", () => {
    // w_crit^2 = (g/r)tan(alpha). Above it the banked wall holds the ball up;
    // dropping early would mean the centripetal condition is not being applied.
    const frames = spinOf();
    for (const f of frames) if (f.phase === "track") expect(f.omega).toBeGreaterThan(W_CRIT - 0.2);
    const drop = frames.find((f) => f.phase === "drop");
    expect(drop).toBeDefined();
    expect(drop!.omega).toBeLessThanOrEqual(W_CRIT);
  });

  it("loses energy monotonically while on the track", () => {
    const track = spinOf().filter((f) => f.phase === "track");
    for (let i = 1; i < track.length; i++) expect(track[i].omega).toBeLessThan(track[i - 1].omega);
  });

  it("strikes a deflector on the way down", () => {
    // No deflector contact means the ball fell straight into a pocket, which
    // would make the outcome a smooth function of the launch and remove the
    // only genuinely unpredictable step in the model.
    for (let i = 0; i < 40; i++) {
      const frames = planSpin(i % POCKETS).frames;
      expect(frames.some((f) => f.hit === "deflector")).toBe(true);
    }
  });

  it("stays inside the bowl for the whole trajectory", () => {
    for (const f of spinOf()) {
      expect(f.radius).toBeLessThanOrEqual(1 + 1e-9);
      expect(f.radius).toBeGreaterThanOrEqual(R_POCKET - 1e-9);
      expect(f.height).toBeGreaterThanOrEqual(0);
      expect(f.height).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("moves inward, never back out to the track", () => {
    const frames = spinOf();
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].radius).toBeLessThanOrEqual(frames[i - 1].radius + 1e-9);
    }
  });

  it("takes between three and six seconds — long enough to be a spin", () => {
    for (let i = 0; i < 60; i++) {
      const d = planSpin(i % POCKETS).duration;
      expect(d).toBeGreaterThan(3);
      expect(d).toBeLessThan(6);
    }
  });

  it("is deterministic: the same launch and seed replays exactly", () => {
    // The search relies on this. If a simulation were not reproducible from its
    // parameters, the candidate that was tested would not be the one that plays.
    const a: BallFrame[] = [];
    const b: BallFrame[] = [];
    simulateInto(a, 21.5, 1.4, 12345);
    simulateInto(b, 21.5, 1.4, 12345);
    expect(a.length).toBe(b.length);
    expect(a[a.length - 1].theta).toBe(b[b.length - 1].theta);
  });

  it("bakes frames at the fixed step it claims to", () => {
    const spin = planSpin(3);
    expect(spin.duration).toBeCloseTo(spin.frames.length * DT, 9);
  });
});
