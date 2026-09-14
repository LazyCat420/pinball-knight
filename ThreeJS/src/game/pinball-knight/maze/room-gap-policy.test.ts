import { expect, it } from 'vitest';
import { type Grid } from './generator';
import { roomGapPolicy } from './room-gap-policy';
import { repairNarrowGaps } from './gap-clearance';
function rooms(openings: number[]): Grid {
    const w = 35, h = 31, t = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) t[y * w + x] = x === 17 ? 0 : 1;
    for (const y of openings) for (let dy = -1; dy <= 1; dy++) t[(y + dy) * w + 17] = 1;
    t[15 * w + 17] = 1;
    return { w, h, t, shapes: new Uint8Array(w * h) };
}
it('widens a gap when a room has only one other usable entrance', () => {
    const g = rooms([8]);
    expect(roomGapPolicy(g)(17, 15)).toBe(false);
    const result = repairNarrowGaps(g, () => false, () => false, roomGapPolicy(g));
    expect(result.closed).toBe(0); expect(result.widened).toBeGreaterThan(0);
});
it('closes the redundant gap when both rooms have two usable entrances', () => {
    const g = rooms([8, 22]);
    expect(roomGapPolicy(g)(17, 15)).toBe(true);
    const result = repairNarrowGaps(g, () => false, () => false, roomGapPolicy(g));
    expect(result.closed).toBe(1); expect(result.widened).toBe(0);
    for (const y of [7,8,9,21,22,23]) expect(g.t[y * g.w + 17]).toBe(1);
});
