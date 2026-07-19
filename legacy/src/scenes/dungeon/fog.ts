/**
 * FOG OF WAR — which tiles of this floor the knight has actually seen.
 *
 * The dungeon had no exploration state at all before this: no `visited`, no
 * `seen`, no per-tile metadata beyond the tile type itself. (The one hint it was
 * anticipated is a comment in `secrets.ts` about "the minimap of every system
 * that reads tiles".) So this is the one genuinely new data structure the map
 * needs; everything else it draws already exists on `state`.
 *
 * Deliberately a flat `Uint8Array` parallel to `Grid.t` rather than a Set of
 * coordinates or a field on a tile object: it is read once per tile per map
 * repaint over a grid that reaches ~134×102 on deep floors, and a typed array
 * keeps that a bounds check and an index.
 *
 * MUST be re-allocated per floor — `levelConfig()` changes the grid dimensions
 * every level, so a fog buffer carried across a descent would be both the wrong
 * size and a spoiler.
 */
import { at, T_WALL, type Grid } from "./maze/generator";

/** Seen states. Ordered so `Math.max` promotes and never demotes. */
export const FOG_HIDDEN = 0;
/** Seen from a distance — draw it dim. Walls adjacent to explored floor. */
export const FOG_DIM = 1;
/** Walked past. Full brightness. */
export const FOG_SEEN = 2;

export interface Fog {
  w: number;
  h: number;
  /** Row-major, `v[j * w + i]`, matching Grid.t exactly. */
  v: Uint8Array;
  /**
   * Bumped whenever a tile's state actually rises.
   *
   * Lets a repaint guard ask "has anything been revealed?" in O(1). The
   * alternative — sampling the buffer — is false precision: a sparse sample can
   * miss the very tile that changed, and a full scan costs as much as the
   * repaint it was meant to avoid.
   */
  rev: number;
}

/** A fresh, fully-hidden fog buffer sized to `g`. */
export function createFog(g: Grid): Fog {
  return { w: g.w, h: g.h, v: new Uint8Array(g.w * g.h), rev: 0 };
}

/** Fog lookup. Out of bounds reads as hidden, so callers never bounds-check. */
export function fogAt(f: Fog, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= f.w || j >= f.h) return FOG_HIDDEN;
  return f.v[j * f.w + i];
}

/** Raise a tile's fog state; never lowers it. Bumps `rev` on a real change. */
function raise(f: Fog, i: number, j: number, level: number): void {
  if (i < 0 || j < 0 || i >= f.w || j >= f.h) return;
  const k = j * f.w + i;
  if (f.v[k] < level) {
    f.v[k] = level;
    f.rev++;
  }
}

/**
 * Reveal a disc around (ci, cj).
 *
 * Not a line-of-sight cast: the dungeon's mazes are thick-walled and the map is
 * a navigation aid, not a stealth mechanic — a radius reads better and costs a
 * fraction as much. Walls just outside the radius are marked DIM so corridors
 * have visible edges instead of floating in blackness, which is what makes the
 * map legible at a glance.
 */
export function revealAround(f: Fog, g: Grid, ci: number, cj: number, radius: number): void {
  const r2 = radius * radius;
  const rim = radius + 1;

  for (let dj = -rim; dj <= rim; dj++) {
    for (let di = -rim; di <= rim; di++) {
      const d2 = di * di + dj * dj;
      if (d2 > rim * rim) continue;
      const i = ci + di;
      const j = cj + dj;
      if (d2 <= r2) {
        raise(f, i, j, FOG_SEEN);
      } else if (at(g, i, j) === T_WALL) {
        // Only the rim's WALLS go dim — dim floor beyond the radius would give
        // away the layout you haven't reached yet.
        raise(f, i, j, FOG_DIM);
      }
    }
  }
}

/** How many tiles have been seen at all — for a completion readout. */
export function exploredCount(f: Fog): number {
  let n = 0;
  for (let k = 0; k < f.v.length; k++) if (f.v[k] !== FOG_HIDDEN) n++;
  return n;
}

/**
 * Fraction of the floor's WALKABLE tiles explored, 0–1.
 *
 * Counts against walkable rather than total tiles: after `thickenWalls` most of
 * a grid is solid rock, so "12% explored" for a fully-walked floor would be a
 * lie. Returns 0 for a degenerate grid rather than dividing by zero.
 */
export function exploredFraction(f: Fog, g: Grid): number {
  let walkable = 0;
  let seen = 0;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (at(g, i, j) === T_WALL) continue;
      walkable++;
      if (fogAt(f, i, j) !== FOG_HIDDEN) seen++;
    }
  }
  return walkable === 0 ? 0 : seen / walkable;
}
