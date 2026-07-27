import { describe, it, expect } from "vitest";
import {
  N,
  S,
  E,
  W,
  O,
  rotateDir,
  mirrorDir,
  rotateAssembly,
  mirrorAssembly,
  orientationsOf,
  signatureOf,
  portsChain,
  hasExit,
  type Assembly,
} from "./assembly";

/** A deliberately ASYMMETRIC test machine: a two-cell lane whose booster fires
 *  east into a ramp. Asymmetry is the point — a symmetric fixture would pass
 *  even if rotation dropped the facings entirely. */
const LANE: Assembly = {
  name: "test-lane",
  w: 3,
  h: 1,
  floor: [
    [0, 0],
    [1, 0],
    [2, 0],
  ],
  parts: [
    { ci: 0, cj: 0, kind: "booster", dir: E, role: "drive", seq: 0 },
    { ci: 1, cj: 0, kind: "ramp", dir: E, role: "drive", seq: 1 },
  ],
  ports: [
    { ci: 0, cj: 0, dir: E, way: "in", tag: "entry" },
    { ci: 2, cj: 0, dir: E, way: "out", tag: "exit" },
  ],
};

describe("direction algebra", () => {
  it("rotates cardinals clockwise in grid space", () => {
    // +i is right, +j is DOWN, so clockwise on screen is E -> S -> W -> N.
    expect(rotateDir(E)).toEqual(S);
    expect(rotateDir(S)).toEqual(W);
    expect(rotateDir(W)).toEqual(N);
    expect(rotateDir(N)).toEqual(E);
  });

  it("returns to the start after four rotations", () => {
    for (const d of [N, S, E, W]) {
      expect(rotateDir(rotateDir(rotateDir(rotateDir(d))))).toEqual(d);
    }
  });

  it("leaves the null direction alone under both ops", () => {
    // Omnidirectional parts (bumpers, oil) must not acquire a facing by being
    // rotated — a bumper that suddenly "fires north" would be read as a
    // launch part by the duel breaker.
    expect(rotateDir(O)).toEqual(O);
    expect(mirrorDir(O)).toEqual(O);
  });

  it("mirrors east<->west and leaves north/south alone", () => {
    expect(mirrorDir(E)).toEqual(W);
    expect(mirrorDir(W)).toEqual(E);
    expect(mirrorDir(N)).toEqual(N);
    expect(mirrorDir(S)).toEqual(S);
  });
});

describe("rotateAssembly", () => {
  it("turns the footprint and the facings together", () => {
    const r = rotateAssembly(LANE);
    // A 3x1 lane becomes 1x3.
    expect(r.w).toBe(1);
    expect(r.h).toBe(3);
    // Every part that fired EAST must now fire SOUTH. This is the assertion
    // the whole module exists for: glyphs and vectors turn as one.
    for (const p of r.parts) expect(p.dir).toEqual(S);
  });

  it("keeps parts on carved floor after rotation", () => {
    const r = rotateAssembly(LANE);
    const carved = new Set(r.floor.map(([ci, cj]) => `${ci},${cj}`));
    for (const p of r.parts) expect(carved.has(`${p.ci},${p.cj}`)).toBe(true);
  });

  it("preserves part order and count", () => {
    const r = rotateAssembly(LANE);
    expect(r.parts.map((p) => p.seq)).toEqual([0, 1]);
    expect(r.parts.map((p) => p.kind)).toEqual(["booster", "ramp"]);
  });

  it("is the identity after four turns", () => {
    let v = LANE;
    for (let i = 0; i < 4; i++) v = rotateAssembly(v);
    expect(signatureOf(v)).toBe(signatureOf(LANE));
  });

  it("maps cells without collision (no two parts land on one cell)", () => {
    const r = rotateAssembly(LANE);
    const seen = new Set(r.parts.map((p) => `${p.ci},${p.cj}`));
    expect(seen.size).toBe(r.parts.length);
  });

  it("keeps every cell inside the rotated footprint", () => {
    let v: Assembly = LANE;
    for (let i = 0; i < 4; i++) {
      v = rotateAssembly(v);
      for (const [ci, cj] of v.floor) {
        expect(ci).toBeGreaterThanOrEqual(0);
        expect(cj).toBeGreaterThanOrEqual(0);
        expect(ci).toBeLessThan(v.w);
        expect(cj).toBeLessThan(v.h);
      }
      for (const p of v.parts) {
        expect(p.ci).toBeGreaterThanOrEqual(0);
        expect(p.cj).toBeGreaterThanOrEqual(0);
        expect(p.ci).toBeLessThan(v.w);
        expect(p.cj).toBeLessThan(v.h);
      }
    }
  });
});

describe("mirrorAssembly", () => {
  it("flips facings east<->west", () => {
    const m = mirrorAssembly(LANE);
    for (const p of m.parts) expect(p.dir).toEqual(W);
  });

  it("is its own inverse", () => {
    expect(signatureOf(mirrorAssembly(mirrorAssembly(LANE)))).toBe(signatureOf(LANE));
  });

  it("keeps parts on carved floor", () => {
    const m = mirrorAssembly(LANE);
    const carved = new Set(m.floor.map(([ci, cj]) => `${ci},${cj}`));
    for (const p of m.parts) expect(carved.has(`${p.ci},${p.cj}`)).toBe(true);
  });
});

describe("orientationsOf", () => {
  it("yields only 4 orientations for a 1-D lane — its mirror IS a rotation", () => {
    // Not a shortfall: a shape lying along a single axis has no handedness, so
    // flipping a horizontal lane left<->right lands on the same thing as
    // turning it 180 degrees. Expecting 8 here (as a first draft of this test
    // did) asserts a symmetry the shape does not have. 8 requires a genuinely
    // 2-D asymmetric footprint — see the L-shape below.
    expect(orientationsOf(LANE)).toHaveLength(4);
  });

  it("yields 8 for a 2-D shape that HAS a handedness", () => {
    // An L: two cells along the top, one hanging below the left. Its mirror
    // cannot be reached by any rotation, so all 8 are distinct.
    const ell: Assembly = {
      name: "ell",
      w: 2,
      h: 2,
      floor: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
      parts: [{ ci: 0, cj: 0, kind: "booster", dir: E, role: "drive" }],
      ports: [{ ci: 1, cj: 0, dir: E, way: "out" }],
    };
    expect(orientationsOf(ell)).toHaveLength(8);
  });

  it("de-dupes orientations that are genuinely identical", () => {
    // A single omnidirectional part on a 1x1 footprint is the same machine
    // however it is turned.
    const dot: Assembly = {
      name: "dot",
      w: 1,
      h: 1,
      floor: [[0, 0]],
      parts: [{ ci: 0, cj: 0, kind: "bumper", dir: O, role: "rebound" }],
      ports: [],
    };
    expect(orientationsOf(dot)).toHaveLength(1);
  });

  it("does NOT collapse orientations that differ only by facing", () => {
    // Same footprint, same cell, opposite facings: two real machines. Keying
    // the de-dupe on the carved shape alone (as the prefab-level variantsOf
    // does) would wrongly fold these into one.
    const arrow: Assembly = {
      name: "arrow",
      w: 1,
      h: 1,
      floor: [[0, 0]],
      parts: [{ ci: 0, cj: 0, kind: "booster", dir: E, role: "drive" }],
      ports: [],
    };
    const orients = orientationsOf(arrow);
    expect(orients).toHaveLength(4);
    const dirs = orients.map((o) => `${o.parts[0].dir.di},${o.parts[0].dir.dj}`).sort();
    expect(new Set(dirs).size).toBe(4);
  });
});

describe("portsChain", () => {
  const out = (dir: typeof E) => ({ ci: 0, cj: 0, dir, way: "out" as const });
  const inp = (dir: typeof E) => ({ ci: 0, cj: 0, dir, way: "in" as const });

  it("chains an exit into an entrance travelling the same way", () => {
    expect(portsChain(out(E), inp(E))).toBe(true);
  });

  it("refuses OPPOSED ports — that is a launch duel, not a chain", () => {
    // Two machines firing into each other is the unrecoverable ping-pong the
    // runtime spends real effort breaking. Never author it.
    expect(portsChain(out(E), inp(W))).toBe(false);
  });

  it("refuses a perpendicular hand-off", () => {
    expect(portsChain(out(E), inp(N))).toBe(false);
  });

  it("refuses to emit from an entrance or arrive at an exit", () => {
    expect(portsChain(inp(E), inp(E))).toBe(false);
    expect(portsChain(out(E), out(E))).toBe(false);
  });

  it("lets a `both` port act as either end", () => {
    const both = { ci: 0, cj: 0, dir: E, way: "both" as const };
    expect(portsChain(both, inp(E))).toBe(true);
    expect(portsChain(out(E), both)).toBe(true);
  });

  it("refuses an IMPACT port at either end", () => {
    // A bumper/slingshot rebounds unpredictably by design. Chaining through one
    // is a coincidence, not a route — and authoring it is how a table ends up
    // with shots that only work sometimes.
    const bang = { ci: 0, cj: 0, dir: E, way: "out" as const, flow: "impact" as const };
    const catcher = { ci: 0, cj: 0, dir: E, way: "in" as const, flow: "impact" as const };
    expect(portsChain(bang, inp(E))).toBe(false);
    expect(portsChain(out(E), catcher)).toBe(false);
  });

  it("chains through eject and ballistic ports", () => {
    const scoop = { ci: 0, cj: 0, dir: E, way: "out" as const, flow: "eject" as const };
    const ramp = { ci: 0, cj: 0, dir: E, way: "in" as const, flow: "ballistic" as const };
    expect(portsChain(scoop, ramp)).toBe(true);
  });
});

describe("hasExit", () => {
  it("is true for a machine with an out port", () => {
    expect(hasExit(LANE)).toBe(true);
  });

  it("is false for a terminus", () => {
    const scoop: Assembly = {
      name: "scoop",
      w: 1,
      h: 1,
      floor: [[0, 0]],
      parts: [],
      ports: [{ ci: 0, cj: 0, dir: E, way: "in" }],
    };
    expect(hasExit(scoop)).toBe(false);
  });
});
