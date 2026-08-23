import { describe, expect, it } from "vitest";
import { describeParty, floorOfScene, groupByFloor } from "./join-board";
import type { PeerInfo } from "../../net/presence";

function peer(name: string, scene: string): PeerInfo {
  return { id: name, slot: 0, name, scene, x: 0, z: 0, facing: "S", mode: "idle" };
}

describe("floorOfScene", () => {
  it("reads the dungeon floor out of a scene tag", () => {
    expect(floorOfScene("dungeon:7")).toBe(7);
    expect(floorOfScene("dungeon:12")).toBe(12);
  });

  it("treats the tavern and junk tags as 'nowhere to join'", () => {
    expect(floorOfScene("tavern")).toBe(0);
    expect(floorOfScene("dungeon:abc")).toBe(0);
    expect(floorOfScene("dungeon:0")).toBe(0);
    expect(floorOfScene("")).toBe(0);
  });
});

describe("groupByFloor", () => {
  it("groups the pool by depth, shallowest first", () => {
    const groups = groupByFloor(
      [peer("Cobalt", "dungeon:4"), peer("Iron", "dungeon:15"), peer("Sage", "dungeon:4")],
      10,
    );
    expect(groups.map((g) => g.floor)).toEqual([4, 15]);
    expect(groups[0].names).toEqual(["Cobalt", "Sage"]);
    expect(groups[1].names).toEqual(["Iron"]);
  });

  it("excludes knights standing in the tavern — there is nothing to join", () => {
    const groups = groupByFloor([peer("Crimson", "tavern"), peer("Cobalt", "dungeon:3")], 5);
    expect(groups).toHaveLength(1);
    expect(groups[0].floor).toBe(3);
  });

  it("flags depths past your record WITHOUT filtering them out", () => {
    const groups = groupByFloor([peer("Cobalt", "dungeon:4"), peer("Iron", "dungeon:15")], 10);
    expect(groups[0].safe).toBe(true); // floor 4, best 10
    expect(groups[1].safe).toBe(false); // floor 15 — warned, still listed
    // The load-bearing half: a deep floor must remain JOINABLE.
    expect(groups.map((g) => g.floor)).toContain(15);
  });

  it("treats your exact best depth as safe", () => {
    expect(groupByFloor([peer("Iron", "dungeon:10")], 10)[0].safe).toBe(true);
  });

  it("is empty when the whole pool is in the tavern", () => {
    expect(groupByFloor([peer("A", "tavern"), peer("B", "tavern")], 5)).toEqual([]);
  });
});

describe("describeParty", () => {
  it("names one and two knights outright, then abbreviates", () => {
    expect(describeParty(["Cobalt"])).toBe("Cobalt");
    expect(describeParty(["Cobalt", "Sage"])).toBe("Cobalt & Sage");
    expect(describeParty(["Cobalt", "Sage", "Iron"])).toBe("Cobalt +2");
  });

  it("handles an empty floor without inventing a name", () => {
    expect(describeParty([])).toBe("");
  });
});
