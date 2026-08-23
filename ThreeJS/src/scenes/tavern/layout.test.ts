/**
 * Floor-plan tests. The tavern's whole job is to be legible and navigable, and
 * both properties are decided by this pure data — a station standing inside a
 * counter, or one you can't physically reach, is a level-design bug that no
 * amount of shader work fixes. Cheap to assert, so assert it.
 */
import { describe, it, expect } from "vitest";
import { ROOM, STATIONS, OBSTACLES, SPAWN, KEEPER_SPOTS, PLAYER_RADIUS, stationAt, moveInRoom, isOpen } from "./layout";

/**
 * Grid resolution for the reachability flood fill, in world units.
 *
 * 0.25 is comfortably finer than the narrowest gap the room has (the 3.3-unit
 * corridor between the central table and the notice board) and than
 * PLAYER_RADIUS, so a cell can't "jump" a wall that a player couldn't walk
 * through. Cheap enough to run every suite: the room is 18x14, so ~4k cells.
 */
const FILL_STEP = 0.25;

/**
 * Every floor cell you can actually WALK to from SPAWN.
 *
 * `isOpen` on its own only proves a point is not inside furniture — it says
 * nothing about whether the player can get there. Those are different bugs: a
 * spot walled off behind the counters would pass every existing assertion and
 * still be a station you can never use. A flood fill is the only honest answer,
 * and at this room size it is nearly free.
 *
 * Returns the reached cells keyed by their grid indices.
 */
function reachableFromSpawn(): Set<string> {
  const gx = (x: number): number => Math.round((x - ROOM.minX) / FILL_STEP);
  const gz = (z: number): number => Math.round((z - ROOM.minZ) / FILL_STEP);
  const wx = (i: number): number => ROOM.minX + i * FILL_STEP;
  const wz = (j: number): number => ROOM.minZ + j * FILL_STEP;
  const cols = Math.ceil((ROOM.maxX - ROOM.minX) / FILL_STEP);
  const rows = Math.ceil((ROOM.maxZ - ROOM.minZ) / FILL_STEP);

  const seen = new Set<string>();
  const start: [number, number] = [gx(SPAWN.x), gz(SPAWN.z)];
  const queue: Array<[number, number]> = [start];
  seen.add(start.join(","));

  while (queue.length) {
    const [i, j] = queue.pop()!;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni > cols || nj > rows) continue;
      const key = `${ni},${nj}`;
      if (seen.has(key)) continue;
      if (!isOpen(wx(ni), wz(nj))) continue;
      seen.add(key);
      queue.push([ni, nj]);
    }
  }
  return seen;
}

/** True if the flood fill reached any cell within `tol` of (x, z). */
function reached(fill: Set<string>, x: number, z: number, tol = 0.4): boolean {
  const span = Math.ceil(tol / FILL_STEP);
  const i0 = Math.round((x - ROOM.minX) / FILL_STEP);
  const j0 = Math.round((z - ROOM.minZ) / FILL_STEP);
  for (let i = i0 - span; i <= i0 + span; i++) {
    for (let j = j0 - span; j <= j0 + span; j++) {
      if (!fill.has(`${i},${j}`)) continue;
      const cx = ROOM.minX + i * FILL_STEP;
      const cz = ROOM.minZ + j * FILL_STEP;
      if (Math.hypot(cx - x, cz - z) <= tol) return true;
    }
  }
  return false;
}

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

  it("you can WALK from the spawn to every station, not just stand there", () => {
    // `isOpen` proves a spot isn't inside a counter. It does not prove you can
    // get to it — a pocket of floor sealed off by furniture passes that check
    // and is still a station nobody can ever use. Flood-fill from where the
    // player actually arrives and require every stand spot to be in the
    // connected region.
    const fill = reachableFromSpawn();
    for (const s of STATIONS) {
      expect(isOpen(s.x, s.z), `station "${s.id}" is inside furniture`).toBe(true);
      expect(reached(fill, s.x, s.z), `station "${s.id}" is walled off from the spawn`).toBe(true);
    }
  });

  it("every keeper stands somewhere the player could also walk", () => {
    // A keeper in a sealed pocket is a keeper you can never reach the counter
    // of — the same failure as an unreachable station, one step removed.
    const fill = reachableFromSpawn();
    for (const k of KEEPER_SPOTS) {
      expect(reached(fill, k.x, k.z), `keeper "${k.id}" is walled off from the spawn`).toBe(true);
    }
  });

  it("no station's stand-here spot falls inside another station's radius", () => {
    // Stricter than the circle-overlap check below, and it is the one the PLAYER
    // feels: if you stand exactly where station A tells you to and you are also
    // inside B's radius, then whichever is nearer wins and A's prompt may never
    // appear at all. `stationAt` picking the nearest hides this rather than
    // fixing it.
    for (const a of STATIONS) {
      for (const b of STATIONS) {
        if (a.id === b.id) continue;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        expect(d, `"${a.id}"'s stand spot is inside "${b.id}"'s radius`).toBeGreaterThan(b.radius);
      }
    }
  });

  it("every station's stand spot has room to stand IN, not just ON", () => {
    // The bug this catches: a spot that clears `isOpen` by a few hundredths
    // (the run-summary station sat 0.08 off the central table's collision face)
    // is one the player is permanently pinned against, and the focus spotlight
    // stations.ts draws there is mostly buried under the prop. Require real
    // clearance — a ring of floor around the spot, not a single legal point.
    for (const s of STATIONS) {
      for (const [dx, dz] of [
        [0.35, 0],
        [-0.35, 0],
        [0, 0.35],
        [0, -0.35],
      ]) {
        expect(isOpen(s.x + dx, s.z + dz), `station "${s.id}" is pinned against furniture toward (${dx},${dz})`).toBe(true);
      }
    }
  });

  it("every keeper stands on open floor, not inside their own counter", () => {
    // The first pass buried all four keepers inside the furniture they belong
    // to. Invisible NPCs are SILENT — nothing throws, nothing fails, the room is
    // just empty, and only a screenshot shows it. This is the assertion that
    // catches it.
    for (const k of KEEPER_SPOTS) {
      expect(isOpen(k.x, k.z), `keeper "${k.id}" is inside furniture`).toBe(true);
    }
  });

  it("every keeper belongs to a real station", () => {
    const ids = new Set(STATIONS.map((s) => s.id));
    for (const k of KEEPER_SPOTS) expect(ids.has(k.id), `keeper "${k.id}" has no station`).toBe(true);
  });

  it("each keeper stands adjacent to the station they keep", () => {
    // Far enough not to block the counter, close enough to read as its owner.
    for (const k of KEEPER_SPOTS) {
      const s = STATIONS.find((x) => x.id === k.id)!;
      const d = Math.hypot(k.x - s.x, k.z - s.z);
      expect(d, `keeper "${k.id}" is ${d.toFixed(1)} from its station`).toBeLessThan(4);
    }
  });

  it("no keeper blocks a station's stand-here spot", () => {
    for (const k of KEEPER_SPOTS) {
      const s = STATIONS.find((x) => x.id === k.id)!;
      expect(Math.hypot(k.x - s.x, k.z - s.z), `keeper "${k.id}" is standing on its own prompt`).toBeGreaterThan(0.8);
    }
  });

  it("no keeper stands inside SOMEONE ELSE'S interaction radius", () => {
    // A keeper loitering in a neighbour's radius reads as belonging to the wrong
    // counter, and their turn-to-face fires for a station they don't keep. The
    // gambler's tout is the tight one — the card dealer's radius reaches to
    // z 4.4, which is exactly where the obvious spot for him is.
    for (const k of KEEPER_SPOTS) {
      for (const s of STATIONS) {
        if (s.id === k.id) continue;
        const d = Math.hypot(k.x - s.x, k.z - s.z);
        expect(d, `keeper "${k.id}" is standing in "${s.id}"'s radius`).toBeGreaterThan(s.radius);
      }
    }
  });

  it("every station a keeper could staff has one", () => {
    // The gambler shipped as an UNATTENDED cabinet because it was simply absent
    // from KEEPER_SPOTS — no error, no failing test, just a station that read as
    // unfinished next to four staffed ones. Pin the roster so the next station
    // added has to make that choice on purpose.
    const staffed = new Set(KEEPER_SPOTS.map((k) => k.id));
    expect([...staffed].sort()).toEqual(["armory", "bar", "dealer", "forge", "gambler"]);
    // Only the two that are not a person's job are allowed to go unstaffed.
    for (const s of STATIONS) {
      if (s.action.kind === "summary" || s.action.kind === "descend") continue;
      expect(staffed.has(s.id), `station "${s.id}" has no keeper`).toBe(true);
    }
  });

  it("keeper spots are unique, one per station", () => {
    const ids = KEEPER_SPOTS.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("station ids are unique", () => {
    const ids = STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("no two stations' interaction radii overlap", () => {
    // Overlapping radii make the prompt flicker between two counters as you
    // stand still. stationAt() resolves to the nearest, but the right fix is
    // for them not to overlap in the first place.
    for (let i = 0; i < STATIONS.length; i++) {
      for (let j = i + 1; j < STATIONS.length; j++) {
        const a = STATIONS[i];
        const b = STATIONS[j];
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        expect(d, `"${a.id}" and "${b.id}" radii overlap`).toBeGreaterThan(a.radius + b.radius);
      }
    }
  });

  it("covers every vendor the economy defines, exactly once", () => {
    // If a vendor loses its station it becomes unreachable content — the whole
    // point of the walkable hub is that every system has a physical home.
    const vendors = STATIONS.flatMap((s) => (s.action.kind === "vendor" ? [s.action.vendor] : []));
    expect(vendors.sort()).toEqual(["armor", "cards", "potions", "weapons"]);
  });

  it("has exactly one way down, one run summary and one gambler", () => {
    expect(STATIONS.filter((s) => s.action.kind === "descend")).toHaveLength(1);
    expect(STATIONS.filter((s) => s.action.kind === "summary")).toHaveLength(1);
    expect(STATIONS.filter((s) => s.action.kind === "gambler")).toHaveLength(1);
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
