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
import { SHAPE_FULL, SHAPE_SLANT_NE, SHAPE_SLANT_NW, SHAPE_SLANT_SE, SHAPE_SLANT_SW, shapeBacking, slantToRound, type TileShape } from "./tile-shape";
import { authorArcSweeps, stampOrbitIsland } from "./arc-sweeps";
import { bfsDistances } from "../entities/ai";
import { PICKUP_WEAPONS } from "../items";

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
  | "booster"
  | "deflector"
  | "glove"
  | "oil"
  | "spinpad"
  | "slingshot"
  | "target"
  | "trapdoor"
  | "flipper"
  | "mirror"
  | "pit"
  | "electric"
  | "firevent"
  | "magstrip"
  | "rollover";

export interface PinballPartSpot extends TilePos {
  kind: PartSpotKind;
  dirI: number;
  dirJ: number;
  dir2I: number;
  dir2J: number;
  /** TARGET BANK (Slice 6): a drop-target's bank id + its order in the bank. */
  bank?: number;
  seq?: number;
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
const POTION_POOL = ["rage", "haste", "shield", "gold", "ballform", "freeze", "multiball", "curveshot", "magnetboots"];
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

/** Launch parts that fling the player — they need clear RUNWAY to be worth it. */
const LAUNCH_KINDS = new Set<string>(["ramp", "booster", "spring", "slingshot", "flipper"]);
const MIN_RUNWAY = 3; // open tiles ahead a launch part needs, or it fires into a wall

/**
 * PATH-FIRST flow: the "speed up" parts must shove you ONWARD toward the exit,
 * not back the way you came (the "booster that just sends you back" bug). We
 * orient these down the dist-from-start gradient. `spring` (a dead-end plunger,
 * aims out the one opening) and `flipper` (a redirect) are deliberately NOT here
 * — their direction is already meaningful.
 */
const FORWARD_FLOW_KINDS = new Set<string>(["ramp", "slingshot"]);
/**
 * …but a table needs the odd rebound, so leave this fraction of speed parts as
 * a deliberate kickback rather than a pure conveyor belt toward the stairs.
 */
const KICKBACK_CHANCE = 0.15;
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
  const dist = bfsDistances(g, start.i, start.j);
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
  const dist = bfsDistances(g, ends.start.i, ends.start.j);
  if (dist[idx(g, ends.stairs.i, ends.stairs.j)] <= 6) return; // too small to bother
  widenArtery(g, ends.start, ends.stairs, dist);
}

/**
 * THE SPINE — the ordered tile path down the main artery from START to STAIRS,
 * walking the BFS-from-start gradient (each step drops the distance by one). The
 * single source of truth for "the way through the floor": widenMainArtery widens
 * it into a 3-wide highway and layStationSpine strings the connected booster
 * route along it. Returned start→stairs so a caller can lay parts in travel
 * order. Empty if the gradient dead-ends (never on a connected maze).
 */
export function traceArtery(g: Grid, start: TilePos, stairs: TilePos, dist: Int32Array): TilePos[] {
  // Walk the gradient stairs → start, then reverse so the path reads in the
  // direction of travel (spawn → exit).
  let cur: TilePos = stairs;
  let guard = 0;
  const back: TilePos[] = [cur];
  while (!(cur.i === start.i && cur.j === start.j) && guard++ < g.w * g.h) {
    const dcur = dist[idx(g, cur.i, cur.j)];
    let next: TilePos | null = null;
    for (const [di, dj] of WALL_SIDES) {
      const ni = cur.i + di;
      const nj = cur.j + dj;
      if (at(g, ni, nj) === T_WALL) continue;
      if (dist[idx(g, ni, nj)] === dcur - 1) {
        next = { i: ni, j: nj };
        break;
      }
    }
    if (!next) break; // gradient dead-ended (shouldn't on a connected maze)
    cur = next;
    back.push(cur);
  }
  back.reverse();
  return back;
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

/** Count consecutive open (floor) tiles stepping (di,dj) from (i,j), capped. */
function launchRunway(g: Grid, i: number, j: number, di: number, dj: number): number {
  let n = 0;
  for (let s = 1; s <= 8; s++) {
    if (at(g, i + di * s, j + dj * s) !== T_FLOOR) break;
    n++;
  }
  return n;
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

  /** Floor-run length stepping (di,dj) from (i,j), capped at 6. */
  const runway = (i: number, j: number, di: number, dj: number): number => {
    let n = 0;
    for (let s = 1; s <= 6; s++) {
      if (at(g, i + di * s, j + dj * s) !== T_FLOOR) break;
      n++;
    }
    return n;
  };
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
  const launch = shuffled(
    parts.filter((p) => !p.vault && !p.spine && LAUNCH_KINDS.has(p.kind) && Math.abs(p.dirI) + Math.abs(p.dirJ) === 1),
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
};

/** Turn a topology candidate into a concrete part spot of the dealt kind. */
function spotForKind(kind: PartSpotKind, c: TopoSpot, rng: () => number): PinballPartSpot {
  if (kind === "glove" || kind === "firevent") {
    // A glove/vent mounts on one of the corridor's side walls and fires ACROSS
    // it: direction = the perpendicular of the corridor axis (both sides are
    // wall by construction for a strict straight), random side.
    const side = rng() < 0.5 ? 1 : -1;
    return { i: c.i, j: c.j, kind, dirI: -c.dirJ * side, dirJ: c.dirI * side, dir2I: 0, dir2J: 0 };
  }
  if (kind === "flipper" && c.topo === "junction") {
    // A junction has no axis — aim the paddle down any open leg so it launches
    // you somewhere (falls back to +x for a degenerate/open-room stamp).
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
  dist: Int32Array,
  forceVault = false,
  onSpine: (i: number, j: number) => boolean = () => false,
): { rooms: PlannedRoom[]; spawns: TilePos[]; items: ItemDrop[]; parts: PinballPartSpot[] } {
  const planned: PlannedRoom[] = [];
  const spawns: TilePos[] = [];
  const items: ItemDrop[] = [];
  const parts: PinballPartSpot[] = [];
  let orbitNext = 0; // D2 — circuit ids, one per room that gets a full ring of rails
  // Slice 9 — THREE-ZONE floors: a room's archetype is chosen by how far it sits
  // from the start (the stairs live at the far end), so a floor reads as a loop:
  //   LAUNCH district (near start)  → speedway ramp lanes to build speed
  //   MACHINE core   (the middle)   → bumper arenas to bounce + rack combo
  //   DRAIN lane     (far, by stairs)→ arena/vault: the fight + the reward
  // Corridor width/friction/enemy-density gradients already ride distance (Slices
  // 2/4 + BFS spawn weighting), so this ties the spatial pacing together.
  const roomDist = rooms.map((r) => Math.abs(r.i0 + Math.floor(r.w / 2) - start.i) + Math.abs(r.j0 + Math.floor(r.h / 2) - start.j));
  const maxDist = Math.max(1, ...roomDist);
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
      parts.push({ dir2I: 0, dir2J: 0, ...p });
    };

    const clearAt = (i: number, j: number): boolean => !parts.some((q) => q.i === i && q.j === j);

    if (kind === "bumper") {
      // A staggered field of pop bumpers to carom THROUGH on the way past. The
      // spine lane is left CLEAR so the booster route runs straight through the
      // middle, flanked by bumpers — the room becomes a station ON the path
      // rather than a wall of pins you wander into and stall in.
      const STEP = 3;
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
      const midShort = alongW ? room.j0 + Math.floor(room.h / 2) : room.i0 + Math.floor(room.w / 2);
      const dLo = alongW ? distAt(g, dist, room.i0 + 1, midShort) : distAt(g, dist, midShort, room.j0 + 1);
      const dHi = alongW ? distAt(g, dist, room.i0 + room.w - 2, midShort) : distAt(g, dist, midShort, room.j0 + room.h - 2);
      let sign = dHi >= dLo ? 1 : -1;
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
          floor(i + c.l2[0], j + c.l2[1]) &&
          floor(i + c.opp[0], j + c.opp[1])
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
  spine: TilePos[],
  start: TilePos,
  stairs: TilePos,
  parts: PinballPartSpot[],
  items: ItemDrop[],
): void {
  if (spine.length < 4) return;
  const CALM = 4; // keep the plunger launch zone at the mouth clear
  const MIN_STRIDE = 3; // a pad every ~3 tiles — a conveyor you boost-and-coast down, not a wall of pads
  const MAX_STRIDE = 4; // …and never further than this apart, so each pad still hands you to the next
  const takenTile = (i: number, j: number): boolean =>
    parts.some((q) => q.i === i && q.j === j) || items.some((it) => it.i === i && it.j === j);
  const placeable = (p: TilePos): boolean =>
    !(p.i === stairs.i && p.j === stairs.j) &&
    Math.abs(p.i - start.i) + Math.abs(p.j - start.j) >= CALM &&
    !takenTile(p.i, p.j);
  const dirOf = (a: TilePos, b: TilePos): [number, number] => [Math.sign(b.i - a.i), Math.sign(b.j - a.j)];

  // Segment the path into maximal straight runs; the tile between two runs is a bend.
  const n = spine.length;
  let k = 0;
  while (k < n - 1) {
    const [di, dj] = dirOf(spine[k], spine[k + 1]);
    let end = k + 1;
    while (end < n - 1) {
      const [ndi, ndj] = dirOf(spine[end], spine[end + 1]);
      if (ndi !== di || ndj !== dj) break;
      end++;
    }
    // Booster pads the whole run [k .. end), skipping the bend tile spine[end].
    // The run direction (di,dj) IS down-flow by construction — the spine is
    // ordered start→stairs, so each step raises dist-from-start by one — and it
    // always points at the next spine tile (real floor), so no sign check is
    // needed and a pad can never fire into a wall. Pads are spaced MIN..MAX apart
    // (never more than MAX_STRIDE) so a long straight becomes a proper highway
    // where every pad still hands you to the next — no dead coast.
    const stride = Math.max(MIN_STRIDE, Math.min(MAX_STRIDE, Math.ceil((end - k) / 4)));
    for (let t = k; t < end; t += stride) {
      const p = spine[t];
      // RUNWAY GUARD (live QA: "boosters boost into a wall"). A pad one tile
      // before the bend fires you PAST the bend tile into the corner wall —
      // the old "always points at the next spine tile" argument only proved
      // ONE open tile. Require 2+ so the worst case is a bounce, not a splat;
      // the bend station below owns the actual redirect.
      if (placeable(p) && launchRunway(g, p.i, p.j, di, dj) >= 2) {
        parts.push({ kind: "booster", i: p.i, j: p.j, dirI: di, dirJ: dj, dir2I: 0, dir2J: 0, spine: true });
      }
    }
    // The station where the run DELIVERS you (the bend), if any tile follows.
    if (end < n - 1) {
      const bend = spine[end];
      const [odi, odj] = dirOf(spine[end], spine[end + 1]); // outgoing leg
      if (placeable(bend)) {
        const openLegs = WALL_SIDES.filter(([li, lj]) => at(g, bend.i + li, bend.j + lj) === T_FLOOR);
        if ((odi !== di || odj !== dj) && openLegs.length <= 2) {
          // A clean corner → a deflector banks incoming→outgoing (speed intact).
          // Legs match classifyTopology: where you came FROM (-in) and GO (+out).
          parts.push({ kind: "deflector", i: bend.i, j: bend.j, dirI: -di, dirJ: -dj, dir2I: odi, dir2J: odj, spine: true });
        } else if ((odi !== di || odj !== dj) && launchRunway(g, bend.i, bend.j, odi, odj) >= 2) {
          // A wide bend → CURVE CARRY: a pad aimed down the OUTGOING leg, so the
          // route arcs around the corner instead of dying on a bumper (live QA:
          // bends were where momentum went to die). Reads as a curved lane.
          parts.push({ kind: "booster", i: bend.i, j: bend.j, dirI: odi, dirJ: odj, dir2I: 0, dir2J: 0, spine: true });
        } else {
          // No outgoing runway (or a straight crossing) → a bumper to carom off.
          parts.push({ kind: "bumper", i: bend.i, j: bend.j, dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0, spine: true });
        }
      }
    }
    k = end;
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
function polishParts(g: Grid, parts: PinballPartSpot[], rng: () => number): TilePos[] {
  const isLauncher = (p: PinballPartSpot): boolean =>
    (p.dirI !== 0 || p.dirJ !== 0) && p.kind !== "deflector" && !p.vault;

  // ── 1. Opposing launchers on a clear line ──
  const drop = new Set<PinballPartSpot>();
  for (let a = 0; a < parts.length; a++) {
    const A = parts[a];
    if (drop.has(A) || !isLauncher(A)) continue;
    for (let step = 1; step <= 10; step++) {
      const ti = A.i + A.dirI * step;
      const tj = A.j + A.dirJ * step;
      if (at(g, ti, tj) !== T_FLOOR) break; // wall closes the line — no loop possible
      const B = parts.find((q) => q.i === ti && q.j === tj && !drop.has(q) && isLauncher(q));
      if (!B) continue;
      if (B.dirI === -A.dirI && B.dirJ === -A.dirJ) {
        // Facing pair with line of sight: kill one. Spine survives (it IS the
        // route); between two spine parts this cannot happen by construction.
        drop.add(A.spine && !B.spine ? B : A);
      }
      break; // first part on the line settles it either way
    }
  }

  // ── 2. Bumper de-clump ── spine bends first so the route keeps its stations.
  const bumpers = parts.filter((p) => p.kind === "bumper" && !drop.has(p));
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
  for (const c of shuffled(candidates, rng).slice(0, 8)) {
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
  extras: { anchors?: PrefabAnchor[]; deal?: PartSpotKind[]; targets?: number; trapdoors?: number; hazards?: number; forceVault?: boolean; boosterLanes?: number; launchBreaks?: number; vaultRamps?: number; chains?: number; rolloverArrays?: number; bonusItems?: number; endpoints?: Endpoints } = {},
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
  const dist = bfsDistances(g, start.i, start.j);

  const floors: TilePos[] = [];
  let maxDist = 0;
  let farthest: TilePos = start;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (at(g, i, j) !== T_FLOOR) continue;
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

  // THE SPINE — the ordered start→stairs artery path (already widened into a
  // 3-wide highway by widenMainArtery in core). The connected booster route is
  // laid down it (layStationSpine); rooms it crosses keep a clear lane so the
  // route runs THROUGH them. The single "way through the floor".
  const spine = traceArtery(g, start, stairs, dist);
  const spineSet = new Set(spine.map((p) => idx(g, p.i, p.j)));
  const onSpine = (i: number, j: number): boolean => spineSet.has(idx(g, i, j));

  // ── Rooms first: archetype content is SEEDED into the pools below, so all
  // the general placement (and its spacing rules) works around it. General
  // placement also stays OUT of room interiors — each room is its archetype's
  // set piece, not another stretch of corridor. Rooms leave the spine lane clear
  // so the booster route can run through them (they become stations ON the path). ──
  const furnished = furnishRooms(rooms, rng, start, g, dist, extras.forceVault, onSpine);
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
  // ── STATION SPINE (path-first): string the connected booster route down the
  // main artery FIRST, so the floor has one legible "boosters feed into each
  // other" route before anything else fills in. It is its OWN LAYER (like the
  // banks/hazards/rollover layers): the corridor budget is measured AFTER it, so
  // the spine never strips the deal — the deal below just spaces AROUND these
  // tiles, filling the pockets that branch off the spine. ──
  layStationSpine(g, spine, start, stairs, parts, items);
  const corridorBudget = partBudget + parts.length;
  const byTopo: Record<Topology, TopoSpot[]> = { deadend: [], straight: [], corner: [], junction: [] };
  for (const p of shuffled(floors, rng)) {
    if (p.i === stairs.i && p.j === stairs.j) continue;
    if (Math.abs(p.i - start.i) + Math.abs(p.j - start.j) < 4) continue; // calm start
    if (items.some((it) => it.i === p.i && it.j === p.j)) continue;
    if (inRoom(p)) continue;
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
      if (FORWARD_FLOW_KINDS.has(kind) && (spot.dirI !== 0 || spot.dirJ !== 0)) {
        const fwd = distAt(g, dist, spot.i + spot.dirI, spot.j + spot.dirJ);
        const bwd = distAt(g, dist, spot.i - spot.dirI, spot.j - spot.dirJ);
        if (bwd > fwd && rng() > KICKBACK_CHANCE) spot = { ...spot, dirI: -spot.dirI, dirJ: -spot.dirJ };
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
  const REGION = 24; // tiles per coarse cell side (~one screen of maze)
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
  let fillCount = 0;
  for (const [r, pool] of fillPools) {
    if (filledRegions.has(r)) continue;
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
      parts.push({
        kind: "ramp",
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
      let sign: number;
      if (fwdFeeds && bwdFeeds) sign = distAt(g, dist, fwdI, fwdJ) >= distAt(g, dist, bwdI, bwdJ) ? 1 : -1;
      else sign = fwdFeeds ? 1 : -1;
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

  // ── ARC SWEEPS, part 1 — the ORBIT ISLAND (arc-sweeps.ts). Stamped BEFORE
  // polishParts so the plaza scan sees the island and doesn't drop a bumper
  // diamond on top of it. `occupied` = every tile carrying placed content;
  // wall-adding stamps must never eat a spawn/item/part/torch. ──
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
  const orbit = stampOrbitIsland(g, start, occupied, rng);
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

  const plazas = polishParts(g, parts, rng);

  // ── Secrets: collect every CRACKED band stamped by crackSecretWalls. After
  // thickenWalls a raw crack is a 2×2 band whose top-left tile has even coords
  // — that top-left is the band's handle (build.ts + secrets.ts key off it). ──
  const secrets: TilePos[] = [];
  for (let j = 0; j < g.h - 1; j += 2) {
    for (let i = 0; i < g.w - 1; i += 2) {
      if (at(g, i, j) === T_CRACKED) secrets.push({ i, j });
    }
  }

  // ── ARC SWEEPS, part 2 — multi-tile fillets (arc-sweeps.ts): radius 2-3
  // sweeping curves on qualifying wall-mass corners (carve-only) and room inner
  // corners (fill, strand-guarded). Before assignCornerShapes so the r=1
  // single-tile pass only decorates the corners the sweeps didn't claim. ──
  const newParts = parts.filter((p) => !occupiedKeys.has(p.j * g.w + p.i));
  for (const p of newParts) claim(p); // polishParts may have added plaza bumpers
  authorArcSweeps(g, start, occupied, rng);

  // ── Shaped walls: bevel convex outer corners into 45° slants (tile-shape.ts).
  // LAST tile mutation, so the topology it reads (rooms, corridors, launch
  // break-throughs, secrets) is final. Only reshapes existing walls — never
  // changes walkability, so AI/flow-field/spawns are unaffected. ──
  assignCornerShapes(g);

  return { start, stairs, spawns, torches, items, props, parts, rooms: furnished.rooms, secrets, frog, plazas };
}
