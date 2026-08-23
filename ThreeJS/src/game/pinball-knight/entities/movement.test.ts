/**
 * MOVEMENT POLICIES — dispatch totality and the baseline steering contract.
 *
 * Two jobs:
 *
 *  1. The dispatch is EXHAUSTIVE — the same discipline `pinball-collide.test.ts`
 *     keeps over `PART_HANDLERS`. A monster must never be able to fall through
 *     to another policy's steering, and adding a `MovementKind` must fail here
 *     rather than silently inheriting `chase`.
 *  2. The five baseline policies still steer the way the old if/else cascade
 *     steered. These cases were written against the pre-refactor code and are
 *     what makes "behaviour-preserving" a claim someone checked.
 *
 * The module is deliberately three-, state- and DOM-free, so this file needs no
 * mocks at all — which is the whole reason the steering was extracted.
 */
import { describe, it, expect } from "vitest";
import { MOVEMENT_HANDLERS, MOVEMENT_KINDS, type MoveActor, type MoveCtx, type MovementKind } from "./movement";
import {
  SPITTER_KITE_RANGE,
  DIRECT_STEER_RANGE,
  SPITTER_FIRE_RANGE,
  FLANK_CLOSE,
  STRAFE_DART_MULT,
  AMBUSH_RANGE,
  AMBUSH_BURST_MULT,
  ORBIT_RADIUS,
  LEAP_WINDUP,
  LEAP_SPEED_MULT,
  PACK_MIN,
  PACK_HOLD_RANGE,
  PACK_RUSH_MULT,
} from "../constants";

/** Every kind the game can steer with. Kept literal so adding one fails here. */
const ALL_KINDS: MovementKind[] = [
  "chase",
  "kite",
  "rooted",
  "phase",
  "inert",
  "flanker",
  "strafer",
  "ambusher",
  "orbiter",
  "leaper",
  "packhunter",
];

function actor(over: Partial<MoveActor> = {}): MoveActor {
  return { x: 0, z: 0, speed: 2, ...over };
}

/** A context with the player `dist` units away along +x, and a flow heading. */
function ctx(dist: number, over: Partial<MoveCtx> = {}): MoveCtx {
  return {
    dt: 1 / 60,
    pdx: dist,
    pdz: 0,
    pdist: dist,
    flowX: 0,
    flowZ: 1, // deliberately NOT the direct line, so the two are distinguishable
    contactRange: SPITTER_FIRE_RANGE,
    los: true,
    packNear: 0,
    packCommitted: false,
    ...over,
  };
}

describe("dispatch is exhaustive", () => {
  it("every MovementKind has a handler", () => {
    for (const kind of ALL_KINDS) {
      expect(MOVEMENT_HANDLERS[kind], `no handler for "${kind}"`).toBeTypeOf("function");
    }
  });

  it("has no handlers for kinds that don't exist (table matches the union)", () => {
    expect(Object.keys(MOVEMENT_HANDLERS).sort()).toEqual([...ALL_KINDS].sort());
  });

  it("MOVEMENT_KINDS lists exactly the table's keys", () => {
    // The exported list is what the harness and the roster audit iterate; if it
    // drifts from the table, a policy stops being measured without failing.
    expect([...MOVEMENT_KINDS].sort()).toEqual([...ALL_KINDS].sort());
  });

  it("no kind falls through to another kind's steering", () => {
    // The regression in one line: dispatch is a lookup, so a kind can only ever
    // run its OWN policy. Two kinds sharing a function would be fine; a kind
    // being ABSENT is what silently re-creates the cascade.
    for (const kind of ALL_KINDS) expect(kind in MOVEMENT_HANDLERS).toBe(true);
  });
});

describe("chase — the baseline the cascade used to hard-code", () => {
  it("steers STRAIGHT at the player inside DIRECT_STEER_RANGE", () => {
    const s = MOVEMENT_HANDLERS.chase(actor(), ctx(DIRECT_STEER_RANGE - 0.1));
    expect(s.vx).toBeCloseTo(1, 6);
    expect(s.vz).toBeCloseTo(0, 6);
  });

  it("follows the FLOW FIELD beyond it", () => {
    const s = MOVEMENT_HANDLERS.chase(actor(), ctx(DIRECT_STEER_RANGE + 0.1));
    expect(s.vx).toBeCloseTo(0, 6);
    expect(s.vz).toBeCloseTo(1, 6);
  });

  it("stands still when it has no field and is out of direct range", () => {
    const s = MOVEMENT_HANDLERS.chase(actor(), ctx(6, { flowX: 0, flowZ: 0 }));
    expect(s).toMatchObject({ vx: 0, vz: 0 });
  });

  it("does not divide by zero standing on the player", () => {
    const s = MOVEMENT_HANDLERS.chase(actor(), ctx(0));
    expect(Number.isFinite(s.vx) && Number.isFinite(s.vz)).toBe(true);
  });
});

describe("kite — the spitter's range game, unchanged", () => {
  it("RETREATS inside the kite range", () => {
    const s = MOVEMENT_HANDLERS.kite(actor(), ctx(SPITTER_KITE_RANGE - 0.2));
    expect(s.vx).toBeCloseTo(-1, 6);
  });

  it("HOLDS between the kite range and its fire range", () => {
    const s = MOVEMENT_HANDLERS.kite(actor(), ctx((SPITTER_KITE_RANGE + SPITTER_FIRE_RANGE) / 2));
    expect(s).toMatchObject({ vx: 0, vz: 0 });
  });

  it("PATHS IN beyond its fire range", () => {
    const s = MOVEMENT_HANDLERS.kite(actor(), ctx(SPITTER_FIRE_RANGE + 2));
    expect(s.vz).toBeCloseTo(1, 6); // the flow heading
  });
});

describe("rooted / phase / inert", () => {
  it("rooted still FACES you but flags itself immovable", () => {
    // The old code kept steering and multiplied the step by zero, so the facing
    // and the walk clip kept updating. That is preserved on purpose.
    const s = MOVEMENT_HANDLERS.rooted(actor(), ctx(DIRECT_STEER_RANGE - 0.1));
    expect(s.rooted).toBe(true);
    expect(s.vx).toBeCloseTo(1, 6);
  });

  it("phase ignores the flow field entirely — it walks through walls", () => {
    const far = MOVEMENT_HANDLERS.phase(actor(), ctx(12));
    expect(far.vx).toBeCloseTo(1, 6);
    expect(far.vz).toBeCloseTo(0, 6);
  });

  it("inert never steers and never plays a walk", () => {
    expect(MOVEMENT_HANDLERS.inert(actor(), ctx(3))).toMatchObject({ vx: 0, vz: 0, hold: true });
  });
});

describe("handlers are pure with respect to the world", () => {
  it("does not mutate the context", () => {
    const c = ctx(5);
    const snapshot = JSON.stringify(c);
    for (const kind of ALL_KINDS) MOVEMENT_HANDLERS[kind](actor(), c);
    expect(JSON.stringify(c)).toBe(snapshot);
  });

  it("uses no Math.random — the same actor+context replays identically", () => {
    // The co-op contract in one assertion: two peers stepping the same actor
    // through the same frames must produce the same path, forever. An i.i.d.
    // roll anywhere in here would fail this within a few frames.
    for (const kind of ALL_KINDS) {
      const a = run(kind, { dist: 8, frames: 400 });
      const b = run(kind, { dist: 8, frames: 400 });
      expect(b.path, kind).toEqual(a.path);
    }
  });

  it("returns finite headings for every kind at every range", () => {
    for (const kind of ALL_KINDS) {
      for (const d of [0, 0.0001, 0.5, 1.6, 3, 7, 40]) {
        const s = MOVEMENT_HANDLERS[kind](actor(), ctx(d));
        expect(Number.isFinite(s.vx), `${kind} @ ${d}`).toBe(true);
        expect(Number.isFinite(s.vz), `${kind} @ ${d}`).toBe(true);
      }
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * THE MEASUREMENT
 *
 * A movement type that measures identical to `chase` is a LABEL, not a
 * behaviour, and the only way to know which one shipped is to walk the policy
 * and measure the path it draws. So: put an actor in an open room with the
 * player at the origin, hand it a flow heading that points straight at the
 * player (the open-room case — the field's job is done by the direct line), run
 * it for N frames at the game's fixed 60 Hz, and record the path.
 *
 * Every policy below is then asserted against `chase` on ONE named quantity:
 *
 *   flanker    mean off-axis angle (rad)      — how far off the direct line it walks
 *   strafer    mean held range + tangential share
 *   ambusher   displacement while out of sight — must be exactly zero
 *   orbiter    range variance + tangential share
 *   leaper     path curvature (rad/s) + peak speed
 *   packhunter closest approach, alone vs. in a quorum
 *
 * These are the quantities themselves, not proxies for them: the numbers below
 * come from running the code, not from reading it.
 * ──────────────────────────────────────────────────────────────────────────── */

interface RunOpts {
  /** Starting distance from the player (who sits at the origin). */
  dist: number;
  frames: number;
  /** Deterministic per-actor phase (which way it peels). */
  phase?: number;
  /** Does it have line of sight this whole run? */
  los?: boolean;
  packNear?: number;
  contactRange?: number;
}

interface RunResult {
  path: Array<{ x: number; z: number }>;
  /** Mean |angle| between the step taken and the direct line to the player. */
  offAxis: number;
  /** Mean and standard deviation of the distance held from the player. */
  meanRange: number;
  rangeSd: number;
  /** Mean |change of heading| per second — a straight line is 0. */
  curvature: number;
  /** Mean fraction of each step spent going AROUND rather than IN. */
  tangential: number;
  /** How close it ever got. */
  closest: number;
  /** Fastest single frame, as a multiple of base speed. */
  peakMult: number;
  /** Straight-line distance from where it started. */
  displaced: number;
}

const DT = 1 / 60;

/** Walk one policy through an open room and measure the path it draws. */
function run(kind: MovementKind, o: RunOpts): RunResult {
  const a: MoveActor = { x: o.dist, z: 0, speed: 2, movePhase: o.phase ?? 0.9 };
  const start = { x: a.x, z: a.z };
  const path: Array<{ x: number; z: number }> = [];
  let offSum = 0;
  let tanSum = 0;
  let turnSum = 0;
  let peak = 0;
  let closest = Infinity;
  let prevH: { x: number; z: number } | null = null;
  const ranges: number[] = [];

  for (let f = 0; f < o.frames; f++) {
    const pdx = -a.x;
    const pdz = -a.z;
    const pdist = Math.hypot(pdx, pdz);
    const ux = pdist > 1e-6 ? pdx / pdist : 0;
    const uz = pdist > 1e-6 ? pdz / pdist : 0;
    const s = MOVEMENT_HANDLERS[kind](a, {
      dt: DT,
      pdx,
      pdz,
      pdist,
      // Open room: the flow field's answer IS the direct line, so any deviation
      // in the path is the policy's doing and not the maze's.
      flowX: ux,
      flowZ: uz,
      contactRange: o.contactRange ?? 0.7,
      los: o.los ?? true,
      packNear: o.packNear ?? 1,
      packCommitted: false,
    });
    const mult = s.mult ?? 1;
    const step = a.speed * mult * DT;
    const h = Math.hypot(s.vx, s.vz);
    if (h > 1e-6) {
      const hx = s.vx / h;
      const hz = s.vz / h;
      // Angle between the step and the direct line, and how much of it is
      // tangential (perpendicular) rather than radial (toward the player).
      offSum += Math.acos(Math.max(-1, Math.min(1, hx * ux + hz * uz)));
      tanSum += Math.abs(hx * -uz + hz * ux);
      if (prevH) {
        turnSum += Math.acos(Math.max(-1, Math.min(1, hx * prevH.x + hz * prevH.z))) / DT;
      }
      prevH = { x: hx, z: hz };
      a.x += hx * step;
      a.z += hz * step;
    }
    peak = Math.max(peak, h > 1e-6 ? mult : 0);
    const d = Math.hypot(a.x, a.z);
    ranges.push(d);
    closest = Math.min(closest, d);
    path.push({ x: +a.x.toFixed(6), z: +a.z.toFixed(6) });
  }

  const meanRange = ranges.reduce((s2, r) => s2 + r, 0) / ranges.length;
  const rangeSd = Math.sqrt(ranges.reduce((s2, r) => s2 + (r - meanRange) ** 2, 0) / ranges.length);
  return {
    path,
    offAxis: offSum / o.frames,
    meanRange,
    rangeSd,
    curvature: turnSum / o.frames,
    tangential: tanSum / o.frames,
    closest,
    peakMult: peak,
    displaced: Math.hypot(a.x - start.x, a.z - start.z),
  };
}

describe("MEASURED: every policy draws a different path than chase", () => {
  it("flanker walks measurably OFF the direct line", () => {
    // The APPROACH is what the angle is about, so it is measured over the
    // approach (300 frames = 5 s). Averaging past arrival would dilute the
    // number with frames the policy has already stopped deviating in — a real
    // property, but not the one under test.
    const base = run("chase", { dist: 9, frames: 300 });
    const flank = run("flanker", { dist: 9, frames: 300 });
    // Chase in an open room is the direct line by construction: zero off-axis.
    expect(base.offAxis).toBeLessThan(0.01);
    // The flanker holds a real angle across it. Measured: ~0.63 rad ≈ 36°.
    expect(flank.offAxis).toBeGreaterThan(0.5);
    expect(flank.offAxis / Math.max(base.offAxis, 1e-6)).toBeGreaterThan(10);
    // …and it STILL ARRIVES, given the extra path length its detour costs. An
    // angle that never closes is an orbit, not a flank.
    expect(run("flanker", { dist: 9, frames: 500 }).closest).toBeLessThan(FLANK_CLOSE);
  });

  it("flanker peels to OPPOSITE sides for opposite phases (and only phases decide)", () => {
    const left = run("flanker", { dist: 9, frames: 120, phase: 0.1 });
    const right = run("flanker", { dist: 9, frames: 120, phase: 0.9 });
    const lz = left.path[left.path.length - 1].z;
    const rz = right.path[right.path.length - 1].z;
    expect(Math.sign(lz)).toBe(-Math.sign(rz));
    expect(Math.abs(lz)).toBeGreaterThan(0.5);
  });

  it("strafer HOLDS RANGE where chase closes to contact", () => {
    const base = run("chase", { dist: 9, frames: 900 });
    const straf = run("strafer", { dist: 9, frames: 900 });
    // Chase ends up sitting on the player; the strafer spends its life at range.
    expect(base.meanRange).toBeLessThan(2);
    expect(straf.meanRange).toBeGreaterThan(base.meanRange * 1.5);
    // And most of its motion is going AROUND, not IN.
    expect(straf.tangential).toBeGreaterThan(0.4);
    expect(base.tangential).toBeLessThan(0.05);
  });

  it("strafer DARTS on a cadence — the commit is a real speed spike", () => {
    const straf = run("strafer", { dist: 5, frames: 600 });
    expect(straf.peakMult).toBeCloseTo(STRAFE_DART_MULT, 5);
    // The dart is what lets it actually reach you; without it, it is scenery.
    expect(straf.closest).toBeLessThan(2);
  });

  it("ambusher does not move AT ALL without sight, and springs when it has it", () => {
    const blind = run("ambusher", { dist: 4, frames: 400, los: false });
    expect(blind.displaced).toBe(0); // not "small" — zero. It is a trap, not a shy chaser.
    const sprung = run("ambusher", { dist: 4, frames: 400, los: true });
    expect(sprung.closest).toBeLessThan(1);
    expect(sprung.peakMult).toBeCloseTo(AMBUSH_BURST_MULT, 5);
  });

  it("ambusher ignores sight it has from OUTSIDE its range", () => {
    const far = run("ambusher", { dist: AMBUSH_RANGE + 3, frames: 400, los: true });
    expect(far.displaced).toBe(0);
  });

  it("orbiter RINGS at radius — held range, and it never closes like a chaser", () => {
    const base = run("chase", { dist: 8, frames: 420 });
    const orb = run("orbiter", { dist: 8, frames: 420 });
    expect(orb.tangential).toBeGreaterThan(0.7); // almost pure sideways travel
    expect(base.tangential).toBeLessThan(0.05);
    // It settles ONTO the ring and stays there: over the settled half of the
    // run its range barely moves, where a chaser's collapses to zero.
    const settled = run("orbiter", { dist: ORBIT_RADIUS, frames: 420 });
    expect(settled.rangeSd).toBeLessThan(0.35);
    expect(Math.abs(settled.meanRange - ORBIT_RADIUS)).toBeLessThan(1);
  });

  it("orbiter TIGHTENS — the ring is a spiral, not a fence", () => {
    const short = run("orbiter", { dist: ORBIT_RADIUS, frames: 300 });
    const long = run("orbiter", { dist: ORBIT_RADIUS, frames: 1200 });
    expect(long.closest).toBeLessThan(short.closest - 0.5);
  });

  it("leaper's pounce is an ARC — curvature far above a straight chase", () => {
    const base = run("chase", { dist: 5, frames: 600 });
    const leap = run("leaper", { dist: 5, frames: 600 });
    expect(base.curvature).toBeLessThan(0.05);
    // LEAP_CURVE rad/s while airborne, averaged over the whole run.
    expect(leap.curvature).toBeGreaterThan(0.15);
    expect(leap.peakMult).toBeCloseTo(LEAP_SPEED_MULT, 5);
  });

  it("leaper CROUCHES first — there is a window where it is stopped", () => {
    // Frame-by-frame: find a run of frames with zero displacement that is
    // followed by the fastest frames of the run. That shape IS the telegraph.
    const a: MoveActor = { x: 4, z: 0, speed: 2, movePhase: 0.9 };
    let stillest = 0;
    let stillRun = 0;
    let sawBurst = false;
    for (let f = 0; f < 300; f++) {
      const pdist = Math.hypot(a.x, a.z);
      const s = MOVEMENT_HANDLERS.leaper(a, {
        dt: DT,
        pdx: -a.x,
        pdz: -a.z,
        pdist,
        flowX: -a.x / pdist,
        flowZ: -a.z / pdist,
        contactRange: 0.7,
        los: true,
        packNear: 1,
        packCommitted: false,
      });
      if (s.hold) {
        stillRun++;
        stillest = Math.max(stillest, stillRun);
      } else {
        if (stillest > 0 && (s.mult ?? 1) > 3) sawBurst = true;
        stillRun = 0;
        a.x += s.vx * a.speed * (s.mult ?? 1) * DT;
        a.z += s.vz * a.speed * (s.mult ?? 1) * DT;
      }
    }
    // LEAP_WINDUP seconds of dead stop, then the pounce.
    expect(stillest * DT).toBeGreaterThan(LEAP_WINDUP * 0.8);
    expect(sawBurst).toBe(true);
  });

  it("pack-hunter WILL NOT ENGAGE alone, and rushes at quorum", () => {
    const alone = run("packhunter", { dist: 9, frames: 900, packNear: 1 });
    const quorum = run("packhunter", { dist: 9, frames: 900, packNear: PACK_MIN });
    // Alone it shadows you and never closes past its hold range.
    expect(alone.closest).toBeGreaterThan(PACK_HOLD_RANGE - 0.5);
    // With numbers it behaves like a chaser — and gets there.
    expect(quorum.closest).toBeLessThan(1);
    expect(quorum.peakMult).toBeCloseTo(PACK_RUSH_MULT, 5);
  });

  it("pack-hunter COMMITS FOR GOOD once it goes (the surge is not a flicker)", () => {
    const a: MoveActor = { x: 6, z: 0, speed: 2, movePhase: 0.5 };
    const c = (near: number): MoveCtx => ({
      dt: DT,
      pdx: -a.x,
      pdz: -a.z,
      pdist: Math.hypot(a.x, a.z),
      flowX: -1,
      flowZ: 0,
      contactRange: 0.7,
      los: true,
      packNear: near,
      packCommitted: false,
    });
    MOVEMENT_HANDLERS.packhunter(a, c(PACK_MIN)); // quorum lands
    expect(a.moveCommit).toBeGreaterThan(0);
    const after = MOVEMENT_HANDLERS.packhunter(a, c(1)); // …and the pack dies around it
    expect(after.mult).toBeCloseTo(PACK_RUSH_MULT, 5); // still committed
  });

  it("every new policy differs from chase on at least one measured axis", () => {
    // The blanket version of all of the above: a policy that matched chase on
    // every quantity would be a label. This is the assertion that would have
    // caught "shipped the mechanism, not the capability".
    const base = run("chase", { dist: 8, frames: 600 });
    const axes = (r: RunResult): number[] => [r.offAxis, r.meanRange, r.curvature, r.tangential, r.closest, r.peakMult];
    for (const kind of ["flanker", "strafer", "ambusher", "orbiter", "leaper", "packhunter"] as MovementKind[]) {
      const r = run(kind, { dist: 8, frames: 600, packNear: 1 });
      const differs = axes(r).some((v, i) => Math.abs(v - axes(base)[i]) > 0.25);
      expect(differs, `${kind} measured the same as chase on every axis`).toBe(true);
    }
  });
});
