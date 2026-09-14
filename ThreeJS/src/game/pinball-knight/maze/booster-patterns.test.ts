import { expect, it } from 'vitest';
import { BOOSTER_PATTERNS, patternParts, placeBoosterPatterns } from './booster-patterns';
import { type Grid } from './generator';
import type { PinballPartSpot } from './decorate';
import { enforceLaunchExits, unsafeLaunchers } from './launch-exits';
function room(): Grid { const w = 41, h = 41, t = new Uint8Array(w * h).fill(1); for (let i = 0; i < w; i++)
    t[i] = t[(h - 1) * w + i] = 0; for (let j = 0; j < h; j++)
    t[j * w] = t[j * w + w - 1] = 0; return { w, h, t, shapes: new Uint8Array(w * h) }; }
for (const [offset, pattern] of BOOSTER_PATTERNS.entries())
    for (let r = 0; r < 4; r++) {
        it(`${pattern.name} has a safe output and matching rotated handoffs (rotation ${r})`, () => {
            const g = room(), parts = patternParts(pattern.name, { i: 20, j: 20 }, r);
            expect(unsafeLaunchers(g, parts)).toEqual([]);
            for (let k = 0; k < parts.length - 1; k++) {
                const p = parts[k], next = parts[k + 1], dx = p.kind === 'boostcorner' ? p.dir2I : p.dirI, dy = p.kind === 'boostcorner' ? p.dir2J : p.dirJ;
                expect(Math.sign(next.i - p.i)).toBeCloseTo(dx);
                expect(Math.sign(next.j - p.j)).toBeCloseTo(dy);
            }
            const placed: PinballPartSpot[] = [];
            expect(placeBoosterPatterns(g, placed, [{ i: 10, j: 10 }], { count: 1, budget: 4, offset, allowed: () => true })).toBe(1);
            expect(placed).toHaveLength(pattern.pads.length);
        });
    }
it('reserves complete patterns and refuses a partial budget or blocked route', () => {
    const g = room(), parts: PinballPartSpot[] = [];
    expect(placeBoosterPatterns(g, parts, [{ i: 10, j: 10 }], { count: 1, budget: 2, allowed: () => true })).toBe(0);
    expect(parts).toEqual([]);
    expect(placeBoosterPatterns(g, parts, [{ i: 10, j: 10 }], { count: 1, budget: 8, allowed: () => false })).toBe(0);
    expect(parts).toEqual([]);
});
it('removes the whole pattern if a later pass removes a required member', () => {
    const g = room(), parts = patternParts('chicane', { i: 10, j: 10 });
    parts.splice(1, 1);
    expect(enforceLaunchExits(g, parts)).toBe(3);
    expect(parts).toEqual([]);
});
