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
import { type Grid, type TilePos, type Room, T_STAIRS, at, T_FLOOR, T_WALL, T_CRACKED, idx, setTile } from "./generator";
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

/**
 * A pinball component stamped into the maze (the maze/pinball-machine hybrid).
 * Placed by tile TOPOLOGY so each part lands where it plays well:
 *   bumper    → junction (3-4 open neighbours) — an open crossing to carom off.
 *   spring    → dead end (1 open neighbour) — aimed back OUT along (dirI,dirJ).
 *   ramp      → straight corridor (2 opposite neighbours) — dash pad along it.
 *   deflector → corner (2 perpendicular neighbours) — banks momentum from one
 *               open leg to the other; both legs are (dirI,dirJ) and (dir2I,dir2J).
 */
export type PartSpotKind =
  | "bumper"
  | "spring"
  | "ramp"
  | "deflector"
  | "glove"
  | "oil"
  | "spinpad"
  | "slingshot"
  | "target"
  | "trapdoor";

export interface PinballPartSpot extends TilePos {
  kind: PartSpotKind;
  dirI: number;
  dirJ: number;
  dir2I: number;
  dir2J: number;
}

/**
 * A prefab stamp anchor (maze/prefabs.ts), already scaled to the decorated
 * grid's coordinates: a part to place, a horde spawn, or a prize drop.
 */
export interface PrefabAnchor extends TilePos {
  kind: PartSpotKind | "spawn" | "prize";
}

/**
 * A carved room dealt an ARCHETYPE — the "named room" layer (the theme-park
 * floor idea): each archetype furnishes its rect differently below.
 */
export type RoomArchetype = "bumper" | "speedway" | "arena" | "vault";

export interface PlannedRoom extends Room {
  kind: RoomArchetype;
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
  /** The level's pinball components (bumpers/springs/ramps/deflectors). */
  parts: PinballPartSpot[];
  /** The archetype rooms (already furnished into spawns/items/parts above). */
  rooms: PlannedRoom[];
  /** Top-left tile of every 2×2 CRACKED band (see crackSecretWalls/secrets.ts). */
  secrets: TilePos[];
  /** The Oracle Frog's dead-end perch, if this floor drew one. */
  frog: TilePos | null;
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
// Potions strewn per floor: always a health flask, plus THREE random power-ups
// from the pool. Health is guaranteed so the run stays survivable; the rest add
// "do I chug it now?" decisions. Ids → POTIONS (incl. the Wave-F pinball kit:
// iron core / turbo / spring legs / freeze / multi-ball).
const POTION_POOL = ["rage", "haste", "shield", "gold", "ironcore", "turbo", "springlegs", "freeze", "multiball"];
type RolledItem = { kind: "weapon" | "gear" | "potion"; id: string };

function rollLevelItems(rng: () => number): RolledItem[] {
  const buffs = shuffled(POTION_POOL, rng).slice(0, 3);
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

/** A tile's part-relevant topology, with the openings that define it. */
type Topology = "deadend" | "straight" | "corner" | "junction";
interface TopoSpot extends TilePos {
  topo: Topology;
  /** deadend: the way out. straight: one of the two along-directions. corner: leg 1. */
  dirI: number;
  dirJ: number;
  /** corner only: leg 2. */
  dir2I: number;
  dir2J: number;
}

/**
 * Classify a floor tile's topology (dead end / straight run / corner /
 * junction). Which PART lands there is decided by the deal below — several
 * kinds share a topology (ramp/oil/glove/slingshot all want a straight run).
 */
function classifyTopology(g: Grid, p: TilePos, rng: () => number): TopoSpot | null {
  const open = WALL_SIDES.filter(([di, dj]) => at(g, p.i + di, p.j + dj) === T_FLOOR);
  if (open.length === 1) {
    return { ...p, topo: "deadend", dirI: open[0][0], dirJ: open[0][1], dir2I: 0, dir2J: 0 };
  }
  if (open.length === 2) {
    const [a, b] = open;
    if (a[0] === -b[0] && a[1] === -b[1]) {
      const d = rng() < 0.5 ? a : b;
      return { ...p, topo: "straight", dirI: d[0], dirJ: d[1], dir2I: 0, dir2J: 0 };
    }
    return { ...p, topo: "corner", dirI: a[0], dirJ: a[1], dir2I: b[0], dir2J: b[1] };
  }
  if (open.length >= 3) {
    return { ...p, topo: "junction", dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0 };
  }
  return null;
}

/** Which topology pool each dealable part kind draws from. */
const KIND_TOPOLOGY: Record<string, Topology> = {
  bumper: "junction",
  spinpad: "junction",
  ramp: "straight",
  oil: "straight",
  slingshot: "straight",
  glove: "straight",
  spring: "deadend",
  deflector: "corner",
};

/** Turn a topology candidate into a concrete part spot of the dealt kind. */
function spotForKind(kind: PartSpotKind, c: TopoSpot, rng: () => number): PinballPartSpot {
  if (kind === "glove") {
    // The glove mounts on one of the corridor's side walls and punches ACROSS
    // it: direction = the perpendicular of the corridor axis (both sides are
    // wall by construction for a strict straight), random side.
    const side = rng() < 0.5 ? 1 : -1;
    return { i: c.i, j: c.j, kind, dirI: -c.dirJ * side, dirJ: c.dirI * side, dir2I: 0, dir2J: 0 };
  }
  return { i: c.i, j: c.j, kind, dirI: c.dirI, dirJ: c.dirJ, dir2I: c.dir2I, dir2J: c.dir2J };
}

/**
 * Furnish the carved rooms. Each room is dealt an archetype (rng-shuffled,
 * round-robin so every floor mixes kinds) and stocked accordingly:
 *   bumper   → a quincunx of pop bumpers (the dice-five spread) to carom between.
 *   speedway → a lane of dash ramps down the long axis, all aimed one way.
 *   arena    → spawns in the corners ringing a centre prize potion — walk in
 *              for the loot, fight the ring (demoted to bumpers near the start
 *              so level entry stays calm).
 *   vault    → two prizes (a weapon + the gold idol) with two corner guards.
 */
function furnishRooms(
  rooms: Room[],
  rng: () => number,
  start: TilePos,
): { rooms: PlannedRoom[]; spawns: TilePos[]; items: ItemDrop[]; parts: PinballPartSpot[] } {
  const planned: PlannedRoom[] = [];
  const spawns: TilePos[] = [];
  const items: ItemDrop[] = [];
  const parts: PinballPartSpot[] = [];
  const deal = shuffled<RoomArchetype>(["bumper", "speedway", "arena", "vault"], rng);

  rooms.forEach((room, k) => {
    let kind = deal[k % deal.length];
    const cx = room.i0 + Math.floor(room.w / 2);
    const cy = room.j0 + Math.floor(room.h / 2);
    // A fight/loot room on the doorstep would make level entry a coin flip.
    if ((kind === "arena" || kind === "vault") && Math.abs(cx - start.i) + Math.abs(cy - start.j) < 10) {
      kind = "bumper";
    }
    planned.push({ ...room, kind });

    const part = (p: Omit<PinballPartSpot, "dir2I" | "dir2J">): void => {
      parts.push({ dir2I: 0, dir2J: 0, ...p });
    };

    if (kind === "bumper") {
      // Quincunx: corners-and-centre fractions of the rect, capped by area.
      const n = Math.max(3, Math.min(5, Math.floor((room.w * room.h) / 14)));
      const spots: Array<[number, number]> = [[0.25, 0.25], [0.75, 0.75], [0.5, 0.5], [0.75, 0.25], [0.25, 0.75]];
      for (const [fx, fy] of spots.slice(0, n)) {
        const i = room.i0 + Math.round(fx * (room.w - 1));
        const j = room.j0 + Math.round(fy * (room.h - 1));
        if (parts.some((q) => q.i === i && q.j === j)) continue; // tiny room folds
        part({ kind: "bumper", i, j, dirI: 0, dirJ: 0 });
      }
    } else if (kind === "speedway") {
      // Dash lane down the long axis, every ramp aimed the same way.
      const alongW = room.w >= room.h;
      const sign = rng() < 0.5 ? 1 : -1;
      const len = alongW ? room.w : room.h;
      const n = Math.max(2, Math.floor(len / 4));
      for (let s = 0; s < n; s++) {
        const t = Math.round(1 + (s * (len - 3)) / Math.max(1, n - 1));
        const i = alongW ? room.i0 + t : cx;
        const j = alongW ? cy : room.j0 + t;
        if (parts.some((q) => q.i === i && q.j === j)) continue;
        part({ kind: "ramp", i, j, dirI: alongW ? sign : 0, dirJ: alongW ? 0 : sign });
      }
    } else {
      // arena + vault share the corner geometry.
      const corners: TilePos[] = [
        { i: room.i0 + 1, j: room.j0 + 1 },
        { i: room.i0 + room.w - 2, j: room.j0 + room.h - 2 },
        { i: room.i0 + room.w - 2, j: room.j0 + 1 },
        { i: room.i0 + 1, j: room.j0 + room.h - 2 },
      ].filter((c, idx2, arr) => arr.findIndex((o) => o.i === c.i && o.j === c.j) === idx2);
      if (kind === "arena") {
        spawns.push(...corners);
        const prize = shuffled(["health", "gold", "rage", "haste", "shield"], rng)[0];
        items.push({ kind: "potion", id: prize, i: cx, j: cy });
      } else {
        spawns.push(...corners.slice(0, 2));
        items.push({ kind: "weapon", id: shuffled(WEAPON_POOL, rng)[0], i: cx, j: cy });
        if (room.w > 2) items.push({ kind: "potion", id: "gold", i: cx - 1, j: cy });
      }
    }
  });

  return { rooms: planned, spawns, items, parts };
}

/**
 * Mutates the grid (stamps T_STAIRS) and returns the plan. `rooms` are the
 * carved archetype rects in THIS grid's coordinates (already ×2 if the maze
 * was thickened).
 */
export function decorateMaze(
  g: Grid,
  rng: () => number,
  zombieCount: number,
  torchBudget: number,
  partBudget = 8,
  rooms: Room[] = [],
  extras: { anchors?: PrefabAnchor[]; deal?: PartSpotKind[]; targets?: number; trapdoors?: number } = {},
): LevelPlan {
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

  // ── Rooms first: archetype content is SEEDED into the pools below, so all
  // the general placement (and its spacing rules) works around it. General
  // placement also stays OUT of room interiors — each room is its archetype's
  // set piece, not another stretch of corridor. ──
  const furnished = furnishRooms(rooms, rng, start);
  const inRoom = (p: TilePos): boolean =>
    rooms.some((r) => p.i >= r.i0 && p.i < r.i0 + r.w && p.j >= r.j0 && p.j < r.j0 + r.h);

  // ── Zombie spawns: far-ish floor tiles, spread out, never near the start ──
  const minSpawnDist = Math.max(5, Math.floor(maxDist * 0.3));
  const spawns: TilePos[] = [...furnished.spawns];
  const candidates = shuffled(
    floors.filter((p) => {
      const d = dist[idx(g, p.i, p.j)];
      return d >= minSpawnDist && !(p.i === stairs.i && p.j === stairs.j) && !inRoom(p);
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

  // ── Torches: floor tiles with an adjacent SOLID wall, spaced ≥4 apart.
  // Never a cracked band — its sconce would hang in mid-air after the smash. ──
  const torches: Torch[] = [];
  for (const p of shuffled(floors, rng)) {
    if (torches.length >= torchBudget) break;
    if (torches.some((t) => Math.abs(t.i - p.i) + Math.abs(t.j - p.j) < 4)) continue;
    const side = WALL_SIDES.find(([di, dj]) => at(g, p.i + di, p.j + dj) === T_WALL);
    if (!side) continue;
    torches.push({ i: p.i, j: p.j, di: side[0], dj: side[1] });
  }

  // ── Items: this level's roll, scattered on quieter floor tiles ──
  // Not on the stairs, not on top of a zombie spawn, a few tiles out from the
  // start (finding your first pickup should take a moment of exploring), and
  // spread apart so one corridor doesn't hold the whole armoury.
  const items: ItemDrop[] = [...furnished.items];
  const itemSpots = shuffled(
    floors.filter((p) => {
      const d = dist[idx(g, p.i, p.j)];
      return d >= 4 && !(p.i === stairs.i && p.j === stairs.j) && !spawns.some((s) => s.i === p.i && s.j === p.j) && !inRoom(p);
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
    if (inRoom(p)) continue; // rooms are their archetype's set piece, not a boneyard
    props.push({ i: p.i, j: p.j, kind: PROP_KINDS[Math.floor(rng() * PROP_KINDS.length)] });
  }

  // ── Pinball parts: classify every floor tile by topology, then draw a MIXED
  // hand from the candidates (interleaving kinds so one maze isn't all bumpers),
  // spaced out, clear of the start / stairs / loot. Budget scales with depth
  // (the caller passes it), so deeper floors read as denser machines. Room
  // archetypes have already seeded their own parts (they don't count against
  // the corridor budget — a bumper chamber shouldn't strip the maze bare). ──
  const parts: PinballPartSpot[] = [...furnished.parts];
  const corridorBudget = partBudget + furnished.parts.length;
  const byTopo: Record<Topology, TopoSpot[]> = { deadend: [], straight: [], corner: [], junction: [] };
  for (const p of shuffled(floors, rng)) {
    if (p.i === stairs.i && p.j === stairs.j) continue;
    if (Math.abs(p.i - start.i) + Math.abs(p.j - start.j) < 4) continue; // calm start
    if (items.some((it) => it.i === p.i && it.j === p.j)) continue;
    if (inRoom(p)) continue;
    const spot = classifyTopology(g, p, rng);
    if (spot) byTopo[spot.topo].push(spot);
  }
  // Deal kinds round-robin (bumpers weighted double — they're the signature
  // part; the Wave-A kinds are threaded through so every floor tastes them)
  // until the budget is spent or every pool is dry. Themes may pass their own
  // deal to bias the floor (a sewer floor deals oil twice, etc.).
  const deal: PartSpotKind[] = extras.deal ?? ["bumper", "ramp", "spring", "glove", "bumper", "oil", "deflector", "spinpad", "ramp", "slingshot"];
  let dealIdx = 0;
  let dry = 0;
  while (parts.length < corridorBudget && dry < deal.length) {
    const kind = deal[dealIdx % deal.length];
    dealIdx++;
    const pool = byTopo[KIND_TOPOLOGY[kind] ?? "junction"];
    let placed = false;
    while (pool.length > 0) {
      const cand = pool.pop()!;
      if (parts.some((q) => Math.abs(q.i - cand.i) + Math.abs(q.j - cand.j) < 3)) continue; // spacing
      parts.push(spotForKind(kind, cand, rng));
      placed = true;
      break;
    }
    dry = placed ? 0 : dry + 1;
  }

  // ── Target bullseyes: wall-mounted like torches, spaced wide — the floor's
  // "break them all" objective layer. Never counted against the part budget. ──
  const targetBudget = extras.targets ?? 5;
  let targetsPlaced = 0;
  for (const p of shuffled(floors, rng)) {
    if (targetsPlaced >= targetBudget) break;
    if (p.i === stairs.i && p.j === stairs.j) continue;
    if (inRoom(p)) continue;
    if (parts.some((q) => Math.abs(q.i - p.i) + Math.abs(q.j - p.j) < 4)) continue;
    if (torches.some((t) => t.i === p.i && t.j === p.j)) continue;
    const side = WALL_SIDES.find(([di, dj]) => at(g, p.i + di, p.j + dj) === T_WALL);
    if (!side) continue;
    parts.push({ i: p.i, j: p.j, kind: "target", dirI: side[0], dirJ: side[1], dir2I: 0, dir2J: 0 });
    targetsPlaced++;
  }

  // ── Dead-end economics: the leftovers of the deadend pool (springs took
  // theirs) get trapdoors — the coaster hatches — and one Oracle Frog perch,
  // so poking into a dead end always pays SOMETHING. ──
  const deadEnds = byTopo.deadend.filter(
    (d) => !parts.some((q) => q.i === d.i && q.j === d.j) && Math.abs(d.i - start.i) + Math.abs(d.j - start.j) >= 8,
  );
  const trapdoorBudget = extras.trapdoors ?? 2;
  for (let k = 0; k < Math.min(trapdoorBudget, deadEnds.length); k++) {
    const d = deadEnds[k];
    parts.push({ i: d.i, j: d.j, kind: "trapdoor", dirI: d.dirI, dirJ: d.dirJ, dir2I: 0, dir2J: 0 });
  }
  const frogSpot = deadEnds[trapdoorBudget] ?? null;
  const frog: TilePos | null = frogSpot ? { i: frogSpot.i, j: frogSpot.j } : null;

  // ── Prefab anchors (maze/prefabs.ts stamps): parts drop in with their dirs
  // derived from live topology; spawns/prizes feed the shared pools. ──
  for (const a of extras.anchors ?? []) {
    if (at(g, a.i, a.j) !== T_FLOOR) continue; // stairs stole the tile, etc.
    if (a.kind === "spawn") {
      spawns.push({ i: a.i, j: a.j });
      continue;
    }
    if (a.kind === "prize") {
      const prize = shuffled(["gold", "health", "rage", "haste", "shield"], rng)[0];
      items.push({ kind: "potion", id: prize, i: a.i, j: a.j });
      continue;
    }
    if (parts.some((q) => q.i === a.i && q.j === a.j)) continue;
    const c = classifyTopology(g, a, rng) ?? { i: a.i, j: a.j, topo: "junction" as Topology, dirI: 1, dirJ: 0, dir2I: 0, dir2J: 0 };
    parts.push(spotForKind(a.kind, c, rng));
  }

  // ── Secrets: collect every CRACKED band stamped by crackSecretWalls. After
  // thickenWalls a raw crack is a 2×2 band whose top-left tile has even coords
  // — that top-left is the band's handle (build.ts + secrets.ts key off it). ──
  const secrets: TilePos[] = [];
  for (let j = 0; j < g.h - 1; j += 2) {
    for (let i = 0; i < g.w - 1; i += 2) {
      if (at(g, i, j) === T_CRACKED) secrets.push({ i, j });
    }
  }

  return { start, stairs, spawns, torches, items, props, parts, rooms: furnished.rooms, secrets, frog };
}
