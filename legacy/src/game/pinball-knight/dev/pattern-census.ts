/**
 * PATTERN CENSUS — how much of this floor is the same idea, drawn again?
 *
 * The complaint: "it's not just random walls being jumbled together" is what we
 * want, and what we keep getting is the opposite. That is a claim about a
 * distribution, so it needs a distribution — not a screenshot and not a feeling.
 * This module turns a built floor into five of them.
 *
 * ── The five questions ─────────────────────────────────────────────────────
 *
 *  1. **GEOMETRY MOTIFS.** Every walkable tile's 5x5 neighbourhood, folded to a
 *     canonical form under the eight symmetries of the square (a left turn and
 *     a right turn are the SAME idea; counting them apart would report variety
 *     that a player cannot perceive). If twenty motifs cover most of the floor,
 *     the maze has twenty ideas however many tiles it has.
 *
 *  2. **FURNITURE VOCABULARY.** Which part kinds got used, in what proportion,
 *     and how many are loose versus inside an authored machine or circuit. The
 *     booster family exists because a census once found `booster` was 73% of
 *     all launch furniture (`decorate.ts PartSpotKind`); this is that census,
 *     kept runnable.
 *
 *  3. **FURNITURE MOTIFS.** A part plus the multiset of kinds around it. This
 *     is the "lego piece" census: it names the combinations the generator
 *     actually emits, which is the list any new piece has to beat.
 *
 *  4. **HAND-OFF n-GRAMS.** Triples of kinds along the successor graph — the
 *     combos a player can actually ride. A floor whose every chain is
 *     booster→booster→booster has one combo, not many.
 *
 *  5. **WALL AND CURVE RULES.** The specific defects: stone that no one can
 *     see, separators thicker than they need to be, curves carved facing a wall
 *     (invisible), curves whose ends feed nothing (a dead end), and corridor
 *     stubs with nothing at the end of them.
 *
 * ── The measurement rule this module was built under ───────────────────────
 *
 * `maze/piece-rules.ts` records the scar in its own header: an adjacency metric
 * over arc tiles produced a confident 76.6% "kink rate" that was almost
 * entirely an artefact of measuring tiles the renderer never draws. So every
 * rule here is stated as a claim about something a PLAYER meets — a surface
 * they can see, a curve they can ride into, a corridor they can walk down — and
 * the ones that judge walls only ever look at wall tiles that touch open floor.
 *
 * Pure: takes a floor, returns numbers. No DOM, no THREE, no rng.
 */
import { type Grid, type TilePos, at, idx, isWalkable, T_WALL, T_CRACKED } from "../maze/generator";
import { SHAPE_ARC, SHAPE_FULL, isShaped, type ArcFeature } from "../engine/tile-shape";
import { exitRay, successorsOf, type FlowPart } from "../maze/flow-loops";
import type { PinballPartSpot, PartSpotKind } from "../maze/decorate";
import type { MegaFloor } from "./mega-floor";

/** Neighbourhood side for a geometry motif. Odd so the tile is at the centre. */
const MOTIF_K = 5;
/**
 * Chebyshev radius for a furniture motif.
 *
 * 3 rather than the de-clump distance (Chebyshev 3 is exactly what `polishParts`
 * enforces between ungrouped parts) so a motif can contain a legal neighbour at
 * all. At 2 almost every loose part reads as a solo, which measures the spacing
 * rule rather than the vocabulary.
 */
const FURNITURE_R = 3;
/**
 * How far a shove or a curve's exit carries, in tiles. The same 12 that
 * `flow-loops.RAY`, `circuit.RAY` and decorate's `DUEL_RANGE` use — the same
 * physical claim about friction, restated because each module keeps it private.
 */
const RAY = 12;
/** Open tiles ahead that make an exit a shot rather than a wall. */
const MIN_RUNWAY = 3;
/**
 * How far off a wall face a probe must start, in tiles.
 *
 * A ball has a radius; it rides a curve at a standoff, not at zero gap. Any
 * ray that starts exactly on the surface is asking about a point inside the
 * wall — see the warning at the tangent march in `curveCensus`, which is where
 * this cost a wrong answer before it was noticed.
 */
const CLEARANCE = 1.2;

const CARDS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export interface MotifRow {
  /** ASCII picture, rows joined by "/". `#` wall, `.` floor. */
  art: string;
  n: number;
  share: number;
}

export interface CountRow {
  key: string;
  n: number;
  share: number;
}

export interface Concentration {
  distinct: number;
  /** Share of the population carried by the 20 most common entries. */
  top20Share: number;
  /**
   * Shannon entropy over the distribution, divided by log2(distinct).
   *
   * 1.0 = every motif equally common (maximum variety for that vocabulary);
   * near 0 = one motif and a tail. Normalised so a floor with 400 motifs and a
   * floor with 40 can be compared on how EVENLY each spends its vocabulary,
   * which is a different question from how big the vocabulary is. Both are
   * reported because a floor can fail either way.
   */
  evenness: number;
}

export interface WallRules {
  wallTiles: number;
  /** Wall tiles with no walkable neighbour in 8 directions — masonry a player
   *  never meets. Not a defect on its own; a high share means the floor's shape
   *  is mostly fill, which is where "jumbled" tends to live. */
  interiorShare: number;
  /** Separator thickness histogram, keyed by tile count (8 = "8 or more"). A
   *  separator is a straight run of wall between two walkable tiles. */
  separators: Record<number, number>;
  /** Share of separators 3+ thick: two corridors that did not need two walls. */
  thickSeparatorShare: number;
  /** Straight runs of SURFACE wall (wall touching floor), by length. */
  surfaceRuns: Record<number, number>;
  /** Walkable tiles with exactly one walkable 4-neighbour. */
  stubs: number;
  /** Stubs with no part, item, torch, prop or secret within 2 tiles. */
  emptyStubs: number;
}

export interface CurveRules {
  arcs: number;
  /** Arcs per 1000 walkable tiles — the density the renderer actually shows. */
  per1k: number;
  byOwner: Record<string, number>;
  /** Full circles (islands): no endpoints, so exempt from the feed rule. */
  closed: number;
  /** Endpoints whose tangent continuation reaches a part, doorway or opening. */
  fedEnds: number;
  /** Endpoints that reach nothing within RAY — the "curve into a dead end". */
  deadEnds: number;
  /** Arcs whose surface faces MORE WALL for most of its sweep: geometry carved
   *  inside a wall mass, which no camera can see and no ball can ride. */
  buriedArcs: number;
  /**
   * How many DISTINCT curve shapes the floor contains, bucketed by radius (to
   * the half-tile) and sweep (to 22.5°).
   *
   * The number the render demanded. Every blue crescent in the screenshot was
   * the same quarter-turn of the same radius, and no count of arcs could say
   * so — 67 arcs reads as variety until you ask how many of them are the same
   * arc. `arc-sweeps.ts` concedes the cause in its own header: `FILLET_RADII`
   * is [3, 2] and "a rail's length is one quarter-turn", so the vocabulary is
   * two radii by one sweep by four rotations, and rotation is not variety.
   */
  shapes: CountRow[];
  /** Arcs carrying a booster LANE (the rideable inside curve) or KICKER rubber.
   *  A plain arc is scenery; these two are the only ones that do anything. */
  dressed: { lanes: number; kicks: number; plain: number };
  /** Arcs with no part within RAY tiles of the surface — a curve nobody was
   *  aimed at and nothing catches you after. */
  unattached: number;
}

export interface MassRules {
  /** 8-connected components of wall. "How many rock islands is this floor?" */
  masses: number;
  /** Components of 4 tiles or fewer: debris, not architecture. */
  debris: number;
  /** Tiles in the single largest mass, as a share of all wall. A floor whose
   *  stone is one connected shell is a cavern; many small masses is a scatter. */
  largestShare: number;
  /** Wall tiles carrying a non-square SHAPE that no walkable tile can see. */
  buriedShaped: number;
  shapedTiles: number;
  /** Parts more than 3 tiles from ANY wall — furniture floating in open space,
   *  which is what "bumpers sprinkled like confetti" looks like as a number. */
  floatingParts: number;
}

export interface LaunchRules {
  launchers: number;
  /** Launchers whose exit ray lands on another part. */
  fed: number;
  /** Launchers firing at nothing — the hard invariant's population. */
  orphans: number;
  /** Launchers with less than MIN_RUNWAY open tiles ahead: firing into rock. */
  intoRock: number;
}

export interface PatternCensus {
  walkable: number;
  geometry: Concentration & { top: MotifRow[] };
  furniture: {
    parts: number;
    per1k: number;
    kinds: CountRow[];
    /** Membership: how much of the floor is AUTHORED versus scattered. */
    grouped: { asm: number; circuit: number; chain: number; spine: number; loose: number };
    motifs: Concentration & { top: CountRow[] };
  };
  handoffs: Concentration & { top: CountRow[]; chains: number; longest: number };
  walls: WallRules;
  masses: MassRules;
  curves: CurveRules;
  launch: LaunchRules;
}

// ── 1. GEOMETRY MOTIFS ──────────────────────────────────────────────────────

/**
 * The eight symmetries of the square, as index remaps on a K*K patch.
 *
 * Precomputed once rather than rotating bit by bit per tile: at 40k tiles and 8
 * transforms this is the inner loop, and an index table makes it a gather.
 */
function dihedralMaps(k: number): number[][] {
  const maps: number[][] = [];
  for (let t = 0; t < 8; t++) {
    const m: number[] = [];
    for (let y = 0; y < k; y++) {
      for (let x = 0; x < k; x++) {
        // t & 4 = transpose, t & 1 = flip x, t & 2 = flip y.
        let sx = t & 4 ? y : x;
        let sy = t & 4 ? x : y;
        if (t & 1) sx = k - 1 - sx;
        if (t & 2) sy = k - 1 - sy;
        m.push(sy * k + sx);
      }
    }
    maps.push(m);
  }
  return maps;
}

/** Canonical key for a patch: the smallest of its eight symmetric readings. */
function canonicalPatch(bits: Uint8Array, maps: number[][]): number {
  let best = Infinity;
  for (const m of maps) {
    let v = 0;
    for (let n = 0; n < m.length; n++) v = v * 2 + bits[m[n]];
    if (v < best) best = v;
  }
  return best;
}

function patchArt(key: number, k: number): string {
  const rows: string[] = [];
  const total = k * k;
  for (let y = 0; y < k; y++) {
    let s = "";
    for (let x = 0; x < k; x++) {
      const bit = (key >> (total - 1 - (y * k + x))) & 1;
      s += bit ? "." : "#";
    }
    rows.push(s);
  }
  return rows.join("/");
}

function concentrationOf(counts: Map<unknown, number>, total: number): Concentration {
  const sorted = [...counts.values()].sort((a, b) => b - a);
  const top20 = sorted.slice(0, 20).reduce((s, n) => s + n, 0);
  let h = 0;
  for (const n of sorted) {
    const p = n / total;
    if (p > 0) h -= p * Math.log2(p);
  }
  const max = Math.log2(Math.max(2, sorted.length));
  return { distinct: sorted.length, top20Share: total ? top20 / total : 0, evenness: h / max };
}

function geometryMotifs(g: Grid): Concentration & { top: MotifRow[] } {
  const maps = dihedralMaps(MOTIF_K);
  const half = (MOTIF_K - 1) >> 1;
  const bits = new Uint8Array(MOTIF_K * MOTIF_K);
  const counts = new Map<number, number>();
  let total = 0;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (!isWalkable(g, i, j)) continue;
      let n = 0;
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          bits[n++] = isWalkable(g, i + dx, j + dy) ? 1 : 0;
        }
      }
      const key = canonicalPatch(bits, maps);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      total++;
    }
  }
  const conc = concentrationOf(counts, total);
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([key, n]) => ({ art: patchArt(key, MOTIF_K), n, share: n / total }));
  return { ...conc, top };
}

// ── 2 & 3. FURNITURE ────────────────────────────────────────────────────────

function rankCounts(counts: Map<string, number>, total: number, take: number): CountRow[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, take)
    .map(([key, n]) => ({ key, n, share: total ? n / total : 0 }));
}

function furnitureCensus(parts: PinballPartSpot[], walkable: number): PatternCensus["furniture"] {
  const kinds = new Map<string, number>();
  const grouped = { asm: 0, circuit: 0, chain: 0, spine: 0, loose: 0 };
  for (const p of parts) {
    kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1);
    // Deliberately exclusive and in this order: a part inside a machine is
    // reported as a machine part even though the circuit author may also have
    // claimed it, because the machine is the stronger statement about intent.
    if (p.asm) grouped.asm++;
    else if (p.circuit !== undefined) grouped.circuit++;
    else if (p.chain) grouped.chain++;
    else if (p.spine) grouped.spine++;
    else grouped.loose++;
  }

  // Furniture motifs: a part's kind, plus the sorted kinds within FURNITURE_R.
  // Sorted so "bumper next to booster" and "booster next to bumper" are one
  // motif — the pair is the idea, the reading order is not.
  const byCell = new Map<number, PinballPartSpot[]>();
  const CELL = FURNITURE_R;
  const cellKey = (i: number, j: number) => ((j / CELL) | 0) * 100000 + ((i / CELL) | 0);
  for (const p of parts) {
    const k = cellKey(p.i, p.j);
    const arr = byCell.get(k);
    if (arr) arr.push(p);
    else byCell.set(k, [p]);
  }
  const motifs = new Map<string, number>();
  for (const p of parts) {
    const near: string[] = [];
    const ci = (p.i / CELL) | 0;
    const cj = (p.j / CELL) | 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        for (const q of byCell.get((cj + dj) * 100000 + (ci + di)) ?? []) {
          if (q === p) continue;
          if (Math.max(Math.abs(q.i - p.i), Math.abs(q.j - p.j)) <= FURNITURE_R) near.push(q.kind);
        }
      }
    }
    near.sort();
    const key = near.length ? `${p.kind} + ${near.join(",")}` : `${p.kind} (alone)`;
    motifs.set(key, (motifs.get(key) ?? 0) + 1);
  }

  return {
    parts: parts.length,
    per1k: walkable ? (parts.length * 1000) / walkable : 0,
    kinds: rankCounts(kinds, parts.length, 40),
    grouped,
    motifs: { ...concentrationOf(motifs, parts.length), top: rankCounts(motifs, parts.length, 15) },
  };
}

// ── 4. HAND-OFF n-GRAMS ─────────────────────────────────────────────────────

function handoffCensus(g: Grid, parts: PinballPartSpot[]): PatternCensus["handoffs"] {
  const next = successorsOf(g, parts as unknown as FlowPart[]);
  const counts = new Map<string, number>();
  let total = 0;
  let longest = 0;
  let chains = 0;
  // Depth-first from every part that nothing feeds — a chain's HEAD. Starting
  // anywhere else would count the same triple once per suffix and report a
  // repetition the floor does not have.
  const fedBy = new Set([...next.values()]);
  for (let n = 0; n < parts.length; n++) {
    if (fedBy.has(n)) continue;
    const seen = new Set<number>();
    const path: number[] = [];
    let cur: number | undefined = n;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      path.push(cur);
      cur = next.get(cur);
    }
    if (path.length >= 2) chains++;
    longest = Math.max(longest, path.length);
    for (let k = 0; k + 2 < path.length; k++) {
      const key = `${parts[path[k]].kind} → ${parts[path[k + 1]].kind} → ${parts[path[k + 2]].kind}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      total++;
    }
  }
  return { ...concentrationOf(counts, total), top: rankCounts(counts, total, 12), chains, longest };
}

// ── 5a. WALL RULES ──────────────────────────────────────────────────────────

function isWallTile(g: Grid, i: number, j: number): boolean {
  const t = at(g, i, j);
  return t === T_WALL || t === T_CRACKED;
}

/** Does this wall tile touch open floor in any of the 8 directions? */
function isSurfaceWall(g: Grid, i: number, j: number): boolean {
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      if (isWalkable(g, i + di, j + dj)) return true;
    }
  }
  return false;
}

function wallCensus(g: Grid, floor: MegaFloor): WallRules {
  let wallTiles = 0;
  let interior = 0;
  const separators: Record<number, number> = {};
  const surfaceRuns: Record<number, number> = {};

  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (!isWallTile(g, i, j)) continue;
      wallTiles++;
      if (!isSurfaceWall(g, i, j)) interior++;
    }
  }

  // Separators: from every walkable tile, step E and S only. Counting all four
  // cardinals would count each separator twice from its two sides, which does
  // not change the SHAPE of the histogram but does make "thick share" read as a
  // rate over a doubled population. Two directions is the same measurement,
  // honestly normalised.
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (!isWalkable(g, i, j)) continue;
      for (const [di, dj] of [
        [1, 0],
        [0, 1],
      ] as const) {
        let n = 0;
        let x = i + di;
        let y = j + dj;
        while (n < 8 && x >= 0 && y >= 0 && x < g.w && y < g.h && isWallTile(g, x, y)) {
          n++;
          x += di;
          y += dj;
        }
        // Only a run that ENDS in walkable floor is a separator. A run that
        // walks off the grid or into the interior is the floor's outer shell,
        // and calling that "a wall thicker than it needs to be" would flag the
        // one wall that genuinely has nothing on its far side.
        if (n > 0 && x >= 0 && y >= 0 && x < g.w && y < g.h && isWalkable(g, x, y)) {
          const bucket = Math.min(n, 8);
          separators[bucket] = (separators[bucket] ?? 0) + 1;
        }
      }
    }
  }
  const sepTotal = Object.values(separators).reduce((s, n) => s + n, 0);
  const thick = Object.entries(separators)
    .filter(([k]) => Number(k) >= 3)
    .reduce((s, [, n]) => s + n, 0);

  // Straight runs of SURFACE wall, horizontal and vertical. Long identical runs
  // are the visual signature of "a corridor is two parallel lines".
  for (const [di, dj] of [
    [1, 0],
    [0, 1],
  ] as const) {
    for (let j = 0; j < g.h; j++) {
      for (let i = 0; i < g.w; i++) {
        const prevI = i - di;
        const prevJ = j - dj;
        const isRun = isWallTile(g, i, j) && isSurfaceWall(g, i, j) && g.shapes[idx(g, i, j)] === SHAPE_FULL;
        if (!isRun) continue;
        const prevRun =
          prevI >= 0 &&
          prevJ >= 0 &&
          isWallTile(g, prevI, prevJ) &&
          isSurfaceWall(g, prevI, prevJ) &&
          g.shapes[idx(g, prevI, prevJ)] === SHAPE_FULL;
        if (prevRun) continue; // not the head of a run
        let n = 0;
        let x = i;
        let y = j;
        while (
          x < g.w &&
          y < g.h &&
          isWallTile(g, x, y) &&
          isSurfaceWall(g, x, y) &&
          g.shapes[idx(g, x, y)] === SHAPE_FULL
        ) {
          n++;
          x += di;
          y += dj;
        }
        const bucket = Math.min(n, 20);
        surfaceRuns[bucket] = (surfaceRuns[bucket] ?? 0) + 1;
      }
    }
  }

  // Stubs — a corridor that ends. Not automatically a defect (the Oracle Frog
  // wants one, a secret wants one), which is why the interesting number is the
  // EMPTY ones.
  const occupied = new Set<number>();
  const mark = (t: TilePos) => occupied.add(idx(g, t.i, t.j));
  floor.plan.parts.forEach(mark);
  floor.plan.items.forEach(mark);
  floor.plan.torches.forEach(mark);
  floor.plan.props.forEach(mark);
  floor.plan.secrets.forEach(mark);
  if (floor.plan.frog) mark(floor.plan.frog);
  let stubs = 0;
  let emptyStubs = 0;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (!isWalkable(g, i, j)) continue;
      let deg = 0;
      for (const [di, dj] of CARDS) if (isWalkable(g, i + di, j + dj)) deg++;
      if (deg !== 1) continue;
      stubs++;
      let has = false;
      for (let dj = -2; dj <= 2 && !has; dj++) {
        for (let di = -2; di <= 2 && !has; di++) {
          const x = i + di;
          const y = j + dj;
          if (x >= 0 && y >= 0 && x < g.w && y < g.h && occupied.has(idx(g, x, y))) has = true;
        }
      }
      if (!has) emptyStubs++;
    }
  }

  return {
    wallTiles,
    interiorShare: wallTiles ? interior / wallTiles : 0,
    separators,
    thickSeparatorShare: sepTotal ? thick / sepTotal : 0,
    surfaceRuns,
    stubs,
    emptyStubs,
  };
}

// ── 5b. CURVE RULES ─────────────────────────────────────────────────────────

/** A point on the arc's surface at polar angle `ang`. */
function arcPoint(f: ArcFeature, ang: number): { x: number; z: number } {
  return { x: f.cx + f.r * Math.cos(ang), z: f.cz + f.r * Math.sin(ang) };
}

/**
 * Does a ray from (x,z) heading (dx,dz) reach something worth arriving at?
 *
 * "Something" is deliberately broad — a part, a doorway, the stairs, or simply
 * a genuine opening (RAY tiles of clear floor is a shot, not a pocket). The
 * question this answers is the player's: having been banked around this curve,
 * is there anywhere to go?
 */
function rayFeeds(g: Grid, targets: Set<number>, x: number, z: number, dx: number, dz: number): boolean {
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  let open = 0;
  for (let s = 1; s <= RAY; s++) {
    const i = Math.round(x + ux * s);
    const j = Math.round(z + uz * s);
    if (i < 0 || j < 0 || i >= g.w || j >= g.h) return false;
    if (!isWalkable(g, i, j)) return open >= RAY - 2;
    open++;
    if (targets.has(idx(g, i, j))) return true;
  }
  return open >= MIN_RUNWAY * 2;
}

function curveCensus(g: Grid, floor: MegaFloor): CurveRules {
  const arcs = g.arcs ?? [];
  const byOwner: Record<string, number> = {};
  let closed = 0;
  let fedEnds = 0;
  let deadEnds = 0;
  let buried = 0;
  let unattached = 0;
  const shapes = new Map<string, number>();
  const dressed = { lanes: 0, kicks: 0, plain: 0 };

  const targets = new Set<number>();
  for (const p of floor.plan.parts) targets.add(idx(g, p.i, p.j));
  for (const d of floor.doorways) targets.add(idx(g, d.i, d.j));
  targets.add(idx(g, floor.stairs.i, floor.stairs.j));

  for (const f of arcs) {
    byOwner[f.owner ?? "sweep"] = (byOwner[f.owner ?? "sweep"] ?? 0) + 1;

    // SHAPE identity: radius to the half-tile, sweep to 22.5 degrees. Rotation
    // and reflection are deliberately NOT part of the key — four rotations of a
    // quarter-turn fillet are one idea, and calling them four would report the
    // variety the render says is not there.
    const rKey = (Math.round(f.r * 2) / 2).toFixed(1);
    const sKey = Math.round(f.span / (Math.PI / 8));
    shapes.set(`r${rKey} × ${(sKey * 22.5).toFixed(0)}°`, (shapes.get(`r${rKey} × ${(sKey * 22.5).toFixed(0)}°`) ?? 0) + 1);
    if (f.lanes?.length) dressed.lanes++;
    else if (f.kicks?.length) dressed.kicks++;
    else dressed.plain++;

    // UNATTACHED: nothing on the floor within a shove of this curve. A bank
    // that no part aims into and that hands off to no part is scenery — the
    // "curve stuck on a random rock" the render is full of.
    let near = false;
    for (const p of floor.plan.parts) {
      if (Math.hypot(p.i - f.cx, p.j - f.cz) <= f.r + RAY) {
        near = true;
        break;
      }
    }
    if (!near) unattached++;

    // BURIED: sample the sweep and ask whether the OPEN side is open. A curve
    // whose face looks at more wall is masonry the camera never sees — the
    // failure `piece-rules` calls unbacked, read from the other side.
    const samples = 9;
    let facingWall = 0;
    for (let s = 0; s < samples; s++) {
      const ang = f.a0 + (f.span * s) / (samples - 1 || 1);
      const p = arcPoint(f, ang);
      // The open side is outward for a solid-inside face, inward for a bowl.
      const sign = f.solidOut ? -1 : 1;
      const i = Math.round(p.x + sign * 1.5 * Math.cos(ang));
      const j = Math.round(p.z + sign * 1.5 * Math.sin(ang));
      if (i < 0 || j < 0 || i >= g.w || j >= g.h || !isWalkable(g, i, j)) facingWall++;
    }
    if (facingWall > samples / 2) buried++;

    if (f.span >= Math.PI * 2 - 1e-3) {
      closed++;
      continue;
    }
    // Each end continues along its own tangent, in the direction that leaves
    // the arc. Tangent at polar angle a is (-sin a, cos a) for increasing a, so
    // the far end leaves along +tangent and the near end along −tangent.
    //
    // ⚠️ THE RAY MUST START OFF THE SURFACE. An arc endpoint is a point ON the
    // wall face, so a tangent march from it stays at radius r and rounds to a
    // wall tile on step one — every curve then reads as a dead end for a reason
    // that is about the probe, not the floor. Measured: starting on the surface
    // called 114 of 132 ends dead; starting a ball-radius clear of it is the
    // question actually being asked, which is where a ball leaving this curve
    // ends up. This is the failure `piece-rules.ts` records at length — a probe
    // whose shape condemns working geometry.
    const off = f.solidOut ? -CLEARANCE : CLEARANCE;
    for (const [ang, way] of [
      [f.a0 + f.span, 1],
      [f.a0, -1],
    ] as const) {
      const p = arcPoint(f, ang);
      const dx = -Math.sin(ang) * way;
      const dz = Math.cos(ang) * way;
      const sx = p.x + off * Math.cos(ang);
      const sz = p.z + off * Math.sin(ang);
      if (rayFeeds(g, targets, sx, sz, dx, dz)) fedEnds++;
      else deadEnds++;
    }
  }

  return {
    arcs: arcs.length,
    per1k: floor.walkable ? (arcs.length * 1000) / floor.walkable : 0,
    byOwner,
    closed,
    fedEnds,
    deadEnds,
    buriedArcs: buried,
    shapes: rankCounts(shapes, arcs.length, 12),
    dressed,
    unattached,
  };
}

// ── 5d. WALL MASSES ─────────────────────────────────────────────────────────

/**
 * What the stone is made of, as objects rather than as tiles.
 *
 * The render's finding: the floor is not corridors, it is an open plain with
 * rock blobs in it, and the blobs are built of 2x2 chunks with single-block
 * steps. "56.9% open" cannot say that; a component census can. The three
 * numbers that matter are how many separate masses there are, how much of the
 * stone is in the biggest one (a cavern shell versus a scatter), and how many
 * masses are too small to be architecture at all.
 */
function massCensus(g: Grid, parts: PinballPartSpot[]): MassRules {
  const seen = new Uint8Array(g.w * g.h);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const s = idx(g, i, j);
      if (seen[s] || !isWallTile(g, i, j)) continue;
      let n = 0;
      stack.push(s);
      seen[s] = 1;
      while (stack.length) {
        const cur = stack.pop()!;
        const ci = cur % g.w;
        const cj = (cur / g.w) | 0;
        n++;
        // 8-connected: a diagonal touch is one rock to the eye, and this
        // census exists to count what the eye counts.
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue;
            const x = ci + di;
            const y = cj + dj;
            if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
            const k = idx(g, x, y);
            if (seen[k] || !isWallTile(g, x, y)) continue;
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
      sizes.push(n);
    }
  }
  const total = sizes.reduce((s, n) => s + n, 0) || 1;

  let shapedTiles = 0;
  let buriedShaped = 0;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (!isWallTile(g, i, j)) continue;
      if (g.shapes[idx(g, i, j)] === SHAPE_FULL) continue;
      shapedTiles++;
      if (!isSurfaceWall(g, i, j)) buriedShaped++;
    }
  }

  // FLOATING PARTS: nothing solid within 3 tiles. A pinball part is a thing you
  // are meant to bounce OFF or BE THROWN INTO; one in the middle of a plain is
  // an obstacle you steer round, which is the opposite of a table.
  let floating = 0;
  for (const p of parts) {
    let solid = false;
    for (let dj = -3; dj <= 3 && !solid; dj++) {
      for (let di = -3; di <= 3 && !solid; di++) {
        if (isWallTile(g, p.i + di, p.j + dj)) solid = true;
      }
    }
    if (!solid) floating++;
  }

  return {
    masses: sizes.length,
    debris: sizes.filter((n) => n <= 4).length,
    largestShare: Math.max(0, ...sizes) / total,
    buriedShaped,
    shapedTiles,
    floatingParts: floating,
  };
}

// ── 5c. LAUNCH RULES ────────────────────────────────────────────────────────

const LAUNCH_KINDS = new Set<PartSpotKind>([
  "ramp",
  "booster",
  "boostcorner",
  "boostcurve",
  "spring",
  "slingshot",
  "flipper",
  "jumppad",
]);

function launchCensus(g: Grid, parts: PinballPartSpot[]): LaunchRules {
  const next = successorsOf(g, parts as unknown as FlowPart[]);
  let launchers = 0;
  let fed = 0;
  let orphans = 0;
  let intoRock = 0;
  for (let n = 0; n < parts.length; n++) {
    const p = parts[n];
    if (!LAUNCH_KINDS.has(p.kind)) continue;
    // A vault ramp is aimed at a wall ON PURPOSE and a chute pad IS the lane;
    // both would read as orphans and neither is one (`PinballPartSpot.vault`).
    if (p.vault || p.chute) continue;
    launchers++;
    if (next.has(n)) fed++;
    else orphans++;
    const [dx, dz] = exitRay(p as unknown as FlowPart);
    const di = Math.abs(dx) >= Math.abs(dz) ? Math.sign(dx) : 0;
    const dj = Math.abs(dx) >= Math.abs(dz) ? 0 : Math.sign(dz);
    if (!di && !dj) continue;
    let open = 0;
    for (let s = 1; s <= MIN_RUNWAY; s++) {
      if (!isWalkable(g, p.i + di * s, p.j + dj * s)) break;
      open++;
    }
    if (open < MIN_RUNWAY) intoRock++;
  }
  return { launchers, fed, orphans, intoRock };
}

// ── The census ──────────────────────────────────────────────────────────────

export function censusPatterns(floor: MegaFloor): PatternCensus {
  const g = floor.grid;
  return {
    walkable: floor.walkable,
    geometry: geometryMotifs(g),
    furniture: furnitureCensus(floor.plan.parts, floor.walkable),
    handoffs: handoffCensus(g, floor.plan.parts),
    walls: wallCensus(g, floor),
    masses: massCensus(g, floor.plan.parts),
    curves: curveCensus(g, floor),
    launch: launchCensus(g, floor.plan.parts),
  };
}

// ── Reporting ───────────────────────────────────────────────────────────────

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function histLine(h: Record<number, number>, cap: number): string {
  const total = Object.values(h).reduce((s, n) => s + n, 0) || 1;
  return Object.keys(h)
    .map(Number)
    .sort((a, b) => a - b)
    .map((k) => `${k}${k === cap ? "+" : ""}:${pct(h[k] / total)}`)
    .join("  ");
}

export function formatCensus(floor: MegaFloor, c: PatternCensus, ref?: { floor: MegaFloor; census: PatternCensus }): string {
  const L: string[] = [];
  const cmp = (mine: number, theirs: number | undefined, digits = 2) =>
    theirs === undefined ? "" : `   (shipped ${theirs.toFixed(digits)})`;

  L.push("");
  L.push("══ MEGA MAP ═══════════════════════════════════════════════════════════════");
  L.push(
    `L${floor.level} ${floor.archetype}/${floor.theme}/${floor.modifier}  seed ${floor.runSeed}  ` +
      `${floor.cellsW}x${floor.cellsH} cells = ${floor.grid.w}x${floor.grid.h} tiles`,
  );
  L.push(`walkable ${c.walkable}  =  ${floor.areaRatio.toFixed(1)}x a shipped L${floor.level}`);
  if (floor.relaxed.length) L.push(`relaxed rules: ${floor.relaxed.join(", ")}`);

  L.push("");
  L.push("── 1. GEOMETRY: how many ideas is this maze made of? ──────────────────────");
  L.push(`  ${MOTIF_K}x${MOTIF_K} neighbourhoods, folded under the 8 symmetries of the square`);
  L.push(
    `  distinct ${c.geometry.distinct}${cmp(c.geometry.distinct, ref?.census.geometry.distinct, 0)}` +
      `   top-20 cover ${pct(c.geometry.top20Share)}${ref ? `   (shipped ${pct(ref.census.geometry.top20Share)})` : ""}` +
      `   evenness ${c.geometry.evenness.toFixed(2)}`,
  );
  L.push("");
  const rows = c.geometry.top.slice(0, 8);
  for (let r = 0; r < MOTIF_K; r++) {
    L.push("   " + rows.map((m) => m.art.split("/")[r]).join("   "));
  }
  L.push("   " + rows.map((m) => pct(m.share).padEnd(MOTIF_K + 3)).join(""));

  L.push("");
  L.push("── 2. FURNITURE VOCABULARY ────────────────────────────────────────────────");
  L.push(`  ${c.furniture.parts} parts  =  ${c.furniture.per1k.toFixed(1)} per 1k walkable${cmp(c.furniture.per1k, ref?.census.furniture.per1k, 1)}`);
  const gk = c.furniture.grouped;
  const gTot = c.furniture.parts || 1;
  L.push(
    `  in a MACHINE ${pct(gk.asm / gTot)}   in a CIRCUIT ${pct(gk.circuit / gTot)}   ` +
      `chain link ${pct(gk.chain / gTot)}   spine ${pct(gk.spine / gTot)}   LOOSE ${pct(gk.loose / gTot)}`,
  );
  L.push("");
  for (const k of c.furniture.kinds.slice(0, 22)) {
    L.push(`    ${k.key.padEnd(12)} ${String(k.n).padStart(5)}  ${pct(k.share).padStart(6)}  ${"█".repeat(Math.round(k.share * 60))}`);
  }

  L.push("");
  L.push("── 3. FURNITURE MOTIFS: the lego pieces this generator actually emits ─────");
  L.push(
    `  distinct ${c.furniture.motifs.distinct}   top-20 cover ${pct(c.furniture.motifs.top20Share)}   evenness ${c.furniture.motifs.evenness.toFixed(2)}`,
  );
  for (const m of c.furniture.motifs.top) L.push(`    ${pct(m.share).padStart(6)}  ${m.key}`);

  L.push("");
  L.push("── 4. HAND-OFFS: the combos a player can ride ─────────────────────────────");
  L.push(`  ${c.handoffs.chains} chains, longest ${c.handoffs.longest} parts   distinct triples ${c.handoffs.distinct}   top-20 cover ${pct(c.handoffs.top20Share)}`);
  for (const m of c.handoffs.top) L.push(`    ${pct(m.share).padStart(6)}  ${m.key}`);

  L.push("");
  L.push("── 5. WALL RULES ─────────────────────────────────────────────────────────");
  L.push(`  wall tiles ${c.walls.wallTiles}   INTERIOR (no floor adjacent, invisible) ${pct(c.walls.interiorShare)}${ref ? `   (shipped ${pct(ref.census.walls.interiorShare)})` : ""}`);
  L.push(`  separator thickness   ${histLine(c.walls.separators, 8)}`);
  L.push(`    ↳ 3+ thick: ${pct(c.walls.thickSeparatorShare)} — two corridors that carry two walls where one would do`);
  L.push(`  straight surface-wall runs (tiles)  ${histLine(c.walls.surfaceRuns, 20)}`);
  L.push(`  corridor stubs ${c.walls.stubs}   of which EMPTY (nothing within 2 tiles) ${c.walls.emptyStubs} (${pct(c.walls.stubs ? c.walls.emptyStubs / c.walls.stubs : 0)})`);

  L.push("");
  L.push("── 6. WALL MASSES: what is the stone actually made of? ───────────────────");
  L.push(
    `  ${c.masses.masses} separate masses   largest holds ${pct(c.masses.largestShare)} of all stone   ` +
      `debris (≤4 tiles) ${c.masses.debris} (${pct(c.masses.masses ? c.masses.debris / c.masses.masses : 0)})`,
  );
  L.push(
    `  shaped (non-square) wall tiles ${c.masses.shapedTiles}   of which BURIED where nothing can see them ${c.masses.buriedShaped} ` +
      `(${pct(c.masses.shapedTiles ? c.masses.buriedShaped / c.masses.shapedTiles : 0)})`,
  );
  L.push(
    `  FLOATING parts (no stone within 3 tiles) ${c.masses.floatingParts} (${pct(c.furniture.parts ? c.masses.floatingParts / c.furniture.parts : 0)})` +
      `${ref ? `   (shipped ${pct(ref.census.masses.floatingParts / (ref.census.furniture.parts || 1))})` : ""}`,
  );

  L.push("");
  L.push("── 7. CURVE RULES ────────────────────────────────────────────────────────");
  L.push(
    `  ${c.curves.arcs} arcs = ${c.curves.per1k.toFixed(2)} per 1k walkable${cmp(c.curves.per1k, ref?.census.curves.per1k, 2)}   ` +
      `owners ${Object.entries(c.curves.byOwner).map(([k, n]) => `${k}:${n}`).join(" ") || "—"}`,
  );
  L.push(`  DISTINCT CURVE SHAPES: ${c.curves.shapes.length}   ${c.curves.shapes.map((s) => `${s.key} ×${s.n}`).join("   ")}`);
  L.push(
    `  dressed: booster LANE ${c.curves.dressed.lanes}   kicker RUBBER ${c.curves.dressed.kicks}   ` +
      `PLAIN STONE ${c.curves.dressed.plain} (${pct(c.curves.arcs ? c.curves.dressed.plain / c.curves.arcs : 0)})`,
  );
  const ends = c.curves.fedEnds + c.curves.deadEnds;
  L.push(`  open-ended arcs ${c.curves.arcs - c.curves.closed}, closed islands ${c.curves.closed}`);
  L.push(`  ends that FEED something within ${RAY} tiles: ${c.curves.fedEnds}/${ends} (${pct(ends ? c.curves.fedEnds / ends : 0)})`);
  L.push(`    ↳ DEAD ENDS: ${c.curves.deadEnds} — a curve that banks you into nothing`);
  L.push(`  UNATTACHED (no part within a shove of the curve): ${c.curves.unattached} (${pct(c.curves.arcs ? c.curves.unattached / c.curves.arcs : 0)})`);
  L.push(`  BURIED arcs (face looks at wall, invisible): ${c.curves.buriedArcs} (${pct(c.curves.arcs ? c.curves.buriedArcs / c.curves.arcs : 0)})`);

  L.push("");
  L.push("── 8. LAUNCHERS ──────────────────────────────────────────────────────────");
  const lt = c.launch.launchers || 1;
  L.push(`  ${c.launch.launchers} launchers   fed ${pct(c.launch.fed / lt)}   ORPHANS ${c.launch.orphans} (${pct(c.launch.orphans / lt)})   firing into rock ${c.launch.intoRock} (${pct(c.launch.intoRock / lt)})`);

  if (ref) L.push(scaleCheck(floor, c, ref));
  L.push("");
  return L.join("\n");
}

/**
 * MEGA vs SHIPPED, side by side. The section that decides what to believe.
 *
 * A mega floor is an instrument, and an instrument that distorts what it
 * magnifies is worse than none — a defect that appears only at 10x is a
 * property of the harness, not of the game. Every headline number is therefore
 * printed against the same statistic on a SHIPPED-SIZE floor of the same level
 * and seed, and a rule is only worth writing when both columns agree.
 *
 * This is the same discipline `dev/headless-floor.ts` records at length: a
 * harness that drifts from the shipped chain drifts in the direction that hides
 * the bug. There it was the draw order; here it is the grid size.
 */
function scaleCheck(floor: MegaFloor, c: PatternCensus, ref: { floor: MegaFloor; census: PatternCensus }): string {
  const L: string[] = [];
  const r = ref.census;
  L.push("");
  L.push("── 9. SCALE CHECK: does the mega floor still behave like a shipped one? ───");
  L.push(`  reference: ${ref.floor.grid.w}x${ref.floor.grid.h} tiles, walkable ${ref.floor.walkable}   vs mega ${floor.grid.w}x${floor.grid.h}, walkable ${floor.walkable}`);
  L.push("");
  const row = (name: string, a: number, b: number, fmt: (x: number) => string, want: "same" | "info" = "same") => {
    const drift = b === 0 ? (a === 0 ? 0 : Infinity) : a / b;
    const flag = want === "info" ? " " : Number.isFinite(drift) && drift > 0.6 && drift < 1.7 ? "✓" : "⚠";
    L.push(`   ${flag} ${name.padEnd(30)} mega ${fmt(a).padStart(9)}   shipped ${fmt(b).padStart(9)}   x${Number.isFinite(drift) ? drift.toFixed(2) : "∞"}`);
  };
  const f1 = (x: number) => x.toFixed(1);
  const f2 = (x: number) => x.toFixed(2);
  row("open share of grid", floor.walkable / (floor.grid.w * floor.grid.h), ref.floor.walkable / (ref.floor.grid.w * ref.floor.grid.h), pct);
  row("parts per 1k walkable", c.furniture.per1k, r.furniture.per1k, f1);
  row("arcs per 1k walkable", c.curves.per1k, r.curves.per1k, f2);
  row("distinct 5x5 motifs", c.geometry.distinct, r.geometry.distinct, (x) => String(Math.round(x)), "info");
  row("top-20 motif coverage", c.geometry.top20Share, r.geometry.top20Share, pct);
  row("interior (invisible) wall", c.walls.interiorShare, r.walls.interiorShare, pct);
  row("separators 3+ thick", c.walls.thickSeparatorShare, r.walls.thickSeparatorShare, pct);
  row("orphan launcher share", c.launch.orphans / (c.launch.launchers || 1), r.launch.orphans / (r.launch.launchers || 1), pct);
  row("parts inside a MACHINE", c.furniture.grouped.asm / (c.furniture.parts || 1), r.furniture.grouped.asm / (r.furniture.parts || 1), pct);
  row("parts LOOSE", c.furniture.grouped.loose / (c.furniture.parts || 1), r.furniture.grouped.loose / (r.furniture.parts || 1), pct);
  row("floating parts", c.masses.floatingParts / (c.furniture.parts || 1), r.masses.floatingParts / (r.furniture.parts || 1), pct);
  row("distinct curve shapes", c.curves.shapes.length, r.curves.shapes.length, (x) => String(Math.round(x)), "info");
  L.push("");
  L.push("   ✓ = mega is within 0.6-1.7x of shipped, so a defect here is the GENERATOR's.");
  L.push("   ⚠ = the statistic moved with grid size. Do not write a rule from this column alone;");
  L.push("       either fix the scale dependence or read the shipped number.");
  return L.join("\n");
}
