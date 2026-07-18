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
// "do I chug it now?" decisions. Ids → POTIONS (the consolidated pinball kit:
// ball form / freeze / multi-ball, alongside the combat buffs).
const POTION_POOL = ["rage", "haste", "shield", "gold", "ballform", "freeze", "curveshot", "magnetboots"];
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
const CHAINS_DEFAULT = 2; // shot chains seeded per floor, before the spacing deal fills in

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

/**
 * CORRIDOR-WIDEN (the "launch highway" — kills the uniform 2-wide box-maze
 * feel). Trace the main artery from the stairs back to the start along the BFS
 * gradient and widen it to 3 tiles by carving ONE perpendicular wall neighbour
 * per path tile. Carving wall→floor only ever ADDS connectivity, so
 * reachability is preserved by construction. Mutates the grid in place; the
 * caller reruns its floor scan + distances afterwards. Returns the widened tiles
 * so downstream can treat the artery as open space.
 */
export function widenMainArtery(g: Grid): void {
  // Find the start (first floor tile, top-left) + the farthest tile (the stairs
  // end) — the same endpoints decorateMaze uses — then widen the path between.
  let start: TilePos | null = null;
  outer: for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (at(g, i, j) === T_FLOOR) {
        start = { i, j };
        break outer;
      }
    }
  }
  if (!start) return;
  const dist = bfsDistances(g, start.i, start.j);
  let stairs = start;
  let maxDist = 0;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (at(g, i, j) !== T_FLOOR) continue;
      const d = dist[idx(g, i, j)];
      if (d > maxDist) {
        maxDist = d;
        stairs = { i, j };
      }
    }
  }
  if (maxDist <= 6) return; // too small to bother
  widenArtery(g, start, stairs, dist);
}

function widenArtery(g: Grid, start: TilePos, stairs: TilePos, dist: Int32Array): void {
  // Walk the gradient stairs → start (each step drops the BFS distance by one).
  let cur: TilePos = stairs;
  let guard = 0;
  const path: TilePos[] = [cur];
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
    path.push(cur);
  }
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
    parts.filter((p) => !p.vault && LAUNCH_KINDS.has(p.kind) && Math.abs(p.dirI) + Math.abs(p.dirJ) === 1),
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
  forceVault = false,
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
      // FILL the chamber with a staggered GRID of bumpers (every ~3 tiles) so a
      // big room is a real bumper FIELD, not five lonely pins in a bare hall.
      // Alternate rows offset half a step for the diamond/quincunx read.
      // Density scales with area. (Bumpers only: a slingshot needs a straight
      // corridor to fire along, and an open chamber tile has no such lane.)
      const STEP = 3;
      const m = 1; // margin from the walls
      let row = 0;
      for (let gy = room.j0 + m; gy <= room.j0 + room.h - 1 - m; gy += STEP, row++) {
        const stag = row % 2 ? Math.floor(STEP / 2) : 0;
        for (let gx = room.i0 + m + stag; gx <= room.i0 + room.w - 1 - m; gx += STEP) {
          if (!clearAt(gx, gy)) continue;
          // the four inner corners are reserved for the curved rails below
          const atCorner = (gx === room.i0 + 1 || gx === room.i0 + room.w - 2) && (gy === room.j0 + 1 || gy === room.j0 + room.h - 2);
          if (atCorner && room.w >= 6 && room.h >= 6) continue;
          part({ kind: "bumper", i: gx, j: gy, dirI: 0, dirJ: 0 });
        }
      }
    } else if (kind === "speedway") {
      // PARALLEL accelerating lanes down the long axis (ramp → booster → ramp,
      // all aimed the same way). A wide room gets 2-3 lanes across the short
      // axis so the whole floor of the room is a launch bank, not one thin strip.
      const alongW = room.w >= room.h;
      const sign = rng() < 0.5 ? 1 : -1;
      const longLen = alongW ? room.w : room.h;
      const shortLen = alongW ? room.h : room.w;
      const nLanes = Math.max(1, Math.min(3, Math.floor(shortLen / 3)));
      const nPer = Math.max(3, Math.floor(longLen / 3));
      for (let lane = 0; lane < nLanes; lane++) {
        const off = Math.round(((lane + 1) / (nLanes + 1)) * (shortLen - 1));
        for (let s = 0; s < nPer; s++) {
          const t = Math.round(1 + (s * (longLen - 3)) / Math.max(1, nPer - 1));
          const i = alongW ? room.i0 + t : room.i0 + off;
          const j = alongW ? room.j0 + off : room.j0 + t;
          if (!clearAt(i, j)) continue;
          const pk: PartSpotKind = s % 2 === 0 ? "ramp" : "booster";
          part({ kind: pk, i, j, dirI: alongW ? sign : 0, dirJ: alongW ? 0 : sign });
        }
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
  extras: { anchors?: PrefabAnchor[]; deal?: PartSpotKind[]; targets?: number; trapdoors?: number; hazards?: number; forceVault?: boolean; boosterLanes?: number; launchBreaks?: number; vaultRamps?: number; chains?: number; rolloverArrays?: number } = {},
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
  const furnished = furnishRooms(rooms, rng, start, extras.forceVault);
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
  const deal: PartSpotKind[] = extras.deal ?? ["bumper", "ramp", "spring", "glove", "flipper", "oil", "deflector", "mirror", "spinpad", "slingshot"];
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
      // No-orphan (Slice 3): a launch part must have RUNWAY in its fire
      // direction, or it just shoots you into a wall a tile away. Flip to the
      // opposite (still-open) side if that has room; else skip this candidate.
      if (LAUNCH_KINDS.has(kind) && (spot.dirI !== 0 || spot.dirJ !== 0)) {
        if (launchRunway(g, spot.i, spot.j, spot.dirI, spot.dirJ) < MIN_RUNWAY) {
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

  // ── BOOSTER LANES (the accelerating "highway" layer): lay rows of 2-3 booster
  // pads down a straight run, all aimed the same way, so a floor reads as a
  // machine with real speed channels — not a maze with the odd dash pad. Its own
  // layer over the part budget (like banks/hazards), so a lane never strips the
  // corridor deal. Best-effort: place up to LANE_COUNT lanes on suitable runs. ──
  const LANE_COUNT = extras.boosterLanes ?? 3;
  const LANE_LEN = 3;
  const laneAxes: Array<[number, number]> = [[1, 0], [0, 1]];
  let lanesPlaced = 0;
  laneSearch: for (const p of shuffled(floors, rng)) {
    if (lanesPlaced >= LANE_COUNT) break;
    if (inRoom(p) || Math.abs(p.i - start.i) + Math.abs(p.j - start.j) < 5) continue;
    for (const [ai, aj] of shuffled(laneAxes, rng)) {
      // A run of LANE_LEN+1 floor tiles along the axis (the pads + one tile of
      // runway past the end) that stays out of rooms and clear of other parts,
      // and isn't the stairs tile. Wide corridors are fine — the pads snap your
      // heading to the axis, so the lane rails you straight down it regardless.
      const runOk = Array.from({ length: LANE_LEN + 1 }, (_, s) => s).every(
        (s) => at(g, p.i + ai * s, p.j + aj * s) === T_FLOOR && !(p.i + ai * s === stairs.i && p.j + aj * s === stairs.j),
      );
      const clear = [0, 1, 2].every((s) => !parts.some((q) => Math.abs(q.i - (p.i + ai * s)) + Math.abs(q.j - (p.j + aj * s)) < 2));
      if (!runOk || !clear) continue;
      for (let s = 0; s < LANE_LEN; s++) {
        parts.push({ i: p.i + ai * s, j: p.j + aj * s, kind: "booster", dirI: ai, dirJ: aj, dir2I: 0, dir2J: 0 });
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
