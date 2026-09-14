import { patternParts } from './booster-patterns';
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
            const groups = new Map<string, typeof plan.parts>();
        for (const p of plan.parts) if (p.patternId) {
            const group = groups.get(p.patternId) ?? [];
            group.push(p); groups.set(p.patternId, group);
        }
        for (const [id, group] of groups) {
            const [name, origin, rotation] = id.split(':');
            const [i, j] = origin.split(',').map(Number);
            const expected = patternParts(name, { i, j }, Number(rotation));
            expect(group).toHaveLength(expected.length);
            for (const p of expected) expect(group).toContainEqual(expect.objectContaining({
                i: p.i, j: p.j, kind: p.kind, dirI: p.dirI, dirJ: p.dirJ, dir2I: p.dir2I, dir2J: p.dir2J,
            }));
        }
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
