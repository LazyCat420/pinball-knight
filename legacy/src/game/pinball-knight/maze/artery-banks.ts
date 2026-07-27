/**
 * ARTERY BANKS — long banked turns carved into the main highway.
 *
 * The problem this solves: a rail needs a curve long enough to hold. The
 * shipped fillets are one quarter-turn at radius 2-3, i.e. ~3.1 tiles of arc —
 * over before the ride reads as one.
 *
 * ── Why the two obvious fixes fail (both were built and measured) ─────────
 *
 * · Bigger fillet radii: a radius-R fillet needs an R×R BLOCK of clean tiles,
 *   so cost grows as r² while supply collapses. Over 40 real floors, radius 2
 *   fitted 3673 times, radius 4 four times, radius 5 twice.
 * · Merging adjacent arcs: every fillet is centred on ITS OWN corner, so two
 *   fillets are on different circles by construction. Measured: 96 arcs, 96
 *   distinct circles, zero sharing a centre. Nothing to merge.
 *
 * Both are the same wrong idea — "put a big circle somewhere" — and a census of
 * real floors says there is nowhere to put one: of 22,713 sampled open tiles,
 * 81.8% have an open radius of ZERO and the largest found anywhere was 4.
 * Floors are corridors, not chambers.
 *
 * ── The reframe ───────────────────────────────────────────────────────────
 *
 * A banked turn does not need an open disc. It needs a CORRIDOR THAT BENDS,
 * with the ball riding the OUTER wall — the NASCAR high line. For a corridor of
 * width W the outer radius is Ro = Ri + W, and the ridden arc is Ro·θ, so the
 * outside of a bend is both longer and faster for the same turn.
 *
 * The cost changes from AREA to PERIMETER: a fillet needs r² tiles, an arc
 * strip needs ~r·θ. At r=10 that is 100 tiles versus 26.
 *
 * And the sites already exist. `widenMainArtery` carves a 3-wide highway;
 * `traceArtery` returns it ordered. Censused over 20 floors: 57.4 bends per
 * floor, 17.9 of them preceded by a 5+ tile straight (so the player arrives at
 * speed), and 59% with ≤3 tiles between them — the artery WIGGLES, so bends
 * cluster into chains. A W=3 bend at Ri=2 is 7.9 tiles of arc against today's
 * 3.1; a chain of three is 23.6.
 *
 * This module is the DETECTION half: pure path analysis, no grid mutation, no
 * THREE. It answers "where could a bank go, and how long would it be" so the
 * carving half can be gated, tested and reverted independently.
 */
import {
  type Grid,
  type TilePos,
  T_FLOOR,
  T_WALL,
  at,
  setTile,
  setShape,
  shapeAt,
  idx,
  isWalkable,
  ensureArcs,
} from "./generator";
import { SHAPE_FULL, SHAPE_ARC, angleInSpan, type ArcFeature } from "../engine/tile-shape";
import { bfsDistancesOwned } from "../engine/flow-field";

/** The four cardinals, in the order `traceArtery` prefers them. */
const WALL_SIDES: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

/** A unit cardinal step along the artery. */
export interface Heading {
  di: number;
  dj: number;
}

/** One turn in the highway, with everything needed to fit an arc to it. */
export interface Bend {
  /** The tile where the heading changes — the inside of the turn. */
  corner: TilePos;
  /** Heading arriving at the corner. */
  inDir: Heading;
  /** Heading leaving the corner. */
  outDir: Heading;
  /** Straight tiles travelled before the corner. Speed on arrival. */
  runIn: number;
  /** +1 for a clockwise turn, -1 for anticlockwise (grid: +i right, +j down). */
  turn: 1 | -1;
  /** Index into the artery path, so chains can measure the gap between bends. */
  at: number;
}

/** Several bends close enough together to ride as one continuous curve. */
export interface BendChain {
  bends: Bend[];
  /** Total turning, radians — 3 quarter-turns = 3π/2 of ride. */
  totalTurn: number;
}

/**
 * The cross product of two cardinal headings, which for unit cardinals is
 * exactly the turn direction: +1 clockwise, -1 anticlockwise, 0 straight or a
 * full reversal.
 *
 * (In grid space +i is right and +j is DOWN, so a positive cross reads as
 * clockwise on screen — the same convention as `rotateDir` in assembly.ts.)
 */
export function turnOf(a: Heading, b: Heading): number {
  return a.di * b.dj - a.dj * b.di;
}

/**
 * Find every heading change along an ordered path.
 *
 * Only 90° turns are reported. A straight step is not a bend, and a 180°
 * reversal is not bankable — there is no arc that turns a corridor back on
 * itself without pinching it to nothing, and the artery should not contain one
 * anyway (it walks a BFS gradient, which never doubles back).
 */
export function findBends(path: readonly TilePos[]): Bend[] {
  const out: Bend[] = [];
  if (path.length < 3) return out;

  let run = 1;
  for (let k = 2; k < path.length; k++) {
    const inDir: Heading = { di: path[k - 1].i - path[k - 2].i, dj: path[k - 1].j - path[k - 2].j };
    const outDir: Heading = { di: path[k].i - path[k - 1].i, dj: path[k].j - path[k - 1].j };
    if (inDir.di === outDir.di && inDir.dj === outDir.dj) {
      run++;
      continue;
    }
    const t = turnOf(inDir, outDir);
    // t === 0 means a reversal (anti-parallel) — skip it, and reset the run
    // because the player is not carrying speed through a U-turn either.
    if (t !== 0) {
      out.push({
        corner: path[k - 1],
        inDir,
        outDir,
        runIn: run,
        turn: t > 0 ? 1 : -1,
        at: k - 1,
      });
    }
    run = 1;
  }
  return out;
}

/**
 * Group bends that are close enough to ride as one curve.
 *
 * `maxGap` is measured in path steps between consecutive bends. Two bends four
 * tiles apart at speed are one continuous ride to the player — the straight
 * between them is shorter than the grace window — so authoring them as one
 * chain is what produces a long bank out of a wiggly corridor.
 *
 * Chains do NOT require a consistent turn direction: alternating turns are an
 * S-curve, which is the better ride, and same-direction turns sweep. Both are
 * kept.
 */
export function chainBends(bends: readonly Bend[], maxGap: number): BendChain[] {
  const chains: BendChain[] = [];
  let cur: Bend[] = [];
  for (const b of bends) {
    if (cur.length === 0) {
      cur = [b];
      continue;
    }
    const gap = b.at - cur[cur.length - 1].at;
    if (gap <= maxGap) cur.push(b);
    else {
      chains.push({ bends: cur, totalTurn: (cur.length * Math.PI) / 2 });
      cur = [b];
    }
  }
  if (cur.length) chains.push({ bends: cur, totalTurn: (cur.length * Math.PI) / 2 });
  return chains;
}

/**
 * The arc a bend should carry, in grid coordinates.
 *
 * Geometry. At the corner the corridor turns 90°. The turn's centre sits on the
 * INSIDE of the bend, offset from the corner along the bisector of the two
 * headings. With inner radius `ri` and corridor width `w`, the ball rides the
 * OUTER wall at `ro = ri + w`.
 *
 * The bisector is `inDir + outDir`, normalised — forward along travel AND
 * inward. Worth being explicit, because `-inDir + outDir` also lands the corner
 * at exactly radius `ro` from the centre and so passes a naive distance check,
 * but it puts the centre on the WRONG SIDE (behind and outside the turn), which
 * would author an arc curving away from the corridor instead of around it.
 * Distance alone does not pin the centre; the side does.
 *
 * `a0`/`span` are the angular range of the OUTER wall the ball actually rides,
 * measured in the same atan2 frame `resolveArcFeature` uses.
 */
export function arcForBend(b: Bend, ri: number, w: number): { cx: number; cz: number; r: number; a0: number; span: number; cw: boolean } {
  const ro = ri + w;
  // Corner tile centre.
  const px = b.corner.i + 0.5;
  const pz = b.corner.j + 0.5;
  // Toward the inside of the turn: forward along travel and inward.
  const bx = b.inDir.di + b.outDir.di;
  const bz = b.inDir.dj + b.outDir.dj;
  const bl = Math.hypot(bx, bz) || 1;
  // Centre sits `ro` from the outer wall, i.e. `ro` back along the bisector.
  const cx = px + (bx / bl) * ro;
  const cz = pz + (bz / bl) * ro;
  // The ridden span runs from the incoming wall to the outgoing wall. The
  // outward radial at entry is opposite the bisector-ish direction; taking the
  // angle of (corner - centre) and sweeping a quarter in the turn direction
  // gives exactly the face the ball rides.
  const entryAng = Math.atan2(pz - cz, px - cx);
  const span = Math.PI / 2;
  // Clockwise turn sweeps toward increasing angle in this frame.
  const a0 = b.turn > 0 ? entryAng - span / 2 : entryAng - span / 2;
  // cw follows the turn: a clockwise bend throws clockwise.
  return { cx, cz, r: ro, a0, span, cw: b.turn > 0 };
}

/** Ridden arc length of a chain, in tiles — the number that decides whether a
 *  bank is worth authoring at all. */
export function chainArcLength(chain: BendChain, ri: number, w: number): number {
  return (ri + w) * chain.totalTurn;
}

// ── Authoring ─────────────────────────────────────────────────────────────

/** Straight tiles required before a bend: the player must ARRIVE at speed, or
 *  a bank is just a decorated corner. */
export const BANK_MIN_RUNIN = 4;
/** Max path-steps between two bends for them to ride as one curve. */
export const BANK_CHAIN_GAP = 3;
/** Banks authored per floor. Small on purpose — these are set pieces on the
 *  main highway, and every one narrows the artery slightly. */
export const BANK_MAX_PER_FLOOR = 6;
/** Inner radius of the turn. The ridden (outer) radius is this + the corridor
 *  width, so 2 on the 3-wide artery gives a 5-radius ride: ~7.9 tiles a quarter. */
export const BANK_RI = 2;
/** Assumed corridor width — `widenMainArtery` carves a 3-wide highway. */
export const BANK_W = 3;
/** Fraction of a bank's span the rail covers. Nearly all of it: the ride is
 *  the reason the bank exists, and a rail you can only catch in the middle
 *  third fights the grace window. */
export const BANK_LANE_FRAC = 0.94;

/** One authored bank, ready to commit (or discard) as a unit. */
export interface BankPlan {
  feature: ArcFeature;
  /** Tiles the arc passes through: become SHAPE_ARC wall. */
  arcTiles: TilePos[];
  /** Floor tiles converted to wall to form the bank's outer shell. */
  fillTiles: TilePos[];
}

/**
 * Plan the banks for one floor, without touching the grid.
 *
 * The filter chain is deliberately strict — a bad bank is worse than no bank,
 * because it narrows the fastest route through the floor:
 *
 *  · the bend must have `BANK_MIN_RUNIN` straight tiles before it, so the
 *    player arrives carrying speed;
 *  · every tile the arc would claim must currently be plain FLOOR and
 *    unoccupied — never steal a tile that holds a part, item or spawn;
 *  · the inner lane must stay open, so the arc can never pinch the highway
 *    shut. This is the rule that protects the artery's 3-wide contract.
 */
export function planArteryBanks(
  g: Grid,
  path: readonly TilePos[],
  occupied: (i: number, j: number) => boolean,
  limit = BANK_MAX_PER_FLOOR,
  protect: (i: number, j: number) => boolean = () => false,
): BankPlan[] {
  const plans: BankPlan[] = [];
  const claimed = new Set<number>();
  const bends = findBends(path).filter((b) => b.runIn >= BANK_MIN_RUNIN);
  const chains = chainBends(bends, BANK_CHAIN_GAP);

  for (const chain of chains) {
    if (plans.length >= limit) break;
    for (const b of chain.bends) {
      if (plans.length >= limit) break;
      const a = arcForBend(b, BANK_RI, BANK_W);
      const plan = planOneBank(g, a, occupied, claimed, protect);
      if (plan) {
        for (const t of plan.arcTiles) claimed.add(idx(g, t.i, t.j));
        for (const t of plan.fillTiles) claimed.add(idx(g, t.i, t.j));
        plans.push(plan);
      }
    }
  }
  return plans;
}

/**
 * Turn one arc descriptor into a concrete tile plan, or null if the site does
 * not qualify.
 *
 * Tiles are classified by their distance band from the turn centre, sampled at
 * the tile's own centre:
 *   · within [r, r + 1) → the arc face itself → SHAPE_ARC wall
 *   · beyond r + 1      → outside the ride → filled to wall (the bank's shell)
 *   · below r           → the lane the ball rides → must stay open, untouched
 */
function planOneBank(
  g: Grid,
  a: { cx: number; cz: number; r: number; a0: number; span: number; cw: boolean },
  occupied: (i: number, j: number) => boolean,
  claimed: Set<number>,
  protect: (i: number, j: number) => boolean,
): BankPlan | null {
  const arcTiles: TilePos[] = [];
  const fillTiles: TilePos[] = [];
  // Bounding box of the arc band, clamped inside the shell.
  const lo = Math.floor(a.cx - a.r - 2);
  const hi = Math.ceil(a.cx + a.r + 2);
  const loz = Math.floor(a.cz - a.r - 2);
  const hiz = Math.ceil(a.cz + a.r + 2);
  if (lo <= 0 || loz <= 0 || hi >= g.w - 1 || hiz >= g.h - 1) return null;

  for (let j = loz; j <= hiz; j++) {
    for (let i = lo; i <= hi; i++) {
      const dx = i + 0.5 - a.cx;
      const dz = j + 0.5 - a.cz;
      const d = Math.hypot(dx, dz);
      // Only the ridden band matters; everything else is somebody else's tile.
      if (d < a.r - 0.5 || d > a.r + 1.5) continue;
      if (!angleInSpan(Math.atan2(dz, dx), a.a0, a.span)) continue;
      const k = idx(g, i, j);
      if (claimed.has(k)) return null; // another bank already owns it
      if (shapeAt(g, i, j) !== SHAPE_FULL) return null; // a sweep/slant is here
      if (occupied(i, j)) return null; // a part/item/spawn lives here
      const t = at(g, i, j);
      if (t !== T_FLOOR && t !== T_WALL) return null; // stairs/cracked: leave alone
      // PROTECTED tiles may be NEAR a bank but must never be CONVERTED by it.
      // The spine walks straight through every bend a bank wants, so rejecting
      // any bank that merely touches the route kills all of them (measured: 0
      // banks per floor). What actually breaks the route is a bank turning one
      // of its walked tiles into wall — then the path re-derives through another
      // corner and the boosters laid along it point backward. So the test is on
      // CONVERSION, not proximity: a wall tile being reshaped into an arc face
      // is free, a floor tile being taken is not.
      if (t === T_FLOOR && protect(i, j)) return null;
      if (d <= a.r + 0.5) {
        if (t === T_FLOOR) arcTiles.push({ i, j });
      } else if (t === T_FLOOR) {
        fillTiles.push({ i, j });
      }
    }
  }
  // A bank with no face is not a bank. Require enough arc tiles that the
  // feature is actually rideable rather than a token curve.
  if (arcTiles.length < 3) return null;
  // EVERY bank gets a rail across nearly its whole span. A bank exists to be
  // ridden — an unrailed one is just a curved wall, and the whole point of
  // paying for the geometry is the ride. `cw` follows the turn direction so the
  // rail throws the way the corridor actually goes; a rail pointing against the
  // route would simply never be caught (laneBandAt rejects against-grain
  // contact), which is a silent waste rather than a bug.
  const bandSpan = a.span * BANK_LANE_FRAC;
  const feature: ArcFeature = {
    cx: a.cx,
    cz: a.cz,
    r: a.r,
    a0: a.a0,
    span: a.span,
    solidOut: true,
    lanes: [
      {
        a0: a.a0 + (a.span - bandSpan) / 2,
        span: bandSpan,
        cw: a.cw,
        cooldownT: 0,
        hitT: -1,
      },
    ],
  };
  return { feature, arcTiles, fillTiles };
}

/** Commit a planned bank to the grid. Mirrors commitFillet in arc-sweeps.ts. */
export function commitBank(g: Grid, plan: BankPlan): void {
  ensureArcs(g);
  const fi = g.arcs!.length;
  g.arcs!.push(plan.feature);
  for (const t of plan.fillTiles) setTile(g, t.i, t.j, T_WALL);
  for (const t of plan.arcTiles) {
    setTile(g, t.i, t.j, T_WALL);
    setShape(g, t.i, t.j, SHAPE_ARC);
    g.arcIdx![idx(g, t.i, t.j)] = fi;
  }
}

/** Undo a committed bank — floor restored, feature left orphaned (inert: no
 *  tile points at it, and `angleInSpan` can never match a tile that is gone). */
export function revertBank(g: Grid, plan: BankPlan): void {
  plan.feature.lanes = undefined;
  plan.feature.kicks = undefined;
  for (const t of plan.fillTiles) setTile(g, t.i, t.j, T_FLOOR);
  for (const t of plan.arcTiles) {
    setTile(g, t.i, t.j, T_FLOOR);
    setShape(g, t.i, t.j, SHAPE_FULL);
    g.arcIdx![idx(g, t.i, t.j)] = -1;
  }
}

/**
 * Author every qualifying bank on the floor, with a collective strand guard.
 *
 * Banks ADD WALL, so they can in principle sever the floor. The guard is the
 * same shape as the concave-fillet one: commit the batch, flood-fill from
 * start, and if ANY walkable tile lost its path, revert every bank. All or
 * nothing is deliberate — a partial revert would leave the floor in a state no
 * test covers, and banks are rare enough that losing a whole floor's worth is
 * cheap.
 *
 * Returns the number of banks that survived.
 */
export function authorArteryBanks(
  g: Grid,
  path: readonly TilePos[],
  start: TilePos,
  occupied: (i: number, j: number) => boolean,
  protect: (i: number, j: number) => boolean = () => false,
): number {
  const plans = planArteryBanks(g, path, occupied, BANK_MAX_PER_FLOOR, protect);
  if (!plans.length) return 0;

  // ONE AT A TIME, each with its own guard.
  //
  // The first cut committed the whole batch and reverted everything if any tile
  // was orphaned — the pattern the concave fillets use. Measured, that threw
  // away entire floors' worth of good banks over a couple of bad tiles: of
  // three sampled floors one kept all six banks and two lost all six, to 2 and
  // 9 orphans respectively. Since banks are few, large and independent, paying
  // for a flood fill per bank is cheap and keeps the good ones.
  let kept = 0;
  for (const p of plans) {
    commitBank(g, p);
    if (strands(g, start)) revertBank(g, p);
    else kept++;
  }
  return kept;
}

/** Did the last edit strand any walkable tile from `start`? */
function strands(g: Grid, start: TilePos): boolean {
  const d = bfsDistancesOwned(g, start.i, start.j);
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (isWalkable(g, i, j) && d[idx(g, i, j)] < 0) return true;
    }
  }
  return false;
}

/**
 * THE SPINE — the ordered tile path down the main artery from START to STAIRS,
 * walking the BFS-from-start gradient (each step drops the distance by one). The
 * single source of truth for "the way through the floor": widenMainArtery widens
 * it into a 3-wide highway and layStationSpine strings the connected booster
 * route along it. Returned start→stairs so a caller can lay parts in travel
 * order. Empty if the gradient dead-ends (never on a connected maze).
 */
export function traceArtery(g: Grid, start: TilePos, stairs: TilePos, dist: Int32Array): TilePos[] {
  // Walk the gradient stairs → start, then reverse so the path reads in the
  // direction of travel (spawn → exit).
  let cur: TilePos = stairs;
  let guard = 0;
  const back: TilePos[] = [cur];
  while (!(cur.i === start.i && cur.j === start.j) && guard++ < g.w * g.h) {
    const dcur = dist[idx(g, cur.i, cur.j)];
    let next: TilePos | null = null;
    for (const [di, dj] of WALL_SIDES) {
      const ni = cur.i + di;
      const nj = cur.j + dj;
      if (at(g, ni, nj) === T_WALL) continue;
      if (dist[idx(g, ni, nj)] === dcur - 1) {
        next = { i: ni, j: nj };
        break;
      }
    }
    if (!next) break; // gradient dead-ended (shouldn't on a connected maze)
    cur = next;
    back.push(cur);
  }
  back.reverse();
  return back;
}
