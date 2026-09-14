import { expect, it } from 'vitest';
import { type Grid } from './generator';
import { type PinballPartSpot } from './decorate';
import { placeRoomActivity } from './room-activities';
const part = (i: number, j: number): PinballPartSpot => ({ i, j, kind: 'bumper', dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0 });
it('replaces loose clutter atomically while preserving existing structures', () => {
    const g: Grid = { w: 41, h: 41, t: new Uint8Array(1681).fill(1), shapes: new Uint8Array(1681) };
    const kept = { ...part(30, 30), chute: true };
    const parts = [kept, ...[9, 10, 11].flatMap(i => [part(i, 9), part(i, 10)])];
    expect(placeRoomActivity(g, parts, [{ i: 10, j: 10 }], { budget: 7, allowed: () => true })).toBe(1);
    expect(parts).toContain(kept);
    expect(parts.filter(p => p.pattern === 'chicane')).toHaveLength(4);
    expect(parts.length).toBeLessThanOrEqual(7);
});
it('leaves the original furniture unchanged when the activity cannot fit', () => {
    const g: Grid = { w: 41, h: 41, t: new Uint8Array(1681), shapes: new Uint8Array(1681) };
    const parts = [part(10, 10)], before = [...parts];
    expect(placeRoomActivity(g, parts, [{ i: 10, j: 10 }], { budget: 4, allowed: () => true })).toBe(0);
    expect(parts).toEqual(before);
});
