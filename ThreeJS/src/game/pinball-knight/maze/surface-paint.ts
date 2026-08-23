/**
 * SURFACE PAINTER — decides what each region of a floor is MADE of.
 *
 * Runs after the grid is final (topology, shapes, cracks, prefabs all settled)
 * and writes one byte per tile into `Grid.surfaces`. It never moves a wall, so
 * it cannot affect reachability, solvability or any of the invariants
 * `floor-pipeline.test.ts` pins — this is a pure re-skin of the physics on an
 * already-valid floor.
 *
 * ── TWO DESIGN RULES, both learned the hard way elsewhere in this repo ───────
 *
 * **1. Patches, never per-tile noise.** The first instinct is to roll a surface
 * per tile from the mix. That produces visual confetti and, worse, mechanically
 * illegible floors: a corridor of alternating rubber and mud is not a decision,
 * it is a slot machine. Materials are stamped as contiguous BLOBS so a region
 * reads as one substance and a player can route around it — which is the whole
 * point of the system. Same lesson as the maze's own prefab stamps.
 *
 * **2. Its own RNG stream.** `startLevel` threads a single seeded `rng` through
 * generation, and every draw shifts what every later call sees. Painting off
 * that stream would reroll the LAYOUT of every existing floor the day it merged
 * — the standing repo rule (ROUTE_MATH_PLAN Part 8) is that new generation
 * behaviour must leave existing floors bit-identical. So the painter derives
 * its own stream from the same seed and consumes zero draws from the caller's.
 *
 * DOM- and three-free: tested in surface-paint.test.ts.
 */
import { type Grid, type TilePos, idx, isWalkable, setSurface, surfaceAt, ensureSurfaces, worldToTile } from "./generator";
import { mulberry32 } from "../../../utils/rng";
import { material, pickSurface, type SurfaceMix, MAT_STONE } from "../engine/surfaces";
import { bfsDistances } from "../engine/flow-field";

/** Blob radii, in tiles. Small enough that a patch is a room-ish feature rather
 *  than a biome, big enough that you can see where it starts from outside it. */
export const PATCH_MIN_R = 2.5;
export const PATCH_MAX_R = 6.0;

/**
 * Tiles kept baseline around the start and the stairs.
 *
 * The start tile is where a player forms their first impression of a floor, and
 * a mud patch under their feet on arrival reads as the controls being broken
 * rather than as terrain. The stairs get the same protection so the last thing
 * a floor does is not steal the exit.
 */
export const SAFE_R = 4;

export interface PaintOpts {
  /** Relative weights over MaterialId (engine/surfaces.ts). Empty → no-op. */
  mix: SurfaceMix;
  /**
   * Roughly what fraction of the floor to cover, 0..1. Approximate on purpose:
   * patches overlap and clip on walls, so this drives the patch COUNT rather
   * than being measured and corrected. A measured version would need a second
   * pass over the grid for a number nobody consumes.
   */
  coverage: number;
  /** World-space points kept baseline (start, stairs). */
  safeSpots?: Array<{ x: number; z: number }>;
}

/**
 * Paint `g.surfaces` from a material mix. Returns the number of tiles actually
 * written, which is what the tests assert on and what `core.ts` logs.
 *
 * Deterministic in (seed, grid, opts) and idempotent: painting the same grid
 * twice with the same seed produces the same bytes, so a re-entrant startLevel
 * cannot double-paint into something different.
 */
export function paintSurfaces(g: Grid, seed: number, opts: PaintOpts): number {
  const weightTotal = Object.keys(opts.mix).reduce((s, k) => s + (opts.mix[Number(k)] ?? 0), 0);
  if (weightTotal <= 0 || opts.coverage <= 0) return 0;
  ensureSurfaces(g);

  // Derived, NOT the caller's stream — see rule 2 in the header. The mixing
  // constant is the same golden-ratio odd word startLevel uses for its own
  // per-level split, so two floors of one run never share a paint stream.
  const rng = mulberry32((seed ^ 0x5f3a7c1b) >>> 0);

  // Safe zones in TILE space, resolved once: the per-tile test below runs over
  // every tile of every patch, and re-deriving them there was the whole cost.
  const safe = (opts.safeSpots ?? []).map((s) => worldToTile(g, s.x, s.z));

  const area = g.w * g.h;
  const meanPatch = Math.PI * ((PATCH_MIN_R + PATCH_MAX_R) / 2) ** 2;
  // +1 so a small floor with a tiny coverage still gets one visible patch
  // rather than rounding to zero and silently ignoring its own modifier.
  const patches = Math.max(1, Math.round((area * opts.coverage) / meanPatch));

  let painted = 0;
  for (let p = 0; p < patches; p++) {
    const mat = material(pickSurface(opts.mix, rng, MAT_STONE));
    if (mat.id === MAT_STONE) continue; // a stone patch is a no-op, not a repaint
    const cx = rng() * g.w;
    const cz = rng() * g.h;
    const r = PATCH_MIN_R + rng() * (PATCH_MAX_R - PATCH_MIN_R);
    // Elliptical with a per-patch aspect, so blobs don't all read as circles
    // stamped by the same cookie cutter.
    const aspect = 0.65 + rng() * 0.7;
    const rx = r * aspect;
    const rz = r / aspect;
    const i0 = Math.max(0, Math.floor(cx - rx));
    const i1 = Math.min(g.w - 1, Math.ceil(cx + rx));
    const j0 = Math.max(0, Math.floor(cz - rz));
    const j1 = Math.min(g.h - 1, Math.ceil(cz + rz));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5 - cx) / rx;
        const dz = (j + 0.5 - cz) / rz;
        if (dx * dx + dz * dz > 1) continue;
        if (safe.some((s) => Math.abs(s.i - i) <= SAFE_R && Math.abs(s.j - j) <= SAFE_R)) continue;
        // THE ONE LINE THAT MATTERS: the same material writes a WALL id into a
        // solid tile and a FLOOR id into a walkable one. They are different
        // vocabularies sharing one byte (see engine/surfaces.ts), so getting
        // this branch backwards would silently give every icy floor mud physics.
        const v = isWalkable(g, i, j) ? mat.floor : mat.wall;
        // Count TILES CHANGED, not writes. Patches overlap freely (that is what
        // makes the blobs read as organic), so counting writes would report a
        // number bigger than the floor has tiles and quietly break any caller
        // that treats it as coverage.
        if (surfaceAt(g, i, j) !== v) painted++;
        setSurface(g, i, j, v);
      }
    }
  }
  return painted;
}

// ── BAND PAINTING — the second author, and the reason there needed to be one ──
//
// Until this section the 5x5 surface matrix had exactly ONE author: a floor
// modifier, which rolls on 45% of floors from level 3 and paints uniformly at
// random over the whole map. So the most original mechanic in the game — five
// materials whose walls and floors compose with the marble, the corner gain and
// the combo chain — was reachable only as weather. Nothing about a floor's
// SHAPE could ask for a surface, which meant the speedway near the spawn, the
// bumper core and the vault by the stairs all played on identical stone.
//
// `decorateMaze` has drawn a three-zone floor since Slice 9: a room's archetype
// is picked from how far it sits from the spawn — LAUNCH district near the
// start, MACHINE core in the middle, DRAIN lane out by the exit — and corridor
// width, friction and enemy density already ride the same distance. Painting
// from those bands ties the material to the pacing that was already there
// instead of inventing a second, competing geography.
//
// Same two rules as the painter above: blobs rather than per-tile noise, and
// its own rng stream so the LAYOUT of every floor stays bit-identical. Nothing
// here moves a tile, so reachability cannot move either.

/** Distance-from-spawn fractions that separate the three zones. Matched to
 *  `furnishRooms`, which has cut its room archetypes at the same two numbers
 *  since Slice 9 — a second set of thresholds would put the materials and the
 *  furniture on visibly different maps. */
export const BAND_LAUNCH_END = 0.34;
export const BAND_MACHINE_END = 0.68;

/** Which zone a distance fraction falls in. 0 = launch, 1 = machine, 2 = drain. */
export function bandOf(frac: number): 0 | 1 | 2 {
  return frac < BAND_LAUNCH_END ? 0 : frac < BAND_MACHINE_END ? 1 : 2;
}

/**
 * What an archetype (or theme, or any other author) wants each zone made of.
 *
 * Every field optional and an absent field paints nothing, so an author opts in
 * one zone at a time rather than having to describe a whole floor.
 */
export interface BandPaint {
  /** Near the spawn — the launch district, where the player builds speed. */
  launch?: SurfaceMix;
  /** The middle of the floor — the machine core, where the chain gets racked. */
  machine?: SurfaceMix;
  /** Out by the stairs — the drain lane, the fight and the reward. */
  drain?: SurfaceMix;
  /** Roughly what fraction of each band to cover. Same approximation as
   *  `PaintOpts.coverage`: it drives patch COUNT, it is not measured back. */
  coverage?: number;
}

/**
 * Paint the three distance zones from a band table. Returns tiles changed.
 *
 * Runs AFTER `paintSurfaces` in core.ts, so a floor modifier's weather is the
 * base coat and the archetype's zoning is what shows through on top — the
 * modifier is the loud, announced, once-in-a-while event and the zoning is the
 * floor's permanent character, which is the order they should land in.
 */
export function paintBands(g: Grid, seed: number, start: TilePos, bands: BandPaint, safeSpots?: Array<{ x: number; z: number }>): number {
  const mixes = [bands.launch, bands.machine, bands.drain];
  if (!mixes.some((m) => m && Object.keys(m).length)) return 0;
  const coverage = bands.coverage ?? 0.35;
  if (coverage <= 0) return 0;
  ensureSurfaces(g);

  // Its own stream, and a different mixing word from `paintSurfaces` so the two
  // authors do not draw correlated blobs on the same floor.
  const rng = mulberry32((seed ^ 0x2c1b3f5d) >>> 0);
  const safe = (safeSpots ?? []).map((s) => worldToTile(g, s.x, s.z));

  // ONE BFS, and everything derived from it here: `bfsDistances` hands back a
  // shared scratch buffer that the next caller overwrites.
  const dist = bfsDistances(g, start.i, start.j);
  let maxD = 0;
  for (let k = 0; k < dist.length; k++) if (dist[k] > maxD) maxD = dist[k];
  if (maxD <= 0) return 0;

  // Band membership per tile, precomputed: the patch loop below tests it once
  // per tile per patch and re-deriving it there was the whole cost. −1 = wall
  // or unreachable, which no band owns.
  const band = new Int8Array(g.w * g.h).fill(-1);
  const counts = [0, 0, 0];
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const k = idx(g, i, j);
      if (!isWalkable(g, i, j) || dist[k] < 0) continue;
      const b = bandOf(dist[k] / maxD);
      band[k] = b;
      counts[b]++;
    }
  }

  // Candidate patch centres per band. Collected rather than sampled by
  // rejection because the drain band on a long floor can be a thin rind, and a
  // rejection sampler on a thin target either misses or biases toward its fat
  // end — the band would then be painted where it is widest instead of evenly.
  const centres: number[][] = [[], [], []];
  for (let k = 0; k < band.length; k++) if (band[k] >= 0) centres[band[k]].push(k);

  const meanPatch = Math.PI * ((PATCH_MIN_R + PATCH_MAX_R) / 2) ** 2;
  let painted = 0;

  for (let b = 0; b < 3; b++) {
    const mix = mixes[b];
    if (!mix || !Object.keys(mix).length || !centres[b].length) continue;
    const patches = Math.max(1, Math.round((counts[b] * coverage) / meanPatch));
    for (let p = 0; p < patches; p++) {
      const mat = material(pickSurface(mix, rng, MAT_STONE));
      if (mat.id === MAT_STONE) continue; // a stone patch is a no-op, not a repaint
      const k0 = centres[b][Math.floor(rng() * centres[b].length)];
      const cx = (k0 % g.w) + 0.5;
      const cz = Math.floor(k0 / g.w) + 0.5;
      const r = PATCH_MIN_R + rng() * (PATCH_MAX_R - PATCH_MIN_R);
      const aspect = 0.65 + rng() * 0.7;
      const rx = r * aspect;
      const rz = r / aspect;
      const i0 = Math.max(0, Math.floor(cx - rx));
      const i1 = Math.min(g.w - 1, Math.ceil(cx + rx));
      const j0 = Math.max(0, Math.floor(cz - rz));
      const j1 = Math.min(g.h - 1, Math.ceil(cz + rz));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const dx = (i + 0.5 - cx) / rx;
          const dz = (j + 0.5 - cz) / rz;
          if (dx * dx + dz * dz > 1) continue;
          if (safe.some((s) => Math.abs(s.i - i) <= SAFE_R && Math.abs(s.j - j) <= SAFE_R)) continue;
          const k = idx(g, i, j);
          const walk = isWalkable(g, i, j);
          // A patch is CLIPPED TO ITS BAND, which is what makes the zoning
          // legible: a blob that bled across the launch/machine line would put
          // rubber where the card says speedway and the player would read the
          // whole system as random. Walls carry the band of a walkable
          // neighbour — they have no distance of their own, and an unpainted
          // wall around a painted floor is the bounce not matching the ground.
          if (walk) {
            if (band[k] !== b) continue;
          } else if (!wallTouchesBand(g, band, i, j, b)) continue;
          const v = walk ? mat.floor : mat.wall;
          if (surfaceAt(g, i, j) !== v) painted++;
          setSurface(g, i, j, v);
        }
      }
    }
  }
  return painted;
}

/** True when a solid tile has a 4-neighbour walkable tile in band `b`. */
function wallTouchesBand(g: Grid, band: Int8Array, i: number, j: number, b: number): boolean {
  for (const [di, dj] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const ni = i + di;
    const nj = j + dj;
    if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h) continue;
    if (band[idx(g, ni, nj)] === b) return true;
  }
  return false;
}
