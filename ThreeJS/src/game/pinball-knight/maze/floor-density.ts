/**
 * FLOOR DENSITY — how much stuff is on the floor, as numbers with bands.
 *
 * ── Why a separate module from floor-metrics ──────────────────────────────
 *
 * `measureFloor`'s header commits it to being content-free: "it reads only the
 * tile grid, the endpoints and (optionally) the track mask, so it can run over
 * ANY floor from either generator branch without dragging in decoration". That
 * is a good property and adding `plan.parts` to it would break it for every
 * existing caller. So density lives here, taking a STRUCTURAL type rather than
 * importing `decorate` — the dependency stays one-way, exactly as `FlowPart`
 * does for flow-loops.
 *
 * ── Why it exists at all ──────────────────────────────────────────────────
 *
 * Live QA of floor 5: "the map generation … is just kind of a jumbled mess".
 * There was no metric anywhere that could have said so. `checkFloor` measures
 * reachability, path length, dead ends, open share and branchiness — a floor can
 * pass every one of them while carrying 260 parts, 135 zombies and 150 props on
 * 3900 walkable tiles, which is what floor 5 was doing. Censused before this
 * module, the shipping floors ran at **154-201 objects per 1000 walkable tiles**
 * and the route layer alone owned 55-72% of all furniture.
 *
 * Every threshold below is derived from something — a spacing, a light radius, a
 * traversal time — and NOT from taste. Where a number is a headroom margin over
 * what the generator now produces, that is said out loud, because a gate set at
 * exactly the current output tests nothing except that nobody changed anything.
 *
 * DOM-, three- and rng-free. Pure: takes a plan and an area, returns numbers.
 */

/** The subset of a `LevelPlan` this module reads. Structural on purpose. */
export interface DensityInput {
  parts: readonly { readonly spine?: boolean }[];
  spawns: readonly unknown[];
  torches: readonly unknown[];
  props: readonly unknown[];
  items: readonly unknown[];
}

export interface DensityMetrics {
  walkable: number;
  parts: number;
  routeParts: number;
  spawns: number;
  torches: number;
  props: number;
  items: number;
  partsPer1k: number;
  routePartsPer1k: number;
  spawnsPer1k: number;
  torchesPer1k: number;
  propsPer1k: number;
  /** Everything the player can see standing on the floor, per 1k walkable. */
  furniturePer1k: number;
  /**
   * routeParts / parts — the HIERARCHY check, and the one a per-class threshold
   * cannot make. A floor whose furniture is nearly all route is a conveyor with
   * no rooms; one with no route furniture has no through-line to follow.
   */
  routeShare: number;
  /** walkable / parts — the same statement as partsPer1k, human-readable. */
  tilesPerPart: number;
}

export function measureDensity(plan: DensityInput, walkable: number): DensityMetrics {
  const w = Math.max(1, walkable);
  const per1k = (n: number): number => (n * 1000) / w;
  const parts = plan.parts.length;
  const routeParts = plan.parts.filter((p) => p.spine).length;
  const furniture = parts + plan.spawns.length + plan.torches.length + plan.props.length + plan.items.length;
  return {
    walkable,
    parts,
    routeParts,
    spawns: plan.spawns.length,
    torches: plan.torches.length,
    props: plan.props.length,
    items: plan.items.length,
    partsPer1k: per1k(parts),
    routePartsPer1k: per1k(routeParts),
    spawnsPer1k: per1k(plan.spawns.length),
    torchesPer1k: per1k(plan.torches.length),
    propsPer1k: per1k(plan.props.length),
    furniturePer1k: per1k(furniture),
    routeShare: parts > 0 ? routeParts / parts : 0,
    tilesPerPart: parts > 0 ? w / parts : Infinity,
  };
}

export interface DensityConstraints {
  maxPartsPer1k: number;
  minPartsPer1k: number;
  maxRoutePartsPer1k: number;
  minRoutePartsPer1k: number;
  maxRouteShare: number;
  minRouteShare: number;
  maxSpawnsPer1k: number;
  minSpawnsPer1k: number;
  maxTorchesPer1k: number;
  minTorchesPer1k: number;
  maxPropsPer1k: number;
  maxFurniturePer1k: number;
}

/**
 * The bands. WIDE on purpose — the same house rule `floor-metrics` states: a
 * constraint is a "this floor is broken" line, not a tuning target, and a tight
 * band turns every legitimate archetype difference into a failure.
 */
export const DEFAULT_DENSITY: DensityConstraints = {
  // For N parts scattered over A walkable tiles the mean nearest-neighbour
  // spacing is ~0.5*sqrt(A/N). At 34 per 1k that is 2.7 tiles — one part
  // crossing your line every 0.18 s at BOOSTER_SPEED, which is already at the
  // edge of reading as a distinct event rather than a texture. Measured after
  // the route rework: 15.6-28.2. Before it: 23.9-77.1.
  maxPartsPer1k: 34,
  // Below one part per 125 walkable tiles the floor is a maze, not a table.
  minPartsPer1k: 8,
  // `routeBudget` is walkable/110 = 9.1 per 1k by construction, so this is that
  // rule plus ~30% headroom: it catches a regression, not the rule itself.
  // Measured after: 3.5-8.0. Before: up to 55.
  maxRoutePartsPer1k: 12,
  // The trim and the budget must never delete the through-line entirely.
  minRoutePartsPer1k: 1.5,
  // The hierarchy, as a number. A floor is a road with rooms off it, not four
  // equally loud roads (which is what 0.60-0.73 measured before) and not a
  // scatter with no road (which is what a broken route pass would give).
  maxRouteShare: 0.6,
  minRouteShare: 0.1,
  // `floorBudgets` peaks at 22.5 spawns per 1k (at L8, where the ramp meets the
  // cap), so this is +25%. Before the area fix: up to 64.7.
  maxSpawnsPer1k: 28,
  // A floor a harsh modifier rolled empty is a bug, not a difficulty setting.
  minSpawnsPer1k: 5,
  // `floorBudgets` peaks at 16.6 torches per 1k; +33%. Before: up to 37.3.
  maxTorchesPer1k: 22,
  // With TORCH_LIGHT_POOL = 6 live lights at radius 6, below ~4 per 1k the mean
  // nearest-torch distance exceeds a light radius and regions go black.
  minTorchesPer1k: 4,
  // propBudget is walkable/40 = 25 per 1k; +20%. Before: 37-38, flat with depth.
  maxPropsPer1k: 30,
  // ── THE AGGREGATE LEGIBILITY BOUND, and the headline number.
  // One object per >= 9 walkable tiles, i.e. one object every ~0.6 s along a
  // ride at BOOSTER_SPEED. Measured after the wave: 63.8-96.8. Before it:
  // 85.4-200.8, i.e. every shallow floor was over this line and the worst was
  // at nearly double it.
  maxFurniturePer1k: 110,
};

/** Everything wrong with this floor's density; empty when it is fine. */
export function checkDensity(m: DensityMetrics, c: DensityConstraints = DEFAULT_DENSITY): string[] {
  const bad: string[] = [];
  const band = (v: number, lo: number, hi: number, name: string): void => {
    if (v > hi) bad.push(`${name} ${v.toFixed(1)} > ${hi}`);
    else if (v < lo) bad.push(`${name} ${v.toFixed(1)} < ${lo}`);
  };
  band(m.partsPer1k, c.minPartsPer1k, c.maxPartsPer1k, "parts/1k");
  band(m.routePartsPer1k, c.minRoutePartsPer1k, c.maxRoutePartsPer1k, "routeParts/1k");
  band(m.spawnsPer1k, c.minSpawnsPer1k, c.maxSpawnsPer1k, "spawns/1k");
  band(m.torchesPer1k, c.minTorchesPer1k, c.maxTorchesPer1k, "torches/1k");
  if (m.propsPer1k > c.maxPropsPer1k) bad.push(`props/1k ${m.propsPer1k.toFixed(1)} > ${c.maxPropsPer1k}`);
  if (m.furniturePer1k > c.maxFurniturePer1k) bad.push(`furniture/1k ${m.furniturePer1k.toFixed(1)} > ${c.maxFurniturePer1k}`);
  band(m.routeShare, c.minRouteShare, c.maxRouteShare, "routeShare");
  return bad;
}

/** One line, for a commit message, a debug overlay or a failing test. */
export function formatDensity(m: DensityMetrics): string {
  return (
    `${m.walkable} walkable | parts ${m.parts} (${m.partsPer1k.toFixed(1)}/1k, ${m.tilesPerPart.toFixed(1)} tiles apart) | ` +
    `route ${m.routeParts} (${m.routePartsPer1k.toFixed(1)}/1k, share ${m.routeShare.toFixed(2)}) | ` +
    `spawns ${m.spawnsPer1k.toFixed(1)}/1k | torches ${m.torchesPer1k.toFixed(1)}/1k | ` +
    `props ${m.propsPer1k.toFixed(1)}/1k | ALL ${m.furniturePer1k.toFixed(1)}/1k`
  );
}
