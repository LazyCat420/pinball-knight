/**
 * OPEN SPACE — where the floor's furniture ISN'T, as numbers with bands.
 *
 * ── Why a third metric module ─────────────────────────────────────────────
 *
 * `floor-metrics` measures the floor's SHAPE. `floor-density` measures HOW MUCH
 * is on it. Neither can answer the live QA complaint that opened this work:
 * "make these open spaces be filled out … so there's not just blank spaces for
 * too long". That is a question about DISTRIBUTION, and the two existing
 * modules are structurally blind to it in the same way:
 *
 *   · every `DensityMetrics` bound is per-1k-walkable and floor-wide, so a
 *     floor can sit at `maxPartsPer1k` globally with a completely dead plaza
 *     and pass;
 *   · `chamberShare` knows a big open room exists but nothing about what is
 *     standing in it.
 *
 * Censused before this module existed, the Great Hall's plaza — the one place
 * per floor deliberately carved open for pinball (see `carveChamber`) — was
 * receiving its furniture from two passes that together resolve at about ONE
 * PART PER 576 TILES: `polishParts` §3 stamps a bumper diamond on at most
 * `clamp(walkable/900, 2, 8)` sites floor-wide, and the sparse-region fill
 * drops a single omni part into each 24×24 region that holds none.
 *
 * ── Why "barren", and not more clearance ──────────────────────────────────
 *
 * `clearanceField` (maze/doorways.ts) answers "how far from a wall", which is a
 * PROXY. Distance-from-a-wall is high in a plaza and also high in a wide
 * corridor, and a wide corridor with nothing in it is fine — that is transit.
 * The quantity the complaint actually names is distance to the nearest thing
 * you can HIT, and the defect is the conjunction: tiles that are both open and
 * barren. Hence `openDeadShare`, which scores ~0 for a long empty corridor and
 * ~1 for an empty plaza.
 *
 * ── Why geodesic, and not another chamfer ─────────────────────────────────
 *
 * `clearanceField` gets away with two sweeps because it measures distance to
 * the nearest SOLID, and solids are what a sweep would otherwise have to route
 * around — there is nothing in its way by construction. Barrenness is the
 * opposite: the sources are sparse and the walls are obstacles, so a two-sweep
 * chamfer would see straight through rock and report a corridor as furnished
 * because the next corridor over has a bumper in it. This is a Dijkstra over
 * walkable tiles only. Same 3-4 weights and the same ×3 units as
 * `clearanceField`, so the two fields are directly comparable — which is the
 * whole point, since the headline metric is a cross-tabulation of them.
 *
 * DOM-, three- and rng-free. Pure: takes a grid and a list of tiles, returns
 * numbers.
 */
import { type Grid, type TilePos, idx, isWalkable } from "./generator";
import { clearanceField, labelSections, SECTION_CLEARANCE, MIN_SECTION_TILES, type SectionMap } from "./doorways";

/**
 * Chamfer weights, ×3. Identical to `clearanceField`'s so that a barren reading
 * and a clearance reading are in the same units and can be compared without a
 * conversion nobody would remember to apply.
 */
const ORTH = 3;
const DIAG = 4;

/** A walkable tile no part can reach at all (sealed pocket, or no parts). */
export const BARREN_UNREACHED = -1;

/**
 * How far you may travel over open floor before meeting something, in TILES,
 * before the stretch counts as dead.
 *
 * DERIVED, twice, from numbers already in the tree — not chosen:
 *
 *  · TIME. `TILE = 1` (constants/world.ts) and `BOOSTER_SPEED = 15`
 *    (constants/pinball.ts), so one tile is one world unit and a moving knight
 *    covers 15 of them a second. 12 tiles is **0.80 s of nothing**.
 *    `floor-density.ts` derives its UPPER bound from that same constant at the
 *    other end — "one part crossing your line every 0.18 s … at the edge of
 *    reading as a texture" gives `maxPartsPer1k: 34` — so the two gates now
 *    bracket the same quantity from both sides in the same unit.
 *
 *  · SPACING. `floor-density`'s `minPartsPer1k: 8` is the sparsest a floor may
 *    legitimately be. Parts at that density scattered uniformly sit a mean
 *    `0.5·√(1000/8) ≈ 5.6` tiles apart, so 12 tiles is ~2× the spacing the
 *    existing gate already calls acceptable.
 *
 * Two independent derivations landing on the same number is the reason to
 * believe it. Anything past here is a stretch of floor the player crosses with
 * nothing to do, which is the complaint verbatim.
 */
export const R_DEAD = 12;

/** `R_DEAD` in the field's own ×3 units. */
export const R_DEAD_3 = R_DEAD * ORTH;

/**
 * Geodesic distance (×3) from every walkable tile to the nearest tile holding a
 * part, over walkable tiles only. Wall tiles and tiles no part can reach read
 * `BARREN_UNREACHED`.
 *
 * Dial's algorithm rather than a binary heap: there are exactly two edge
 * weights, so all live distances lie inside a window of `DIAG + 1`, and a
 * circular bucket queue of that size pops in O(1). Linear in tiles.
 */
export function barrenField(g: Grid, parts: readonly TilePos[]): Int32Array {
  const n = g.w * g.h;
  const dist = new Int32Array(n).fill(BARREN_UNREACHED);
  const WHEEL = DIAG + 1;
  const buckets: number[][] = Array.from({ length: WHEEL }, () => []);
  let live = 0;

  const push = (k: number, d: number): void => {
    dist[k] = d;
    buckets[d % WHEEL].push(k);
    live++;
  };

  for (const p of parts) {
    if (p.i < 0 || p.j < 0 || p.i >= g.w || p.j >= g.h) continue;
    if (!isWalkable(g, p.i, p.j)) continue;
    const k = idx(g, p.i, p.j);
    if (dist[k] === 0) continue; // two parts on one tile — one source is enough
    push(k, 0);
  }
  if (live === 0) return dist;

  // Eight neighbours, with the chamfer's own cost per step.
  const STEPS: ReadonlyArray<readonly [number, number, number]> = [
    [1, 0, ORTH],
    [-1, 0, ORTH],
    [0, 1, ORTH],
    [0, -1, ORTH],
    [1, 1, DIAG],
    [1, -1, DIAG],
    [-1, 1, DIAG],
    [-1, -1, DIAG],
  ];

  for (let d = 0; live > 0; d++) {
    const bucket = buckets[d % WHEEL];
    if (bucket.length === 0) continue;
    // Copy-and-clear. With weights 3-4 and a wheel of DIAG+1 the five live
    // distances [d, d+4] occupy five distinct residues, so a relaxation can
    // never land back in the bucket being drained — this is defensive against a
    // future weight change, not a live hazard. It is cheap; a wrong wheel size
    // would otherwise silently process a far tile as if it were near.
    const batch = bucket.slice();
    bucket.length = 0;
    for (const k of batch) {
      live--;
      // A tile can be queued twice at different distances; the stale copy has a
      // dist that no longer matches the bucket it came out of.
      if (dist[k] !== d) continue;
      const x = k % g.w;
      const y = (k - x) / g.w;
      for (const [di, dj, cost] of STEPS) {
        const nx = x + di;
        const ny = y + dj;
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
        if (!isWalkable(g, nx, ny)) continue;
        const nk = idx(g, nx, ny);
        const nd = d + cost;
        if (dist[nk] !== BARREN_UNREACHED && dist[nk] <= nd) continue;
        push(nk, nd);
      }
    }
  }
  return dist;
}

/** One labelled section's furniture, for the per-room rollup. */
export interface SectionDensity {
  id: number;
  tiles: number;
  parts: number;
  partsPer1k: number;
  /** Worst barren reading inside this section, in TILES. */
  maxBarren: number;
  /** Centroid, so a census overlay can point at the offending room. */
  ci: number;
  cj: number;
}

export interface OpenSpaceMetrics {
  walkable: number;
  parts: number;
  /**
   * The furthest you can travel from the emptiest walkable tile before meeting
   * anything, in TILES. Unreachable tiles are excluded — a sealed pocket is a
   * connectivity bug and `floor-pipeline` owns it, not this module.
   */
  worstBarren: number;
  /** Share of walkable tiles whose barren reading exceeds `R_DEAD`. */
  deadShare: number;
  /**
   * THE HEADLINE. Share of walkable tiles that are BOTH open (clearance at or
   * above `SECTION_CLEARANCE`) and barren past `R_DEAD`. A long empty corridor
   * scores 0 here; an empty plaza scores near 1. This is the one number that
   * says "there are blank spaces, and they are in the rooms".
   */
  openDeadShare: number;
  /** Walkable tiles that are open by the clearance test, for context. */
  openTiles: number;
  sections: SectionDensity[];
  /**
   * THE HIERARCHY CHECK, and the one a floor-wide average cannot make: the
   * largest section's parts/1k over the whole floor's parts/1k. Below 1 the
   * biggest room on the floor is emptier than the floor average — which is the
   * Great Hall defect stated as a ratio. `Infinity`/0 guarded to 0 when there
   * is nothing to divide.
   */
  biggestSectionRatio: number;
}

/**
 * Measure one floor. `cl` is the hoisted `clearanceField` where a caller
 * already has one (`FloorRuleContext.clearance` does), since it is the single
 * most expensive thing here.
 */
export function measureOpenSpace(g: Grid, parts: readonly TilePos[], cl?: Int32Array): OpenSpaceMetrics {
  const clearance = cl ?? clearanceField(g);
  const sec = labelSections(g, clearance);
  const barren = barrenField(g, parts);
  const openMin = SECTION_CLEARANCE * ORTH;

  let walkable = 0;
  let openTiles = 0;
  let dead = 0;
  let openDead = 0;
  let worst3 = 0;

  const secTiles = sec.sizes.map(() => 0);
  const secParts = sec.sizes.map(() => 0);
  const secWorst = sec.sizes.map(() => 0);
  const secSumI = sec.sizes.map(() => 0);
  const secSumJ = sec.sizes.map(() => 0);

  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (!isWalkable(g, i, j)) continue;
      const k = idx(g, i, j);
      walkable++;
      const open = clearance[k] >= openMin;
      if (open) openTiles++;
      const b = barren[k];
      if (b === BARREN_UNREACHED) continue; // sealed, or no parts at all
      if (b > worst3) worst3 = b;
      const isDead = b > R_DEAD_3;
      if (isDead) dead++;
      if (isDead && open) openDead++;
      const s = sec.label[k];
      if (s >= 0) {
        secTiles[s]++;
        secSumI[s] += i;
        secSumJ[s] += j;
        if (b > secWorst[s]) secWorst[s] = b;
      }
    }
  }

  for (const p of parts) {
    if (p.i < 0 || p.j < 0 || p.i >= g.w || p.j >= g.h) continue;
    const s = sec.label[idx(g, p.i, p.j)];
    if (s >= 0) secParts[s]++;
  }

  const sections: SectionDensity[] = sec.sizes.map((_, s) => ({
    id: s,
    tiles: secTiles[s],
    parts: secParts[s],
    partsPer1k: secTiles[s] > 0 ? (secParts[s] * 1000) / secTiles[s] : 0,
    maxBarren: secWorst[s] / ORTH,
    ci: secTiles[s] > 0 ? Math.round(secSumI[s] / secTiles[s]) : 0,
    cj: secTiles[s] > 0 ? Math.round(secSumJ[s] / secTiles[s]) : 0,
  }));

  const floorPer1k = walkable > 0 ? (parts.length * 1000) / walkable : 0;
  let biggest: SectionDensity | null = null;
  for (const s of sections) if (!biggest || s.tiles > biggest.tiles) biggest = s;
  const biggestSectionRatio = biggest && floorPer1k > 0 ? biggest.partsPer1k / floorPer1k : 0;

  return {
    walkable,
    parts: parts.length,
    worstBarren: worst3 / ORTH,
    deadShare: walkable > 0 ? dead / walkable : 0,
    openDeadShare: walkable > 0 ? openDead / walkable : 0,
    openTiles,
    sections,
    biggestSectionRatio,
  };
}

export interface OpenSpaceConstraints {
  maxWorstBarren: number;
  maxDeadShare: number;
  maxOpenDeadShare: number;
}

/**
 * The bands.
 *
 * ── What was measured ─────────────────────────────────────────────────────
 *
 * `node scripts/open-space-census.mjs --levels 1..30 --seeds 6` — **180 real
 * floors**, built through `buildHeadlessPlan`, which mirrors
 * `spawn/floor-authoring.ts` draw for draw. Baseline, before any of this
 * wave's changes:
 *
 *                        min      p50      p95      max
 *   worstBarren (t)     14.0     23.0     34.0     55.7
 *   deadShare          0.011    0.058    0.118    0.164
 *   openDeadShare      0.000    0.011    0.035    0.056
 *   biggestSectionRatio 0.00     0.83     1.56     3.48
 *   partsPer1k          13.6     18.8     25.4     28.4
 *
 * The bands below sit clear of the observed MAX, not of the median: the house
 * rule both `floor-metrics` and `floor-density` state in their own headers is
 * that a constraint is a "this floor is broken" line rather than a tuning
 * target, and a band set at current output tests nothing except that nobody
 * changed anything.
 *
 * ── What the baseline says, which is not what was expected ────────────────
 *
 * The wave was opened on the hypothesis that the Great Hall's plaza is the
 * dead zone. It is not, or not especially: by archetype, `deadShare` runs
 * warrens 6.0%, spine 5.3%, greathall 5.4%, cavern 5.8%, **ringkeep 8.8%** —
 * and ringkeep's `plazaFrac` is 0. The real axis is DEPTH. `partsPer1k` falls
 * from 23.2 over levels 1-8 to ~18 from level 9 on, because floors roughly
 * double in walkable area while `partBudget` is capped at `PARTS_MAX` plus an
 * area term that does not keep up.
 *
 * `biggestSectionRatio` is below 1 for **every** archetype (spine 0.76,
 * warrens 0.84, greathall 0.90, ringkeep 0.93, cavern 0.99), so "the biggest
 * room is the emptiest room" is real and general rather than a Great Hall
 * quirk. It is deliberately NOT a per-floor constraint here: 2 of 180 floors
 * ship with **zero** parts in their largest section, so a per-floor band would
 * have to be set at 0 to pass, and an inert gate is worse than none. It is
 * gated as a RATE over a sweep in `open-space.test.ts` instead — the same
 * idiom `TrackFloor.relaxed` uses for rules the generator may stand down on.
 */
export const OPEN_SPACE_BASELINE = {
  floors: 180,
  worstBarrenP50: 23.0,
  worstBarrenMax: 55.7,
  deadShareP50: 0.058,
  deadShareMax: 0.164,
  openDeadShareMax: 0.056,
  bigRatioBelowHalf: 17 / 180,
} as const;

export const DEFAULT_OPEN_SPACE: OpenSpaceConstraints = {
  /** Observed max 55.7 t. 64 t is 4.3 s at `BOOSTER_SPEED` — well past any
   *  stretch a floor produces today, and a floor that beats it has a genuinely
   *  empty half. */
  maxWorstBarren: 64,
  /** Observed max 16.4%. A floor where a quarter of the walkable area is more
   *  than `R_DEAD` from anything is not a table. */
  maxDeadShare: 0.28,
  /** Observed max 5.6%. Doubled: this is the metric the whole module exists
   *  for, so it gets the tightest relative headroom of the three. */
  maxOpenDeadShare: 0.11,
};

export function checkOpenSpace(m: OpenSpaceMetrics, c: OpenSpaceConstraints = DEFAULT_OPEN_SPACE): string[] {
  const bad: string[] = [];
  if (m.worstBarren > c.maxWorstBarren) {
    bad.push(`worstBarren ${m.worstBarren.toFixed(1)} > ${c.maxWorstBarren} tiles`);
  }
  if (m.deadShare > c.maxDeadShare) {
    bad.push(`deadShare ${m.deadShare.toFixed(3)} > ${c.maxDeadShare}`);
  }
  if (m.openDeadShare > c.maxOpenDeadShare) {
    bad.push(`openDeadShare ${m.openDeadShare.toFixed(3)} > ${c.maxOpenDeadShare}`);
  }
  return bad;
}

export function formatOpenSpace(m: OpenSpaceMetrics): string {
  const emptiest = m.sections.reduce<SectionDensity | null>((w, s) => (!w || s.maxBarren > w.maxBarren ? s : w), null);
  return [
    `walkable ${m.walkable}  parts ${m.parts}`,
    `worstBarren ${m.worstBarren.toFixed(1)}t  deadShare ${(m.deadShare * 100).toFixed(1)}%  openDeadShare ${(m.openDeadShare * 100).toFixed(1)}%`,
    `sections ${m.sections.length}  biggestSectionRatio ${m.biggestSectionRatio.toFixed(2)}`,
    emptiest ? `emptiest section #${emptiest.id} @(${emptiest.ci},${emptiest.cj}) ${emptiest.tiles}t ${emptiest.parts}p maxBarren ${emptiest.maxBarren.toFixed(1)}t` : "no sections",
  ].join("\n");
}

/** Re-exported so a caller measuring both fields cannot pick a different one. */
export { SECTION_CLEARANCE, MIN_SECTION_TILES };
export type { SectionMap };
