/**
 * Level decoration — where things GO in a generated maze.
 *
 * - The player starts in the top-left cell (the backtracker always carves it).
 * - The stairs go at the maximum BFS distance from the start, which guarantees
 *   a real journey and never a stairs-next-to-spawn anticlimax.
 * - Zombie spawns are weighted AWAY from the start so level entry is calm.
 * - Torches mount on walls beside floor tiles, spaced out, capped by budget —
 *   they're landmarks and light pools, not street lighting.
 *
 * DOM- and three-free: tested alongside the generator.
 */
import { type Grid, type TilePos, T_STAIRS, at, T_FLOOR, idx, setTile } from "./generator";
import { bfsDistances } from "../entities/ai";

export interface Torch extends TilePos {
  /** Direction from the floor tile to the wall it mounts on. */
  di: number;
  dj: number;
}

export interface ItemDrop extends TilePos {
  kind: "weapon" | "gear" | "potion";
  /** WeaponId / GearSlot / PotionId — resolved by core against items.ts. */
  id: string;
}

export interface PropSpot extends TilePos {
  /** Key into PROP_PAINTS — bones, skull, rubble. */
  kind: string;
}

export interface LevelPlan {
  start: TilePos;
  stairs: TilePos;
  spawns: TilePos[];
  torches: Torch[];
  items: ItemDrop[];
  /** Set dressing — walkable-over scenery. D2R's lesson: bare floors read as
   * "too basic"; a skull every dozen tiles reads as a crypt. */
  props: PropSpot[];
}

function shuffled<T>(items: T[], rng: () => number): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const WALL_SIDES: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * The findable arsenal. Six weapons is too many to strew on every floor, so
 * each level rolls THREE of them (rng-driven — every depth has a different
 * armoury) plus one of each gear slot. Ids resolve against items.ts.
 */
const WEAPON_POOL = ["stick", "mace", "chair", "gun", "bow", "flamethrower"];
const WEAPONS_PER_LEVEL = 3;
const GEAR_ITEMS = ["helmet", "armor", "boots"];
// Potions strewn per floor: always a health flask, plus TWO random power-ups
// from the pool (rage/haste/shield/gold). Health is guaranteed so the run stays
// survivable; the rest add "do I chug it now?" decisions. Ids → POTIONS.
const POTION_POOL = ["rage", "haste", "shield", "gold"];
type RolledItem = { kind: "weapon" | "gear" | "potion"; id: string };

function rollLevelItems(rng: () => number): RolledItem[] {
  const buffs = shuffled(POTION_POOL, rng).slice(0, 2);
  return [
    ...shuffled(WEAPON_POOL, rng)
      .slice(0, WEAPONS_PER_LEVEL)
      .map((id): RolledItem => ({ kind: "weapon", id })),
    ...GEAR_ITEMS.map((id): RolledItem => ({ kind: "gear", id })),
    // one guaranteed heal + two random power-ups
    { kind: "potion", id: "health" },
    ...buffs.map((id): RolledItem => ({ kind: "potion", id })),
  ];
}

/** Mutates the grid (stamps T_STAIRS) and returns the plan. */
export function decorateMaze(g: Grid, rng: () => number, zombieCount: number, torchBudget: number): LevelPlan {
  // First walkable tile scanning from the top-left — (1,1) on a raw
  // backtracker maze, (2,2) once the walls have been thickened.
  let start: TilePos = { i: 1, j: 1 };
  outer: for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (at(g, i, j) === T_FLOOR) {
        start = { i, j };
        break outer;
      }
    }
  }
  const dist = bfsDistances(g, start.i, start.j);

  // ── Stairs: the farthest reachable tile ──
  let stairs: TilePos = start;
  let maxDist = 0;
  const floors: TilePos[] = [];
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (at(g, i, j) !== T_FLOOR) continue;
      floors.push({ i, j });
      const d = dist[idx(g, i, j)];
      if (d > maxDist) {
        maxDist = d;
        stairs = { i, j };
      }
    }
  }
  setTile(g, stairs.i, stairs.j, T_STAIRS);

  // ── Zombie spawns: far-ish floor tiles, spread out, never near the start ──
  const minSpawnDist = Math.max(5, Math.floor(maxDist * 0.3));
  const spawns: TilePos[] = [];
  const candidates = shuffled(
    floors.filter((p) => {
      const d = dist[idx(g, p.i, p.j)];
      return d >= minSpawnDist && !(p.i === stairs.i && p.j === stairs.j);
    }),
    rng,
  );
  // Two passes: first honour a pairwise separation so the horde is spread
  // through the maze, then (if the maze is too small for that) fill anyway.
  for (const pass of [2.5, 0]) {
    for (const p of candidates) {
      if (spawns.length >= zombieCount) break;
      if (spawns.some((s) => Math.hypot(s.i - p.i, s.j - p.j) < pass) || spawns.includes(p)) continue;
      spawns.push(p);
    }
    if (spawns.length >= zombieCount) break;
  }

  // ── Torches: floor tiles with an adjacent wall, spaced ≥4 tiles apart ──
  const torches: Torch[] = [];
  for (const p of shuffled(floors, rng)) {
    if (torches.length >= torchBudget) break;
    if (torches.some((t) => Math.abs(t.i - p.i) + Math.abs(t.j - p.j) < 4)) continue;
    const side = WALL_SIDES.find(([di, dj]) => at(g, p.i + di, p.j + dj) !== T_FLOOR && at(g, p.i + di, p.j + dj) !== T_STAIRS);
    if (!side) continue;
    torches.push({ i: p.i, j: p.j, di: side[0], dj: side[1] });
  }

  // ── Items: this level's roll, scattered on quieter floor tiles ──
  // Not on the stairs, not on top of a zombie spawn, a few tiles out from the
  // start (finding your first pickup should take a moment of exploring), and
  // spread apart so one corridor doesn't hold the whole armoury.
  const items: ItemDrop[] = [];
  const itemSpots = shuffled(
    floors.filter((p) => {
      const d = dist[idx(g, p.i, p.j)];
      return d >= 4 && !(p.i === stairs.i && p.j === stairs.j) && !spawns.some((s) => s.i === p.i && s.j === p.j);
    }),
    rng,
  );
  for (const def of rollLevelItems(rng)) {
    const spot = itemSpots.find((p) => !items.some((it) => Math.abs(it.i - p.i) + Math.abs(it.j - p.j) < 5));
    if (!spot) break; // a maze too small for all six — fine, place what fits
    items.push({ kind: def.kind, id: def.id, i: spot.i, j: spot.j });
  }

  // ── Props: sparse scenery on plain floor, clear of the stairs and loot ──
  const PROP_KINDS = ["bones", "skull", "rubble", "bones", "rubble"]; // bones/rubble weighted up
  const props: PropSpot[] = [];
  const propBudget = Math.floor(floors.length / 26);
  for (const p of shuffled(floors, rng)) {
    if (props.length >= propBudget) break;
    if (p.i === stairs.i && p.j === stairs.j) continue;
    if (Math.abs(p.i - start.i) + Math.abs(p.j - start.j) < 3) continue;
    if (items.some((it) => it.i === p.i && it.j === p.j)) continue;
    if (props.some((q) => Math.abs(q.i - p.i) + Math.abs(q.j - p.j) < 3)) continue;
    props.push({ i: p.i, j: p.j, kind: PROP_KINDS[Math.floor(rng() * PROP_KINDS.length)] });
  }

  return { start, stairs, spawns, torches, items, props };
}
