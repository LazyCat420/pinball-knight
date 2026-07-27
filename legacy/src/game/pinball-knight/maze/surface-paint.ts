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
import { type Grid, isWalkable, setSurface, surfaceAt, ensureSurfaces, worldToTile } from "./generator";
import { mulberry32 } from "../../../utils/rng";
import { material, pickSurface, type SurfaceMix, MAT_STONE } from "../engine/surfaces";

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
