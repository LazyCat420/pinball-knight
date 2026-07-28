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
import { buildFlowField } from "./flow-orient";
import { decorateMaze } from "./decorate";
import {
  PARTS_BASE,
  PARTS_PER_LEVEL,
  PARTS_MAX,
  TARGETS_PER_FLOOR,
  TRAPDOORS_PER_FLOOR,
  VAULT_RAMPS_PER_FLOOR,
  HAZARDS_BASE,
  HAZARDS_PER_LEVEL,
  HAZARDS_MAX,
} from "../constants";

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
    // ── A RATE, over a WIDE sweep — not "zero" over a narrow one.
    //
    // This asserted zero violations across 40 floors (5 archetypes x 4 depths x
    // 2 seeds) and was green. Then a change to where the launch chute is sited —
    // which alters no repair pass, only which grid they run on — turned it red
    // with 2 failures, and the obvious reading was "the change broke geometry".
    //
    // Measured instead of assumed, over 300 floors in each regime:
    //
    //     chute siting BEFORE the change ....  5/300 violated  (1.7%)
    //     chute siting AFTER  the change ....  6/300 violated  (2.0%)
    //
    // Indistinguishable. The repair passes have a LATENT ~1.8% failure rate —
    // three distinct kinds (an arc face ~91% backed, a wall box with 3 open
    // neighbours, a chute side wall) — and the 40-floor gate was passing on the
    // luck of its fixed seeds. Any perturbation re-rolls which floors land on
    // it; a different constant produced a different single failure.
    //
    // This codebase has hit exactly this before — see the note in
    // `pickTrackEndpoints` about a defect at 1-in-1200 that "the gate's fixed
    // 48-seed sample misses". So the honest gate is a rate over a sweep big
    // enough to see it, which is strictly MORE coverage than before (150 floors
    // vs 40) and, unlike "zero", cannot be satisfied by luck.
    //
    // The cause turned out to be `removeWallStubs`' round cap stopping the
    // cascade mid-flight — see the block there. Fixed at source, so this is back
    // to asserting ZERO; the sweep stays wide because that is what made the
    // defect visible at all.
    const bad: string[] = [];
    let floors = 0;
    for (let a = 0; a < ARCHETYPES.length; a++) {
      for (const level of [1, 4, 8, 12, 17, 22]) {
        for (let s = 0; s < 5; s++) {
          const seed = 0x77a3 + s * 4093 + level * 211 + a * 7919;
          const { f, arch } = floorAt(level, seed, a);
          if (!f) continue;
          floors++;
          const v = checkPieces(f.grid, f.mask, { phi: buildFlowField(f.grid, f.stairs) });
          if (v.length) bad.push(`L${level} ${arch.id} seed=${seed}:\n${summarise(v)}`);
        }
      }
    }
    // ZERO, not a rate — the cause was found and fixed (see removeWallStubs).
    // The sweep stays widened to 150 floors because the narrow 40-floor version
    // is what let a 1.3% defect sit green in the first place.
    expect(floors, "sweep too small to catch a low-rate defect").toBeGreaterThan(120);
    expect(`${bad.length}/${floors} floors:\n${bad.slice(0, 4).join("\n")}`).toBe(`0/${floors} floors:\n`);
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

describe("the piece gate on a DECORATED floor", () => {
  /** `buildTrackFloor` + `decorateMaze`, i.e. the floor the player is given. */
  function decorated(level: number, seed: number, archIndex?: number) {
    const { f, arch } = floorAt(level, seed, archIndex);
    if (!f) return null;
    const cfg = levelConfig(level);
    // A fresh stream: this test is about the FINISHED floor, not about
    // reproducing core.ts's exact rng consumption (which floor-density covers).
    const rng = mulberry32((seed ^ 0x5bf03635) >>> 0);
    const partBudget = Math.min(PARTS_BASE + (level - 1) * PARTS_PER_LEVEL, PARTS_MAX) + Math.floor(cfg.floorTiles / 2000);
    const plan = decorateMaze(f.grid, rng, 12, 20, partBudget, [], {
      targets: TARGETS_PER_FLOOR,
      trapdoors: TRAPDOORS_PER_FLOOR,
      vaultRamps: VAULT_RAMPS_PER_FLOOR,
      hazards: Math.min(HAZARDS_BASE + (level - 1) * HAZARDS_PER_LEVEL, HAZARDS_MAX),
      launchBreaks: cfg.launchBreaks,
      endpoints: { start: f.start, stairs: f.stairs },
      strictLaunchers: true,
      chute: f.chute ?? null,
      orbit: f.orbit ?? null,
      wallsAuthored: true,
      floor: level,
    });
    return { f, arch, plan };
  }

  it("every piece still obeys its rules after decorateMaze has run", () => {
    // ── WHY A SEPARATE SWEEP FROM THE ONE ABOVE ───────────────────────────
    //
    // That one runs on `buildTrackFloor`'s output, which is not what ships.
    // Two whole classes of piece had never been judged by anything at all:
    //   · every part on the floor — 210-260 of them, against ~50 arc features;
    //   · every wall reshaped by `assignCornerShapes`, the LAST tile mutation
    //     in the pipeline, which runs after the launch break-throughs and the
    //     secret cracks have moved the walls it reads.
    //
    // 30 floors rather than 150: `decorateMaze` is roughly 40x the cost of the
    // geometry pass. The geometry sweep DELIBERATELY stays at 150 — that is
    // where the 1.3%-defect-passing-on-lucky-seeds lesson was learned, and
    // shrinking it to pay for this block would undo it.
    const bad: string[] = [];
    let floors = 0;
    let parts = 0;
    for (let a = 0; a < ARCHETYPES.length; a++) {
      for (const level of [1, 6, 12]) {
        for (let s = 0; s < 2; s++) {
          const seed = 0x31f7 + s * 7717 + level * 313 + a * 4441;
          const d = decorated(level, seed, a);
          if (!d) continue;
          floors++;
          parts += d.plan.parts.length;
          const v = checkPieces(d.f.grid, d.f.mask, {
            phi: buildFlowField(d.f.grid, d.plan.stairs),
            parts: d.plan.parts,
          });
          if (v.length) bad.push(`L${level} ${d.arch.id} seed=${seed}:\n${summarise(v)}`);
        }
      }
    }
    expect(floors, "sweep too small to be worth running").toBeGreaterThan(24);
    expect(parts / floors, "no furniture reached the gate — it would pass vacuously").toBeGreaterThan(50);
    expect(`${bad.length}/${floors} floors:\n${bad.slice(0, 4).join("\n")}`).toBe(`0/${floors} floors:\n`);
  }, 300000);

  it("the furniture rules are actually reachable — a broken part IS caught", () => {
    // A gate nobody has ever seen fire is a gate you cannot trust. Plant one
    // part standing in a wall and one route part firing backwards, and require
    // both to be reported — otherwise "0 violations" above means nothing.
    const d = decorated(6, 0x31f7 + 6 * 313, 0)!;
    expect(d).toBeTruthy();
    const phi = buildFlowField(d.f.grid, d.plan.stairs);
    // A plain one-leg launcher, so reversing `dir` really does reverse the
    // throw — a deflector's `dir` is its ENTRY leg and flipping it would change
    // nothing the gate looks at.
    const onFloor = d.plan.parts.find((p) => p.spine && p.kind === "booster" && Math.abs(p.dirI) + Math.abs(p.dirJ) === 1)!;
    expect(onFloor).toBeTruthy();
    const planted = [
      { ...onFloor, kind: "booster", i: 0, j: 0, dirI: 1, dirJ: 0 },
      { ...onFloor, dirI: -onFloor.dirI, dirJ: -onFloor.dirJ },
    ];
    const v = checkPieces(d.f.grid, d.f.mask, { phi, parts: planted });
    expect(v.some((x) => x.label === "furniture" && x.rule === PIECE_RULES.furniture[0])).toBe(true);
    expect(v.some((x) => x.label === "furniture" && x.rule === PIECE_RULES.furniture[2])).toBe(true);
  });

  it("reports nothing rather than passing silently when handed no content", () => {
    // The `doorways-are-uniform` doctrine: a gate that returns "clean" because
    // it was given nothing to look at reads as coverage and is worse than no
    // gate. Absent phi/parts must mean SKIPPED, not PASSED.
    const d = decorated(6, 0x31f7 + 6 * 313, 0)!;
    const broken = [{ ...d.plan.parts[0], kind: "booster", i: 0, j: 0, dirI: 1, dirJ: 0 }];
    expect(checkPieces(d.f.grid, d.f.mask).some((x) => x.label === "furniture")).toBe(false);
    expect(checkPieces(d.f.grid, d.f.mask, { parts: broken }).some((x) => x.label === "furniture")).toBe(true);
  });
});
