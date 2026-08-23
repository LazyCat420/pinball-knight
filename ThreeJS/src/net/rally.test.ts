import { describe, it, expect } from "vitest";
import { floorOfScene, poolFloors, rallyFloor, resolveDescendFloor, regroupTarget } from "./rally";
import type { PeerInfo } from "./presence";

function peer(name: string, scene: string): PeerInfo {
  return { id: name.toLowerCase(), slot: 0, name, scene, x: 0, z: 0, facing: "S", mode: "idle" };
}

describe("floorOfScene", () => {
  it("reads the dungeon tag and ignores everything else", () => {
    expect(floorOfScene("dungeon:7")).toBe(7);
    expect(floorOfScene("tavern")).toBe(0);
    expect(floorOfScene("dungeon:0")).toBe(0);
    expect(floorOfScene("dungeon:x")).toBe(0);
    expect(floorOfScene("")).toBe(0);
  });
});

describe("poolFloors", () => {
  it("counts the caller's own floor alongside the peers", () => {
    const pop = poolFloors([peer("Cobalt", "dungeon:3"), peer("Sage", "tavern")], 3);
    expect(pop).toEqual([{ floor: 3, count: 2, names: ["Cobalt"] }]);
  });

  it("ignores knights still in the tavern", () => {
    expect(poolFloors([peer("Sage", "tavern")], 0)).toEqual([]);
  });
});

describe("rallyFloor", () => {
  it("picks the busiest floor", () => {
    const peers = [peer("A", "dungeon:1"), peer("B", "dungeon:5"), peer("C", "dungeon:5")];
    expect(rallyFloor(peers, 0)?.floor).toBe(5);
  });

  it("breaks a tie on the SHALLOWEST floor — the forgiving direction", () => {
    const peers = [peer("A", "dungeon:9"), peer("B", "dungeon:2")];
    expect(rallyFloor(peers, 0)?.floor).toBe(2);
  });

  it("is null while the whole pool is in the tavern", () => {
    expect(rallyFloor([peer("A", "tavern")], 0)).toBeNull();
  });
});

describe("resolveDescendFloor", () => {
  it("follows the pool instead of your own resume floor — the split this fixes", () => {
    // The reported bug: two players enter one after the other. The second one's
    // resume floor is 4, the pool is on 1, and taking the 4 is what made them
    // two separate games.
    expect(resolveDescendFloor([peer("A", "dungeon:1")], 4)).toBe(1);
  });

  it("takes your resume floor when nobody is down there yet", () => {
    expect(resolveDescendFloor([peer("A", "tavern")], 4)).toBe(4);
  });

  it("starts at the top for a knight who has never died", () => {
    expect(resolveDescendFloor([], 0)).toBe(1);
  });

  it("an explicit join-board pick always wins", () => {
    expect(resolveDescendFloor([peer("A", "dungeon:1")], 4, 9)).toBe(9);
  });
});

describe("regroupTarget — two knights who descended in the same breath", () => {
  it("converges: exactly one of them moves, and both agree which", () => {
    // A landed on 5, B on 1, neither in the other's roster at the time.
    const aSeesB = [peer("B", "dungeon:1")];
    const bSeesA = [peer("A", "dungeon:5")];
    // Tie on population (one knight each) → the shallower floor wins on BOTH
    // machines, so A moves and B stays. A viewpoint-dependent rule would have
    // them swap places forever.
    expect(regroupTarget(aSeesB, 5)).toBe(1);
    expect(regroupTarget(bSeesA, 1)).toBeNull();
  });

  it("stays put once you are already where the pool is", () => {
    expect(regroupTarget([peer("B", "dungeon:2")], 2)).toBeNull();
  });

  it("moves to the busier floor rather than the shallower one", () => {
    const peers = [peer("B", "dungeon:6"), peer("C", "dungeon:6")];
    expect(regroupTarget(peers, 2)).toBe(6);
  });

  it("never moves a lone knight who has the deepest floor to themselves", () => {
    expect(regroupTarget([], 4)).toBeNull();
  });
});
