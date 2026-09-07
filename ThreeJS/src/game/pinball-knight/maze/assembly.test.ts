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
  RECOVERY_TAG,
  isRecoveryPort,
  recoveryPortOf,
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

/**
 * A BEND: entered heading east, thrown south. The second leg is what makes it a
 * corner rather than a booster, and every assertion below is really asking "did
 * the second leg travel with the first".
 */
const BEND: Assembly = {
  name: "test-bend",
  w: 2,
  h: 2,
  floor: [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
  parts: [{ ci: 1, cj: 0, kind: "boostcorner", dir: E, dir2: S, role: "turn" }],
  ports: [
    { ci: 0, cj: 0, dir: E, way: "in", tag: "entry" },
    { ci: 1, cj: 1, dir: S, way: "out", tag: "exit" },
  ],
};

describe("two-leg corners", () => {
  it("turns dir2 with dir under rotation", () => {
    // E→S rotated clockwise is S→W. Turning only the first leg would leave a
    // corner that is entered from one side and fires out of the machine.
    const r = rotateAssembly(BEND).parts[0];
    expect(r.dir).toEqual(S);
    expect(r.dir2).toEqual(W);
  });

  it("returns dir2 to the start after four rotations", () => {
    let v = BEND;
    for (let k = 0; k < 4; k++) v = rotateAssembly(v);
    expect(v.parts[0].dir2).toEqual(S);
  });

  it("mirrors dir2 with dir", () => {
    // E→S mirrored is W→S: the entry flips, the descent does not.
    const m = mirrorAssembly(BEND).parts[0];
    expect(m.dir).toEqual(W);
    expect(m.dir2).toEqual(S);
  });

  it("keeps the legs perpendicular through every orientation", () => {
    for (const o of orientationsOf(BEND)) {
      const p = o.parts[0];
      expect(p.dir2).toBeDefined();
      // `+ 0` normalises the signed zero. `(-1)*0 + 0*(-1)` is -0, and
      // `toBe` is Object.is — the exact trap `nz()` exists for, only arising
      // here from the ARITHMETIC rather than from a stored component.
      expect(p.dir.di * p.dir2!.di + p.dir.dj * p.dir2!.dj + 0).toBe(0);
    }
  });

  it("distinguishes an S-bend from its mirror by SIGNATURE", () => {
    // The failure this guards is silent: hash the two the same and every
    // twisty machine quietly loses half its orientation pool, which shows up
    // only as floors that feel repetitive.
    const mirrored = mirrorAssembly(BEND);
    expect(signatureOf(mirrored)).not.toBe(signatureOf(BEND));
  });

  it("does not collapse two bends that differ ONLY in the second leg", () => {
    // Same cell, same entry, opposite exits — genuinely different machines.
    const other: Assembly = { ...BEND, parts: [{ ...BEND.parts[0], dir2: N }] };
    expect(signatureOf(other)).not.toBe(signatureOf(BEND));
  });
});

/**
 * A RIDE WITH A DECLARED LANDING — the recovery contract's fixture.
 *
 * Deliberately asymmetric in both axes (an L footprint, a drive at one end, a
 * capture at the other) so that a rotation which dropped the recovery port, or
 * turned its glyph without turning its travel vector, cannot pass by accident.
 * The recovery port is the one on the leg BELOW the lane: a failed ride does
 * not come back out the way a successful one does, which is the entire reason
 * it needs its own declaration rather than being inferred from the exits.
 */
const RIDE: Assembly = {
  name: "test-ride",
  w: 3,
  h: 2,
  floor: [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
  ],
  parts: [
    { ci: 0, cj: 0, kind: "spring", dir: E, role: "drive", seq: 0 },
    { ci: 2, cj: 0, kind: "maw", dir: W, role: "capture", seq: 1 },
  ],
  ports: [
    { ci: 0, cj: 0, dir: E, way: "in", flow: "ballistic", minSpeed: 10, tag: "mouth" },
    { ci: 2, cj: 0, dir: E, way: "out", flow: "eject", tag: "spit" },
    { ci: 0, cj: 1, dir: S, way: "out", flow: "eject", tag: "recovery" },
  ],
};

describe("the recovery contract", () => {
  it("names the landing with a reserved TAG, not a fifth port way", () => {
    // The choice is load-bearing and it is documented at RECOVERY_TAG. Every
    // consumer of `way` tests it NEGATIVELY (`!== "in"`, `!== "out"`), in three
    // modules, one of which is the router — so a new enum member would be
    // silently included by all of them. This pins the decision so a later
    // "simplification" to `way: "recovery"` fails here first.
    expect(RECOVERY_TAG).toBe("recovery");
    const rec = RIDE.ports.find((p) => p.tag === "recovery")!;
    expect(rec.way, "a recovery port IS an exit — the ball really leaves there").toBe("out");
    expect(rec.flow, "the landing is authored, so momentum is replaced").toBe("eject");
  });

  it("recognises the landing and only the landing", () => {
    expect(recoveryPortOf(RIDE)?.tag).toBe("recovery");
    expect(RIDE.ports.filter(isRecoveryPort)).toHaveLength(1);
    // The `spit` exit is an eject too. If `isRecoveryPort` keyed on flow it
    // would claim both, and `capture-no-release` would then be satisfiable by
    // authoring only the FAILURE path.
    expect(isRecoveryPort(RIDE.ports[1])).toBe(false);
  });

  it("turns the landing's travel vector with the machine, four rotations round", () => {
    // S -> W -> N -> E. A recovery port whose glyph moved and whose vector did
    // not is a landing that points back into the machine it was meant to
    // release the player from.
    let v = RIDE;
    for (const want of [W, N, E, S]) {
      v = rotateAssembly(v);
      const rec = recoveryPortOf(v)!;
      expect(rec, "the landing survived the turn").toBeDefined();
      expect(rec.dir).toEqual(want);
      expect(rec.way).toBe("out");
      expect(rec.flow).toBe("eject");
    }
    expect(signatureOf(v)).toBe(signatureOf(RIDE));
  });

  it("mirrors the landing with everything else", () => {
    const rec = recoveryPortOf(mirrorAssembly(RIDE))!;
    expect(rec.dir).toEqual(S); // S is its own mirror; the CELL is what moves
    expect(rec.ci).toBe(RIDE.w - 1 - 0);
  });

  it("keeps the landing on carved floor through all EIGHT orientations", () => {
    // The strongest transform-agnostic statement available: whatever the
    // rotation algebra does to the cell, the landing must still be a tile the
    // machine actually carves. A landing in rock is not a landing.
    const orients = orientationsOf(RIDE);
    expect(orients.length).toBeGreaterThan(1);
    for (const o of orients) {
      const rec = recoveryPortOf(o);
      expect(rec, `${o.w}x${o.h} orientation lost its landing`).toBeDefined();
      const carved = new Set(o.floor.map(([ci, cj]) => `${ci},${cj}`));
      expect(carved.has(`${rec!.ci},${rec!.cj}`)).toBe(true);
    }
  });

  it("SIGNS the landing — two machines differing only in the recovery tag are two machines", () => {
    // Same cell, same direction, same way, same flow: the ONLY difference is
    // whether that exit is the declared landing or an ordinary spill. Leave the
    // tag out of `signatureOf` and these hash identically, which is the same
    // shape of bug as the `dir2` scar above — a signature that quietly agrees
    // two different machines are one.
    const spill: Assembly = {
      ...RIDE,
      ports: RIDE.ports.map((p) => (p.tag === "recovery" ? { ...p, tag: "spill" } : p)),
    };
    expect(signatureOf(spill)).not.toBe(signatureOf(RIDE));
  });

  it("SIGNS the flow — an eject landing is not a ballistic one", () => {
    const ballistic: Assembly = {
      ...RIDE,
      ports: RIDE.ports.map((p) => (p.tag === "recovery" ? { ...p, flow: "ballistic" as const } : p)),
    };
    expect(signatureOf(ballistic)).not.toBe(signatureOf(RIDE));
  });
});

describe("capture and transfer roles", () => {
  it("carries a capture role through all eight orientations", () => {
    // Roles are rotation-INVARIANT, which is exactly why dropping one would be
    // invisible: no count changes, no direction looks wrong. The machine simply
    // stops being a capture in half its orientations.
    for (const o of orientationsOf(RIDE)) {
      const roles = o.parts.map((p) => p.role).sort();
      expect(roles).toEqual(["capture", "drive"]);
    }
  });

  it("carries a transfer role through all eight orientations", () => {
    const lift: Assembly = {
      ...RIDE,
      parts: RIDE.parts.map((p) => (p.role === "capture" ? { ...p, kind: "magstrip" as const, role: "transfer" as const } : p)),
    };
    for (const o of orientationsOf(lift)) {
      expect(o.parts.map((p) => p.role).sort()).toEqual(["drive", "transfer"]);
    }
  });

  it("SIGNS the role — a capture and a dress on the same cell are two machines", () => {
    // A maw that HOLDS the ball and a maw that is scenery are the same glyph
    // facing the same way. Only the role tells them apart, so only the role in
    // the signature keeps them apart.
    const scenery: Assembly = {
      ...RIDE,
      parts: RIDE.parts.map((p) => (p.role === "capture" ? { ...p, role: "dress" as const } : p)),
    };
    expect(signatureOf(scenery)).not.toBe(signatureOf(RIDE));
  });

  it("SIGNS the role for transfer too", () => {
    const moved: Assembly = {
      ...RIDE,
      parts: RIDE.parts.map((p) => (p.role === "capture" ? { ...p, role: "transfer" as const } : p)),
    };
    expect(signatureOf(moved)).not.toBe(signatureOf(RIDE));
  });

  it("does not change any EXISTING machine's orientation count by signing more fields", () => {
    // The honest limit of the change above. Role, flow and tag are all
    // rotation-invariant, so adding them to the key cannot split one machine's
    // orientations apart — it can only separate two DIFFERENT machines that
    // used to collide. If this drifts, the signature has started keying on
    // something that moves, and the orientation pool is being inflated.
    expect(orientationsOf(LANE)).toHaveLength(4);
    expect(orientationsOf(BEND)).toHaveLength(8);
  });
});
