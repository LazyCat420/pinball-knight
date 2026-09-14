import { describe, expect, it } from 'vitest';
import { type Grid } from './generator';
import type { PinballPartSpot } from './decorate';
import { enforceLaunchExits, launchExitInspector, unsafeLaunchers } from './launch-exits';
const part = (i: number, j: number, kind: PinballPartSpot['kind'] = 'booster', di = 1, dj = 0): PinballPartSpot => ({ i, j, kind, dirI: di, dirJ: dj, dir2I: 0, dir2J: 0 });
function room(): Grid { const w = 21, h = 15; return { w, h, t: new Uint8Array(w * h), shapes: new Uint8Array(w * h) }; }
function carve(g: Grid, x: number, y: number, w: number, h: number) { for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++)
        g.t[j * g.w + i] = 1; }
describe('finished launch exits', () => {
    it('rejects wall bounce loops beyond the old three-tile runway, regardless of tags', () => {
        const g = room();
        carve(g, 1, 6, 12, 1);
        for (const tags of [{}, { spine: true }, { chute: true }, { circuit: 3 }, { vault: true }]) {
            const p = { ...part(3, 6), ...tags };
            expect(launchExitInspector(g, [p])(p).safe).toBe(false);
        }
    });
    it('accepts an actual steering outlet after the locked launch section', () => {
        const g = room();
        carve(g, 1, 6, 12, 1);
        carve(g, 7, 3, 3, 7);
        const p = part(3, 6);
        expect(launchExitInspector(g, [p])(p).reason).toBe('steering-pocket');
    });
    it('requires a receiving corner to lead somewhere useful', () => {
        const g = room();
        carve(g, 1, 7, 9, 1);
        carve(g, 8, 2, 1, 6);
        carve(g, 5, 1, 7, 3);
        const p = part(6, 7), turn = { ...part(8, 7, 'boostcorner', -1, 0), dir2I: 0, dir2J: -1 };
        expect(unsafeLaunchers(g, [p, turn])).toEqual([]);
        expect(unsafeLaunchers(g, [p])).toEqual([p]);
    });
    it('rejects tangent boosters and chains returning into their own output', () => {
        const g = room();
        carve(g, 1, 1, 18, 12);
        const a = part(3, 6), b = part(5, 6, 'booster', -1, 0);
        expect(unsafeLaunchers(g, [a, b])).toHaveLength(2);
        const narrow = room();
        carve(narrow, 1, 6, 12, 1);
        const tangent = part(3, 6, 'boostcurve', .8, .6);
        expect(unsafeLaunchers(narrow, [tangent])).toEqual([tangent]);
    });
    it('validates the landing instead of trusting the vault flag', () => {
        const g = room();
        carve(g, 1, 6, 3, 1);
        carve(g, 6, 5, 4, 3);
        const p = { ...part(3, 6, 'jumppad'), vault: true };
        expect(launchExitInspector(g, [p])(p).reason).toBe('jump-landing');
        g.t[6 * g.w + 6] = 0;
        expect(launchExitInspector(g, [p])(p).safe).toBe(false);
    });
    it('removes unsafe launches without changing walls or random state', () => {
        const g = room();
        carve(g, 1, 6, 12, 1);
        const parts = [part(3, 6), part(8, 6, 'booster', -1, 0)];
        const tiles = g.t.slice();
        expect(enforceLaunchExits(g, parts)).toBe(2);
        expect(parts).toEqual([]);
        expect(g.t).toEqual(tiles);
    });
});

it('downgrades unsafe structural launchers to passive, completable landmarks', () => {
    const g = room(); carve(g, 1, 6, 12, 1);
    const p = { ...part(3, 6), spine: true };
    const parts = [p];
    enforceLaunchExits(g, parts);
    expect(parts).toEqual([{ ...p, kind: 'rollover' }]);
    expect(unsafeLaunchers(g, parts)).toEqual([]);
});
it('checks the actual landing of a spring wall-hop', () => {
    const g = room(); carve(g, 1, 6, 3, 1); carve(g, 7, 2, 6, 10);
    const p = { ...part(3, 6, 'spring'), span: 6 };
    expect(launchExitInspector(g, [p])(p).reason).toBe('jump-landing');
    g.t[6 * g.w + 9] = 0;
    expect(launchExitInspector(g, [p])(p).safe).toBe(false);
});

it('does not count a corner receiver that rejects this approach at runtime', () => {
    const g = room(); carve(g, 1, 6, 12, 1); carve(g, 1, 2, 3, 10);
    const p = part(3, 6);
    const corner = { ...part(5, 6, 'boostcorner', 0, 1), dir2I: -1, dir2J: 0 };
    expect(launchExitInspector(g, [p, corner])(p).safe).toBe(false);
});

it('rejects an outlet passed before maximum-speed steering unlocks', () => {
    const g = room(); carve(g, 1, 6, 7, 1); carve(g, 6, 2, 2, 9);
    const p = { ...part(3, 6, 'boostcorner', 0, -1), dir2I: 1, dir2J: 0 };
    expect(launchExitInspector(g, [p])(p).safe).toBe(false);
});
