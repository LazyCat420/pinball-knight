/**
 * CIRCUIT CENSUS — do the floor's parts FEED EACH OTHER, or merely coexist?
 *
 * The instrument for the QA complaint behind the circuits work: the floor has
 * plenty of boosters and bumpers, but a booster throws the knight somewhere and
 * nothing catches them. A real table is a handful of machines that feed each
 * other; this measures how far the shipping floor is from that.
 *
 * ── The headline number ────────────────────────────────────────────────────
 *
 * `feedRate` — the share of launchers whose shove lands the player on another
 * part. It is the user's sentence made numeric: "when we have a piece there
 * needs to be another one close by to keep the loop going". A launcher with no
 * successor is a shove into nothing.
 *
 * `longestChain` is the same relation read the other way: how many hand-offs
 * deep the floor's deepest combo goes. One is the local property, the other the
 * global one, and a change that raises the first without the second has built
 * pairs rather than routes.
 *
 * ── Why the successor map is imported rather than re-walked ────────────────
 *
 * `maze/flow-loops.ts` already owns "which part does this part throw you into" —
 * it is the graph `breakFlowLoops` repairs. Re-deriving it here would be a
 * second answer to the same question, and `exitRay`'s own comment records where
 * that leads: a gate and a repair disagreeing about the same floor. So this
 * module imports `successorsOf` and computes nothing about flow itself.
 *
 * The two invariants (`cyclesFound`, `orphanLaunchers`) are duplicated from the
 * test suite ON PURPOSE. A census run alone should tell you the soft-lock
 * guarantee still holds, without a 59-second suite in between.
 *
 * REAL: floors come from `buildHeadlessPlan`, which mirrors
 * `spawn/floor-authoring.ts` draw for draw. See that function's header for why
 * it reuses neither `buildHeadlessFloor` nor `floor-density.test.ts`'s
 * `liveFloor()` — measured, the two agreed with the shipping floor on 0 of 15.
 *
 * MODELLED: nothing. Every number is a count over a generated plan.
 *
 * Φ is REBUILT here rather than read back. `decorateMaze` computes it internally
 * and does not return it; `buildFlowField(grid, stairs)` is pure and depends on
 * nothing the decoration pass changes afterwards, so rebuilding it is the same
 * field rather than an approximation of it.
 */
import { buildHeadlessPlan } from "./headless-floor";
import { ARCHETYPES } from "../maze/archetypes";
import { buildFlowField } from "../maze/flow-orient";
import { countUphill, findFlowCycles, successorsOf, type FlowPart } from "../maze/flow-loops";
import type { PinballPartSpot } from "../maze/decorate";

/**
 * The launch kinds, for the FEED question.
 *
 * Deliberately the same seven as `flow-loops.LAUNCHERS` and
 * `piece-rules.THROWING`: parts that actually throw the player and can
 * therefore be said to feed something. `deflector` and `boostcurve` are absent
 * for the reasons those two modules give at length — the first banks rather
 * than launches, the second carries a float tangent no cardinal rule can judge.
 *
 * A third copy of a set already written twice is a smell. It is deliberate for
 * now and should be collapsed WITH those two rather than by quietly importing
 * one of them: they are private to their modules because each is scoped to that
 * module's question, and unifying them is its own change with its own gate.
 */
const LAUNCH_KINDS = new Set(["ramp", "booster", "boostcorner", "spring", "slingshot", "flipper", "jumppad"]);

/** A part the feed question applies to at all. Vault ramps fire into rock ON
 *  PURPOSE (that is the feature) and the chute's facings are the lane itself —
 *  the same two exclusions `flow-loops.movable` makes, for the same reason. */
function feedable(p: PinballPartSpot): boolean {
  return !p.vault && !p.chute && LAUNCH_KINDS.has(p.kind);
}

export interface FloorRow {
  level: number;
  seed: number;
  archetype: string;
  modifier: string;
  walkable: number;
  parts: number;
  partsPer1k: number;
  /** Launchers eligible for the feed question (vault/chute excluded). */
  launchers: number;
  /** …of those, how many land the player on another part. */
  fed: number;
  feedRate: number;
  /** Launchers whose shove hits nothing — the hard invariant's population. */
  orphanLaunchers: number;
  /** Hand-offs in the deepest combo on the floor, counted in PARTS. */
  longestChain: number;
  meanChainLen: number;
  /** Share of launch parts firing uphill on Φ — the regression guard. */
  uphillShare: number;
  /** MUST be 0. A closed ring of shoves is an unescapable soft-lock. */
  cyclesFound: number;
}

export interface Roll {
  floors: number;
  feedRateMean: number;
  feedRateP05: number;
  feedRateMin: number;
  longestChainMean: number;
  longestChainMax: number;
  meanChainLenMean: number;
  orphanLaunchersMean: number;
  orphanShareMean: number;
  uphillShareMean: number;
  partsPer1kMean: number;
  cyclesTotal: number;
}

export interface CircuitReport {
  ray: number;
  floors: number;
  overall: Roll;
  byArchetype: Record<string, Roll>;
  /** The floor with the LOWEST feedRate — the reproduction case. */
  worstFloor: FloorRow | null;
  perFloor: FloorRow[];
}

/** How far a shove carries before the next pad is someone else's problem.
 *  Reported so a snapshot records the reach its numbers were taken at; the walk
 *  itself uses flow-loops' own copy, which is the one that ships. */
const RAY = 12;

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Nearest-rank percentile — no interpolation, so the value is one we saw. */
function pct(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/**
 * The longest hand-off chain in a successor map, counted in PARTS.
 *
 * The map is a FUNCTIONAL graph — each part has at most one successor — so
 * after `breakFlowLoops` has removed every cycle it is a forest and the longest
 * path from each node is a memoised walk. Linear, and well-defined only BECAUSE
 * the acyclicity invariant holds.
 *
 * The `seen` guard is not defensive dressing: it is what stops this hanging if
 * that invariant is ever violated. A census that spins forever on a bad floor
 * reports nothing at all about the bad floor.
 */
function chainLengths(next: Map<number, number>, nodes: number[]): number[] {
  const memo = new Map<number, number>();
  const lengthFrom = (start: number): number => {
    const path: number[] = [];
    const seen = new Set<number>();
    let cur: number | undefined = start;
    while (cur !== undefined && !memo.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      path.push(cur);
      cur = next.get(cur);
    }
    // A cycle would make "longest path" meaningless; charge its members the
    // ring length and let `cyclesFound` be the number that reports the defect.
    let tail = cur !== undefined && memo.has(cur) ? memo.get(cur)! : 0;
    for (let k = path.length - 1; k >= 0; k--) {
      tail += 1;
      memo.set(path[k], tail);
    }
    return memo.get(start)!;
  };
  return nodes.map(lengthFrom);
}

function roll(rows: FloorRow[]): Roll {
  const fr = rows.map((r) => r.feedRate);
  const lc = rows.map((r) => r.longestChain);
  return {
    floors: rows.length,
    feedRateMean: mean(fr),
    feedRateP05: pct(fr, 5),
    feedRateMin: fr.length ? Math.min(...fr) : 0,
    longestChainMean: mean(lc),
    longestChainMax: lc.length ? Math.max(...lc) : 0,
    meanChainLenMean: mean(rows.map((r) => r.meanChainLen)),
    orphanLaunchersMean: mean(rows.map((r) => r.orphanLaunchers)),
    orphanShareMean: mean(rows.map((r) => (r.launchers ? r.orphanLaunchers / r.launchers : 0))),
    uphillShareMean: mean(rows.map((r) => r.uphillShare)),
    partsPer1kMean: mean(rows.map((r) => r.partsPer1k)),
    cyclesTotal: rows.reduce((a, r) => a + r.cyclesFound, 0),
  };
}

function rowFor(level: number, seed: number): FloorRow | null {
  const f = buildHeadlessPlan(level, seed);
  if (!f) return null;
  const g = f.grid;
  // `PinballPartSpot` is structurally a `FlowPart` — that is why FlowPart is
  // declared structurally in the first place, so decorate can hand its array
  // straight over. The cast records the relationship rather than copying it.
  const parts = f.plan.parts as unknown as FlowPart[];
  const phi = buildFlowField(g, f.stairs);

  const next = successorsOf(g, parts);
  const launchIdx = f.plan.parts.map((p, n) => (feedable(p) ? n : -1)).filter((n) => n >= 0);
  const fed = launchIdx.filter((n) => next.has(n)).length;
  const chains = chainLengths(next, launchIdx);
  const { uphill, total } = countUphill(g, phi, parts);

  return {
    level,
    seed,
    archetype: f.archetype,
    modifier: f.modifier,
    walkable: f.walkable,
    parts: f.plan.parts.length,
    partsPer1k: f.walkable > 0 ? (f.plan.parts.length * 1000) / f.walkable : 0,
    launchers: launchIdx.length,
    fed,
    feedRate: launchIdx.length ? fed / launchIdx.length : 0,
    orphanLaunchers: launchIdx.length - fed,
    longestChain: chains.length ? Math.max(...chains) : 0,
    meanChainLen: mean(chains),
    uphillShare: total ? uphill / total : 0,
    cyclesFound: findFlowCycles(g, parts).length,
  };
}

export function runCircuitCensus(levels: number[], seeds: number[]): CircuitReport {
  const perFloor: FloorRow[] = [];
  for (const level of levels) {
    for (const seed of seeds) {
      const r = rowFor(level, seed);
      if (r) perFloor.push(r);
    }
  }
  const byArchetype: Record<string, Roll> = {};
  for (const a of ARCHETYPES) {
    const rows = perFloor.filter((r) => r.archetype === a.id);
    if (rows.length) byArchetype[a.id] = roll(rows);
  }
  const worstFloor = perFloor.reduce<FloorRow | null>((w, r) => (!w || r.feedRate < w.feedRate ? r : w), null);
  return { ray: RAY, floors: perFloor.length, overall: roll(perFloor), byArchetype, worstFloor, perFloor };
}
