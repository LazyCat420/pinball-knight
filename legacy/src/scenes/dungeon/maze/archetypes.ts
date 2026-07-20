/**
 * FLOOR ARCHETYPES — the macro layout of a depth.
 *
 * Themes (prefabs.ts) change a floor's FURNITURE and biomes (core.ts) change
 * its COLOUR, but until this module every floor was the same object underneath:
 * a uniform-density growing-tree maze with rectangles sprinkled over it. An
 * archetype changes the floor's SHAPE — one great open hall, a highway with
 * branches hanging off it, a cave, a ring keep — which is the thing a player
 * actually reads as "a different level".
 *
 * How it works: each archetype returns a set of CELL SEEDS that generateMaze
 * pre-carves and grows out of (see MazeOpts.seeds). That single mechanism gives
 * every archetype the same guarantees for free —
 *   - only ever carves wall→floor, so connectivity can only increase;
 *   - stitchCells welds any seed shape that came out in pieces;
 *   - the cell lattice is preserved outside solidly-filled regions, so the 2×2
 *     secret bands and every stamp still land where they expect to. (Inside a
 *     solid region the lattice's corner pillars are knocked out on purpose —
 *     see MazeOpts.solidSeeds — exactly as carveRooms has always filled its
 *     rects; thickenWalls' 2-thick wall guarantee comes from the doubling
 *     itself, not from the lattice, so it is unaffected.)
 * An archetype therefore cannot produce an unsolvable floor, whatever it draws.
 *
 * DOM- and three-free, seeded-deterministic: tested in archetypes.test.ts.
 */
import type { CellPos } from "./generator";

export type ArchetypeId = "warrens" | "spine" | "greathall" | "cavern" | "ringkeep";

export interface FloorArchetype {
  id: ArchetypeId;
  /** Shown on the descent card next to the biome name. */
  label: string;
  flavour: string;
  /**
   * Multiplier on the level's braid budget. A cave is already loopy and wants
   * fewer extra knock-throughs; a spine floor wants its branches to stay
   * dead-endy so the highway keeps its monopoly on speed.
   */
  braidMult: number;
  /** Braid gradient fed to generateMaze — loopy near spawn, tight near the stairs. */
  braidGradient: number;
  /**
   * Fill the seeded region solid rather than leaving the lattice's corner
   * pillars standing (MazeOpts.solidSeeds). On for the archetypes whose point
   * is OPEN AREA to carom around; a no-op for 1-cell-wide shapes like the
   * Spine, which contain no 2×2 quad to knock through in the first place.
   */
  solid: boolean;
  /**
   * Seed cells for the growing tree, or null for the plain single-cell start
   * (the classic backtracker floor).
   */
  seeds(cellsW: number, cellsH: number, rng: () => number): CellPos[] | null;
}

/** Every cell on the perimeter of a cell-space rect, clockwise-ish order. */
function ringCells(x0: number, y0: number, x1: number, y1: number): CellPos[] {
  const out: CellPos[] = [];
  for (let x = x0; x <= x1; x++) {
    out.push([x, y0]);
    if (y1 !== y0) out.push([x, y1]);
  }
  for (let y = y0 + 1; y < y1; y++) {
    out.push([x0, y]);
    if (x1 !== x0) out.push([x1, y]);
  }
  return out;
}

/** Inclusive cell-space rect fill. */
function rectCells(x0: number, y0: number, x1: number, y1: number): CellPos[] {
  const out: CellPos[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * THE SPINE — one 1-cell-wide boulevard running the length of the floor, with
 * the maze branching off it. Every floor of this shape has a legible highway
 * you can plunge down at full momentum; everything else hangs off it as
 * dead-end pockets. Four shapes (straight ×2, elbow, Z) so it isn't one pose.
 */
function spineSeeds(cellsW: number, cellsH: number, rng: () => number): CellPos[] {
  const shape = Math.floor(rng() * 4);
  const cells: CellPos[] = [];
  const midY = clamp(Math.floor(cellsH * (0.3 + rng() * 0.4)), 1, cellsH - 2);
  const midX = clamp(Math.floor(cellsW * (0.3 + rng() * 0.4)), 1, cellsW - 2);

  if (shape === 0) {
    // Straight, east-west.
    for (let x = 0; x < cellsW; x++) cells.push([x, midY]);
  } else if (shape === 1) {
    // Straight, north-south.
    for (let y = 0; y < cellsH; y++) cells.push([midX, y]);
  } else if (shape === 2) {
    // Elbow: run east along midY, then turn and run south at midX.
    for (let x = 0; x <= midX; x++) cells.push([x, midY]);
    for (let y = midY; y < cellsH; y++) cells.push([midX, y]);
  } else {
    // Z: two offset east-west runs joined by a north-south connector.
    const y2 = clamp(midY + (midY < cellsH / 2 ? 1 : -1) * Math.max(2, Math.floor(cellsH * 0.35)), 1, cellsH - 2);
    for (let x = 0; x <= midX; x++) cells.push([x, midY]);
    const [lo, hi] = midY < y2 ? [midY, y2] : [y2, midY];
    for (let y = lo; y <= hi; y++) cells.push([midX, y]);
    for (let x = midX; x < cellsW; x++) cells.push([x, y2]);
  }
  return cells;
}

/**
 * THE GREAT HALL — one enormous open chamber taking ~45% × 50% of the floor,
 * with the maze reduced to a rind around it. This is the TABLE floor: pinball
 * physics need open area to chain caroms, and the standard 2-wide corridor grid
 * never gives them any. Inverts the usual ratio — open space with a maze crust
 * rather than a maze with pockets.
 */
function greatHallSeeds(cellsW: number, cellsH: number, rng: () => number): CellPos[] {
  const hw = Math.max(2, Math.floor(cellsW * 0.45));
  const hh = Math.max(2, Math.floor(cellsH * 0.5));
  // Centred, with a little jitter so the hall isn't in the same place twice.
  const x0 = clamp(Math.floor((cellsW - hw) / 2 + (rng() - 0.5) * cellsW * 0.16), 1, cellsW - hw - 2);
  const y0 = clamp(Math.floor((cellsH - hh) / 2 + (rng() - 0.5) * cellsH * 0.16), 1, cellsH - hh - 2);
  return rectCells(x0, y0, x0 + hw - 1, y0 + hh - 1);
}

/**
 * THE RING KEEP — concentric rectangular galleries joined by a few radial
 * gaps, stairs landing near the middle. Progress reads as "working inward"
 * instead of "wandering", which no other archetype gives you.
 */
function ringKeepSeeds(cellsW: number, cellsH: number, rng: () => number): CellPos[] {
  const cells: CellPos[] = [];
  const maxInset = Math.floor(Math.min(cellsW, cellsH) / 2) - 1;
  const rings: Array<[number, number, number, number]> = [];
  for (let inset = 1; inset <= maxInset; inset += 3) {
    const x0 = inset;
    const y0 = inset;
    const x1 = cellsW - 1 - inset;
    const y1 = cellsH - 1 - inset;
    if (x1 - x0 < 1 || y1 - y0 < 1) break;
    rings.push([x0, y0, x1, y1]);
    cells.push(...ringCells(x0, y0, x1, y1));
  }
  if (!rings.length) return rectCells(1, 1, cellsW - 2, cellsH - 2);

  // Radial gaps: punch a corridor between consecutive rings at a random side,
  // so the keep has real gates rather than relying on the stitch pass.
  for (let r = 0; r + 1 < rings.length; r++) {
    const [ax0, ay0, ax1, ay1] = rings[r];
    const [bx0, by0, bx1, by1] = rings[r + 1];
    const side = Math.floor(rng() * 4);
    if (side === 0) {
      const x = bx0 + Math.floor(rng() * Math.max(1, bx1 - bx0 + 1));
      for (let y = ay0; y <= by0; y++) cells.push([x, y]);
    } else if (side === 1) {
      const x = bx0 + Math.floor(rng() * Math.max(1, bx1 - bx0 + 1));
      for (let y = by1; y <= ay1; y++) cells.push([x, y]);
    } else if (side === 2) {
      const y = by0 + Math.floor(rng() * Math.max(1, by1 - by0 + 1));
      for (let x = ax0; x <= bx0; x++) cells.push([x, y]);
    } else {
      const y = by0 + Math.floor(rng() * Math.max(1, by1 - by0 + 1));
      for (let x = bx1; x <= ax1; x++) cells.push([x, y]);
    }
  }
  // The core: fill whatever the innermost ring encloses, so the middle is a
  // proper keep chamber and not a sealed pocket the maze has to find its way in.
  const [ix0, iy0, ix1, iy1] = rings[rings.length - 1];
  cells.push(...rectCells(ix0, iy0, ix1, iy1));
  return cells;
}

/**
 * THE CAVERN — cellular-automata caves (BLUEPRINT §5's "pluggable generator"
 * note, finally cashed). Random fill, smoothing passes, keep the largest blob;
 * the growing tree then tunnels the leftover cells, so the floor reads as a
 * cave system with mine-works bored through it. Nothing here is straight, which
 * changes how every mirror, deflector and bumper plays.
 *
 * Falls back to null (plain maze) if the automaton happens to produce nothing
 * substantial — a cave that is 8% of the floor is just a worse maze.
 */
function cavernSeeds(cellsW: number, cellsH: number, rng: () => number): CellPos[] | null {
  const n = cellsW * cellsH;
  let alive = new Uint8Array(n);
  for (let k = 0; k < n; k++) alive[k] = rng() < 0.46 ? 1 : 0;

  const liveNeighbours = (src: Uint8Array, cx: number, cy: number): number => {
    let c = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        // Out of bounds counts as solid: keeps caves off the border.
        if (nx < 0 || ny < 0 || nx >= cellsW || ny >= cellsH) continue;
        c += src[ny * cellsW + nx];
      }
    }
    return c;
  };

  for (let pass = 0; pass < 4; pass++) {
    const next = new Uint8Array(n);
    for (let cy = 0; cy < cellsH; cy++) {
      for (let cx = 0; cx < cellsW; cx++) {
        const k = cy * cellsW + cx;
        const c = liveNeighbours(alive, cx, cy);
        next[k] = c >= 5 ? 1 : c <= 2 ? 0 : alive[k];
      }
    }
    alive = next;
  }

  // Largest 4-connected blob wins; the rest is left for the maze to tunnel.
  const seen = new Uint8Array(n);
  let best: CellPos[] = [];
  for (let cy = 0; cy < cellsH; cy++) {
    for (let cx = 0; cx < cellsW; cx++) {
      const k0 = cy * cellsW + cx;
      if (!alive[k0] || seen[k0]) continue;
      const blob: CellPos[] = [];
      const queue: CellPos[] = [[cx, cy]];
      seen[k0] = 1;
      while (queue.length) {
        const [x, y] = queue.pop()!;
        blob.push([x, y]);
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cellsW || ny >= cellsH) continue;
          const nk = ny * cellsW + nx;
          if (seen[nk] || !alive[nk]) continue;
          seen[nk] = 1;
          queue.push([nx, ny]);
        }
      }
      if (blob.length > best.length) best = blob;
    }
  }
  return best.length >= n * 0.18 ? best : null;
}

export const ARCHETYPES: FloorArchetype[] = [
  {
    id: "warrens",
    solid: false,
    label: "Warrens",
    flavour: "close corridors · nowhere to build speed",
    braidMult: 1,
    braidGradient: 0,
    seeds: () => null,
  },
  {
    id: "spine",
    solid: false,
    label: "The Spine",
    flavour: "one long road · everything else is a pocket",
    // The branches should stay dead-endy, or the highway stops being special.
    braidMult: 0.6,
    braidGradient: 0.5,
    seeds: spineSeeds,
  },
  {
    id: "greathall",
    solid: true,
    label: "The Great Hall",
    flavour: "one vast chamber · room to really move",
    braidMult: 0.85,
    braidGradient: 0.4,
    seeds: greatHallSeeds,
  },
  {
    id: "cavern",
    solid: true,
    label: "The Cavern",
    flavour: "no straight lines · the rock decides",
    // Caves are loopy already; extra knock-throughs just mush them.
    braidMult: 0.5,
    braidGradient: 0.3,
    seeds: cavernSeeds,
  },
  {
    id: "ringkeep",
    solid: true,
    label: "The Ring Keep",
    flavour: "gallery within gallery · the way in is inward",
    braidMult: 0.7,
    braidGradient: 0.35,
    seeds: ringKeepSeeds,
  },
];

/**
 * The archetype for a depth. Cycles every ARCHETYPES.length floors while the
 * biome cycles every 4, so the pair takes 20 floors to repeat instead of 4.
 * Level 1 stays "warrens" — the floor players already know — for the same
 * reason WINDINESS_CYCLE opens at 1.0.
 */
export function archetypeFor(level: number): FloorArchetype {
  return ARCHETYPES[(Math.max(1, level) - 1) % ARCHETYPES.length];
}
