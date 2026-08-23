/**
 * FLOW LOOPS — the pass that guarantees no chain of shoves can close.
 *
 * ── What `breakLaunchDuels` could not do ──────────────────────────────────
 *
 * decorate's duel breaker looks for one shape: two launchers on the same axis,
 * facings exactly anti-parallel, clear floor between. That is a 2-cycle, and it
 * is genuinely a trap — but it is neither the only cycle nor, on the shipping
 * generator, the common one. Censused over 78 floors before this module:
 *
 *   · 123 duels survived the breaker, and **121 of them were spine-vs-spine** —
 *     precisely the pair the breaker `continue`s past on purpose, because
 *     re-aiming a route part used to mean pointing it backward and breaking the
 *     route's own down-flow contract. So the pass was skipping 98% of what it
 *     found;
 *   · 130 launchers sat in a cycle of length 3 or more: A throws you at B, B at
 *     C, C back at A. The breaker cannot see those at all — no pair in the ring
 *     is anti-parallel.
 *
 * The runtime BOOSTER_JAM guard does not cover them either, and that is not an
 * oversight in the guard: it trips when the same pad catches the ball in the
 * same SPOT repeatedly, and in a multi-pad ring the ball is somewhere new every
 * time. From the pad's point of view a feedback loop looks exactly like a
 * player enjoying a fast lap.
 *
 * ── Why it can be fixed now ───────────────────────────────────────────────
 *
 * Because Φ exists (flow-orient.ts). "Re-aim a route part" used to be unsafe
 * because nothing but the traced artery knew which way was onward, so any
 * re-aim was a guess. With a floor-wide potential, a re-aim that lands downhill
 * is onward BY DEFINITION, on the route or off it. That removes the exemption
 * that made the old pass a no-op, and it also gives the repair a target
 * ordering: prefer the steepest downhill heading with real runway.
 *
 * ── Why the cycle graph rather than more pair rules ───────────────────────
 *
 * A launcher's shove ends where the ball first meets another launcher along its
 * fire ray. That is a FUNCTION from part to part (each part has at most one
 * successor), and a functional graph's only possible topology is trees hanging
 * off cycles. So "find every cycle" is a single linear walk with three colours,
 * not a search — and once the cycles are gone, every chain is a finite path
 * that terminates in a part with no successor. There is no third case to miss,
 * which is the property the pairwise version never had.
 *
 * DOM- and three-free; no rng, so co-op peers repair identically.
 */
import { type Grid, type TilePos, at, idx, T_FLOOR, T_STAIRS } from "./generator";
import { flowDrop, isDownhill, openRunway, phiAt, UNREACHED } from "./flow-orient";

/** The subset of a part spot this pass reads and writes. Structural rather than
 *  the full `PinballPartSpot`, so decorate can hand its array straight over
 *  without this module importing back into it (decorate imports here). */
export interface FlowPart extends TilePos {
  kind: string;
  dirI: number;
  dirJ: number;
  dir2I: number;
  dir2J: number;
  spine?: boolean;
  chain?: boolean;
  chute?: boolean;
  vault?: boolean;
}

/** Parts that actually THROW the player, and so can be a link in a loop. */
const LAUNCHERS = new Set(["ramp", "booster", "boostcorner", "spring", "slingshot", "flipper", "jumppad"]);

/** How far a shove carries before friction makes the next pad someone else's
 *  problem. Matches decorate's DUEL_RANGE — the same physical claim. */
const RAY = 12;
/** Open tiles a re-aim needs ahead of it, or it has just traded a loop for a
 *  launcher firing into rock. Matches decorate's MIN_RUNWAY. */
const MIN_RUN = 3;

const CARDS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function open(g: Grid, i: number, j: number): boolean {
  const t = at(g, i, j);
  return t === T_FLOOR || t === T_STAIRS;
}

/** @see openRunway — this module's copy was the original of the two. */
function runway(g: Grid, i: number, j: number, di: number, dj: number): number {
  return openRunway(g, i, j, di, dj, 8);
}

/** Can this part be re-aimed at all? A vault ramp fires into rock on purpose
 *  (that IS the feature) and the chute's facings are the lane itself. */
function movable(p: FlowPart): boolean {
  return !p.vault && !p.chute && LAUNCHERS.has(p.kind) && Math.abs(p.dirI) + Math.abs(p.dirJ) === 1;
}

/** The cardinal a float heading is nearest to; ties to x, never rng (co-op). */
function snapCardinal(tx: number, tz: number): readonly [number, number] {
  return Math.abs(tx) >= Math.abs(tz) ? [Math.sign(tx) || 1, 0] : [0, Math.sign(tz) || 1];
}

/**
 * Can this part be MEASURED — a strictly wider question than `movable`.
 *
 * "cardinal" = a launcher the repair passes can also re-aim. "tangent" = a
 * `boostcurve`, which throws along a float vector no cardinal repair can
 * rewrite, but which still shoves the player somewhere and therefore still
 * belongs in any honest count of where the floor's launchers point.
 */
function countableKind(p: FlowPart): "cardinal" | "tangent" | null {
  if (p.vault || p.chute) return null;
  if (movable(p)) return "cardinal";
  if (p.kind === "boostcurve" && Math.hypot(p.dirI, p.dirJ) > 1e-6) return "tangent";
  return null;
}

/**
 * Which way a part actually THROWS you.
 *
 * A corner booster is entered on `dir` and leaves on `dir2`, so its outgoing
 * ray is the SECOND leg. Getting this wrong would hide exactly the loops the
 * new part can form, so it is read off the part rather than assumed.
 *
 * Exported so the piece gate (maze/piece-rules.ts) judges a part by the same
 * vector the loop breaker re-aims. Two answers to "which way does this fire" is
 * how a gate and a repair come to disagree about the same floor.
 */
export function exitRay(p: FlowPart): readonly [number, number] {
  if (p.kind === "boostcorner" && Math.abs(p.dir2I) + Math.abs(p.dir2J) === 1) return [p.dir2I, p.dir2J];
  return [p.dirI, p.dirJ];
}

/**
 * The CARDINAL a part's shove walks along, for anything that steps the grid a
 * tile at a time.
 *
 * `exitRay` is the honest answer to "which way does this fire" and for a
 * `boostcurve` that answer is a float TANGENT. Stepping `i + di*s` with a float
 * lands between tiles — `at()` then reads a rounded-down neighbour, so the walk
 * silently drifts off the actual fire line rather than failing. Snapping here
 * keeps `exitRay` truthful for the physics and gives the grid walk something it
 * can index, which is the same split `countUphill` already makes.
 */
function rayCardinal(p: FlowPart): readonly [number, number] {
  const [di, dj] = exitRay(p);
  if (Number.isInteger(di) && Number.isInteger(dj)) return [di, dj];
  return snapCardinal(di, dj);
}

/**
 * Build the successor map: part index → part index it feeds, over `parts`.
 *
 * ⚠️ `live` is the CARDINAL-LAUNCHER subset (`movable`), because that is the
 * population the repair can act on. A census wanting "does this part feed
 * another" over a wider population must pass its own `live` — see
 * `successorsOf`, which is the exported door onto exactly this walk.
 */
function successors(g: Grid, parts: FlowPart[], live: number[], targets?: number[]): Map<number, number> {
  const byTile = new Map<number, number>();
  for (const n of targets ?? live) byTile.set(idx(g, parts[n].i, parts[n].j), n);
  const next = new Map<number, number>();
  for (const n of live) {
    const p = parts[n];
    const [di, dj] = rayCardinal(p);
    for (let s = 1; s <= RAY; s++) {
      const ni = p.i + di * s;
      const nj = p.j + dj * s;
      if (!open(g, ni, nj)) break;
      const hit = byTile.get(idx(g, ni, nj));
      if (hit !== undefined && hit !== n) {
        next.set(n, hit);
        break;
      }
    }
  }
  return next;
}

/**
 * THE SUCCESSOR MAP, for anything outside this module: part index → the part it
 * throws the player into, or absent if the shove dies on bare floor.
 *
 * Exported because "does this launcher feed another part" is the quantity the
 * circuit work is judged on, and the alternative — a census re-walking the exit
 * ray itself — is a second answer to the question this module already answers.
 * `exitRay`'s own comment records why that matters: two answers to "which way
 * does this fire" is how a gate and a repair come to disagree about a floor.
 *
 * ── SOURCES AND TARGETS ARE DIFFERENT POPULATIONS, and that is the point ───
 *
 * A shove can only START at a part that launches, so the sources are
 * `countableKind`'s population — wider than `movable`'s, because a `boostcurve`
 * throws the player along a float tangent no repair can rewrite and excluding
 * it would hide the one launch kind with no repair pass behind a metric that
 * cannot see it (the defect `countUphill` documents at length).
 *
 * But a shove can END on ANY part. `findFlowCycles` looks launcher-to-launcher
 * because every member of a soft-lock ring has to re-launch — that is what
 * makes it a ring. "Does this part feed something" is a different question with
 * a different answer: a booster that throws the knight into a deflector has fed
 * it, and the deflector banks him onward. Inheriting the cycle detector's
 * target set measured launcher-to-LAUNCHER while claiming to measure
 * launcher-to-part, and it understated the real hand-off rate by a factor of
 * three — every corner and every bumper in a chain read as "fed nothing".
 */
export function successorsOf(g: Grid, parts: FlowPart[]): Map<number, number> {
  const live = parts.map((_, n) => n).filter((n) => countableKind(parts[n]) !== null);
  const targets = parts.map((_, n) => n).filter((n) => !parts[n].vault && !parts[n].chute);
  return successors(g, parts, live, targets);
}

/**
 * Every cycle in the successor map, as arrays of part indices.
 *
 * Three-colour walk: 0 unvisited, 1 on the current path, 2 finished. Meeting a
 * node coloured 1 means the path just closed on itself and the cycle is its
 * tail from that node; meeting a 2 means it merges into something already
 * resolved. Linear in the number of parts.
 */
export function findFlowCycles(g: Grid, parts: FlowPart[]): number[][] {
  const live = parts.map((_, n) => n).filter((n) => movable(parts[n]));
  const next = successors(g, parts, live);
  const colour = new Map<number, number>();
  const cycles: number[][] = [];
  for (const seed of live) {
    if (colour.get(seed)) continue;
    const path: number[] = [];
    const pos = new Map<number, number>();
    let cur: number | undefined = seed;
    while (cur !== undefined && !colour.get(cur)) {
      colour.set(cur, 1);
      pos.set(cur, path.length);
      path.push(cur);
      cur = next.get(cur);
    }
    if (cur !== undefined && colour.get(cur) === 1) cycles.push(path.slice(pos.get(cur)!));
    for (const n of path) colour.set(n, 2);
  }
  return cycles;
}

/**
 * Break every cycle of shoves on the floor. Returns how many it broke.
 *
 * Runs LAST, over final facings — after placement, the A1 runway repair and the
 * post-sweep re-aim have each had their say — for the same reason the duel
 * breaker did: a facing changed after this pass can reopen a loop this pass
 * closed.
 *
 * Repair, cheapest first:
 *   1) RE-AIM the yielding part to its steepest DOWNHILL cardinal with real
 *      runway. Downhill is safe for a route part now (that is the whole point
 *      of Φ), so unlike the old breaker this needs no spine exemption.
 *   2) DEMOTE to a bumper. Only where a bumper belongs — a junction — because
 *      parts are placed to match tile topology and decorate.test pins it.
 *   3) REMOVE. Last resort, same as `openLaunchTargets` uses for an orphan.
 *
 * Which member yields: the one whose shove makes the LEAST progress toward the
 * exit, measured by `flowDrop`. That is the right cost function rather than
 * "whichever is cheapest to edit" — the ring's most useful link is the one
 * carrying the player furthest down the floor, and it is the one worth keeping.
 */
export function breakFlowLoops(g: Grid, phi: Int32Array, parts: FlowPart[]): number {
  let broken = 0;
  // Re-aiming can move a part into a fresh ring with a third, so iterate to a
  // fixed point. The bound is generous but finite: every round either breaks a
  // cycle or gives up on one, and a given part can only be demoted once.
  for (let round = 0; round < 24; round++) {
    const cycles = findFlowCycles(g, parts);
    if (cycles.length === 0) break;
    let changed = false;
    for (const cycle of cycles) {
      // Yield the weakest link: least forward progress, ties to the later index
      // so the choice is deterministic.
      let victim = cycle[0];
      let worst = Infinity;
      for (const n of cycle) {
        const p = parts[n];
        const [di, dj] = exitRay(p);
        const drop = flowDrop(g, phi, p.i, p.j, di, dj, RAY);
        if (drop < worst) {
          worst = drop;
          victim = n;
        }
      }
      const p = parts[victim];
      // 1) re-aim downhill
      let best: readonly [number, number] | null = null;
      let bestDrop = 0;
      for (const c of CARDS) {
        if (c[0] === p.dirI && c[1] === p.dirJ) continue;
        if (runway(g, p.i, p.j, c[0], c[1]) < MIN_RUN) continue;
        if (!isDownhill(g, phi, p.i, p.j, c[0], c[1])) continue;
        const drop = flowDrop(g, phi, p.i, p.j, c[0], c[1], RAY);
        if (drop > bestDrop) {
          bestDrop = drop;
          best = c;
        }
      }
      if (best) {
        p.dirI = best[0];
        p.dirJ = best[1];
        // A corner booster re-aimed as a straight shove is no longer a corner:
        // its second leg would still claim a turn the part is not making.
        if (p.kind === "boostcorner") {
          p.kind = "booster";
          p.dir2I = 0;
          p.dir2J = 0;
        }
        broken++;
        changed = true;
        continue;
      }
      // 2) demote where a bumper legitimately lives
      const legs = CARDS.filter(([di, dj]) => open(g, p.i + di, p.j + dj)).length;
      if (legs >= 3) {
        p.kind = "bumper";
        p.dirI = 0;
        p.dirJ = 0;
        p.dir2I = 0;
        p.dir2J = 0;
        broken++;
        changed = true;
        continue;
      }
      // 3) remove
      const k = parts.indexOf(p);
      if (k >= 0) {
        parts.splice(k, 1);
        broken++;
        changed = true;
      }
    }
    // Nothing in this round could be repaired at all — retrying would spin.
    if (!changed) break;
  }
  return broken;
}

/**
 * How many launch parts fire UPHILL (or on the level) — the headline number the
 * census tracks and `decorate.test` gates. Exported so the measurement and the
 * production code cannot drift apart.
 *
 * Parts on an unreachable tile are not counted: they are a connectivity
 * question, not an orientation one, and folding them in here would hide a
 * stranding bug behind an orientation metric.
 */
export function countUphill(g: Grid, phi: Int32Array, parts: FlowPart[]): { uphill: number; total: number } {
  let uphill = 0;
  let total = 0;
  for (const p of parts) {
    // COUNTING IS NOT MOVING, and the two need different predicates.
    //
    // `movable` demands a unit cardinal because a re-aim has to write one back.
    // A `boostcurve` carries a float TANGENT, so it can never be movable — and
    // gating the census on movability meant the one launch kind with no repair
    // pass at all was also the one kind no measurement could see. That is how a
    // defect stays invisible: not because the number was wrong, but because the
    // population excluded it. Count it via its snapped cardinal; still never
    // re-aim it.
    const countable = countableKind(p);
    if (!countable) continue;
    if (phiAt(g, phi, p.i, p.j) >= UNREACHED) continue;
    total++;
    const [di, dj] = countable === "tangent" ? snapCardinal(p.dirI, p.dirJ) : exitRay(p);
    if (!isDownhill(g, phi, p.i, p.j, di, dj)) uphill++;
  }
  return { uphill, total };
}
