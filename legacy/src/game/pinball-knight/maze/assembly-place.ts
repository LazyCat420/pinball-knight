/**
 * THE ASSEMBLY ROUTER — the pass `maze/assembly.ts` was written for.
 *
 * That module's header names this file ("the router in `assembly-place.ts` is
 * what matches them up") and it never existed, so the whole machine library sat
 * dead: eight authored pinball mechanisms, fully tested, that no floor had ever
 * carried. This is the consumer.
 *
 * ── What it does, and the one thing it refuses to do ───────────────────────
 *
 * It finds places on an ALREADY-CARVED floor where a machine's footprint fits,
 * picks the orientation whose entrance faces the traffic, and emits the
 * machine's parts with their AUTHORED facings intact. That last clause is the
 * whole point. Every other part-placing pass in `decorate.ts` derives facing
 * from local corridor topology at consume time, which is why "a chain was a
 * coincidence, not a guarantee" — two parts side by side had no relationship.
 * A machine's parts point at each other because someone said so.
 *
 * It does NOT CARVE. `Assembly.floor` is read as a REQUIREMENT ("these cells
 * must already be walkable"), not as an instruction. On the shipping track
 * branch carving is a trap: a footprint punched through a wall can eat a sealed
 * launch-chute band (`track-socket.nearSealed`) or an arc-swept wall the
 * renderer reads out of `g.arcIdx`, and neither failure is visible from here.
 * Reading the shape as a requirement keeps the "every floor tile reachable"
 * invariant true by construction rather than by a check that has to be re-run.
 * The cost is placement rate, and placement rate is measured (`PlaceReport`)
 * rather than assumed.
 *
 * ── Cell space (the trap that eats an afternoon) ───────────────────────────
 *
 * Assemblies are authored in CELLS, the half-scale space prefabs use, where one
 * cell is 2×2 tiles after `thickenWalls`. The branch that SHIPS —
 * `buildTrackFloor` — generates at final tile resolution and never thickens, so
 * "cell" has no native meaning there. `CELL` is therefore an explicit scale
 * applied here, not a coordinate system inherited from the grid, and a machine
 * occupies `w*CELL × h*CELL` TILES.
 *
 * DOM- and three-free, and it takes no draws from the shared floor rng — see
 * `placeAssemblies`' `rng` option.
 */
import { type Grid, type TilePos, at, idx, T_FLOOR, T_STAIRS } from "./generator";
import { flowDrop, openRunway, phiAt, UNREACHED } from "./flow-orient";
import { orientationsOf, type Assembly, type AssemblyPart, type AssemblyPort, type AssemblyRef } from "./assembly";
import { MACHINES } from "./assembly-lib";
import type { PinballPartSpot } from "./decorate";

/**
 * Tiles per authored cell.
 *
 * 2 keeps machines at the size the library was authored for — an `orbit` is
 * 4×3 cells, so 8×6 tiles, a genuine set piece rather than four pads in a
 * huddle. At 1 the same machine is 4×3 tiles, which at this game's scale puts
 * an orbit's two lanes close enough together that the return leg is inside the
 * outbound leg's collision radius: not an orbit, a smear.
 */
const CELL = 2;

/** Open floor a machine's exit needs, or it is a launcher firing into rock the
 *  moment the piece gate next runs. Matches decorate's MIN_RUNWAY and
 *  flow-loops' MIN_RUN — the same physical claim, stated once per module
 *  because each is private to its own. */
const MIN_RUNWAY = 3;

/** A placed machine, and everything the caller needs to reserve and score it. */
export interface PlacedAssembly {
  id: number;
  name: string;
  /** Top-left TILE of the footprint. */
  i0: number;
  j0: number;
  /** The oriented definition actually used — not the library entry. */
  asm: Assembly;
  /** Every tile the footprint covers, as `idx(g, i, j)`. */
  tiles: Set<number>;
  ports: PlacedPort[];
}

/** A port resolved to floor tiles. `dir` is the ball's TRAVEL vector, as in the
 *  definition — never the outward normal. Confusing the two is how a router
 *  connects machines back-to-front. */
export interface PlacedPort {
  i: number;
  j: number;
  di: number;
  dj: number;
  way: AssemblyPort["way"];
  flow: NonNullable<AssemblyPort["flow"]>;
  minSpeed: number;
  tag?: string;
}

/**
 * Why placement declined, counted.
 *
 * A router that quietly places nothing looks identical to a router that is
 * working on floors with no room — and the fix is completely different. These
 * counters are what tell the two apart without a debugger, and they are the
 * reason `CELL` can be tuned from evidence instead of from taste.
 */
export interface PlaceReport {
  placed: PlacedAssembly[];
  tried: number;
  /** Footprint ran off the grid, hit wall, or overlapped something taken. */
  rejectFit: number;
  /** Fit, but the entrance had no run-up — `wantsRunway` unsatisfied. */
  rejectApproach: number;
  /** Fit, but an exit fired into rock inside MIN_RUNWAY. */
  rejectExit: number;
  /** Fit, but the footprint sat on unreachable floor. */
  rejectUnreached: number;
}

export interface PlaceOpts {
  /**
   * The router's OWN stream. It must not be the shared floor rng: a new draw
   * from that reshuffles every downstream pass and rerolls every existing
   * floor. Derive it from a seed the caller already holds, as
   * `surface-paint.ts` does.
   */
  rng: () => number;
  machines?: readonly Assembly[];
  /** Routes to seed sites along, primary artery first. */
  routes: ReadonlyArray<ReadonlyArray<TilePos>>;
  start: TilePos;
  stairs: TilePos;
  /** Tiles already spoken for — parts, rooms, the launch chute. */
  occupied: (i: number, j: number) => boolean;
  /** Maximum machines to place. */
  budget: number;
  /** Tiles between candidate origins along a route. */
  stride?: number;
}

function open(g: Grid, i: number, j: number): boolean {
  const t = at(g, i, j);
  return t === T_FLOOR || t === T_STAIRS;
}

/** The tile a cell-space coordinate lands on, given a footprint origin. */
function tileOf(i0: number, j0: number, ci: number, cj: number): TilePos {
  return { i: i0 + ci * CELL, j: j0 + cj * CELL };
}

/**
 * Does this oriented machine fit with its top-left at (i0, j0)?
 *
 * Every carved cell must be walkable across its whole CELL×CELL tile block, not
 * merely at its top-left corner. Checking one tile per cell would accept a
 * machine half-buried in wall — the parts would land on floor and the lanes
 * between them would not, giving a machine whose pieces are individually valid
 * and collectively unreachable.
 */
function fits(g: Grid, a: Assembly, i0: number, j0: number, occupied: (i: number, j: number) => boolean): boolean {
  for (const [ci, cj] of a.floor) {
    const t = tileOf(i0, j0, ci, cj);
    for (let dj = 0; dj < CELL; dj++) {
      for (let di = 0; di < CELL; di++) {
        const i = t.i + di;
        const j = t.j + dj;
        if (!open(g, i, j)) return false;
        if (occupied(i, j)) return false;
      }
    }
  }
  return true;
}

/** Resolve a machine's ports to tiles, once placement is decided. */
function placePorts(a: Assembly, i0: number, j0: number): PlacedPort[] {
  return a.ports.map((p) => {
    const t = tileOf(i0, j0, p.ci, p.cj);
    return {
      i: t.i,
      j: t.j,
      di: p.dir.di,
      dj: p.dir.dj,
      way: p.way,
      flow: p.flow ?? "ballistic",
      minSpeed: p.minSpeed ?? 0,
      tag: p.tag,
    };
  });
}

/** Every tile the footprint covers. */
function footprintTiles(g: Grid, a: Assembly, i0: number, j0: number): Set<number> {
  const out = new Set<number>();
  for (const [ci, cj] of a.floor) {
    const t = tileOf(i0, j0, ci, cj);
    for (let dj = 0; dj < CELL; dj++) for (let di = 0; di < CELL; di++) out.add(idx(g, t.i + di, t.j + dj));
  }
  return out;
}

/**
 * Score a fitted candidate. Higher is better; `null` means it failed a gate.
 *
 * Deliberately scored and ranked rather than taken first-fit. First-fit places
 * whatever the route walk happened to reach first, which on a long artery means
 * every machine clusters at the start end — the same "it looked random but the
 * rng was never consulted" defect `pickEndpoints` documents.
 */
function scoreAt(
  g: Grid,
  phi: Int32Array,
  a: Assembly,
  i0: number,
  j0: number,
  onRoute: boolean,
  report: PlaceReport,
): number | null {
  // Unreachable floor: a machine stranded in a sealed pocket is furniture the
  // player never meets. Checked on the ENTRY port, which is the tile that has
  // to be arrived at.
  const entry = a.ports.find((p) => p.way !== "out");
  if (!entry) return null;
  const et = tileOf(i0, j0, entry.ci, entry.cj);
  if (phiAt(g, phi, et.i, et.j) >= UNREACHED) {
    report.rejectUnreached++;
    return null;
  }

  // THE APPROACH. `wantsRunway` is the machine saying "I am meant to be SHOT
  // at" — a straight, unobstructed run to the entry. Measured backwards along
  // the entry's travel vector, because that is where the player comes from.
  const want = a.wantsRunway ?? 0;
  if (want > 0 && openRunway(g, et.i, et.j, -entry.dir.di, -entry.dir.dj, want) < want) {
    report.rejectApproach++;
    return null;
  }

  // THE EXITS. Every exit needs real floor ahead or the machine's drive parts
  // are launch orphans the moment `piece-rules` next runs — flagged for firing
  // into stone within 3 tiles, on every floor the machine lands on.
  let drop = 0;
  for (const port of a.ports) {
    if (port.way === "in") continue;
    const pt = tileOf(i0, j0, port.ci, port.cj);
    if (openRunway(g, pt.i, pt.j, port.dir.di, port.dir.dj, MIN_RUNWAY) < MIN_RUNWAY) {
      report.rejectExit++;
      return null;
    }
    drop += flowDrop(g, phi, pt.i, pt.j, port.dir.di, port.dir.dj, 12);
  }

  return (want > 0 ? 2 : 0) + drop + (onRoute ? 3 : 0);
}

/** Emit a machine's parts as floor-space spots carrying their `AssemblyRef`. */
export function partsOf(placed: PlacedAssembly): PinballPartSpot[] {
  return placed.asm.parts.map((p: AssemblyPart) => {
    const t = tileOf(placed.i0, placed.j0, p.ci, p.cj);
    const ref: AssemblyRef = { id: placed.id, name: placed.name, role: p.role, seq: p.seq };
    return {
      i: t.i,
      j: t.j,
      kind: p.kind,
      dirI: p.dir.di,
      dirJ: p.dir.dj,
      dir2I: p.dir2?.di ?? 0,
      dir2J: p.dir2?.dj ?? 0,
      seq: p.seq,
      asm: ref,
    };
  });
}

/** Fisher-Yates on the router's own stream. */
function shuffle<T>(xs: readonly T[], rng: () => number): T[] {
  const a = [...xs];
  for (let k = a.length - 1; k > 0; k--) {
    const m = Math.floor(rng() * (k + 1));
    [a[k], a[m]] = [a[m], a[k]];
  }
  return a;
}

/**
 * Place machines along the floor's routes.
 *
 * Sites are seeded FROM THE ROUTES rather than from open floor at large, which
 * is what puts a machine on the road the player is actually travelling. A
 * machine in a side pocket is a machine most runs never see, and the library's
 * whole premise is that the route between the machines is the table.
 */
export function placeAssemblies(g: Grid, phi: Int32Array, opts: PlaceOpts): PlaceReport {
  const report: PlaceReport = {
    placed: [],
    tried: 0,
    rejectFit: 0,
    rejectApproach: 0,
    rejectExit: 0,
    rejectUnreached: 0,
  };
  if (opts.budget <= 0) return report;

  const stride = opts.stride ?? 8;
  const taken = new Set<number>();
  const occupied = (i: number, j: number): boolean => taken.has(idx(g, i, j)) || opts.occupied(i, j);

  // The bag is shuffled once, not per site: a machine that keeps losing on
  // score should not also keep losing the draw, or the library's variety
  // collapses to whichever machine happens to fit most often.
  const bag = shuffle(opts.machines ?? MACHINES, opts.rng);
  let nextId = 1;

  for (const machine of bag) {
    if (report.placed.length >= opts.budget) break;
    const orientations = orientationsOf(machine);

    let best: { a: Assembly; i0: number; j0: number; score: number } | null = null;
    for (let r = 0; r < opts.routes.length; r++) {
      const route = opts.routes[r];
      for (let k = 0; k < route.length; k += stride) {
        const anchor = route[k];
        // A machine's own body should not sit on top of the start.
        if (Math.abs(anchor.i - opts.start.i) + Math.abs(anchor.j - opts.start.j) < 4) continue;
        for (const a of orientations) {
          const entry = a.ports.find((p) => p.way !== "out");
          if (!entry) continue;
          // Anchor the ENTRY on the route tile: the machine hangs off the road
          // by its mouth, wherever its body ends up.
          const i0 = anchor.i - entry.ci * CELL;
          const j0 = anchor.j - entry.cj * CELL;
          report.tried++;
          if (!fits(g, a, i0, j0, occupied)) {
            report.rejectFit++;
            continue;
          }
          const score = scoreAt(g, phi, a, i0, j0, r === 0, report);
          if (score === null) continue;
          if (!best || score > best.score) best = { a, i0, j0, score };
        }
      }
    }

    if (!best) continue;
    const placed: PlacedAssembly = {
      id: nextId++,
      name: machine.name,
      i0: best.i0,
      j0: best.j0,
      asm: best.a,
      tiles: footprintTiles(g, best.a, best.i0, best.j0),
      ports: placePorts(best.a, best.i0, best.j0),
    };
    for (const t of placed.tiles) taken.add(t);
    report.placed.push(placed);
  }

  return report;
}
