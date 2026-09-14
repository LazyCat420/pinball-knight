import { expect, it, vi } from 'vitest';
import { authorMaze } from './author-floor';
import * as gaps from './gap-clearance';

it('detects and repairs the reported depth-6 seed-1 diagonal corner before shipping', () => {
    const original = gaps.repairNarrowGaps;
    let detected = false;
    const spy = vi.spyOn(gaps, 'repairNarrowGaps').mockImplementation((g, wall, floor, preferClose) => {
        detected ||= gaps.isNarrowGap(g, 55, 30);
        return original(g, wall, floor, preferClose);
    });
    try {
        const f = authorMaze({ level: 6, runSeed: 1 });
        expect(detected).toBe(true);
        expect(gaps.isNarrowGap(f.grid, 55, 30)).toBe(false);
        expect(f.clearanceAudit?.remaining).toEqual([]);
    } finally { spy.mockRestore(); }
});

it('audits complete maps after secrets, wall art and room furniture', () => {
    for (const level of [1, 3, 6, 12, 24]) for (const runSeed of [1, 777, 424242]) {
        const f = authorMaze({ level, runSeed });
        expect(gaps.narrowGaps(f.grid), `L${level}/${runSeed} narrow gaps`).toEqual([]);
    }
}, 120000);
