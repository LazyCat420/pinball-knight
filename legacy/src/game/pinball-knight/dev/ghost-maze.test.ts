import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  applyGhostLevel,
  applyGhostSeed,
  enterGhostMaze,
  ghostFloorLabel,
  ghostMaze,
  setGhostMaze,
  __resetGhostMazeCache,
} from "./ghost-maze";
import { buildHeadlessPlan } from "./headless-floor";

/** A localStorage stand-in — the module reads the real global, and node has
 *  none. Kept dumb on purpose: the thing under test is the pin, not storage. */
function stubStorage(): Map<string, string> {
  const m = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });
  return m;
}

describe("ghost maze", () => {
  beforeEach(() => {
    stubStorage();
    __resetGhostMazeCache();
  });

  it("is OFF by default — a fresh profile plays the real game", () => {
    // The property that makes a dev flag safe to ship. Both appliers must be
    // the identity, or every player is silently on the workbench floor.
    expect(ghostMaze()).toBeNull();
    expect(applyGhostLevel(7)).toBe(7);
    expect(applyGhostSeed(999, false)).toBe(999);
    expect(ghostFloorLabel()).toBeNull();
  });

  it("pins BOTH the depth and the seed", () => {
    // Depth alone is not a floor: floorRng(runSeed, level) means a fresh seed
    // builds a different maze at the same number. That is the bug this exists
    // to fix, so it is the thing asserted.
    enterGhostMaze(5, 1234);
    __resetGhostMazeCache();
    expect(applyGhostLevel(19)).toBe(5);
    expect(applyGhostSeed(88, false)).toBe(1234);
  });

  it("lets an explicit ?seed= win over the pin", () => {
    // The renderer-migration baselines pin their screenshots with ?seed=. A dev
    // flag quietly overriding a requested seed would make those diffs lie.
    enterGhostMaze(5, 1234);
    __resetGhostMazeCache();
    expect(applyGhostSeed(4242, true)).toBe(4242);
  });

  it("captions itself, so a screenshot cannot be mistaken for a real run", () => {
    enterGhostMaze(5, 1234);
    __resetGhostMazeCache();
    expect(ghostFloorLabel()).toContain("GHOST MAZE");
    expect(ghostFloorLabel()).toContain("1234");
  });

  it("survives a reload, and clears completely", () => {
    enterGhostMaze(3, 7);
    __resetGhostMazeCache(); // the reload
    expect(ghostMaze()).toEqual({ level: 3, seed: 7 });
    setGhostMaze(null);
    __resetGhostMazeCache();
    expect(ghostMaze()).toBeNull();
  });

  it("survives corrupt storage rather than taking the run down with it", () => {
    const m = stubStorage();
    m.set("pinball-knight-ghost-maze", "{not json");
    __resetGhostMazeCache();
    expect(ghostMaze()).toBeNull();
  });

  it("THE POINT: the pinned pair rebuilds a byte-identical floor", () => {
    // The whole workbench claim, checked against the real generator rather than
    // against the flag's own bookkeeping. Two builds of the pinned (level,
    // seed) must agree on geometry AND content — if they did not, "the same
    // floor every reload" would be a promise the pin cannot keep.
    enterGhostMaze(5, 1234);
    __resetGhostMazeCache();
    const g = ghostMaze()!;
    const a = buildHeadlessPlan(g.level, g.seed);
    const b = buildHeadlessPlan(g.level, g.seed);
    expect(a).not.toBeNull();
    expect(Array.from(a!.grid.t)).toEqual(Array.from(b!.grid.t));
    expect(a!.plan.parts).toEqual(b!.plan.parts);
    expect(a!.plan.spawns).toEqual(b!.plan.spawns);

    // …and a DIFFERENT seed at the same depth is a different floor, or the pin
    // would be pinning nothing.
    const other = buildHeadlessPlan(g.level, g.seed + 1);
    expect(Array.from(other!.grid.t)).not.toEqual(Array.from(a!.grid.t));
  });
});
