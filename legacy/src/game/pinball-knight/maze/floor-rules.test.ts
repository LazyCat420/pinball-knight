/**
 * THE RULE GATE — every rule in `FLOOR_RULES`, run over real generated floors.
 *
 * This is the file that makes the registry mean something. A rule that exists
 * only as code in the generator is a rule that can silently stop holding: it
 * happened with `FORWARD_FLOW_KINDS`, which was missing `booster` for as long as
 * boosters existed while a green test measured a different field entirely. So
 * the rules carry their own `check`, and this iterates them — a new rule is
 * covered the moment it is added to the array, with no test to remember to
 * write.
 *
 * Floors are built through the SHIPPING path (`buildTrackFloor` with the
 * archetype's profile), because a rule that only holds on a synthetic grid is
 * not a rule about the game.
 */
import { describe, it, expect } from "vitest";
import { generateMaze, carveRooms, crackSecretWalls, mulberry32, idx, isWalkable, type TilePos } from "./generator";
import { stampPrefabs, stampLandmark, pickFocusCells, themeFor } from "./prefabs";
import { archetypeFor, windinessFor } from "./archetypes";
import { buildTrackFloor } from "./track-floor";
import { nearestOpenTile } from "./nearest-open-tile";
import { clearanceField } from "./doorways";
import { SLAM_RADIUS, KING_BODY_R, KING_HOME_TILES, BONE_MAX_DIST } from "../boss";
import { PLAYER_R } from "../constants";
import { bfsDistances } from "../engine/flow-field";
import { levelConfig } from "../constants";
import { FLOOR_RULES, DEFAULT_RULE_WEIGHTS, checkFloorRules, perimeterScore, maxReach, type FloorRuleContext, BOSS_ARENA_R, BOSS_ARENA_MIN_WIDTH } from "./floor-rules";
import { measureDoorway, DOORWAY_WIDTHS } from "./doorways";
import { floorRng } from "./floor-seed";

const RUN_SEEDS = [1, 12345, 0xc0ffee, 987654321, 424242, 7777];
const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 13, 17, 20, 25];

/** Build one floor exactly as `core.ts startLevel` does, and its rule context. */
function floorContext(level: number, runSeed: number): FloorRuleContext | null {
  const rng = floorRng(runSeed, level);
  const cfg = levelConfig(level);
  const arch = archetypeFor(level);
  const windiness = windinessFor(level, arch, rng);
  const raw = generateMaze(cfg.cellsW, cfg.cellsH, rng, cfg.braid * arch.braidMult, windiness, {
    seeds: arch.seeds(cfg.cellsW, cfg.cellsH, rng) ?? undefined,
    solidSeeds: arch.solid,
    braidGradient: arch.braidGradient,
  });
  carveRooms(raw, rng, cfg.rooms, 3, 6);
  const theme = themeFor(level, runSeed);
  const landmark = stampLandmark(raw, rng, theme);
  const focus = pickFocusCells(raw, rng);
  stampPrefabs(raw, rng, Math.min(3 + Math.floor((level - 1) / 2), 6), theme, landmark.claimed, focus);
  crackSecretWalls(raw, rng, cfg.secrets);
  const track = buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
    profile: arch.track,
    density: Math.max(0.35, Math.min(0.85, windiness)),
  });
  if (!track) return null;
  const grid = track.grid;
  // The king rides the stairs — core.ts sites him with exactly this call.
  const bossSpot: TilePos = nearestOpenTile(grid, track.stairs.i, track.stairs.j, 2) ?? track.stairs;
  return {
    grid,
    start: track.start,
    stairs: track.stairs,
    bossSpot,
    distFromStart: bfsDistances(grid, track.start.i, track.start.j),
    archetype: arch.id,
    weights: { ...DEFAULT_RULE_WEIGHTS, ...(arch.track.rules ?? {}) },
    relaxed: track.relaxed,
    doorways: track.doorways,
    // Hoisted: 78 floors x N rules each running their own O(tiles) distance
    // transform is the kind of cost that quietly makes a gate too slow to keep.
    clearance: clearanceField(grid),
  };
}

describe("floor rules", () => {
  it("every rule holds on every generated floor", () => {
    const failures: string[] = [];
    let floors = 0;
    for (const runSeed of RUN_SEEDS) {
      for (const level of LEVELS) {
        const ctx = floorContext(level, runSeed);
        if (!ctx) continue;
        floors++;
        for (const { rule, verdict } of checkFloorRules(ctx)) {
          failures.push(`L${level} seed ${runSeed} (${ctx.archetype}) — ${rule.id}: ${verdict.detail}\n      why it matters: ${rule.why}`);
        }
      }
    }
    expect(floors, "no floors generated — the harness is broken, not the rules").toBeGreaterThan(60);
    expect(failures, `${failures.length}/${floors} floors broke a rule:\n    ${failures.slice(0, 10).join("\n    ")}`).toEqual([]);
  }, 300000);

  it("RELAXATIONS stay rare — the escape hatch is not doing the work", () => {
    // `relaxed` lets the generator stand a rule down when it genuinely cannot be
    // met (no peripheral chute site exists on a floor whose circuit never
    // reaches the border). That is the honest handling of jointly-unsatisfiable
    // constraints — but it is also exactly how a rule quietly becomes a no-op,
    // so the RATE is capped here.
    //
    // If this fails, the fix is almost never to raise the cap: it means either
    // the threshold has drifted out of reach or the siting stopped trying.
    let floors = 0;
    const counts = new Map<string, number>();
    for (const runSeed of RUN_SEEDS) {
      for (const level of LEVELS) {
        const ctx = floorContext(level, runSeed);
        if (!ctx) continue;
        floors++;
        for (const id of ctx.relaxed ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    for (const [id, n] of counts) console.log(`  relaxed ${id}: ${n}/${floors} floors (${((100 * n) / floors).toFixed(1)}%)`);
    for (const [id, n] of counts) {
      expect(n / floors, `${id} was relaxed on ${n}/${floors} floors — the rule is not doing its job`).toBeLessThan(0.12);
    }
    expect(floors).toBeGreaterThan(60);
  }, 300000);

  it("the rules are actually DOING something — each one's margin is reported", () => {
    // A gate every floor clears by a mile is worth knowing about: it is either a
    // regression guard (fine, and `boss-not-near-spawn` is deliberately one) or
    // a threshold that has drifted into irrelevance (not fine). Printing the
    // tightest observed margin per rule is what tells the two apart, and it is
    // the check that would have caught the old down-flow test asserting against
    // a field nothing was oriented on.
    const tightest = new Map<string, { detail: string; ctx: string }>();
    let floors = 0;
    for (const runSeed of RUN_SEEDS) {
      for (const level of LEVELS) {
        const ctx = floorContext(level, runSeed);
        if (!ctx) continue;
        floors++;
        for (const rule of FLOOR_RULES) {
          const v = rule.check(ctx);
          const n = Number(v.detail.match(/-?\d+(\.\d+)?/)?.[0] ?? NaN);
          const prev = tightest.get(rule.id);
          const prevN = prev ? Number(prev.detail.match(/-?\d+(\.\d+)?/)?.[0] ?? NaN) : NaN;
          if (!prev || (Number.isFinite(n) && Number.isFinite(prevN) && n < prevN)) {
            tightest.set(rule.id, { detail: v.detail, ctx: `L${level} seed ${runSeed} ${ctx.archetype}` });
          }
        }
      }
    }
    for (const [id, t] of tightest) console.log(`  ${id.padEnd(32)} tightest: ${t.detail}   (${t.ctx})`);
    expect(tightest.size, "no rule reported a margin").toBe(FLOOR_RULES.length);
    expect(floors).toBeGreaterThan(60);
  }, 300000);

  it("the archetype's perimeterBias actually MOVES the spawn", () => {
    // The whole point of the weight. Before it existed, spawn sat a mean 58-66%
    // of the way from the nearest corner to the centre on all five archetypes —
    // an 8-point spread, i.e. the archetype had no influence whatsoever.
    //
    // Asserted as a SEPARATION between the high-bias archetypes and the one
    // deliberate exemption, rather than an absolute threshold per archetype: the
    // claim being made is "these floor types open in different places", and an
    // absolute number would silently pass if everything drifted together.
    const byArch = new Map<string, number[]>();
    for (const runSeed of RUN_SEEDS) {
      for (const level of LEVELS) {
        const ctx = floorContext(level, runSeed);
        if (!ctx) continue;
        const arr = byArch.get(ctx.archetype) ?? [];
        arr.push(perimeterScore(ctx.grid, ctx.start.i, ctx.start.j));
        byArch.set(ctx.archetype, arr);
      }
    }
    const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    const report = [...byArch].map(([k, v]) => `${k} ${mean(v).toFixed(2)}`).join(", ");
    const peripheral = ["warrens", "spine", "cavern", "ringkeep"].filter((k) => byArch.has(k));
    expect(peripheral.length, "no high-bias archetypes sampled").toBeGreaterThan(2);
    for (const k of peripheral) {
      expect(mean(byArch.get(k)!), `${k} spawns centrally despite a high perimeterBias — ${report}`).toBeGreaterThan(0.35);
    }
    const hall = byArch.get("greathall");
    if (hall) {
      // The exemption must remain an exemption. If greathall drifts out to the
      // rim with everything else, `perimeterBias` has stopped being a weight and
      // become a global constant, and the "unless it's for specific types of
      // levels" half of the design is gone.
      expect(mean(hall), `greathall lost its central-spawn exemption — ${report}`).toBeLessThan(
        Math.min(...peripheral.map((k) => mean(byArch.get(k)!))),
      );
    }
    console.log(`  mean perimeterScore by archetype: ${report}`);
  }, 300000);

  it("DOORWAYS: the authored set is stable, sized from a vocabulary, and never narrow", () => {
    // The count is the amplification guard. v1 of this pass re-derived what
    // counted as a room from clearance on every round, which promotes the
    // corridor beyond a widened opening into a room and manufactures a fresh
    // doorway: 34 → 107 per floor while the pinches it was fixing barely moved.
    // A count that has run away is the signature, so it is asserted as a BAND
    // rather than a floor — a number that is too HIGH is the failure this
    // catches, and one that is too low means the pass has stopped finding
    // anything to author.
    //
    // The band is set from measurement on the shipping path, not from taste.
    // DOORWAY_PLAN §6 wrote down 25-40 from the second attempt, which authored a
    // door at every section PAIR whether or not there was a threshold there;
    // this pass authors only where a real opening exists to make uniform (a
    // seam that runs through open ground is not a doorway and gets none), so
    // the honest number is lower. See the census printed below.
    const sizes = new Map<number, number>();
    const counts: number[] = [];
    let widthSum = 0;
    let widthN = 0;
    for (const runSeed of RUN_SEEDS) {
      for (const level of LEVELS) {
        const ctx = floorContext(level, runSeed);
        if (!ctx) continue;
        const ds = ctx.doorways ?? [];
        counts.push(ds.length);
        for (const d of ds) {
          sizes.set(d.w, (sizes.get(d.w) ?? 0) + 1);
          widthSum += measureDoorway(ctx.grid, d);
          widthN++;
        }
      }
    }
    const mean = counts.reduce((s, v) => s + v, 0) / Math.max(1, counts.length);
    const report = `${mean.toFixed(1)}/floor over ${counts.length} floors, max ${Math.max(...counts)}, sizes ${[...sizes].sort((a, b) => a[0] - b[0]).map(([w, n]) => `${w}w x${n}`).join("  ")}, mean finished width ${(widthSum / Math.max(1, widthN)).toFixed(2)}`;
    console.log(`  doorways: ${report}`);
    expect(mean, `doorway count has run away — see the self-amplification note in doorways.ts. ${report}`).toBeLessThan(30);
    expect(mean, `the doorway pass has stopped authoring anything. ${report}`).toBeGreaterThan(4);
    // ALL THREE SIZES, or the vocabulary is one size with two dead constants —
    // and "different uniform sizes that can go from one section to another" is
    // half the thing the user asked for.
    for (const w of DOORWAY_WIDTHS) {
      expect(sizes.get(w) ?? 0, `no ${w}-wide doorway on any floor — the vocabulary has collapsed. ${report}`).toBeGreaterThan(0);
    }
    // A floor with a single section legitimately authors none, but that must
    // stay the exception rather than becoming the norm — the rule itself passes
    // silently on those, so this is where the rate is held.
    const empty = counts.filter((n) => n === 0).length;
    expect(empty / counts.length, `${empty}/${counts.length} floors authored no doorway at all`).toBeLessThan(0.12);
  }, 300000);

  it("a floor's spawn, exit and boss are all reachable from each other", () => {
    // Cheap, but it is the invariant every rule above silently assumes: a
    // distance check on an unreachable tile reads as "very far away", which is
    // the failure mode that would make the whole registry report green on a
    // floor the player cannot finish.
    for (const runSeed of RUN_SEEDS.slice(0, 3)) {
      for (const level of LEVELS) {
        const ctx = floorContext(level, runSeed);
        if (!ctx) continue;
        const label = `L${level} seed ${runSeed}`;
        expect(isWalkable(ctx.grid, ctx.start.i, ctx.start.j), `${label}: spawn in a wall`).toBe(true);
        for (const [name, t] of [["stairs", ctx.stairs], ["boss", ctx.bossSpot]] as const) {
          const d = ctx.distFromStart[idx(ctx.grid, t.i, t.j)];
          expect(d, `${label}: ${name} unreachable from spawn`).toBeGreaterThanOrEqual(0);
          expect(d, `${label}: ${name} unreachable from spawn`).toBeLessThan(0x3fffffff);
        }
        expect(maxReach(ctx.grid, ctx.distFromStart), `${label}: floor has no reach`).toBeGreaterThan(20);
      }
    }
  }, 300000);
});

describe("the King's Hall is sized by the king, not by taste", () => {
  it("BOSS_ARENA_R still follows from boss.ts's own numbers", () => {
    // ── THE ASSERTION THAT KEEPS THE DERIVATION HONEST ────────────────────
    //
    // `maze/floor-rules.ts` is three-free and `boss.ts` is not, so the arena
    // radius is derived in prose there and cannot import these constants. This
    // is the seam: if someone retunes the ground-pound, the hall stops matching
    // it silently, and the rule goes on passing while the fight it protects has
    // changed underneath. Same shape as RAIL_RIDE_INSET === PLAYER_R.
    //
    //   dodge = SLAM_RADIUS + PLAYER_R          (you must TRAVEL out of the crater)
    //   noGo  = KING_BODY_R + PLAYER_R          (and cannot travel through him)
    //   span  = 2*dodge + 2*noGo                (a lane each side of him)
    //   R     = span/2 + KING_HOME_TILES        (he drifts off his anchor)
    const dodge = SLAM_RADIUS + PLAYER_R;
    const noGo = KING_BODY_R + PLAYER_R;
    const derived = Math.ceil((2 * dodge + 2 * noGo) / 2 + KING_HOME_TILES);
    expect(BOSS_ARENA_R).toBe(derived);
    // …and the UPPER bound, which is the reason not to simply make it bigger:
    // a hall he cannot shoot across is a hall you kite him around.
    expect(BOSS_ARENA_R * 2).toBeLessThanOrEqual(BONE_MAX_DIST);
    // The gate's width and the carve's radius are one statement: the king stands
    // a ring off the exit and the centre may slide a tile, so the widest circle
    // at his tile is R-2 and widthFromClearance(R-2) = 2(R-2)-1.
    expect(BOSS_ARENA_MIN_WIDTH).toBe(2 * (BOSS_ARENA_R - 2) - 1);
  });
});
