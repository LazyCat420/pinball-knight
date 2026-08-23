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

import { clamp } from "../../utils/math";

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
  /** Opens one of the existing vendor counters from game/pinball-knight/tavern.ts. */
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
 *
 * STAND SPOTS ARE PULLED OFF THEIR COUNTERS (2026-07-19). Every spot used to sit
 * ~0.38 from the face of its own obstacle — i.e. as close as PLAYER_RADIUS lets
 * you get. Two things followed, and both of them were the "I have to hunt for
 * the spot" complaint:
 *
 *  - Roughly HALF of each interaction circle was inside the furniture, so the
 *    reachable part of a 1.6 radius was ~1.2 deep, all of it on one side. You
 *    were effectively aiming at a half-disc whose centre you could not occupy.
 *  - `stations.ts` draws the focus spotlight (radius 1.15) centred on the stand
 *    spot, so most of the disc was buried under the prop. The one visual cue for
 *    "stand here" was mostly not on the floor.
 *
 * Each spot now sits ~0.7 clear of its counter, which centres the circle on
 * floor you can actually stand on and puts the whole spotlight where you can see
 * it, and the vendor radii went 1.6 -> 1.7 (TAVERN_PLAN: walking to a station is
 * pacing, but "must never feel cumbersome" — prefer generous). The room is big
 * enough that this costs nothing: `layout.test.ts` still asserts no two circles
 * touch, and the tightest pair after the move is gambler/dealer at 3.75 against
 * a 3.3 sum.
 */
export const STATIONS: Station[] = [
  {
    id: "board",
    label: "Descend",
    blurb: "commit your loadout and drop into the next floor",
    x: 0,
    // Was z -5.2, which is 0.38 off the notice board's collision face (z -5.9,
    // plus PLAYER_RADIUS). You approach this one head-on from the south, so the
    // entire southern half of the circle was the only usable part. Pulled to
    // -4.9 and widened to 1.6: the trigger band is now z -5.58..-3.3, which is
    // the corridor between the board and the central table, so simply walking
    // north out of the room's spine arms the plunger.
    z: -4.9,
    radius: 1.6,
    accent: COLD,
    action: { kind: "descend" },
  },
  {
    id: "forge",
    label: "Forge / Repair",
    blurb: "repair, add a socket, forge and reroll cards",
    // The four vendor counters back onto the east/west walls, so you always
    // arrive from the room's centre. -5.2 -> -4.8 puts the spot 0.78 clear of
    // the forge's face instead of 0.38, so the circle straddles open floor.
    x: -4.8,
    z: -2.6,
    radius: 1.7,
    accent: WARM,
    action: { kind: "vendor", vendor: "weapons" },
  },
  {
    id: "bar",
    label: "Trade",
    blurb: "potions for the belt",
    x: 4.8, // mirror of the forge — see the note there
    z: -2.6,
    radius: 1.7,
    accent: WARM,
    action: { kind: "vendor", vendor: "potions" },
  },
  {
    id: "table",
    label: "Review Run",
    blurb: "the floor you just cleared",
    x: 0,
    // Was z -0.2. The central table's collision face is at z -0.6, and with
    // PLAYER_RADIUS the closest you can stand is -0.28 — so the nominal stand
    // spot sat EIGHT HUNDREDTHS of a unit inside the only place you were allowed
    // to be. `isOpen` passed, so no test caught it, but in practice you were
    // permanently pinned against the table with the spotlight disc half under
    // it. 0.4 was 0.68 clear, on the south side you actually walk in from.
    //
    // 0.4 -> 0.9 because the pinball cabinet turned PORTRAIT (see OBSTACLES[0]):
    // it is now 3.2 deep instead of 2.0, so its south face moved from -0.6 to
    // 0.0 and the old spot would have been pinned against it again.
    z: 0.9,
    radius: 1.9,
    accent: COLD,
    action: { kind: "summary" },
  },
  {
    id: "dealer",
    label: "Cards",
    blurb: "buy power cards and socket them",
    x: 4.8, // mirror of the forge — see the note there
    z: 2.8,
    radius: 1.7,
    accent: COLD,
    action: { kind: "vendor", vendor: "cards" },
  },
  {
    id: "armory",
    label: "Manage Loadout",
    blurb: "plate, helms and repairs",
    x: -4.8, // mirror of the forge — see the note there
    z: 2.8,
    radius: 1.7,
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
    // West of the cabinet, not in front of it. The stand-here spot used to be
    // 3.0 — fine while the cabinet was walk-through, but it sits inside the
    // solid rect added for it (|3.0 - 3.9| = 0.9, under the 0.8 half-width plus
    // PLAYER_RADIUS 0.32), so the station became unreachable. `layout.test.ts`
    // caught it immediately, which is the whole reason placement lives here as
    // data rather than scattered through the prop builders.
    //
    // Standing BESIDE an arcade cabinet reads oddly, and the obvious fix — put
    // the spot in front of the screen — does not exist here: props.ts angles the
    // screen toward +z (the camera) at z 6.34, and the south wall leaves no
    // floor there. North of the cabinet is the other candidate and it collides
    // with the card dealer: (3.9, 4.6) is 2.22 from the dealer's spot against a
    // 3.3 radius sum, so the two prompts would fight.
    //
    // So west it stays — which is in fact the natural approach anyway, because
    // SPAWN is at (0, 5.4) and you walk east along the south wall straight into
    // it. 2.5 -> 2.2 doubles the clearance from the cabinet (0.28 -> 0.58) and
    // buys back the dealer margin (3.75 against 3.3), and the radius goes to 1.6
    // so the walk east arms it a step earlier. Kept clear of SPAWN itself
    // (2.2 away, outside the radius): the prompt firing the instant you arrive
    // in the room would read as the tavern nagging you to gamble.
    x: 2.2,
    z: 5.5,
    radius: 1.6,
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
  // THE CENTRAL PINBALL TABLE, AND IT IS PORTRAIT ON PURPOSE (2026-07-20).
  //
  // This was 3.6 x 2.0 — wider than it was deep. Under the fixed iso camera that
  // is the silhouette of a SOFA, and a screenshot confirmed it: a long low brown
  // body, a flat dark top and a back panel, with the bumper caps reading as
  // scattered lights on cushions. No amount of playfield detail fixed it,
  // because the detail was being read as things sitting on a couch.
  //
  // A pinball machine is roughly 1 : 2, narrow-to-deep, with the long axis
  // pointing AWAY from the player. 2.3 x 3.2 gives that, and it is what makes
  // the rake, the flippers-at-the-near-end and the tall backbox read as one
  // object instead of upholstery. The stand-here spot moved south with it.
  { x: 0, z: -1.6, w: 2.3, d: 3.2 },
  { x: -7.2, z: -2.6, w: 2.6, d: 2.2 }, // forge + anvil
  { x: 7.2, z: -2.6, w: 2.6, d: 2.2 }, // bar counter
  { x: 7.2, z: 2.8, w: 2.6, d: 2.0 }, // card dealer's table
  // Armory bench. Extended south (d 2.0 -> 2.5, centre 2.8 -> 3.05) so that the
  // bench actually reaches its keeper: the frog sat 0.6 clear of the old south
  // face with nothing at its level, which read as a creature parked on open
  // floor rather than somebody working at a station.
  { x: -7.2, z: 3.05, w: 2.6, d: 2.5 },
  { x: 0, z: -6.4, w: 4.2, d: 1.0 }, // notice board
  // The DESCENT PLUNGER housing. Named in the rect above's old comment but
  // never actually covered by it: props.ts builds the housing at x 2.6 (the
  // board's east edge + 0.5), so it stood entirely outside the 4.2-wide board
  // rect and you could walk through the thing that launches you into the next
  // floor. Found by an AABB-vs-walkable audit, not by playing — it is in the
  // corner you only visit on the way out.
  { x: 2.6, z: -6.4, w: 0.6, d: 0.6 },
  // The gambler's arcade cabinet. Sized to its TOP LIP (1.6 x 1.0, the widest
  // part) rather than the body, so you can't clip a corner. Every other station
  // had a rect from the start; this one shipped without one and you could walk
  // straight through the cabinet.
  { x: 3.9, z: 5.9, w: 1.6, d: 1.0 },
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
  // The armory keeper, moved off open floor (2026-07-20). He used to stand at
  // (-6.6, 4.4): under the bench's x-span but 0.6 south of its face, so from the
  // camera he was a squat frog on bare planks with the bench floating behind and
  // above him. He now stands at the bench's south-east CORNER, which the bench
  // itself was extended to reach — the same "beside its long face" relationship
  // the other four keepers have. He cannot go further west or north (that is
  // inside the bench) nor further east (that is inside his own stand-here spot's
  // 0.8 exclusion), so the corner is the one place both reads work.
  { id: "armory", x: -5.35, z: 4.3 },
  // The gambler's tout. NOT behind the cabinet (x 3.15..4.65, z 5.45..6.35 in
  // props.ts) and NOT on the stand-here spot — east of the machine and a step
  // into the room, in the throwing line of the wall dartboard at (5.9, 6.6).
  //
  // The card dealer's radius is the constraint that keeps moving this one. At
  // (5.2, 4.4) it landed EXACTLY on the old 1.60 radius; (5.2, 4.6) cleared it
  // by 0.68. Pulling the dealer's own spot in to x 4.8 and widening it to 1.7
  // ate almost all of that back (down to 0.14), so the tout moves south with it:
  // (5.4, 5.0) is 2.28 from the dealer against a 1.7 radius, a 0.58 margin, and
  // 1.5 clear of the cabinet. Tucking him nearer the machine he is touting for
  // is the right direction anyway.
  //
  // 2026-07-20: (5.4, 5.0) put him 1.34 from the card dealer's keeper, and at
  // this camera angle two upright sprites 1.34 apart on the same screen diagonal
  // read as ONE clump of bodies in front of the arcade cabinet. Pulled south and
  // west to hug the machine he is touting for — 2.06 apart now, and he overlaps
  // the cabinet rather than the dealer. 5.3 is the westmost he can go: 5.02 is
  // where the cabinet's collision rect starts.
  { id: "gambler", x: 5.3, z: 6.0 },
];

/** The player's entry point — at the foot of the dungeon stair, facing in. */
export const SPAWN = { x: 0, z: 5.4 } as const;

/**
 * Staggered spawn points, one per color slot, so up to 8 knights don't stack on
 * a single tile when they enter the shared tavern. Slot 0 keeps the canonical
 * SPAWN; the rest fan out along the south wall around it. Indexed by color slot.
 */
export const SPAWN_SLOTS: readonly { x: number; z: number }[] = [
  { x: 0.0, z: 5.4 },
  { x: 1.2, z: 5.2 },
  { x: -1.2, z: 5.2 },
  { x: 2.2, z: 5.0 },
  { x: -2.2, z: 5.0 },
  { x: 1.0, z: 5.8 },
  { x: -1.0, z: 5.8 },
  { x: 0.0, z: 6.0 },
] as const;

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
  x = clamp(x, ROOM.minX + r, ROOM.maxX - r);
  z = clamp(z, ROOM.minZ + r, ROOM.maxZ - r);

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
  x = clamp(x, ROOM.minX + r, ROOM.maxX - r);
  z = clamp(z, ROOM.minZ + r, ROOM.maxZ - r);
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
