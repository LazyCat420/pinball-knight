/**
 * FLOOR RULES — the one place a "floors must look like this" statement lives.
 *
 * ── Why a registry and not just more code in the generator ────────────────
 *
 * Rules about a floor's shape were already being enforced, in four different
 * places, in four different styles: `pickTrackEndpoints` pushes the exit a lap
 * away with a tie-band, `carveLaunchChute` scores sites by length, `boss.ts`
 * sites the king on the stairs, and a couple of assertions in test files pin
 * fractions that nothing in production knows about. Adding "the spawn should be
 * in a corner" as a fifth style is how a generator ends up with rules nobody can
 * enumerate — and, worse, rules that quietly stop holding.
 *
 * That last failure is the one worth designing against, because it has already
 * happened in this codebase more than once: `FORWARD_FLOW_KINDS` was missing
 * `booster` for as long as boosters have existed, and the test that should have
 * caught it was measuring a different field. A rule is only real if something
 * MEASURES it on generated floors. So every rule here carries its own `check`,
 * and one test runs all of them over ~80 floors (floor-rules.test.ts). The rule
 * and its gate cannot drift apart because they are the same object.
 *
 * ── Preferences, not booleans ─────────────────────────────────────────────
 *
 * The obvious design — a list of hard constraints, applied in order — does not
 * work, and it is worth being explicit about why before someone "simplifies"
 * this back into one.
 *
 * Constraints like "spawn in a corner", "exit a lap away" and "boss far from
 * spawn" can be JOINTLY UNSATISFIABLE on a small early floor: the corner that
 * satisfies the first may be the only region that makes the second impossible.
 * Applied in sequence, whichever rule ran last silently wins and the generator
 * reports success. So the placement half of this module is a SCORE, sitting on
 * top of whatever the existing siting code already optimises, and the invariant
 * half is a separate `check` with thresholds chosen to be genuinely reachable.
 *
 * `pickTrackEndpoints` already had the right instinct — it collects every
 * candidate within `TIE` of the best distance and then picks among them by a
 * second criterion. Allocation, not argmax. This is the same shape, named.
 *
 * ── Global rule, per-archetype WEIGHT ─────────────────────────────────────
 *
 * The archetype does not get to write its own placement code — that is how you
 * get two owners of one decision, which this codebase has paid for before (see
 * the note in track-floor.ts about curves having been authored by both the
 * geometry pass and the content pass). It supplies WEIGHTS to rules defined
 * here, exactly as `TrackProfile` already supplies `fill`/`linkChance`/`survive`
 * to one shared generator. Same mechanism, extended — not a parallel system.
 *
 * DOM- and three-free, no rng: a rule must evaluate identically on every co-op
 * peer.
 */
import { type Grid, type TilePos, idx, isWalkable } from "./generator";
import type { ArchetypeId } from "./archetypes";

/**
 * The archetype's grip on the placement rules.
 *
 * One knob per rule that has a legitimate per-floor-type answer. A rule with no
 * entry here is GLOBAL and identical everywhere, which is the default and
 * should stay the default — a weight exists only when a floor type has a real
 * reason to differ, not so that every rule is configurable.
 */
export interface FloorRuleWeights {
  /**
   * How strongly the spawn is pulled toward the map's edge, 0..1.
   *
   * 1 = "put me in a corner", 0 = "anywhere is fine, including dead centre".
   *
   * This is the knob the user asked for by name ("the starting point should
   * always be the corner of a map … unless it's for specific types of levels").
   * The exemption is real and `greathall` is what it is for: that archetype's
   * whole shape is one great chamber with a plaza carved at the most central
   * junction, so spawning on its rim would put the player outside the thing the
   * floor is about.
   *
   * Censused before this existed: spawn sat a mean 58-66% of the way from the
   * nearest corner to the centre on EVERY archetype — a spread of 8 points
   * across five supposedly distinct floor types, i.e. the archetype had no
   * influence on spawn at all.
   */
  perimeterBias: number;
  /**
   * Minimum path distance, in tiles, from the spawn to the boss. The king rides
   * the stairs (core.ts sites him at `nearestOpenTile(stairs, 2)`), so in
   * practice this is a constraint on the EXIT.
   *
   * Absolute tiles rather than a fraction of the floor's reach, and that choice
   * is load-bearing. Floors grow roughly 4x in area from depth 1 to depth 25, so
   * a pure fraction lets the absolute distance collapse on a small floor; but a
   * pure fraction is also wrong in the other direction, because "max reach"
   * includes maze cul-de-sacs that nothing is ever placed in — censused, the
   * boss sat at 20% of max reach on one floor while still being 65 tiles of
   * walking away. Tiles are what the player actually experiences.
   */
  minBossTiles: number;
  /**
   * Minimum STRAIGHT-LINE distance, in tiles, from the spawn to the boss.
   *
   * ── Why path distance was not enough, measured in the running game ───────
   *
   * `minBossTiles` above is a walking constraint and every floor cleared it —
   * yet the king was arriving 6.7 tiles from the player at t=0 on seed 1 and
   * 8.9 on seed 777 (`__dungeonBoss()`). Both numbers are true at once: there
   * is a wall between them, so the WALK is 30+ steps while the SIGHT LINE is
   * seven tiles.
   *
   * A wall is not distance here, and the reason is specific rather than
   * aesthetic — the king's two ranged attacks ignore geometry outright:
   *   · `updateBones` hits on proximity alone, `hypot(p - b) < BONE_HIT_R`,
   *     with no line-of-sight test — skulls fly through stone;
   *   · `doSlam` commits the ground-pound to the knight's current position,
   *     also unblocked.
   * So a boss "far away" by path can open fire on the spawn.
   *
   * Both constraints are therefore real and they are NOT redundant: path
   * distance is what makes the floor a journey, straight-line distance is what
   * keeps him out of your opening. Enforce both.
   */
  minBossEuclid: number;
}

/**
 * The GLOBAL baseline. An archetype overrides only what it has a reason to.
 *
 * `minBossTiles` is set from measurement, not taste: censused over 78 floors on
 * the shipping generator the boss's spawn tile was never nearer than **56** path
 * steps, mean 68% of the floor's whole reach. 30 is therefore a floor the
 * current generator clears roughly two-fold.
 *
 * That makes it a REGRESSION GUARD rather than a discovery, and it is worth
 * saying so plainly: this rule finds nothing today. Its job is to fail loudly on
 * the day someone retunes `pickTrackEndpoints` or moves the king off the stairs,
 * which is exactly the change that would otherwise ship unnoticed.
 */
export const DEFAULT_RULE_WEIGHTS: FloorRuleWeights = {
  perimeterBias: 0.75,
  minBossTiles: 30,
  // Comfortably past BONE_MAX_DIST (16) so the opening cannot be shot at, with
  // a little margin for the knight drifting toward him on the launch.
  minBossEuclid: 20,
};

/**
 * How close to the map's EDGE a tile is: 1.0 hard against the border, 0.0 dead
 * centre, measured on the shorter axis so a long thin floor is not scored as
 * "central" everywhere just because it is wide.
 *
 * Edge distance, not corner distance, and the difference matters. Scoring by
 * proximity to the nearest of four corners produces four tiny hot spots and
 * rejects the entire rest of the border — on a floor whose circuit happens not
 * to reach a corner that yields no acceptable site at all, and the bias silently
 * does nothing. A perimeter band is what "in the corner of the map" actually
 * means to a player looking at a minimap: over at the edge, not in the middle.
 */
export function perimeterScore(g: Grid, i: number, j: number): number {
  const half = Math.min(g.w, g.h) / 2;
  if (half <= 0) return 0;
  const d = Math.min(i, j, g.w - 1 - i, g.h - 1 - j);
  return Math.max(0, Math.min(1, 1 - d / half));
}

/**
 * The perimeter score a high-bias floor must reach. Exported because the
 * generator needs the SAME number to decide whether a fallback was forced —
 * two copies of this threshold drifting apart is how a "relaxation" gets
 * recorded for a floor that actually complied, or vice versa.
 */
export const PERIMETER_RULE_MIN = 0.34;

/** Everything a rule needs to judge a finished floor. */
export interface FloorRuleContext {
  grid: Grid;
  start: TilePos;
  stairs: TilePos;
  /** Where the Reaper King will stand — core.ts's `nearestOpenTile(stairs, 2)`. */
  bossSpot: TilePos;
  /** BFS step distance from `start` to every tile. */
  distFromStart: Int32Array;
  archetype: ArchetypeId;
  weights: FloorRuleWeights;
  /**
   * Rule ids the generator declared it could not satisfy on this floor
   * (`TrackFloor.relaxed`). A rule listed here reports OK — but the gate test
   * separately caps how OFTEN that may happen, so a relaxation is a recorded
   * exception rather than an escape hatch that hollows the rule out.
   */
  relaxed?: readonly string[];
}

export interface RuleVerdict {
  ok: boolean;
  /** Human-readable measurement, shown on failure. Always populated — a passing
   *  rule's number is what tells you whether the threshold is doing any work. */
  detail: string;
}

export interface FloorRule {
  id: string;
  /** One line: what a player would notice if this stopped holding. */
  why: string;
  check(ctx: FloorRuleContext): RuleVerdict;
}

/** Max finite BFS distance in a field — the floor's reach. */
export function maxReach(g: Grid, dist: Int32Array): number {
  let m = 0;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (!isWalkable(g, i, j)) continue;
      const d = dist[idx(g, i, j)];
      if (d >= 0 && d < 0x3fffffff && d > m) m = d;
    }
  }
  return m;
}

function pathTo(ctx: FloorRuleContext, t: TilePos): number {
  const d = ctx.distFromStart[idx(ctx.grid, t.i, t.j)];
  return d >= 0 && d < 0x3fffffff ? d : -1;
}

/**
 * THE RULES. Order is presentational only — every one is checked.
 */
export const FLOOR_RULES: FloorRule[] = [
  {
    id: "boss-not-near-spawn",
    why: "you would arrive on the floor already inside the king's reach, with no room to build speed",
    check(ctx) {
      const d = pathTo(ctx, ctx.bossSpot);
      if (d < 0) return { ok: false, detail: "boss tile is unreachable from the spawn" };
      return { ok: d >= ctx.weights.minBossTiles, detail: `${d} path tiles (floor wants >= ${ctx.weights.minBossTiles})` };
    },
  },
  {
    id: "boss-not-within-sight-of-spawn",
    why: "his skulls and his ground-pound both ignore walls, so a boss seven tiles away through stone can open fire on your spawn",
    check(ctx) {
      const d = Math.hypot(ctx.bossSpot.i - ctx.start.i, ctx.bossSpot.j - ctx.start.j);
      if (ctx.relaxed?.includes("boss-not-within-sight-of-spawn")) {
        return { ok: true, detail: `${d.toFixed(1)} tiles straight-line — RELAXED (floor too small to separate them)` };
      }
      return { ok: d >= ctx.weights.minBossEuclid, detail: `${d.toFixed(1)} tiles straight-line (wants >= ${ctx.weights.minBossEuclid})` };
    },
  },
  {
    id: "exit-not-near-spawn",
    why: "the floor would be over in seconds — the stairs are the run's pacing",
    check(ctx) {
      // Separate from the boss rule even though the king rides the stairs,
      // because the two can come apart: `nearestOpenTile` searches outward, and
      // a future change that moves the king (an arena, a wandering boss) must
      // not silently take this guarantee with it.
      const d = pathTo(ctx, ctx.stairs);
      if (d < 0) return { ok: false, detail: "stairs unreachable from the spawn" };
      return { ok: d >= ctx.weights.minBossTiles, detail: `${d} path tiles (floor wants >= ${ctx.weights.minBossTiles})` };
    },
  },
  {
    id: "spawn-respects-perimeter-bias",
    why: "every floor type would open in the same place, which is what the archetypes exist to prevent",
    check(ctx) {
      const s = perimeterScore(ctx.grid, ctx.start.i, ctx.start.j);
      const want = ctx.weights.perimeterBias;
      // A BAND, not a threshold, and only enforced where the archetype actually
      // asks for one. A high bias must land the spawn outside the middle third;
      // a low bias (greathall) asserts nothing, because "anywhere" is the point
      // and a two-sided test there would just be a random gate.
      if (want < 0.5) return { ok: true, detail: `bias ${want} — exempt (perimeterScore ${s.toFixed(2)})` };
      if (ctx.relaxed?.includes("spawn-respects-perimeter-bias")) {
        return { ok: true, detail: `perimeterScore ${s.toFixed(2)} — RELAXED (no peripheral site existed)` };
      }
      return { ok: s >= PERIMETER_RULE_MIN, detail: `perimeterScore ${s.toFixed(2)} (bias ${want} wants >= ${PERIMETER_RULE_MIN})` };
    },
  },
  {
    id: "spawn-is-walkable",
    why: "the player would start inside a wall",
    check(ctx) {
      return {
        ok: isWalkable(ctx.grid, ctx.start.i, ctx.start.j),
        detail: `start ${ctx.start.i},${ctx.start.j}`,
      };
    },
  },
];

/** Run every rule. Returns the failures, empty when the floor is clean. */
export function checkFloorRules(ctx: FloorRuleContext): Array<{ rule: FloorRule; verdict: RuleVerdict }> {
  const out: Array<{ rule: FloorRule; verdict: RuleVerdict }> = [];
  for (const rule of FLOOR_RULES) {
    const verdict = rule.check(ctx);
    if (!verdict.ok) out.push({ rule, verdict });
  }
  return out;
}
