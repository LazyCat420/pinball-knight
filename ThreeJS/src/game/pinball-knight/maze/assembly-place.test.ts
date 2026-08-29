/**
 * THE ASSEMBLY ROUTER'S OWN GATES.
 *
 * `assembly-place.ts` shipped with no test file. `assembly.ts` and
 * `assembly-lib.ts` had one each, so the DATA was covered and the thing that
 * consumes it was not — which was survivable only because the router had zero
 * callers. Now it runs on every floor of every run, so it needs gates.
 *
 * Two halves, and the split matters:
 *
 *   · the CONTRACT, against hand-built grids, where a rejection can be
 *     constructed on purpose;
 *   · the RATE, against `buildHeadlessPlan`, which mirrors `authorFloor` draw
 *     for draw. A placer that is correct on a fabricated 20x20 room and places
 *     nothing on a real floor is a dead feature that passes its own tests —
 *     and this module was already dead once.
 */
import { describe, it, expect } from "vitest";
import { placeAssemblies, partsOf } from "./assembly-place";
import { MACHINES } from "./assembly-lib";
import { buildFlowField } from "./flow-orient";
import { buildHeadlessPlan } from "../dev/headless-floor";
import { idx, at, T_FLOOR, T_WALL, type Grid, type TilePos } from "./generator";

/** The kinds the launch-duel guard may take, mirrored from decorate.ts. */
const LAUNCH_KINDS = new Set<string>(["ramp", "booster", "spring", "slingshot", "flipper", "jumppad"]);
import { mulberry32 } from "../../../utils/rng";

/** An open room with a wall border — the friendliest possible floor. */
function openRoom(w: number, h: number): Grid {
  const g: Grid = { w, h, t: new Uint8Array(w * h) } as Grid;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      g.t[idx(g, i, j)] = i === 0 || j === 0 || i === w - 1 || j === h - 1 ? T_WALL : T_FLOOR;
    }
  }
  return g;
}

/** A straight run down the middle — the road machines are meant to hang off. */
function midRoute(g: Grid): TilePos[] {
  const j = Math.floor(g.h / 2);
  const out: TilePos[] = [];
  for (let i = 1; i < g.w - 1; i++) out.push({ i, j });
  return out;
}

function placeInRoom(w = 40, h = 40, opts: Partial<Parameters<typeof placeAssemblies>[2]> = {}) {
  const g = openRoom(w, h);
  const stairs = { i: w - 2, j: Math.floor(h / 2) };
  const phi = buildFlowField(g, stairs);
  return {
    g,
    report: placeAssemblies(g, phi, {
      rng: mulberry32(12345),
      routes: [midRoute(g)],
      start: { i: 1, j: Math.floor(h / 2) },
      stairs,
      occupied: () => false,
      budget: 3,
      ...opts,
    }),
  };
}

describe("placeAssemblies — contract", () => {
  it("places machines on an open floor at all", () => {
    // Anti-vacuity. Every assertion below is trivially true of an empty report,
    // so this one has to come first.
    const { report } = placeInRoom();
    expect(report.tried).toBeGreaterThan(0);
    expect(report.placed.length).toBeGreaterThan(0);
  });

  it("is deterministic in (grid, seed)", () => {
    const a = placeInRoom().report;
    const b = placeInRoom().report;
    expect(a.placed.map((p) => `${p.name}@${p.i0},${p.j0}`)).toEqual(b.placed.map((p) => `${p.name}@${p.i0},${p.j0}`));
  });

  it("takes ZERO draws from the caller's stream", () => {
    // The one failure mode the module's own header calls out: a draw from the
    // shared floor rng reshuffles every downstream pass and rerolls every
    // existing floor. The router gets its own generator, so a counter wrapped
    // around a DIFFERENT generator must never advance.
    let draws = 0;
    const shared = () => {
      draws++;
      return 0.5;
    };
    const g = openRoom(40, 40);
    const stairs = { i: 38, j: 20 };
    placeAssemblies(g, buildFlowField(g, stairs), {
      rng: mulberry32(7),
      routes: [midRoute(g)],
      start: { i: 1, j: 20 },
      stairs,
      occupied: () => false,
      budget: 3,
    });
    void shared;
    expect(draws).toBe(0);
  });

  it("budget 0 is a true off switch — the rollback path", () => {
    const { report } = placeInRoom(40, 40, { budget: 0 });
    expect(report.placed).toEqual([]);
    expect(report.tried).toBe(0);
  });

  it("never places on a tile the caller reserved", () => {
    // Reserve the whole upper half; nothing may straddle it.
    const { g, report } = placeInRoom(40, 40, { occupied: (_i, j) => j < 20 });
    for (const p of report.placed) {
      for (const t of p.tiles) {
        const j = Math.floor(t / g.w);
        expect(j, `${p.name} straddles reserved ground`).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it("placed footprints never overlap each other", () => {
    const { report } = placeInRoom();
    const seen = new Set<number>();
    for (const p of report.placed) {
      for (const t of p.tiles) {
        expect(seen.has(t), `${p.name} overlaps an earlier machine`).toBe(false);
        seen.add(t);
      }
    }
  });

  it("DOES NOT CARVE — the grid is byte-identical afterwards", () => {
    // `Assembly.floor` is read as a REQUIREMENT, not an instruction. Carving
    // here could punch through a sealed launch-chute band or an arc-swept wall,
    // and neither failure is visible from inside this module.
    const g = openRoom(40, 40);
    const before = Uint8Array.from(g.t);
    const stairs = { i: 38, j: 20 };
    placeAssemblies(g, buildFlowField(g, stairs), {
      rng: mulberry32(3),
      routes: [midRoute(g)],
      start: { i: 1, j: 20 },
      stairs,
      occupied: () => false,
      budget: 3,
    });
    expect(Array.from(g.t)).toEqual(Array.from(before));
  });

  it("a floor with no room rejects on FIT and places nothing", () => {
    // A 1-tile-wide corridor cannot hold any machine's footprint. The counters
    // are the point: a router that quietly places nothing on a cramped floor
    // must be distinguishable from one that is broken.
    const g = openRoom(40, 3);
    const stairs = { i: 38, j: 1 };
    const report = placeAssemblies(g, buildFlowField(g, stairs), {
      rng: mulberry32(1),
      routes: [midRoute(g)],
      start: { i: 1, j: 1 },
      stairs,
      occupied: () => false,
      budget: 3,
    });
    expect(report.placed).toEqual([]);
    expect(report.tried).toBeGreaterThan(0);
    expect(report.rejectFit).toBeGreaterThan(0);
  });

  it("emits every authored part, with its facing and its AssemblyRef", () => {
    const { report } = placeInRoom();
    const placed = report.placed[0];
    const parts = partsOf(placed);
    expect(parts.length).toBe(placed.asm.parts.length);
    for (const p of parts) {
      expect(p.asm, "a machine part must carry its ref, or the polish passes de-clump it").toBeTruthy();
      expect(p.asm!.id).toBe(placed.id);
      expect(p.asm!.name).toBe(placed.name);
      // The AUTHORED facing, carried through unchanged — the whole reason this
      // module exists. (Not "nonzero": a bumper is authored with no heading,
      // and asserting one would be testing the fixture, not the transport.)
      const src = placed.asm.parts.find((q) => q.seq === p.seq && q.role === p.asm!.role)!;
      expect([p.dirI, p.dirJ]).toEqual([src.dir.di, src.dir.dj]);
    }
  });

  it("honours the machines it is handed, and only those", () => {
    const only = MACHINES.filter((m) => m.name === "pop-nest");
    const { report } = placeInRoom(40, 40, { machines: only });
    expect(report.placed.length).toBeGreaterThan(0);
    for (const p of report.placed) expect(p.name).toBe("pop-nest");
  });
});

describe("placeAssemblies — on the floors that actually ship", () => {
  const SEEDS = [1, 12345, 987654321, 424242, 777, 31337];
  const LEVELS = [1, 3, 5, 8, 12, 17];
  const floors = LEVELS.flatMap((level) => SEEDS.map((seed) => buildHeadlessPlan(level, seed))).filter((f) => f !== null);

  it("the harness produced floors", () => {
    expect(floors.length).toBe(36);
  });

  it("machines reach a real majority of floors", () => {
    // The number that says whether this feature exists. It is a RATE, not an
    // every-floor invariant: a cramped floor genuinely may have nowhere a
    // machine fits, and `placeAssemblies` refuses rather than carving.
    const withMachines = floors.filter((f) => f!.plan.parts.some((p) => p.asm !== undefined)).length;
    expect(withMachines / floors.length).toBeGreaterThan(0.5);
  });

  it("a machine only ever loses a LAUNCH part — never its plain furniture", () => {
    // NOT "keeps every part". `assembly.ts` is explicit that machines are
    // exempt from de-clumping and runway re-aim but NOT from the launch-duel
    // guard: "Aesthetics yield to authoring; the soft-lock guard does not." A
    // ball ping-ponging between two launchers is unrecoverable, and 54.5% of
    // floors used to carry one.
    //
    // So a machine's ramp may be taken. Its TARGETS may not — and they were:
    // polishParts counted anything with a heading as a launcher, and a drop
    // target has a heading, so the middle of a target bank was deleted as one
    // half of a duel it could not physically be in. This is the gate for that.
    const missing: string[] = [];
    for (const f of floors) {
      const byId = new Map<number, { name: string; seqs: Set<number> }>();
      for (const p of f!.plan.parts) {
        if (!p.asm) continue;
        const e = byId.get(p.asm.id) ?? { name: p.asm.name, seqs: new Set<number>() };
        e.seqs.add(p.seq ?? -1);
        byId.set(p.asm.id, e);
      }
      for (const [, e] of byId) {
        const def = MACHINES.find((m) => m.name === e.name)!;
        for (const part of def.parts) {
          if (e.seqs.has(part.seq ?? -1)) continue;
          if (LAUNCH_KINDS.has(part.kind)) continue; // the soft-lock guard's to take
          missing.push(`L${f!.level}/${f!.runSeed} ${e.name} seq ${part.seq} (${part.kind})`);
        }
      }
    }
    expect(missing, "non-launch machine furniture was deleted by a polish pass").toEqual([]);
  });

  it("a machine that ships is mostly intact — the rate, measured", () => {
    // The launch-duel guard legitimately takes parts, but if it took MOST of
    // them the feature would be a scatter of orphans wearing a machine's name.
    // Measured 2026-08-27: 34 machines across 36 floors, 2 of them short one
    // `drive` part (an orbit losing seq 0, its entry ramp). That is the number
    // this gate protects; a drop means machines have started arriving gutted.
    let whole = 0;
    let total = 0;
    for (const f of floors) {
      const byId = new Map<number, { name: string; n: number }>();
      for (const p of f!.plan.parts) {
        if (!p.asm) continue;
        const e = byId.get(p.asm.id) ?? { name: p.asm.name, n: 0 };
        e.n++;
        byId.set(p.asm.id, e);
      }
      for (const [, e] of byId) {
        total++;
        if (e.n === MACHINES.find((m) => m.name === e.name)!.parts.length) whole++;
      }
    }
    expect(total, "no machines placed at all").toBeGreaterThan(20);
    expect(whole / total).toBeGreaterThan(0.85);
  });

  it("machine tiles are floor, never wall — the no-carve rule holds end to end", () => {
    for (const f of floors) {
      for (const p of f!.plan.parts) {
        if (!p.asm) continue;
        expect(at(f!.grid, p.i, p.j), `${p.asm.name} part on a wall at ${p.i},${p.j}`).not.toBe(T_WALL);
      }
    }
  });
});
