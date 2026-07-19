/**
 * Floor-plan tests. The tavern's whole job is to be legible and navigable, and
 * both properties are decided by this pure data — a station standing inside a
 * counter, or one you can't physically reach, is a level-design bug that no
 * amount of shader work fixes. Cheap to assert, so assert it.
 */
import { describe, it, expect } from "vitest";
import { ROOM, STATIONS, OBSTACLES, SPAWN, PLAYER_RADIUS, stationAt, moveInRoom, isOpen } from "./layout";

describe("floor plan sanity", () => {
  it("every station's stand-here spot is inside the room", () => {
    for (const s of STATIONS) {
      expect(s.x, `${s.id} x`).toBeGreaterThan(ROOM.minX);
      expect(s.x, `${s.id} x`).toBeLessThan(ROOM.maxX);
      expect(s.z, `${s.id} z`).toBeGreaterThan(ROOM.minZ);
      expect(s.z, `${s.id} z`).toBeLessThan(ROOM.maxZ);
    }
  });

  it("every station is reachable — you can stand where it wants you", () => {
    // The spot must be walkable floor, not the inside of the counter it belongs
    // to. This is the one that breaks silently when a prop gets nudged.
    for (const s of STATIONS) {
      expect(isOpen(s.x, s.z), `station "${s.id}" is inside furniture`).toBe(true);
    }
  });

  it("the spawn point is open floor", () => {
    expect(isOpen(SPAWN.x, SPAWN.z)).toBe(true);
  });

  it("station ids are unique", () => {
    const ids = STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every vendor the economy defines, exactly once", () => {
    // If a vendor loses its station it becomes unreachable content — the whole
    // point of the walkable hub is that every system has a physical home.
    const vendors = STATIONS.flatMap((s) => (s.action.kind === "vendor" ? [s.action.vendor] : []));
    expect(vendors.sort()).toEqual(["armor", "cards", "potions", "weapons"]);
  });

  it("has exactly one way down and one run summary", () => {
    expect(STATIONS.filter((s) => s.action.kind === "descend")).toHaveLength(1);
    expect(STATIONS.filter((s) => s.action.kind === "summary")).toHaveLength(1);
  });
});

describe("stationAt", () => {
  it("finds the station you're standing on", () => {
    const forge = STATIONS.find((s) => s.id === "forge")!;
    expect(stationAt(forge.x, forge.z)?.id).toBe("forge");
  });

  it("returns null out in the open", () => {
    // Just south of the central table, clear of every radius.
    expect(stationAt(0, 4.2)).toBe(null);
  });

  it("resolves overlapping radii to the NEAREST station", () => {
    // A prompt that flickers between two counters is worse than picking one.
    const a = STATIONS[0];
    const near = stationAt(a.x, a.z);
    expect(near?.id).toBe(a.id);
  });

  it("is exclusive at the radius boundary", () => {
    const s = STATIONS.find((x) => x.id === "bar")!;
    expect(stationAt(s.x + s.radius + 0.01, s.z)).toBe(null);
  });
});

describe("moveInRoom", () => {
  it("keeps the player inside the walls", () => {
    const p = moveInRoom(0, 0, 999, 999);
    expect(p.x).toBeLessThanOrEqual(ROOM.maxX - PLAYER_RADIUS);
    expect(p.z).toBeLessThanOrEqual(ROOM.maxZ - PLAYER_RADIUS);

    const q = moveInRoom(0, 0, -999, -999);
    expect(q.x).toBeGreaterThanOrEqual(ROOM.minX + PLAYER_RADIUS);
    expect(q.z).toBeGreaterThanOrEqual(ROOM.minZ + PLAYER_RADIUS);
  });

  it("never lets the player end up inside furniture", () => {
    // Walk hard into the central table from every side.
    const table = OBSTACLES[0];
    for (const [dx, dz] of [
      [0, -4],
      [0, 4],
      [-4, 0],
      [4, 0],
    ]) {
      const from = { x: table.x + dx, z: table.z + dz };
      const p = moveInRoom(from.x, from.z, table.x, table.z);
      expect(isOpen(p.x, p.z), `entering from (${dx},${dz}) ended inside the table`).toBe(true);
    }
  });

  it("slides along a counter instead of sticking to it", () => {
    // Approach the central table at an angle: the blocked axis stops, the free
    // axis must still make progress, or movement feels like glue.
    const table = OBSTACLES[0];
    const startZ = table.z + table.d / 2 + PLAYER_RADIUS + 0.05;
    const from = { x: table.x - 1, z: startZ };
    const to = { x: from.x + 0.5, z: startZ - 0.5 }; // into the table, and along it
    const p = moveInRoom(from.x, from.z, to.x, to.z);
    expect(p.x).toBeGreaterThan(from.x); // slid sideways
    expect(isOpen(p.x, p.z)).toBe(true);
  });

  it("a walk across the room stays open the whole way", () => {
    // Sample the spawn -> notice board path; it crosses the room's spine and
    // must route around the central table rather than through it.
    let x: number = SPAWN.x;
    let z: number = SPAWN.z;
    for (let i = 0; i < 400; i++) {
      const p = moveInRoom(x, z, x, z - 0.05);
      // Blocked head-on by the table: step aside, as a player would.
      if (p.z === z) {
        const side = moveInRoom(x, z, x + 0.05, z);
        x = side.x;
        z = side.z;
      } else {
        x = p.x;
        z = p.z;
      }
      expect(isOpen(x, z), `left the floor at (${x.toFixed(2)}, ${z.toFixed(2)})`).toBe(true);
    }
  });

  it("obstacles do not overlap each other", () => {
    for (let i = 0; i < OBSTACLES.length; i++) {
      for (let j = i + 1; j < OBSTACLES.length; j++) {
        const a = OBSTACLES[i];
        const b = OBSTACLES[j];
        const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;
        expect(overlap, `obstacle ${i} overlaps ${j}`).toBe(false);
      }
    }
  });
});
