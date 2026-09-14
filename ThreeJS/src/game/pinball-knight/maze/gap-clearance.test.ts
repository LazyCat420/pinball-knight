import { expect, it } from 'vitest';
import { type Grid } from './generator';
import { narrowGaps, repairNarrowGaps } from './gap-clearance';
function room(): Grid { const w = 17, h = 17, t = new Uint8Array(w * h).fill(1); for (let i = 0; i < w; i++) t[i] = t[(h - 1) * w + i] = 0; for (let j = 0; j < h; j++) t[j * w] = t[j * w + w - 1] = 0; return { w, h, t, shapes: new Uint8Array(w * h) }; }
for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) it(`widens a one-tile aperture across ${dx},${dy}`, () => {
    const g = room();
    g.t[(8 - dy) * g.w + 8 - dx] = g.t[(8 + dy) * g.w + 8 + dx] = 0;
    expect(narrowGaps(g)).toContain(8 * g.w + 8);
    const result = repairNarrowGaps(g, () => false);
    expect(result.widened).toBeGreaterThan(0);
    expect(result.unresolved).toBe(0);
    for (let y = 7; y <= 9; y++) for (let x = 7; x <= 9; x++) expect(g.t[y * g.w + x]).toBe(1);
    expect(repairNarrowGaps(g, () => false).widened).toBe(0);
});
it('closes a redundant slit when its stone is protected and an alternate route exists', () => {
    const g = room(); g.t[8 * g.w + 7] = g.t[8 * g.w + 9] = 0;
    const result = repairNarrowGaps(g, () => true, () => false);
    expect(result.closed).toBe(1); expect(g.t[8 * g.w + 8]).toBe(0);
});
it('reports protected essential gaps instead of disconnecting the only route', () => {
    const g = room(); for (let x = 1; x < g.w - 1; x++) if (x !== 8) g.t[8 * g.w + x] = 0;
    const result = repairNarrowGaps(g, () => true, () => false);
    expect(result.closed).toBe(0); expect(result.unresolved).toBeGreaterThan(0);
});
