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
import { measureDoorway, clearanceField, widthFromClearance, MIN_DOORWAY_WIDTH, DOORWAY_WIDTHS, type Doorway } from "./doorways";

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

/**
 * THE KING'S HALL — how much clear floor the Reaper King's fight needs, in tiles
 * of radius. DERIVED from his own mechanics, not chosen.
 *
 * The ground-pound is the only attack a room's SIZE changes. `updateBones` hits
 * on proximity with no line-of-sight test, so walls do nothing about the skull
 * barrage; the leash and the wake are path/anchor numbers no room this size can
 * trip. So the derivation is about `doSlam`:
 *
 *   dodge = SLAM_RADIUS 2.6 + PLAYER_R 0.3                    = 2.90
 *   noGo  = KING_BODY_R 0.784 + PLAYER_R 0.3                  = 1.08
 *
 * The crater commits to where you were standing, so you must TRAVEL `dodge` —
 * and you cannot travel through the king, so a dodge lane is needed on each side
 * of him:
 *
 *   span  = 2*dodge + 2*noGo = 7.97                           -> radius 3.98
 *   + KING_HOME_TILES 2.5 (how far he drifts off the anchor)  = 6.48  -> 7
 *
 * ── Why not bigger, which is the part worth writing down ──
 *
 * Diameter 14 is inside BONE_MAX_DIST (16) ON PURPOSE. A hall he cannot shoot
 * across is a hall you kite him around, which turns the fight from a duel into a
 * chore. That ceiling — not the carve cost — is what fixes the upper bound, and
 * it is why "round it up for a nicer doorway" is the wrong instinct: at radius
 * 8.4 the hall would earn a width-7 mouth from DOORWAY_TIERS and break this.
 *
 * Cross-check: pi*7^2 ~ 154 tiles, 3.9% of the smallest floor, which is SMALLER
 * than the greathall plaza that already ships (plazaFrac 0.16 -> ~226 tiles). The
 * precedent already carries a bigger disc.
 */
export const BOSS_ARENA_R = 7;
/**
 * The same statement as BOSS_ARENA_R, expressed as a passage WIDTH so the gate
 * can read it straight off `clearanceField` — the instrument the doorway system
 * already uses, already exported, already deterministic. Two instruments for one
 * quantity is how the old down-flow test came to measure a field nothing was
 * oriented on.
 *
 * 9 and 7 are consistent: `core.ts` sites the king at `nearestOpenTile(stairs, 2)`,
 * which in an open hall is a ring-1 neighbour — one tile off the exit — and
 * `carveBossChamber` allows the centre one tile of slide. The widest circle that
 * fits at his tile is therefore R - 1 - 1 = 5, and widthFromClearance gives
 * 2*5 - 1 = 9.
 */
export const BOSS_ARENA_MIN_WIDTH = 9;

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
  /**
   * The floor's authored openings between sections (`TrackFloor.doorways`).
   *
   * Absent on a legacy maze floor, which has no section plan — the rule then
   * has nothing to judge and says so rather than passing silently.
   */
  doorways?: readonly Doorway[];
  /**
   * `clearanceField(grid)`, hoisted by the caller so 80 floors x N rules do not
   * each run their own O(tiles) distance transform. Recomputed if absent.
   */
  clearance?: Int32Array;
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
    id: "doorways-are-uniform",
    why: "an opening the maze happened to leave one tile wide reads as sloppy and rattles the ball between both walls at speed; a doorway is supposed to be a recognisable object",
    check(ctx) {
      const ds = ctx.doorways;
      if (!ds) return { ok: true, detail: "-1 — no doorway plan (legacy floor)" };
      // A floor with one section — a greathall that is genuinely one chamber —
      // has no pair to join and authors nothing. That is a legitimate outcome
      // and this rule has nothing to say about it. What it must NOT become is a
      // silent pass for a broken pass, so the RATE is asserted separately in
      // floor-rules.test.ts, exactly as it is for `relaxed`.
      if (ds.length === 0) return { ok: true, detail: "0 authored — no two sections to join on this floor" };
      // ⚠️ MEASURED THROUGH THE AUTHORED CENTRES, never re-derived from the
      // finished grid. A widened doorway is no longer a pinch, so re-detection
      // returns precisely the openings that were NOT fixed and then measures a
      // run that has merged into the space beyond — an early version reported
      // an opening as "9 wide" for exactly that reason and failed 78/78 floors
      // on a metric that measured the opposite of its claim.
      let worst = Infinity;
      let where = ds[0];
      const offSize: Doorway[] = [];
      for (const d of ds) {
        const w = measureDoorway(ctx.grid, d);
        if (w < worst) {
          worst = w;
          where = d;
        }
        if (w < d.w) offSize.push(d);
      }
      if (offSize.length) {
        const d = offSize[0];
        return {
          ok: false,
          detail: `${measureDoorway(ctx.grid, d)} tiles at (${d.i},${d.j}) — authored ${d.w}, ${offSize.length}/${ds.length} came out under their own size`,
        };
      }
      return {
        ok: worst >= MIN_DOORWAY_WIDTH,
        detail: `${worst} tiles narrowest of ${ds.length} authored (vocabulary ${[...DOORWAY_WIDTHS].reverse().join("/")}, wants >= ${MIN_DOORWAY_WIDTH})`,
      };
    },
  },
  {
    id: "boss-has-room-to-fight",
    why: "his ground-pound commits to where you were standing 1.1s ago and kills everything within 2.6 tiles of it — in a four-wide gallery there is nowhere to dodge TO, so the fight degenerates into standing in the crater and trading blows",
    check(ctx) {
      // No doorway plan means no chamber pass ran — a legacy maze floor. Same
      // handling as `doorways-are-uniform`: say it has no instrument rather than
      // pass silently, because a silent pass reads as coverage.
      if (!ctx.doorways) return { ok: true, detail: "-1 — legacy floor, no chamber pass" };
      const cl = ctx.clearance ?? clearanceField(ctx.grid);
      // Measured at the KING's tile, not the stairs'. The two differ by one ring
      // (`nearestOpenTile(stairs, 2)`), and that one tile is exactly the
      // difference between the hall's 11 and the 9 required here.
      const w = widthFromClearance(cl[idx(ctx.grid, ctx.bossSpot.i, ctx.bossSpot.j)]);
      if (ctx.relaxed?.includes("boss-has-room-to-fight")) {
        return { ok: true, detail: `${w} tiles across — RELAXED (no site on this floor could take an r=${BOSS_ARENA_R} hall)` };
      }
      return {
        ok: w >= BOSS_ARENA_MIN_WIDTH,
        detail: `${w} tiles across at the king's tile (wants >= ${BOSS_ARENA_MIN_WIDTH}; derived from SLAM_RADIUS 2.6 + PLAYER_R 0.3, twice, plus the king's own 1.08)`,
      };
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
