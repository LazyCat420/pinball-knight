/**
 * WALL EROSION — masonry that takes PARTIAL damage.
 *
 * Until now a wall was binary: `smashWallAt` opened it if you arrived faster
 * than WALL_BREAK_SPEED, and did nothing at all if you didn't. There was no
 * such thing as a damaged wall, which made "the lava marble melts the wall a
 * little bit" unimplementable — there was no "a little bit" to express.
 *
 * This is that middle state. A tile accumulates erosion 0..1; below 1 it is
 * still solid and still collides, but it visibly slumps and glows. At 1 it
 * hands off to `smashWallAt`, so the grid-opening path (tile vocabulary reset,
 * flow-field re-path, instance removal) stays single-sourced — this module
 * never opens a wall itself.
 *
 * Deliberately GENERIC: `erodeWallAt` takes an amount, not a material. Lava is
 * the only supplier today; a borer enemy or an acid hazard would reuse it
 * unchanged.
 *
 * ── The rendering constraint that shapes this ──
 * Walls are InstancedMeshes, one per bucket, and `maze.wallAt` maps a tile to
 * its `{ mesh, index }`. So the melt has to be expressible as a per-instance
 * matrix + colour, with no new geometry and no extra draw calls. It is: the
 * instance sags in Y (its base pinned to the floor) and tints toward molten.
 */
import * as THREE from "three";
import { state } from "../state";
import { at, worldToTile, type Grid } from "../engine/grid";
import { T_WALL } from "../maze/generator";
import { smashWallAt } from "../secrets";
import {
  WALL_EROSION_MELT_SAG,
  WALL_EROSION_EMBERS,
  LAVA_MELT_PER_HIT,
  LAVA_MELT_MIN_SPEED,
  LAVA_MELT_SPEED_SCALE,
} from "../constants";

const key = (i: number, j: number): string => `${i},${j}`;

/**
 * The instance's ORIGINAL transform, captured the first time a tile erodes.
 *
 * Needed because the melt is expressed as a scale about the tile's base, and
 * recovering the base from an already-sagged matrix would compound rounding
 * every hit — the wall would drift downward through the floor over a long
 * enough rally.
 */
const original = new Map<string, { y: number; height: number }>();

/**
 * The floor the current scars belong to.
 *
 * Erosion is keyed by TILE, and tile (12,7) on floor 3 has nothing to do with
 * tile (12,7) on floor 4 — carrying the map across a descent would start the
 * next floor with a wall already half-melted, at a coordinate chosen by the
 * previous level's geometry.
 *
 * Invalidating LAZILY here, rather than from a reset call in the descent path,
 * is deliberate: core.ts is under a size ratchet whose whole point is that new
 * work lands in the module that owns the concern. A reset call there would also
 * be one more thing a future descent path could forget; this cannot be
 * forgotten, because every read goes through it.
 */
let scarsForLevel = -1;

/** Drop the scars if we have crossed onto a new floor. */
function syncFloor(): void {
  if (scarsForLevel === state.level) return;
  scarsForLevel = state.level;
  state.wallErosion.clear();
  original.clear();
}

const scratchMatrix = new THREE.Matrix4();
const scratchPos = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchColor = new THREE.Color();

/** Erosion on a tile, 0 (pristine) .. 1 (about to break). */
export function wallErosionAt(i: number, j: number): number {
  syncFloor();
  return state.wallErosion.get(key(i, j)) ?? 0;
}

/** Drop every tracked scar. Exposed for tests and for a hard run reset. */
export function resetWallErosion(): void {
  scarsForLevel = state.level;
  state.wallErosion.clear();
  original.clear();
}

/**
 * Ensure `mesh.instanceColor` exists WITHOUT blacking out the bucket.
 *
 * three.js allocates instanceColor zero-filled on the first `setColorAt`, so
 * every instance that is never written renders BLACK (maze/build.ts documents
 * this at length — it is why tinting is decided per bucket there). Eroding one
 * wall in an all-stone bucket would otherwise turn every other wall in that
 * bucket into a black slab. So: if the buffer does not exist yet, allocate it
 * and paint every instance white first.
 */
function ensureInstanceColor(mesh: THREE.InstancedMesh): void {
  if (mesh.instanceColor) return;
  scratchColor.setRGB(1, 1, 1);
  for (let k = 0; k < mesh.count; k++) mesh.setColorAt(k, scratchColor);
}

/** Repaint one instance to match its erosion: sagging and glowing. */
function paintErosion(i: number, j: number, e: number): void {
  const maze = state.maze;
  const inst = maze?.wallAt.get(key(i, j));
  if (!inst) return;
  const { mesh, index } = inst;

  let orig = original.get(key(i, j));
  if (!orig) {
    mesh.getMatrixAt(index, scratchMatrix);
    scratchMatrix.decompose(scratchPos, scratchQuat, scratchScale);
    // The build writes the instance at y = height/2 with unit scale, so the
    // block's height is twice its centre height.
    orig = { y: scratchPos.y, height: scratchPos.y * 2 };
    original.set(key(i, j), orig);
  }

  // SAG about the base. Scaling a box about its centre would sink it into the
  // floor as much as it lowers the top, and the wall would read as SUBSIDING
  // rather than melting down from above.
  const sy = Math.max(0.05, 1 - e * WALL_EROSION_MELT_SAG);
  mesh.getMatrixAt(index, scratchMatrix);
  scratchMatrix.decompose(scratchPos, scratchQuat, scratchScale);
  scratchScale.set(1, sy, 1);
  scratchPos.y = (orig.height * sy) / 2;
  scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
  mesh.setMatrixAt(index, scratchMatrix);
  mesh.instanceMatrix.needsUpdate = true;

  // GLOW toward molten. Red rises fastest, then green — the sequence a heated
  // solid actually goes through, and the reason it reads as temperature rather
  // than as someone painting the wall orange.
  ensureInstanceColor(mesh);
  scratchColor.setRGB(1 + e * 1.6, 1 - e * 0.35, 1 - e * 0.8);
  mesh.setColorAt(index, scratchColor);
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/**
 * Add `amount` of erosion to the wall at (i,j).
 *
 * Returns "broken" if this pushed it over and the wall opened, "eroded" if it
 * took damage and still stands, or "none" if the tile was not erodible masonry.
 */
export function erodeWallAt(i: number, j: number, amount: number): "broken" | "eroded" | "none" {
  syncFloor();
  const g: Grid | null = state.grid;
  if (!g || amount <= 0) return "none";
  // Never the shell: the same rule `wallRunDepth` enforces. Melting the outer
  // ring would open the level onto unbuilt space.
  if (i <= 0 || j <= 0 || i >= g.w - 1 || j >= g.h - 1) return "none";
  if (at(g, i, j) !== T_WALL) return "none";

  const k = key(i, j);
  const e = (state.wallErosion.get(k) ?? 0) + amount;

  if (e >= 1) {
    // Hand off — smashWallAt owns opening the grid, resetting the tile's
    // surface vocabulary, re-pathing the horde and removing the instance.
    state.wallErosion.delete(k);
    original.delete(k);
    smashWallAt(i, j);
    return "broken";
  }

  state.wallErosion.set(k, e);
  paintErosion(i, j, e);
  return "eroded";
}

/**
 * 🔥 LAVA: melt the wall this bounce just hit.
 *
 * `nx,nz` is the wall's outward normal (pointing back at the ball), so stepping
 * AGAINST it from the ball's position lands inside the tile that was struck.
 *
 * Speed-scaled and deliberately small: the ask was "melts the wall a little
 * bit, not full damage". At LAVA_MELT_PER_HIT a wall wants several solid hits,
 * which is what makes a melted-through shortcut feel earned rather than
 * incidental.
 */
export function lavaMeltWall(nx: number, nz: number, speed: number): void {
  const g = state.grid;
  const p = state.player;
  if (!g || !p || speed < LAVA_MELT_MIN_SPEED) return;

  // Step just past the contact point, into the masonry.
  const t = worldToTile(g, p.x - nx * 0.6, p.z - nz * 0.6);
  const amount = LAVA_MELT_PER_HIT * (1 + (speed - LAVA_MELT_MIN_SPEED) * LAVA_MELT_SPEED_SCALE);
  const result = erodeWallAt(t.i, t.j, amount);
  if (result === "none") return;

  // Embers off the melt point, thrown back along the normal — the tell that
  // something is happening to the WALL and not just to the ball.
  for (let n = 0; n < WALL_EROSION_EMBERS; n++) {
    state.vfx?.ember(p.x - nx * 0.4 + (Math.random() - 0.5) * 0.4, 0.4 + Math.random() * 0.5, p.z - nz * 0.4 + (Math.random() - 0.5) * 0.4);
  }
  if (result === "broken") {
    state.vfx?.burst(p.x - nx * 0.5, 0.6, p.z - nz * 0.5, 0xf0a63c, 16, 4);
    state.shakeT = Math.max(state.shakeT, 0.2);
  }
}
