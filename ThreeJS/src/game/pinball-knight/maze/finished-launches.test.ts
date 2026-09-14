import { expect, it } from 'vitest';
import { authorMaze } from './author-floor';
import { unsafeLaunchers } from './launch-exits';
it('ships actual booster varieties with no forced wall traps after all population repairs', () => {
    const patterns = new Set<string>();
    let boosters = 0;
    for (const level of [1, 2, 3, 4, 5, 6])
        for (const runSeed of [1, 777, 424242]) {
            const { grid, plan } = authorMaze({ level, runSeed });
            expect(unsafeLaunchers(grid, plan.parts), `L${level}/${runSeed}`).toEqual([]);
            for (const p of plan.parts) {
                if (p.pattern)
                    patterns.add(p.pattern);
                if (p.kind === 'booster')
                    boosters++;
            }
        }
    expect([...patterns].sort()).toEqual(['acceleration', 'chicane', 'jump-relay']);
    expect(boosters).toBeGreaterThan(50);
}, 120000);
