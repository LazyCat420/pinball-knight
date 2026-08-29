/**
 * THE PLAZA PARTS — swingarm, flywheel, magpost.
 *
 * Three kinds a retired plan named and never defined. What they do was
 * specified on 2026-08-28; these tests pin the parts of that specification that
 * a plausible implementation gets wrong:
 *
 *   swingarm  the HAND connects, not the hub — and the throw is the hand's
 *             TANGENT, so it depends on WHEN you arrived.
 *   flywheel  the exit speed does NOT read your momentum. It is the one part
 *             that can restart a dead run.
 *   magpost   a field of these must not eat your pace. That is the whole ask,
 *             and it is an arithmetic claim about a CASCADE, not about one
 *             bounce — so it is tested as a cascade.
 *
 * No rendering and no audio (house rule): `state.vfx` is left null so the
 * optional-chained VFX calls no-op, and sfx are fail-silent without an
 * AudioContext.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { state, freshPlayerFields, type PinballPart, type PinballPartKind } from "../state";
import { PART_HANDLERS, type PinballDeps } from "./pinball-collide";
import {
  SWINGARM_LEN,
  SWINGARM_SPEED,
  swingArmPhase,
  FLYWHEEL_SPEED,
  FLYWHEEL_RADIUS,
  MAGPOST_KEEP,
  MAGPOST_MIN_EXIT,
  MAGPOST_RADIUS,
  PINBALL_MAX_SPEED,
} from "../constants";

let steerLock = 0;
const deps: PinballDeps = {
  startRampHop: () => {},
  startDrop: () => {},
  setSteerLock: (t) => {
    steerLock = t;
  },
  raiseSteerLock: (t) => {
    steerLock = Math.max(steerLock, t);
  },
  aimHint: () => null,
};

function part(kind: PinballPartKind, over: Partial<PinballPart> = {}): PinballPart {
  return {
    kind,
    i: 0,
    j: 0,
    x: 0,
    z: 0,
    dirX: 1,
    dirZ: 0,
    dir2X: 0,
    dir2Z: 0,
    cooldownT: 0,
    hitT: -1,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mesh: undefined as any,
    ...over,
  };
}

/** Fire one handler at the player's current position. */
function touch(p: PinballPart, inMomentum = true): void {
  const pl = state.player!;
  const dx = pl.x - p.x;
  const dz = pl.z - p.z;
  PART_HANDLERS[p.kind]({ part: p, p: pl, dx, dz, d2: dx * dx + dz * dz, inMomentum, curSpeed: 0, deps });
}

beforeEach(() => {
  steerLock = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state.player = { x: 0, z: 0, ...freshPlayerFields() } as any;
  state.pinballParts = [];
  state.elapsed = 0;
  state.vfx = null as unknown as typeof state.vfx;
});

describe("swingarm — the hand, not the hub", () => {
  it("does NOT connect at the hub, where there is visibly nothing", () => {
    // Every other part's trigger is the distance to its own tile. A swingarm's
    // business end is a metre away and moving, so reusing `d2` would make it
    // hit you standing on the post — the one place the arm never is.
    const p = state.player!;
    p.x = 0;
    p.z = 0; // dead on the hub
    p.momSpeed = 3;
    const arm = part("swingarm", { spin: 1, phase: 0 });

    touch(arm);

    expect(p.momSpeed).toBe(3); // untouched
    expect(arm.hitT).toBe(-1);
  });

  it("connects where the hand actually is, on the SAME clock the mesh uses", () => {
    // The renderer draws the arm from swingArmPhase and the physics tests
    // against swingArmPhase. If those ever became two clocks, the part would
    // connect on empty air — a rendering bug that presents as a physics one.
    state.elapsed = 0.7;
    const arm = part("swingarm", { spin: 1, phase: 0.4 });
    const a = swingArmPhase(state.elapsed, 1, 0.4);
    const p = state.player!;
    p.x = Math.cos(a) * SWINGARM_LEN;
    p.z = Math.sin(a) * SWINGARM_LEN;
    p.momSpeed = 0;

    touch(arm);

    expect(p.momSpeed).toBe(SWINGARM_SPEED);
  });

  it("throws you along the hand's TANGENT, so the exit depends on WHEN you met it", () => {
    // This is the part's whole identity: a swingarm is a shot you WAIT for.
    // A radial throw (straight out from the hub) would make timing irrelevant.
    const exits: Array<{ x: number; z: number }> = [];
    for (const t of [0, 0.5]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      state.player = { x: 0, z: 0, ...freshPlayerFields() } as any;
      state.elapsed = t;
      const arm = part("swingarm", { spin: 1, phase: 0 });
      const a = swingArmPhase(t, 1, 0);
      const p = state.player!;
      p.x = Math.cos(a) * SWINGARM_LEN;
      p.z = Math.sin(a) * SWINGARM_LEN;
      touch(arm);
      exits.push({ x: p.momX, z: p.momZ });

      // Tangential means PERPENDICULAR to the arm — dot with the radius is 0.
      expect(p.momX * Math.cos(a) + p.momZ * Math.sin(a)).toBeCloseTo(0, 6);
    }
    // Two different arrival times, two different exits.
    expect(exits[0].x).not.toBeCloseTo(exits[1].x, 2);
  });

  it("spins both ways, and the throw follows the spin", () => {
    const out: Array<{ x: number; z: number }> = [];
    for (const spin of [1, -1]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      state.player = { x: 0, z: 0, ...freshPlayerFields() } as any;
      state.elapsed = 0;
      const arm = part("swingarm", { spin, phase: 0 });
      const p = state.player!;
      p.x = SWINGARM_LEN; // phase 0 ⇒ the hand is at +x either way
      p.z = 0;
      touch(arm);
      out.push({ x: p.momX, z: p.momZ });
    }
    // Same hand position, opposite rotation ⇒ opposite tangent.
    expect(out[0].z).toBeCloseTo(-out[1].z, 6);
  });
});

describe("flywheel — the wheels do the work", () => {
  it("launches a STANDING player at full speed", () => {
    // The recovery part. `Math.max(p.momSpeed, …)`, which every other launcher
    // uses, would be wrong here: you are not being boosted, you are being fed
    // between two spinning wheels, and they do not care what you brought.
    const p = state.player!;
    p.momSpeed = 0;
    touch(part("flywheel", { dirX: 1, dirZ: 0 }), false);

    expect(p.momSpeed).toBe(FLYWHEEL_SPEED);
    expect(p.momX).toBe(1);
    expect(p.momZ).toBe(0);
  });

  it("does not stack with what you arrived carrying", () => {
    // Symmetrically: arriving fast must not exceed the wheels' speed either, or
    // a flywheel becomes a multiplier and the fastest line on the floor is a
    // chain of them.
    const p = state.player!;
    p.momSpeed = PINBALL_MAX_SPEED;
    touch(part("flywheel", { dirX: 1, dirZ: 0 }));

    expect(p.momSpeed).toBe(FLYWHEEL_SPEED);
  });

  it("commits you to the barrel briefly", () => {
    touch(part("flywheel"));
    expect(steerLock).toBeGreaterThan(0);
  });

  it("ignores you outside the gap", () => {
    const p = state.player!;
    p.x = FLYWHEEL_RADIUS + 0.5;
    p.momSpeed = 2;
    touch(part("flywheel"));
    expect(p.momSpeed).toBe(2);
  });
});

describe("magpost — a cascade must not eat your pace", () => {
  /** Run the player through `n` posts head-on, as a peg field would. */
  function cascade(n: number, from: number): number {
    const p = state.player!;
    p.momSpeed = from;
    p.momX = 1;
    p.momZ = 0;
    for (let k = 0; k < n; k++) {
      // Approach each post slightly off-axis so there is a normal to reflect
      // about — a dead-centre hit is degenerate and not what a field produces.
      const post = part("magpost", { i: k, j: k, x: p.x + 0.2, z: p.z + 0.12 });
      touch(post);
    }
    return p.momSpeed;
  }

  it("a SEVEN-post cascade does not drain the run", () => {
    // The stated requirement, and the reason MAGPOST_KEEP is 0.94 rather than
    // the 0.9 that looks harmless: 0.9^7 is 48% — you leave the field at half
    // pace, which is "you just lose momentum in the pegs".
    const out = cascade(7, 20);
    expect(out).toBeGreaterThan(20 * 0.6);
  });

  it("never drops below the floor, however long the field", () => {
    // The hard backstop. Any per-bounce multiplier below 1 eventually reaches
    // zero, so a long enough cascade would stall the player inside the lattice
    // with no way out — a soft-lock made of furniture.
    expect(cascade(40, 20)).toBeGreaterThanOrEqual(MAGPOST_MIN_EXIT);
  });

  it("keeps most of one bounce's speed", () => {
    const out = cascade(1, 20);
    expect(out).toBeCloseTo(20 * MAGPOST_KEEP, 5);
  });

  it("DEFLECTS rather than launching — the heading changes, and it turns you", () => {
    const p = state.player!;
    p.momSpeed = 12;
    p.momX = 1;
    p.momZ = 0;
    touch(part("magpost", { x: 0.2, z: 0.12 }));

    expect(Math.hypot(p.momX, p.momZ)).toBeCloseTo(1, 6);
    expect(p.momZ).not.toBeCloseTo(0, 3); // it went somewhere else
  });

  it("lets a WALKING player through — a field is not a wall", () => {
    const p = state.player!;
    p.momSpeed = 0;
    touch(part("magpost", { x: 0.2, z: 0.12 }), false);
    expect(p.momSpeed).toBe(0);
  });

  it("does not re-bounce something already travelling away from it", () => {
    // Without the outgoing-normal guard, a post inside the player's radius
    // flips the heading every frame and the knight vibrates against it.
    const p = state.player!;
    p.momSpeed = 12;
    p.momX = 1;
    p.momZ = 0;
    p.x = 0.2; // player is at +x of the post, and heading further +x
    p.z = 0;
    const post = part("magpost", { x: 0, z: 0 });
    touch(post);
    expect(p.momX).toBe(1);
    expect(post.hitT).toBe(-1);
  });

  it("scatters by the POST, so a floor still replays identically from its seed", () => {
    // The jitter is derived from the post's own tile, not Math.random. Co-op
    // peers and the census both depend on a floor being a pure function of its
    // seed; a random bounce would break both, silently.
    const run = (): number => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      state.player = { x: 0, z: 0, ...freshPlayerFields() } as any;
      const p = state.player!;
      p.momSpeed = 12;
      p.momX = 1;
      p.momZ = 0;
      touch(part("magpost", { i: 7, j: 11, x: 0.2, z: 0.12 }));
      return p.momZ;
    };
    expect(run()).toBe(run());
  });

  it("two DIFFERENT posts scatter differently", () => {
    // ...and the derivation actually varies, rather than being a constant
    // dressed up as a hash. A lattice where every post deflects identically is
    // a lattice with predictable channels through it.
    const run = (i: number, j: number): number => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      state.player = { x: 0, z: 0, ...freshPlayerFields() } as any;
      const p = state.player!;
      p.momSpeed = 12;
      p.momX = 1;
      p.momZ = 0;
      touch(part("magpost", { i, j, x: 0.2, z: 0.12 }));
      return p.momZ;
    };
    expect(run(3, 5)).not.toBe(run(11, 2));
  });

  it("has a small radius — you thread BETWEEN posts, not around the field", () => {
    expect(MAGPOST_RADIUS).toBeLessThan(0.5);
  });
});
