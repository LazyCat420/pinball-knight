import { describe, expect, it } from 'vitest';
import { findTeleportDestination } from './boss-moves';
import { circleCollides } from './engine/collision';
import { T_FLOOR, tileCenter, type Grid } from './maze/generator';
import { authorMaze } from './maze/author-floor';
import { guardianFor } from './boss-kinds';
import { BRUTE_R } from './constants';

describe('boss teleport landing safety', () => {
  it('declines a teleport when all landing candidates are blocked', () => {
    const grid: Grid = { w: 9, h: 9, t: new Uint8Array(81), shapes: new Uint8Array(81) };
    grid.t[4 * 9 + 4] = T_FLOOR;
    expect(findTeleportDestination(0, 0, 4, grid, 0.78)).toBeNull();
  });
  for (const seed of [1, 777, 12345]) it(`never places the level 5 boss in a wall, seed ${seed}`, () => {
    const spec = guardianFor(5);
    expect(spec.kind).toBe('reaper_king');
    const { grid } = authorMaze({ level: 5, runSeed: seed, bonusRoom: false });
    const radius = BRUTE_R * spec.art.scale * 0.86;
    let checked = 0, safe = 0;
    for (let j = 1; j < grid.h - 1; j++) for (let i = 1; i < grid.w - 1; i++) {
      if (grid.t[j * grid.w + i] !== T_FLOOR) continue;
      const c = tileCenter(grid, i, j);
      const dest = findTeleportDestination(c.x, c.z, spec.moves.teleportFire!.distance, grid, radius);
      checked++;
      if (dest) safe++;
      if (dest) expect(circleCollides(grid, dest.x, dest.z, radius), `target ${i},${j}; landing ${dest.x},${dest.z}`).toBe(false);
    }
    expect(checked).toBeGreaterThan(20);
    expect(safe).toBeGreaterThan(0);
  });
});
