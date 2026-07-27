/**
 * TRACK FLOOR — the track-first generator, packaged as a drop-in base grid.
 *
 * `core.ts startLevel` builds a floor in two halves:
 *
 *     A. base grid   generateMaze → carveRooms → stamps → thickenWalls
 *                    → pickEndpoints → widenMainArtery
 *     B. content     decorateMaze (parts, zombies, torches, arcs, rooms…)
 *
 * This module replaces **half A only**. Half B is large, well-tested and has
 * nothing to do with topology, so it keeps running exactly as it does today —
 * it just receives a grid whose main artery is a grown circuit rather than a
 * widened accident.
 *
 * ── Why this generates at FINAL resolution ────────────────────────────────
 *
 * The shipped path builds a half-scale cell maze and then `thickenWalls`
 * doubles it, which is what turns 1-wide slots into the 2-wide corridors the
 * renderer's low-rim/tall-back trick needs. The track has no use for that: it
 * already carves lanes 3-5 tiles wide with real radii, and doubling would turn
 * a radius-6 fillet into a radius-12 one and blow the floor budget. So we
 * generate at the FINAL tile scale and skip thickening entirely.
 *
 * The consequence to keep in mind: callers must NOT call `thickenWalls` on
 * this grid, and room rects/anchors from the shipped stamp passes (which are
 * authored in half-scale cell coords and scaled ×2 afterwards) do not apply.
 * `buildTrackFloor` therefore returns a grid that is already final.
 *
 * DOM- and three-free.
 */
import { type Grid, type TilePos, T_FLOOR, T_STAIRS, at, idx, isWalkable, setTile } from "./generator";
import { growTrack, circuitRank, type TrackGraph } from "./track-grow";
import { buildTrackPath, type TrackPath } from "./track-path";
import { carveTrack, carveChamber, growMazeAround, publishArcs, connectAll, type TrackMask } from "./track-carve";
import { DEFAULT_TRACK_PROFILE, trackNodeCounts, type TrackProfile } from "./archetypes";
import { uncarveDeadEnds, removeWallStubs, healRoadTerminations } from "./track-socket";
import { bfsDistances } from "../engine/flow-field";

export interface TrackFloor {
  grid: Grid;
  graph: TrackGraph;
  path: TrackPath;
  mask: TrackMask;
  /** Spawn and exit, chosen ON the circuit (see pickTrackEndpoints). */
  start: TilePos;
  stairs: TilePos;
}

/**
 * Spawn and exit, both placed ON the track.
 *
 * Deliberately different from `pickEndpoints`, which picks the tile nearest a
 * random corner and then the farthest tile from it. That rule is right for a
 * maze — where the journey IS the floor — and wrong for a circuit, because it
 * would routinely drop the player in a maze cul-de-sac with the exit in
 * another one, and the track they are meant to ride would be scenery between
 * two errands.
 *
 * Here both endpoints sit on the circuit and are pushed as far apart as the
 * lane allows, so the natural route between them RUNS THE TRACK.
 */
export function pickTrackEndpoints(g: Grid, mask: TrackMask): { start: TilePos; stairs: TilePos } | null {
  const lane: TilePos[] = [];
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (mask.lane[idx(g, i, j)] && isWalkable(g, i, j)) lane.push({ i, j });
    }
  }
  if (lane.length < 2) return null;

  // Double sweep: farthest lane tile from an arbitrary one, then farthest from
  // that. The graph diameter along the actual walkable surface, so the two ends
  // are genuinely a lap apart rather than merely far in a straight line.
  const far = (from: TilePos): { pos: TilePos; d: number } => {
    const dist = bfsDistances(g, from.i, from.j);
    let bestPos = from;
    let best = -1;
    for (const p of lane) {
      const d = dist[idx(g, p.i, p.j)];
      if (d > best && d < 0x3fffffff) {
        best = d;
        bestPos = p;
      }
    }
    return { pos: bestPos, d: best };
  };
  const a = far(lane[0]).pos;
  const b = far(a);
  if (b.d <= 0) return null;
  return { start: a, stairs: b.pos };
}

/**
 * Build a complete track-first base grid at FINAL tile resolution.
 *
 * `cellsW/cellsH` are the caller's half-scale numbers (what `generateMaze`
 * takes) and the grid comes out at `(2c+1)` per side.
 *
 * `profile` is the floor archetype's grip on the topology (archetypes.ts). It
 * is optional so every existing caller keeps the shipped behaviour, but the
 * game always passes one — without it the five archetypes are names on a card
 * over five identical floors.
 */
export function buildTrackFloor(
  cellsW: number,
  cellsH: number,
  rng: () => number,
  opts: { linkChance?: number; fill?: number; minLoops?: number; profile?: TrackProfile; density?: number } = {},
): TrackFloor | null {
  const w = cellsW * 2 + 1;
  const h = cellsH * 2 + 1;
  const grid: Grid = { w, h, t: new Uint8Array(w * h), shapes: new Uint8Array(w * h) };

  // Explicit `opts` still win over the profile, so the debug spawner and the
  // tuning scripts can override one knob without inventing a whole profile.
  const prof = opts.profile ?? DEFAULT_TRACK_PROFILE;
  const { foods, relays } = trackNodeCounts(prof, w, h);

  const graph = growTrack(w, h, rng, {
    minLoops: opts.minLoops ?? prof.minLoops,
    layout: prof.layout,
    foods,
    relays,
    maxLenFrac: prof.maxLenFrac,
    survive: prof.survive,
  });
  if (graph.edges.length === 0) return null;
  const path = buildTrackPath(graph, { laneScale: prof.laneScale });
  if (path.legs.length === 0) return null;

  const mask = carveTrack(grid, path);
  // THE PLAZA GOES DOWN BEFORE THE MAZE, never after. Carved afterwards it
  // would bulldoze finished corridors and leave severed stubs pointing into it;
  // carved here it is simply part of the circuit, and the maze's keep-out
  // margin respects it like any other lane. Sited on the surviving graph node
  // nearest the floor's centre — under the `hub` layout that IS the centre food
  // node — and `carveChamber` declines rather than clip a plaza on the border.
  if (prof.plazaFrac > 0 && graph.nodes.length) {
    const cx = w / 2;
    const cz = h / 2;
    let hub = graph.nodes[0];
    for (const n of graph.nodes) {
      if ((n.x - cx) ** 2 + (n.z - cz) ** 2 < (hub.x - cx) ** 2 + (hub.z - cz) ** 2) hub = n;
    }
    carveChamber(grid, mask, hub.x, hub.z, Math.min(w, h) * prof.plazaFrac);
  }
  growMazeAround(grid, mask, rng, {
    linkChance: opts.linkChance ?? prof.linkChance,
    fill: opts.fill ?? prof.fill,
    density: opts.density,
  });

  // ── PLUMBING REPAIR (track-socket.ts) ───────────────────────────────────
  //
  // The growth model makes an interesting layout but not a legible one. Before
  // these passes, 20 floors measured 105.8 dead ends and 116.4 wall stubs EACH
  // — corridors to nowhere and one-tile nubs jutting into rooms, which is what
  // made the floor read as "a bunch of walls that go nowhere".
  //
  // Order is load-bearing:
  //  1. UNCARVE first. It fills floor→wall and so can disconnect things, which
  //     is fine only because connectAll runs after it.
  //  2. DE-STUB second, on the result — uncarving creates new wall shapes and
  //     some of them are stubs.
  //  3. connectAll LAST, to restore the one-component invariant uncarve may
  //     have broken. Carving wall→floor can only add connectivity, so nothing
  //     after this can strand the player.
  const endsEarly = pickTrackEndpoints(grid, mask);
  uncarveDeadEnds(grid, mask, endsEarly ? [endsEarly.start, endsEarly.stairs] : []);
  // De-stub runs AFTER growMazeAround's widening pass, which is itself what
  // creates most of the stubs: thickening a corridor leaves one-tile pillars
  // and nubs behind (measured 25.2 stubs + 5.2 isolated pillars per floor
  // straight after widening).
  connectAll(grid, rng);
  // De-stub LAST of the tile passes. It must run after BOTH widening (which
  // leaves one-tile pillars when a corridor thickens) and connectAll (whose
  // repair corridors carve fresh nubs of their own). Running it before either
  // one left 25.2 stubs + 5.2 isolated pillars per floor still standing.
  removeWallStubs(grid, mask);
  // A lane that still ends in mid-air is DEMOTED to plain room floor, so no
  // booster or bank is ever sited along a road to nowhere.
  //
  // Note what this does NOT do: it no longer tries to EXTEND the stub to
  // rejoin the circuit. That was tried and it chases its own tail — each
  // extension creates a new tile that is itself the new end of the road
  // ("joined" fired 8-24x per floor while the termination count never moved).
  // The real cause was topological (degree-1 leaves in the graph) and is fixed
  // upstream by pruneLeaves; this is only the belt-and-braces sweep.
  if (endsEarly) healRoadTerminations(grid, mask, [endsEarly.start, endsEarly.stairs], { reach: 0 });

  // AFTER the maze AND the repairs, never before: every pass above carves
  // walls to floor, and a shoulder marked earlier is a tile claiming curved
  // collision on open ground (measured 20.6% orphaned when published early).
  publishArcs(grid, path);

  const ends = pickTrackEndpoints(grid, mask);
  if (!ends) return null;
  setTile(grid, ends.stairs.i, ends.stairs.j, T_STAIRS);

  return { grid, graph, path, mask, start: ends.start, stairs: ends.stairs };
}

/** Independent cycles in the circuit — exposed for HUD/debug and tests. */
export function floorCircuitRank(f: TrackFloor): number {
  return circuitRank(f.graph);
}
