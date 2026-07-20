/**
 * THE THROW — the two-stage aim/release state machine, with no canvas in it.
 *
 * Split out of `darts-game.ts` because the state machine is where the game
 * actually lives and it was previously tangled into the render loop: `poke()`
 * read a sweep value derived from a `t` that only advanced inside `render()`,
 * which meant the mechanic could not be exercised at all without a browser. It
 * is pure here, driven by `press()` and `tick(dt)`, so the whole throw is
 * testable frame by frame.
 *
 * ── The mechanic ────────────────────────────────────────────────────────────
 * Two presses per dart, three darts per round:
 *
 *   1. AIM   — a vertical reticle sweeps left/right. Press locks X.
 *   2. POWER — a horizontal reticle sweeps up/down over the CHORD of the board
 *              at that X (see `yHalfRange`). Press releases the dart.
 *   3. FLIGHT— the dart travels, lands, and sticks where it landed.
 *
 * ── The one invariant that matters ──────────────────────────────────────────
 * The house rule from `slots-game.ts` is that a game's outcome can never
 * disagree with what it pays. Slots satisfies it by deciding the result up
 * front; darts satisfies it the opposite way, and more strongly: `scoreAt` is
 * called EXACTLY ONCE per dart, at the instant of release, on the same
 * post-wobble coordinate that the renderer then draws the dart at. The `Hit` is
 * stored on the `LandedDart`, the round total is the sum of those stored hits,
 * and `result()` returns a payout derived from that same sum. There is no
 * second calculation anywhere for the two to drift apart — the number on the
 * scoreboard is a sum over the objects you can see stuck in the board.
 */
import {
  scoreAt,
  payoutFor,
  applyWobble,
  wobbleRadius,
  throwSpeed,
  yHalfRange,
  X_SWEEP_AMPLITUDE,
  DARTS_PER_ROUND,
  type Hit,
} from "./darts";

export type ThrowPhase = "idle" | "aim-x" | "aim-y" | "flying" | "done";

export interface LandedDart {
  /** Where it ACTUALLY stuck, in units of board radius. Scoring used this. */
  x: number;
  y: number;
  /** Scored once, at release, from exactly the (x, y) above. */
  hit: Hit;
  /** Where the player locked, before the hand wobbled. Drives the "off by" tell. */
  aimX: number;
  aimY: number;
  /** A few degrees either way, so three darts don't read as a stamped grid. */
  lean: number;
}

export type ThrowEvent =
  | { type: "tick" }
  | { type: "lock-x" }
  | { type: "release" }
  | { type: "land"; dart: LandedDart }
  | { type: "round-done"; total: number; mult: number; label: string };

/** Seconds a dart spends in the air. Long enough to read as a throw. */
export const FLIGHT = 0.34;
/** Seconds the final total holds on screen before the controls unlock. */
export const SETTLE_HOLD = 1.5;
/** Graduations the reticle ticks past per full sweep — the audible metronome. */
const TICKS_PER_SWEEP = 16;

export interface ThrowMachine {
  phase(): ThrowPhase;
  /** Darts already stuck in the board, oldest first. */
  darts(): readonly LandedDart[];
  /** Sum of the stored hits. The ONLY place a round total is computed. */
  total(): number;
  /** 0-based index of the dart currently being thrown. */
  dartIndex(): number;
  /** Live reticle position on the axis currently sweeping, in board units. */
  cursor(): number;
  /** The locked X, once stage one is done. */
  lockedX(): number;
  /** Half-height of the Y sweep for the current X — the renderer draws this. */
  yRange(): number;
  /** The dart in the air, and how far along it is (0..1), or null. */
  flight(): { dart: LandedDart; p: number } | null;
  /** True while the shell must keep the stake controls locked. */
  busy(): boolean;
  begin(stake: number): void;
  press(): ThrowEvent[];
  tick(dt: number): ThrowEvent[];
  /** Payout for the round as thrown. Derived from `total()`, nothing else. */
  result(): { total: number; mult: number; label: string };
}

export function createThrowMachine(rng: () => number = Math.random): ThrowMachine {
  let phase: ThrowPhase = "idle";
  let stake = 0;
  let t = 0;
  let aimX = 0;
  let lastTick = 0;
  let flightT = 0;
  let settleT = 0;
  let pending: LandedDart | null = null;
  const landed: LandedDart[] = [];

  /** Speed of whichever bar is sweeping right now, in sweeps per second. */
  const speed = (): number => throwSpeed(stake, landed.length);

  /** Triangle wave in -1..1. Starts at 0 and moves +ve, so the reticle enters
   * from the middle rather than snapping to an edge on the first frame. */
  const wave = (): number => {
    const u = (t * speed() + 0.5) % 2;
    return u < 1 ? u * 2 - 1 : 3 - u * 2;
  };

  const amplitude = (): number => (phase === "aim-y" ? yHalfRange(aimX) : X_SWEEP_AMPLITUDE);

  const cursor = (): number => wave() * amplitude();

  function release(): LandedDart {
    const aimY = cursor();
    const r = wobbleRadius(stake, landed.length);
    const p = applyWobble(aimX, aimY, r, rng);
    // The single scoring call for this dart. Everything downstream reads `hit`.
    return { x: p.x, y: p.y, hit: scoreAt(p.x, p.y), aimX, aimY, lean: (rng() * 2 - 1) * 14 };
  }

  const total = (): number => landed.reduce((n, d) => n + d.hit.points, 0);

  return {
    phase: () => phase,
    darts: () => landed,
    total,
    dartIndex: () => landed.length,
    cursor: () => (phase === "aim-x" || phase === "aim-y" ? cursor() : phase === "flying" ? 0 : 0),
    lockedX: () => aimX,
    yRange: () => yHalfRange(aimX),
    flight: () => (phase === "flying" && pending ? { dart: pending, p: 1 - flightT / FLIGHT } : null),
    busy: () => phase !== "idle" && phase !== "done",

    begin(s: number): void {
      stake = s;
      landed.length = 0;
      pending = null;
      aimX = 0;
      t = 0;
      lastTick = 0;
      flightT = 0;
      settleT = 0;
      phase = "aim-x";
    },

    press(): ThrowEvent[] {
      if (phase === "aim-x") {
        aimX = cursor();
        phase = "aim-y";
        t = 0;
        lastTick = 0;
        return [{ type: "lock-x" }];
      }
      if (phase === "aim-y") {
        pending = release();
        phase = "flying";
        flightT = FLIGHT;
        return [{ type: "release" }];
      }
      // Presses during flight or the settle hold are deliberately swallowed:
      // a mashed button must never skip a dart or double-resolve a round.
      return [];
    },

    tick(dt: number): ThrowEvent[] {
      const out: ThrowEvent[] = [];

      if (phase === "aim-x" || phase === "aim-y") {
        t += dt;
        // One event per graduation crossed, not one per frame — otherwise the
        // tick is a frame-rate readout rather than a speed readout.
        const g = Math.floor(t * speed() * TICKS_PER_SWEEP * 2);
        if (g !== lastTick) {
          lastTick = g;
          out.push({ type: "tick" });
        }
        return out;
      }

      if (phase === "flying") {
        flightT -= dt;
        if (flightT <= 0 && pending) {
          landed.push(pending);
          out.push({ type: "land", dart: pending });
          pending = null;
          if (landed.length >= DARTS_PER_ROUND) {
            phase = "done";
            settleT = SETTLE_HOLD;
            const sum = total();
            const { mult, label } = payoutFor(sum);
            out.push({ type: "round-done", total: sum, mult, label });
          } else {
            phase = "aim-x";
            t = 0;
            lastTick = 0;
          }
        }
        return out;
      }

      if (phase === "done" && settleT > 0) {
        settleT -= dt;
        if (settleT <= 0) phase = "idle";
      }
      return out;
    },

    result(): { total: number; mult: number; label: string } {
      const sum = total();
      return { total: sum, ...payoutFor(sum) };
    },
  };
}
