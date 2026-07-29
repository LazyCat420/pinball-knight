/**
 * FUNNEL CENSUS — how often does a ball aimed at a doorway actually get through?
 *
 * ── The quantity ─────────────────────────────────────────────────────────
 *
 * `maze/doorways.ts` made openings UNIFORM (a vocabulary of 3/5/7 tiles) and
 * killed the 1-tile squeeze. What it did not do — could not, because a doorway
 * is a rectangular hole in a flat wall — is make the opening HELP you through
 * it. Arrive at 30° off-axis and you bank off the jamb back into the room you
 * came from, and every flat bounce costs speed (PINBALL_WALL_RESTITUTION =
 * 0.94), so rattling at a mouth is a straight loss.
 *
 * This measures that directly:
 *
 *   CAPTURE RATE   fraction of (position × heading × speed) samples that cross
 *                  the threshold, within the opening, before the clock runs out
 *   BOUNCES        median wall contacts spent getting there — the cost, since
 *                  each one is a 6% speed tax
 *   REJECTION      fraction thrown back PAST where they started. The failure the
 *                  complaint is actually about: not "slow" but "sent away".
 *
 * ── Why this is the negative control, and why it runs FIRST ──────────────
 *
 * If today's square doorways already capture 85% of approaches, elliptical
 * funnels are decoration and this repo should know that on day one rather than
 * after three waves of authoring. The baseline is the gate on the whole plan.
 * (`measure-the-quantity-not-a-proxy`: negative control first.)
 *
 * ── What is real here and what is not ────────────────────────────────────
 *
 * REAL: the floors (`buildHeadlessFloor` calls the shipping generator), the
 * collider (`moveCircle` — the same function `entities/player.ts` steps the
 * pinball with, including every shaped tile and arc feature), the ball radius,
 * the restitution tiers, the friction curve, the corner-gain taper.
 *
 * NOT MODELLED: steering, abilities, marble materials, rails, hitstop, parts.
 * `stepBall` below is the momentum branch of `updatePinball` and nothing else.
 *
 * That is a real simplification and it is deliberately SYMMETRIC: the number
 * this reports is only ever consumed as a BEFORE/AFTER delta measured by this
 * same harness, so whatever bias the simplification carries sits on both sides
 * and cancels. It is not a claim about absolute in-game capture rate, and the
 * report says so.
 *
 * DOM- and three-free: runs in node.
 */
import { moveCircle } from "../engine/collision";
import { tileCenter } from "../engine/grid";
import { isWalkable, type Grid } from "../maze/generator";
import type { Doorway } from "../maze/doorways";
import { PLAYER_R, PINBALL_WALL_RESTITUTION, PINBALL_MAX_SPEED, PINBALL_FRICTION, FIXED_STEP } from "../constants";
import { comboCornerRestitution, comboCornerAdd, comboSpeedCeil, comboFrictionMul } from "../entities/combo-curve";
import { buildHeadlessFloor } from "./headless-floor";

// ── Sampling grid ─────────────────────────────────────────────────────────
// Deliberately COARSE and fixed. A finer sweep does not change the verdict and
// this runs ~250 sims per doorway across every doorway on every sampled floor.

/** How far back along the passage axis a sample starts, in tiles. */
const START_DEPTHS: readonly number[] = [3, 5];
/** Lateral offsets from the doorway centre line, in tiles. */
const LATERALS: readonly number[] = [-3, -2, -1, 0, 1, 2, 3];
/**
 * Heading spread either side of "straight at the door", in degrees.
 *
 * Every one of these has a POSITIVE component along the passage axis — the
 * player is genuinely trying to go through. A sample aimed away from the door
 * failing to arrive is not a defect, so it is not sampled. ±75° is the widest
 * approach that still reads as an attempt.
 */
const HEADINGS_DEG: readonly number[] = [-75, -55, -35, -15, 0, 15, 35, 55, 75];
/** Arrival speeds, u/s. Low / cruising / near terminal (PINBALL_MAX_SPEED = 22). */
const SPEEDS: readonly number[] = [9, 16, 21];
/** Give up after this long. At 9 u/s that is 27 tiles of travel for a 5-tile trip. */
const TIMEOUT_S = 3.0;
/** Retreating this far back past the start line counts as REJECTED, not slow. */
const REJECT_BACK = 4;

interface Ball {
  x: number;
  z: number;
  dx: number;
  dz: number;
  speed: number;
  combo: number;
}

/**
 * One fixed step of the pinball's momentum branch.
 *
 * Mirrors `entities/player.ts updatePinball` lines ~1270-1500: try the full
 * step, and if `moveCircle` clamps short, reflect. Two branches, exactly as
 * there — a SHAPED face (slant/round/arc) hands back a true normal and takes
 * the flat tier; a SQUARE wall is an axis flip and takes the corner tier only
 * when BOTH axes blocked in one impact.
 *
 * Returns true if this step made contact.
 */
function stepBall(g: Grid, b: Ball, dt: number): boolean {
  const step = b.speed * dt;
  const wantX = b.x + b.dx * step;
  const wantZ = b.z + b.dz * step;
  const res = moveCircle(g, b.x, b.z, PLAYER_R, b.dx * step, b.dz * step);
  const blockedX = Math.abs(res.x - wantX) > 1e-3;
  const blockedZ = Math.abs(res.z - wantZ) > 1e-3;
  b.x = res.x;
  b.z = res.z;
  let hit = false;

  if (res.hitN) {
    const { nx, nz } = res.hitN;
    const vn = b.dx * nx + b.dz * nz;
    // Only bounce when moving INTO the face — a push-out must not ricochet.
    if (vn < 0) {
      b.dx -= 2 * vn * nx;
      b.dz -= 2 * vn * nz;
      b.speed = Math.min(PINBALL_MAX_SPEED, b.speed * PINBALL_WALL_RESTITUTION);
      hit = true;
    }
  } else if (blockedX || blockedZ) {
    if (blockedX) b.dx = -b.dx;
    if (blockedZ) b.dz = -b.dz;
    if (blockedX && blockedZ) {
      const gain = Math.min(b.speed * comboCornerRestitution(b.combo) + comboCornerAdd(b.combo), comboSpeedCeil(b.combo));
      b.speed = Math.min(PINBALL_MAX_SPEED, Math.max(b.speed, gain));
    } else {
      b.speed = Math.min(PINBALL_MAX_SPEED, b.speed * PINBALL_WALL_RESTITUTION);
    }
    hit = true;
  }

  if (hit) b.combo += 1;
  b.speed = Math.max(0, b.speed - PINBALL_FRICTION * comboFrictionMul(b.combo) * dt);
  return hit;
}

export type SampleOutcome = "captured" | "rejected" | "timeout" | "stalled";

export interface Sample {
  outcome: SampleOutcome;
  bounces: number;
}

/**
 * Fire one ball at a doorway and see what happens.
 *
 * The doorway frame: `a` is the unit vector ALONG the passage (the way you
 * travel through), `w` is ACROSS it (the axis the width is measured on). Both
 * come straight off the `Doorway` — they are not re-derived here, because
 * `planDoorways` chose them and a second opinion would be a second bug.
 *
 * ⚠️ `dir` PICKS WHICH SIDE YOU ARRIVE FROM, and it is not bookkeeping.
 *
 * `Doorway.ai/aj` names the passage axis but says nothing about which end is
 * "before". The first version of this census assumed −a was always the approach
 * and reported a confident 0% capture on doorways whose −a side is solid stone:
 * every sample launched inside a wall or behind one, and a metric that cannot
 * reach the door scored the DOOR rather than itself. Both directions are swept
 * now, and a direction with no standing room is reported as unusable instead of
 * being averaged in as failure — see `censusDoorway`.
 *
 * `s` is signed distance along the travel direction from the threshold, `u` the
 * lateral offset. The sample starts at s = −depth and is CAPTURED the first step
 * it reaches s ≥ 0 with |u| inside the opening's half-width.
 */
export function fireSample(
  g: Grid,
  d: Doorway,
  depth: number,
  lateral: number,
  headingRad: number,
  speed: number,
  dir: 1 | -1 = 1,
): Sample | null {
  const c = tileCenter(g, d.i, d.j);
  const ax = d.ai * dir;
  const az = d.aj * dir;
  const wx = d.wi;
  const wz = d.wj;

  const sx = c.x - ax * depth + wx * lateral;
  const sz = c.z - az * depth + wz * lateral;
  // A launch point inside stone is not a sample — it is a hole in the sampling
  // grid, and counting it as a failure would make a floor look worse for having
  // thick walls near its doors.
  const ti = Math.floor(sx + g.w / 2);
  const tj = Math.floor(sz + g.h / 2);
  if (ti < 0 || tj < 0 || ti >= g.w || tj >= g.h || !isWalkable(g, ti, tj)) return null;

  // Heading = the passage axis rotated by `headingRad`.
  const cs = Math.cos(headingRad);
  const sn = Math.sin(headingRad);
  const b: Ball = {
    x: sx,
    z: sz,
    dx: ax * cs - az * sn,
    dz: ax * sn + az * cs,
    speed,
    combo: 0,
  };

  const halfW = d.w / 2;
  const steps = Math.ceil(TIMEOUT_S / FIXED_STEP);
  let bounces = 0;
  for (let n = 0; n < steps; n++) {
    if (stepBall(g, b, FIXED_STEP)) bounces++;
    const rx = b.x - c.x;
    const rz = b.z - c.z;
    const s = rx * ax + rz * az;
    const u = rx * wx + rz * wz;
    if (s >= 0 && Math.abs(u) <= halfW) return { outcome: "captured", bounces };
    if (s < -depth - REJECT_BACK) return { outcome: "rejected", bounces };
    // Friction has eaten it. Distinguished from a timeout because a ball that
    // stopped is a different complaint from a ball still rattling.
    if (b.speed < 0.5) return { outcome: "stalled", bounces };
  }
  return { outcome: "timeout", bounces };
}

export interface DoorwayResult {
  /** Vocabulary width actually authored. */
  w: number;
  samples: number;
  captured: number;
  rejected: number;
  timeout: number;
  stalled: number;
  /** Median bounces spent by the CAPTURED samples. */
  medBounces: number;
  /**
   * Approach directions (of 2) with no standing room — fewer than
   * `MIN_SITE_FRAC` of their launch positions are walkable.
   *
   * Reported, never scored. A doorway you cannot line up on from one side is a
   * real thing about the floor, but it is a SITING defect and folding it into
   * capture rate as failure would make the funnel pass look like it fixed
   * something it never touched.
   */
  unusableDirs: number;
  /**
   * Capture rate of the dead-on subset (lateral 0, heading 0) — the shot that
   * should be free. THE HARNESS SELF-CHECK: if this is not near 1 on doorways
   * with a clear approach, the census is measuring itself, not the geometry.
   */
  deadOn: { samples: number; captured: number };
  /**
   * Does this doorway actually carry a funnel jaw?
   *
   * ⚠️ THE AGGREGATE IS NOT THE MEASUREMENT, and reporting it alone is how a
   * change like this gets wrongly abandoned — or wrongly shipped. Funnels land
   * on a handful of doorways per floor; the other ~150 in the census are
   * untouched, and averaging over all of them dilutes whatever the treated ones
   * did by more than an order of magnitude. Splitting on treatment is the only
   * way to see the effect at all, and it is the same discipline a signed split
   * bought elsewhere in this repo, where a net of ~0 was hiding a -3.29% and a
   * +4.42% cancelling each other out.
   */
  funnelled: boolean;
}

/**
 * How near a funnel arc must be to count as "this doorway's".
 *
 * A jaw's far end sits about `FUNNEL_DEPTH` tiles back up the corridor, so the
 * radius has to clear that; much wider and a funnel on a NEIGHBOURING doorway
 * would mark this one as treated and blur the very split it exists to make.
 */
const FUNNEL_NEAR = 6;

/** Is there a funnel jaw attached to this doorway? */
function hasFunnel(g: Grid, d: Doorway): boolean {
  for (const f of g.arcs ?? []) {
    if (f.owner !== "funnel") continue;
    if (Math.hypot(f.cx - (d.i + 0.5), f.cz - (d.j + 0.5)) <= FUNNEL_NEAR + f.r) return true;
  }
  return false;
}

/**
 * Fraction of a direction's launch positions that must be walkable before that
 * direction is judged at all. Below this there is nowhere to stand and the
 * samples that do fire are all threading a gap, which scores the siting rather
 * than the shape.
 */
const MIN_SITE_FRAC = 0.25;

/** Sweep the whole sampling grid at one doorway, from BOTH sides. */
export function censusDoorway(g: Grid, d: Doorway): DoorwayResult {
  const r: DoorwayResult = {
    w: d.w,
    samples: 0,
    captured: 0,
    rejected: 0,
    timeout: 0,
    stalled: 0,
    medBounces: 0,
    unusableDirs: 0,
    deadOn: { samples: 0, captured: 0 },
    funnelled: hasFunnel(g, d),
  };
  const capturedBounces: number[] = [];

  for (const dir of [1, -1] as const) {
    // Standing room first: probe the launch grid before simulating anything.
    let sites = 0;
    let slots = 0;
    for (const depth of START_DEPTHS) {
      for (const lateral of LATERALS) {
        slots++;
        if (fireSample(g, d, depth, lateral, 0, 1, dir)) sites++;
      }
    }
    if (slots === 0 || sites / slots < MIN_SITE_FRAC) {
      r.unusableDirs++;
      continue;
    }

    for (const depth of START_DEPTHS) {
      for (const lateral of LATERALS) {
        for (const deg of HEADINGS_DEG) {
          for (const speed of SPEEDS) {
            const s = fireSample(g, d, depth, lateral, (deg * Math.PI) / 180, speed, dir);
            if (!s) continue;
            r.samples++;
            if (lateral === 0 && deg === 0) {
              r.deadOn.samples++;
              if (s.outcome === "captured") r.deadOn.captured++;
            }
            if (s.outcome === "captured") {
              r.captured++;
              capturedBounces.push(s.bounces);
            } else if (s.outcome === "rejected") r.rejected++;
            else if (s.outcome === "timeout") r.timeout++;
            else r.stalled++;
          }
        }
      }
    }
  }
  capturedBounces.sort((a, b) => a - b);
  r.medBounces = capturedBounces.length ? capturedBounces[capturedBounces.length >> 1] : -1;
  return r;
}

export interface FloorResult {
  level: number;
  runSeed: number;
  archetype: string;
  doorways: DoorwayResult[];
}

export interface CensusReport {
  floors: number;
  doorways: number;
  samples: number;
  captureRate: number;
  rejectRate: number;
  timeoutRate: number;
  stallRate: number;
  medBounces: number;
  /** Approach directions with no standing room, of `doorways × 2`. */
  unusableDirs: number;
  /** Harness self-check: capture rate of the dead-on, zero-lateral shot. */
  deadOnRate: number;
  /** The treated/untreated split — see `DoorwayResult.funnelled`. */
  split: {
    funnelled: { doorways: number; samples: number; captureRate: number; rejectRate: number };
    plain: { doorways: number; samples: number; captureRate: number; rejectRate: number };
  };
  /** Capture rate split by the doorway's vocabulary width. */
  byWidth: Record<number, { doorways: number; samples: number; captureRate: number; medBounces: number }>;
  /** Worst doorways by capture rate — where an authoring pass would pay. */
  worst: Array<{ level: number; runSeed: number; w: number; captureRate: number }>;
  perFloor: FloorResult[];
}

const median = (xs: number[]): number => {
  if (!xs.length) return -1;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

/** Run the census over a set of (level, runSeed) floors. */
export function runFunnelCensus(levels: readonly number[], runSeeds: readonly number[]): CensusReport {
  const perFloor: FloorResult[] = [];
  for (const runSeed of runSeeds) {
    for (const level of levels) {
      const f = buildHeadlessFloor(level, runSeed);
      if (!f) continue;
      perFloor.push({
        level,
        runSeed,
        archetype: f.archetype,
        doorways: f.doorways.map((d) => censusDoorway(f.grid, d)),
      });
    }
  }

  let samples = 0;
  let captured = 0;
  let rejected = 0;
  let timeout = 0;
  let stalled = 0;
  let doorways = 0;
  let unusableDirs = 0;
  let deadOnSamples = 0;
  let deadOnCaptured = 0;
  const bounces: number[] = [];
  const byWidth: CensusReport["byWidth"] = {};
  const split = {
    funnelled: { doorways: 0, samples: 0, captureRate: 0, rejectRate: 0 },
    plain: { doorways: 0, samples: 0, captureRate: 0, rejectRate: 0 },
  };
  const worst: CensusReport["worst"] = [];

  for (const f of perFloor) {
    for (const d of f.doorways) {
      // Counted even when unusable: a doorway with no approach at all is part
      // of the floor's doorway population, and hiding it would flatter the
      // siting. Only its (absent) samples are excluded from the rates.
      unusableDirs += d.unusableDirs;
      deadOnSamples += d.deadOn.samples;
      deadOnCaptured += d.deadOn.captured;
      if (!d.samples) continue;
      doorways++;
      samples += d.samples;
      captured += d.captured;
      rejected += d.rejected;
      timeout += d.timeout;
      stalled += d.stalled;
      if (d.medBounces >= 0) bounces.push(d.medBounces);
      const bw = (byWidth[d.w] ??= { doorways: 0, samples: 0, captureRate: 0, medBounces: 0 });
      bw.doorways++;
      bw.samples += d.samples;
      // Accumulate the count here; converted to a rate below.
      bw.captureRate += d.captured;
      if (d.medBounces >= 0) bw.medBounces += d.medBounces;
      const sp = d.funnelled ? split.funnelled : split.plain;
      sp.doorways++;
      sp.samples += d.samples;
      sp.captureRate += d.captured; // counts here; converted to a rate below
      sp.rejectRate += d.rejected;
      worst.push({ level: f.level, runSeed: f.runSeed, w: d.w, captureRate: d.captured / d.samples });
    }
  }
  for (const k of Object.keys(byWidth)) {
    const bw = byWidth[Number(k)];
    bw.captureRate = bw.samples ? bw.captureRate / bw.samples : 0;
    bw.medBounces = bw.doorways ? bw.medBounces / bw.doorways : -1;
  }
  for (const sp of [split.funnelled, split.plain]) {
    sp.captureRate = sp.samples ? sp.captureRate / sp.samples : 0;
    sp.rejectRate = sp.samples ? sp.rejectRate / sp.samples : 0;
  }
  worst.sort((a, b) => a.captureRate - b.captureRate);

  return {
    floors: perFloor.length,
    doorways,
    samples,
    captureRate: samples ? captured / samples : 0,
    rejectRate: samples ? rejected / samples : 0,
    timeoutRate: samples ? timeout / samples : 0,
    stallRate: samples ? stalled / samples : 0,
    medBounces: median(bounces),
    unusableDirs,
    deadOnRate: deadOnSamples ? deadOnCaptured / deadOnSamples : 0,
    split,
    byWidth,
    worst: worst.slice(0, 12),
    perFloor,
  };
}
