/**
 * 🔮 MULTI-BALL — the pure half of the echo knights.
 *
 * The trail buffer, the delayed sample, the sideways offset, the follow ease
 * and the per-enemy ram cooldown are all plain maths, so they're pinned here.
 * The live rig (sprites, scene, damageZombie) is left to the game, per the
 * house rule about not testing rendering.
 */
import { describe, it, expect } from "vitest";
import {
  pushTrail,
  sampleTrail,
  echoTarget,
  followStep,
  canRam,
  tickRamCooldowns,
  type TrailPoint,
} from "./multiball";
import {
  MULTIBALL_COUNT,
  MULTIBALL_LAGS,
  MULTIBALL_TRAIL_SECONDS,
  MULTIBALL_RAM_COOLDOWN,
  MULTIBALL_RAM_MULT,
  MULTIBALL_SIDE_OFFSET,
} from "../constants";
import { POTIONS, POTION_IDS } from "../items";

/** A straight eastward run: x = t, z = 0, sampled every 0.1s. */
function straightTrail(seconds = 1, step = 0.1): TrailPoint[] {
  const pts: TrailPoint[] = [];
  for (let t = 0; t <= seconds + 1e-9; t += step) pushTrail(pts, t, 0, t);
  return pts;
}

describe("multi-ball tuning", () => {
  it("is a real potion with the painted art's colour", () => {
    expect(POTION_IDS).toContain("multiball");
    expect(POTIONS.multiball.color).toBe(0xb06fe8); // matches ITEM_PAINTS.multiball
    expect(POTIONS.multiball.duration).toBeGreaterThan(0);
    expect(POTIONS.multiball.heal).toBe(0);
  });

  it("keeps enough trail for the deepest echo's lag", () => {
    expect(MULTIBALL_LAGS.length).toBeGreaterThanOrEqual(MULTIBALL_COUNT);
    for (const lag of MULTIBALL_LAGS) expect(lag).toBeLessThan(MULTIBALL_TRAIL_SECONDS);
  });

  it("assists rather than replaces the player's own ram", () => {
    expect(MULTIBALL_RAM_MULT).toBeGreaterThan(0);
    expect(MULTIBALL_RAM_MULT).toBeLessThan(1);
  });
});

describe("pushTrail", () => {
  it("records samples in order", () => {
    const pts = pushTrail(pushTrail([], 1, 2, 0), 3, 4, 0.1);
    expect(pts).toHaveLength(2);
    expect(pts[1]).toEqual({ x: 3, z: 4, t: 0.1 });
  });

  it("prunes past the window but keeps one straddling point to interpolate from", () => {
    const pts: TrailPoint[] = [];
    for (let i = 0; i <= 40; i++) pushTrail(pts, i, 0, i * 0.1, 1);
    const now = pts[pts.length - 1].t;
    // Bounded, and the oldest point still sits at or before the window edge so
    // a sample AT the edge interpolates instead of clamping.
    expect(pts.length).toBeLessThanOrEqual(13);
    expect(pts[0].t).toBeLessThanOrEqual(now - 1 + 1e-9);
  });

  it("never prunes below two points", () => {
    const pts: TrailPoint[] = [];
    pushTrail(pts, 0, 0, 0, 0.001);
    pushTrail(pts, 5, 5, 10, 0.001);
    expect(pts.length).toBe(2);
  });
});

describe("sampleTrail", () => {
  it("is null only for an empty trail", () => {
    expect(sampleTrail([], 0)).toBeNull();
  });

  it("clamps to the ends", () => {
    const pts = straightTrail(1);
    expect(sampleTrail(pts, -5)).toEqual({ x: 0, z: 0 });
    expect(sampleTrail(pts, 99)?.x).toBeCloseTo(1, 6);
  });

  it("interpolates between samples", () => {
    const pts = [
      { x: 0, z: 0, t: 0 },
      { x: 10, z: 20, t: 1 },
    ];
    const at = sampleTrail(pts, 0.25)!;
    expect(at.x).toBeCloseTo(2.5, 6);
    expect(at.z).toBeCloseTo(5, 6);
  });

  it("survives duplicate timestamps without dividing by zero", () => {
    const pts = [
      { x: 0, z: 0, t: 0 },
      { x: 4, z: 0, t: 0 },
      { x: 8, z: 0, t: 1 },
    ];
    expect(Number.isFinite(sampleTrail(pts, 0)!.x)).toBe(true);
  });
});

describe("echoTarget", () => {
  it("lands the echo where the knight WAS, one lag ago", () => {
    const pts = straightTrail(1);
    const at = echoTarget(pts, 1, 0.3, 0)!;
    expect(at.x).toBeCloseTo(0.7, 5); // x == t on this path
    expect(at.z).toBeCloseTo(0, 5);
  });

  it("offsets perpendicular to travel, and opposite sides mirror", () => {
    const pts = straightTrail(1);
    const left = echoTarget(pts, 1, 0.3, MULTIBALL_SIDE_OFFSET)!;
    const right = echoTarget(pts, 1, 0.3, -MULTIBALL_SIDE_OFFSET)!;
    // Heading is +x, so the offset must land purely on z, and symmetrically.
    expect(left.x).toBeCloseTo(right.x, 6);
    expect(left.z).toBeCloseTo(-right.z, 6);
    expect(Math.abs(left.z)).toBeCloseTo(MULTIBALL_SIDE_OFFSET, 6);
  });

  it("collapses the offset when the knight is standing still (no heading to be perpendicular to)", () => {
    const pts: TrailPoint[] = [];
    for (let t = 0; t <= 1.0001; t += 0.1) pushTrail(pts, 3, 7, t);
    const at = echoTarget(pts, 1, 0.3, MULTIBALL_SIDE_OFFSET)!;
    expect(at.x).toBeCloseTo(3, 6);
    expect(at.z).toBeCloseTo(7, 6);
  });

  it("gives deeper lags a position further back along the path", () => {
    const pts = straightTrail(1);
    const near = echoTarget(pts, 1, MULTIBALL_LAGS[0], 0)!;
    const far = echoTarget(pts, 1, MULTIBALL_LAGS[1], 0)!;
    expect(far.x).toBeLessThan(near.x);
  });

  it("is null on an empty trail", () => {
    expect(echoTarget([], 1, 0.3, 0.4)).toBeNull();
  });
});

describe("followStep", () => {
  it("moves toward the target without overshooting", () => {
    const next = followStep(0, 10, 1 / 60);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(10);
  });

  it("is frame-rate independent — one big step ≈ many small ones", () => {
    let small = 0;
    for (let i = 0; i < 10; i++) small = followStep(small, 10, 0.01);
    const big = followStep(0, 10, 0.1);
    expect(small).toBeCloseTo(big, 6);
  });

  it("converges and stays put once arrived", () => {
    expect(followStep(10, 10, 0.5)).toBeCloseTo(10, 9);
  });
});

describe("ram cooldowns", () => {
  it("lets an untouched enemy be rammed", () => {
    const z = { id: "z1" };
    expect(canRam(new Map(), z)).toBe(true);
  });

  it("blocks a re-hit on the same enemy until the cooldown drains", () => {
    const z = { id: "z1" };
    const cd = new Map<typeof z, number>([[z, MULTIBALL_RAM_COOLDOWN]]);
    expect(canRam(cd, z)).toBe(false);
    // An echo resting on the zombie at 60fps must NOT delete it in a frame.
    for (let i = 0; i < 5; i++) tickRamCooldowns(cd, 1 / 60);
    expect(canRam(cd, z)).toBe(false);
    tickRamCooldowns(cd, MULTIBALL_RAM_COOLDOWN);
    expect(canRam(cd, z)).toBe(true);
  });

  it("only gates the enemy that was hit", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const cd = new Map<{ id: string }, number>([[a, MULTIBALL_RAM_COOLDOWN]]);
    expect(canRam(cd, a)).toBe(false);
    expect(canRam(cd, b)).toBe(true);
  });

  it("drops expired entries so the map can't grow unbounded over a run", () => {
    const cd = new Map<object, number>();
    for (let i = 0; i < 50; i++) cd.set({ i }, MULTIBALL_RAM_COOLDOWN);
    tickRamCooldowns(cd, MULTIBALL_RAM_COOLDOWN + 0.01);
    expect(cd.size).toBe(0);
  });
});
