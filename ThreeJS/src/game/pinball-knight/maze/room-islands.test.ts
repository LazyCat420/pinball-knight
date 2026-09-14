import { expect, it } from 'vitest';
import { authorRoomIslands, roomActivitySites } from './room-islands';
import { narrowGaps } from './gap-clearance';
import { type Grid } from './generator';
function room(w = 41): Grid { return { w, h: w, t: new Uint8Array(w * w).fill(1), shapes: new Uint8Array(w * w) }; }
it('places solid small islands with wide circulation and no one-tile apertures', () => {
    const g = room(); const islands = authorRoomIslands(g, () => false);
    expect(islands.length).toBeGreaterThan(0);
    for (const { i, j } of islands) {
        for (let y = j - 1; y <= j + 1; y++) for (let x = i; x <= i + 1; x++) expect(g.t[y * g.w + x]).toBe(0);
        for (let d = -5; d <= 5; d++) { expect(g.t[(j + d) * g.w + i - 3]).toBe(1); expect(g.t[(j + d) * g.w + i + 4]).toBe(1); }
    }
    expect(narrowGaps(g)).toEqual([]);
});
it('keeps protected routes clear and offers activities in rooms too small for islands', () => {
    const g = room(13);
    expect(authorRoomIslands(g, () => false)).toEqual([]);
    expect(roomActivitySites(g, () => false).length).toBeGreaterThan(0);
    expect(authorRoomIslands(room(), () => true)).toEqual([]);
});
