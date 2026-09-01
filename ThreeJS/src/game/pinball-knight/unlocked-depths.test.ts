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
