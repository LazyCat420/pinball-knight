/**
 * FLOOR ARCHETYPES — the macro layout of a depth.
 *
 * Themes (prefabs.ts) change a floor's FURNITURE and biomes (core.ts) change
 * its COLOUR, but until this module every floor was the same object underneath:
 * a uniform-density growing-tree maze with rectangles sprinkled over it. An
 * archetype changes the floor's SHAPE — one great open hall, a highway with
 * branches hanging off it, a cave, a ring keep — which is the thing a player
 * actually reads as "a different level".
 *
 * How it works: each archetype returns a set of CELL SEEDS that generateMaze
 * pre-carves and grows out of (see MazeOpts.seeds). That single mechanism gives
 * every archetype the same guarantees for free —
 *   - only ever carves wall→floor, so connectivity can only increase;
 *   - stitchCells welds any seed shape that came out in pieces;
 *   - the cell lattice is preserved outside solidly-filled regions, so the 2×2
 *     secret bands and every stamp still land where they expect to. (Inside a
 *     solid region the lattice's corner pillars are knocked out on purpose —
 *     see MazeOpts.solidSeeds — exactly as carveRooms has always filled its
 *     rects; thickenWalls' 2-thick wall guarantee comes from the doubling
 *     itself, not from the lattice, so it is unaffected.)
 * An archetype therefore cannot produce an unsolvable floor, whatever it draws.
 *
 * DOM- and three-free, seeded-deterministic: tested in archetypes.test.ts.
 */
import type { CellPos } from "./generator";
import type { NodeLayout } from "./track-grow";
import type { FloorRuleWeights } from "./floor-rules";
import type { BandPaint } from "./surface-paint";
import { MAT_BRASS, MAT_ICE, MAT_MUD, MAT_RUBBER } from "../engine/surfaces";

export type ArchetypeId = "warrens" | "spine" | "greathall" | "cavern" | "ringkeep";

/**
 * The archetype's grip on the TRACK-FIRST generator.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * `seeds()` below shapes the grid `generateMaze` grows, and `TRACK_FIRST` has
 * been on since the circuit rework — which means the live path built its floor
 * from `buildTrackFloor` and discarded that grid entirely. Measured: a blind
 * census over 6 seeds × 10 depths could not tell the five archetypes apart on
 * ANY statistic (open share 0.586–0.648, varying with floor SIZE and nothing
 * else), because `buildTrackFloor` took no archetype argument at all. The only
 * thing an archetype changed on a shipped floor was how many rng draws it
 * consumed before the real generator ran.
 *
 * Meanwhile core.ts prints the archetype's name and flavour on the descent card
 * — "The Cavern · no straight lines · the rock decides" over a floor generated
 * without ever consulting it. The game was describing a level it wasn't making.
 *
 * A profile fixes that at the layer that owns each property: node LAYOUT and
 * the loop floor decide macro topology, lane scale and plaza decide the feel of
 * the space, fill/link/density decide how much maze surrounds the circuit and
 * how porous the boundary is. `seeds()` stays because the legacy branch is
 * still the fallback when track growth degenerates.
 */
export interface TrackProfile {
  /** Where the food nodes go — the archetype's real lever (see NodeLayout). */
  layout: NodeLayout;
  /**
   * Food and relay nodes per 1000 tiles of grid. DENSITIES, not counts: the old
   * absolute clamps bound from floor 1, so a floor three times the area got the
   * same little circuit and the lane share decayed 0.30 → 0.12 with depth.
   */
  foodPer1k: number;
  relayPer1k: number;
  /** Circuit-rank floor. 1 = a single loop is enough; 4 = a proper web. */
  minLoops: number;
  /** Multiplier on every lane half-width (track-path). */
  laneScale: number;
  /** Fraction of the leftover space the maze fills (growMazeAround). */
  fill: number;
  /** On-ramp probability — how porous the circuit's edge is. */
  linkChance: number;
  /**
   * Open chamber radius at the most central junction, as a fraction of the
   * floor's short side. 0 = no plaza.
   */
  plazaFrac: number;
  /**
   * Cap on chord length as a fraction of the short side (meshNeighbours). Long
   * chords pave everything they cross; short ones keep the network local and
   * planar-ish.
   */
  maxLenFrac: number;
  /**
   * Pruner survival threshold relative to the network's strongest tube — the
   * coarse "how much track" dial. Swept over 8 seeds × 3 depths per layout:
   * 0.045 → 0.20 roughly halves both lane share and circuit rank.
   */
  survive: number;
  /**
   * PLACEMENT RULE WEIGHTS (maze/floor-rules.ts) — where the spawn goes and how
   * far the exit/boss must be. Optional: omit it and the floor gets
   * `DEFAULT_RULE_WEIGHTS`, which is the point of a global baseline.
   */
  rules?: Partial<FloorRuleWeights>;
  /**
   * WHAT THE THREE ZONES ARE MADE OF (maze/surface-paint.ts `paintBands`).
   *
   * The 5x5 surface matrix is the one mechanic in this game that nothing else
   * has, and until this field it had exactly ONE author: a floor modifier,
   * rolled on 45% of floors from level 3 and painted uniformly at random. A
   * floor's SHAPE could not ask for a material at all, so the speedway near
   * the spawn, the bumper core and the vault by the stairs all played on
   * identical stone.
   *
   * The bands are the ones `decorateMaze` has zoned rooms by since Slice 9 —
   * distance from the spawn, cut at 0.34 and 0.68 — so the material and the
   * furniture describe the same floor instead of two competing ones.
   *
   * Optional: omit it and the archetype paints nothing, which is the pre-band
   * behaviour exactly. Gated globally by `SURFACE_BANDS`.
   */
  bands?: BandPaint;
}

export interface FloorArchetype {
  id: ArchetypeId;
  /** Shown on the descent card next to the biome name. */
  label: string;
  flavour: string;
  /**
   * Multiplier on the level's braid budget. A cave is already loopy and wants
   * fewer extra knock-throughs; a spine floor wants its branches to stay
   * dead-endy so the highway keeps its monopoly on speed.
   */
  braidMult: number;
  /** Braid gradient fed to generateMaze — loopy near spawn, tight near the stairs. */
  braidGradient: number;
  /**
   * Growing-tree windiness RANGE [min, max], rolled per floor (see
   * generateMaze): 1 = long winding backtracker corridors, 0 = bushy
   * many-junction Prim's. This is the archetype's *texture* knob, and it is what
   * stops floors of the same archetype reading identically — a depth-keyed
   * cycle gave every Cavern the same corridor character forever.
   *
   * The ranges are chosen so the texture agrees with the macro shape rather than
   * fighting it: a Spine wants dead-endy winding branches so the highway keeps
   * its monopoly on speed; a Cavern is short and branchy by nature; a Great Hall
   * wants a bushy maze filling the rind around the chamber.
   */
  windiness: readonly [number, number];
  /**
   * Fill the seeded region solid rather than leaving the lattice's corner
   * pillars standing (MazeOpts.solidSeeds). On for the archetypes whose point
   * is OPEN AREA to carom around; a no-op for 1-cell-wide shapes like the
   * Spine, which contain no 2×2 quad to knock through in the first place.
   */
  solid: boolean;
  /**
   * Seed cells for the growing tree, or null for the plain single-cell start
   * (the classic backtracker floor). LEGACY BRANCH ONLY — see `track`.
   */
  seeds(cellsW: number, cellsH: number, rng: () => number): CellPos[] | null;
  /** How this archetype shapes the live track-first floor. */
  track: TrackProfile;
}

/**
 * The profile the track generator uses when nobody supplies one — the measured
 * behaviour of the pre-profile generator, so a caller that doesn't care (tests,
 * tools, the debug spawner) gets what it always got.
 */
export const DEFAULT_TRACK_PROFILE: TrackProfile = {
  layout: "scatter",
  foodPer1k: 3.8,
  relayPer1k: 5.5,
  minLoops: 2,
  laneScale: 1,
  fill: 0.72,
  linkChance: 0.28,
  plazaFrac: 0,
  maxLenFrac: 0.42,
  survive: 0.12,
};

/**
 * Node counts for a floor of `w × h` tiles under a profile.
 *
 * Clamped only at the extremes: the floor stops a tiny map degenerating into
 * two nodes and a line, and the ceiling is a runaway guard on the deepest maps
 * rather than the operative value on every one — which is exactly what the old
 * `min(15, …)` turned out to be.
 */
export function trackNodeCounts(p: TrackProfile, w: number, h: number): { foods: number; relays: number } {
  const k = (w * h) / 1000;
  return {
    foods: Math.max(4, Math.min(44, Math.round(p.foodPer1k * k))),
    relays: Math.max(5, Math.min(64, Math.round(p.relayPer1k * k))),
  };
}

/** Every cell on the perimeter of a cell-space rect, clockwise-ish order. */
function ringCells(x0: number, y0: number, x1: number, y1: number): CellPos[] {
  const out: CellPos[] = [];
  for (let x = x0; x <= x1; x++) {
    out.push([x, y0]);
    if (y1 !== y0) out.push([x, y1]);
  }
  for (let y = y0 + 1; y < y1; y++) {
    out.push([x0, y]);
    if (x1 !== x0) out.push([x1, y]);
  }
  return out;
}

/** Inclusive cell-space rect fill. */
function rectCells(x0: number, y0: number, x1: number, y1: number): CellPos[] {
  const out: CellPos[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * THE SPINE — one 1-cell-wide boulevard running the length of the floor, with
 * the maze branching off it. Every floor of this shape has a legible highway
 * you can plunge down at full momentum; everything else hangs off it as
 * dead-end pockets. Four shapes (straight ×2, elbow, Z) so it isn't one pose.
 */
function spineSeeds(cellsW: number, cellsH: number, rng: () => number): CellPos[] {
  const shape = Math.floor(rng() * 4);
  const cells: CellPos[] = [];
  const midY = clamp(Math.floor(cellsH * (0.3 + rng() * 0.4)), 1, cellsH - 2);
  const midX = clamp(Math.floor(cellsW * (0.3 + rng() * 0.4)), 1, cellsW - 2);

  if (shape === 0) {
    // Straight, east-west.
    for (let x = 0; x < cellsW; x++) cells.push([x, midY]);
  } else if (shape === 1) {
    // Straight, north-south.
    for (let y = 0; y < cellsH; y++) cells.push([midX, y]);
  } else if (shape === 2) {
    // Elbow: run east along midY, then turn and run south at midX.
    for (let x = 0; x <= midX; x++) cells.push([x, midY]);
    for (let y = midY; y < cellsH; y++) cells.push([midX, y]);
  } else {
    // Z: two offset east-west runs joined by a north-south connector.
    const y2 = clamp(midY + (midY < cellsH / 2 ? 1 : -1) * Math.max(2, Math.floor(cellsH * 0.35)), 1, cellsH - 2);
    for (let x = 0; x <= midX; x++) cells.push([x, midY]);
    const [lo, hi] = midY < y2 ? [midY, y2] : [y2, midY];
    for (let y = lo; y <= hi; y++) cells.push([midX, y]);
    for (let x = midX; x < cellsW; x++) cells.push([x, y2]);
  }
  return cells;
}

/**
 * THE GREAT HALL — one enormous open chamber taking ~45% × 50% of the floor,
 * with the maze reduced to a rind around it. This is the TABLE floor: pinball
 * physics need open area to chain caroms, and the standard 2-wide corridor grid
 * never gives them any. Inverts the usual ratio — open space with a maze crust
 * rather than a maze with pockets.
 */
function greatHallSeeds(cellsW: number, cellsH: number, rng: () => number): CellPos[] {
  const hw = Math.max(2, Math.floor(cellsW * 0.45));
  const hh = Math.max(2, Math.floor(cellsH * 0.5));
  // Centred, with a little jitter so the hall isn't in the same place twice.
  const x0 = clamp(Math.floor((cellsW - hw) / 2 + (rng() - 0.5) * cellsW * 0.16), 1, cellsW - hw - 2);
  const y0 = clamp(Math.floor((cellsH - hh) / 2 + (rng() - 0.5) * cellsH * 0.16), 1, cellsH - hh - 2);
  return rectCells(x0, y0, x0 + hw - 1, y0 + hh - 1);
}

/**
 * THE RING KEEP — concentric rectangular galleries joined by a few radial
 * gaps, stairs landing near the middle. Progress reads as "working inward"
 * instead of "wandering", which no other archetype gives you.
 */
function ringKeepSeeds(cellsW: number, cellsH: number, rng: () => number): CellPos[] {
  const cells: CellPos[] = [];
  const maxInset = Math.floor(Math.min(cellsW, cellsH) / 2) - 1;
  const rings: Array<[number, number, number, number]> = [];
  for (let inset = 1; inset <= maxInset; inset += 3) {
    const x0 = inset;
    const y0 = inset;
    const x1 = cellsW - 1 - inset;
    const y1 = cellsH - 1 - inset;
    if (x1 - x0 < 1 || y1 - y0 < 1) break;
    rings.push([x0, y0, x1, y1]);
    cells.push(...ringCells(x0, y0, x1, y1));
  }
  if (!rings.length) return rectCells(1, 1, cellsW - 2, cellsH - 2);

  // Radial gaps: punch a corridor between consecutive rings at a random side,
  // so the keep has real gates rather than relying on the stitch pass.
  for (let r = 0; r + 1 < rings.length; r++) {
    const [ax0, ay0, ax1, ay1] = rings[r];
    const [bx0, by0, bx1, by1] = rings[r + 1];
    const side = Math.floor(rng() * 4);
    if (side === 0) {
      const x = bx0 + Math.floor(rng() * Math.max(1, bx1 - bx0 + 1));
      for (let y = ay0; y <= by0; y++) cells.push([x, y]);
    } else if (side === 1) {
      const x = bx0 + Math.floor(rng() * Math.max(1, bx1 - bx0 + 1));
      for (let y = by1; y <= ay1; y++) cells.push([x, y]);
    } else if (side === 2) {
      const y = by0 + Math.floor(rng() * Math.max(1, by1 - by0 + 1));
      for (let x = ax0; x <= bx0; x++) cells.push([x, y]);
    } else {
      const y = by0 + Math.floor(rng() * Math.max(1, by1 - by0 + 1));
      for (let x = bx1; x <= ax1; x++) cells.push([x, y]);
    }
  }
  // The core: fill whatever the innermost ring encloses, so the middle is a
  // proper keep chamber and not a sealed pocket the maze has to find its way in.
  const [ix0, iy0, ix1, iy1] = rings[rings.length - 1];
  cells.push(...rectCells(ix0, iy0, ix1, iy1));
  return cells;
}

/**
 * THE CAVERN — cellular-automata caves (BLUEPRINT §5's "pluggable generator"
 * note, finally cashed). Random fill, smoothing passes, keep the largest blob;
 * the growing tree then tunnels the leftover cells, so the floor reads as a
 * cave system with mine-works bored through it. Nothing here is straight, which
 * changes how every mirror, deflector and bumper plays.
 *
 * Falls back to null (plain maze) if the automaton happens to produce nothing
 * substantial — a cave that is 8% of the floor is just a worse maze.
 */
function cavernSeeds(cellsW: number, cellsH: number, rng: () => number): CellPos[] | null {
  const n = cellsW * cellsH;
  let alive = new Uint8Array(n);
  for (let k = 0; k < n; k++) alive[k] = rng() < 0.46 ? 1 : 0;

  const liveNeighbours = (src: Uint8Array, cx: number, cy: number): number => {
    let c = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        // Out of bounds counts as solid: keeps caves off the border.
        if (nx < 0 || ny < 0 || nx >= cellsW || ny >= cellsH) continue;
        c += src[ny * cellsW + nx];
      }
    }
    return c;
  };

  for (let pass = 0; pass < 4; pass++) {
    const next = new Uint8Array(n);
    for (let cy = 0; cy < cellsH; cy++) {
      for (let cx = 0; cx < cellsW; cx++) {
        const k = cy * cellsW + cx;
        const c = liveNeighbours(alive, cx, cy);
        next[k] = c >= 5 ? 1 : c <= 2 ? 0 : alive[k];
      }
    }
    alive = next;
  }

  // Largest 4-connected blob wins; the rest is left for the maze to tunnel.
  const seen = new Uint8Array(n);
  let best: CellPos[] = [];
  for (let cy = 0; cy < cellsH; cy++) {
    for (let cx = 0; cx < cellsW; cx++) {
      const k0 = cy * cellsW + cx;
      if (!alive[k0] || seen[k0]) continue;
      const blob: CellPos[] = [];
      const queue: CellPos[] = [[cx, cy]];
      seen[k0] = 1;
      while (queue.length) {
        const [x, y] = queue.pop()!;
        blob.push([x, y]);
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cellsW || ny >= cellsH) continue;
          const nk = ny * cellsW + nx;
          if (seen[nk] || !alive[nk]) continue;
          seen[nk] = 1;
          queue.push([nx, ny]);
        }
      }
      if (blob.length > best.length) best = blob;
    }
  }
  return best.length >= n * 0.18 ? best : null;
}

export const ARCHETYPES: FloorArchetype[] = [
  {
    id: "warrens",
    // Mixed: junction-y passages AND long halls — the classic maze read.
    windiness: [0.5, 0.9],
    solid: false,
    label: "Warrens",
    flavour: "close corridors · nowhere to build speed",
    braidMult: 1,
    braidGradient: 0,
    seeds: () => null,
    // Tight lanes, a dense web of short tubes, and the maze pressed right up
    // against them: the floor whose flavour promises "nowhere to build speed"
    // should be the one where the circuit is narrowest and busiest. Censused
    // lane share 0.25 → 0.15 from floor 1 to 16 — it thins with depth on
    // purpose, because a Warrens is a maze that happens to have roads.
    track: {
      layout: "scatter",
      foodPer1k: 4.6,
      relayPer1k: 6.4,
      minLoops: 3,
      // A warren is a tight tangle with no centre worth starting in — push the
      // opening hard to an edge so the run reads as burrowing INWARD.
      rules: { perimeterBias: 0.9 },
      laneScale: 0.85,
      fill: 0.60,
      linkChance: 0.34,
      plazaFrac: 0,
      maxLenFrac: 0.34,
      survive: 0.1,
      // "nowhere to build speed" said underfoot rather than only on the card.
      // The launch district is the one band every other archetype makes fast;
      // a Warrens makes it MUD, so the floor refuses you a run-up from the
      // first tile. Rubber through the tangle (the walls are what throw you
      // here, since you will never carry speed of your own) and brass by the
      // exit, where the fight finally pays.
      bands: {
        launch: { [MAT_MUD]: 1 },
        machine: { [MAT_RUBBER]: 1 },
        drain: { [MAT_BRASS]: 1 },
        coverage: 0.26,
      },
    },
  },
  {
    id: "spine",
    windiness: [0.85, 1.0],
    solid: false,
    label: "The Spine",
    flavour: "one long road · everything else is a pocket",
    // The branches should stay dead-endy, or the highway stops being special.
    braidMult: 0.6,
    braidGradient: 0.5,
    seeds: spineSeeds,
    // Food strung around ONE long thin stadium, so the flow solver has no
    // competing route to reinforce and pours everything into a single
    // boulevard with a return run. The lowest loop floor in the game for the
    // same reason: a spine with a web around it is just a Warrens with a wide
    // bit. Wide lanes because the whole promise is plunging down it at speed,
    // and long chords allowed so the boulevard runs the floor's length.
    track: {
      layout: "spine",
      foodPer1k: 2.4,
      relayPer1k: 3.6,
      minLoops: 1,
      // The spine is one long stadium circuit. Starting at an END of it means
      // the boulevard is ahead of you; starting halfway along wastes half the
      // floor's only real straight.
      rules: { perimeterBias: 0.8 },
      laneScale: 1.25,
      fill: 0.60,
      linkChance: 0.22,
      plazaFrac: 0,
      maxLenFrac: 0.55,
      survive: 0.14,
      // The boulevard is the promise, so the boulevard is STEEL: FLOOR_STEEL
      // is the low-friction, faster-walking deck the surface table itself
      // calls "the speedway surface", and brass walls beside it start the
      // chain while you are still accelerating. Only a light rubber presence
      // in the middle — a spine floor's pockets are meant to be pockets, and
      // paving them with gain would make them the place to farm instead.
      bands: {
        launch: { [MAT_BRASS]: 1 },
        machine: { [MAT_RUBBER]: 1 },
        drain: { [MAT_BRASS]: 1 },
        coverage: 0.3,
      },
    },
  },
  {
    id: "greathall",
    windiness: [0.2, 0.5],
    solid: true,
    label: "The Great Hall",
    flavour: "one vast chamber · room to really move",
    braidMult: 0.85,
    braidGradient: 0.4,
    seeds: greatHallSeeds,
    // The hub layout puts a food node dead centre with spokes radiating out;
    // `plazaFrac` then opens that node into the chamber the name promises. The
    // maze fills less of the rind so the hall dominates the floor's read, and
    // the lanes are the widest of any archetype — this is the TABLE floor.
    track: {
      layout: "hub",
      foodPer1k: 2.8,
      relayPer1k: 3.4,
      minLoops: 2,
      // ── THE EXEMPTION, and the reason `perimeterBias` is a weight rather
      // than a global boolean. A Great Hall IS its central chamber — the hub
      // layout puts a food node dead centre and `plazaFrac` carves it open.
      // Spawning on the rim would place the player outside the one thing the
      // floor is about. This is the "unless it's for specific types of levels"
      // case, made explicit instead of being an unstated exception.
      rules: { perimeterBias: 0.15 },
      laneScale: 1.35,
      fill: 0.50,
      linkChance: 0.3,
      // 0.16 was not enough to make the name true. Censused over 36 floors per
      // archetype, the Great Hall's largest fully-open blob covered 0.153 of
      // its walkable area — BEHIND the Warrens' 0.185, which has no plaza and
      // gets there by accident where a dense web's lanes merge. An archetype
      // whose entire promise is "one vast chamber" must own the floor's biggest
      // chamber by measurement, not by flavour text; area goes as the square,
      // so 0.16 -> 0.24 is a 2.25x hall. `buildTrackFloor` steps the radius
      // down until it fits and records `archetype-has-its-chamber` if none
      // does, so a floor that cannot host one is visible rather than silent.
      plazaFrac: 0.29,
      maxLenFrac: 0.45,
      survive: 0.1,
      // The hall IS the machine core, and the machine core is where the
      // heaviest rubber goes: a chamber ringed in walls that throw you back is
      // the only place on any floor where a carom can chain more than twice.
      // This is the archetype the surface system was worth building for.
      bands: {
        launch: { [MAT_BRASS]: 1 },
        machine: { [MAT_RUBBER]: 3, [MAT_BRASS]: 1 },
        drain: { [MAT_BRASS]: 1 },
        coverage: 0.34,
      },
    },
  },
  {
    id: "cavern",
    windiness: [0.1, 0.4],
    solid: true,
    label: "The Cavern",
    flavour: "no straight lines · the rock decides",
    // Caves are loopy already; extra knock-throughs just mush them.
    braidMult: 0.5,
    braidGradient: 0.3,
    seeds: cavernSeeds,
    // The loopiest floor in the game: dense food, the highest loop floor, a
    // permissive pruner and short chords so nothing runs straight for long.
    // "No straight lines · the rock decides" is a claim about TOPOLOGY, and
    // this is where it gets paid for — high circuit rank with short legs is a
    // floor with no through-route, only choices.
    track: {
      layout: "scatter",
      foodPer1k: 3.6,
      relayPer1k: 4.8,
      minLoops: 4,
      // A cave has no architecture to respect, so the edge is as good a mouth
      // as any — but less insistently than a warren, because a cavern's centre
      // is not a landmark you would be missing out on.
      rules: { perimeterBias: 0.7 },
      laneScale: 0.95,
      fill: 0.55,
      linkChance: 0.4,
      plazaFrac: 0,
      maxLenFrac: 0.3,
      survive: 0.07,
      // "the rock decides" is a claim about who is steering, and ICE is the
      // only surface that literally takes the wheel: FLOOR_ICE keeps your
      // heading as well as your speed, so on a floor with no straight lines
      // the bend you are already in decides where you come out. Mud out by the
      // exit for the same reason in reverse — the cave stops you dead rather
      // than letting you ride a chain into the stairwell.
      bands: {
        machine: { [MAT_ICE]: 3, [MAT_RUBBER]: 1 },
        drain: { [MAT_MUD]: 2, [MAT_BRASS]: 1 },
        coverage: 0.3,
      },
    },
  },
  {
    id: "ringkeep",
    windiness: [0.6, 0.8],
    solid: true,
    label: "The Ring Keep",
    flavour: "gallery within gallery · the way in is inward",
    braidMult: 0.7,
    braidGradient: 0.35,
    seeds: ringKeepSeeds,
    // Food on concentric rectangles, so the surviving tubes are galleries and
    // the connections between them are gates. A low link chance keeps the
    // galleries reading as separate roads rather than leaking into one another
    // through the maze — "the way in is inward" only means anything if getting
    // inward is a decision.
    track: {
      layout: "ring",
      // Concentric galleries: the whole progression is working INWARD ring by
      // ring, which only reads if you start on the outermost one.
      rules: { perimeterBias: 0.85 },
      foodPer1k: 2.8,
      relayPer1k: 4.0,
      // Every gallery is a closed loop and every gate between two of them adds
      // another, so a Ring Keep that measures 2 independent cycles is a Ring
      // Keep with one ring. Raised 3 -> 4 once the relay keep-out stopped the
      // mesh short-circuiting the galleries: without a loop floor to hold it,
      // the same pruner that used to eat the Spine takes the inner rings, and
      // a blind census then reads a third of Ring Keeps as Spines (both are
      // "long straight roads, few loops").
      minLoops: 4,
      laneScale: 1.05,
      fill: 0.58,
      linkChance: 0.2,
      plazaFrac: 0,
      maxLenFrac: 0.4,
      survive: 0.14,
      // "the way in is inward" as a gradient you can feel: plain stone on the
      // outer gallery, brass once you are through the first gate, brass and
      // rubber together in the keep. The reward for working inward is that the
      // scoring surface gets richer, which is the only way a concentric floor
      // can pay for the decision it keeps asking you to make.
      bands: {
        machine: { [MAT_BRASS]: 1 },
        drain: { [MAT_BRASS]: 2, [MAT_RUBBER]: 1 },
        coverage: 0.28,
      },
    },
  },
];

/**
 * The archetype for a depth. Cycles every ARCHETYPES.length floors while the
 * biome cycles every 4, so the pair takes 20 floors to repeat instead of 4.
 * Level 1 stays "warrens" — the floor players already know — for the same
 * reason WINDINESS_CYCLE opens at 1.0.
 */
export function archetypeFor(level: number): FloorArchetype {
  return ARCHETYPES[(Math.max(1, level) - 1) % ARCHETYPES.length];
}

/**
 * This floor's growing-tree windiness: a roll inside the archetype's range.
 *
 * Level 1 is pinned to 1.0 — the winding backtracker floor players already know
 * — for the same continuity reason the old WINDINESS_CYCLE opened there. Every
 * deeper floor rolls, so two Caverns twenty floors apart no longer share a
 * corridor texture the way a fixed depth-cycle forced them to.
 */
export function windinessFor(level: number, arch: FloorArchetype, rng: () => number): number {
  if (level <= 1) return 1;
  const [lo, hi] = arch.windiness;
  return lo + rng() * (hi - lo);
}
