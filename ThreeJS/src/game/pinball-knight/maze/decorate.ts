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
import { type Grid, type TilePos, type Room, T_STAIRS, at, T_FLOOR, T_WALL, T_CRACKED, idx, setTile, isWalkable, setShape, shapeAt } from "./generator";
import { SHAPE_FULL, SHAPE_ARC, SHAPE_SLANT_NE, SHAPE_SLANT_NW, SHAPE_SLANT_SE, SHAPE_SLANT_SW, shapeBacking, slantToRound, type TileShape } from "../engine/tile-shape";
import { createSpacingGrid } from "../engine/spacing-grid";
import { authorArteryBanks, traceArtery } from "./artery-banks";
import { chuteTiles, type LaunchChute } from "./track-launch";

// `traceArtery` moved to artery-banks.ts (the maze layer) when the bank pass
// did — see track-floor.ts. Re-exported here because it was part of this
// module's public surface and callers/tests import it from decorate.
export { traceArtery };
import { bfsDistances, bfsDistancesOwned } from "../engine/flow-field";
import { buildFlowField, descend, flowDrop, isDownhill, openRunway, phiAt, steepestDown, UNREACHED } from "./flow-orient";
import { placeAssemblies, partsOf } from "./assembly-place";
import { MACHINES } from "./assembly-lib";
import { mulberry32 } from "../../../utils/rng";
import { breakFlowLoops, findFlowCycles, type FlowPart } from "./flow-loops";
import type { AssemblyRef } from "./assembly";
import { authorCircuits, type Circuit } from "./circuit";
import { PICKUP_WEAPONS, rollItemRarity, type ItemRarity } from "../items";

export interface Torch extends TilePos {
  /** Direction from the floor tile to the wall it mounts on. */
  di: number;
  dj: number;
}

export interface ItemDrop extends TilePos {
  kind: "weapon" | "gear" | "potion";
  /** WeaponId / GearSlot / PotionId — resolved by core against items.ts. */
  id: string;
  /**
   * Rolled ITEM RARITY for weapons/gear — how many CARDS the piece can socket
   * (items.ts SLOTS_BY_RARITY). Rolled HERE, off the floor's seeded rng, so
   * every co-op peer generating the same floor agrees on what dropped; a
   * Math.random here would give one player a legendary and another a common on
   * the same tile. Undefined for potions.
   */
  rarity?: ItemRarity;
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
  | "booster"
  // ── The booster FAMILY (live QA: "we keep recycling this one type of
  // booster… we need corner booster, curved boosters, more jumpers"). Censused
  // before they existed: `booster` was 73% of all launch furniture on the
  // floor (2471 of 3364) and every one of them was the same flat straight pad.
  | "boostcorner"
  | "boostcurve"
  | "jumppad"
  | "deflector"
  | "glove"
  | "oil"
  | "spinpad"
  | "slingshot"
  | "target"
  | "trapdoor"
  | "flipper"
  | "mirror"
  // The PLAZA parts (see constants/pinball.ts). Each gets its OWN placement
  // pass at the very end of buildParts rather than joining `deal` — see the
  // note on RNG stream order there.
  | "swingarm"
  | "flywheel"
  | "magpost"
  | "pit"
  | "electric"
  | "firevent"
  | "magstrip"
  | "rollover"
  | "lamp"
  | "maw";

export interface PinballPartSpot extends TilePos {
  kind: PartSpotKind;
  dirI: number;
  dirJ: number;
  dir2I: number;
  dir2J: number;
  /** TARGET BANK (Slice 6): a drop-target's bank id + its order in the bank. */
  bank?: number;
  seq?: number;
  /** SWINGARM: rotation direction (+1/-1) and the phase seed. */
  spin?: number;
  phase?: number;
  /** MAGPOST: which of the three post caps this one wears. Cosmetic only. */
  variant?: number;
  /** PEG FIELD id — on the posts AND on the bumpers seeded among them. */
  field?: number;
  /**
   * VAULT RAMP: this part is aimed at a wall BAND ON PURPOSE, to fling the
   * knight over it into the corridor beyond. The launch-target invariant below
   * must leave it alone — its "orphan" look (no runway, fires into rock) is
   * exactly the feature.
   */
  vault?: boolean;
  /**
   * CHAIN LINK: placed BECAUSE another part's exit ray arrives here, so the
   * anti-clustering spacing rule deliberately does not apply to it. Chains are
   * what make a floor a table instead of a scatter — see CHAIN_LINKS.
   */
  chain?: boolean;
  /**
   * STATION SPINE: this part belongs to the connected booster route laid down
   * the main start→stairs artery (layStationSpine). Like `chain` it skips the
   * anti-clustering spacing; unlike an ordinary launcher it is EXEMPT from the
   * A1 runway repair (openLaunchTargets), because a spine booster that feeds a
   * bend deflector is SUPPOSED to have a wall a tile or two ahead — the turn is
   * the point. The spine is the "boosters feed into each other" backbone.
   */
  spine?: boolean;
  /**
   * LAUNCH CHUTE: a pad in the floor's plunger lane (track-launch.ts).
   *
   * Exempt from BOTH facing post-passes — the runway re-aim and
   * `breakLaunchDuels` — and unlike the vault/spine exemption this one does not
   * lift on a track floor, because the chute is exactly the thing those two
   * passes cannot reason about. Its direction is not a placement guess to be
   * corrected; it IS the lane, sealed on both sides and pointed at the merge.
   * Measured before the badge: the re-aim flipped a pad to (0,−1) against a
   * (0,1) lane, having found "more runway" back up the hallway the player was
   * just fired out of.
   */
  chute?: boolean;
  /**
   * ORBIT (D2): this banked rail is one corner of a closed CIRCUIT around a
   * room. Railing all four in sequence completes the orbit — the loop shot a
   * real table has. `orbit` is the circuit id, `orbitSeq` the corner's order
   * going clockwise, so the game can tell a lap from four unrelated bank shots.
   */
  orbit?: number;
  orbitSeq?: number;
  /**
   * ROLLOVER LANE (D3): one lane of a parallel array. `lane` is the array id,
   * `laneSeq` which lane it is across the array (0..n-1). Lighting every lane
   * pays out; the dodge key rotates which lane is lit (pinball lane change).
   */
  lane?: number;
  laneSeq?: number;
  /**
   * ASSEMBLY MEMBER: this part belongs to an authored MACHINE placed by
   * `maze/assembly-place.ts`, and its facings came from that machine's
   * definition rather than from the topology of the tile it landed on.
   *
   * It buys exactly two exemptions, both because the machine's shape IS the
   * intent: `polishParts` does not de-clump it (a pop nest is three bumpers at
   * Chebyshev 2 on purpose) and the A1 runway repair does not re-aim it (a
   * booster that feeds the deflector two tiles ahead is supposed to have a wall
   * beyond it — the turn is the point).
   *
   * It buys NO exemption from `breakLaunchDuels` or `breakFlowLoops`. Those two
   * guard a genuine soft-lock, and the router earns its place by PRE-checking
   * them rather than by being excused from them.
   */
  asm?: AssemblyRef;
  /**
   * CIRCUIT MEMBER: the id of the highway loop this part belongs to.
   *
   * Set on machine parts AND on the loose corner/booster fillers laid between
   * them, which is why it is separate from `asm` — a filler has a circuit but
   * no machine. See `maze/circuit.ts` for what a circuit guarantees.
   */
  circuit?: number;
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
  /** Centres of large open plazas that got a bumper-diamond pattern stamped —
   * core spawns ARPG monster packs here so big rooms are never empty. */
  plazas: TilePos[];
  /** The Oracle Frog's dead-end perch, if this floor drew one. */
  frog: TilePos | null;
  /**
   * The floor's highway loops (maze/circuit.ts), as COMMITTED — a circuit the
   * acyclicity pre-check rejected is not here.
   *
   * Surfaced on the plan rather than kept internal because every question worth
   * asking about a circuit is about the whole loop (how long is the ring, how
   * many off-ramps, where it meets the other one) and none of that is
   * recoverable from the flat part list afterwards.
   */
  circuits: Circuit[];
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
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
const WEAPON_POOL: readonly string[] = PICKUP_WEAPONS;
const WEAPONS_PER_LEVEL = 3;
const GEAR_ITEMS = ["helmet", "armor", "boots"];
// Potions strewn per floor: always a health flask, plus THREE random power-ups
// from the pool. Health is guaranteed so the run stays survivable; the rest add
// "do I chug it now?" decisions. Ids → POTIONS (the consolidated pinball kit:
// ball form / freeze / multi-ball, alongside the combat buffs).
/**
 * ⚠️ EVERY ID HERE NEEDS AN `ITEM_PAINTS` ENTRY. A ground item's sprite is built
 * with `createStaticSprite(ITEM_PAINTS[id])` and that lookup is unguarded, so an
 * id with no painter does not draw a placeholder — it kills the floor build and
 * you get a black screen with a working HUD. `potion-supply.test.ts` holds this
 * pool (and the other three supply routes) to that.
 *
 * ✨ laser joined on 2026-07-29. It had been a finished mechanic with no supply
 * anywhere in the game — not here, not the cart, not the tavern, not a recipe —
 * so `applyPotion`'s laser branch and the whole ricochet form it hands you to
 * were unreachable in a real run.
 */
export const POTION_POOL = ["rage", "haste", "shield", "gold", "ballform", "freeze", "multiball", "curveshot", "magnetboots", "laser"];
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
    // A true corner crook must have solid wall stone in its backing diagonal
    const diagI = p.i - (a[0] + b[0]);
    const diagJ = p.j - (a[1] + b[1]);
    if (at(g, diagI, diagJ) === T_WALL) {
      return { ...p, topo: "corner", dirI: a[0], dirJ: a[1], dir2I: b[0], dir2J: b[1] };
    }
    return { ...p, topo: "junction", dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0 };
  }
  if (open.length >= 3) {
    return { ...p, topo: "junction", dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0 };
  }
  return null;
}

/** Launch parts that fling the player — they need clear RUNWAY to be worth it. */
//
// `jumppad` is in: it fires along a single cardinal like the rest, and every
// consumer already skips `vault` parts, which is what jump pads are.
//
// `boostcorner` and `boostcurve` are deliberately OUT, for two different
// reasons worth stating so neither gets "tidied" in later:
//   · a corner booster's `dir` is the leg the ball ARRIVES on, not the leg it
//     fires along (same convention as `deflector`, which is also absent). A
//     pass that read `dir` as a fire direction would re-aim the entry;
//   · a curved booster's heading is a TANGENT, not a cardinal, so it fails the
//     `|dirI| + |dirJ| === 1` guard every one of these consumers applies —
//     out by construction, and listed here only so that is on purpose.
//
// ⚠️ THE LINE THAT USED TO SIT HERE — "maze/flow-loops.ts handles both, via its
// own exitRay" — WAS FALSE FOR HALF OF IT, and it is the reason the hole
// survived. `flow-loops`' LAUNCHERS set contains `boostcorner` and its `exitRay`
// correctly reads `dir2`; it does NOT contain `boostcurve`, and `movable()`
// there additionally demands a unit cardinal, which a tangent can never be. So
// `boostcurve` is skipped by openLaunchTargets, by the runway re-aim, by
// breakLaunchDuels AND by breakFlowLoops — every repair pass on the floor.
//
// That is deliberate and should stay: a cardinal-shaped repair has nothing
// legal to do to a tangent part. What it means is that a curved booster's
// AUTHORING gate is the only gate it will ever get, so that gate has to check
// the vector it actually throws along — see `curveOk` in layStationSpine.
const LAUNCH_KINDS = new Set<string>(["ramp", "booster", "spring", "slingshot", "flipper", "jumppad"]);
const MIN_RUNWAY = 3; // open tiles ahead a launch part needs, or it fires into a wall
/** Open tiles a CURVED pad must prove along its raw tangent. Two, where a
 *  cardinal pad's is three, and that is not a weakening: a diagonal ray in a
 *  2-wide lane meets the far wall in two tiles however healthy the route is, so
 *  a longer bar would measure hall-ness rather than aim. Still double the single
 *  tile the old `diagOpen` check proved, and the LENGTH requirement moves to the
 *  snapped cardinal, which is the vector that follows the corridor. */
const CURVE_RAY_RUNWAY = 2;

// ── ROUTE RHYTHM — how often the road is allowed to do something to you ──────
//
// Every number here is DERIVED from the shipped physics constants, and the
// derivations are written out because the previous values (stride 3-4, a station
// at every lattice bend) were chosen by feel and were wrong by roughly 5x.
//
// ── What a pad actually does ──
// `BOOSTER_SPEED` (15) is a FLOOR, not an add: pinball-collide does
// `momSpeed = min(MAX, max(momSpeed, BOOSTER_SPEED))`. With `PINBALL_FRICTION`
// 0.9 u/s^2 the speed left after coasting L tiles from that floor is
// sqrt(15^2 - 1.8L), so a pad `s` tiles behind the last one restores
// 15 - sqrt(225 - 1.8s):
//     s = 3  ->  0.18 u/s   (1.2% of the floor it advertises)
//     s = 8  ->  0.48 u/s   (3.2%)
//     s = 12 ->  0.73 u/s   (4.9%)
// At the shipped stride 3 a booster was restoring ONE PERCENT of its own speed
// floor. It was never an accelerator; it is a heading-snapper. So the spacing
// cannot be argued from the speed budget at all.
//
// ── What the speed budget DOES bound ──
// How far apart pads may be before the ball genuinely slows. Both ceilings are
// far looser than anything a floor reaches:
//   · bounces:  n_max = ln(v_min/v_0) / ln(rest_eff)
//               = ln(4.41/15) / ln(0.85) = 7.5 redirects on the WORST surface
//               (v_min = PINBALL_EXIT_MULT * PLAYER_SPEED = 1.05 * 4.2 = 4.41),
//               and 19.8 on a flat wall at PINBALL_WALL_RESTITUTION 0.94.
//   · distance: L = (15^2 - 4.41^2) / (2 * 0.9 * sigma) = 114 tiles at
//               FRICTION_CORRIDOR, 54 at the worst FRICTION_TIGHT.
// The primary artery is ~116 tiles END TO END, so distance never binds.
//
// ── What actually sets the spacing: STEERING ──
// A booster locks steering for BOOSTER_STEER_LOCK (0.16 s). Riding a chain of
// stride `s` at 15 u/s, the fraction of the route the player cannot steer is
//     duty = BOOSTER_STEER_LOCK / (s / BOOSTER_SPEED) = 2.4 / s
// which at the shipped stride 3 is **0.80** — the player was a passenger for
// four fifths of every road. The rule: a player keeps steering authority over at
// least two thirds of a route, i.e. duty <= MAX_LOCK_DUTY.
export const MAX_LOCK_DUTY = 0.3;
/** ceil(BOOSTER_SPEED * BOOSTER_STEER_LOCK / MAX_LOCK_DUTY) = ceil(15*0.16/0.3). */
export const PAD_STRIDE = 8;
/**
 * A slip road runs at a third of the primary's pad density.
 *
 * `alternateRoutes`' own header says what an alternate IS — be enterable, do not
 * end in mid-air, merge into traffic — and none of those is a lane-length
 * contract. It is a slip road. At equal density four roads make the floor four
 * equally loud voices with no signal for which one reaches the stairs; at a
 * third, the primary carries the majority of the route furniture and the
 * through-line reads. Stations are NOT thinned: a slip road that dumps momentum
 * at its own corner is the "gets pushed and then coasts into nothing" defect.
 */
export const ALT_PAD_STRIDE = PAD_STRIDE * 3;
/**
 * How far the smoothed heading must turn before the route earns a station.
 *
 * One octant. Below 45 degrees the route has not changed heading in the only
 * alphabet the parts can express, so a station there is a redirect the ball
 * never experiences — LANE_CENTER_PULL absorbs a one-tile jog on its own.
 * Measured: the artery has 31.8 LATTICE bends per floor but only ~6 genuine
 * 45-degree corners, and it was getting a station at every one of the 31.8.
 */
const STATION_TURN_COS = Math.cos(Math.PI / 4);
/**
 * Tiles between consecutive stations.
 *
 * Two stations closer than this share a steer-lock window and become the jam
 * case the runtime BOOSTER_JAM guard exists to catch:
 * CORNER_BOOST_SPEED * CORNER_BOOST_STEER_LOCK / 0.5 = 16 * 0.2 / 0.5 = 6.4.
 */
export const STATION_MIN_GAP = 6;
/**
 * How far along its own fire line a route pad may look to find the next part.
 *
 * DERIVED from the stride so the two cannot drift: a pad hands off to whatever
 * the next slot holds, plus the slack the slide-don't-skip rule can introduce
 * when a guard rejects the first candidate. It was a hard-coded 4, measured
 * when the stride was 3 — the same number restated in the test rather than read
 * from the rule, which is exactly how a gate comes to pin an old design.
 */
export const ROUTE_CHAIN_REACH = PAD_STRIDE + 4;
/**
 * A BEND's curve-carry booster needs more runway than a straight-run pad. It
 * sits in the corner, so the tile behind it is wall by construction: a ball
 * that reaches the far wall rebounds onto the pad and gets re-fired, which the
 * player feels as friction/stutter in the corner. With no escape behind, the
 * only remedy is enough room ahead that the launch never returns. See the
 * curve-carry branch in layStationSpine for the measurements.
 */
const CARRY_RUNWAY = 3;

/**
 * PATH-FIRST flow: the "speed up" parts must shove you ONWARD toward the exit,
 * not back the way you came (the "booster that just sends you back" bug). We
 * orient these down Φ, the distance-to-stairs field (maze/flow-orient.ts).
 *
 * ── What this set used to be, and what it cost ───────────────────────────
 *
 * `["ramp", "slingshot"]`. `booster` and `flipper` were both absent, and the
 * comment justified the omission for `flipper` ("a redirect — its direction is
 * already meaningful") while never mentioning `booster` at all. A part not in
 * this set takes its heading from `classifyTopology`, which resolves a straight
 * run's two ends with `rng() < 0.5`. So the single most common launch part on
 * the floor was aimed by a coin flip.
 *
 * Censused over 78 floors on the shipping path, before this line changed:
 *   non-spine boosters firing back toward the spawn   253/442  (57.2%)
 *   flippers                                          130/306  (42.5%)
 *   every launch part on the floor                    544/3364 (16.2%)
 *
 * A flipper's direction IS meaningful — it is a redirect — but "meaningful" was
 * doing no work when the leg it redirected onto was picked at random from the
 * junction's four. Aiming it down-flow keeps the redirect and removes the coin.
 *
 * `spring` stays out: it lives on a dead end and has exactly one opening to aim
 * out of, so there is no choice to make and forcing one would only fail.
 */
const FORWARD_FLOW_KINDS = new Set<string>(["ramp", "slingshot", "booster", "flipper", "jumppad"]);
/**
 * …but a table needs the odd rebound, so leave this fraction of speed parts as
 * a deliberate kickback rather than a pure conveyor belt toward the stairs.
 *
 * NOT applied to route (`spine: true`) parts, and that asymmetry is the design:
 * the routes are the floor's legible one-way structure and a random reversal in
 * one is indistinguishable from the bug this wave fixes. The kickbacks belong to
 * the loose corridor furniture, where a rebound reads as a rebound.
 */
const KICKBACK_CHANCE = 0.12;
/**
 * ALTERNATE ROUTES (see `alternateRoutes`): how many extra downhill roads a
 * floor gets besides the traced artery, how far a new road's head must sit from
 * every already-routed tile, and the shortest run that counts as a road at all
 * rather than a rib hanging off one.
 */
const ALT_ROUTES_MAX = 3;
const ALT_ROUTE_GAP = 6;
const ALT_ROUTE_MIN_LEN = 10;
/** Tiles an alternate road overlaps the road it merges into, so its last pads
 *  fire into that road's pads instead of onto bare floor. See `alternateRoutes`. */
const ALT_ROUTE_MERGE_RUN = 6;
/**
 * CHAIN SEEDING — the thing that makes a floor read as a pinball TABLE rather
 * than a maze with parts sprinkled in it.
 *
 * The corridor deal below is spacing-driven: it rejects any candidate within
 * Manhattan 3 of an existing part, and validates launchers only NEGATIVELY
 * ("don't fire into rock"). Nothing was ever placed BECAUSE another part threw
 * the knight at it — which is exactly backwards from a real table, where a
 * slingshot exists to feed the ramp that feeds the orbit.
 *
 * A chain fixes that: place a launcher, follow its exit ray to where the
 * knight would actually arrive, and put the next part THERE — then repeat from
 * that part's own exit. Each link is chosen to match the topology it lands on
 * (junction → bumper, corner → deflector, dead end → spring, straight → ramp),
 * so chains satisfy exactly the same placement invariants everything else does;
 * the only rule they're exempt from is the anti-clustering spacing, which is
 * the whole point.
 */
/**
 * CIRCUITS — how many highway loops a floor gets, and what they may spend.
 *
 * Two, not one: the ask was loops that INTERTWINE, so the player can switch
 * between them. One circuit is a track. Two sharing the artery is a junction
 * you can choose at, which is the whole point — see `maze/circuit.ts`.
 *
 * The ceiling is a DENSITY figure rather than a part count because
 * `floor-density.ts` caps the floor at 34 parts per 1k and shipping floors
 * already measure 15.6-28.2. 30 leaves the gate real headroom while letting a
 * sparse floor spend properly; the hard `CIRCUIT_PARTS_MAX` is the backstop for
 * a pathological ring that would otherwise eat the whole allowance.
 */
/**
 * How many authored MACHINES a floor may carry (maze/assembly-lib.ts).
 *
 * START SMALL AND KEEP THE OFF SWITCH. `placeAssemblies` early-returns an
 * empty report on `budget <= 0`, so 0 here restores the pre-2026-08-27 floor
 * exactly — the rollback for a generator change whose blast radius is every
 * floor of every run.
 *
 * 2 is deliberately below what a floor could hold. A machine reserves its whole
 * footprint from every later placer, so each one is spent against the corridor
 * deal; this number decides how much of a floor is AUTHORED rather than dealt,
 * not how busy the floor gets.
 */
const ASSEMBLY_BUDGET = 2;
/** Tiles between candidate origins when scanning a route for machine sites.
 *  Matches the circuit layer's stride — both walk the same roads. */
const ASSEMBLY_STRIDE = 8;
const CIRCUITS_DEFAULT = 3;
/** Share of the corridor budget the loops may take. The rest stays loose
 *  furniture, so a floor keeps pockets that are not on a highway. */
const CIRCUIT_BUDGET_SHARE = 0.6;
const CIRCUIT_PARTS_MAX = 96;
const CHAIN_LINKS = 4; // parts per chain, including the seed launcher
const CHAIN_TRIES = 40; // seed candidates to try before giving up on a chain
const CHAINS_DEFAULT = 1; // secondary shot chain off the spine (the station spine is now the primary route)

/** The last floor tile travelling (di,dj) from (i,j) before a wall stops you. */
function runwayEnd(g: Grid, i: number, j: number, di: number, dj: number, max = 12): TilePos | null {
  let last: TilePos | null = null;
  for (let d = 1; d <= max; d++) {
    const ni = i + di * d;
    const nj = j + dj * d;
    if (at(g, ni, nj) !== T_FLOOR) break;
    last = { i: ni, j: nj };
  }
  return last;
}

/** Vault-ramp geometry (kept local like MIN_RUNWAY — this module takes no constants). */
const VAULT_MAX_BAND = 2; // thickest wall band a vault aims across (thickened bands are 2)
const VAULT_MAX_REACH = 4; // landing must sit inside this many tiles — under RAMP_HOP_MAX (4.75)
const VAULT_RAMPS_DEFAULT = 3;
/** D3 rollover lane arrays: how many banks per floor, and lanes per bank. */
const ROLLOVER_ARRAYS_DEFAULT = 2;
/** How many of each PLAZA part a floor gets, and the peg field's footprint.
 *  Placement budgets, so they live here rather than in constants/pinball.ts —
 *  which owns what the parts DO. */
// CEILINGS, not counts — the actual number rides the floor's area (see the
// `budget` helper at the placement passes, and floor-density.test.ts, which is
// what caught the flat version).
const SWINGARMS_MAX = 2;
const FLYWHEELS_MAX = 2;
const MAGPOST_FIELDS_MAX = 3;
const MAGPOST_FIELD_W = 5;
const MAGPOST_FIELD_H = 4;
// 5 posts, not 7. A field is the single biggest furniture spend on the floor,
// and seven posts plus two bumpers made it 9 parts a throw.
const MAGPOST_FIELD_POSTS = 4;
const MAGPOST_FIELD_BUMPERS = 1;
const ROLLOVER_LANES = 3;

/**
 * Is there a wall BAND directly ahead of (i, j) that the ramp hop can clear —
 * i.e. 1..VAULT_MAX_BAND wall tiles backed by real corridor floor, with the
 * landing tile inside RAMP_HOP_MAX of the pad? This is the geometry a vault
 * ramp needs, and the exact geometry the ordinary "straight" placement can
 * never produce.
 */
function crossableBand(g: Grid, i: number, j: number, di: number, dj: number): boolean {
  let d = 1;
  // Walk to the near face of the band — the pad must be right up against it,
  // or the knight lands short and eats the wall.
  if (at(g, i + di, j + dj) !== T_WALL) return false;
  while (d <= VAULT_MAX_BAND && at(g, i + di * d, j + dj * d) === T_WALL) d++;
  if (d > VAULT_MAX_BAND) return false; // too thick to fly — that's a mountain
  // One tile of genuine corridor past the band, and within the hop's reach.
  if (d + 1 > VAULT_MAX_REACH) return false;
  return at(g, i + di * d, j + dj * d) === T_FLOOR && at(g, i + di * (d + 1), j + dj * (d + 1)) === T_FLOOR;
}

/** Where a floor begins and ends. Picked ONCE per floor, shared by every stage. */
export interface Endpoints {
  start: TilePos;
  stairs: TilePos;
}

/** Distance from the tile to a grid corner, in tiles. */
function cornerDist(p: TilePos, cx: number, cy: number): number {
  return Math.abs(p.i - cx) + Math.abs(p.j - cy);
}

/**
 * Pick a floor's START and STAIRS.
 *
 * This used to be "start = first floor tile scanning from the top-left, stairs =
 * the single farthest tile by BFS from it", computed independently here and in
 * decorateMaze. That is deterministic twice over: you always began in the
 * top-left corner, and on a roughly rectangular grid the farthest point from the
 * top-left corner is essentially always the bottom-right one — so the exit sat
 * in the same corner every single run. It looked like the rng was broken; it was
 * never consulted.
 *
 * Now: the start is drawn from one of the FOUR corners, and the stairs are drawn
 * from the tiles in the top band of BFS distance rather than the strict argmax.
 * The design intent — a floor is a long journey from one end to the other — is
 * preserved (the stairs are still among the farthest tiles from the start), but
 * which end that is now varies per floor.
 *
 * Call this ONCE per floor and pass the result to both widenMainArtery and
 * decorateMaze. Recomputing it per stage is what let the two drift apart.
 */
export function pickEndpoints(g: Grid, rng: () => number): Endpoints | null {
  const floors: TilePos[] = [];
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) if (at(g, i, j) === T_FLOOR) floors.push({ i, j });
  }
  if (!floors.length) return null;

  // Start: the floor tile nearest a randomly chosen corner.
  const corners: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [g.w - 1, 0],
    [0, g.h - 1],
    [g.w - 1, g.h - 1],
  ];
  const [cx, cy] = corners[Math.floor(rng() * corners.length)];
  let start = floors[0];
  let bestCorner = Infinity;
  for (const p of floors) {
    const d = cornerDist(p, cx, cy);
    if (d < bestCorner) {
      bestCorner = d;
      start = p;
    }
  }

  // Stairs: a random pick from the far band, not the strict argmax — so two
  // floors that happen to share a start corner still put the exit in
  // different places.
  const dist = bfsDistancesOwned(g, start.i, start.j); // held across later BFS calls
  let maxDist = 0;
  for (const p of floors) maxDist = Math.max(maxDist, dist[idx(g, p.i, p.j)]);
  const cutoff = Math.max(1, maxDist * FAR_BAND);
  const far = floors.filter((p) => {
    const d = dist[idx(g, p.i, p.j)];
    return d >= cutoff && !(p.i === start.i && p.j === start.j);
  });
  // ROUTE GEOMETRY (ROUTE_MATH §3 flow, applied to the exit pick): distance
  // alone let a straight boulevard be the exit path — on spine/great-hall
  // floors the trek was long but geometrically trivial, and widenMainArtery
  // then paved that straight shot into a highway. Sample K candidates from the
  // far band and keep the WINDIEST route: score = directness − bend rate,
  // where directness = straight-line/path-length (1.0 = dead-straight shot)
  // and bends are direction changes along the traced artery. The far-band
  // distance guarantee and the per-floor variety both survive — we only bias
  // WHICH far tile wins toward the one whose route actually snakes.
  const stairs = pickWindingStairs(g, start, far, dist, rng) ?? start;
  return { start, stairs };
}

/** Far-band candidates sampled per exit pick — enough to dodge the straight
 *  shot without flattening the variety of a random draw. */
const STAIRS_SAMPLES = 6;

function pickWindingStairs(g: Grid, start: TilePos, far: TilePos[], dist: Int32Array, rng: () => number): TilePos | null {
  if (!far.length) return null;
  let best: TilePos | null = null;
  let bestScore = Infinity;
  for (let k = 0; k < Math.min(STAIRS_SAMPLES, far.length); k++) {
    const cand = far[Math.floor(rng() * far.length)];
    const pathLen = dist[idx(g, cand.i, cand.j)];
    if (pathLen <= 0) continue;
    const directness = Math.hypot(cand.i - start.i, cand.j - start.j) / pathLen;
    const path = traceArtery(g, start, cand, dist);
    let turns = 0;
    for (let t = 2; t < path.length; t++) {
      const ai = path[t - 1].i - path[t - 2].i;
      const aj = path[t - 1].j - path[t - 2].j;
      const bi = path[t].i - path[t - 1].i;
      const bj = path[t].j - path[t - 1].j;
      if (ai !== bi || aj !== bj) turns++;
    }
    const score = directness - turns / pathLen; // lower = windier AND bendier
    if (score < bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

/**
 * How close to the farthest reachable tile the stairs must be, as a fraction of
 * the floor's max BFS distance. High enough that the exit is still a genuine
 * trek from the spawn; loose enough that there are many candidates to choose
 * between, which is what breaks the always-the-same-corner determinism.
 */
const FAR_BAND = 0.82;

/**
 * CORRIDOR-WIDEN (the "launch highway" — kills the uniform 2-wide box-maze
 * feel). Trace the main artery from the stairs back to the start along the BFS
 * gradient and widen it to 3 tiles by carving ONE perpendicular wall neighbour
 * per path tile. Carving wall→floor only ever ADDS connectivity, so
 * reachability is preserved by construction. Mutates the grid in place; the
 * caller reruns its floor scan + distances afterwards.
 *
 * `ends` MUST be the same endpoints decorateMaze is given, or the floor gets a
 * widened highway to somewhere that isn't the exit.
 */
export function widenMainArtery(g: Grid, ends: Endpoints): void {
  const dist = bfsDistancesOwned(g, ends.start.i, ends.start.j); // held across later BFS calls
  if (dist[idx(g, ends.stairs.i, ends.stairs.j)] <= 6) return; // too small to bother
  widenArtery(g, ends.start, ends.stairs, dist);
}

function widenArtery(g: Grid, start: TilePos, stairs: TilePos, dist: Int32Array): void {
  const path = traceArtery(g, start, stairs, dist);
  if (!path.length) return;
  // Widen each artery tile: carve one perpendicular wall neighbour (never the
  // border). Perp is relative to the local travel direction along the path.
  for (let k = 0; k < path.length; k++) {
    const a = path[k];
    const b = path[Math.min(path.length - 1, k + 1)];
    const di = Math.sign(b.i - a.i);
    const dj = Math.sign(b.j - a.j);
    // Perpendicular candidates (both sides); carve the first that is an interior
    // wall so the corridor fattens toward open space.
    const perps: Array<[number, number]> = dj !== 0 || di !== 0 ? [[-dj, di], [dj, -di]] : [[1, 0], [-1, 0]];
    for (const [pi, pj] of perps) {
      const wi = a.i + pi;
      const wj = a.j + pj;
      if (wi <= 0 || wj <= 0 || wi >= g.w - 1 || wj >= g.h - 1) continue; // keep the border solid
      if (at(g, wi, wj) === T_WALL) {
        setTile(g, wi, wj, T_FLOOR);
        break;
      }
    }
  }
}

/** dist-from-start at a tile, or -1 out of bounds (the flow-field lookup). */
function distAt(g: Grid, dist: Int32Array, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return -1;
  return dist[idx(g, i, j)];
}

/** Count consecutive open tiles stepping (di,dj) from (i,j), capped.
 *
 *  @see openRunway — this was the third copy of those eight lines (decorate's,
 *  flow-loops', and flow-orient's own `flowDrop` walking the same ray). Note it
 *  now counts the STAIRS tile as runway, which it did not before: a lane that
 *  ends at the exit is the one lane a shove is most entitled to reach, and the
 *  old reading called it a wall. Can only lengthen a runway, so it can only
 *  turn a repair off, never on. */
function launchRunway(g: Grid, i: number, j: number, di: number, dj: number): number {
  return openRunway(g, i, j, di, dj, 8);
}

const BAND_OFFSETS = [[0, 0], [1, 0], [0, 1], [1, 1]] as const;
const CARDINALS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * A1 — LAUNCH-TARGET INVARIANT. A launch part (ramp/booster/spring/…) must NEVER
 * fire into an unbreakable wall a tile or two away — a boost that just splats on
 * dead rock is the "boring" case (and the exact bug the screenshot caught). We
 * GUARANTEE, for every launch part, that its fire direction either has real open
 * runway (≥ MIN_RUNWAY floor tiles) or terminates at a BREAKABLE (cracked) wall.
 *
 * For each part whose runway is too short and ends at a solid wall, in order:
 *   1) CRACK the terminal — stamp an even-aligned 2×2 T_CRACKED band (matching
 *      crackSecretWalls, so the secrets scan + smashSecretAt own it) IF a real
 *      corridor sits just beyond. The boost now BREAKS THROUGH into new space.
 *   2) RE-AIM — flip the part to a cardinal with genuine runway (≥ MIN_RUNWAY).
 *   3) RE-AIM + CRACK — a cardinal whose near wall we CAN crack.
 *   4) REMOVE — an orphan boxed in on every side is deleted rather than left
 *      firing into rock.
 * Parts that already have runway also get an opportunistic terminal crack (the
 * A1 payoff — a lane that punches through) while budget lasts. Bands never sit
 * over a torch/target/vent wall, stay off the shell, and keep spaced. Mutates
 * g AND parts (re-aim + splice); returns the number of bands opened.
 */
export function openLaunchTargets(g: Grid, parts: PinballPartSpot[], torches: Torch[], rng: () => number, budget = 6): number {
  // Wall tiles carrying furniture — cracking one would float a sconce/target/jet.
  const occupied = new Set<number>();
  for (const t of torches) occupied.add(idx(g, t.i + t.di, t.j + t.dj));
  for (const p of parts) {
    if (p.kind === "target") occupied.add(idx(g, p.i + p.dirI, p.j + p.dirJ));
    if (p.kind === "firevent") occupied.add(idx(g, p.i - p.dirI, p.j - p.dirJ)); // vent mounts on -dir wall
  }
  const bands: TilePos[] = [];
  for (let j = 0; j < g.h - 1; j += 2) {
    for (let i = 0; i < g.w - 1; i += 2) {
      if (at(g, i, j) === T_CRACKED) bands.push({ i, j });
    }
  }
  let opened = 0;

  /** Floor-run length stepping (di,dj) from (i,j), capped at 6 — the fourth copy
   *  of the same eight lines, now delegating. The cap stays 6 rather than
   *  openRunway's default 8 because this pass only ever compares against
   *  MIN_RUNWAY (3) and walking further is wasted work on every part on the
   *  floor. Counts the stairs tile, matching `firstWall` below, which has always
   *  treated T_STAIRS as "the lane opens" rather than as a wall. */
  const runway = (i: number, j: number, di: number, dj: number): number => openRunway(g, i, j, di, dj, 6);
  /** First WALL tile within 6 stepping (di,dj); null if it opens (floor/stairs/crack). */
  const firstWall = (i: number, j: number, di: number, dj: number): TilePos | null => {
    for (let s = 1; s <= 6; s++) {
      const t = at(g, i + di * s, j + dj * s);
      if (t === T_FLOOR || t === T_STAIRS) continue;
      return t === T_WALL ? { i: i + di * s, j: j + dj * s } : null; // cracked/edge → opens
    }
    return null;
  };
  /** Crack the even-aligned 2×2 band covering wall (wi,wj) if a corridor sits beyond it.
   * `forced` (the safety fixes) ignores the payoff budget — the invariant must hold
   * regardless — but a hard cap still bounds pathological swiss-cheese. */
  const HARD_CAP = 28;
  const tryCrack = (wi: number, wj: number, di: number, dj: number, forced = false): boolean => {
    if (opened >= (forced ? HARD_CAP : budget)) return false;
    const bi = wi & ~1;
    const bj = wj & ~1;
    if (bi < 2 || bj < 2 || bi + 1 > g.w - 3 || bj + 1 > g.h - 3) return false; // keep the shell
    for (const [ddi, ddj] of BAND_OFFSETS) {
      if (at(g, bi + ddi, bj + ddj) !== T_WALL || occupied.has(idx(g, bi + ddi, bj + ddj))) return false;
      // ── NEVER CRACK A CURVED WALL ────────────────────────────────────────
      //
      // A tile carrying SHAPE_ARC is part of a swept feature, and cracking it
      // is how a curved wall becomes a curved wall with a hole in it — the same
      // reason `repairKeepOut` steers the geometry layer's repairs around
      // published arc faces. Worse than cosmetic: `tilesPer` in the piece gate
      // counts a feature's tiles as T_WALL, so a crack silently strips the
      // feature below MIN_ARC_TILES while `arcSweepGeometry` goes on drawing
      // its full span from the descriptor — an arc band owning two tiles and
      // rendering a whole quarter-circle.
      //
      // Invisible until the piece gate was pointed at a DECORATED floor: the
      // geometry sweep never sees it because the cracking happens in decorate,
      // two layers later. 2 floors in 30.
      if (shapeAt(g, bi + ddi, bj + ddj) === SHAPE_ARC) return false;
    }
    let far = false;
    if (di > 0) far = at(g, bi + 2, bj) === T_FLOOR || at(g, bi + 2, bj + 1) === T_FLOOR;
    else if (di < 0) far = at(g, bi - 1, bj) === T_FLOOR || at(g, bi - 1, bj + 1) === T_FLOOR;
    else if (dj > 0) far = at(g, bi, bj + 2) === T_FLOOR || at(g, bi + 1, bj + 2) === T_FLOOR;
    else far = at(g, bi, bj - 1) === T_FLOOR || at(g, bi + 1, bj - 1) === T_FLOOR;
    if (!far) return false;
    if (bands.some((b) => Math.abs(b.i - bi) + Math.abs(b.j - bj) < 4)) return false; // stay spaced
    for (const [ddi, ddj] of BAND_OFFSETS) setTile(g, bi + ddi, bj + ddj, T_CRACKED);
    bands.push({ i: bi, j: bj });
    opened++;
    return true;
  };

  // Fix the offenders FIRST (short runway ending at a wall) so they win the crack
  // budget, then do the payoff cracks for the healthy ones. Two ordered passes.
  // Circuit and machine parts join the spine in the exemption, for the same
  // reason it has one: a booster that feeds the corner two tiles ahead is
  // SUPPOSED to have a wall beyond it — the turn is the point, and "re-aim it
  // at the longest runway" would straighten exactly the twists the loop is made
  // of. The exemption is from the AESTHETIC repair only; `breakLaunchDuels` and
  // `breakFlowLoops` still see these parts, because those two guard a soft-lock.
  const launch = shuffled(
    parts.filter(
      (p) =>
        !p.vault &&
        !p.spine &&
        p.circuit === undefined &&
        p.asm === undefined &&
        LAUNCH_KINDS.has(p.kind) &&
        Math.abs(p.dirI) + Math.abs(p.dirJ) === 1,
    ),
    rng,
  );
  const remove = new Set<PinballPartSpot>();
  for (const p of launch) {
    if (runway(p.i, p.j, p.dirI, p.dirJ) >= MIN_RUNWAY) continue; // healthy — handled in pass 2
    const w = firstWall(p.i, p.j, p.dirI, p.dirJ);
    if (!w) continue; // short but it opens (a crack/edge already, no dead wall)
    if (tryCrack(w.i, w.j, p.dirI, p.dirJ, true)) continue; // 1) break through (forced — invariant)
    // 2) re-aim to a cardinal with genuine runway
    let best: readonly [number, number] | null = null;
    let bestLen = MIN_RUNWAY - 1;
    for (const [di, dj] of CARDINALS) {
      if (di === p.dirI && dj === p.dirJ) continue;
      const len = runway(p.i, p.j, di, dj);
      if (len > bestLen) {
        bestLen = len;
        best = [di, dj];
      }
    }
    if (best) {
      p.dirI = best[0];
      p.dirJ = best[1];
      continue;
    }
    // 3) re-aim to a cardinal whose near wall we can crack
    let fixed = false;
    for (const [di, dj] of CARDINALS) {
      if (di === p.dirI && dj === p.dirJ) continue;
      if (at(g, p.i + di, p.j + dj) !== T_FLOOR) continue;
      const w2 = firstWall(p.i, p.j, di, dj);
      if (w2 && tryCrack(w2.i, w2.j, di, dj, true)) {
        p.dirI = di;
        p.dirJ = dj;
        fixed = true;
        break;
      }
    }
    if (fixed) continue;
    // 4) boxed in on every side — delete the orphan rather than boost into rock
    remove.add(p);
  }
  // Pass 2: opportunistic terminal crack for healthy launches (the A1 payoff).
  for (const p of launch) {
    if (remove.has(p) || opened >= budget) continue;
    if (runway(p.i, p.j, p.dirI, p.dirJ) < MIN_RUNWAY) continue;
    const w = firstWall(p.i, p.j, p.dirI, p.dirJ);
    if (w) tryCrack(w.i, w.j, p.dirI, p.dirJ);
  }
  if (remove.size) {
    for (let k = parts.length - 1; k >= 0; k--) if (remove.has(parts[k])) parts.splice(k, 1);
  }
  return opened;
}

// ── LAUNCH DUELS — two launchers aimed down the same open lane at each other ──
//
// The failure this kills: a ramp firing east and a booster firing west, sitting
// on the same row with clear floor between them. Each one catches the knight and
// throws him straight back into the other. Part cooldowns are short (a booster's
// is 0.18s) and nothing else damps it, so the ball ping-pongs until the player
// steers out — which he cannot, because a launch part also stamps a steer lock.
//
// Placement can't see this coming: a part's facing is decided from LOCAL
// topology (`classify`) and re-aimed twice more afterwards (openLaunchTargets,
// then the post-sweep runway pass), so two parts that were individually sane can
// end up pointed at each other. That is why this runs LAST, over final facings.

/** How far apart two launchers can still duel (tiles). Beyond this, friction
 *  bleeds enough speed between them that the loop decays on its own. */
const DUEL_RANGE = 12;

/**
 * Is `b` in front of `a`, on `a`'s fire axis, with nothing but floor between?
 *
 * The general test is the dot-product pair from the design note — facings
 * anti-parallel (`a.dir · b.dir ≤ -0.85`) AND `b` ahead of `a`
 * (`a.dir · normalize(b.pos − a.pos) ≥ 0.7`). On this grid every launch facing
 * is a UNIT CARDINAL, so those collapse to exact integer tests, which is what is
 * written here: cheaper, and no threshold to tune. Note the second condition is
 * symmetric once the first holds — if a fires at b and their facings oppose,
 * then b necessarily fires at a — so only one direction needs checking.
 *
 * The clear-floor walk is the part the design note omits and the part that
 * matters most: two opposed launchers with a WALL between them are not a duel,
 * they are two ordinary launchers, and "fixing" them would churn good floors.
 */
function firesAt(g: Grid, a: PinballPartSpot, b: PinballPartSpot, all: readonly PinballPartSpot[] = []): boolean {
  if (a.dirI !== -b.dirI || a.dirJ !== -b.dirJ) return false; // facings must oppose
  const di = a.dirI;
  const dj = a.dirJ;
  // Same fire axis, and b on the side a is actually pointing.
  const along = di !== 0 ? (b.i - a.i) * di : (b.j - a.j) * dj;
  const across = di !== 0 ? b.j - a.j : b.i - a.i;
  if (across !== 0 || along <= 0 || along > DUEL_RANGE) return false;
  for (let s = 1; s < along; s++) {
    if (at(g, a.i + di * s, a.j + dj * s) !== T_FLOOR) return false; // walled off — harmless
  }
  // ── INTERCEPTED LANES ARE NOT DUELS ─────────────────────────────────────
  //
  // A wall between two opposed launchers already disqualifies the pair; so does
  // another LAUNCHER between them, for the same reason and with the same force.
  // The ping-pong needs the ball to travel from one to the other and back, and a
  // launcher in the middle sets a fresh heading — the ball never completes the
  // round trip.
  //
  // This is not hypothetical tidying. Once routes are laid on Φ, two roads
  // CONVERGING on the same corridor from opposite ends is a normal, legible
  // shape: both are downhill, they meet at a local minimum, and the part at that
  // minimum turns the ball out of the lane. Observed on the very first floor
  // that exercised it — boosters at (15,15)+j and (15,27)−j either side of a
  // corner booster at (15,22), Φ 60 → 53 ← 58. Without this clause the pass
  // would "repair" a merge junction by re-aiming one arm back up its own road,
  // manufacturing the defect it exists to remove.
  for (const q of all) {
    if (q === a || q === b) continue;
    if (!LAUNCH_KINDS.has(q.kind) && q.kind !== "boostcorner" && q.kind !== "boostcurve") continue;
    const qa = di !== 0 ? (q.i - a.i) * di : (q.j - a.j) * dj;
    const qc = di !== 0 ? q.j - a.j : q.i - a.i;
    if (qc === 0 && qa > 0 && qa < along) return false; // something catches the ball first
  }
  return true;
}

/** Can this part be re-aimed / demoted at all? A VAULT ramp fires into rock on
 *  purpose (that IS the feature), so it can never be one half of a duel. */
function duelEligible(p: PinballPartSpot): boolean {
  return !p.vault && LAUNCH_KINDS.has(p.kind) && Math.abs(p.dirI) + Math.abs(p.dirJ) === 1;
}

/**
 * Break every launch duel on the floor. Runs at the very end of decorateMaze,
 * after the last pass that can change a facing.
 *
 * Resolution, cheapest first — the goal is to keep the machine's furniture, so
 * deleting a part is the last resort:
 *   1) RE-AIM one of the pair to any other cardinal with real runway that does
 *      not immediately start a fresh duel. Note that simply REVERSING a part is
 *      a legitimate fix and often the best one in a 1-wide corridor: a duel
 *      needs ANTI-PARALLEL facings, so flipping one makes the pair PARALLEL,
 *      which is a chain — the good thing — rather than a standing wave.
 *   2) DEMOTE to a bumper, but only where a bumper belongs. Parts are placed to
 *      match tile topology (see KIND_TOPOLOGY) and a bumper's topology is a
 *      JUNCTION, so dropping one onto a corridor tile would break that
 *      invariant — decorate.test.ts asserts it.
 *   3) REMOVE the part, the same last resort openLaunchTargets uses for an
 *      orphan it cannot aim anywhere.
 *
 * Which of the pair yields: the one that is cheapest to change. A CHAIN part was
 * placed because another part's exit ray lands on it, so it yields only if its
 * opponent has no way out. A SPINE part NEVER yields — it is one link of the
 * connected booster route down the main artery, and that route carries its own
 * invariant (every pad points down-flow toward the stairs, pinned by
 * decorate.test.ts). Re-aiming one to escape a duel silently points it backward
 * and breaks the route, which is a worse bug than the duel. A spine-vs-spine
 * duel is therefore left alone here and caught at runtime by the pocket-rattle
 * guard instead; the spine builder owns preventing it.
 *
 * Mutates `parts`; returns the number of duels resolved. Pure (no three/DOM).
 */
export function breakLaunchDuels(g: Grid, parts: PinballPartSpot[]): number {
  const yieldCost = (p: PinballPartSpot): number =>
    (p.spine ? 3 : 0) + (p.circuit !== undefined ? 2 : 0) + (p.chain ? 1 : 0);
  const openSides = (i: number, j: number): number => CARDINALS.filter(([di, dj]) => at(g, i + di, j + dj) === T_FLOOR).length;
  let fixed = 0;

  // Re-aiming can create a fresh duel with a third part, so iterate to a fixed
  // point. Each round fixes at most one pair; a pair nobody may move (spine vs
  // spine) is skipped rather than retried, or the loop would spin on it.
  for (let round = 0; round < 8; round++) {
    const live = parts.filter(duelEligible);
    let duel: [PinballPartSpot, PinballPartSpot] | null = null;
    outer: for (let x = 0; x < live.length; x++) {
      for (let y = x + 1; y < live.length; y++) {
        if (!firesAt(g, live[x], live[y], parts)) continue;
        if (live[x].spine && live[y].spine) continue; // neither may move — the runtime guard owns this one
        duel = [live[x], live[y]];
        break outer;
      }
    }
    if (!duel) break;

    // Try the cheaper part first; fall back to its opponent if it is boxed in.
    // A spine link is never a candidate at all.
    const order = (yieldCost(duel[0]) <= yieldCost(duel[1]) ? [duel[0], duel[1]] : [duel[1], duel[0]]).filter((p) => !p.spine);
    let resolved = false;
    for (const p of order) {
      const foe = p === duel[0] ? duel[1] : duel[0];
      let best: readonly [number, number] | null = null;
      let bestRun = MIN_RUNWAY - 1;
      for (const [di, dj] of CARDINALS) {
        if (di === p.dirI && dj === p.dirJ) continue; // the shot we're replacing
        const run = launchRunway(g, p.i, p.j, di, dj);
        if (run <= bestRun) continue;
        // Don't trade this duel for another one.
        const probe = { ...p, dirI: di, dirJ: dj };
        if (live.some((q) => q !== p && q !== foe && (firesAt(g, probe, q, parts) || firesAt(g, q, probe, parts)))) continue;
        bestRun = run;
        best = [di, dj];
      }
      if (best) {
        p.dirI = best[0];
        p.dirJ = best[1];
        resolved = true;
        break;
      }
    }
    if (!resolved && order.length > 0) {
      // Nowhere to point either of them. Demote the cheaper one if its tile is
      // somewhere a bumper legitimately lives (a junction); otherwise take the
      // part out rather than leave a launcher in a standing wave.
      const p = order[0];
      if (openSides(p.i, p.j) >= 3 || p.circuit !== undefined) {
        p.kind = "bumper";
        p.dirI = 0;
        p.dirJ = 0;
        p.dir2I = 0;
        p.dir2J = 0;
      } else {
        const k = parts.indexOf(p);
        if (k >= 0) parts.splice(k, 1);
      }
    }
    fixed++;
  }
  return fixed;
}

/** Which topology pool each dealable part kind draws from. */
const KIND_TOPOLOGY: Record<string, Topology> = {
  bumper: "junction",
  spinpad: "junction",
  flipper: "junction",
  ramp: "straight",
  booster: "straight",
  oil: "straight",
  slingshot: "straight",
  glove: "straight",
  spring: "deadend",
  deflector: "corner",
  mirror: "corner",
  maw: "junction",
};

/** Turn a topology candidate into a concrete part spot of the dealt kind. */
function spotForKind(kind: PartSpotKind, c: TopoSpot, rng: () => number): PinballPartSpot {
  if (kind === "glove" || kind === "firevent") {
    // Mounts on one of the corridor's side walls and fires/swings ACROSS it
    const side = rng() < 0.5 ? 1 : -1;
    return { i: c.i, j: c.j, kind, dirI: -c.dirJ * side, dirJ: c.dirI * side, dir2I: 0, dir2J: 0 };
  }
  if ((kind === "flipper" || kind === "maw") && c.topo === "junction") {
    // Aim down any open leg
    const legs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const d = legs[Math.floor(rng() * legs.length)];
    return { i: c.i, j: c.j, kind, dirI: d[0], dirJ: d[1], dir2I: 0, dir2J: 0 };
  }
  if (kind === "mirror" && c.topo === "corner") {
    // Surface line = the corner's diagonal (sum of the two open legs), so the
    // mirror banks a cardinal run into the perpendicular one. Stored unnormalized;
    // the physics normalises the reflection normal.
    return { i: c.i, j: c.j, kind, dirI: c.dirI + c.dir2I, dirJ: c.dirJ + c.dir2J, dir2I: 0, dir2J: 0 };
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
  g: Grid,
  phi: Int32Array,
  forceVault = false,
  onSpine: (i: number, j: number) => boolean = () => false,
): { rooms: PlannedRoom[]; spawns: TilePos[]; items: ItemDrop[]; parts: PinballPartSpot[] } {
  const planned: PlannedRoom[] = [];
  const spawns: TilePos[] = [];
  const items: ItemDrop[] = [];
  const parts: PinballPartSpot[] = [];
  // A ROOM'S RECT IS NOT ITS FLOOR (Plaza A-1).
  //
  // Every archetype below indexes off `room.i0/j0/w/h` with a one-tile wall
  // margin, which is exact for the legacy branch's `carveRooms` rects — the
  // whole rect is carved, so an edge inset by 1 is always floor. It is NOT
  // exact for a track floor's chambers, which are DISCS reported as their
  // bounding square: ~21% of that square is rock, concentrated in precisely
  // the corners the arena/vault guards and the orbit rails aim at. Unclipped,
  // a plaza would ship about a fifth of its furniture inside a wall — parts
  // you cannot hit, guards you cannot fight, rails that break their own orbit.
  //
  // Clipping here rather than at each of the eleven emission sites is what
  // makes this safe to extend: a future archetype inherits the guard by
  // construction. On the legacy branch every tile it rejects was already a bug.
  const onFloor = (i: number, j: number): boolean =>
    i >= 0 && j >= 0 && i < g.w && j < g.h && at(g, i, j) === T_FLOOR;
  let orbitNext = 0; // D2 — circuit ids, one per room that gets a full ring of rails
  // Slice 9 — THREE-ZONE floors: a room's archetype is chosen by how far it sits
  // from the start (the stairs live at the far end), so a floor reads as a loop:
  //   LAUNCH district (near start)  → speedway ramp lanes to build speed
  //   MACHINE core   (the middle)   → bumper arenas to bounce + rack combo
  //   DRAIN lane     (far, by stairs)→ arena/vault: the fight + the reward
  // Corridor width/friction/enemy-density gradients already ride distance (Slices
  // 2/4 + BFS spawn weighting), so this ties the spatial pacing together.
  const roomDist = rooms.map((r) => Math.abs(r.i0 + Math.floor(r.w / 2) - start.i) + Math.abs(r.j0 + Math.floor(r.h / 2) - start.j));
  // ONE ROOM CANNOT BE NORMALISED AGAINST ITSELF.
  //
  // `maxDist` is the observed maximum, so the farthest room always scores
  // frac = 1 — deliberate on the legacy branch, where the stairs sit at the far
  // end and the last room should read as the drain lane. With a SINGLE room it
  // degenerates: the sole room is trivially the farthest, so frac is 1 whatever
  // its actual position and the ladder below can only ever return arena or
  // vault. A track floor's Great Hall is one room, and it is carved at the
  // graph hub nearest the floor's centre — the machine core, not the drain —
  // so the degenerate rule labelled the floor's centrepiece a loot closet on
  // every greathall floor the probe sampled (18/18, all arena or vault).
  //
  // Normalising a lone room against the floor's own span restores the intent:
  // a central chamber scores mid-band and gets the bumper field
  // PLAZA_PLAN's whole complaint asks for ("the plaza gets texture, not
  // machines"), while a chamber that genuinely sits out by the stairs still
  // scores high and still becomes an arena.
  //
  // Multi-room floors keep the old denominator exactly, so the legacy branch
  // is untouched.
  const maxDist = rooms.length > 1 ? Math.max(1, ...roomDist) : Math.max(1, Math.floor((g.w + g.h) / 2));
  // A bonus floor earns a GUARANTEED vault: the last-carved room (the +1 the
  // grade unlocked in core.ts) is dealt vault outright, bypassing the doorstep
  // demotion so the reward always actually shows up.
  const vaultRoom = forceVault && rooms.length ? rooms.length - 1 : -1;

  rooms.forEach((room, k) => {
    const frac = roomDist[k] / maxDist; // 0 = on the doorstep, 1 = by the stairs
    let kind: RoomArchetype = frac < 0.34 ? "speedway" : frac < 0.68 ? "bumper" : rng() < 0.5 ? "arena" : "vault";
    const cx = room.i0 + Math.floor(room.w / 2);
    const cy = room.j0 + Math.floor(room.h / 2);
    // A fight/loot room on the doorstep would make level entry a coin flip.
    if ((kind === "arena" || kind === "vault") && Math.abs(cx - start.i) + Math.abs(cy - start.j) < 10) {
      kind = "bumper";
    }
    if (k === vaultRoom) kind = "vault"; // the guaranteed bonus vault
    planned.push({ ...room, kind });

    const part = (p: Omit<PinballPartSpot, "dir2I" | "dir2J">): void => {
      if (!onFloor(p.i, p.j)) return; // rect corner over rock — see onFloor
      parts.push({ dir2I: 0, dir2J: 0, ...p });
    };

    const clearAt = (i: number, j: number): boolean => !parts.some((q) => q.i === i && q.j === j);

    if (kind === "bumper") {
      // A staggered field of pop bumpers to carom THROUGH on the way past. The
      // spine lane is left CLEAR so the booster route runs straight through the
      // middle, flanked by bumpers — the room becomes a station ON the path
      // rather than a wall of pins you wander into and stall in.
      //
      // SPACING SCALES WITH THE ROOM, because the COUNT otherwise scales with
      // its AREA (Plaza A-1). At a fixed STEP = 3 this stamps one bumper per 9
      // tiles: about 9 in a legacy 10x10 room, and 138 to 711 in a Great Hall
      // plaza, which run 37x37 to 86x86. Measured across 90 floors, that put
      // every greathall floor at 48-63 parts per 1k walkable against
      // `DEFAULT_DENSITY.maxPartsPer1k: 34` — 1.4x to 1.9x over, on every
      // floor the plaza touches.
      //
      // The additive-budget note in PLAZA_PLAN A-1 does NOT cover this, and is
      // backwards: `corridorBudget = partBudget + parts.length - circuitPartCount`
      // (:2471) is the count at which corridor filling STOPS, and room parts are
      // already in `parts.length` when it is computed — so the corridor still
      // gets its full `partBudget` and room parts are pure addition on top.
      // Circuits are debited (they subtract); rooms never were. Harmless while
      // rooms were small; not harmless at plaza scale.
      //
      // So an oversized room gets a spacing derived from a DENSITY target
      // instead of the fixed 1-per-9-tiles, and every room the legacy branch
      // can produce keeps STEP = 3 exactly — bit-identical, no regression risk
      // on `floor-pipeline.test.ts`, which exercises that branch and only that
      // branch.
      //
      // The threshold is derived, not chosen: `carveRooms` is called with
      // ROOM_MAX_CELLS = 6 (constants/maze.ts:65) and sizes a room
      // `cw * 2 - 1` = 11 raw tiles, which `floor-authoring.ts:251` doubles
      // onto the thickened grid — so 22 final tiles is the widest room that
      // branch has ever been able to author. Anything wider is a chamber.
      const LEGACY_MAX_SPAN = 24;
      const PLAZA_BUMPER_PER_1K = 10; // 1 per 100 tiles: machines in a hall, not a carpet
      const oversized = room.w >= LEGACY_MAX_SPAN || room.h >= LEGACY_MAX_SPAN;
      const STEP = oversized ? Math.max(5, Math.round(Math.sqrt(1000 / PLAZA_BUMPER_PER_1K))) : 3;
      const m = 1; // margin from the walls
      let row = 0;
      for (let gy = room.j0 + m; gy <= room.j0 + room.h - 1 - m; gy += STEP, row++) {
        const stag = row % 2 ? Math.floor(STEP / 2) : 0;
        for (let gx = room.i0 + m + stag; gx <= room.i0 + room.w - 1 - m; gx += STEP) {
          if (!clearAt(gx, gy)) continue;
          if (onSpine(gx, gy)) continue; // keep the booster route's lane open
          // the four inner corners are reserved for the curved rails below
          const atCorner = (gx === room.i0 + 1 || gx === room.i0 + room.w - 2) && (gy === room.j0 + 1 || gy === room.j0 + room.h - 2);
          if (atCorner && room.w >= 6 && room.h >= 6) continue;
          part({ kind: "bumper", i: gx, j: gy, dirI: 0, dirJ: 0 });
        }
      }
    } else if (kind === "speedway") {
      // ONE accelerating lane down the long axis (ramp → booster → ramp, aimed
      // down-flow) — a spine SEGMENT, not a stack of 2-3 parallel banks. The room
      // reads as a stretch of the highway you blast through, wired into the route.
      const alongW = room.w >= room.h;
      // PATH-FIRST: aim the whole lane DOWN-FLOW (toward the exit), not a coin
      // flip — a speedway that launches you back at the door is the "speed up
      // that sends you back" bug at room scale. Compare dist-from-start at the
      // two ends of the long axis; a small kickback chance keeps some variety.
      // On Φ: the lane runs toward the LOWER distance-to-stairs end, so a
      // speedway is a stretch of the same one-way system as every other route
      // rather than a room-local decision that can contradict the corridor it
      // opens onto.
      const midShort = alongW ? room.j0 + Math.floor(room.h / 2) : room.i0 + Math.floor(room.w / 2);
      const dLo = alongW ? phiAt(g, phi, room.i0 + 1, midShort) : phiAt(g, phi, midShort, room.j0 + 1);
      const dHi = alongW ? phiAt(g, phi, room.i0 + room.w - 2, midShort) : phiAt(g, phi, midShort, room.j0 + room.h - 2);
      let sign = dHi <= dLo ? 1 : -1;
      if (rng() < KICKBACK_CHANCE) sign = -sign;
      const longLen = alongW ? room.w : room.h;
      const shortLen = alongW ? room.h : room.w;
      // Put the single lane on the spine's cross-position if the spine crosses
      // the room (so it IS the highway); else down the room's centre line.
      const off = Math.floor(shortLen / 2);
      const nPer = Math.max(3, Math.floor(longLen / 3));
      for (let s = 0; s < nPer; s++) {
        const t = Math.round(1 + (s * (longLen - 3)) / Math.max(1, nPer - 1));
        const i = alongW ? room.i0 + t : room.i0 + off;
        const j = alongW ? room.j0 + off : room.j0 + t;
        if (!clearAt(i, j)) continue;
        if (onSpine(i, j)) continue; // the spine pass already lays boosters here
        const pk: PartSpotKind = s % 2 === 0 ? "ramp" : "booster";
        part({ kind: pk, i, j, dirI: alongW ? sign : 0, dirJ: alongW ? 0 : sign });
      }
    } else {
      // arena + vault share the corner geometry.
      const corners: TilePos[] = [
        { i: room.i0 + 1, j: room.j0 + 1 },
        { i: room.i0 + room.w - 2, j: room.j0 + room.h - 2 },
        { i: room.i0 + room.w - 2, j: room.j0 + 1 },
        { i: room.i0 + 1, j: room.j0 + room.h - 2 },
      ]
        .filter((c, idx2, arr) => arr.findIndex((o) => o.i === c.i && o.j === c.j) === idx2)
        // The corners are the disc's worst case: on a chamber all four are
        // rock. Filter BEFORE the arena/vault split so `slice(0, 2)` takes two
        // guards that exist rather than two slots that may not.
        .filter((c) => onFloor(c.i, c.j));
      // The centre of a disc is always floor, so the prize needs no guard —
      // but `cx - 1` on a radius-3 chamber is one tile from the rim, and the
      // legacy branch can hand a 2-wide room here too.
      const prizeAt = (drop: ItemDrop): void => {
        if (onFloor(drop.i, drop.j)) items.push(drop);
      };
      if (kind === "arena") {
        spawns.push(...corners);
        const prize = shuffled(["health", "gold", "rage", "haste", "shield"], rng)[0];
        prizeAt({ kind: "potion", id: prize, i: cx, j: cy });
      } else {
        spawns.push(...corners.slice(0, 2));
        prizeAt({ kind: "weapon", id: shuffled(WEAPON_POOL, rng)[0], i: cx, j: cy });
        if (room.w > 2) prizeAt({ kind: "potion", id: "gold", i: cx - 1, j: cy });
      }
      // Even the fight/reward rooms get pinball furniture on their wall midpoints
      // (bumpers) so a big arena/vault isn't a bare box — clear of the centre
      // prize and the corner guards.
      const mids: TilePos[] = [
        { i: cx, j: room.j0 + 1 },
        { i: cx, j: room.j0 + room.h - 2 },
        { i: room.i0 + 1, j: cy },
        { i: room.i0 + room.w - 2, j: cy },
      ];
      for (const md of mids) {
        if (!clearAt(md.i, md.j)) continue;
        if (Math.abs(md.i - cx) + Math.abs(md.j - cy) < 2) continue; // keep the prize clear
        if (spawns.some((s) => s.i === md.i && s.j === md.j)) continue;
        part({ kind: "bumper", i: md.i, j: md.j, dirI: 0, dirJ: 0 });
      }
    }

    // CURVED PLAYFIELD PERIMETER — the "not a box" read: a big OPEN room
    // (bumper/speedway) gets banked deflector rails in its four inner corners,
    // legs pointing inward along the two walls. A ball railing along one wall
    // banks around the corner and down the next, so the open room plays as a
    // rounded pinball table edge — visible curved lanes, not square walls. Only
    // for rooms with room to sweep, and never on top of an archetype part.
    if ((kind === "bumper" || kind === "speedway") && room.w >= 6 && room.h >= 6) {
      // D2 — these four rails are one ORBIT: a closed circuit. Railing them in
      // clockwise order completes a LAP, which the game scores as a loop shot.
      // Previously they were four unrelated point-triggers that happened to sit
      // in a ring, so a lap felt like nothing.
      const orbitId = orbitNext++;
      const rails: PinballPartSpot[] = [
        { i: room.i0 + 1, j: room.j0 + 1, kind: "deflector", dirI: 1, dirJ: 0, dir2I: 0, dir2J: 1, orbit: orbitId, orbitSeq: 0 }, // TL → E/S
        { i: room.i0 + room.w - 2, j: room.j0 + 1, kind: "deflector", dirI: -1, dirJ: 0, dir2I: 0, dir2J: 1, orbit: orbitId, orbitSeq: 1 }, // TR → W/S
        { i: room.i0 + room.w - 2, j: room.j0 + room.h - 2, kind: "deflector", dirI: -1, dirJ: 0, dir2I: 0, dir2J: -1, orbit: orbitId, orbitSeq: 2 }, // BR → W/N
        { i: room.i0 + 1, j: room.j0 + room.h - 2, kind: "deflector", dirI: 1, dirJ: 0, dir2I: 0, dir2J: -1, orbit: orbitId, orbitSeq: 3 }, // BL → E/N
      ];
      let placedRails = 0;
      for (const r of rails) {
        // These push DIRECTLY rather than through `part()`, so they need the
        // clip restating. A chamber's four rect corners are all rock, which is
        // the case that matters: `placedRails` then stays 0 and the block below
        // strips the tags, so a plaza gets no orbit rather than a broken one.
        if (!onFloor(r.i, r.j)) continue;
        if (parts.some((q) => q.i === r.i && q.j === r.j)) continue;
        parts.push(r);
        placedRails++;
      }
      // A partial ring isn't a circuit — strip the tags rather than ship an
      // orbit that can never be completed.
      if (placedRails < 4) {
        for (const q of parts) if (q.orbit === orbitId) { delete q.orbit; delete q.orbitSeq; }
      }
    }
  });

  return { rooms: planned, spawns, items, parts };
}

/**
 * Reshape wall corners into 45° SLANTS and quarter-round CURVES (tile-shape.ts):
 * the maze stops being all right angles. Rendered AND collided from the one
 * shape (build.ts + collision.ts). Two families of corner:
 *
 *  - CONVEX (a wall tip / pillar corner): a WALL tile with FLOOR on two adjacent
 *    cardinals + their shared diagonal, the other two cardinals solid.
 *  - CONCAVE (a room corner / wide bend): the SOLID DIAGONAL wall tile of an
 *    inner "crook" — detected with the SAME gate as collision.computeArcCorners
 *    (a ≥2×2 open pocket, so 1-wide dogleg turns are excluded → tight corridors
 *    stay square, the "rooms + wide bends only" rule). We cut the diagonal
 *    tile's corner that faces the open crook.
 *
 * Each candidate is SLANT or ROUND by a deterministic per-tile hash (mixed
 * patterns). Two passes so a reshape never strips its own backing: a shaped
 * tile is transparent to the square sweep (collision.blocksSquare), so its two
 * legs are held by backing-neighbour SQUARES — a corner is reshaped only when
 * BOTH backing neighbours stay full squares (not themselves candidates). Leaves
 * tiny 2×2 nubs square and never opens a leak.
 */
function assignCornerShapes(g: Grid): void {
  const cand = new Int8Array(g.w * g.h).fill(-1); // -1 = none, else the TileShape
  // Mix: ~3/4 of the corners CURVE, the rest bevel — deterministic by position.
  // (Was 50/50; playtest 07-23 read the maze as "still all boxes", so rounds
  // now dominate and the bevels are the accent.)
  const styled = (slant: TileShape, i: number, j: number): TileShape => ((i * 3 + j * 5) % 4 !== 1 ? slantToRound(slant) : slant);
  const put = (i: number, j: number, shape: TileShape): void => {
    // Skip tiles already claimed by a multi-tile arc sweep (shape ≠ FULL).
    if (i > 0 && j > 0 && i < g.w - 1 && j < g.h - 1 && at(g, i, j) === T_WALL && shapeAt(g, i, j) === SHAPE_FULL) cand[idx(g, i, j)] = shape;
  };

  // ── CONVEX corners (wall tips / pillars): shape the wall tile itself. ──
  for (let j = 1; j < g.h - 1; j++) {
    for (let i = 1; i < g.w - 1; i++) {
      if (at(g, i, j) !== T_WALL) continue;
      const N = isWalkable(g, i, j - 1);
      const S = isWalkable(g, i, j + 1);
      const E = isWalkable(g, i + 1, j);
      const W = isWalkable(g, i - 1, j);
      if (N && E && isWalkable(g, i + 1, j - 1) && !S && !W) put(i, j, styled(SHAPE_SLANT_NE, i, j));
      else if (N && W && isWalkable(g, i - 1, j - 1) && !S && !E) put(i, j, styled(SHAPE_SLANT_NW, i, j));
      else if (S && E && isWalkable(g, i + 1, j + 1) && !N && !W) put(i, j, styled(SHAPE_SLANT_SE, i, j));
      else if (S && W && isWalkable(g, i - 1, j + 1) && !N && !E) put(i, j, styled(SHAPE_SLANT_SW, i, j));
    }
  }

  // ── CONCAVE corners (room / wide-bend inner corners): shape the SOLID DIAGONAL
  // wall tile, cutting the corner that faces the open crook. Same gate as
  // computeArcCorners (far diagonal must be open) → 1-wide turns stay square. ──
  const floor = (i: number, j: number): boolean => isWalkable(g, i, j);
  const wall = (i: number, j: number): boolean => !isWalkable(g, i, j);
  // Per crook: two wall dirs, the solid diagonal, far diagonal, two open legs,
  // and the corner the diagonal tile cuts (facing the crook).
  const crooks = [
    { wa: [0, -1], wb: [1, 0], diag: [1, -1], opp: [-1, 1], l1: [-1, 0], l2: [0, 1], cut: SHAPE_SLANT_SW }, // NE crook → diag SW-cut
    { wa: [0, -1], wb: [-1, 0], diag: [-1, -1], opp: [1, 1], l1: [1, 0], l2: [0, 1], cut: SHAPE_SLANT_SE }, // NW → SE
    { wa: [0, 1], wb: [1, 0], diag: [1, 1], opp: [-1, -1], l1: [-1, 0], l2: [0, -1], cut: SHAPE_SLANT_NW }, // SE → NW
    { wa: [0, 1], wb: [-1, 0], diag: [-1, 1], opp: [1, -1], l1: [1, 0], l2: [0, -1], cut: SHAPE_SLANT_NE }, // SW → NE
  ] as const;
  for (let j = 1; j < g.h - 1; j++) {
    for (let i = 1; i < g.w - 1; i++) {
      if (!floor(i, j)) continue;
      for (const c of crooks) {
        if (
          wall(i + c.wa[0], j + c.wa[1]) &&
          wall(i + c.wb[0], j + c.wb[1]) &&
          wall(i + c.diag[0], j + c.diag[1]) &&
          floor(i + c.l1[0], j + c.l1[1]) &&
          floor(i + c.l2[0], j + c.l2[1])
        ) {
          const ti = i + c.diag[0];
          const tj = j + c.diag[1];
          put(ti, tj, styled(c.cut, ti, tj));
        }
      }
    }
  }

  // ── Pass 2: assign only where both backing legs stay solid FULL squares. ──
  const isCand = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < g.w && j < g.h && cand[idx(g, i, j)] >= 0;
  for (let j = 1; j < g.h - 1; j++) {
    for (let i = 1; i < g.w - 1; i++) {
      const shape = cand[idx(g, i, j)] as TileShape;
      if (shape < 0) continue;
      const back = shapeBacking(shape)!;
      const b0i = i + back[0].x;
      const b0j = j + back[0].z;
      const b1i = i + back[1].x;
      const b1j = j + back[1].z;
      if (isWalkable(g, b0i, b0j) || isWalkable(g, b1i, b1j)) continue; // leg not backed
      if (isCand(b0i, b0j) || isCand(b1i, b1j)) continue; // backing would itself reshape
      // An arc-sweep slice is sweep-transparent — it can't back a leg either.
      if (shapeAt(g, b0i, b0j) !== SHAPE_FULL || shapeAt(g, b1i, b1j) !== SHAPE_FULL) continue;
      setShape(g, i, j, shape);
    }
  }
}

/**
 * How far the route's smoothed heading may differ from the cardinal step under
 * a pad before the pad becomes a CURVED one. Expressed as |sin θ|, so 0.34 is
 * about 20° — below that the difference is not visible on an isometric tile and
 * a curved pad would only add noise.
 */
const TANGENT_SNAP = 0.34;
/** Tiles either side of a pad that the smoothed tangent averages over. Three is
 *  a full staircase step (over-under-over) without reaching into the next bend. */
const TANGENT_WINDOW = 3;

/**
 * The route's local heading at `k`, as a unit vector: the direction from the
 * tile `TANGENT_WINDOW` back to the tile `TANGENT_WINDOW` ahead.
 *
 * Falls back to the cardinal step when the window degenerates (near either end
 * of a route, or on a route that doubles back inside the window so the two
 * samples coincide) — a zero-length tangent would normalise to NaN and a NaN
 * heading is a part that pushes the player nowhere at all.
 */
function smoothTangent(route: TilePos[], k: number, di: number, dj: number): [number, number] {
  const a = route[Math.max(0, k - TANGENT_WINDOW)];
  const b = route[Math.min(route.length - 1, k + TANGENT_WINDOW)];
  const vx = b.i - a.i;
  const vz = b.j - a.j;
  const len = Math.hypot(vx, vz);
  if (len < 1e-6) return [di, dj];
  return [vx / len, vz / len];
}



/**
 * The cardinal a unit heading is nearest to.
 *
 * The Phi predicates are 4-connected on purpose (see flow-orient's header: the
 * parts fire on cardinals, so a diagonal-aware field would report gradients no
 * pad can follow), and a `boostcurve` carries a float tangent. This is the
 * adapter between the two. Ties go to the x axis deterministically — never rng,
 * because two co-op peers must snap the same pad the same way.
 */
function snapCardinal(tx: number, tz: number): readonly [number, number] {
  return Math.abs(tx) >= Math.abs(tz) ? [Math.sign(tx) || 1, 0] : [0, Math.sign(tz) || 1];
}

/**
 * Open tiles along a NON-cardinal ray, sampled at HALF-tile steps.
 *
 * Half-tile because a whole-tile step along a 45-degree ray can hop clean over
 * the corner of a wall tile and report a clear lane through solid rock — the ray
 * passes through the corner without ever landing in it. Sampling at 0.5 makes
 * every tile the ray crosses take at least one sample.
 */
function rayRunway(g: Grid, i: number, j: number, tx: number, tz: number, max: number): number {
  const ox = i + 0.5;
  const oz = j + 0.5;
  for (let s = 0.5; s <= max + 1e-9; s += 0.5) {
    const ti = Math.floor(ox + tx * s);
    const tj = Math.floor(oz + tz * s);
    if (at(g, ti, tj) !== T_FLOOR && at(g, ti, tj) !== T_STAIRS) return s - 0.5;
  }
  return max;
}

/**
 * ALTERNATE ROUTES — the other ways down the floor.
 *
 * The station pass used to furnish exactly one path: `traceArtery` from spawn
 * to stairs. That is a single set route, and live QA named it — the floor wants
 * "MOST of the tracks going one direction but multiple paths that are
 * possible", which a lone artery cannot be however well it is aimed.
 *
 * The grown circuit already HAS the alternatives (track-grow guarantees circuit
 * rank ≥ 2, i.e. at least two independent cycles), they were simply never
 * furnished. Finding them needs no new topology: take lane tiles that are FAR
 * from everything already routed, and descend Φ from each. Every descent
 * terminates at the exit, so each one is a genuine complete route — and because
 * they share the field, a junction where two routes meet has both arms pointing
 * the same way instead of one arm shoving you back up the other.
 *
 * Routes stop the moment they touch an existing one (`stop`): past the merge the
 * corridor is already furnished, and a second row of pads there would double-pad
 * one lane while leaving another bare.
 *
 * `seedGap` is the only tuning here: how far a candidate head must sit from
 * every routed tile. Too small and the "alternates" are ribs hanging off the
 * artery; large enough and they are separate roads.
 */
function alternateRoutes(
  g: Grid,
  phi: Int32Array,
  primary: TilePos[],
  start: TilePos,
  stairs: TilePos,
  rng: () => number,
  opts: { max?: number; seedGap?: number; minLen?: number } = {},
): TilePos[][] {
  const max = opts.max ?? ALT_ROUTES_MAX;
  const seedGap = opts.seedGap ?? ALT_ROUTE_GAP;
  const minLen = opts.minLen ?? ALT_ROUTE_MIN_LEN;
  const routed = new Set<number>(primary.map((p) => idx(g, p.i, p.j)));
  const out: TilePos[][] = [];
  // Candidate heads: walkable tiles ordered by Φ descending, so a route starts
  // as far from the exit as it can and therefore covers as much floor as it
  // can. Shuffled within the sweep so two floors with the same shape don't pick
  // identical heads; the descent itself stays rng-free.
  const heads: TilePos[] = [];
  for (let j = 1; j < g.h - 1; j++) {
    for (let i = 1; i < g.w - 1; i++) {
      if (!isWalkable(g, i, j)) continue;
      const v = phiAt(g, phi, i, j);
      if (v >= UNREACHED || v < minLen) continue;
      heads.push({ i, j });
    }
  }
  const pool = shuffled(heads, rng).sort((a, b) => phiAt(g, phi, b.i, b.j) - phiAt(g, phi, a.i, a.j));
  const farFromRouted = (p: TilePos): boolean => {
    for (let dj = -seedGap; dj <= seedGap; dj++) {
      for (let di = -seedGap; di <= seedGap; di++) {
        if (Math.abs(di) + Math.abs(dj) > seedGap) continue;
        const ni = p.i + di;
        const nj = p.j + dj;
        if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h) continue;
        if (routed.has(idx(g, ni, nj))) return false;
      }
    }
    return true;
  };
  for (const head of pool) {
    if (out.length >= max) break;
    if (head.i === start.i && head.j === start.j) continue;
    if (!farFromRouted(head)) continue;
    // ── RUN ON PAST THE MERGE, don't stop dead at it.
    //
    // Stopping at the first already-routed tile is the obvious rule and it
    // leaves every alternate road ending in mid-air: its last pad fires at a
    // bare tile of the road it just joined, so the knight is shoved onto the
    // highway and then coasts. Measured with the hard stop, 28.8% of route pads
    // had NO part anywhere along their fire ray — and widening the search from
    // 4 tiles to 12 recovered only 1.6 points of that, so it was a genuine
    // chain break rather than a pad just out of reach.
    //
    // Overlapping the last stretch fixes it at the cause: the tiles are already
    // furnished, `layStationSpine` skips taken tiles, and the joining road's
    // final pads now fire into the highway's existing pads. Which is what a
    // slip road is — you merge INTO traffic, you don't stop at the junction.
    let overlap = 0;
    const path = descend(g, phi, head, {
      stop: (p) => (routed.has(idx(g, p.i, p.j)) ? ++overlap > ALT_ROUTE_MERGE_RUN : false),
    });
    // A route that merges after three tiles is a rib, not a road. Measured on
    // the pre-merge length, so a road cannot qualify on its overlap alone.
    if (path.length - overlap < minLen) continue;
    for (const p of path) routed.add(idx(g, p.i, p.j));
    out.push(path);
  }
  void stairs; // the descent's sink by construction; named for the reader
  return out;
}

/**
 * LAY THE STATION SPINE — the connected booster route that makes a floor a
 * pinball table you TRAVERSE rather than a scatter of parts you wander past.
 *
 * The user's ask: "boosters feed into each other to make a path throughout the
 * map… when you get pushed it feeds into something else." This is that path.
 *
 * Walk the ordered artery `spine` (start→stairs — see traceArtery), and:
 *   - down each STRAIGHT RUN lay a row of booster pads aimed down-path, so the
 *     knight is railed forward from one station to the next;
 *   - at each BEND drop a `deflector` that banks the incoming run onto the
 *     outgoing one with speed intact — getting shoved carries you round the turn;
 *   - where the route crosses an open junction, a `bumper` to carom off so a
 *     crossing still hands you onward instead of dumping your momentum.
 *
 * Every part is `spine: true`: exempt from the anti-clustering spacing (like a
 * chain link) AND from the A1 runway repair (openLaunchTargets) — a pad that
 * feeds a bend is SUPPOSED to have the wall a tile or two ahead. It is its own
 * layer over the part budget; the corridor deal then fills the pockets that
 * branch OFF the spine, all of it spacing around these tiles.
 *
 * Mutates `parts`. No-op on a floor too small to trace an artery.
 */
function layStationSpine(
  g: Grid,
  phi: Int32Array,
  spine: TilePos[],
  start: TilePos,
  stairs: TilePos,
  parts: PinballPartSpot[],
  items: ItemDrop[],
  reserved: (i: number, j: number) => boolean = () => false,
  opts: { padStride?: number; budget?: number } = {},
): number {
  if (spine.length < 4) return 0;
  const padStride = opts.padStride ?? PAD_STRIDE;
  const budget = opts.budget ?? Infinity;
  let placed = 0;
  const CALM = 4; // keep the plunger launch zone at the mouth clear
  const takenTile = (i: number, j: number): boolean =>
    parts.some((q) => q.i === i && q.j === j) || items.some((it) => it.i === i && it.j === j);
  // `reserved` is the LAUNCH CHUTE, and it needs to be a hard exclusion rather
  // than the CALM radius doing the job. The artery is traced start→stairs and
  // start IS the chute's park tile, so the route runs the full length of the
  // chute — CALM clears four tiles of a twenty-tile hallway and the spine
  // furnishes the rest, aiming pads by the ARTERY's flow. Measured, that put
  // boosters firing across the lane, a deflector mid-chute, and pads in the
  // merge the chute pass deliberately leaves clear.
  const placeable = (p: TilePos): boolean =>
    !(p.i === stairs.i && p.j === stairs.j) &&
    Math.abs(p.i - start.i) + Math.abs(p.j - start.j) >= CALM &&
    !reserved(p.i, p.j) &&
    !takenTile(p.i, p.j);
  const dirOf = (a: TilePos, b: TilePos): [number, number] => [Math.sign(b.i - a.i), Math.sign(b.j - a.j)];

  // ── SEGMENT THE ROUTE BY WHERE IT ACTUALLY TURNS ────────────────────────
  //
  // The old segmentation cut the route into maximal LATTICE runs: walk while
  // the one-tile cardinal step is unchanged, call the tile where it changes a
  // bend. That is right for a route that runs along the axes and catastrophic
  // for one that does not, because a Phi descent across the floor comes out as
  // a STAIRCASE — alternating E,S,E,S — and every single tile of it is a bend.
  //
  // Censused on the shipping generator: the primary artery is ~116 tiles with
  // 31.8 lattice bends, and **62% of its straight runs are ONE TILE LONG**. A
  // one-tile run takes `stride = max(3, min(4, ceil(1/4))) = 3`, places its one
  // pad, and the tile after it takes a station — so the pass alternated pad,
  // station, pad, station down a diagonal. That is where 46.1 boostcorners and
  // 22.5 boostcurves per floor came from, and it is the largest single source
  // of "the map is a jumbled mess": one route event every 1.37 tiles, which at
  // BOOSTER_SPEED is ELEVEN PER SECOND.
  //
  // A ball does not experience the staircase; it experiences the smoothed
  // heading. So segment on that instead: a station goes where the ACCUMULATED
  // turn since the last one passes STATION_TURN, and everything between is a
  // lane. Same route, same guards, honest corners.
  const n = spine.length;
  const tanAt = (t: number): [number, number] => {
    const [sdi, sdj] = dirOf(spine[Math.min(t, n - 2)], spine[Math.min(t + 1, n - 1)]);
    return smoothTangent(spine, t, sdi, sdj);
  };
  // Each station carries the two headings that DEFINE it: the one the route
  // held since the previous station (what the ball arrives on) and the one it
  // has turned to (what it leaves on).
  //
  // ⚠️ THE LEGS MUST SPAN THE TURN THAT WAS DETECTED, and getting this wrong is
  // subtle enough to be worth recording. A first cut stored only the index and
  // recovered the legs from `tanAt(t-1)` / `tanAt(t+1)` — the LOCAL headings,
  // one tile either side. But the trigger here is ACCUMULATED drift, which a
  // gentle curve reaches over ten or twenty tiles while the heading one tile
  // apart is nearly identical. So `turns` came out false at almost every
  // station and the ladder fell through to its bumper fallback: measured,
  // boostcorner collapsed 1661 -> 70 over the sweep, i.e. the corner booster
  // effectively stopped existing. Carry the headings the detector actually
  // compared.
  const stations: Array<{ t: number; inTan: [number, number]; outTan: [number, number] }> = [];
  {
    let ref = tanAt(0);
    let lastAt = -STATION_MIN_GAP;
    for (let t = 1; t < n - 1; t++) {
      const tn = tanAt(t);
      // cos of the angle between the heading at the last station and here.
      const c = ref[0] * tn[0] + ref[1] * tn[1];
      if (c < STATION_TURN_COS && t - lastAt >= STATION_MIN_GAP) {
        stations.push({ t, inTan: ref, outTan: tn });
        lastAt = t;
        ref = tn;
      }
    }
  }

  // ── PADS BETWEEN THE STATIONS ───────────────────────────────────────────
  //
  // One pad every `padStride` tiles, derived rather than chosen — see PAD_STRIDE.
  // Every placement guard is unchanged from the run-based version; only WHICH
  // tiles are offered has changed.
  const stationSet = new Set(stations.map((st) => st.t));
  const padAt = (t: number): boolean => {
    if (t <= 0 || t >= n - 1) return false;
    const p = spine[t];
    const [di, dj] = dirOf(spine[t], spine[t + 1]);
    if (di === 0 && dj === 0) return false;
    if (!placeable(p) || launchRunway(g, p.i, p.j, di, dj) < 2) return false;
    if (!isDownhill(g, phi, p.i, p.j, di, dj)) return false;
    // ── AND NOW THE CURVED PAD CAN CARRY ITS OWN GATE ─────────────────────
    //
    // This is the check that could not live on the lattice-run version: there,
    // rejecting a tile made the loop slide and a wholly-diagonal run lost every
    // pad in it (measured: 1322 -> 1127 pads, chain rate 0.74 -> 0.65). On this
    // segmentation the tile is on a real straight, so a rejection costs one pad
    // rather than a run.
    //
    // It matters because `boostcurve` is the one launch kind with NO repair
    // pass — absent from LAUNCH_KINDS and from flow-loops' LAUNCHERS, so
    // openLaunchTargets, the runway re-aim, breakLaunchDuels and breakFlowLoops
    // all skip it, correctly, since a cardinal repair cannot rewrite a tangent.
    // Its authoring gate is the only gate it will ever get, and
    // `pinball-collide.boostcurve` sets the player's momentum straight off this
    // vector. The old gate proved ONE tile (`diagOpen`) of a heading up to 45
    // degrees away from the step everything else was checked on.
    const tan = tanAt(t);
    if (Math.abs(tan[0] * dj - tan[1] * di) <= TANGENT_SNAP) return true;
    const [cdi, cdj] = snapCardinal(tan[0], tan[1]);
    return (
      at(g, p.i + Math.sign(tan[0]), p.j + Math.sign(tan[1])) === T_FLOOR &&
      rayRunway(g, p.i, p.j, tan[0], tan[1], CURVE_RAY_RUNWAY) >= CURVE_RAY_RUNWAY &&
      openRunway(g, p.i, p.j, cdi, cdj, MIN_RUNWAY) >= MIN_RUNWAY &&
      isDownhill(g, phi, p.i, p.j, cdi, cdj)
    );
  };
  for (let t = 1; t < n - 1; t += padStride) {
    if (placed >= budget) break;
    // SLIDE, DON'T SKIP — a rejected tile hands its slot to the next one rather
    // than forfeiting it, so a guard firing costs a tile of rhythm and not a
    // hole. Bounded by the stride so a slide cannot swallow the next slot.
    // ── PREFER A TILE WHOSE LANE ACTUALLY RUNS THE STRIDE ─────────────────
    //
    // A pad fires along a CARDINAL. If the corridor bends away before the next
    // pad, the shove leaves the route immediately and the player is thrown at a
    // side wall instead of handed on — which is both the "boosters feed into
    // each other" promise broken and, from above, a booster pointing into a
    // wall. At the old stride 3 this was nearly free, because three tiles of
    // straight is common; at stride 8 it is not, and measured blind the
    // hand-off rate fell to 0.31.
    //
    // So the slide gets a PREFERENCE pass first: take the first tile in the
    // window whose fire lane is open for the whole stride, and only fall back to
    // "any legal tile" when the window has none. Allocation, not argmax — the
    // same shape `pickTrackEndpoints` uses, and it costs nothing when the route
    // is straight because the first candidate already qualifies.
    const wEnd = Math.min(n - 1, t + padStride);
    const legal = (x: number): boolean => !stationSet.has(x) && padAt(x);
    const runs = (x: number): boolean => {
      const [ddi, ddj] = dirOf(spine[x], spine[x + 1]);
      return launchRunway(g, spine[x].i, spine[x].j, ddi, ddj) >= Math.min(padStride, 6);
    };
    let t2 = t;
    while (t2 < wEnd && !(legal(t2) && runs(t2))) t2++;
    if (t2 >= wEnd || !legal(t2)) {
      t2 = t;
      while (t2 < wEnd && !legal(t2)) t2++;
    }
    if (t2 >= wEnd || !legal(t2)) continue;
    t = t2;
    const p = spine[t];
    const [di, dj] = dirOf(spine[t], spine[t + 1]);
    const tan = tanAt(t);
    if (Math.abs(tan[0] * dj - tan[1] * di) > TANGENT_SNAP) {
      parts.push({ kind: "boostcurve", i: p.i, j: p.j, dirI: tan[0], dirJ: tan[1], dir2I: 0, dir2J: 0, spine: true });
    } else {
      parts.push({ kind: "booster", i: p.i, j: p.j, dirI: di, dirJ: dj, dir2I: 0, dir2J: 0, spine: true });
    }
    placed++;
  }

  // ── THE STATIONS ────────────────────────────────────────────────────────
  //
  // Legs come from the SMOOTHED heading either side of the corner, snapped to
  // cardinals, not from the two lattice steps that happen to touch the tile —
  // on a staircase those two are frequently identical (E then E) even where the
  // route has genuinely turned, which is what made `turns` nearly meaningless
  // in the old version. A leg that turns out to face stone falls through to the
  // bumper, exactly as a no-runway corner always has.
  for (const { t, inTan, outTan } of stations) {
    if (placed >= budget) break;
    const bend = spine[t];
    if (!placeable(bend)) continue;
    // ── THE LEGS: SMOOTHED IF THEY EXIST, LATTICE IF THEY DO NOT ──────────
    //
    // The smoothed headings describe the turn the ball actually feels, so they
    // are the first choice. But they are an AVERAGE over a few tiles, and an
    // average can point at stone where the route itself does not — the corridor
    // bends around the corner while the mean heading cuts it. A part whose leg
    // faces rock is the exact defect this wave exists to remove.
    //
    // The route's own lattice steps cannot have that problem: they point at the
    // adjacent route tile, which is open by construction. So they are the
    // fallback, and the ladder only reaches `bumper` when the route genuinely
    // does not turn here — a straight crossing, which IS a junction, which is
    // what a bumper is for. (Without this fallback the ladder dropped a bumper
    // on two-way corners and broke the registry's "a bumper sits at a junction"
    // rule; decorate.test caught it.)
    const stepIn = dirOf(spine[Math.max(0, t - 1)], spine[t]);
    const stepOut = dirOf(spine[t], spine[Math.min(n - 1, t + 1)]);
    const pick = (snapped: readonly [number, number], lattice: [number, number], sign: number): [number, number] => {
      const ok = at(g, bend.i + sign * snapped[0], bend.j + sign * snapped[1]) !== T_WALL;
      return ok ? [snapped[0], snapped[1]] : lattice;
    };
    const [idi, idj] = pick(snapCardinal(inTan[0], inTan[1]), stepIn, -1);
    const [odi, odj] = pick(snapCardinal(outTan[0], outTan[1]), stepOut, 1);
    // PERPENDICULAR, not merely different. Both corner parts mean "bank from one
    // leg onto the other", and `decorate.test` pins the legs as perpendicular
    // for exactly that reason. The old lattice segmentation could not produce
    // anything else — two consecutive one-tile steps cannot be opposite — but an
    // accumulated-turn detector fires on ANY turn past 45 degrees, hairpins
    // included, and a 180-degree "corner" records dir and dir2 as the same
    // vector. That is a U-turn: there is no corner to bank, only a carom.
    const turns = (odi !== idi || odj !== idj) && idi * odi + idj * odj === 0;
    const legsOpen = at(g, bend.i - idi, bend.j - idj) !== T_WALL && at(g, bend.i + odi, bend.j + odj) !== T_WALL;
    const openLegs = WALL_SIDES.filter(([li, lj]) => at(g, bend.i + li, bend.j + lj) === T_FLOOR);
    // THE CORNER BOOSTER gets first refusal on every turn with room for it: a
    // deflector preserves speed but adds none, and a straight pad in a corner
    // fires you at the outside wall. Ordered ahead of the deflector so a turn
    // ACCELERATES where it can, and the deflector becomes what it was always
    // best at — the fallback for a corner too tight to fit a boosted exit.
    if (turns && legsOpen && launchRunway(g, bend.i, bend.j, odi, odj) >= CARRY_RUNWAY && isDownhill(g, phi, bend.i, bend.j, odi, odj)) {
      parts.push({ kind: "boostcorner", i: bend.i, j: bend.j, dirI: -idi, dirJ: -idj, dir2I: odi, dir2J: odj, spine: true });
    } else if (turns && legsOpen && openLegs.length <= 2) {
      // A clean corner -> a deflector banks incoming->outgoing, speed intact.
      // Legs match classifyTopology: where you came FROM (-in) and GO (+out).
      parts.push({ kind: "deflector", i: bend.i, j: bend.j, dirI: -idi, dirJ: -idj, dir2I: odi, dir2J: odj, spine: true });
    } else if (openLegs.length >= 3) {
      // A genuine CROSSING the route passes through: a bumper to carom off,
      // which keeps momentum alive without claiming a direction the route does
      // not have. Gated on the junction, because that is what a bumper IS —
      // `decorate.test` pins "bumper => 3+ open ways" and the registry says the
      // same, so dropping one on a two-way corridor tile is a rule break, not a
      // near-miss.
      parts.push({ kind: "bumper", i: bend.i, j: bend.j, dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0, spine: true });
    } else if (padAt(t)) {
      // NOT A CORNER AFTER ALL. The detector fires on ACCUMULATED drift, so a
      // long gentle curve earns a station at a tile whose two legs still snap to
      // the same cardinal — the route bends across twenty tiles without ever
      // turning at this one. There is no corner here to bank, and the tile is a
      // straight corridor, so it gets what a straight corridor gets: a pad.
      const [pdi, pdj] = dirOf(spine[t], spine[t + 1]);
      const ptan = tanAt(t);
      if (Math.abs(ptan[0] * pdj - ptan[1] * pdi) > TANGENT_SNAP) {
        parts.push({ kind: "boostcurve", i: bend.i, j: bend.j, dirI: ptan[0], dirJ: ptan[1], dir2I: 0, dir2J: 0, spine: true });
      } else {
        parts.push({ kind: "booster", i: bend.i, j: bend.j, dirI: pdi, dirJ: pdj, dir2I: 0, dir2J: 0, spine: true });
      }
    } else {
      continue; // nothing legal here; the route simply runs on
    }
    placed++;
  }

  // ── THE TERMINUS STATION ────────────────────────────────────────────────
  //
  // A bend gets a station; the END of a road used to get nothing. That was
  // invisible while there was one road ending at the stairs (where draining
  // into the exit is the correct behaviour) and became the dominant defect the
  // moment there were four: each alternate road's last pad fired into bare
  // floor, so the knight was railed along and then simply stopped.
  //
  // A bumper, because the terminus is where a road hands you to whatever is
  // there — a carom keeps the momentum alive and pointed somewhere, where a
  // directional part would be inventing a direction the route no longer has an
  // opinion about. Skipped at the stairs: draining into the exit IS the ending.
  const last = spine[n - 1];
  if (last && placeable(last) && !(last.i === stairs.i && last.j === stairs.j)) {
    parts.push({ kind: "bumper", i: last.i, j: last.j, dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0, spine: true });
    placed++;
  }
  return placed;
}

/**
 * FURNISH THE LAUNCH CHUTE — the accelerating hallway off the plunger.
 *
 * The chute's geometry belongs to the maze layer (track-launch.ts); what it
 * needs to PLAY is a row of boosters that turn a plunger pull into a run. The
 * user's ask, exactly: "the plunger to push the user in the beginning needs to
 * be like the pinball machine where it leaves the starting point and it's a
 * long hallway with boosters that then goes into the maze".
 *
 * Three decisions worth stating, because each has an obvious wrong version:
 *
 *  1. **The park tile stays bare.** `spine[0]` is where the knight stands while
 *     the plunger charges. A pad under him would fire him before he released,
 *     and the launch is supposed to be the player's.
 *  2. **Pads ACCELERATE, they don't replace the launch.** They start a few
 *     tiles out and stride down the lane, so a full pull and a soft tap feel
 *     different all the way to the mouth. A pad on every tile makes the pull
 *     irrelevant, which throws away the only skill in the opening.
 *  3. **Nothing is placed in the last two tiles.** That is the merge, and a pad
 *     firing INTO the junction fights whatever the circuit does with you there
 *     — the launch-duel failure mode (see `breakLaunchDuels`) with the floor's
 *     opening as one of the participants.
 *
 * All pads are `spine: true`: exempt from the anti-clustering spacing and from
 * the A1 runway repair. Runway is guaranteed here by construction — the chute
 * is straight, sealed and open all the way to the mouth — so the repair has
 * nothing to add and its re-aim could only point a pad sideways into rock.
 *
 * Mutates `parts` and `torches`.
 */
function layLaunchChute(
  g: Grid,
  chute: LaunchChute,
  parts: PinballPartSpot[],
  torches: Torch[],
): void {
  const { spine, dirI, dirJ } = chute;
  // First pad this far from the park tile: enough runway that the plunger's own
  // power still reads before anything boosts it.
  const LEAD = 3;
  const STRIDE = 3;
  // The merge, left clear — see (3) above.
  const TAIL = 2;
  for (let s = LEAD; s <= spine.length - 1 - TAIL; s += STRIDE) {
    const p = spine[s];
    if (!isWalkable(g, p.i, p.j)) continue;
    parts.push({ kind: "booster", i: p.i, j: p.j, dirI, dirJ, dir2I: 0, dir2J: 0, spine: true, chute: true });
  }
  // The chute was withheld from the general torch pass with everything else, so
  // it lights itself. Alternating walls down the lane: a corridor lit from one
  // side reads as flat, and this one is meant to read as DEPTH — you should be
  // able to see how far you are about to be thrown.
  const pi = -dirJ;
  const pj = dirI;
  let side = 1;
  for (let s = 1; s < spine.length - 1; s += 4) {
    const c = spine[s];
    for (let d = 1; d <= Math.ceil(chute.half) + 1; d++) {
      const x = c.i + pi * side * d;
      const y = c.j + pj * side * d;
      if (!isWalkable(g, x, y)) {
        // The torch sits on the last OPEN tile, sconce facing the wall it found.
        const fx = c.i + pi * side * (d - 1);
        const fy = c.j + pj * side * (d - 1);
        if (isWalkable(g, fx, fy)) torches.push({ i: fx, j: fy, di: pi * side, dj: pj * side });
        break;
      }
    }
    side = -side;
  }
}

/**
 * POLISH PASS — placement pathologies live QA actually hit, fixed as one sweep
 * over the finished part list (after A1 so its re-aims are covered too):
 *
 *  1. OPPOSING LAUNCHERS: two directional parts on one clear line firing at
 *     each other are a physical feedback loop you can't steer out of. The
 *     later/non-spine one is DROPPED (never re-aimed — a re-aim here could
 *     recreate the A1 wall-shot this pass runs after).
 *  2. BUMPER CLUMPS: 3-4 bumpers on adjacent tiles read as a blob and play as
 *     one wall. Enforce pairwise Chebyshev ≥ 3 between bumpers (spine bends
 *     kept preferentially) so what remains is a PATTERN you bounce BETWEEN.
 *  3. EMPTY PLAZAS: big open rooms with no machine in them. Every ~5×5
 *     fully-open block with no parts nearby gets a bumper DIAMOND (four
 *     bumpers on a ring, 2 tiles out) — a reusable bounce pattern, and core
 *     drops a monster pack on the same centres (returned as `plazas`).
 */
function polishParts(g: Grid, parts: PinballPartSpot[], rng: () => number, walkable: number): TilePos[] {
  // ⚠️ TWO PREDICATES FOR "LAUNCHER", AND THEY DISAGREE. `duelEligible` (the
  // pass that guards the same soft-lock at the end of decorateMaze) requires
  // `LAUNCH_KINDS.has(p.kind)`; this one asks only "does it have a heading and
  // is it not a deflector". A drop TARGET has a heading — which way it faces —
  // and launches nothing, so it passes here and fails there.
  //
  // For loose corridor furniture that over-breadth is long-standing and
  // untouched here: narrowing it would change every existing floor, which is a
  // measurement job, not a side effect of this change. It is filed in
  // OPEN_WORK.md.
  //
  // For a MACHINE part it is not survivable. An authored machine is a fixed
  // arrangement — a target bank IS three targets in a row — so a predicate that
  // counts a target as a launcher deletes the middle of the bank and ships half
  // a machine. Measured: target-bank lost seq 1, orbit and ramp-return lost
  // seq 0, across 4 of 36 floors.
  //
  // So machine parts are held to LAUNCH_KINDS, the same bar `duelEligible`
  // uses. This is NOT an exemption from the soft-lock guard — `assembly.ts` is
  // explicit that machines do not get one, and a machine's ramp still loses a
  // genuine duel here and in breakLaunchDuels. It only stops non-launching
  // furniture being mistaken for a launcher.
  const partExitRay = (p: PinballPartSpot): readonly [number, number] => {
    if (p.kind === "boostcorner" && (p.dir2I !== 0 || p.dir2J !== 0)) return [p.dir2I, p.dir2J];
    return [p.dirI, p.dirJ];
  };
  const isLauncher = (p: PinballPartSpot): boolean => {
    const [di, dj] = partExitRay(p);
    return (
      (di !== 0 || dj !== 0) &&
      p.kind !== "deflector" &&
      !p.vault &&
      (p.asm === undefined || LAUNCH_KINDS.has(p.kind))
    );
  };

  // ── 1. Opposing launchers on a clear line ──
  const drop = new Set<PinballPartSpot>();
  for (let a = 0; a < parts.length; a++) {
    const A = parts[a];
    if (drop.has(A) || !isLauncher(A)) continue;
    const [fAi, fAj] = partExitRay(A);
    for (let step = 1; step <= 10; step++) {
      const ti = A.i + fAi * step;
      const tj = A.j + fAj * step;
      if (at(g, ti, tj) !== T_FLOOR) break; // wall closes the line — no loop possible
      const B = parts.find((q) => q.i === ti && q.j === tj && !drop.has(q) && isLauncher(q));
      if (!B) continue;
      const [fBi, fBj] = partExitRay(B);
      if (fBi === -fAi && fBj === -fAj) {
        // Facing pair with line of sight: kill one. Spine and circuits survive
        // over loose corridor furniture. If both are circuits, leave resolution
        // to breakLaunchDuels/breakFlowLoops downstream.
        if (A.circuit !== undefined && B.circuit !== undefined) {
          // Handled downstream by breakFlowLoops/breakLaunchDuels
        } else if (A.spine && !B.spine) {
          drop.add(B);
        } else if (!A.spine && B.spine) {
          drop.add(A);
        } else if (A.circuit !== undefined && B.circuit === undefined) {
          drop.add(B);
        } else if (A.circuit === undefined && B.circuit !== undefined) {
          drop.add(A);
        } else {
          drop.add(A);
        }
      }
      break; // first part on the line settles it either way
    }
  }

  // ── 2. Bumper de-clump ── spine bends first so the route keeps its stations.
  // A circuit's bumpers sit where the loop needs a yield — at an interchange or
  // an off-ramp — and a machine's sit close together on purpose (a pop nest is
  // three bumpers at Chebyshev 2). Both are authored shapes, so the de-clump
  // that exists to break up ACCIDENTAL crowding must not see them.
  const bumpers = parts.filter(
    (p) => p.kind === "bumper" && !drop.has(p) && p.circuit === undefined && p.asm === undefined,
  );
  bumpers.sort((x, y) => Number(y.spine ?? false) - Number(x.spine ?? false));
  const kept: PinballPartSpot[] = [];
  for (const b of bumpers) {
    if (kept.some((k) => Math.max(Math.abs(k.i - b.i), Math.abs(k.j - b.j)) < 3)) drop.add(b);
    else kept.push(b);
  }
  if (drop.size) {
    for (let i = parts.length - 1; i >= 0; i--) if (drop.has(parts[i])) parts.splice(i, 1);
  }

  // ── 3. Plaza patterns ──
  const plazas: TilePos[] = [];
  const candidates: TilePos[] = [];
  for (let cj = 3; cj < g.h - 3; cj += 4) {
    for (let ci = 3; ci < g.w - 3; ci += 4) {
      let open = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) if (at(g, ci + di, cj + dj) === T_FLOOR) open++;
      if (open < 25) continue; // not a true plaza — some wall inside the window
      if (parts.some((p) => Math.max(Math.abs(p.i - ci), Math.abs(p.j - cj)) <= 3)) continue;
      candidates.push({ i: ci, j: cj });
    }
  }
  // ── HOW MANY PLAZAS GET A BUMPER DIAMOND, BY AREA ──────────────────────
  //
  // A flat 8, and each stamps up to 4 bumpers OFF the part budget — so the same
  // 32 unbudgeted bumpers landed on a 2470-tile level-1 floor as on a 9800-tile
  // level-16 one. Censused, this was the single largest source of the 37.8
  // bumpers per floor. Scaling by area keeps the deep floors exactly as they
  // were (the count saturates at 8 by L10) and thins the shallow ones, which is
  // where the crowding actually was.
  // The cap is the same shape as `routeBudget`'s and moved for the same reason:
  // 8 saturated at 7.2k walkable, which every floor past L10 now clears, so the
  // area scaling this line exists for stopped applying exactly where floors got
  // biggest. 24 is ~14% above what `walkable/900` can ask for at the (96,72)
  // ceiling (18.6k walkable => 21).
  const plazaCap = Math.max(2, Math.min(24, Math.round(walkable / 900)));
  for (const c of shuffled(candidates, rng).slice(0, plazaCap)) {
    // Re-check spacing — an earlier stamp this loop may now be the neighbour.
    if (parts.some((p) => Math.max(Math.abs(p.i - c.i), Math.abs(p.j - c.j)) <= 3)) continue;
    for (const [di, dj] of [[2, 0], [-2, 0], [0, 2], [0, -2]] as const) {
      if (at(g, c.i + di, c.j + dj) !== T_FLOOR) continue;
      parts.push({ kind: "bumper", i: c.i + di, j: c.j + dj, dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0 });
    }
    plazas.push(c);
  }
  return plazas;
}

export function decorateMaze(
  g: Grid,
  rng: () => number,
  zombieCount: number,
  torchBudget: number,
  partBudget = 16, // corridor parts beyond the spine — doubled with the 4× floors

  rooms: Room[] = [],
  extras: { anchors?: PrefabAnchor[]; deal?: PartSpotKind[]; targets?: number; trapdoors?: number; hazards?: number; forceVault?: boolean; boosterLanes?: number; launchBreaks?: number; vaultRamps?: number; chains?: number; rolloverArrays?: number; bonusItems?: number; endpoints?: Endpoints; floor?: number; strictLaunchers?: boolean; chute?: LaunchChute | null; orbit?: { ci: number; cj: number } | null; wallsAuthored?: boolean; circuits?: number; circuitSeed?: number; assemblySeed?: number; assemblies?: number; swingarms?: number; flywheels?: number; magpostFields?: number } = {},
): LevelPlan {
  // START + STAIRS come from pickEndpoints, which the caller runs ONCE and
  // shares with widenMainArtery so the widened highway leads to the real exit.
  // The fallback (no endpoints passed) is the old top-left/farthest rule, kept
  // only so a caller that predates this can't crash — it is the rule that
  // pinned every floor's exit to the bottom-right corner, so prefer the real
  // picker. See pickEndpoints for why.
  let start: TilePos = { i: 1, j: 1 };
  if (extras.endpoints) {
    start = extras.endpoints.start;
  } else {
    outer: for (let j = 0; j < g.h; j++) {
      for (let i = 0; i < g.w; i++) {
        if (at(g, i, j) === T_FLOOR) {
          start = { i, j };
          break outer;
        }
      }
    }
  }
  const strictLaunchers = extras.strictLaunchers === true;
  const dist = bfsDistancesOwned(g, start.i, start.j); // held across later BFS calls

  // ── THE LAUNCH CHUTE IS NOT GENERAL FLOOR ───────────────────────────────
  //
  // `floors` is the candidate pool every later pass draws from — spawns, loot,
  // props, torches, the corridor part deal, booster tributaries, target banks.
  // Withholding the chute's tiles HERE, once, is what keeps the plunger lane a
  // plunger lane, and it is deliberately a single subtraction rather than an
  // `if (inChute)` bolted onto each of the dozen `shuffled(floors)` loops
  // downstream: one of those would eventually be added without the guard, and
  // a zombie parked in the launch hallway turns the floor's opening commitment
  // into a coin flip.
  //
  // The chute is then furnished on purpose by `layLaunchChute` below — pads and
  // its own torches — so nothing is lost by excluding it, only chosen.
  const chute = extras.chute ?? null;
  const chuteSet = new Set<number>();
  if (chute) for (const t of chuteTiles(g, chute)) chuteSet.add(idx(g, t.i, t.j));
  const inChute = (i: number, j: number): boolean => chuteSet.has(idx(g, i, j));

  const floors: TilePos[] = [];
  let maxDist = 0;
  let farthest: TilePos = start;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (at(g, i, j) !== T_FLOOR) continue;
      if (inChute(i, j)) continue;
      floors.push({ i, j });
      const d = dist[idx(g, i, j)];
      if (d > maxDist) {
        maxDist = d;
        farthest = { i, j };
      }
    }
  }
  const stairs: TilePos = extras.endpoints?.stairs ?? farthest;
  setTile(g, stairs.i, stairs.j, T_STAIRS);

  // ── ARTERY BANKS + THE SPINE, in that order and for a reason ────────────
  //
  // A bank converts floor to wall to form the OUTER shell of a turn, and the
  // spine walks straight through every bend a bank wants — at ridden radius 5
  // the two corridor tiles nearest the corner sit at d=5.00 and d=5.75, both
  // inside the bank's band. So the two cannot be fenced apart: excluding spine
  // tiles rejects every bank (measured 0/floor), and banking after the route is
  // traced re-derives the route through a different corner, leaving the pads
  // already laid pointing backward (decorate.test.ts catches exactly that).
  //
  // The resolution is ORDERING, not exclusion. Bank the grid FIRST, then trace.
  // The route is then computed on the banked grid and follows the banks by
  // construction — and layStationSpine's bend handling already wants this: it
  // drops a DEFLECTOR at a clean corner "to bank incoming→outgoing with speed
  // intact", which is the square-tile version of the very thing a bank builds.
  // Route and bank were never in conflict; they were just being built in the
  // wrong order.
  //
  // The provisional trace is only used to FIND the bends. It is discarded.
  //
  // ⚠️ `wallsAuthored` SKIPS this entirely, and that is the shipping path. On a
  // track floor `buildTrackFloor` runs the same pass itself, with the rest of
  // the wall geometry and on the final endpoints — see track-floor.ts. This
  // branch is now only the LEGACY generator's, where there is no maze layer to
  // do it. Running it in both places would bank an already-banked floor.
  if (!extras.wallsAuthored) {
    const probe = traceArtery(g, start, stairs, dist);
    if (probe.length >= 8) authorArteryBanks(g, probe, start, () => false);
  }
  // Re-derive distances on the banked grid — the banks moved walls, so the old
  // field is stale, and a stale field would trace a path through a tile that is
  // now solid.
  const bankedDist = bfsDistancesOwned(g, start.i, start.j);
  const spine = traceArtery(g, start, stairs, bankedDist);
  // ── Φ, THE FLOW FIELD (maze/flow-orient.ts) ─────────────────────────────
  //
  // Built here, on the FINAL geometry, and threaded through every pass that
  // aims a launch part. Φ is BFS distance to the STAIRS, so "downhill" means
  // onward-toward-the-exit on every tile of the floor — not just on the traced
  // artery, and not merely "away from the spawn", which any dead-end branch
  // also satisfies. See flow-orient.ts for why the guarantee needs a scalar
  // potential rather than another pairwise repair pass.
  const phi = buildFlowField(g, stairs);
  // The ALTERNATE ROUTES. `spine` is one path; every other lane leg is the head
  // of another, found by descending Φ until it merges into a route already laid
  // down. That is the "multiple paths, not one set path" half of the ask, and
  // it costs nothing extra to keep coherent — all of them run downhill on the
  // same field, so no two routes can ever fight each other.
  // HOW MANY roads rides the floor's AREA, not a flat 3. A level-1 floor has
  // ~2470 walkable tiles and a level-16 one ~9800 — four roads on the small one
  // is four roads through the same few corridors, and `ALT_ROUTE_GAP` (6) was
  // already starving them into overlapping anyway. Scaling the count stops the
  // pass attempting what the floor cannot hold: 1 road at L1-L5, 2 by L10, the
  // full 4 only where there is genuinely room.
  const maxAlt = Math.max(0, Math.min(ALT_ROUTES_MAX, Math.floor(floors.length / 4000)));
  const routes = [spine, ...alternateRoutes(g, phi, spine, start, stairs, rng, { max: maxAlt })];
  const spineSet = new Set<number>();
  for (const r of routes) for (const p of r) spineSet.add(idx(g, p.i, p.j));
  const onSpine = (i: number, j: number): boolean => spineSet.has(idx(g, i, j));

  // ── Rooms first: archetype content is SEEDED into the pools below, so all
  // the general placement (and its spacing rules) works around it. General
  // placement also stays OUT of room interiors — each room is its archetype's
  // set piece, not another stretch of corridor. Rooms leave the spine lane clear
  // so the booster route can run through them (they become stations ON the path). ──
  const furnished = furnishRooms(rooms, rng, start, g, phi, extras.forceVault, onSpine);
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
  // The spacing test is bucketed rather than a linear scan over `spawns`:
  // at the caps this loop ran 26,400 candidates x 135 placed. `taken` also
  // replaces the `spawns.includes(p)` identity check, which was a second O(n)
  // scan per candidate — a tile already chosen in pass 1 is simply marked.
  const spawnGrid = [createSpacingGrid(2.5), createSpacingGrid(0)];
  const taken = new Set<number>();
  for (let pass = 0; pass < 2; pass++) {
    const near = spawnGrid[pass];
    for (const p of candidates) {
      if (spawns.length >= zombieCount) break;
      const k = idx(g, p.i, p.j);
      if (taken.has(k) || near.occupied(p.i, p.j)) continue;
      spawns.push(p);
      taken.add(k);
      // Every grid must learn the point, or pass 2 would re-place on top of
      // pass 1's spawns.
      for (const gr of spawnGrid) gr.add(p.i, p.j);
    }
    if (spawns.length >= zombieCount) break;
  }

  // ── Torches: floor tiles with an adjacent SOLID wall, spaced ≥4 apart.
  // Never a cracked band — its sconce would hang in mid-air after the smash. ──
  const torches: Torch[] = [];
  // Manhattan spacing, bucketed — the linear form ran 26,400 x 80 at the caps.
  // The metric MUST stay manhattan: switching to euclid here would change which
  // tiles qualify and reroll every floor's torch layout.
  const torchGrid = createSpacingGrid(4, "manhattan");
  for (const p of shuffled(floors, rng)) {
    if (torches.length >= torchBudget) break;
    if (torchGrid.occupied(p.i, p.j)) continue;
    const side = WALL_SIDES.find(([di, dj]) => at(g, p.i + di, p.j + dj) === T_WALL);
    if (!side) continue;
    torches.push({ i: p.i, j: p.j, di: side[0], dj: side[1] });
    torchGrid.add(p.i, p.j);
  }

  // ── Items: this level's roll, scattered on quieter floor tiles ──
  // Not on the stairs, not on top of a zombie spawn, a few tiles out from the
  // start (finding your first pickup should take a moment of exploring).
  //
  // SPREAD (the old pass was a single shuffled first-fit with a Manhattan-5
  // rule — on 4× floors whatever region the shuffle front-loaded ate the whole
  // armoury while the rest of the map read empty):
  //  • candidates are binned into FOUR distance-from-start rings and placement
  //    round-robins the rings, so loot paces the whole trek start→stairs;
  //  • within a ring, OFF-SPINE tiles come first — the artery is the highway,
  //    pickups should reward stepping off it (spine tiles remain as fallback);
  //  • pairwise separation scales with the floor (≥5, ~12% of the trek), with
  //    relaxing passes so small mazes still seat everything.
  const items: ItemDrop[] = [...furnished.items];
  const itemSpots = shuffled(
    floors.filter((p) => {
      const d = dist[idx(g, p.i, p.j)];
      return d >= 4 && !(p.i === stairs.i && p.j === stairs.j) && !spawns.some((s) => s.i === p.i && s.j === p.j) && !inRoom(p);
    }),
    rng,
  );
  const ringOf = (p: TilePos): number => Math.min(3, Math.floor((dist[idx(g, p.i, p.j)] / Math.max(1, maxDist)) * 4));
  const ringPools: TilePos[][] = [[], [], [], []];
  for (const p of itemSpots) ringPools[ringOf(p)].push(p);
  for (let r = 0; r < 4; r++) {
    ringPools[r] = [...ringPools[r].filter((p) => !onSpine(p.i, p.j)), ...ringPools[r].filter((p) => onSpine(p.i, p.j))];
  }
  // A modifier can fatten the armoury (Blackout pays for the dark, Gilded is a
  // treasure floor): extra rolls appended to this level's normal set.
  const bonusRolls: RolledItem[] = [];
  for (let k = 0; k < (extras.bonusItems ?? 0); k++) {
    bonusRolls.push({ kind: "potion", id: shuffled(POTION_POOL, rng)[0] });
  }
  // Separation floors at 5 — the pairwise-spread invariant (decorate.test)
  // holds even on the relax pass. Euclidean ≥5 ⇒ Manhattan ≥5.
  const sepPasses = [Math.max(5, Math.floor(maxDist * 0.12)), 5];
  let itemRing = 0;
  for (const def of [...rollLevelItems(rng), ...bonusRolls]) {
    let spot: TilePos | undefined;
    for (const sep of sepPasses) {
      for (let k = 0; k < 4 && !spot; k++) {
        spot = ringPools[(itemRing + k) % 4].find((p) => !items.some((it) => Math.hypot(it.i - p.i, it.j - p.j) < sep));
      }
      if (spot) break;
    }
    if (!spot) break; // a maze too small for the full roll — place what fits
    itemRing = (itemRing + 1) % 4;
    items.push({ kind: def.kind, id: def.id, i: spot.i, j: spot.j });
  }

  // ── Props: sparse scenery on plain floor, clear of the stairs and loot ──
  const PROP_KINDS = ["bones", "skull", "rubble", "bones", "rubble"]; // bones/rubble weighted up
  const props: PropSpot[] = [];
  // /40, down from /26. Props are walkable-over scenery so they cost legibility
  // rather than navigation, but at one per 26 walkable tiles they were the
  // largest object class on the floor after zombies (38 per 1k, and FLAT with
  // depth). The comment's own D2R reference — "a skull every dozen tiles" —
  // means a dozen CORRIDOR tiles, which on a 2-to-3-wide lane is 24-40 walkable.
  const propBudget = Math.floor(floors.length / 40);
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

  // ── CIRCUITS: the floor's highway loops ────────────────────────────────
  //
  // Runs FIRST of the part layers, before the station spine and long before the
  // corridor deal, for the reason `assembly.ts` gives about authored intent:
  // parts landing at pass 14 of 20 get de-clumped and re-aimed by passes 17-20,
  // so a relationship authored late does not survive. A circuit reserves its
  // tiles and everything downstream fills in around it.
  //
  // It is its OWN LAYER — `corridorBudget` is measured after it, the same
  // convention the spine, banks, hazards and rollovers already follow — so a
  // circuit never strips the deal; the deal spaces around it.
  //
  // The budget is derived from DENSITY HEADROOM rather than picked, because
  // `floor-density.ts` caps parts at 34 per 1k and shipping floors already run
  // 15.6-28.2. A constant would be invisible on a sparse floor and would break
  // the density gate on the busiest seeds only — a flake that reproduces on one
  // seed in ten and looks like anything but a budget.
  // HEADROOM MUST SUBTRACT WHAT IS STILL TO COME, not just what is already
  // placed. Measured with only `parts.length` subtracted: 44 of 60 floors broke
  // the density band, up to 37.9 parts per 1k against a ceiling of 34 — because
  // at this point in the pass `parts` holds room furniture ALONE, so "30 per 1k
  // of room left" was really "30 per 1k plus the entire corridor deal and the
  // whole station spine". A budget measured against an empty floor is not a
  // budget.
  // Because circuits come OUT of the corridor budget (see `corridorBudget`
  // below), this is a share of that budget rather than a density calculation:
  // the floor's total is unchanged whatever this number is, so it decides how
  // much of the floor is LOOP versus loose furniture, not how busy it gets.
  const circuitHeadroom = Math.round(partBudget * CIRCUIT_BUDGET_SHARE);
  const circuits = authorCircuits(g, phi, routes, {
    occupied: (i, j) =>
      inChute(i, j) ||
      inRoom({ i, j }) ||
      items.some((it) => it.i === i && it.j === j) ||
      parts.some((q) => q.i === i && q.j === j),
    start,
    stairs,
    maxCircuits: extras.circuits ?? CIRCUITS_DEFAULT,
    budget: Math.min(circuitHeadroom, CIRCUIT_PARTS_MAX),
    existing: parts,
  });
  // COMMIT ONLY IF THE SHOVE GRAPH STAYS ACYCLIC. The circuit layer is not
  // exempt from the soft-lock guard — it pre-satisfies it. Authoring into a
  // scratch array is what makes rejection possible at all; a pass that had
  // already mutated `parts` could only be repaired, not declined.
  const committed: Circuit[] = [];
  for (const c of circuits) {
    const probe = [...parts, ...c.links];
    if (findFlowCycles(g, probe as unknown as FlowPart[]).length > 0) continue;
    parts.push(...c.links);
    committed.push(c);
  }
  const circuitPartCount = committed.reduce((a, c) => a + c.links.length, 0);
  const circuitTiles = new Set<number>();
  for (const c of committed) for (const t of c.ring) circuitTiles.add(idx(g, t.i, t.j));
  /** A tile a circuit has claimed — reserved from every later placer, so
   *  nothing drops a booster across a highway's lane. */
  const inCircuit = (i: number, j: number): boolean => circuitTiles.has(idx(g, i, j));

  // ── AUTHORED MACHINES: the assembly library, finally called ─────────────
  //
  // `maze/assembly.ts` names its own consumer — "the router in
  // `assembly-place.ts` is what matches them up" — and that router then sat
  // with ZERO callers. Eight machines with authored relative facings and
  // chainable ports, ~1,250 lines, tested and green and never run. The
  // `asm?: AssemblyRef` field below was declared and only ever read, so the two
  // `p.asm === undefined` exemptions in polishParts were constants.
  //
  // AFTER CIRCUITS, BEFORE EVERYTHING ELSE — and the ordering was measured,
  // not assumed. assembly.ts asks to be placed EARLY, and it is right about
  // WHY: parts landing late get de-clumped and re-aimed by the polish passes,
  // "so a machine authored with two bumpers a tile apart was silently pulled
  // apart". But that protection comes from the `p.asm === undefined`
  // exemptions in polishParts, which key off the PART, not off when it was
  // placed — so a machine is just as safe here as it would be three layers up.
  //
  // Running it ahead of circuits was tried first and cost 15 floors of 36
  // their highway loop (circuit.test.ts: 21/36 against a 36/36 invariant).
  // Machines and rings want the same wide route-adjacent ground, and the ring
  // is the floor's through-line while a machine is a set piece hanging off it.
  // So circuits claim first and the machines fill in around them; everything
  // downstream — the station spine, the corridor deal, chains, hazards — then
  // fills in around BOTH.
  //
  // ⚠️ ITS OWN RNG STREAM, never the floor's. A draw from `rng` here would
  // reshuffle every downstream pass and reroll every existing floor for every
  // player. `PlaceOpts` says so at its first field; `surface-paint.ts` is the
  // precedent. The seed comes from the caller (which holds the real one) and
  // falls back to a value derived from geometry, so a harness that passes no
  // seed still gets a deterministic floor rather than a shared-stream draw.
  const assemblySeed = extras.assemblySeed ?? ((g.w * 73856093) ^ (g.h * 19349663) ^ ((extras.floor ?? 1) * 83492791)) >>> 0;
  // ⚠️ SLING_PAIR IS WITHHELD, and it is the library's problem rather than the
  // guard's. It is two slingshots facing each other across a lane (E and W,
  // assembly-lib.ts) — which is the definition of a LAUNCH DUEL, the
  // unrecoverable ping-pong `breakLaunchDuels` exists to break, and which
  // assembly.ts explicitly does NOT exempt machines from: "Aesthetics yield to
  // authoring; the soft-lock guard does not."
  //
  // So on the first floor that placed one, the guard removed a part and the
  // machine shipped half-built. Handing it to the router anyway would mean
  // authoring a soft-lock and relying on a later pass to half-dismantle it.
  // The fix is to re-author the pair at an angle so the two rebounds do not
  // fire down each other's throat; that is an art call on a mechanism nobody
  // has played yet, so it is filed rather than guessed at. See OPEN_WORK.md.
  const PLACEABLE = MACHINES.filter((m) => m.name !== "sling-pair");
  const assemblyReport = placeAssemblies(g, phi, {
    machines: PLACEABLE,
    rng: mulberry32((assemblySeed ^ 0x9d2c5681) >>> 0),
    routes,
    start,
    stairs,
    occupied: (i, j) =>
      inChute(i, j) ||
      inRoom({ i, j }) ||
      inCircuit(i, j) ||
      items.some((it) => it.i === i && it.j === j) ||
      parts.some((q) => q.i === i && q.j === j),
    budget: extras.assemblies ?? ASSEMBLY_BUDGET,
    stride: ASSEMBLY_STRIDE,
  });
  const assemblyTiles = new Set<number>();
  for (const placed of assemblyReport.placed) {
    for (const t of placed.tiles) assemblyTiles.add(t);
    parts.push(...partsOf(placed));
  }
  /** A tile an authored machine has claimed — reserved from every later placer,
   *  the same contract `inCircuit` has one layer down. */
  const inAssembly = (i: number, j: number): boolean => assemblyTiles.has(idx(g, i, j));

  // ── STATION SPINE (path-first): string the connected booster route down the
  // main artery FIRST, so the floor has one legible "boosters feed into each
  // other" route before anything else fills in. It is its OWN LAYER (like the
  // banks/hazards/rollover layers): the corridor budget is measured AFTER it, so
  // the spine never strips the deal — the deal below just spaces AROUND these
  // tiles, filling the pockets that branch off the spine. ──
  // Every route, primary first. They share Φ, so a junction where two of them
  // meet has both arms pointing the same way — which is the whole reason this
  // can be a loop over routes instead of one carefully-hand-tuned path.
  // ── THE ROUTE LAYER GETS A BUDGET, like every other layer on this floor ──
  //
  // It never had one. Censused over 64 live floors it laid **138.5 parts** per
  // floor against a corridor budget of 9-39 — 55-72% of every floor's furniture
  // — and it swung 85 → 275 between four seeds at ONE depth (L12). A 3.2x spread
  // at fixed depth is the signature of an unbudgeted layer: the count is
  // whatever the topology happened to hand it.
  //
  // The rhythm rules above set the number; this is the ceiling that stops a
  // hostile route from spending the whole floor anyway. Derived from those
  // rules rather than picked: the primary comes out around 16 parts on a
  // ~116-tile artery of a ~3960-tile floor, plus one to three slip roads, so
  // `walkable/110` sits about 20% above what the rules produce and binds only on
  // the outlier seed.
  //
  // PRIMARY ROUTE FIRST — `routes[0]` is the artery — so what a binding budget
  // cuts is always slip-road furniture and the through-line survives intact.
  //
  // ⚠️ THE CEILING MUST OUTRUN THE RULE, or it stops being a ceiling and becomes
  // the rule. 64 was set when the deepest floor was ~8.4k walkable, where
  // `walkable/110` = 76 — so it trimmed the outlier and nothing else, exactly as
  // intended. At the (96,72) floors this file now sees, `walkable/110` reaches
  // 169 and a fixed 64 would be the BINDING term on every deep floor, cutting
  // route furniture from the derived 9.1 per 1k to 3.4 and inverting the
  // guard's purpose. Measured before it moved: route parts per 1k fell with
  // depth on every archetype. 180 is ~6% above the new maximum the rule can
  // ask for, which restores "catches a hostile seed, never the rule".
  const chuteEstimate = chute ? 5 : 0;
  const maxRouteParts = Math.floor((floors.length * 11) / 1000);
  const routeBudget = Math.max(6, Math.min(180, maxRouteParts - chuteEstimate));
  let routeSpent = 0;
  for (let r = 0; r < routes.length; r++) {
    routeSpent += layStationSpine(g, phi, routes[r], start, stairs, parts, items, inChute, {
      padStride: r === 0 ? PAD_STRIDE : ALT_PAD_STRIDE,
      budget: Math.max(0, routeBudget - routeSpent),
    });
  }
  // ── THE LAUNCH CHUTE'S OWN PADS ─────────────────────────────────────────
  // The chute owns its lane outright (`inChute` above bars the station spine
  // from it), so this pass is the only thing that furnishes it.
  if (chute) layLaunchChute(g, chute, parts, torches);
  // ── CIRCUITS DISPLACE, THEY DO NOT ADD ─────────────────────────────────
  //
  // Every other layer here (spine, banks, hazards, rollovers) is measured
  // OUTSIDE the corridor budget, so it never strips the deal. Circuits are
  // deliberately the exception, and they have to be: shipping floors already
  // measured 15.6-28.2 parts per 1k against a ceiling of 34, so a floor with a
  // busy seed has no room for a whole new layer — 22 of 60 floors broke the
  // density band when circuits were budgeted alongside the others rather than
  // out of the same pot.
  //
  // Subtracting them here means the deal gets a smaller allowance and the same
  // floor comes out the same size, with its furniture organised into loops
  // instead of scattered. That is the goal stated exactly: the floor does not
  const corridorBudget = partBudget;
  const byTopo: Record<Topology, TopoSpot[]> = { deadend: [], straight: [], corner: [], junction: [] };
  for (const p of shuffled(floors, rng)) {
    if (p.i === stairs.i && p.j === stairs.j) continue;
    if (Math.abs(p.i - start.i) + Math.abs(p.j - start.j) < 4) continue; // calm start
    if (items.some((it) => it.i === p.i && it.j === p.j)) continue;
    if (inRoom(p)) continue;
    if (inCircuit(p.i, p.j) || inAssembly(p.i, p.j)) continue;
    const spot = classifyTopology(g, p, rng);
    if (spot) byTopo[spot.topo].push(spot);
  }
  // Snapshot the hazard pools BEFORE the corridor deal below pops the topology
  // lists dry — otherwise fire vents (which need a straight) can starve on a
  // busy floor. The spacing check keeps hazards off the dealt parts anyway.
  const hazPoolStraight = byTopo.straight.slice();
  const hazPoolOpen = [...byTopo.junction, ...byTopo.straight];
  const chainCount = extras.chains ?? CHAINS_DEFAULT;
  // ── CHAIN SEEDING (see the header above): lay down shot CHAINS first, so
  // the floor has real "this feeds that" structure before the spacing-driven
  // deal fills in around them. Chains draw on the same corridor budget, so a
  // floor doesn't get busier — it gets more deliberate. ──
  const chainOk = (c: TilePos): boolean =>
    !(c.i === stairs.i && c.j === stairs.j) &&
    Math.abs(c.i - start.i) + Math.abs(c.j - start.j) >= 4 &&
    !items.some((it) => it.i === c.i && it.j === c.j) &&
    !inRoom(c) &&
    !inCircuit(c.i, c.j) &&
    !inAssembly(c.i, c.j) &&
    !parts.some((q) => q.i === c.i && q.j === c.j);

  for (let chain = 0; chain < chainCount && parts.length < corridorBudget; chain++) {
    // Seed on a straight run with genuine runway — the chain's opening shot.
    let cur: TilePos | null = null;
    let dir: { di: number; dj: number } | null = null;
    for (let t = 0; t < CHAIN_TRIES && !cur; t++) {
      const cand = byTopo.straight[Math.floor(rng() * byTopo.straight.length)];
      if (!cand || !chainOk(cand)) continue;
      for (const [di, dj] of shuffled([[cand.dirI, cand.dirJ], [-cand.dirI, -cand.dirJ]] as Array<[number, number]>, rng)) {
        if (launchRunway(g, cand.i, cand.j, di, dj) >= MIN_RUNWAY) {
          cur = { i: cand.i, j: cand.j };
          dir = { di, dj };
          break;
        }
      }
    }
    if (!cur || !dir) break; // this floor has no room for chains

    // Non-null working copies: `dir` is reassigned each link, which loses TS's
    // narrowing on the outer nullable.
    let at_ = { i: cur.i, j: cur.j };
    let di = dir.di;
    let dj = dir.dj;
    parts.push({ kind: "ramp", i: at_.i, j: at_.j, dirI: di, dirJ: dj, dir2I: 0, dir2J: 0, chain: true });

    for (let link = 1; link < CHAIN_LINKS && parts.length < corridorBudget; link++) {
      // Where does the knight actually ARRIVE? Put the next part THERE — that
      // single question is the whole difference between a table and a scatter.
      const land = runwayEnd(g, at_.i, at_.j, di, dj);
      if (!land || !chainOk(land)) break;
      const topo = classifyTopology(g, land, rng);
      if (!topo) break;

      if (topo.topo === "junction") {
        // A crossing: a bumper to carom off, then leave down any other leg.
        parts.push({ kind: "bumper", i: land.i, j: land.j, dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0, chain: true });
        const legs = shuffled(
          WALL_SIDES.filter(([li, lj]) => at(g, land.i + li, land.j + lj) === T_FLOOR && !(li === -di && lj === -dj)) as Array<[number, number]>,
          rng,
        );
        if (legs.length === 0) break;
        di = legs[0][0];
        dj = legs[0][1];
      } else if (topo.topo === "corner") {
        // A bank shot: the deflector sweeps you round onto its other leg.
        parts.push({ kind: "deflector", i: land.i, j: land.j, dirI: topo.dirI, dirJ: topo.dirJ, dir2I: topo.dir2I, dir2J: topo.dir2J, chain: true });
        const backwards = topo.dirI === -di && topo.dirJ === -dj;
        const outI = backwards ? topo.dir2I : topo.dirI;
        const outJ = backwards ? topo.dir2J : topo.dirJ;
        di = outI;
        dj = outJ;
      } else if (topo.topo === "deadend") {
        // The chain terminates in a plunger that fires you back down it.
        parts.push({ kind: "spring", i: land.i, j: land.j, dirI: topo.dirI, dirJ: topo.dirJ, dir2I: 0, dir2J: 0, chain: true });
        break;
      } else {
        // A straight: a ramp keeps the run going down the same lane — but ONLY
        // with genuine runway left. The landing tile is by definition the last
        // floor before something stopped us, so aiming a launcher onward from
        // it is exactly the orphan case the no-orphan invariant forbids.
        if (!(topo.dirI === di && topo.dirJ === dj) && !(topo.dirI === -di && topo.dirJ === -dj)) break;
        if (launchRunway(g, land.i, land.j, di, dj) < MIN_RUNWAY) break;
        parts.push({ kind: "ramp", i: land.i, j: land.j, dirI: di, dirJ: dj, dir2I: 0, dir2J: 0, chain: true });
      }
      at_ = { i: land.i, j: land.j };
    }
  }

  // Deal kinds round-robin (bumpers weighted double — they're the signature
  // part; the Wave-A kinds are threaded through so every floor tastes them)
  // until the budget is spent or every pool is dry. Themes may pass their own
  // deal to bias the floor (a sewer floor deals oil twice, etc.).
  // NB: `deflector` is deliberately NOT dealt into corridors anymore. The deal
  // only ever had a "corner" topology to put it on = a 1-wide dogleg bend, which
  // is exactly the "curved rail in a random place" the real banked corners (the
  // ≥2×2 pocket wedges, rendered in build.ts) are not. Deflectors now come ONLY
  // from the deliberate ORBIT rails framing big rooms (furnishRooms). The flow
  // pass will reintroduce corridor banks on genuinely sweepable corners.
  const deal: PartSpotKind[] = extras.deal ?? ["bumper", "ramp", "spring", "glove", "flipper", "oil", "mirror", "spinpad", "slingshot"];
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
      let spot = spotForKind(kind, cand, rng);
      // PATH-FIRST flow: point a "speed up" part DOWN-FLOW (toward the exit /
      // higher dist-from-start), so it launches you onward instead of back the
      // way you came. `dist` is the BFS-from-start field, already reflecting the
      // widened artery. Occasionally leave it as a deliberate kickback.
      //
      // Aimed on Φ (distance to the STAIRS), not on distance-from-start. The
      // two are not the same field: "further from the spawn" is satisfied by
      // any dead-end branch, so the old test would happily certify a pad firing
      // down a pocket the exit is not in. Φ has one sink, so downhill always
      // means progress — and because every pad in the floor now descends the
      // same scalar, no chain of them can close a loop (flow-orient.ts).
      if (FORWARD_FLOW_KINDS.has(kind) && (spot.dirI !== 0 || spot.dirJ !== 0)) {
        const kick = rng() < KICKBACK_CHANCE;
        if (!kick) {
          // Take the steepest downhill cardinal that the tile's topology allows
          // rather than merely un-reversing the coin flip. On a junction (where
          // a flipper lands) there are up to four legs and "flip it round" can
          // only ever choose between two of them.
          const best = steepestDown(g, phi, spot.i, spot.j);
          if (best && flowDrop(g, phi, spot.i, spot.j, best[0], best[1]) > flowDrop(g, phi, spot.i, spot.j, spot.dirI, spot.dirJ)) {
            spot = { ...spot, dirI: best[0], dirJ: best[1] };
          }
        }
      }
      // No-orphan (Slice 3): a launch part must have RUNWAY in its fire
      // direction, or it just shoots you into a wall a tile away. Flip to the
      // opposite (still-open) side if that has room; else skip this candidate.
      if (LAUNCH_KINDS.has(kind) && (spot.dirI !== 0 || spot.dirJ !== 0)) {
        if (launchRunway(g, spot.i, spot.j, spot.dirI, spot.dirJ) < MIN_RUNWAY) {
          // A forward-flow part must NOT be flipped backward just to find runway
          // — that's exactly how a ramp ends up pointing home. Skip this spot and
          // let the deal try a tile where onward IS open (there are plenty).
          if (FORWARD_FLOW_KINDS.has(kind)) continue;
          if (launchRunway(g, spot.i, spot.j, -spot.dirI, -spot.dirJ) >= MIN_RUNWAY) {
            spot = { ...spot, dirI: -spot.dirI, dirJ: -spot.dirJ };
          } else {
            continue; // orphan — nothing to launch into either way
          }
        }
      }
      parts.push(spot);
      placed = true;
      break;
    }
    dry = placed ? 0 : dry + 1;
  }

  // ── SPARSE-REGION FILL — the 4× density backstop the area change never got.
  // The deal above spreads by TOPOLOGY but nothing spatial stops the budget
  // clustering around the artery: on a ~26k-tile floor, whole quadrants shipped
  // with zero machine. Partition the grid into coarse screen-sized cells; every
  // cell that still has an unused junction candidate and NO part of any kind
  // yet gets one omni part (bumper, spinpad every third — no fire direction, so
  // none of the runway/orphan invariants apply). One part per empty region:
  // area-proportional by construction, so density now rides the floor size.
  //
  // ── WHY THE REGION IS THE SIZE IT IS (2026-07-31) ─────────────────────
  //
  // 24 was "~one screen of maze", which is a framing rule, not a coverage one.
  // This is the only pass on the floor whose supply is proportional to AREA:
  // the route layer lays furniture along the artery (1-D, so it scales with
  // path length), the chains follow exit rays, and the corridor deal is a flat
  // budget. So when floors grew, everything else scaled with a LENGTH and this
  // was the one term that could have held density — throttled to one part per
  // 576 tiles.
  //
  // Sized against the metric instead. `maze/open-space.ts` defines R_DEAD = 12
  // tiles as the distance past which a stretch reads as blank. A region of side
  // S guaranteed to hold at least one part leaves a worst case of ~0.7·S within
  // a region and up to ~1.4·S across two adjacent ones, so S = R_DEAD makes the
  // guarantee and the threshold the same number rather than two unrelated ones.
  //
  // This does NOT simply multiply the part count by four: the pass fires only
  // into regions holding NO part at all, so it is a floor under the density
  // rather than an addition to it. Dense regions still receive nothing.
  const REGION = 12; // tiles per coarse cell side — one R_DEAD, see above
  const regW = Math.ceil(g.w / REGION);
  const regionOf = (i: number, j: number): number => Math.floor(j / REGION) * regW + Math.floor(i / REGION);
  const filledRegions = new Set(parts.map((p) => regionOf(p.i, p.j)));
  const fillPools = new Map<number, TopoSpot[]>();
  for (const c of byTopo.junction) {
    const r = regionOf(c.i, c.j);
    const pool = fillPools.get(r) ?? [];
    if (pool.length === 0) fillPools.set(r, pool);
    pool.push(c);
  }
  // ── …AND THE CEILING THAT STOPS COVERAGE BECOMING CLUTTER ──────────────
  //
  // The fill is a FLOOR under density, so where it meets the ceiling the
  // ceiling wins. Without this it does not: at REGION = R_DEAD a SMALL floor
  // has enough regions relative to its area to push past `maxPartsPer1k` on its
  // own. Measured — L1 ringkeep at ~2.2k walkable came out at 38.8 and 35.4 per
  // 1k against `floor-density`'s ceiling of 34, while every large floor stayed
  // in band. Coverage is what a big floor is short of; a small one already has
  // it, and there the same rule only crowds.
  //
  // The ceiling is a TARGET DENSITY MINUS A RESERVE, and the reserve is what
  // makes it work on both ends of the size range.
  //
  // First attempt was a flat per-1k ceiling, and it failed: this pass runs
  // BEFORE the vault ramps, the hazard layer, the chute pads and the targets,
  // and those add a roughly CONSTANT number of parts per floor rather than a
  // per-area one — measured at ~35 on the offending floor. Constant overhead is
  // 16 per 1k on a 2.1k-tile floor and under 2 per 1k on an 18.7k one, so no
  // single per-1k figure can both spare the small floor and leave the big one
  // alone. A flat 28 still landed at 38.8, and tightening it far enough to fix
  // that would have clawed back the coverage this whole change bought.
  //
  // So: aim at FILL_TARGET_PER_1K of the finished floor and hand FILL_RESERVE
  // parts to the passes downstream. On a 2.1k floor that allows 24 and the
  // floor finishes near 28 per 1k; on an 18.7k floor it allows 523 against a
  // floor that finishes around 337, so it never binds where coverage is the
  // thing actually in short supply.
  const FILL_TARGET_PER_1K = 28;
  const FILL_RESERVE = 40;
  const fillMax = Math.floor((floors.length * FILL_TARGET_PER_1K) / 1000) - FILL_RESERVE;
  let fillCount = 0;
  for (const [r, pool] of fillPools) {
    if (filledRegions.has(r)) continue;
    if (parts.length >= fillMax) break;
    const cand = pool.find((c) => !parts.some((q) => Math.abs(q.i - c.i) + Math.abs(q.j - c.j) < 3));
    if (!cand) continue;
    parts.push(spotForKind(++fillCount % 3 === 0 ? "spinpad" : "bumper", cand, rng));
    filledRegions.add(r);
  }

  // ── VAULT RAMPS: the ramps that actually jump the maze.
  //
  // Every other ramp sits on a "straight" tile, which by definition aims ALONG
  // the corridor — and the launch-target invariant then guarantees open runway
  // on that exact ray. So the hop's landing scan always found floor on its first
  // sample and set down in the same lane: the ramp could never clear a wall,
  // because there was never a wall in front of it. These are dealt the opposite
  // way — aimed square at a band with real corridor on the far side, close
  // enough that RAMP_HOP_MAX reaches it. Marked `vault` so openLaunchTargets
  // doesn't "repair" them back into ordinary dash pads. ──
  const vaultRamps = extras.vaultRamps ?? VAULT_RAMPS_DEFAULT;
  {
    const vaultSpots = shuffled(floors, rng);
    let placedVaults = 0;
    for (const c of vaultSpots) {
      if (placedVaults >= vaultRamps) break;
      if (Math.abs(c.i - start.i) + Math.abs(c.j - start.j) < 4) continue;
      if (c.i === stairs.i && c.j === stairs.j) continue;
      if (inRoom(c)) continue;
      if (parts.some((q) => Math.abs(q.i - c.i) + Math.abs(q.j - c.j) < 3)) continue;
      // Aim at whichever cardinal has a crossable band. Shuffle so a floor
      // doesn't end up with every vault pointing the same way.
      const dirs = shuffled([...CARDINALS] as Array<readonly [number, number]>, rng);
      let aimed: { di: number; dj: number } | null = null;
      for (const [di, dj] of dirs) {
        if (crossableBand(g, c.i, c.j, di, dj)) {
          aimed = { di, dj };
          break;
        }
      }
      if (!aimed) continue;
      // A JUMP PAD, not a ramp. The flight is the same call (`startRampHop`),
      // but the part that causes it is now its own kind with its own mesh —
      // previously the one shot per floor that jumps the maze was visually
      // identical to the twenty dash ramps that don't, and read as a launcher
      // bolted point-blank to a wall, which is what it looks like when you
      // can't tell it is going to fly.
      parts.push({
        kind: "jumppad",
        i: c.i,
        j: c.j,
        dirI: aimed.di,
        dirJ: aimed.dj,
        dir2I: 0,
        dir2J: 0,
        vault: true,
      });
      placedVaults++;
    }
  }

  // ── BOOSTER TRIBUTARIES: short off-spine booster runs that MERGE onto the
  // station spine — a side channel whose last pad throws you onto the highway,
  // never a lane that dead-ends into blank corridor (the old standalone-lane bug
  // the user hit: "gets pushed but feeds into nothing"). A run only counts if the
  // tile just past its forward end is on (or touching) the spine, so every
  // tributary literally feeds the route. Its own layer over the part budget. ──
  const TRIB_COUNT = extras.boosterLanes ?? 2;
  const LANE_LEN = 3;
  const laneAxes: Array<[number, number]> = [[1, 0], [0, 1]];
  const touchesSpine = (i: number, j: number): boolean =>
    onSpine(i, j) || WALL_SIDES.some(([di, dj]) => onSpine(i + di, j + dj));
  let lanesPlaced = 0;
  laneSearch: for (const p of shuffled(floors, rng)) {
    if (lanesPlaced >= TRIB_COUNT) break;
    if (inRoom(p) || onSpine(p.i, p.j) || Math.abs(p.i - start.i) + Math.abs(p.j - start.j) < 5) continue;
    for (const [ai, aj] of shuffled(laneAxes, rng)) {
      // The LANE_LEN pad tiles must be floor, off the spine, clear of other
      // parts, not stairs. Wide corridors are fine — the pads snap your heading.
      const padsOk = [0, 1, 2].every(
        (s) =>
          at(g, p.i + ai * s, p.j + aj * s) === T_FLOOR &&
          !onSpine(p.i + ai * s, p.j + aj * s) &&
          !(p.i + ai * s === stairs.i && p.j + aj * s === stairs.j),
      );
      const clear = [0, 1, 2].every((s) => !parts.some((q) => Math.abs(q.i - (p.i + ai * s)) + Math.abs(q.j - (p.j + aj * s)) < 2));
      if (!padsOk || !clear) continue;
      // The run must FEED THE SPINE: one of its two ends spills onto the highway.
      // Point the pads toward whichever end does (preferring the down-flow one).
      const fwdI = p.i + ai * LANE_LEN;
      const fwdJ = p.j + aj * LANE_LEN; // one past the last pad
      const bwdI = p.i - ai;
      const bwdJ = p.j - aj; // one before the first pad
      const fwdFeeds = at(g, fwdI, fwdJ) === T_FLOOR && touchesSpine(fwdI, fwdJ) && !(fwdI === stairs.i && fwdJ === stairs.j);
      const bwdFeeds = at(g, bwdI, bwdJ) === T_FLOOR && touchesSpine(bwdI, bwdJ) && !(bwdI === stairs.i && bwdJ === stairs.j);
      if (!fwdFeeds && !bwdFeeds) continue; // doesn't reach the spine — not a tributary
      // If both ends feed it, pick the down-flow one; else the one that feeds.
      // Down-flow on Φ = the LOWER distance-to-stairs end.
      let sign: number;
      if (fwdFeeds && bwdFeeds) sign = phiAt(g, phi, fwdI, fwdJ) <= phiAt(g, phi, bwdI, bwdJ) ? 1 : -1;
      else sign = fwdFeeds ? 1 : -1;
      // A tributary that merges UPHILL feeds the route backwards: it throws you
      // onto the highway pointing at the spawn, which is the "speed up that
      // sends you back" complaint with an extra step. Skip it — the search has
      // plenty of other candidates and half a tributary is worse than none.
      if (!isDownhill(g, phi, p.i, p.j, ai * sign, aj * sign)) continue;
      for (let s = 0; s < LANE_LEN; s++) {
        parts.push({ i: p.i + ai * s, j: p.j + aj * s, kind: "booster", dirI: ai * sign, dirJ: aj * sign, dir2I: 0, dir2J: 0 });
      }
      lanesPlaced++;
      continue laneSearch;
    }
  }

  // ── ROLLOVER LANE ARRAYS (D3) — the inlane/outlane bank every real table has.
  //
  // Booster lanes above are single-file rows of pads all aimed the same way.
  // This is the other thing: N lanes running PARALLEL, side by side ACROSS a
  // corridor, each with its own lit state. Roll over a lane to light it; light
  // them all for a payout; tap dodge to ROTATE which lanes are lit so you can
  // set up the last one you need (the classic lane change). Its own layer over
  // the part budget, like banks and hazards. ──
  const ROLLOVER_ARRAYS = extras.rolloverArrays ?? ROLLOVER_ARRAYS_DEFAULT;
  let arraysPlaced = 0;
  let laneNext = 0;
  arraySearch: for (const p of shuffled(floors, rng)) {
    if (arraysPlaced >= ROLLOVER_ARRAYS) break;
    if (inRoom(p) || Math.abs(p.i - start.i) + Math.abs(p.j - start.j) < 5) continue;
    // The array lies ACROSS the direction of travel: find an axis with a run of
    // lanes side by side, and open floor on both sides along the travel axis so
    // you can actually roll THROUGH the bank rather than into a wall.
    for (const [ai, aj] of shuffled([[1, 0], [0, 1]] as Array<[number, number]>, rng)) {
      const ti = aj; // travel axis = perpendicular to the array
      const tj = ai;
      const cells = Array.from({ length: ROLLOVER_LANES }, (_, s) => ({ i: p.i + ai * s, j: p.j + aj * s }));
      const ok = cells.every(
        (c) =>
          at(g, c.i, c.j) === T_FLOOR &&
          !(c.i === stairs.i && c.j === stairs.j) &&
          at(g, c.i + ti, c.j + tj) === T_FLOOR && // you can roll in…
          at(g, c.i - ti, c.j - tj) === T_FLOOR && // …and out the other side
          !inRoom(c) &&
          !items.some((it) => it.i === c.i && it.j === c.j) &&
          !parts.some((q) => Math.abs(q.i - c.i) + Math.abs(q.j - c.j) < 2),
      );
      if (!ok) continue;
      const arrayId = laneNext++;
      cells.forEach((c, s) => {
        parts.push({ kind: "rollover", i: c.i, j: c.j, dirI: ti, dirJ: tj, dir2I: 0, dir2J: 0, lane: arrayId, laneSeq: s });
      });
      arraysPlaced++;
      continue arraySearch;
    }
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

  // ── Target BANK (Slice 6): one row of 3 drop-targets on a shared wall, to be
  // lit in 1-2-3 order for a bonus. Find a straight-corridor run whose 3
  // consecutive tiles share a wall on the SAME perpendicular side. Best-effort:
  // some floors won't host one, which is fine (it's a bonus objective). ──
  const bankAxes: Array<[number, number]> = [[1, 0], [0, 1]];
  bankSearch: for (const p of shuffled(floors, rng)) {
    if (inRoom(p) || Math.abs(p.i - start.i) + Math.abs(p.j - start.j) < 6) continue;
    for (const [ai, aj] of bankAxes) {
      const wi = -aj;
      const wj = ai; // perpendicular = the candidate shared wall side
      const runOk = [0, 1, 2].every(
        (s) => at(g, p.i + ai * s, p.j + aj * s) === T_FLOOR && at(g, p.i + ai * s + wi, p.j + aj * s + wj) === T_WALL,
      );
      const clear = [0, 1, 2].every((s) => !parts.some((q) => q.i === p.i + ai * s && q.j === p.j + aj * s));
      if (!runOk || !clear) continue;
      for (let s = 0; s < 3; s++) {
        parts.push({ i: p.i + ai * s, j: p.j + aj * s, kind: "target", dirI: wi, dirJ: wj, dir2I: 0, dir2J: 0, bank: 0, seq: s });
      }
      break bankSearch; // one bank per floor
    }
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

  // ── Floor HAZARDS (pit / electric / fire vent / magnet strip) — their own
  // layer over the part budget, dealt round-robin onto suitable topology:
  // pits + plates + strips want open floor; vents mount on a corridor wall. ──
  const hazardBudget = extras.hazards ?? 4;
  const hazardDeal: PartSpotKind[] = ["pit", "firevent", "electric", "magstrip", "electric", "pit"];
  let hazIdx = 0;
  let hazDry = 0;
  const hazStraights = hazPoolStraight;
  const hazOpen = hazPoolOpen;
  const HAZARD_KINDS = new Set(["pit", "firevent", "electric", "magstrip"]);
  // Strict straights are almost nonexistent in 2-wide corridors, so a fire
  // vent mounts wall-adjacent (like a torch) and jets INTO the open — its lane
  // direction is AWAY from the wall it's bolted to. Suppress the snapshot ref.
  void hazStraights;
  let placedHaz = 0;
  while (placedHaz < hazardBudget && hazDry < hazardDeal.length) {
    const kind = hazardDeal[hazIdx % hazardDeal.length];
    hazIdx++;
    const pool = hazOpen;
    let placed = false;
    while (pool.length > 0) {
      const cand = pool.pop()!;
      // Hazards are their OWN layer: they may sit near a machine part (a vent
      // by a ramp is fine) but never ON a part's tile, and stay spaced from
      // each other so a floor isn't a minefield.
      if (parts.some((q) => q.i === cand.i && q.j === cand.j)) continue;
      if (parts.some((q) => HAZARD_KINDS.has(q.kind) && Math.abs(q.i - cand.i) + Math.abs(q.j - cand.j) < 3)) continue;
      if (Math.abs(cand.i - start.i) + Math.abs(cand.j - start.j) < 5) continue; // calm start
      if (cand.i === stairs.i && cand.j === stairs.j) continue;
      if (kind === "firevent") {
        // needs a wall to bolt to whose OPPOSITE side is open floor — the jet
        // (dir = away from the wall) has to fire into the corridor, not a wall.
        const wall = WALL_SIDES.find(
          ([di, dj]) => at(g, cand.i + di, cand.j + dj) === T_WALL && at(g, cand.i - di, cand.j - dj) === T_FLOOR,
        );
        if (!wall) continue;
        parts.push({ i: cand.i, j: cand.j, kind: "firevent", dirI: -wall[0], dirJ: -wall[1], dir2I: 0, dir2J: 0 });
        placed = true;
        placedHaz++;
        break;
      }
      parts.push(spotForKind(kind, cand, rng));
      placed = true;
      placedHaz++;
      break;
    }
    hazDry = placed ? 0 : hazDry + 1;
  }

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
    // A prefab drops its signature parts into an OPEN room, where a junction
    // tile classifies with no axis (dirI=dirJ=0). A directional part
    // (spring/ramp/glove/slingshot/trapdoor) with a zero axis fires nowhere —
    // a spring that doesn't launch, a ramp that doesn't dash. Aim it down any
    // open neighbour so a stamped part always actually does its thing.
    if (c.dirI === 0 && c.dirJ === 0) {
      const openDir = WALL_SIDES.find(([di, dj]) => at(g, a.i + di, a.j + dj) === T_FLOOR);
      if (openDir) {
        c.dirI = openDir[0];
        c.dirJ = openDir[1];
      }
    }
    parts.push(spotForKind(a.kind, c, rng));
  }

  // ── A1 LAUNCH BREAK-THROUGHS: open a smashable band at the end of launch-part
  // runways so a fast player punches through into new space (see fn). Runs AFTER
  // all parts + torches so it can avoid furnished walls, and BEFORE the secrets
  // scan below so its new bands are collected like any other crack. ──
  openLaunchTargets(g, parts, torches, rng, extras.launchBreaks ?? 6);

  // ── THE ORBIT ISLAND'S BUMPERS ──────────────────────────────────────────
  //
  // The island itself is GEOMETRY and is stamped by the maze layer now
  // (track-floor.ts); what belongs here is the content that dresses it. The
  // caller passes the centre it built.
  //
  // `occupiedKeys` used to exist to stop the wall-adding stamps eating placed
  // content. With the geometry authored first that job is gone, and what
  // remains is the ordinary "don't put a bumper on a torch" bookkeeping.
  const occupiedKeys = new Set<number>();
  const claim = (t: { i: number; j: number } | null | undefined): void => {
    if (!t) return;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) occupiedKeys.add((t.j + dj) * g.w + (t.i + di));
  };
  claim(start);
  claim(stairs);
  for (const s of spawns) claim(s);
  for (const it of items) claim(it);
  for (const p of props) claim(p);
  for (const p of parts) claim(p);
  for (const t of torches) claim(t);
  claim(frog);
  const occupied = (i: number, j: number): boolean => occupiedKeys.has(j * g.w + i);
  const orbit = extras.orbit ?? null;
  if (orbit) {
    // Two bumpers flanking the ring turn the orbit into a real pinball toy.
    for (const [di, dj] of [[0, -1], [0, 1]] as const) {
      const bi = Math.round(orbit.ci + di * 4) ;
      const bj = Math.round(orbit.cj + dj * 4);
      if (at(g, bi, bj) === T_FLOOR && !occupied(bi, bj) && !parts.some((p) => p.i === bi && p.j === bj)) {
        parts.push({ i: bi, j: bj, kind: "bumper", dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0 });
        claim({ i: bi, j: bj });
      }
    }
  }

  const plazas = polishParts(g, parts, rng, floors.length);

  // ── Secrets: collect every CRACKED band stamped by crackSecretWalls. After
  // thickenWalls a raw crack is a 2×2 band whose top-left tile has even coords
  // — that top-left is the band's handle (build.ts + secrets.ts key off it). ──
  const secrets: TilePos[] = [];
  for (let j = 0; j < g.h - 1; j += 2) {
    for (let i = 0; i < g.w - 1; i += 2) {
      if (at(g, i, j) === T_CRACKED) secrets.push({ i, j });
    }
  }

  // ── ARC SWEEPS ARE NOT AUTHORED HERE ANY MORE ───────────────────────────
  //
  // `authorArcSweeps` used to run at this point — inside the content pass,
  // after every zombie, torch, item and part had been placed, converting 44.9
  // tiles per floor from floor to wall. It now runs in `buildTrackFloor`, with
  // the rest of the wall geometry, before any of this exists. See the block in
  // track-floor.ts for the measurements and the reasoning.
  //
  // The legacy (non-track) generator has no equivalent stage of its own, so a
  // caller that passes no `endpoints`/track floor simply gets no sweeps. That
  // is deliberate: `TRACK_FIRST` is the shipping path, and duplicating the
  // authoring here to serve the A/B branch would recreate exactly the two-owner
  // situation this change exists to end.
  const newParts = parts.filter((p) => !occupiedKeys.has(p.j * g.w + p.i));
  for (const p of newParts) claim(p); // polishParts may have added plaza bumpers

  // ── RUNWAY RE-AIM: the curves authored upstream can wall a launch part's
  // lane after placement validated it — the sweeps run before placement now,
  // but `openLaunchTargets` and the banks above still move walls, and a
  // launcher facing rock is the defect either way. Final pass: any
  // non-vault/non-spine launch part
  // whose fire lane dropped below MIN_RUNWAY re-aims to its longest open
  // cardinal (ties broken toward down-flow); if no direction has room it stays
  // put — it was topology-validated at placement and only degrades to a bumper
  // -feel, not a hard bug. ──
  for (const p of parts) {
    // `strictLaunchers` (track floors) drops the vault/spine exemption: those
    // floors are generated geometry, not authored set-pieces, so a facing that
    // points into a wall carries no intent worth preserving. On the legacy
    // generator the exemption stays — see the note below.
    if (p.chute) continue; // the plunger lane owns its facings — see PinballPartSpot.chute
    // ── VAULT IS EXEMPT UNCONDITIONALLY, and `strictLaunchers` no longer lifts
    // it. This was a real bug, not a tuning choice.
    //
    // `strictLaunchers` is on for every track floor, and its rationale — "a
    // vault or spine part facing a wall carries no intent worth preserving" —
    // is sound for `spine` and false for `vault`. A vault part is aimed at a
    // wall BAND that `crossableBand` has already proved is 1-2 tiles thick with
    // real corridor behind it, inside RAMP_HOP_MAX. Facing rock is the feature.
    //
    // The consequence was total: a vault part's runway is 0 by construction, so
    // it failed the MIN_RUNWAY test below on every floor, and this pass then
    // re-aimed it down the longest open corridor — turning the floor's only
    // jump-the-maze shot into an ordinary dash pad, silently, on every track
    // floor since `strictLaunchers` shipped. The kind survived; the feature did
    // not.
    if (p.vault || p.circuit !== undefined || p.asm !== undefined) continue;
    if ((!strictLaunchers && p.spine) || !LAUNCH_KINDS.has(p.kind)) continue;
    if (Math.abs(p.dirI) + Math.abs(p.dirJ) !== 1) continue;
    if (launchRunway(g, p.i, p.j, p.dirI, p.dirJ) >= MIN_RUNWAY) continue;
    // VAULT and SPINE stay exempt, and it is worth saying why rather than
    // leaving it to be "simplified" later. Both were pulled INTO this pass at
    // one point to chase the last few wall-facing launchers, and both broke a
    // real invariant that the generic launchers do not carry:
    //   · a SPINE booster must shove the player DOWN-FLOW toward the exit
    //     (decorate.test pins it), and re-aiming for runway alone reverses it;
    //   · `breakLaunchDuels` deliberately refuses to move spine parts, so
    //     anything that changes their facing here fights that pass and loses.
    //   · a VAULT is a sealed authored set-piece whose geometry is its own.
    // The wall-facing launchers those two produce are handled at the source
    // instead — the track generator no longer builds the dead-end geometry
    // that stranded them (maze/track-socket.ts).
    //
    // DOWNHILL FIRST, longest-runway second. The old rule was runway alone with
    // "ties broken toward down-flow", which only ever fired on an exact tie —
    // and an exact tie between two corridor lengths is rare, so in practice the
    // re-aim was free to point a pad back up the floor whenever the backward
    // lane happened to be one tile longer. Since this pass runs after placement
    // it was quietly undoing the orientation work above.
    let bestRun = -1;
    let bestD: [number, number] | null = null;
    let bestDown = false;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const run = launchRunway(g, p.i, p.j, di, dj);
      if (run < MIN_RUNWAY) continue;
      const down = isDownhill(g, phi, p.i, p.j, di, dj);
      if (bestD && bestDown && !down) continue; // never trade downhill for length
      if (bestD && down === bestDown && run <= bestRun) continue;
      bestRun = run;
      bestD = [di, dj];
      bestDown = down;
    }
    // ── A ROUTE PART MAY NOT BE SAVED BY POINTING IT UPHILL ─────────────────
    //
    // "Downhill first, longest second" ranks correctly but does not REFUSE, so
    // when no direction is both open and downhill the loop above still returns
    // the longest uphill lane and this pass installs it. On a loose corridor
    // part that is the right trade — it is furniture, and 12% of it kicks back
    // on purpose. On a SPINE part it is not: the routes are the floor's one-way
    // structure, and a road that shoves you back up itself is the "speed-up
    // that sends you home" complaint with extra steps.
    //
    // Found by the furniture piece gate on decorated floors — 3 of 30, one part
    // each — which is exactly the class of defect that survives because every
    // pass upstream is individually right. Placement gated on downhill; this
    // pass then overwrote it. Demote instead, using the same ladder as the
    // no-runway case below.
    const routeUphill = p.spine && bestD !== null && !bestDown;
    if (bestD && bestRun >= MIN_RUNWAY && !routeUphill) {
      p.dirI = bestD[0];
      p.dirJ = bestD[1];
    } else {
      // NO direction has a runway. The old behaviour was to leave it facing a
      // wall on the reasoning that it "only degrades to a bumper-feel, not a
      // hard bug" — but that is the visible defect: a booster aimed point-blank
      // into a curved wall, which is nonsense to look at and does nothing when
      // hit. Measured 8.7% of launchers firing into a wall within 3 tiles.
      //
      // Demote instead of delete: `bumper` is the omnidirectional part, so the
      // spot still has furniture and the density budget still balances, but it
      // no longer claims a direction it cannot honour.
      p.kind = "bumper";
      p.dirI = 0;
      p.dirJ = 0;
      // KEEP the spine badge. Clearing it was tried and it breaks a different
      // invariant: `breakLaunchDuels` deliberately refuses to move spine parts
      // (a spine-vs-spine duel is handed to the runtime guard instead), so
      // un-badging a demoted part turns something protected into something
      // movable and the duel breaker then re-aims it into a fresh duel. The
      // badge means "sits on the authored route", which is still true — the
      // part just no longer has a direction, and every consumer already gates
      // on `Math.abs(dirI)+Math.abs(dirJ) === 1`.
    }
  }

  // ── LAUNCH DUELS: with every facing now final (placement, the A1 repair and
  // the post-sweep re-aim above have all had their say), break any pair of
  // launchers left aimed down one open lane at each other — the ping-pong trap.
  // Must be the LAST pass that touches a part's direction. ──
  breakLaunchDuels(g, parts);
  // ── …AND EVERY OTHER CLOSED LOOP (maze/flow-loops.ts). The duel breaker only
  // knows the 2-cycle, and only the half of it where neither part is on a
  // route: measured on the shipping generator it left 1.58 duels per floor
  // standing, 121 of 123 of them spine-vs-spine, plus 130 launchers in rings of
  // three or more that it cannot represent at all. This pass walks the whole
  // successor graph, so "no chain of shoves closes" is decided rather than
  // approximated. It runs after the duel breaker, not instead of it — the
  // pairwise pass is cheaper and resolves the easy cases with a re-aim this one
  // would spend a demotion on. ──
  breakFlowLoops(g, phi, parts);

  // ── THE LAUNCH CHUTE IS THE CHUTE PASS'S ALONE ──────────────────────────
  //
  // Withholding the chute's tiles from `floors` keeps every pass that PICKS a
  // candidate tile out of the lane, but not the ones that place at an OFFSET
  // from one — the booster tributaries and the rollover/target arrays walk
  // `p + dir * s` and never re-check where they landed. Measured: one unbadged
  // booster inside the lane, aimed across it.
  //
  // Chasing each offset-walking pass individually is the wrong shape (the next
  // one added would have the same hole), so the invariant is enforced once,
  // here, after everything has placed: anything in the lane that is not the
  // chute's own is removed. It is a removal rather than a re-aim because the
  // lane's furniture is authored, not negotiated — see layLaunchChute.
  if (chute) {
    for (let k = parts.length - 1; k >= 0; k--) {
      const q = parts[k];
      if (q.chute) continue;
      if (inChute(q.i, q.j)) parts.splice(k, 1);
    }
  }

  // ── Shaped walls: bevel convex outer corners into 45° slants (tile-shape.ts).
  // LAST tile mutation, so the topology it reads (rooms, corridors, launch
  // break-throughs, secrets) is final. Only reshapes existing walls — never
  // changes walkability, so AI/flow-field/spawns are unaffected. ──
  assignCornerShapes(g);

  // ── ITEM RARITY, stamped in ONE place ──
  // Every weapon/gear drop on this floor rolls its rarity here rather than at
  // the half-dozen `items.push(...)` sites, so a new drop site cannot forget to
  // roll and silently ship a common. Uses the floor's SEEDED rng, which is what
  // keeps co-op peers agreeing on what dropped where.
  const floorNo = extras.floor ?? 1;
  for (const it of items) {
    if (it.kind === "potion") continue;
    it.rarity = rollItemRarity(floorNo, rng);
  }

  // === THE PLAZA PARTS =====================================================
  //
  // These three passes run LAST, after `rollItemRarity`, and that position is
  // the design — not tidiness.
  //
  // `buildLevel` draws every placement phase from ONE rng stream, so inserting
  // a draw anywhere changes every draw after it: a completely different floor
  // that renders fine and breaks no test. The floor-census script under
  // scripts/ exists for exactly that hazard. Adding three kinds to `deal` would
  // have re-rolled the whole floor from that point on, and made "what did the
  // new parts change?" unanswerable, because everything would have changed.
  //
  // Placed at the very end, every existing phase — down to which weapons rolled
  // rare — is bit-identical to before. The only difference between a floor
  // built now and the same seed built yesterday is the new furniture itself.
  //
  // The cost of sitting after the launch-chute sweep is that these passes have
  // to honour `inChute` themselves, which `freeFor` does. That is one explicit
  // check, against re-rolling every floor in the game.

  // ── HOW MANY: WHAT THIS FLOOR CAN STILL TAKE, MEASURED. ────────────────
  //
  // The first version placed 2 arms + 3 wheels + 3 nine-part fields on every
  // floor — 32 parts, flat. `maze/floor-density.test.ts` caps parts at 34 per
  // 1000 walkable tiles for legibility (the number is derived: at 34/1k the
  // mean spacing is 2.7 tiles, one part crossing your line every 0.18 s at
  // booster speed, already at the edge of reading as an event rather than a
  // texture). The flat version breached it on 30 of 60 sampled floors, peaking
  // at 41.2/1k.
  //
  // The obvious second attempt — scale the counts by floor AREA, the way
  // `plazaCap` and the alt-route count do — got it down to 7 of 60 and no
  // further, because AREA IS NOT THE CONSTRAINT. Measured spare capacity under
  // the cap, per floor:
  //
  //     ringkeep/L1   2234 walkable   30.4/1k    7 parts spare
  //     ringkeep/L6   4367 walkable   32.1/1k    8 parts spare   <- twice the
  //     warrens/L20  17773 walkable   19.0/1k  267 parts spare      area, same
  //
  // A dense small floor has less room than a sparse one twice its size, so any
  // divisor tuned to satisfy the tight floors starves the big ones and vice
  // versa. What the passes actually need to know is how much room is LEFT, and
  // by this point in the function that is simply readable: every other part is
  // already placed.
  //
  // So it is measured. The passes spend a share of the real remainder, which is
  // self-correcting — if another pass upstream ever starts placing more, these
  // quietly place less instead of breaching a gate.
  const PARTS_PER_1K_CAP = 31; // maze/floor-density.ts DEFAULT_DENSITY.maxPartsPer1k (cushioned)
  // Spend HALF of what is left, not most of it. 0.7 was the first number and it
  // came out at 34.14/1k on one seed — over a cap of 34 — because the budget's
  // denominator and the gate's are not the same measurement: this counts
  // `floors.length`, the candidate tiles this pass may build on, while
  // `floor-density.ts` counts `walkableCount(grid)`. They are close and they are
  // not equal, so a budget that spends right up to the line breaches it
  // whenever the two disagree in the wrong direction. Half leaves room for that
  // gap without needing the two counts to be reconciled.
  const PLAZA_SHARE = 0.65;
  let plazaBudget = Math.max(
    12,
    Math.floor((Math.floor((PARTS_PER_1K_CAP * floors.length) / 1000) - parts.length) * PLAZA_SHARE),
  );
  /** Take `n` parts' worth of the remaining budget, or refuse. */
  const spend = (n: number): boolean => {
    if (plazaBudget < n) return false;
    plazaBudget -= n;
    return true;
  };

  /** Free floor: not the ends, not the plunger lane, nothing already placed. */
  const freeFor = (i: number, j: number, clearance: number): boolean => {
    if (at(g, i, j) !== T_FLOOR) return false;
    if (i === stairs.i && j === stairs.j) return false;
    if (i === start.i && j === start.j) return false;
    if (inChute(i, j)) return false;
    if (items.some((it) => it.i === i && it.j === j)) return false;
    if (torches.some((t) => t.i === i && t.j === j)) return false;
    return !parts.some((q) => Math.max(Math.abs(q.i - i), Math.abs(q.j - j)) <= clearance);
  };

  // -- SWINGARMS -- a bar with a hand on the end, sweeping a circle.
  //
  // The hand reaches SWINGARM_LEN tiles from the hub, so the arm needs a CLEAR
  // DISC around it or it sweeps through rock — an arm that spends most of its
  // rotation inside a wall only works from one side, which is the opposite of
  // what a sweeping hazard is for. Radius 2 covers the reach plus the hand's
  // own radius with a tile to spare.
  let armsPlaced = 0;
  const ARM_R = 2;
  for (const ap of shuffled(floors, rng)) {
    if (armsPlaced >= (extras.swingarms ?? SWINGARMS_MAX)) break;
    if (plazaBudget < 1) break;
    if (Math.abs(ap.i - start.i) + Math.abs(ap.j - start.j) < 6) continue; // not on the doorstep
    if (!freeFor(ap.i, ap.j, 2)) continue;
    let clear = true;
    for (let dj = -ARM_R; dj <= ARM_R && clear; dj++) {
      for (let di = -ARM_R; di <= ARM_R; di++) {
        if (di * di + dj * dj > ARM_R * ARM_R) continue;
        if (at(g, ap.i + di, ap.j + dj) !== T_FLOOR) {
          clear = false;
          break;
        }
      }
    }
    if (!clear) continue;
    // Both directions on a floor, and a phase seed per arm, so two of these in
    // one region read as a rhythm you time rather than as a matched pair.
    if (!spend(1)) break;
    parts.push({
      kind: "swingarm",
      i: ap.i,
      j: ap.j,
      dirI: 0,
      dirJ: 0,
      dir2I: 0,
      dir2J: 0,
      spin: rng() < 0.5 ? 1 : -1,
      phase: rng() * Math.PI * 2,
    });
    armsPlaced++;
  }

  // -- FLYWHEELS -- two counter-rotating wheels you shoot through.
  //
  // Needs a straight run: floor two tiles back to enter from and two ahead to
  // be thrown down, or the barrel fires into a wall. Aimed DOWN-FLOW off the
  // flow field for the same reason the speedway lanes are — a launcher that
  // throws you back toward the door is the "speed up that sends you back" bug.
  let wheelsPlaced = 0;
  wheelSearch: for (const wp of shuffled(floors, rng)) {
    if (wheelsPlaced >= (extras.flywheels ?? FLYWHEELS_MAX)) break;
    if (plazaBudget < 1) break;
    if (!freeFor(wp.i, wp.j, 2)) continue;
    for (const [ai, aj] of shuffled([[1, 0], [0, 1]] as Array<[number, number]>, rng)) {
      const run = [-2, -1, 1, 2].every((k) => at(g, wp.i + ai * k, wp.j + aj * k) === T_FLOOR);
      if (!run) continue;
      const fwd = phiAt(g, phi, wp.i + ai * 2, wp.j + aj * 2);
      const bwd = phiAt(g, phi, wp.i - ai * 2, wp.j - aj * 2);
      const sign = fwd <= bwd ? 1 : -1;
      if (!spend(1)) break wheelSearch;
      parts.push({ kind: "flywheel", i: wp.i, j: wp.j, dirI: ai * sign, dirJ: aj * sign, dir2I: 0, dir2J: 0 });
      wheelsPlaced++;
      continue wheelSearch;
    }
  }

  // -- MAGPOST FIELDS -- the coin-down-the-pegs cascade, in miniature.
  //
  // A STAGGERED lattice, because a square grid of posts has straight channels
  // through it, and a ball that finds one is not cascading — it is in a
  // corridor. Offsetting every other row is what makes the path branch.
  //
  // BUMPERS ARE MIXED IN, and that is not decoration. Every post takes a slice
  // of speed; a field of nothing but posts is where momentum goes to die, which
  // is the exact failure this part has to avoid. The bumpers are the ones that
  // GIVE speed back, so a cascade sometimes ends faster than it started — that
  // is what makes a field worth entering on purpose instead of steering around.
  // They sit at lattice positions rather than extra tiles, so a field's
  // footprint does not grow with them.
  let fieldsPlaced = 0;
  fieldSearch: for (const fp of shuffled(floors, rng)) {
    if (fieldsPlaced >= (extras.magpostFields ?? MAGPOST_FIELDS_MAX)) break;
    if (plazaBudget < MAGPOST_FIELD_POSTS + MAGPOST_FIELD_BUMPERS) break;
    if (Math.abs(fp.i - start.i) + Math.abs(fp.j - start.j) < 4) continue;
    const dims = [
      [MAGPOST_FIELD_W, MAGPOST_FIELD_H],
      [MAGPOST_FIELD_H, MAGPOST_FIELD_W],
      [4, 4],
      [5, 3],
      [3, 5],
      [4, 3],
      [3, 4],
    ];
    let chosenW = 0;
    let chosenH = 0;
    for (const [w, h] of dims) {
      let fit = true;
      for (let dj = 0; dj < h && fit; dj++) {
        for (let di = 0; di < w; di++) {
          if (!freeFor(fp.i + di, fp.j + dj, 0)) {
            fit = false;
            break;
          }
        }
      }
      if (fit) {
        chosenW = w;
        chosenH = h;
        break;
      }
    }
    if (!chosenW) continue fieldSearch;

    const cells: TilePos[] = [];
    for (let dj = 0; dj < chosenH; dj++) {
      const stag = dj % 2;
      for (let di = stag; di < chosenW; di += 2) cells.push({ i: fp.i + di, j: fp.j + dj });
    }
    if (cells.length < MAGPOST_FIELD_POSTS + MAGPOST_FIELD_BUMPERS) continue;
    const picked = shuffled(cells, rng).slice(0, MAGPOST_FIELD_POSTS + MAGPOST_FIELD_BUMPERS);
    if (!spend(MAGPOST_FIELD_POSTS + MAGPOST_FIELD_BUMPERS)) break;
    const fieldId = fieldsPlaced;
    picked.forEach((c, k) => {
      if (k < MAGPOST_FIELD_BUMPERS) {
        parts.push({ kind: "bumper", i: c.i, j: c.j, dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0, field: fieldId });
      } else {
        parts.push({ kind: "magpost", i: c.i, j: c.j, dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0, variant: k % 3, field: fieldId });
      }
    });
    fieldsPlaced++;
  }

  let walkableTotal = 0;
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) if (isWalkable(g, i, j)) walkableTotal++;
  const maxPartsAllowed = Math.max(partBudget, Math.floor((walkableTotal * PARTS_PER_1K_CAP) / 1000));
  if (parts.length > maxPartsAllowed) {
    let excess = parts.length - maxPartsAllowed;
    for (let k = parts.length - 1; k >= 0 && excess > 0; k--) {
      const p = parts[k];
      if (
        !inRoom({ i: p.i, j: p.j }) &&
        p.circuit === undefined &&
        !p.chute &&
        !p.spine &&
        (p as any).route === undefined &&
        p.field === undefined &&
        p.asm === undefined
      ) {
        if (p.kind === "bumper" || p.kind === "target" || p.kind === "booster") {
          parts.splice(k, 1);
          excess--;
        }
      }
    }
    for (let k = parts.length - 1; k >= 0 && excess > 0; k--) {
      const p = parts[k];
      if (
        !inRoom({ i: p.i, j: p.j }) &&
        p.circuit === undefined &&
        !p.chute &&
        !p.spine &&
        (p as any).route === undefined &&
        p.field === undefined &&
        p.asm === undefined
      ) {
        parts.splice(k, 1);
        excess--;
      }
    }
  }

  return { start, stairs, spawns, torches, items, props, parts, rooms: furnished.rooms, secrets, frog, plazas, circuits: committed };
}
