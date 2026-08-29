/**
 * THE BOSS ROSTER'S GATES.
 *
 * A boss is a row in `boss-kinds.ts`, which makes adding one cheap — and makes
 * adding a BAD one cheap too. These are the constraints a row has to satisfy
 * that nothing else would catch:
 *
 *   · it fits the hall the floor generator already carves;
 *   · its biome exists, and every biome has a guardian;
 *   · every attack it has can be read before it lands;
 *   · its phase 2 is a change, not a copy.
 *
 * The arena one is the load-bearing gate. `maze/floor-rules.ts` BOSS_ARENA_R is
 * a hardcoded 7 pinned to boss.ts's numbers by `floor-rules.test.ts`, and
 * `maze/track-floor.ts` carves halls to match on every floor. A boss with a
 * bigger ground-pound silently demands bigger halls everywhere and moves the
 * generator's measured relaxation rate — a change that would show up as maze
 * flakiness three files away, long after anyone connected it to a boss.
 */
import { describe, it, expect } from "vitest";
import { BOSSES, BOSS_KINDS, bossForBiome, movesAt, type BossMoves, type BossSpec } from "./boss-kinds";
import { SLAM_RADIUS, BONE_MAX_DIST, KING_BODY_R } from "./boss";
import { BOSS_ARENA_R } from "./maze/floor-rules";
import { THEMES } from "./maze/prefabs";
import { PLAYER_R, BRUTE_R } from "./constants";

const specs = BOSS_KINDS.map((k) => BOSSES[k]);

/** Every move a boss can ever use, phase 1 and phase 2 together. */
function allMoves(b: BossSpec): BossMoves[] {
  return [b.moves, { ...b.moves, ...b.phase2.moves }];
}

describe("the roster is populated", () => {
  it("has a guardian for every biome, and no orphans", () => {
    // The bug this replaces: ONE boss, on every floor of every run, so floor 1
    // and floor 17 were the same fight.
    const biomes = THEMES.map((t) => t.name).sort();
    expect(specs.map((b) => b.biome).sort()).toEqual(biomes);
    for (const t of THEMES) {
      expect(bossForBiome(t.name).biome, `no guardian for biome "${t.name}"`).toBe(t.name);
    }
  });

  it("falls back rather than leaving a floor's stairs locked forever", () => {
    // A biome added without a guardian must still gate its exit with SOMETHING.
    expect(bossForBiome("a-biome-that-does-not-exist").kind).toBe("reaper_king");
  });

  it("every boss is distinct in name, label and art", () => {
    expect(new Set(specs.map((b) => b.title)).size).toBe(specs.length);
    expect(new Set(specs.map((b) => b.label)).size).toBe(specs.length);
    // Two bosses may share a base atlas, but not atlas AND tint — that would be
    // the same creature at two names.
    const looks = specs.map((b) => `${b.art.sheetKey}/${b.art.tint}`);
    expect(new Set(looks).size).toBe(specs.length);
  });
});

describe("every boss fits the hall the generator carves", () => {
  it("no boss is wider than the King, whose collider sizes the arena", () => {
    // KING_BODY_R is a roster MAXIMUM, so this is really "the max is where the
    // arena derivation assumes it is".
    const widest = Math.max(...specs.map((b) => b.art.scale));
    expect(BRUTE_R * widest * 0.86).toBeCloseTo(KING_BODY_R, 6);
  });

  it("the widest ground-pound still derives BOSS_ARENA_R = 7", () => {
    // The exact derivation floor-rules.test.ts pins, re-stated here against the
    // ROSTER rather than against one boss: if a new row widens a slam, this
    // fails here first, with the reason attached.
    const dodge = SLAM_RADIUS + PLAYER_R;
    const noGo = KING_BODY_R + PLAYER_R;
    expect(Math.ceil((2 * dodge + 2 * noGo) / 2 + 2.5)).toBe(BOSS_ARENA_R);
  });

  it("a nova can always be escaped by standing at the rim", () => {
    // The nova is centred on the BOSS, not on you, so the arena rule above does
    // not cover it. What it needs instead is to be smaller than the hall, or
    // "get away from him" stops being an answer anywhere on the floor.
    for (const b of specs) {
      for (const m of allMoves(b)) {
        if (!m.nova) continue;
        expect(m.nova.radius, `${b.kind}: nova fills the whole hall`).toBeLessThan(BOSS_ARENA_R);
      }
    }
  });

  it("every thrower can reach across its own arena", () => {
    // The upper bound from floor-rules.test.ts: a hall he cannot shoot across
    // is a hall you kite him around.
    expect(BOSS_ARENA_R * 2).toBeLessThanOrEqual(BONE_MAX_DIST);
  });
});

describe("every attack can be read before it lands", () => {
  it("has a non-trivial wind-up", () => {
    // The constraint ARPG_FEATURE_PLAN set for this game: telegraph QUALITY,
    // not projectile count, because occluding isometric walls make dense
    // patterns unreadable. The King's barrage shipped with NO wind-up at all —
    // it fired off a bare 2.6s timer — which made his most frequent attack his
    // only undodgeable one.
    const MIN_TELL = 0.3;
    for (const b of specs) {
      for (const m of allMoves(b)) {
        if (m.barrage) expect(m.barrage.windup, `${b.kind}: barrage`).toBeGreaterThanOrEqual(MIN_TELL);
        if (m.slam) expect(m.slam.telegraph, `${b.kind}: slam`).toBeGreaterThanOrEqual(MIN_TELL);
        if (m.charge) expect(m.charge.telegraph, `${b.kind}: charge`).toBeGreaterThanOrEqual(MIN_TELL);
        if (m.summon) expect(m.summon.telegraph, `${b.kind}: summon`).toBeGreaterThanOrEqual(MIN_TELL);
        if (m.nova) expect(m.nova.telegraph, `${b.kind}: nova`).toBeGreaterThanOrEqual(MIN_TELL);
      }
    }
  });

  it("leaves room to act between attacks", () => {
    // A tell you cannot act on is not a tell. Every cadence must be longer than
    // its own wind-up, with slack — otherwise the boss is always mid-telegraph
    // and the wind-up stops carrying information.
    for (const b of specs) {
      for (const m of allMoves(b)) {
        if (m.barrage) expect(m.barrage.interval, `${b.kind}: barrage`).toBeGreaterThan(m.barrage.windup * 2);
        if (m.slam) expect(m.slam.interval, `${b.kind}: slam`).toBeGreaterThan(m.slam.telegraph * 2);
        if (m.charge) expect(m.charge.interval, `${b.kind}: charge`).toBeGreaterThan(m.charge.telegraph * 2);
        if (m.nova) expect(m.nova.interval, `${b.kind}: nova`).toBeGreaterThan(m.nova.telegraph * 2);
      }
    }
  });

  it("gives every boss at least two moves, so the fight has a rhythm", () => {
    for (const b of specs) {
      const n = ["barrage", "slam", "charge", "summon", "nova"].filter((k) => b.moves[k as keyof BossMoves]).length;
      expect(n, `${b.kind} has ${n} attack(s)`).toBeGreaterThanOrEqual(2);
    }
  });

  it("caps the brood, so a kited summoner cannot flood the floor", () => {
    for (const b of specs) {
      for (const m of allMoves(b)) {
        if (!m.summon) continue;
        expect(m.summon.maxAlive).toBeGreaterThan(m.summon.count);
        expect(m.summon.maxAlive).toBeLessThanOrEqual(16);
      }
    }
  });
});

describe("the phase flip is a change, not a copy", () => {
  it("fires somewhere in the middle of the bar", () => {
    for (const b of specs) {
      expect(b.phase2.at, `${b.kind}`).toBeGreaterThan(0.2);
      expect(b.phase2.at, `${b.kind}`).toBeLessThan(0.8);
    }
  });

  it("actually changes the moveset or the movement", () => {
    // "phase changes ADD A PATTERN LAYER or SWAP THE MOVEMENT MODE rather than
    // reskinning" — enter-the-gungeon.md §5.2. A phase 2 whose merged moveset
    // equals phase 1 and whose speed is unchanged is a toast and nothing else.
    for (const b of specs) {
      const before = JSON.stringify(b.moves);
      const after = JSON.stringify(movesAt(b, b.phase2.at - 0.01));
      const moved = before !== after || (b.phase2.speedMult ?? 1) !== 1;
      expect(moved, `${b.kind}: phase 2 changes nothing`).toBe(true);
    }
  });

  it("announces itself", () => {
    for (const b of specs) expect(b.phase2.title.length).toBeGreaterThan(0);
  });

  it("movesAt returns phase 1 above the threshold and phase 2 at or below it", () => {
    const b = BOSSES.reaper_king;
    expect(movesAt(b, 1).barrage!.interval).toBe(b.moves.barrage!.interval);
    expect(movesAt(b, b.phase2.at).barrage!.interval).toBe(b.phase2.moves.barrage!.interval);
    // Merged, not replaced: a move phase 2 does not mention must survive.
    expect(movesAt(b, 0.1).orbit).toEqual(b.moves.orbit);
  });
});
