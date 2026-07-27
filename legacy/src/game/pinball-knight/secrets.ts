/**
 * SECRET WALLS — the smash-through payoff.
 *
 * crackSecretWalls (maze/generator) marks the bands, build.ts renders each as
 * its own removable Group; this module owns the moment of impact: a pinball
 * hit at ≥ SECRET_BREAK_SPEED (checked by the caller in player.ts) lands on a
 * cracked tile, the WHOLE 2×2 band shatters — collision opens (the grid is the
 * single source of truth for walls, so pathing/AI follow automatically), the
 * masonry bursts, and the wall pays out loot. Kept out of player.ts so the
 * physics code stays physics.
 */
import * as THREE from "three";
import { state } from "./state";
import { type Grid, T_FLOOR, T_WALL, at, isWalkable, setTile, setSurface, tileCenter } from "./maze/generator";
import { createStaticSprite } from "./engine/render/sprite";
import { ITEM_PAINTS } from "./render/cel-painter";
import { showToast } from "./ui";
import { sfxBreak, sfxHeavy } from "./audio";
import { WITCH_CHANCE, WALL_BREAK_DEPTH } from "./constants";
import { spawnWitch } from "./entities/npc";

/** What tumbles out of the masonry: the gold idol plus one random power-up. */
const RUBBLE_LOOT: ReadonlyArray<ReadonlyArray<string>> = [
  ["gold", "health"],
  ["gold", "rage"],
  ["gold", "haste"],
  ["gold", "shield"],
];

/**
 * Smash the secret band containing tile (i, j), if any. Returns true if a wall
 * actually broke (the caller spends the impact on it instead of bouncing).
 */
export function smashSecretAt(i: number, j: number): boolean {
  const g = state.grid;
  const maze = state.maze;
  if (!g || !maze) return false;

  const idx = maze.secrets.findIndex((s) => i >= s.i && i <= s.i + 1 && j >= s.j && j <= s.j + 1);
  if (idx < 0) return false;
  const band = maze.secrets[idx];

  // Open the grid — collision, flow-field pathing and the minimap of every
  // system that reads tiles see the new doorway at once. Force a flow refresh
  // so the horde can pour through immediately, not FLOW_INTERVAL later.
  for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
    setTile(g, band.i + di, band.j + dj, T_FLOOR);
    // Wall→floor also flips which surface TABLE the tile's byte is read from;
    // reset to neutral so the new doorway is plain rubble. See smashWallAt.
    setSurface(g, band.i + di, band.j + dj, 0);
  }
  state.flowTimer = 0;

  maze.group.remove(band.mesh);
  maze.secrets.splice(idx, 1);

  // The burst: masonry dust + sparks off both faces, a hard crunch.
  for (let k = 0; k < 8; k++) {
    const ox = (Math.random() - 0.5) * 1.6;
    const oz = (Math.random() - 0.5) * 1.6;
    state.vfx?.dust(band.x + ox, 0.1 + Math.random() * 0.6, band.z + oz);
  }
  state.vfx?.sparks(band.x, 0.5, band.z, 0, 0, 18);
  state.shakeT = Math.max(state.shakeT, 0.32);
  state.hitstopT = Math.max(state.hitstopT, 0.07);
  sfxBreak();
  sfxHeavy();

  // Loot shaken out of the wall, dropped on the two newly opened tiles.
  const loot = RUBBLE_LOOT[Math.floor(Math.random() * RUBBLE_LOOT.length)];
  loot.forEach((id, k) => {
    if (!state.scene) return;
    const sprite = createStaticSprite(ITEM_PAINTS[id]);
    const c = tileCenter(g, band.i + (k % 2), band.j + (k % 2 === 0 ? 0 : 1));
    sprite.mesh.position.set(c.x, 0, c.z);
    state.scene.add(sprite.mesh);
    state.groundItems.push({ kind: "potion", id, x: c.x, z: c.z, sprite, bobPhase: Math.random() * Math.PI * 2 });
  });

  // Sometimes the masonry hides more than loot: the SPEED WITCH steps out of
  // the dust (once per floor) and offers her trade.
  if (!state.witchSpawned && Math.random() < WITCH_CHANCE) {
    const c = tileCenter(g, band.i, band.j + 1);
    spawnWitch(c.x, c.z);
  }

  showToast("SECRET WALL SMASHED", "the masonry pays out · a shortcut opens");
  return true;
}

// A hidden matrix: parked far below the floor + collapsed to nothing, so a
// single wall instance vanishes from its InstancedMesh without a rebuild.
const HIDDEN = new THREE.Matrix4().compose(
  new THREE.Vector3(0, -1000, 0),
  new THREE.Quaternion(),
  new THREE.Vector3(0.0001, 0.0001, 0.0001),
);

/**
 * How many consecutive ordinary wall tiles a KOOL-AID smash would have to open
 * at (i,j) travelling (ddx,ddz) before hitting corridor — 0 if this isn't a
 * legal smash at all.
 *
 * This used to probe exactly ONE tile beyond, which quietly made the whole
 * mechanic unreachable: thickenWalls upscales every band to TWO tiles, so the
 * tile past a wall is almost always more wall, and the check failed everywhere
 * except where a band had already been thinned by room-carving or the artery
 * widener. Probing the full band is what makes "smash through anything at full
 * speed" a real move. Still never the shell, and still only INTO a corridor —
 * the maze stays solvable and bounded.
 */
export function wallRunDepth(g: Grid, i: number, j: number, ddx: number, ddz: number): number {
  if (i <= 0 || j <= 0 || i >= g.w - 1 || j >= g.h - 1) return 0; // never the shell
  if (at(g, i, j) !== T_WALL) return 0; // floor/stairs/cracked handled elsewhere
  const si = Math.sign(ddx);
  const sj = Math.sign(ddz);
  for (let d = 1; d <= WALL_BREAK_DEPTH; d++) {
    const ni = i + si * d;
    const nj = j + sj * d;
    if (ni <= 0 || nj <= 0 || ni >= g.w - 1 || nj >= g.h - 1) return 0; // would breach the shell
    if (at(g, ni, nj) === T_WALL) continue; // still inside the band — keep looking
    return isWalkable(g, ni, nj) ? d : 0; // corridor behind it → break the d tiles we crossed
  }
  return 0; // thicker than we're willing to punch through — that's bedrock
}

/**
 * Smash an ordinary wall tile (i,j): open the grid, pop its wall instance out
 * of the InstancedMesh, burst masonry dust. No loot (that's the secret wall's
 * payoff) — the reward here is the shortcut itself. Returns true if it broke.
 */
export function smashWallAt(i: number, j: number): boolean {
  const g = state.grid;
  const maze = state.maze;
  if (!g || !maze) return false;
  if (at(g, i, j) !== T_WALL) return false;

  setTile(g, i, j, T_FLOOR);
  // The tile just changed VOCABULARY: its surface byte was a WallSurface and is
  // now read as a FloorSurface (engine/surfaces.ts shares one array between the
  // two). Left alone, a smashed mud wall would come back as steel decking —
  // both are id 3. Rubble underfoot is plain stone, so reset to the neutral 0.
  setSurface(g, i, j, 0);
  state.flowTimer = 0; // let the horde re-path through the new gap immediately

  const inst = maze.wallAt.get(`${i},${j}`);
  if (inst) {
    inst.mesh.setMatrixAt(inst.index, HIDDEN);
    inst.mesh.instanceMatrix.needsUpdate = true;
    maze.wallAt.delete(`${i},${j}`);
  }

  const c = tileCenter(g, i, j);
  for (let k = 0; k < 7; k++) {
    const ox = (Math.random() - 0.5) * 1.4;
    const oz = (Math.random() - 0.5) * 1.4;
    state.vfx?.dust(c.x + ox, 0.1 + Math.random() * 0.6, c.z + oz);
  }
  state.vfx?.sparks(c.x, 0.5, c.z, 0, 0, 14);
  state.shakeT = Math.max(state.shakeT, 0.28);
  state.hitstopT = Math.max(state.hitstopT, 0.06);
  sfxBreak();
  sfxHeavy();
  return true;
}
