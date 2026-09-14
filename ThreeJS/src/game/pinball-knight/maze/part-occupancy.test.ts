import { expect, it } from 'vitest';
import { appendOnlyPartOccupancy } from './part-occupancy';
it('matches the former spacing scans at borders and after each placement', () => {
    const parts: {
        i: number;
        j: number;
    }[] = [];
    const near = appendOnlyPartOccupancy({ w: 21, h: 17 }, parts);
    for (let k = 0; k < 70; k++) {
        parts.push({ i: (k * 7) % 21, j: (k * 11) % 17 });
        for (const manhattan of [false, true])
            for (let r = 0; r < 5; r++) {
                const i = (k * 13) % 21, j = (k * 3) % 17;
                expect(near(i, j, r, manhattan)).toBe(parts.some(p => (manhattan ? Math.abs(p.i - i) + Math.abs(p.j - j) : Math.max(Math.abs(p.i - i), Math.abs(p.j - j))) <= r));
            }
    }
});
