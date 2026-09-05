import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadUnlockedDepth,
  saveUnlockedDepth,
  unlockDepth,
  isDepthUnlocked,
  unlockedDepthList,
  clearUnlockedDepths,
  depthMetadata,
} from "./unlocked-depths";
import { CYCLE_FLOORS, THEMES, themeFor } from "./maze/prefabs";
import { BOSSES, BOSS_KINDS, guardianFor } from "./boss-kinds";
import { biomeFor } from "./boot/biomes";

function stubStorage(initial?: Record<string, string>): void {
  const store = new Map(Object.entries(initial ?? {}));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

describe("unlocked-depths", () => {
  beforeEach(() => {
    stubStorage();
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("defaults to depth 1 when nothing is stored", () => {
    expect(loadUnlockedDepth()).toBe(1);
    expect(isDepthUnlocked(1)).toBe(true);
    expect(isDepthUnlocked(2)).toBe(false);
    expect(unlockedDepthList()).toEqual([1]);
  });

  it("unlocks higher depths and returns full list", () => {
    expect(saveUnlockedDepth(4)).toBe(true);
    expect(loadUnlockedDepth()).toBe(4);
    expect(isDepthUnlocked(1)).toBe(true);
    expect(isDepthUnlocked(2)).toBe(true);
    expect(isDepthUnlocked(3)).toBe(true);
    expect(isDepthUnlocked(4)).toBe(true);
    expect(isDepthUnlocked(5)).toBe(false);
    expect(unlockedDepthList()).toEqual([1, 2, 3, 4]);
  });

  it("does not downgrade unlocked depth", () => {
    saveUnlockedDepth(7);
    expect(saveUnlockedDepth(3)).toBe(false);
    expect(loadUnlockedDepth()).toBe(7);
  });

  it("handles clearing unlocked depths", () => {
    saveUnlockedDepth(10);
    expect(loadUnlockedDepth()).toBe(10);
    clearUnlockedDepths();
    expect(loadUnlockedDepth()).toBe(1);
  });

  it("generates correct metadata for normal and boss floors", () => {
    const f1 = depthMetadata(1);
    expect(f1.biome).toBe("crypt");
    expect(f1.isBoss).toBe(false);
    expect(f1.danger).toBe("Safe");

    const f5 = depthMetadata(5);
    expect(f5.isBoss).toBe(true);
    expect(f5.bossName).toBe("The Reaper King");
    expect(f5.danger).toBe("BOSS");

    const f10 = depthMetadata(10);
    expect(f10.isBoss).toBe(true);
    expect(f10.bossName).toBe("The Broodmother");

    const f15 = depthMetadata(15);
    expect(f15.isBoss).toBe(true);
    expect(f15.bossName).toBe("The Overlord");

    const f20 = depthMetadata(20);
    expect(f20.isBoss).toBe(true);
    expect(f20.bossName).toBe("The Archivist");

    const f25 = depthMetadata(25);
    expect(f25.isBoss).toBe(true);
    expect(f25.bossName).toBe("The Ancient Dragon");
  });
});

/**
 * THE SCREEN IS A PROMISE TO THE PLAYER, AND IT WAS FALSE.
 *
 * `depthMetadata` used to carry its own hand-written schedule — "1-5 crypt,
 * 6-10 web, 11-15 flesh, 16-20 arcane, 21+ magma" — while the generator
 * shuffled four themes per run and had no magma at all. Every row the screen
 * drew was wrong, and the boss it named at 21+ could not be reached at any
 * depth by any seed.
 *
 * These compare the screen against the FLOOR GENERATOR's own functions — the
 * ones `spawn/floor-authoring.ts` and `spawn/floor-populate.ts` call — not
 * against a second copy of the schedule. A test that re-lists the bands beside
 * the table is one transcription agreeing with another.
 */
describe("the depth screen matches the floor the generator will build", () => {
  it("names the biome the generator gives that floor, at every depth", () => {
    for (let f = 1; f <= CYCLE_FLOORS * 2 + 3; f++) {
      expect(depthMetadata(f).biome, `floor ${f}`).toBe(themeFor(f).name);
    }
  });

  it("names the guardian the spawner will actually put on that floor", () => {
    for (let f = 1; f <= CYCLE_FLOORS * 2 + 3; f++) {
      const meta = depthMetadata(f);
      if (!meta.isBoss) {
        expect(meta.bossName, `floor ${f} is not a milestone`).toBeUndefined();
        continue;
      }
      expect(meta.bossName, `floor ${f}`).toBe(guardianFor(f).name);
    }
  });

  it("calls the place what the descent card calls it", () => {
    // The screen used to say "Spider Cavern" for the place the game announces
    // as The Rotting Warren.
    for (let f = 1; f <= CYCLE_FLOORS; f++) {
      expect(depthMetadata(f).name, `floor ${f}`).toContain(biomeFor(f).name);
    }
  });

  it("reaches every biome and every guardian across the depths it advertises", () => {
    // Set equality both ways against the generator's tables, so a band that
    // silently drops out of the schedule fails here too.
    const deep = CYCLE_FLOORS * 2;
    const biomes = new Set<string>();
    const bosses = new Set<string>();
    for (let f = 1; f <= deep; f++) {
      const meta = depthMetadata(f);
      biomes.add(meta.biome);
      if (meta.bossName) bosses.add(meta.bossName);
    }
    for (const t of THEMES) expect(biomes.has(t.name), `no advertised floor is ${t.name}`).toBe(true);
    for (const b of biomes) expect(THEMES.map((t) => t.name)).toContain(b);
    for (const kind of BOSS_KINDS) {
      expect(bosses.has(BOSSES[kind].name), `${kind} is never advertised in 1..${deep}`).toBe(true);
    }
  });
});
