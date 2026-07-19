/**
 * THE TAVERN FLOOR PLAN — pure data, no THREE, no DOM.
 *
 * Hand-authored rather than generated: the tavern's job is to be instantly
 * legible (a new player should find the forge, the bar and the way down in
 * seconds), and that is a level-design problem, not a procedural one. Keeping it
 * as plain data means the geometry, the collision and the proximity checks all
 * read from ONE description, and the whole thing is testable without a canvas.
 *
 * Axes match the dungeon: +x east, +z south (toward the camera), 1 unit = 1
 * dungeon tile, so the player reads at the same scale in both scenes.
 */

/** An axis-aligned box on the floor. Used for both props and collision. */
export interface Rect {
  /** Centre. */
  x: number;
  z: number;
  /** Full extents (not half). */
  w: number;
  d: number;
}

/** What a station does when you interact with it. */
export type StationKind =
  /** Opens one of the existing vendor counters from scenes/dungeon/tavern.ts. */
  | { kind: "vendor"; vendor: "cards" | "weapons" | "armor" | "potions" }
  /** The run summary on the central table. */
  | { kind: "summary" }
  /** The casino corner — slots, roulette, blackjack, darts. */
  | { kind: "gambler" }
  /** Commit the loadout and generate the next floor. */
  | { kind: "descend" };

export interface Station {
  id: string;
  /** Shown in the interaction prompt, e.g. "Forge / Repair". */
  label: string;
  /** One-line flavour under the label. */
  blurb: string;
  /** Where the player stands to use it (the FOOT position, not the prop's). */
  x: number;
  z: number;
  /** Interaction radius in world units. */
  radius: number;
  /** Accent colour — the station's light and its prompt share it. */
  accent: number;
  action: StationKind;
}

/** Room interior, in world units. Walls sit just outside these bounds. */
export const ROOM = {
  minX: -9,
  maxX: 9,
  minZ: -7,
  maxZ: 7,
} as const;

export const ROOM_W = ROOM.maxX - ROOM.minX;
export const ROOM_D = ROOM.maxZ - ROOM.minZ;

/** Wall height, matched to the dungeon so the two scenes feel continuous. */
export const WALL_HEIGHT = 3.2;

/** How far from a wall or prop the player's centre can get. */
export const PLAYER_RADIUS = 0.32;

/** Ejection overshoot, so a resolved collision never rests exactly on an edge. */
const EJECT_EPS = 1e-3;

/** Warm hearth/forge orange — the "safe, occupied" half of the palette. */
export const WARM = 0xf0a63c;
/** Cold machine cyan — pinball hardware, card sockets, the way down. */
export const COLD = 0x6fd0e8;
/** Reserved for rewards and the jackpot sign. Never use it for navigation. */
export const GOLD = 0xf0c040;

/**
 * The stations, laid out so every one is visible from the room's centre.
 *
 * The plan deliberately puts DESCEND at the north wall behind the central table:
 * the player crosses the room's middle to reach it and passes the run summary on
 * the way, which is the readiness check the pacing wants.
 */
export const STATIONS: Station[] = [
  {
    id: "board",
    label: "Descend",
    blurb: "commit your loadout and drop into the next floor",
    x: 0,
    z: -5.2,
    radius: 1.5,
    accent: COLD,
    action: { kind: "descend" },
  },
  {
    id: "forge",
    label: "Forge / Repair",
    blurb: "repair, add a socket, forge and reroll cards",
    x: -5.2,
    z: -2.6,
    radius: 1.6,
    accent: WARM,
    action: { kind: "vendor", vendor: "weapons" },
  },
  {
    id: "bar",
    label: "Trade",
    blurb: "potions for the belt",
    x: 5.2,
    z: -2.6,
    radius: 1.6,
    accent: WARM,
    action: { kind: "vendor", vendor: "potions" },
  },
  {
    id: "table",
    label: "Review Run",
    blurb: "the floor you just cleared",
    x: 0,
    z: -0.2,
    radius: 1.9,
    accent: COLD,
    action: { kind: "summary" },
  },
  {
    id: "dealer",
    label: "Cards",
    blurb: "buy power cards and socket them",
    x: 5.2,
    z: 2.8,
    radius: 1.6,
    accent: COLD,
    action: { kind: "vendor", vendor: "cards" },
  },
  {
    id: "armory",
    label: "Manage Loadout",
    blurb: "plate, helms and repairs",
    x: -5.2,
    z: 2.8,
    radius: 1.6,
    accent: WARM,
    action: { kind: "vendor", vendor: "armor" },
  },
  {
    id: "gambler",
    // Beside the stair you ARRIVE on, not the exit. You land flush with the
    // floor's gold and the shops sit between here and the way out, so losing
    // has a visible cost — you can't afford the card you wanted.
    label: "Risk Gold",
    blurb: "slots · roulette · blackjack · darts",
    x: 3.0,
    z: 5.6,
    radius: 1.5,
    accent: GOLD,
    action: { kind: "gambler" },
  },
];

/**
 * Solid furniture the player walks around.
 *
 * These are the PROPS, offset from the station's stand-here position so you
 * approach a counter rather than standing inside it. The central table is the
 * one obstacle in open floor, which is what makes the room read as a room
 * instead of a box.
 */
export const OBSTACLES: Rect[] = [
  { x: 0, z: -1.6, w: 3.6, d: 2.0 }, // central pinball table
  { x: -7.2, z: -2.6, w: 2.6, d: 2.2 }, // forge + anvil
  { x: 7.2, z: -2.6, w: 2.6, d: 2.2 }, // bar counter
  { x: 7.2, z: 2.8, w: 2.6, d: 2.0 }, // card dealer's table
  { x: -7.2, z: 2.8, w: 2.6, d: 2.0 }, // armory bench
  { x: 0, z: -6.4, w: 4.2, d: 1.0 }, // notice board / plunger housing
];

/**
 * Where each keeper stands.
 *
 * Lives here, with the rest of the floor plan, because it is subject to exactly
 * the same constraint as a station's stand-here spot: it must be OPEN FLOOR. The
 * first pass put keepers "behind their counters" at coordinates that were inside
 * them, and four invisible NPCs buried in furniture is not a bug you notice from
 * a passing test — only from a screenshot. `layout.test.ts` now asserts it.
 *
 * They stand beside their station rather than behind it: the counters back onto
 * walls, so the only open floor adjacent to each one is along its side.
 */
export interface KeeperSpot {
  /** Matches the Station id it belongs to. */
  id: string;
  x: number;
  z: number;
}

export const KEEPER_SPOTS: KeeperSpot[] = [
  { id: "forge", x: -6.6, z: -0.7 },
  { id: "bar", x: 6.6, z: -0.7 },
  { id: "dealer", x: 6.6, z: 4.4 },
  { id: "armory", x: -6.6, z: 4.4 },
];

/** The player's entry point — at the foot of the dungeon stair, facing in. */
export const SPAWN = { x: 0, z: 5.4 } as const;

/** The stair back down, drawn at the south wall. */
export const STAIR = { x: 0, z: 6.6, w: 3.0, d: 1.2 } as const;

/** Squared distance — avoids a sqrt in the per-frame proximity scan. */
function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/**
 * The station the player is close enough to use, or null.
 *
 * Returns the NEAREST when radii overlap, so standing between two counters
 * always resolves to one — an ambiguous prompt that flickers between stations is
 * worse than picking the closer one.
 */
export function stationAt(x: number, z: number): Station | null {
  let best: Station | null = null;
  let bestD = Infinity;
  for (const s of STATIONS) {
    const d = dist2(x, z, s.x, s.z);
    if (d > s.radius * s.radius) continue;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/**
 * Slide a circle to (toX, toZ), pushed out of the walls and any furniture.
 *
 * Ejection is decided by which axis the player was ALREADY clear on before the
 * move — that axis is the one the move crossed, so that's the face to be pushed
 * back out of. Using the post-move offset instead looks equivalent but sends a
 * dead-centre approach straight through to the far side of the prop, and using
 * the movement delta does the same. Getting this wrong means walking into a
 * table teleports you behind it.
 *
 * Resolving one axis and leaving the other free is what makes running into a
 * counter at an angle SLIDE along it rather than stick — the same feel as the
 * dungeon's `moveCircle`, but against a handful of rects instead of a tile grid.
 */
export function moveInRoom(fromX: number, fromZ: number, toX: number, toZ: number, r = PLAYER_RADIUS): { x: number; z: number } {
  let x = toX;
  let z = toZ;

  // Walls first, so furniture resolution can't shove us back through them.
  x = Math.max(ROOM.minX + r, Math.min(ROOM.maxX - r, x));
  z = Math.max(ROOM.minZ + r, Math.min(ROOM.maxZ - r, z));

  for (const o of OBSTACLES) {
    const hx = o.w / 2 + r;
    const hz = o.d / 2 + r;
    if (Math.abs(x - o.x) >= hx || Math.abs(z - o.z) >= hz) continue; // clear of this one

    const wasClearX = Math.abs(fromX - o.x) >= hx;
    const wasClearZ = Math.abs(fromZ - o.z) >= hz;

    // Push back out of the face we came through, toward where we came from.
    // EJECT_EPS keeps us a hair OUTSIDE rather than exactly on the boundary:
    // landing on it exactly leaves the result at the mercy of float rounding,
    // which reads as intermittently clipping into a counter.
    const ejectX = (): void => {
      x = o.x + (fromX >= o.x ? hx + EJECT_EPS : -hx - EJECT_EPS);
    };
    const ejectZ = (): void => {
      z = o.z + (fromZ >= o.z ? hz + EJECT_EPS : -hz - EJECT_EPS);
    };

    if (wasClearX && !wasClearZ) ejectX();
    else if (wasClearZ && !wasClearX) ejectZ();
    else if (wasClearX && wasClearZ) {
      // Diagonal entry through a corner: undo the shallower penetration.
      if (hx - Math.abs(x - o.x) < hz - Math.abs(z - o.z)) ejectX();
      else ejectZ();
    } else {
      // Already overlapping before the move (a spawn or a layout change) — shove
      // out the nearest face so we never stay stuck inside.
      if (hx - Math.abs(x - o.x) < hz - Math.abs(z - o.z)) x = o.x + (x >= o.x ? hx + EJECT_EPS : -hx - EJECT_EPS);
      else z = o.z + (z >= o.z ? hz + EJECT_EPS : -hz - EJECT_EPS);
    }
  }

  // A corner ejection can push us back into a wall; clamp once more.
  x = Math.max(ROOM.minX + r, Math.min(ROOM.maxX - r, x));
  z = Math.max(ROOM.minZ + r, Math.min(ROOM.maxZ - r, z));
  return { x, z };
}

/** True if a point is inside the room and clear of furniture (for tests/spawns). */
export function isOpen(x: number, z: number, r = PLAYER_RADIUS): boolean {
  if (x < ROOM.minX + r || x > ROOM.maxX - r || z < ROOM.minZ + r || z > ROOM.maxZ - r) return false;
  for (const o of OBSTACLES) {
    if (Math.abs(x - o.x) < o.w / 2 + r && Math.abs(z - o.z) < o.d / 2 + r) return false;
  }
  return true;
}
