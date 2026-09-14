import { expect, it, vi } from 'vitest';
import { authorMaze } from './author-floor';
import * as gaps from './gap-clearance';
it('uses both closure and widening on generated floors', () => {
    const original = gaps.repairNarrowGaps;
    let closed = 0, widened = 0, survived = 0;
    let filled: number[] = [];
    const spy = vi.spyOn(gaps, 'repairNarrowGaps').mockImplementation((g, wall, floor, preference) => {
        const before = preference ? g.t.slice() : null;
        const result = original(g, wall, floor, preference);
        if (before) for (let k = 0; k < g.t.length; k++) if (before[k] === 1 && g.t[k] === 0) filled.push(k);
        if (preference) { closed += result.preferredClosed; widened += result.widened; }
        return result;
    });
    try {
        for (const level of [1, 3, 6, 12, 24]) for (const runSeed of [1, 777, 424242]) {
            filled = [];
            const f = authorMaze({level, runSeed});
            survived += filled.filter(k => f.grid.t[k] === 0).length;
        }
        expect(survived).toBeGreaterThan(0);
        expect(closed).toBeGreaterThan(0); expect(widened).toBeGreaterThan(0);
    } finally { spy.mockRestore(); }
}, 120000);
