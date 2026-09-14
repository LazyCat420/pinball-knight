import { expect, it } from 'vitest';
import { type Grid } from './generator';
import { thickenDiagonalWalls } from './diagonal-walls';
function room(): Grid { const w = 19, h = 19, t = new Uint8Array(w * h).fill(1); for (let x = 0; x < w; x++)
    t[x] = t[(h - 1) * w + x] = 0; for (let y = 0; y < h; y++)
    t[y * w] = t[y * w + w - 1] = 0; return { w, h, t, shapes: new Uint8Array(w * h) }; }
it('backs a thin staircase with solid 2x2 steps', () => {
    const g = room();
    for (const [x, y] of [[7, 7], [8, 7], [8, 8], [9, 8], [9, 9]])
        g.t[y * g.w + x] = 0;
    expect(thickenDiagonalWalls(g)).toBeGreaterThan(0);
    expect(g.t[8 * g.w + 7]).toBe(0);
});
it('preserves protected routes and authored shapes', () => {
    const g = room();
    g.t[7 * g.w + 7] = g.t[8 * g.w + 8] = 0;
    const before = g.t.slice();
    expect(thickenDiagonalWalls(g, () => true)).toBe(0);
    expect(g.t).toEqual(before);
    g.shapes[7 * g.w + 7] = 1;
    expect(thickenDiagonalWalls(g)).toBe(0);
});
it('does not pinch a three-tile corridor', () => {
    const g = room();
    for (let y = 1; y < 18; y++)
        g.t[y * g.w + 4] = 0;
    g.t[7 * g.w + 8] = g.t[8 * g.w + 8] = g.t[7 * g.w + 7] = g.t[9 * g.w + 9] = 0;
    thickenDiagonalWalls(g);
    expect(g.t[8 * g.w + 7]).toBe(1);
});

it('does not fill ordinary room corners or grow repairs into more repairs', () => {
    const g = room();
    for (let y = 1; y <= 8; y++) for (let x = 1; x <= 8; x++) g.t[y * g.w + x] = 0;
    const before = g.t.slice();
    expect(thickenDiagonalWalls(g)).toBe(0);
    expect(g.t).toEqual(before);
});

it('leaves isolated L-shaped bends alone', () => {
    const g = room();
    g.t[7 * g.w + 7] = g.t[7 * g.w + 8] = g.t[8 * g.w + 8] = 0;
    expect(thickenDiagonalWalls(g)).toBe(0);
});

it('preserves oblique clearance when the opposing wall misses cardinal rays', () => {
    const g = room();
    for (const [x, y] of [[7, 7], [8, 7], [8, 8], [9, 8], [9, 9], [4, 5]])
        g.t[y * g.w + x] = 0;
    thickenDiagonalWalls(g);
    expect(g.t[8 * g.w + 7]).toBe(1);
});
