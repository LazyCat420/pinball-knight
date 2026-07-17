/**
 * PREFAB STAMPS — reusable room/hallway shapes stamped over the backtracker.
 *
 * The generation contract (same as carveRooms): a stamp only ever ADDS floor,
 * never adds wall, so connectivity is preserved BY CONSTRUCTION — every odd/odd
 * tile is a backtracker-carved cell and carving walls between floors only adds
 * loops. A stamp's '#' cells mean "leave whatever the maze had", not "wall".
 *
 * Variety without repetition comes from a seeded SHUFFLE BAG: every prefab
 * enters the bag in all 4 rotations; draws are without replacement, so a floor
 * can't repeat a stamp until it has used everything in its theme's pool.
 *
 * Stamps are authored in CELL space (1 cell = 2×2 tiles after thickenWalls).
 * Legend:
 *   .  carve floor
 *   #  leave as-is
 *   B  bumper        R  ramp (dash pad)   S  spring
 *   O  oil slick     G  boxing glove      P  spin pad
 *   L  slingshot     D  trapdoor          *  horde spawn
 *   $  prize drop
 *
 * DOM- and three-free: tested (prefabs.test.ts).
 */
import { type Grid, type TilePos, T_FLOOR, T_WALL, at, setTile } from "./generator";
import type { PrefabAnchor, PartSpotKind } from "./decorate";

export interface Prefab {
  name: string;
  cells: string[];
}

/**
 * The stamp library. Each is a named SHAPE with its furniture baked in — the
 * "component parts" the floors recombine. Kept small (3-7 cells a side): they
 * read as landmarks, not as replacing the maze.
 */
export const PREFABS: Prefab[] = [
  {
    // The Slalom — an S-curve lane of dash pads. Take it clean for free speed.
    name: "slalom",
    cells: [
      "..R##",
      "#..R#",
      "##..R",
      "#R..#",
      "R..##",
    ],
  },
  {
    // The Gauntlet — a punch-alley: gloves firing across an oiled straight.
    name: "gauntlet",
    cells: [
      ".G.O.G.",
    ],
  },
  {
    // The Oilworks — a slicked-out chamber ringed with bumpers. Good luck braking.
    name: "oilworks",
    cells: [
      "B..B",
      ".OO.",
      ".OO.",
      "B..B",
    ],
  },
  {
    // The Magician's Parlor — spin pads in a mirrored cross. Nothing here is
    // where you meant to go.
    name: "parlor",
    cells: [
      "#.P.#",
      "....*",
      "P.$.P",
      "*....",
      "#.P.#",
    ],
  },
  {
    // The Slingway — a launch corridor: slingshot gates chained down a lane.
    name: "slingway",
    cells: [
      ".L..L..L.",
    ],
  },
  {
    // The Pit Stop — a dead-end pocket that PAYS: spring out, prize in, hatch down.
    name: "pitstop",
    cells: [
      "S.$",
      "#.D",
    ],
  },
  {
    // The Bullring — an open arena with a bumper heart and spawns on the horns.
    name: "bullring",
    cells: [
      "*...*",
      ".B.B.",
      "..$..",
      ".B.B.",
      "*...*",
    ],
  },
  {
    // The Switchback — a Z-hall with ramps on the straights, oil on the bends.
    name: "switchback",
    cells: [
      "R.O##",
      "###.#",
      "##O.R",
    ],
  },
];

/** Rotate a stamp 90° clockwise. */
export function rotatePrefab(p: Prefab): Prefab {
  const h = p.cells.length;
  const w = p.cells[0].length;
  const out: string[] = [];
  for (let i = 0; i < w; i++) {
    let row = "";
    for (let j = h - 1; j >= 0; j--) row += p.cells[j][i];
    out.push(row);
  }
  return { name: p.name, cells: out };
}

/**
 * A seeded shuffle bag: draws without replacement, reshuffles when empty.
 * The no-repeat guarantee: no item can be drawn twice before every item in
 * the bag has been drawn once.
 */
export class ShuffleBag<T> {
  private bag: T[] = [];
  constructor(
    private readonly items: T[],
    private readonly rng: () => number,
  ) {}

  draw(): T {
    if (this.bag.length === 0) {
      this.bag = this.items.slice();
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    return this.bag.pop()!;
  }
}

/**
 * FLOOR THEMES — each depth draws its prefab pool (and its corridor part deal)
 * from the theme matching its biome (core.ts BIOMES cycle every 4 floors), so
 * descending reads as new machinery, not a re-tint.
 */
export interface FloorTheme {
  name: string;
  pool: string[]; // prefab names in this theme's bag
  deal: PartSpotKind[]; // corridor part deal bias
}

export const THEMES: FloorTheme[] = [
  {
    // The Cold Crypt — the classic table: bumpers, lanes, a flipper or two.
    name: "crypt",
    pool: ["slalom", "bullring", "pitstop", "slingway"],
    deal: ["bumper", "ramp", "spring", "glove", "flipper", "deflector", "spinpad", "mirror", "slingshot", "oil"],
  },
  {
    // The Rotting Warren — everything is slick and nothing brakes.
    name: "warren",
    pool: ["oilworks", "switchback", "gauntlet", "pitstop"],
    deal: ["oil", "bumper", "ramp", "oil", "spring", "glove", "deflector", "flipper", "ramp", "slingshot"],
  },
  {
    // The Bloodworks — the punch factory.
    name: "bloodworks",
    pool: ["gauntlet", "bullring", "slingway", "switchback"],
    deal: ["glove", "bumper", "flipper", "spring", "glove", "oil", "deflector", "bumper", "slingshot", "spinpad"],
  },
  {
    // The Arcane Deep — the parlor floors: teleports, mirrors, trick lanes.
    name: "arcane",
    pool: ["parlor", "slalom", "oilworks", "bullring"],
    deal: ["spinpad", "bumper", "mirror", "spring", "deflector", "oil", "glove", "flipper", "slingshot", "mirror"],
  },
];

export function themeFor(level: number): FloorTheme {
  return THEMES[(level - 1) % THEMES.length];
}

const ANCHOR_KINDS: Record<string, PrefabAnchor["kind"]> = {
  B: "bumper",
  R: "ramp",
  S: "spring",
  O: "oil",
  G: "glove",
  P: "spinpad",
  L: "slingshot",
  D: "trapdoor",
  "*": "spawn",
  $: "prize",
};

/**
 * Stamp `count` theme prefabs over a RAW (pre-thicken) maze. Draws from the
 * theme's shuffle bag (each prefab enters in all 4 rotations, so even a
 * repeated shape lands differently), places without overlap, carves floor
 * cells + the walls between adjacent carved cells, and returns the furniture
 * anchors in RAW TILE coordinates (callers scale ×2 after thickenWalls).
 */
export function stampPrefabs(
  g: Grid,
  rng: () => number,
  count: number,
  theme: FloorTheme,
): { anchors: PrefabAnchor[]; stamped: string[] } {
  const cellsW = (g.w - 1) / 2;
  const cellsH = (g.h - 1) / 2;
  const byName = new Map(PREFABS.map((p) => [p.name, p]));
  const variants: Prefab[] = [];
  for (const name of theme.pool) {
    let p = byName.get(name);
    if (!p) continue;
    for (let r = 0; r < 4; r++) {
      variants.push(p);
      p = rotatePrefab(p);
    }
  }
  if (variants.length === 0) return { anchors: [], stamped: [] };

  const bag = new ShuffleBag(variants, rng);
  const anchors: PrefabAnchor[] = [];
  const stamped: string[] = [];
  const claimed: Array<{ cx: number; cy: number; w: number; h: number }> = [];

  for (let placed = 0, attempt = 0; placed < count && attempt < count * 14; attempt++) {
    const pf = bag.draw();
    const ph = pf.cells.length;
    const pw = pf.cells[0].length;
    if (pw + 2 > cellsW || ph + 2 > cellsH) continue;
    const cx = 1 + Math.floor(rng() * (cellsW - pw - 1));
    const cy = 1 + Math.floor(rng() * (cellsH - ph - 1));
    // One-cell mortar between stamps so two shapes never fuse into mush.
    if (claimed.some((r) => cx < r.cx + r.w + 1 && r.cx < cx + pw + 1 && cy < r.cy + r.h + 1 && r.cy < cy + ph + 1)) continue;

    // Carve: every non-'#' cell becomes floor; adjacent carved cells get the
    // wall between them opened, so the stamp's interior is one walkable shape.
    const carvedAt = (dx: number, dy: number): boolean => dx >= 0 && dy >= 0 && dy < ph && dx < pw && pf.cells[dy][dx] !== "#";
    for (let dy = 0; dy < ph; dy++) {
      for (let dx = 0; dx < pw; dx++) {
        if (!carvedAt(dx, dy)) continue;
        const ti = (cx + dx) * 2 + 1;
        const tj = (cy + dy) * 2 + 1;
        setTile(g, ti, tj, T_FLOOR);
        if (carvedAt(dx + 1, dy)) setTile(g, ti + 1, tj, T_FLOOR);
        if (carvedAt(dx, dy + 1)) setTile(g, ti, tj + 1, T_FLOOR);
        const kind = ANCHOR_KINDS[pf.cells[dy][dx]];
        if (kind) anchors.push({ i: ti, j: tj, kind });
      }
    }
    claimed.push({ cx, cy, w: pw, h: ph });
    stamped.push(pf.name);
    placed++;
  }
  return { anchors, stamped };
}

/**
 * True if every floor tile of the grid is reachable from (si, sj) — the
 * invariant every stamp must preserve. Test helper, also handy for debug.
 */
export function fullyReachable(g: Grid, si: number, sj: number): boolean {
  const seen = new Uint8Array(g.w * g.h);
  const queue: TilePos[] = [{ i: si, j: sj }];
  seen[sj * g.w + si] = 1;
  while (queue.length) {
    const { i, j } = queue.pop()!;
    for (const [di, dj] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h) continue;
      if (seen[nj * g.w + ni] || at(g, ni, nj) === T_WALL) continue;
      seen[nj * g.w + ni] = 1;
      queue.push({ i: ni, j: nj });
    }
  }
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (at(g, i, j) !== T_WALL && !seen[j * g.w + i]) return false;
    }
  }
  return true;
}
