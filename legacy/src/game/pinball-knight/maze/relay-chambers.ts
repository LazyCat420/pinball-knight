/**
 * RELAY CHAMBERS — the two-focus ellipse, and the strongest form of the ask.
 *
 * ── What an ellipse buys that a parabola cannot ──────────────────────────
 *
 * A parabola gathers rays that arrive PARALLEL to its axis. That is the right
 * tool for a corridor, and it is what `doorway-funnels.ts` uses. But it says
 * nothing about a ball crossing an open section on some other line.
 *
 * An ellipse's property is stronger and stranger: every ray through focus F₁
 * reflects to focus F₂, whatever direction it left F₁ in. Put the two foci on
 * TWO DOORWAY MOUTHS of the same section and the precondition stops being an
 * assumption — a ball that entered through door A has, by construction, just
 * passed through F₁. So the far wall relays it to door B in a single bank, from
 * any angle it happened to come in at.
 *
 * That is "it banks into the next room no matter how you go in", holding
 * exactly rather than approximately, and it is the reason to want ellipses
 * rather than just curves.
 *
 * ── Why it is authored as a WALL and not a room ──────────────────────────
 *
 * The obvious build is a chamber shaped like an ellipse. There is nowhere to
 * put one: `LONG_BANKS_PLAN.md` censused 22,713 open tiles and found 81.8% with
 * an open radius of ZERO. Floors are corridors.
 *
 * So this authors only the ARC — the stretch of the section's existing boundary
 * that happens to lie near the ellipse — and lets the rest of the section stay
 * whatever shape it is. Cost is perimeter, not area, which is the same reframe
 * that made artery banks affordable. A partial relay wall is still a relay
 * wall: the balls that meet it get sent to the far door, and the ones that miss
 * it are no worse off than before.
 *
 * ── Siting ───────────────────────────────────────────────────────────────
 *
 * `Doorway` already names the two SECTIONS it joins, so a pair of doorways that
 * share a section is a relay candidate with no geometry needed to find it —
 * censused at 10.0 pairs per floor, of which 5.4 have the standoff to fit an
 * ellipse. The semi-major axis is `c + RELAY_STANDOFF`, which is the one free
 * parameter: it decides how far off the line between the mouths the wall sits.
 *
 * Reuses `doorway-funnels.ts` wholesale for the parts that are not about
 * ellipses — tile classification, the fill/carve rules, the snapshot revert and
 * the collective strand guard — because those were expensive to get right and a
 * second copy would drift. DOM- and three-free. Pure.
 */
import { type Grid, type TilePos, idx, isWalkable, ensureArcs } from "./generator";
import type { ArcFeature } from "../engine/tile-shape";
import { junctionClear } from "./arc-contract";
import { bfsDistancesOwned } from "../engine/flow-field";
import { ellipseFromFoci, ellipseSamples, arcChainFromSamples, type Pt } from "./conic-fit";
import {
  planChain,
  commitJaw,
  revertJaw,
  laneTowardMouth,
  type JawPlan,
  type Occupied,
} from "./doorway-funnels";
import type { Doorway } from "./doorways";

/**
 * How far outside the straight line between the two mouths the relay wall sits,
 * in tiles — the ellipse's semi-major axis is `c + this`.
 *
 * Small values make a long thin ellipse hugging the line between the doors,
 * which is where a corridor's walls actually are. Large values need a chamber,
 * and there are none.
 */
export const RELAY_STANDOFF = 1.6;

/** Mouth separations worth relaying, in tiles. */
export const RELAY_MIN_SPAN = 5;
export const RELAY_MAX_SPAN = 26;

/** Arc links per relay wall. */
export const RELAY_SEGMENTS = 5;

/** Relay walls per floor. */
export const RELAY_MAX_PER_FLOOR = 3;

export interface RelayReport {
  chambers: number;
  features: number;
  carved: number;
  filled: number;
  reverted: number;
  rejects: Record<string, number>;
}

const mouth = (d: Doorway): Pt => ({ x: d.i + 0.5, z: d.j + 0.5 });

/**
 * Author elliptical relay walls between doorway pairs that share a section.
 *
 * Both halves of each ellipse are tried — the wall may exist on either side of
 * the line between the mouths, and on a corridor it is usually one but not the
 * other. Each is planned and gated independently, so half a relay is a normal
 * outcome here rather than the failure it is for a funnel jaw. The difference
 * is that a funnel's two arms face EACH OTHER across a throat, so a lone arm
 * deflects into the space its partner should have filled; two halves of an
 * ellipse face the same two foci and neither needs the other to aim correctly.
 */
export function authorRelayChambers(
  g: Grid,
  doorways: readonly Doorway[],
  start: TilePos,
  occupied: Occupied = () => false,
  tune: { standoff?: number; segments?: number; maxPerFloor?: number } = {},
): RelayReport {
  const report: RelayReport = { chambers: 0, features: 0, carved: 0, filled: 0, reverted: 0, rejects: {} };
  if (doorways.length < 2) return report;
  ensureArcs(g);

  const standoff = tune.standoff ?? RELAY_STANDOFF;
  const segments = tune.segments ?? RELAY_SEGMENTS;
  const cap = tune.maxPerFloor ?? RELAY_MAX_PER_FLOOR;

  // Pairs that share a section, in a fixed order — this runs inside
  // `buildTrackFloor`'s single seeded stream and must not draw from it.
  const pairs: Array<{ a: Doorway; b: Doorway; span: number }> = [];
  for (let i = 0; i < doorways.length; i++) {
    for (let j = i + 1; j < doorways.length; j++) {
      const a = doorways[i];
      const b = doorways[j];
      const shares = a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b;
      if (!shares) continue;
      const span = Math.hypot(a.i - b.i, a.j - b.j);
      if (span < RELAY_MIN_SPAN || span > RELAY_MAX_SPAN) continue;
      pairs.push({ a, b, span });
    }
  }
  // Widest first: a long relay is a longer ride and a more legible object.
  pairs.sort((p, q) => q.span - p.span || p.a.i - q.a.i || p.a.j - q.a.j);

  const committed: JawPlan[] = [];
  let built = 0;

  for (const { a, b } of pairs) {
    if (report.chambers >= cap) break;
    const f1 = mouth(a);
    const f2 = mouth(b);
    const c = Math.hypot(f2.x - f1.x, f2.z - f1.z) / 2;
    const e = ellipseFromFoci(f1, f2, c + standoff);
    if (!e) continue;

    let halves = 0;
    // The two halves of the ellipse, either side of the major axis.
    for (const [t0, t1] of [
      [0.12, Math.PI - 0.12],
      [Math.PI + 0.12, 2 * Math.PI - 0.12],
    ] as const) {
      const chain = arcChainFromSamples(ellipseSamples(e, t0, t1, segments), true, "funnel");
      if (chain.length === 0) continue;
      // Nothing is sealed here: a relay wall never sits in a doorway's own
      // threshold, because it is authored along the boundary BETWEEN the two
      // mouths rather than across either of them.
      const plan = planChain(g, chain, occupied, () => false);
      if (typeof plan === "string") {
        report.rejects[plan] = (report.rejects[plan] ?? 0) + 1;
        continue;
      }
      if (!plan.features.every((f, k) => junctionClear(g, plan.arcTiles[k], f))) {
        report.rejects.junction = (report.rejects.junction ?? 0) + 1;
        continue;
      }
      // A relay wall is ridden toward whichever mouth is nearer the stretch
      // that survived, so the lane is aimed per-feature rather than per-wall.
      plan.mouth = undefined;
      for (const f of plan.features) {
        const mid = f.a0 + f.span / 2;
        const px = f.cx + Math.cos(mid) * f.r;
        const pz = f.cz + Math.sin(mid) * f.r;
        const near = Math.hypot(px - f1.x, pz - f1.z) <= Math.hypot(px - f2.x, pz - f2.z) ? f2 : f1;
        // Carry toward the FAR mouth: the near one is where the ball came from.
        f.lanes = [laneTowardMouth(f, near)];
      }
      built += commitJaw(g, plan);
      committed.push(plan);
      report.carved += plan.carveTiles.length;
      report.filled += plan.fillTiles.length;
      halves++;
    }
    if (halves > 0) report.chambers++;
  }

  // Same collective guard as the funnels, unwound one wall at a time — see
  // `doorway-funnels.ts` for why it is unconditional and why it is not
  // all-or-nothing.
  const stranded = (): boolean => {
    const d = bfsDistancesOwned(g, start.i, start.j);
    for (let j = 0; j < g.h; j++) {
      for (let i = 0; i < g.w; i++) {
        if (isWalkable(g, i, j) && d[idx(g, i, j)] < 0) return true;
      }
    }
    return false;
  };
  while (committed.length > 0 && stranded()) {
    const p = committed.pop()!;
    revertJaw(g, p);
    built -= p.features.length;
    report.reverted += p.features.length;
    report.carved -= p.carveTiles.length;
    report.filled -= p.fillTiles.length;
  }
  report.features = built;
  return report;
}

/** The ellipse a pair of mouths would relay across — exposed for tests. */
export function relayEllipse(a: Doorway, b: Doorway, standoff = RELAY_STANDOFF): ArcFeature[] {
  const f1 = mouth(a);
  const f2 = mouth(b);
  const c = Math.hypot(f2.x - f1.x, f2.z - f1.z) / 2;
  const e = ellipseFromFoci(f1, f2, c + standoff);
  if (!e) return [];
  return arcChainFromSamples(ellipseSamples(e, 0.12, Math.PI - 0.12, RELAY_SEGMENTS), true, "funnel");
}
