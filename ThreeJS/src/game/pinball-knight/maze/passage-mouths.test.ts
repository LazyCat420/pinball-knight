import { expect, it } from 'vitest';
import { clearPassageMouths } from './passage-mouths';
import { type Grid } from './generator';
import { type Doorway } from './doorways';
const door: Doorway = { i: 5, j: 5, ai: 1, aj: 0, wi: 0, wj: 1, w: 3, want: 3, back: 0, fwd: 0, a: 1, b: 2, carved: 0 };
function room(): Grid { return { w: 13, h: 13, t: new Uint8Array(169).fill(1), shapes: new Uint8Array(169) }; }
it('removes opposing two-tile noses only through to an existing full-width exit', () => {
    const g = room();
    for (const y of [4, 6]) for (const x of [6, 7]) g.t[y * g.w + x] = 0;
    expect(clearPassageMouths(g, [door])).toBe(4);
    for (let x = 5; x <= 8; x++) for (let y = 4; y <= 6; y++) expect(g.t[y * g.w + x]).toBe(1);
    expect(clearPassageMouths(g, [door])).toBe(0);
});
it('does not drill through a dead end or an indefinitely narrow corridor', () => {
    for (const deadEnd of [true, false]) {
        const g = room();
        for (let x = 6; x <= 10; x++) g.t[4 * g.w + x] = 0;
        if (deadEnd) g.t[5 * g.w + 7] = 0;
        const before = g.t.slice();
        expect(clearPassageMouths(g, [door])).toBe(0);
        expect(g.t).toEqual(before);
    }
});
it('rejects an entire approach when a nose contains protected masonry', () => {
    const g = room();
    g.t[4 * g.w + 6] = g.t[6 * g.w + 6] = 0;
    expect(clearPassageMouths(g, [door], (x, y) => x === 6 && y === 6)).toBe(0);
    expect(g.t[4 * g.w + 6]).toBe(0);
});
it('handles the opposite mouth and rotated doorway', () => {
    const g = room();
    g.t[4 * g.w + 4] = 0;
    expect(clearPassageMouths(g, [door])).toBe(1);
    g.t[6 * g.w + 4] = 0;
    expect(clearPassageMouths(g, [{ ...door, ai: 0, aj: 1, wi: 1, wj: 0 }])).toBe(1);
});
