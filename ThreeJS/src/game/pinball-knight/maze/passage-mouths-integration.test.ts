import { expect, it, vi } from 'vitest';
import { authorMaze } from './author-floor';
import * as mouths from './passage-mouths';

it('clears real entrance noses before content and keeps their tiles open', () => {
    const original = mouths.clearPassageMouths;
    const cleared: number[] = [];
    const spy = vi.spyOn(mouths, 'clearPassageMouths').mockImplementation((g, doors, protectedTile) => {
        const before = g.t.slice();
        const count = original(g, doors, protectedTile);
        for (let k = 0; k < before.length; k++) if (before[k] === 0 && g.t[k] === 1) cleared.push(k);
        return count;
    });
    try {
        const f = authorMaze({ level: 6, runSeed: 1 });
        expect(cleared.length).toBeGreaterThan(0);
        for (const k of cleared) expect(f.grid.t[k]).not.toBe(0);
    } finally { spy.mockRestore(); }
});
