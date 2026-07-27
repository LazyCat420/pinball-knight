/**
 * THE PIECE GATE — every renderable piece on every generated floor obeys the
 * rules stated for its label in `piece-rules.ts`.
 *
 * This is the test the arc work needed and did not have. The floor gate
 * (`floor-metrics.test.ts`) judges the floor as a WHOLE — reachability, path
 * length, dead-end density — and a floor can pass all of it while being covered
 * in curved wall bands standing in open air, because none of those metrics
 * looks at a piece's own preconditions.
 */
import { describe, it, expect } from "vitest";
import { mulberry32 } from "./generator";
import { buildTrackFloor } from "./track-floor";
import { ARCHETYPES, archetypeFor, windinessFor } from "./archetypes";
import { levelConfig } from "../constants";
import { checkPieces, summarise, pieceCensus, PIECE_RULES } from "./piece-rules";
import { findArcJunctions, backedFraction, trimArcToBacking, junctionCheck } from "./arc-contract";

function floorAt(level: number, seed: number, archIndex?: number) {
  const cfg = levelConfig(level);
  const arch = archIndex === undefined ? archetypeFor(level) : ARCHETYPES[archIndex];
  const rng = mulberry32((seed ^ (level * 0x9e3779b9)) >>> 0);
  const windiness = windinessFor(level, arch, rng);
  return {
    arch,
    f: buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
      profile: arch.track,
      density: Math.max(0.35, Math.min(0.85, windiness)),
    }),
  };
}

describe("the piece registry", () => {
  it("states a rule for every label", () => {
    for (const [label, rules] of Object.entries(PIECE_RULES)) {
      expect(rules.length, `${label} has no rules`).toBeGreaterThan(0);
    }
  });

  it("every curved wall on a live floor has stone behind it", () => {
    // THE headline rule, and the one the screenshots were failing. Kept as its
    // own test with its own message because "38% of features were unbacked" is
    // the finding, and a regression here is invisible in every other gate.
    const bad: string[] = [];
    let features = 0;
    for (let level = 1; level <= 10; level++) {
      for (let s = 0; s < 3; s++) {
        const seed = 0x51a7 + s * 7919 + level * 131;
        const { f, arch } = floorAt(level, seed);
        if (!f) continue;
        for (const a of f.grid.arcs ?? []) {
          features++;
          const b = backedFraction(f.grid, a);
          if (b < 0.999) {
            bad.push(
              `L${level} ${arch.id} seed=${seed}: arc at (${a.cx.toFixed(1)},${a.cz.toFixed(1)}) r=${a.r} is only ${(b * 100).toFixed(0)}% backed`,
            );
          }
        }
      }
    }
    expect(features).toBeGreaterThan(100); // the test must actually be looking at something
    expect(bad.slice(0, 8).join("\n")).toBe("");
  });

  it("no two curved walls meet at a kink, step or curvature flip", () => {
    const bad: string[] = [];
    for (let level = 1; level <= 10; level++) {
      for (let s = 0; s < 3; s++) {
        const seed = 0x2f11 + s * 6151 + level * 97;
        const { f, arch } = floorAt(level, seed);
        if (!f) continue;
        for (const jn of findArcJunctions(f.grid, true)) {
          bad.push(
            `L${level} ${arch.id} seed=${seed}: ${jn.check.reason} at (${jn.i},${jn.j}) — kink ${((jn.check.kink * 180) / Math.PI).toFixed(0)}°, step ${jn.check.step.toFixed(2)}`,
          );
        }
      }
    }
    expect(bad.slice(0, 8).join("\n")).toBe("");
  });

  it("every piece on every archetype at every depth obeys its rules", () => {
    const bad: string[] = [];
    for (let a = 0; a < ARCHETYPES.length; a++) {
      for (const level of [1, 4, 8, 12]) {
        for (let s = 0; s < 2; s++) {
          const seed = 0x77a3 + s * 4093 + level * 211;
          const { f, arch } = floorAt(level, seed, a);
          if (!f) continue;
          const v = checkPieces(f.grid, f.mask);
          if (v.length) bad.push(`L${level} ${arch.id} seed=${seed}:\n${summarise(v)}`);
        }
      }
    }
    expect(bad.slice(0, 4).join("\n")).toBe("");
  });

  it("a floor is actually made of the pieces the registry names", () => {
    // Guards against the registry quietly going stale — if a generator change
    // stops producing a whole piece kind, that is worth noticing.
    const { f } = floorAt(4, 0x51a7);
    expect(f).toBeTruthy();
    const c = pieceCensus(f!.grid, f!.mask);
    expect(c["wall-box"] ?? 0).toBeGreaterThan(0);
    expect(c["floor-room"] ?? 0).toBeGreaterThan(0);
    expect(c["floor-road"] ?? 0).toBeGreaterThan(0);
    expect(c["floor-sealed"] ?? 0).toBeGreaterThan(0); // the launch chute
    expect(c["arc-face(features)"] ?? 0).toBeGreaterThan(0);
  });
});

describe("the arc contract itself", () => {
  it("scores a clean tangent continuation as coherent and a right angle as a kink", () => {
    // Two arcs on the SAME circle, meeting end to end: the textbook good join.
    const a = { cx: 10, cz: 10, r: 3, a0: 0, span: Math.PI / 2 };
    const b = { cx: 10, cz: 10, r: 3, a0: Math.PI / 2, span: Math.PI / 2 };
    const p = { x: 10, z: 13 }; // on the circle, at the shared end
    expect(junctionCheck(a, b, p.x, p.z).ok).toBe(true);

    // Same radius, centre moved so the tangents disagree by ~90°.
    const c = { cx: 13, cz: 13, r: 3, a0: 0, span: Math.PI / 2 };
    const bad = junctionCheck(a, c, 10, 13);
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("kink");
  });

  it("calls a convex face meeting a concave one a FLIP, whatever the tangents do", () => {
    const a = { cx: 10, cz: 10, r: 3, a0: 0, span: Math.PI / 2 };
    const b = { cx: 10, cz: 10, r: 3, a0: 0, span: Math.PI / 2, solidOut: true };
    expect(junctionCheck(a, b, 10, 13).reason).toBe("flip");
  });

  it("trims an arc to its backed run rather than rejecting the whole curve", () => {
    // Solid rock with the TOP half carved open. An arc centred on the boundary
    // and spanning from -90° (up) to +90° (down) therefore has its upper half
    // unbacked and its lower half backed — exactly the "runs off the end of its
    // wall" case that produced the floating ribbons.
    const w = 24;
    const h = 24;
    const g = {
      w,
      h,
      t: new Uint8Array(w * h), // all zeros = T_WALL
      shapes: new Uint8Array(w * h),
      arcs: [] as unknown[],
      arcIdx: new Int16Array(w * h).fill(-1),
    } as never as import("./generator").Grid;
    // Open the whole top half → the arc's upper span loses its backing.
    for (let j = 0; j < 12; j++) for (let i = 0; i < w; i++) g.t[j * w + i] = 1; // T_FLOOR
    const full = { cx: 12, cz: 12, r: 4, a0: -Math.PI / 2, span: Math.PI, owner: "sweep" as const };
    const trimmed = trimArcToBacking(g, full);
    expect(trimmed).toBeTruthy();
    expect(trimmed!.span).toBeLessThan(full.span); // it lost the unbacked part
    expect(backedFraction(g, trimmed!)).toBeGreaterThan(0.99);
  });

  it("clips a feature's rubber and rails when the feature itself is trimmed", () => {
    // The regression this exists for: trimming the wall without trimming its
    // bands leaves rubber curving through open air past the end of the stone.
    const w = 24;
    const h = 24;
    const g = {
      w,
      h,
      t: new Uint8Array(w * h), // all zeros = T_WALL
      shapes: new Uint8Array(w * h),
      arcs: [] as unknown[],
      arcIdx: new Int16Array(w * h).fill(-1),
    } as never as import("./generator").Grid;
    for (let j = 0; j < 12; j++) for (let i = 0; i < w; i++) g.t[j * w + i] = 1; // T_FLOOR
    const f = {
      cx: 12,
      cz: 12,
      r: 4,
      a0: -Math.PI / 2,
      span: Math.PI,
      owner: "sweep" as const,
      kicks: [{ a0: -Math.PI / 2 + 0.05, span: Math.PI - 0.1, cooldownT: 0, hitT: -1 }],
    };
    const t = trimArcToBacking(g, f);
    expect(t).toBeTruthy();
    for (const b of t!.kicks ?? []) {
      expect(b.a0).toBeGreaterThanOrEqual(t!.a0 - 1e-6);
      expect(b.a0 + b.span).toBeLessThanOrEqual(t!.a0 + t!.span + 1e-6);
    }
  });
});
