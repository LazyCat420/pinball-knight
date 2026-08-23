/**
 * PREFAB STAMPS — reusable room/hallway shapes stamped over the backtracker.
 *
 * The generation contract (same as carveRooms): a stamp only ever ADDS floor,
 * never adds wall, so connectivity is preserved BY CONSTRUCTION — every odd/odd
 * tile is a backtracker-carved cell and carving walls between floors only adds
 * loops. A stamp's '#' cells mean "leave whatever the maze had", not "wall".
 *
 * Variety without repetition comes from a seeded SHUFFLE BAG holding SHAPES;
 * draws are without replacement and the orientation (4 rotations × mirror) is
 * drawn after, so a floor can't repeat a room until it has used everything in
 * its theme's pool. Bagging the orientations individually instead would make
 * the guarantee per-variant, which is not the guarantee that matters — four
 * rotations of the same room still read as the same room four times.
 *
 * Two tiers stamp per floor: ONE landmark set piece (LANDMARKS, placed first
 * with priority) and then the regular furniture stamps around it, clustered on
 * the floor's hot zones so a level has loud rooms and quiet halls.
 *
 * Stamps are authored in CELL space (1 cell = 2×2 tiles after thickenWalls).
 * Legend:
 *   .  carve floor
 *   #  leave as-is
 *   B  bumper        R  ramp (dash pad)   S  spring
 *   O  oil slick     G  boxing glove      P  spin pad
 *   L  slingshot     D  trapdoor          *  horde spawn
 *   M  angle mirror  F  flipper           T  target bullseye
 *   I  pit           E  electric grid     N  magnet strip
 *   $  prize drop
 *
 * DOM- and three-free: tested (prefabs.test.ts).
 */
import { type Grid, type TilePos, T_FLOOR, T_WALL, at, setTile, mulberry32 } from "./generator";
import type { PrefabAnchor, PartSpotKind } from "./decorate";
import type { EnemyKind } from "../state";

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
  {
    // The Mirror Maze — an angle-mirror lattice ringing a prize. Every lane
    // ricochets; nothing goes where you point it.
    name: "mirrormaze",
    cells: [
      "M.M.M",
      ".....",
      "M.T.M",
      ".$.*.",
      "M.M.M",
    ],
  },
  {
    // The Pit Room — a prize island threaded between drop-holes. Thread the
    // gaps at a walk or launch clean across; a mis-step resets you.
    name: "pitroom",
    cells: [
      ".....",
      ".I.I.",
      "...$.",
      ".I.I.",
      ".....",
    ],
  },
  {
    // The S-Bend — a connector elbow-lane with an angle mirror on each turn,
    // so a fast entry banks around the Z instead of stopping dead.
    name: "sbend",
    cells: [
      ".M#",
      "#.#",
      "#M.",
    ],
  },
  {
    // The Squeeze — a connector gauntlet: rhythm-timed electric plates down a
    // straight. Walk it wrong and it bites; carry speed and skip the beats.
    name: "squeeze",
    cells: [
      ".E..E.",
    ],
  },
  {
    // The Boulevard — a wide connector hall with a caromable centre island of
    // bumpers and a flipper, a mini pinball table on the way through.
    name: "boulevard",
    cells: [
      ".....",
      ".BFB.",
      ".....",
    ],
  },
];

/**
 * LANDMARK STAMPS — the set-piece tier. Regular prefabs are 3-7 cells and read
 * as furniture you pass through; these are 7-11 cells and are meant to be THE
 * room you remember from a floor, so exactly one lands per level (stampLandmark
 * runs first, with priority and a wider mortar, before the regular stamps fill
 * in around it). Same legend, same carve-only contract.
 */
export const LANDMARKS: Prefab[] = [
  {
    // The Pachinko Drop — staggered bumper rows funnelling onto a pit line with
    // one safe prize pocket. Enter from the top and let the physics do the rest.
    name: "pachinko",
    cells: [
      ".........",
      ".B.B.B.B.",
      "..B.B.B..",
      ".B.B.B.B.",
      "..B.B.B..",
      ".I.I.I.I.",
      "....$....",
    ],
  },
  {
    // The Tilt Table — an actual mini pinball table: flippers and a plunger at
    // the bottom of a walled bowl, slingshots on the flanks, a target bank up
    // top. The one room on a floor that plays entirely by table rules.
    name: "tilttable",
    cells: [
      "...TTT...",
      ".L.....L.",
      ".B.....B.",
      "....$....",
      ".B.....B.",
      ".L.....L.",
      ".........",
      "..F...F..",
      "....S....",
    ],
  },
  {
    // The Grinder — a rhythm lane: gloves and electric plates alternating down
    // an oiled straight you cannot brake on. Carry speed or get chewed.
    name: "grinder",
    cells: [
      "...........",
      ".G.E.G.E.G.",
      ".OOOOOOOOO.",
      ".G.E.G.E.G.",
      "....*...$..",
    ],
  },
  {
    // The Observatory — a mirror octagon around a central bullseye. Nothing
    // reaches the middle straight; every shot has to bank its way in.
    name: "observatory",
    cells: [
      "..M.M.M..",
      ".M.....M.",
      "M.......M",
      ".........",
      "M...T...M",
      ".........",
      "M.......M",
      ".M..$..M.",
      "..M.M.M..",
    ],
  },
  {
    // The Nest — a webbed den: magnet strips raking the approach, a slick
    // oil bed around the prize island, and the horde bedded down in it.
    name: "nest",
    cells: [
      ".N.N.N.N.",
      ".........",
      "..OOOOO..",
      "..O.$.O..",
      "..OOOOO..",
      ".*.......",
      ".N.N.N.N.",
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

/** Mirror a stamp left↔right. Doubles the variant pool for free — combined
 * with the 4 rotations a stamp lands in up to 8 distinct orientations. */
export function mirrorPrefab(p: Prefab): Prefab {
  return { name: p.name, cells: p.cells.map((row) => row.split("").reverse().join("")) };
}

/** Every distinct orientation of a stamp: 4 rotations of it and of its mirror,
 * de-duped (a symmetric shape yields fewer than 8). */
export function variantsOf(p: Prefab): Prefab[] {
  const out: Prefab[] = [];
  const seen = new Set<string>();
  for (const base of [p, mirrorPrefab(p)]) {
    let v = base;
    for (let r = 0; r < 4; r++) {
      const key = v.cells.join("|");
      if (!seen.has(key)) {
        seen.add(key);
        out.push(v);
      }
      v = rotatePrefab(v);
    }
  }
  return out;
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
  /**
   * LANDMARK names (see LANDMARKS) this theme can draw its one set piece from.
   * Every theme must list at least one, so no floor goes without a set piece.
   */
  landmarks: string[];
  deal: PartSpotKind[]; // corridor part deal bias
  /** Horde-mix weight overrides for this biome. Kinds omitted keep their
   * base weight; the horde roller (core.ts) reads this to skew the roster
   * per floor — a Warren leans spider/slime, a Bloodworks leans brute/goblin. */
  enemies?: Partial<Record<EnemyKind, number>>;
}

export const THEMES: FloorTheme[] = [
  {
    // The Cold Crypt — the classic table: bumpers, lanes, a flipper or two.
    name: "crypt",
    pool: ["slalom", "bullring", "pitstop", "slingway", "boulevard"],
    landmarks: ["tilttable", "pachinko"],
    deal: ["bumper", "ramp", "spring", "glove", "flipper", "spinpad", "mirror", "slingshot", "oil"],
    enemies: { zombie: 3, ghost: 2, bat: 2, wisp: 2, mimic: 1 },
  },
  {
    // The Rotting Warren — everything is slick and nothing brakes.
    name: "warren",
    pool: ["oilworks", "switchback", "gauntlet", "pitstop", "pitroom", "sbend"],
    landmarks: ["nest", "grinder"],
    deal: ["oil", "bumper", "ramp", "oil", "spring", "glove", "flipper", "ramp", "slingshot"],
    enemies: { spider: 3, slime: 3, webspinner: 2, magnet: 2, hound: 2, sapper: 1, croaker: 2 },
  },
  {
    // The Bloodworks — the punch factory.
    name: "bloodworks",
    pool: ["gauntlet", "bullring", "slingway", "switchback", "squeeze"],
    landmarks: ["grinder", "pachinko"],
    deal: ["glove", "bumper", "flipper", "spring", "glove", "oil", "bumper", "slingshot", "spinpad"],
    enemies: { brute: 3, goblin: 3, pin: 2, chomper: 2, bloater: 2, hound: 2, jester: 2, rotortail: 2, stiltneck: 2 },
  },
  {
    // The Arcane Deep — the parlor floors: teleports, mirrors, trick lanes.
    name: "arcane",
    pool: ["parlor", "slalom", "oilworks", "bullring", "mirrormaze", "sbend"],
    landmarks: ["observatory", "tilttable"],
    deal: ["spinpad", "bumper", "mirror", "spring", "oil", "glove", "flipper", "slingshot", "mirror"],
    enemies: { ghost: 3, golem: 2, spitter: 2, bat: 2, necromancer: 2, warden: 1, crystalback: 1 },
  },
];

/**
 * Which theme SLOT a depth uses, as a per-run permutation.
 *
 * The plain `(level-1) % 4` meant floors 1, 5, 9, 13 were always the Crypt, in
 * every run forever — the archetype cycles every 5 so the *pair* took 20 floors
 * to repeat, but the theme itself was fully predictable from the depth. Here the
 * four slots are shuffled per run AND per cycle-of-four, so the order differs
 * between runs and between a run's first four floors and its next four, while
 * still never repeating a theme inside any block of four.
 *
 * `runSeed 0` yields the identity order — the old behaviour — so a caller that
 * has no run seed (tests, tools) sees exactly what it always did.
 *
 * IMPORTANT: core.ts's BIOMES are paired with THEMES by INDEX (crypt↔crypt,
 * warren↔warren, …), so a floor's palette matches its furniture pool. Both must
 * go through this one function or they drift apart.
 */
export function themeIndexFor(level: number, runSeed = 0): number {
  const n = THEMES.length;
  const l = Math.max(1, level);
  const slot = (l - 1) % n;
  if (!runSeed) return slot;
  const cycle = Math.floor((l - 1) / n);
  const rng = mulberry32((runSeed ^ ((cycle + 1) * 0x85ebca6b)) >>> 0);
  const order = Array.from({ length: n }, (_, k) => k);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order[slot];
}

export function themeFor(level: number, runSeed = 0): FloorTheme {
  return THEMES[themeIndexFor(level, runSeed)];
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
  M: "mirror",
  F: "flipper",
  T: "target",
  I: "pit",
  E: "electric",
  N: "magstrip",
  "*": "spawn",
  $: "prize",
};

/** A footprint already taken by a stamp, in CELL space. */
export interface ClaimRect {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface StampResult {
  anchors: PrefabAnchor[];
  stamped: string[];
  /** Footprints claimed so far — pass into a later stamp pass to avoid overlap. */
  claimed: ClaimRect[];
}

/**
 * Carve one oriented stamp at a cell-space position, returning its anchors.
 * Only ever carves wall→floor ('#' means "leave whatever the maze had"), so
 * connectivity is preserved by construction.
 */
function carveStamp(g: Grid, pf: Prefab, cx: number, cy: number, anchors: PrefabAnchor[]): void {
  const ph = pf.cells.length;
  const pw = pf.cells[0].length;
  const carvedAt = (dx: number, dy: number): boolean => dx >= 0 && dy >= 0 && dy < ph && dx < pw && pf.cells[dy][dx] !== "#";
  for (let dy = 0; dy < ph; dy++) {
    for (let dx = 0; dx < pw; dx++) {
      if (!carvedAt(dx, dy)) continue;
      const ti = (cx + dx) * 2 + 1;
      const tj = (cy + dy) * 2 + 1;
      setTile(g, ti, tj, T_FLOOR);
      // Adjacent carved cells get the wall between them opened, so the stamp's
      // interior is one walkable shape rather than a dotted lattice.
      if (carvedAt(dx + 1, dy)) setTile(g, ti + 1, tj, T_FLOOR);
      if (carvedAt(dx, dy + 1)) setTile(g, ti, tj + 1, T_FLOOR);
      const kind = ANCHOR_KINDS[pf.cells[dy][dx]];
      if (kind) anchors.push({ i: ti, j: tj, kind });
    }
  }
}

/**
 * Shared placement loop behind both stamp passes.
 *
 * `focus` is the HOT-ZONE bias: rather than one uniform draw, each attempt
 * takes FOCUS_TRIES candidate positions and keeps the one nearest a focal cell.
 * Uniform placement spread the furniture evenly and made every floor read as
 * the same mush of moderate density; clustering it gives a floor loud arenas
 * AND quiet halls, which is the pacing the density-gradient work is after.
 * With no focal points the first candidate always wins, so it degrades to the
 * old uniform draw.
 */
/**
 * Candidate positions drawn per placement. This trades off against stamp
 * VARIETY and has a floor below which the pass misbehaves: candidates that
 * clash with an existing stamp are discarded, so too few draws means a shape
 * often finds no legal spot near a focal point, gets dropped, and the bag
 * cycles early — which is what lets a room repeat. Measured, 5 was not enough
 * (clustering collapsed); 10 was the break-even. 12 keeps margin.
 */
const FOCUS_TRIES = 12;

function stampFrom(
  g: Grid,
  rng: () => number,
  shapes: Prefab[][],
  count: number,
  claimed: ClaimRect[],
  mortar: number,
  focus: ReadonlyArray<FocusCell>,
): StampResult {
  const cellsW = (g.w - 1) / 2;
  const cellsH = (g.h - 1) / 2;
  const anchors: PrefabAnchor[] = [];
  const stamped: string[] = [];
  if (!shapes.length) return { anchors, stamped, claimed };

  // The bag holds SHAPES, not orientations, and the orientation is drawn after.
  // Bagging the ~8 orientations of each shape individually (as this used to)
  // makes the no-repeat guarantee per-VARIANT, which is not the guarantee that
  // matters: four rotations of the Switchback still read as the same room four
  // times. Shape-level bagging means a floor can't repeat a room until it has
  // used every room in its theme.
  const bag = new ShuffleBag(shapes, rng);
  // Distance to the nearest hot zone, scaled by that zone's PULL. A weak zone's
  // distances are inflated, so candidates near it lose the "nearest focus" race
  // to the dominant zone and the furniture piles up there instead. Two equally
  // weighted zones gave every floor two matching blobs of activity; one loud
  // half and one quiet half is the pacing this is for.
  const nearestFocus = (cx: number, cy: number, pw: number, ph: number): number => {
    let best = Infinity;
    for (const f of focus) {
      const bias = f[2] ?? 1;
      best = Math.min(best, Math.hypot(cx + pw / 2 - f[0], cy + ph / 2 - f[1]) * bias);
    }
    return best;
  };

  // A shape that fails to find a spot is RETRIED rather than discarded: letting
  // a failed attempt consume a bag draw lets the bag wrap around early, which
  // reintroduces the very repeat the shape-level bag exists to prevent. After
  // RETRIES_PER_SHAPE misses we give up on it and move on, so a shape that
  // simply cannot fit can't stall the pass.
  const RETRIES_PER_SHAPE = 3;
  let pending: Prefab[] | null = null;
  let pendingTries = 0;

  for (let placed = 0, attempt = 0; placed < count && attempt < count * 14; attempt++) {
    const orientations: Prefab[] = pending ?? bag.draw();
    const pf = orientations[Math.floor(rng() * orientations.length)];
    const ph = pf.cells.length;
    const pw = pf.cells[0].length;
    if (pw + 2 > cellsW || ph + 2 > cellsH) {
      pending = null; // never going to fit this grid — drop it for good
      pendingTries = 0;
      continue;
    }

    // Mortar between stamps, so two shapes never fuse into mush.
    const mortarClash = (tx: number, ty: number): boolean =>
      claimed.some((r) => tx < r.cx + r.w + mortar && r.cx < tx + pw + mortar && ty < r.cy + r.h + mortar && r.cy < ty + ph + mortar);

    // Draw candidates and keep the CLASH-FREE one closest to a hot zone.
    //
    // The clash test has to happen INSIDE this loop, not after it. Scoring
    // first and testing the winner afterwards means that once a few stamps have
    // clustered around a focal point every later draw picks an occupied spot
    // and fails — so only the smallest shape in the pool ever fits and the
    // floor gets stamped with the same tiny room repeatedly. Filtering first
    // lets a big shape settle further out instead of being dropped.
    let cx = -1;
    let cy = -1;
    let bestScore = Infinity;
    const tries = focus.length ? FOCUS_TRIES : 1;
    for (let t = 0; t < tries; t++) {
      const tx = 1 + Math.floor(rng() * (cellsW - pw - 1));
      const ty = 1 + Math.floor(rng() * (cellsH - ph - 1));
      if (mortarClash(tx, ty)) continue;
      const score = focus.length ? nearestFocus(tx, ty, pw, ph) : 0;
      if (score < bestScore) {
        bestScore = score;
        cx = tx;
        cy = ty;
      }
    }
    if (cx < 0) {
      pendingTries++;
      pending = pendingTries < RETRIES_PER_SHAPE ? orientations : null;
      if (!pending) pendingTries = 0;
      continue;
    }

    carveStamp(g, pf, cx, cy, anchors);
    claimed.push({ cx, cy, w: pw, h: ph });
    stamped.push(pf.name);
    pending = null;
    pendingTries = 0;
    placed++;
  }
  return { anchors, stamped, claimed };
}

/**
 * Pick this floor's HOT ZONES — the focal cells that stamp placement clusters
 * around. Two of them, kept apart so they don't collapse into one blob.
 */
/** Extra pull applied to every zone after the first. >1 = weaker: its distances
 *  are inflated, so it loses candidates to the dominant zone. */
const FOCUS_MIN_BIAS = 1.5;
const FOCUS_MAX_BIAS = 2.5;

/**
 * The floor's hot zones: `[cellX, cellY, bias]`, kept at least 35% of the floor
 * apart. The FIRST is dominant (bias 1); every later one is deliberately weaker
 * (see FOCUS_*_BIAS), because equal zones produced two matching blobs of
 * activity on every floor — symmetric, and so predictable that the density
 * gradient stopped reading as pacing at all. One loud region and one quieter
 * satellite is the shape we want: "there was a lot going on over there, and this
 * side was quiet".
 */
export type FocusCell = readonly [number, number, number];

export function pickFocusCells(g: Grid, rng: () => number, n = 2): FocusCell[] {
  const cellsW = (g.w - 1) / 2;
  const cellsH = (g.h - 1) / 2;
  const out: FocusCell[] = [];
  const minSep = Math.max(cellsW, cellsH) * 0.35;
  for (let attempt = 0; attempt < n * 12 && out.length < n; attempt++) {
    const cx = 1 + Math.floor(rng() * Math.max(1, cellsW - 2));
    const cy = 1 + Math.floor(rng() * Math.max(1, cellsH - 2));
    if (out.some((f) => Math.hypot(f[0] - cx, f[1] - cy) < minSep)) continue;
    const bias = out.length === 0 ? 1 : FOCUS_MIN_BIAS + rng() * (FOCUS_MAX_BIAS - FOCUS_MIN_BIAS);
    out.push([cx, cy, bias] as const);
  }
  return out;
}

/**
 * Stamp this floor's ONE set piece — the landmark room (see LANDMARKS). Runs
 * BEFORE stampPrefabs so the biggest shape gets first pick of the floor, with a
 * 2-cell mortar so the regular stamps can't crowd it. Returns the claimed
 * footprints to hand on to stampPrefabs.
 *
 * Deliberately unbiased by hot zones: the landmark IS a hot zone, and the
 * focal points are picked around it afterwards.
 */
export function stampLandmark(g: Grid, rng: () => number, theme: FloorTheme, claimed: ClaimRect[] = []): StampResult {
  const byName = new Map(LANDMARKS.map((p) => [p.name, p]));
  const shapes: Prefab[][] = [];
  for (const name of theme.landmarks) {
    const p = byName.get(name);
    if (p) shapes.push(variantsOf(p));
  }
  return stampFrom(g, rng, shapes, 1, claimed, 2, []);
}

/**
 * Stamp `count` theme prefabs over a RAW (pre-thicken) maze. Draws from the
 * theme's shuffle bag (each prefab enters in all 4 rotations AND mirrors, so
 * even a repeated shape lands differently), places without overlap, carves
 * floor cells + the walls between adjacent carved cells, and returns the
 * furniture anchors in RAW TILE coordinates (callers scale ×2 after
 * thickenWalls).
 *
 * `claimed` carries footprints from an earlier pass (the landmark); `focus`
 * clusters placement around this floor's hot zones.
 */
export function stampPrefabs(
  g: Grid,
  rng: () => number,
  count: number,
  theme: FloorTheme,
  claimed: ClaimRect[] = [],
  focus: ReadonlyArray<FocusCell> = [],
): StampResult {
  const byName = new Map(PREFABS.map((p) => [p.name, p]));
  const shapes: Prefab[][] = [];
  for (const name of theme.pool) {
    const p = byName.get(name);
    if (!p) continue;
    // All 4 rotations AND their mirrors, so a repeated shape still lands fresh.
    shapes.push(variantsOf(p));
  }
  return stampFrom(g, rng, shapes, count, claimed, 1, focus);
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
