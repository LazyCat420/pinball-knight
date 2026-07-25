/**
 * ZOMBIE SUB-TYPES — the spawn/stat math.
 *
 * The tests that matter most here are the two traps the codebase has already
 * been bitten by: a scaled sprite whose collider didn't follow (the half-buried
 * Reaper King, documented on `Zombie.bodyR` in state.ts), and non-deterministic
 * spawn selection (which desyncs co-op, where every peer generates the horde
 * locally from a shared seed).
 */
import { describe, it, expect } from "vitest";
import {
  ZOMBIE_TYPES,
  ZOMBIE_TYPE_IDS,
  pickZombieType,
  typeHp,
  typeDropMult,
  variantIndicesFor,
} from "./zombie-types";
import { ZOMBIE_VARIANTS } from "./render/cel-painter";

describe("ZOMBIE_TYPES table", () => {
  it("sums to 100 weight so the numbers read as percentages", () => {
    const total = ZOMBIE_TYPE_IDS.reduce((n, t) => n + ZOMBIE_TYPES[t].weight, 0);
    expect(total).toBe(100);
  });

  it("keeps the shambler the plurality — the horde must still read as a horde", () => {
    const shambler = ZOMBIE_TYPES.shambler.weight;
    for (const t of ZOMBIE_TYPE_IDS) {
      if (t === "shambler") continue;
      expect(shambler).toBeGreaterThan(ZOMBIE_TYPES[t].weight);
    }
  });

  it("gates every type at floor 1 or deeper, and the baseline at floor 1", () => {
    for (const t of ZOMBIE_TYPE_IDS) expect(ZOMBIE_TYPES[t].fromLevel).toBeGreaterThanOrEqual(1);
    expect(ZOMBIE_TYPES.shambler.fromLevel).toBe(1);
  });

  it("uses only positive multipliers — a 0 would freeze or vanish the actor", () => {
    for (const t of ZOMBIE_TYPE_IDS) {
      const d = ZOMBIE_TYPES[t];
      expect(d.speedMult).toBeGreaterThan(0);
      expect(d.hpMult).toBeGreaterThan(0);
      expect(d.scale).toBeGreaterThan(0);
      expect(d.bodyRMult).toBeGreaterThan(0);
      expect(d.reachMult).toBeGreaterThan(0);
      expect(d.windupMult).toBeGreaterThan(0);
    }
  });

  /**
   * THE COLLIDER TRAP. state.ts's `Zombie.bodyR` comment records the Reaper King
   * walking half-buried into 1-tile corridors because its mesh scaled 2.17x
   * while the collider stayed at the brute's 0.42, and ends: "Anything that
   * scales a sprite mesh must set this too, or it will drift the same way."
   */
  it("moves bodyRMult with scale — a scaled sprite MUST scale its collider", () => {
    for (const t of ZOMBIE_TYPE_IDS) {
      const d = ZOMBIE_TYPES[t];
      if (d.scale === 1) continue;
      expect(d.bodyRMult, `${t} scales its mesh but not its collider`).not.toBe(1);
      // …and in the same direction, or the body is inside-out relative to the art.
      expect(Math.sign(d.scale - 1)).toBe(Math.sign(d.bodyRMult - 1));
    }
  });

  it("gives every gaited type the silhouette its stats claim", () => {
    // Crawler is legless, hobbler lost exactly one leg, flailer lost both arms.
    expect(ZOMBIE_TYPES.crawler.gait).toBe("crawl");
    expect(ZOMBIE_TYPES.hobbler.gait).toBe("limp");
    for (const t of ["crawler", "hobbler", "flailer"] as const) {
      expect(ZOMBIE_TYPES[t].variantFilter, `${t} needs a matching silhouette`).not.toBeNull();
    }
  });
});

describe("pickZombieType", () => {
  it("is deterministic for a given (hash, level) — co-op peers must agree", () => {
    for (const hash of [0, 1, 7, 12345, 99991, 0x7fffffff]) {
      const a = pickZombieType(hash, 5);
      const b = pickZombieType(hash, 5);
      expect(b).toBe(a);
    }
  });

  it("never returns a type gated above the requested level", () => {
    for (let level = 1; level <= 8; level++) {
      for (let hash = 0; hash < 4000; hash++) {
        const t = pickZombieType(hash, level);
        expect(ZOMBIE_TYPES[t].fromLevel, `${t} leaked onto floor ${level}`).toBeLessThanOrEqual(level);
      }
    }
  });

  it("returns ONLY the shambler and lurcher on floor 1", () => {
    const seen = new Set<string>();
    for (let hash = 0; hash < 6000; hash++) seen.add(pickZombieType(hash, 1));
    expect([...seen].sort()).toEqual(["lurcher", "shambler"]);
  });

  it("reaches every type once deep enough", () => {
    const seen = new Set<string>();
    for (let hash = 0; hash < 20000; hash++) seen.add(pickZombieType(hash, 9));
    expect(seen.size).toBe(ZOMBIE_TYPE_IDS.length);
  });

  it("tracks the declared weights within tolerance at depth", () => {
    const N = 60000;
    const counts: Record<string, number> = {};
    for (let hash = 0; hash < N; hash++) {
      const t = pickZombieType(hash, 9);
      counts[t] = (counts[t] ?? 0) + 1;
    }
    for (const t of ZOMBIE_TYPE_IDS) {
      const pct = ((counts[t] ?? 0) / N) * 100;
      expect(Math.abs(pct - ZOMBIE_TYPES[t].weight), `${t} at ${pct.toFixed(1)}%`).toBeLessThan(2);
    }
  });
});

describe("typeHp", () => {
  it("never rounds a frail type down to zero HP", () => {
    for (const t of ZOMBIE_TYPE_IDS) {
      expect(typeHp(1, t)).toBeGreaterThanOrEqual(1);
      expect(typeHp(3, t)).toBeGreaterThanOrEqual(1);
    }
  });

  it("scales the ZOMBIE_HP=3 baseline the way the table advertises", () => {
    expect(typeHp(3, "shambler")).toBe(3);
    expect(typeHp(3, "runner")).toBe(2); // 3 * 0.67 = 2.01
    expect(typeHp(3, "lurcher")).toBe(6);
    expect(typeHp(3, "hulk")).toBe(9);
    expect(typeHp(3, "crawler")).toBe(4); // 3 * 1.33 = 3.99
  });
});

describe("typeDropMult", () => {
  it("pays the bigger bruiser more, but caps the windfall at 2x", () => {
    expect(typeDropMult("shambler")).toBe(1);
    expect(typeDropMult("hulk")).toBe(2); // hpMult 3 capped to 2
    expect(typeDropMult("lurcher")).toBe(2);
    expect(typeDropMult("runner")).toBeLessThan(1);
  });
});

describe("variantIndicesFor", () => {
  it("gives an unfiltered type the whole pool", () => {
    expect(variantIndicesFor("shambler", ZOMBIE_VARIANTS)).toHaveLength(ZOMBIE_VARIANTS.length);
  });

  it("finds real art for every filtered sub-type", () => {
    // If a filter matched nothing it would silently fall back to the whole pool,
    // so assert the intended silhouette is genuinely present in the table.
    const crawler = variantIndicesFor("crawler", ZOMBIE_VARIANTS);
    expect(crawler.length).toBeGreaterThan(0);
    for (const i of crawler) expect(ZOMBIE_VARIANTS[i].legStump).toBe("both");

    const hobbler = variantIndicesFor("hobbler", ZOMBIE_VARIANTS);
    expect(hobbler.length).toBeGreaterThan(0);
    for (const i of hobbler) expect(["L", "R"]).toContain(ZOMBIE_VARIANTS[i].legStump);

    const flailer = variantIndicesFor("flailer", ZOMBIE_VARIANTS);
    expect(flailer.length).toBeGreaterThan(0);
    for (const i of flailer) expect(ZOMBIE_VARIANTS[i].stump).toBe("both");
  });

  it("falls back to the full pool rather than starving a type of art", () => {
    // A variant-table edit that drops the crawler silhouette must not spawn an
    // invisible zombie — degrade to a wrong-ish silhouette instead.
    const intactOnly = ZOMBIE_VARIANTS.filter((v) => v.legStump === null);
    const idx = variantIndicesFor("crawler", intactOnly);
    expect(idx).toHaveLength(intactOnly.length);
  });
});
