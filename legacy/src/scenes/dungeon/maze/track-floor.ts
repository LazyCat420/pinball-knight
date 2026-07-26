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
import { carveTrack, growMazeAround, type TrackMask } from "./track-carve";
import { bfsDistances } from "../entities/ai";

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
 * takes), doubled here so a floor comes out the same size it would have after
 * `thickenWalls` — depth pacing and every area-scaled budget in core.ts stay
 * calibrated.
 */
export function buildTrackFloor(
  cellsW: number,
  cellsH: number,
  rng: () => number,
  opts: { linkChance?: number; fill?: number; minLoops?: number } = {},
): TrackFloor | null {
  const w = cellsW * 2 + 1;
  const h = cellsH * 2 + 1;
  const grid: Grid = { w, h, t: new Uint8Array(w * h), shapes: new Uint8Array(w * h) };

  const graph = growTrack(w, h, rng, { minLoops: opts.minLoops ?? 2 });
  if (graph.edges.length === 0) return null;
  const path = buildTrackPath(graph);
  if (path.legs.length === 0) return null;

  const mask = carveTrack(grid, path);
  growMazeAround(grid, mask, rng, { linkChance: opts.linkChance, fill: opts.fill });

  const ends = pickTrackEndpoints(grid, mask);
  if (!ends) return null;
  setTile(grid, ends.stairs.i, ends.stairs.j, T_STAIRS);

  return { grid, graph, path, mask, start: ends.start, stairs: ends.stairs };
}

/** Independent cycles in the circuit — exposed for HUD/debug and tests. */
export function floorCircuitRank(f: TrackFloor): number {
  return circuitRank(f.graph);
}
