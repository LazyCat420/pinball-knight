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
import { state } from "./state";
import { T_FLOOR, setTile, tileCenter } from "./maze/generator";
import { createStaticSprite } from "./render/sprite";
import { ITEM_PAINTS } from "./render/cel-painter";
import { showToast } from "./ui";
import { sfxBreak, sfxHeavy } from "./audio";

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

  showToast("SECRET WALL SMASHED", "the masonry pays out · a shortcut opens");
  return true;
}
