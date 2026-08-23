/**
 * ROULETTE PHYSICS — a real ball on a real wheel, then aimed.
 *
 * ── Anatomy (why there are two angles in every frame) ───────────────────────
 * A roulette wheel is TWO bodies, and almost every fake wheel gets this wrong
 * by drawing one:
 *
 *   · the ROTOR — the numbered pocket ring, the cone and the centre turret. It
 *     spins, and it is the only part the pockets belong to.
 *   · the BOWL / STATOR — the outer rim, the banked BALL TRACK the ball orbits
 *     in, and the metal DEFLECTORS ("diamonds" / "canoes") on the apron. This
 *     part does not move at all.
 *
 * The croupier launches the ball AGAINST the rotor's direction, so through the
 * whole spin the ball and the pockets are closing on each other. That
 * counter-rotation is the signature of a real wheel. It is also why the
 * deflectors here sit at FIXED absolute angles while the pockets are indexed in
 * the ROTOR's frame — they live on different bodies.
 *
 * ── The three phases ────────────────────────────────────────────────────────
 * 1. TRACK. The ball orbits the banked track at constant radius, held up the
 *    wall by centripetal force. It bleeds speed to rolling friction (roughly
 *    constant torque) plus air drag (roughly proportional to speed), which is
 *    the `-(K_ROLL + K_DRAG*w)` law below.
 *
 * 2. DROP. Centripetal support scales with w^2 while gravity does not, so below
 *    a critical angular velocity the ball can no longer hold the banked wall and
 *    falls inward. The standard condition (see sources) is
 *
 *        w_crit^2 = (g / r) * tan(alpha)
 *
 *    with `alpha` the incline of the track wall. Everything before this moment
 *    is smooth and predictable; everything after it is not, and that asymmetry
 *    is the entire reason roulette is a fair-ish game rather than a solved one.
 *
 * 3. SCATTER + SETTLE. The ball crosses the apron and strikes a deflector,
 *    which kills most of its speed and kicks it off at a hard-to-model angle —
 *    the literature is explicit that the deflectors are the part nobody can
 *    predict, and they are what stops a physicist emptying the table. It then
 *    drops onto the pocket ring and rattles across the FRETS (the metal
 *    separators between pockets), losing energy on each one until its speed
 *    RELATIVE TO THE ROTOR falls to nothing and it rides round in a pocket.
 *
 * Sources:
 *   · Small & Tse, "Predicting the outcome of roulette" (arXiv:1204.6412) —
 *     the ball decelerates on the rim, leaves it at a critical velocity, and the
 *     rotor's angle at that moment is propagated as
 *     phi(t) = phi0 + phi0'*t + 0.5*phi0''*t^2. Also the finding that a ~0.2
 *     degree table tilt biases the outcome badly, which is why the drop
 *     threshold here is angle-independent — this wheel is deliberately level.
 *   · roulette-bet.com's writeup of Eichberger's / Hall's equations — the
 *     departure condition theta'^2 = (g/r)tan(alpha), deflectors at a constant
 *     radius r_defl evenly distributed around the STATOR, and the deflection
 *     gamma = |theta(t_defl) - phi(t_defl)| mod 2pi that selects the pocket.
 *   · roulette17.com — the three-stage description (rim / drop / scatter) and
 *     the point that without friction and drag the ball would orbit forever
 *     against the wheel's direction.
 *
 * ── How this can be honest physics AND a decided outcome ────────────────────
 * See `simulateInto` and `planSpin`. The short version: we do not bend a
 * trajectory to hit a target. We run the real simulation many times over
 * physically plausible launch speeds and KEEP one that happens to land on the
 * pocket the game already drew. Every frame the player sees is an untouched
 * solution of the model above.
 */

/** Fixed simulation step. The trajectory is baked at this rate, then replayed. */
export const DT = 1 / 120;

/** Pockets on this wheel — 0 plus 1..18. Must match `roulette.ts`. */
const POCKETS = 19;
/** Angular width of one pocket, radians. */
export const POCKET_PITCH = (Math.PI * 2) / POCKETS;

/** Ball track radius in metres. A casino wheel is ~0.30 m to the ball track. */
const R_TRACK_M = 0.3;
/** Incline of the banked track wall. */
const TRACK_ALPHA = Math.PI / 4;
const G = 9.81;

/**
 * Critical angular velocity: below this the ball cannot hold the banked track.
 *
 * w_crit = sqrt(g * tan(alpha) / r) = sqrt(9.81 * 1 / 0.30) ~= 5.72 rad/s,
 * which is 0.91 revolutions per second — squarely in the "about one rev per
 * second when it drops" range a real wheel shows.
 */
export const W_CRIT = Math.sqrt((G * Math.tan(TRACK_ALPHA)) / R_TRACK_M);

/** Rolling friction: a near-constant retarding torque. rad/s^2. */
const K_ROLL = 0.55;
/** Air drag: proportional to speed. 1/s. */
const K_DRAG = 0.52;
/** Extra drag once the ball is off the track and skidding across the apron. */
const K_APRON = 1.15;
/** Drag on the pocket ring, against the ROTOR-relative speed. */
const K_RING = 1.5;
/** Deflector strikes before the ball is committed to the ring. */
const MAX_DEFLECTOR_HITS = 3;

/** Rotor friction. It must still be turning when the ball lands, so: small. */
const K_ROTOR = 0.075;

/** Normalised radii. 1.0 is the ball track; the renderer scales these. */
export const R_BALL_TRACK = 1;
export const R_DEFLECTOR = 0.8;
export const R_POCKET = 0.66;

/** Deflectors on the stationary bowl. Evenly spaced, per Eichberger. */
export const DEFLECTORS = 8;
const DEFL_OFFSET = 0.21;

/** Launch speed window searched for a trajectory, rad/s. ~3 to 3.9 rev/s. */
const W0_MIN = 19;
const W0_MAX = 24.5;
/** Candidate launch speeds tried. Chaos means every pocket is reachable. */
const W0_STEPS = 600;
/**
 * Distinct scatter seeds tried if a whole launch-speed sweep misses.
 *
 * MEASURED (2026-07-24, 30 000 spins): one sweep misses with probability
 * q ≈ 0.041, and the search only fails if EVERY seed's sweep misses — so the
 * failure rate is q^SEED_TRIES. At 3 that is 6.7e-5, which sounds negligible
 * and is not: the test drives 300 spins, so it reddened the suite on ~2% of
 * runs (observed as a ~1-in-33 "flaky" failure that passed on every rerun, and
 * cost a chunk of a session to track down). At 6 it is ~4e-9 — about one spin
 * in 200 million, i.e. never, for a player or for CI.
 *
 * The cost is paid ONLY on the path that was already failing: a second sweep
 * runs on ~4% of spins, a third on ~0.17%, a seventh essentially never. Raising
 * this is close to free.
 */
export const SEED_TRIES = 6;

/** Rotor launch speed window, rad/s. Negative: it counter-rotates. */
const ROTOR_MIN = 1.15;
const ROTOR_MAX = 1.75;

/** Below this rotor-relative speed the ball has stopped rattling and seats. */
const SEAT_W = 0.42;

/** How long the ball rides round in its pocket before the sim ends, seconds. */
const RIDE_TIME = 0.7;
/**
 * When the ring drag starts ramping up hard, seconds.
 *
 * Physically this stands in for the ball scrubbing energy into the pocket walls
 * once it is fully down among the frets. Practically it bounds the spin: a
 * ball that stays within a whisker of the rotor's own speed can otherwise drift
 * for many seconds without ever crossing a fret, and the first pass of this
 * model produced 11-second spins that way. Nobody watches an 11-second spin.
 */
const DAMP_FROM = 3.6;
/** Hard cap so a pathological candidate can never hang the frame. */
const MAX_FRAMES = 900;

export type Phase = "track" | "drop" | "scatter" | "rattle" | "seated";
/** What the ball struck this frame, so audio and art can react to it. */
export type Hit = "none" | "deflector" | "fret" | "seat";

export interface BallFrame {
  /** Ball angle in the world frame, radians. */
  theta: number;
  /** Rotor angle in the world frame, radians. The pockets are indexed off this. */
  rotor: number;
  /** Normalised radius: 1 = ball track, `R_POCKET` = seated. */
  radius: number;
  /** Height above the pocket floor, 0..1. 1 is the top of the track wall. */
  height: number;
  /** Ball speed, rad/s. Drives the rattle pitch. */
  omega: number;
  phase: Phase;
  hit: Hit;
}

export interface Spin {
  frames: BallFrame[];
  /** The pocket the ball is in on the last frame. Guaranteed == the decision. */
  pocket: number;
  /** Seconds the whole trajectory lasts. */
  duration: number;
  /** True if the search found a natural trajectory into the target pocket. */
  natural: boolean;
  /**
   * Residual angle folded into the final seat, radians.
   *
   * Zero whenever `natural` is true, which is essentially always. It exists
   * only so that the invariant "the ball is in the decided pocket" is enforced
   * by construction rather than by hope.
   */
  correction: number;
}

/** Which pocket a world-frame ball angle is over, given the rotor's angle. */
export function pocketAt(theta: number, rotor: number): number {
  const rel = theta - rotor;
  const idx = Math.round(rel / POCKET_PITCH) % POCKETS;
  return idx < 0 ? idx + POCKETS : idx;
}

/** Wrap to (-pi, pi]. */
function wrapPi(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x <= -Math.PI) x += Math.PI * 2;
  return x;
}

/**
 * Mulberry32. The scatter needs randomness, but a trajectory must be
 * reproducible from its seed or the search would be choosing a candidate it
 * cannot then replay.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Angular distance from `a` to the nearest deflector, signed, wrapped. */
function toNextDeflector(a: number): number {
  const step = (Math.PI * 2) / DEFLECTORS;
  const rel = a - DEFL_OFFSET;
  return step - (((rel % step) + step) % step);
}

/**
 * Integrate one launch to a rest, appending every step to `out`.
 *
 * This is the whole model, and nothing in it knows what pocket we want. It is
 * called both by the search (dozens of times, results discarded) and for the
 * trajectory that actually plays.
 */
export function simulateInto(out: BallFrame[], w0: number, rotorW0: number, seed: number): void {
  out.length = 0;
  const rand = rng(seed);

  let theta = 0;
  let w = w0;
  // The rotor runs the other way. Everything downstream reads its sign, so this
  // one minus is what makes the wheel counter-rotate.
  let rotor = rand() * Math.PI * 2;
  let rotorW = -rotorW0;

  let radius = R_BALL_TRACK;
  let height = 1;
  /** Vertical velocity in normalised height units per second. */
  let vh = 0;
  let phase: Phase = "track";
  let hit: Hit = "none";
  /** Rotor-frame angle of the fret boundary last crossed, so we count each once. */
  let lastFret = Number.NaN;
  let rideLeft = RIDE_TIME;
  /** Deflectors struck so far — the ball works inward with each one. */
  let deflHits = 0;
  /** Seconds spent between leaving the track and committing to the ring. */
  let apronT = 0;

  for (let i = 0; i < MAX_FRAMES; i++) {
    out.push({ theta, rotor, radius, height, omega: w, phase, hit });
    hit = "none";

    // ── Rotor ── friction only, and it must never reverse or stall mid-spin.
    if (rotorW < 0) rotorW = Math.min(0, rotorW + K_ROTOR * DT);
    rotor += rotorW * DT;

    if (phase === "seated") {
      rideLeft -= DT;
      // Locked to the rotor: the ball is a passenger now.
      theta += rotorW * DT;
      w = rotorW;
      if (rideLeft <= 0) break;
      continue;
    }

    if (phase === "track") {
      // Rolling friction (constant) + air drag (linear in speed).
      w -= (K_ROLL + K_DRAG * w) * DT;
      theta += w * DT;
      // The departure condition. Above w_crit the banked wall holds it up.
      if (w <= W_CRIT) {
        phase = "drop";
        vh = 0;
      }
    } else if (phase === "drop" || phase === "scatter") {
      // ── Off the wall ── the ball skids down the apron onto the deflector
      // ring and works its way inward, striking diamonds as it goes. `drop` is
      // the first fall; `scatter` is every hop after a strike. They share the
      // integrator because the physics is identical — only the art and audio
      // care which one it is.
      apronT += DT;
      w -= (K_ROLL + K_APRON * w) * DT;
      const before = theta;
      theta += w * DT;

      // Radial fall: quick onto the deflector ring, then inward a step per
      // strike until it commits to the pocket ring.
      const rTarget = deflHits === 0 ? R_DEFLECTOR : Math.max(R_POCKET, R_DEFLECTOR - deflHits * 0.055);
      radius = Math.max(rTarget, radius - 1.5 * DT);

      // Vertical: ballistic between contacts, floored at the apron surface.
      vh -= 4.4 * DT;
      height = Math.max(0.4, height + vh * DT);
      if (height <= 0.4) vh = Math.max(0, vh);

      // Did we sweep past a deflector this step? They are on the STATIONARY
      // bowl, so this test is in world angle with no rotor term.
      const onRing = radius <= R_DEFLECTOR + 0.02 && height <= 0.45;
      if (onRing && Math.abs(theta - before) >= toNextDeflector(before) && deflHits < MAX_DEFLECTOR_HITS) {
        // The scatter. Most of the speed dies here, and the kick that survives
        // is the part no model in the literature claims to predict.
        w *= 0.34 + rand() * 0.3;
        w += (rand() - 0.5) * 1.5;
        vh = 0.34 + rand() * 0.32;
        deflHits += 1;
        phase = "scatter";
        hit = "deflector";
      } else if (
        deflHits >= MAX_DEFLECTOR_HITS ||
        radius <= R_POCKET + 0.01 ||
        // Too slow to ever reach the next diamond, or it has spent long enough
        // up there. Without these the ball can crawl round the apron for
        // seconds at a speed that never triggers another contact.
        Math.abs(w - rotorW) < 1.5 ||
        apronT > 1.15
      ) {
        // Committed. Fall the last bit onto the ring and start rattling.
        radius = R_POCKET;
        phase = "rattle";
        height = 0.12;
        vh = 0;
        lastFret = Number.NaN;
      }
    } else {
      // ── rattle ── on the pocket ring, crossing frets.
      // Drag acts on the speed RELATIVE TO THE ROTOR, because that is the only
      // speed the frets can see. The ramp bounds the spin (see `DAMP_FROM`).
      const damp = K_RING * (1 + Math.max(0, i * DT - DAMP_FROM) * 3);
      w -= damp * (w - rotorW) * DT;
      theta += w * DT;
      radius = R_POCKET;

      // Fret boundaries live in the ROTOR's frame — they are part of the
      // spinning ring. `rel` is the ball's angle as the wheel sees it.
      const rel = theta - rotor;
      const fret = Math.round(rel / POCKET_PITCH - 0.5);
      if (!Number.isNaN(lastFret) && fret !== lastFret) {
        // A fret takes a bite out of the ball's speed relative to the ring.
        const relW = w - rotorW;
        w = rotorW + relW * (0.74 + rand() * 0.14);
        vh = 0.13 + rand() * 0.1;
        hit = "fret";
      }
      lastFret = fret;

      vh -= 3.2 * DT;
      height = Math.max(0, height + vh * DT);
      if (height <= 0) {
        height = 0;
        vh = 0;
      }

      if (Math.abs(w - rotorW) < SEAT_W && height <= 0.02) {
        // Seated. Snap to the pocket centre so the landing is exact rather than
        // "nearly", which is what makes the outcome check a clean equality.
        const idx = pocketAt(theta, rotor);
        theta = rotor + idx * POCKET_PITCH;
        phase = "seated";
        hit = "seat";
        w = rotorW;
        // Settle the last sliver of hop height too. The seat test tolerates a
        // little, and leaving it meant the ball came to rest a pixel proud of
        // the pocket floor rather than down in it.
        height = 0;
        vh = 0;
      }
    }
  }

  // A candidate that never seated (speed cap hit) still has to end somewhere.
  const last = out[out.length - 1];
  if (last.phase !== "seated") {
    const idx = pocketAt(last.theta, last.rotor);
    last.theta = last.rotor + idx * POCKET_PITCH;
    last.radius = R_POCKET;
    last.height = 0;
    last.phase = "seated";
  }
}

/**
 * Produce a trajectory that lands in `target`.
 *
 * ── THE RECONCILIATION, in full ─────────────────────────────────────────────
 * The outcome is drawn in `play()` before this is called, and the animation is
 * not allowed to disagree with it. There are two ways to do that and only one
 * is honest:
 *
 *   (a) run any trajectory and bend it at the end — the classic cheat, and it
 *       shows, because the ball has to slide sideways during the settle.
 *   (b) SEARCH. The launch speed of a real croupier's ball is arbitrary, so we
 *       treat it as the free parameter. We scan candidate launch speeds across
 *       a physically plausible window and simulate each one honestly, all the
 *       way to rest. The first candidate that happens to land in the target
 *       pocket is the one we play.
 *
 * (b) is what happens here. Because the deflector strike makes the map from
 * launch speed to pocket chaotic, the scan finds a hit within a handful of
 * tries — every pocket is reachable from a window this wide. The trajectory
 * the player watches is therefore a genuine, unedited solution of the model,
 * and the pocket it settles in was fixed before the ball moved.
 *
 * The scan starts at a random offset and wraps, so the same pocket does not
 * replay the same spin.
 *
 * `correction` is the belt to that braces: if the scan somehow exhausted every
 * candidate (it does not, and the test asserts as much), the leftover angle is
 * eased into the last half second so the invariant still holds by construction.
 * It is 0.0 on every natural spin.
 */
export function planSpin(target: number, rand: () => number = Math.random): Spin {
  const rotorW0 = ROTOR_MIN + rand() * (ROTOR_MAX - ROTOR_MIN);

  const frames: BallFrame[] = [];
  const scratch: BallFrame[] = [];
  let natural = false;
  let bestW0 = W0_MIN;
  let bestSeed = 0;

  // Two free parameters, scanned in that order: the launch speed, and — if a
  // whole sweep of launch speeds somehow never reaches the target — the seed
  // for the scatter, which is the croupier's ball being a fractionally
  // different ball. One sweep misses ~4% of the time, so the seed retries are
  // what actually make the search reliable; see SEED_TRIES for the measured
  // numbers and why 3 was not enough.
  outer: for (let s = 0; s < SEED_TRIES; s++) {
    const seed = Math.floor(rand() * 0xffffffff);
    const start = Math.floor(rand() * W0_STEPS);
    if (s === 0) bestSeed = seed;
    for (let k = 0; k < W0_STEPS; k++) {
      const i = (start + k) % W0_STEPS;
      const w0 = W0_MIN + (i / (W0_STEPS - 1)) * (W0_MAX - W0_MIN);
      simulateInto(scratch, w0, rotorW0, seed);
      const end = scratch[scratch.length - 1];
      if (s === 0 && k === 0) bestW0 = w0;
      if (pocketAt(end.theta, end.rotor) === target) {
        natural = true;
        bestW0 = w0;
        bestSeed = seed;
        break outer;
      }
    }
  }

  simulateInto(frames, bestW0, rotorW0, bestSeed);

  // ── Enforce the invariant ──
  const last = frames[frames.length - 1];
  const want = last.rotor + target * POCKET_PITCH;
  const correction = wrapPi(want - last.theta);
  if (Math.abs(correction) > 1e-9) {
    // Ease it in over the tail so it is a settle, not a teleport. Only ever
    // reached if the search failed, which the test forbids.
    const n = frames.length;
    const span = Math.min(n - 1, Math.round(0.5 / DT));
    const from = n - 1 - span;
    for (let i = from; i < n; i++) {
      const u = (i - from) / span;
      frames[i].theta += correction * (u * u * (3 - 2 * u));
    }
  }

  return {
    frames,
    pocket: pocketAt(frames[frames.length - 1].theta, frames[frames.length - 1].rotor),
    duration: frames.length * DT,
    natural,
    correction,
  };
}

/** Sample the baked trajectory at a wall-clock time. Clamps at both ends. */
export function frameAt(spin: Spin, t: number): BallFrame {
  const i = Math.floor(t / DT);
  if (i <= 0) return spin.frames[0];
  if (i >= spin.frames.length) return spin.frames[spin.frames.length - 1];
  return spin.frames[i];
}

/**
 * Every hit between two times, so a variable-rate render loop cannot drop a
 * fret click. Audio reads this; skipping a frame must not skip a sound.
 */
export function hitsBetween(spin: Spin, t0: number, t1: number): Hit[] {
  const a = Math.max(0, Math.floor(t0 / DT));
  const b = Math.min(spin.frames.length, Math.ceil(t1 / DT));
  const out: Hit[] = [];
  for (let i = a; i < b; i++) if (spin.frames[i].hit !== "none") out.push(spin.frames[i].hit);
  return out;
}
