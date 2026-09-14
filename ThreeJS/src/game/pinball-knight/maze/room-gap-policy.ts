/** Snapshot distinct usable entrances before repairing incidental gaps. */
import { type Grid, isWalkable } from './generator';
import { clearanceField, labelSections, sectionTerritory, planDoorways } from './doorways';

export function roomGapPolicy(g: Grid): (i: number, j: number) => boolean {
    const cl = clearanceField(g);
    const sections = labelSections(g, cl);
    const owner = sectionTerritory(g, sections);
    const entrances = new Uint16Array(sections.sizes.length);
    const mouths = new Uint8Array(g.t.length);
    // planDoorways groups each connected boundary strip, so a five-wide door
    // counts once, while two separate doors to the same room count twice.
    for (const d of planDoorways(g, { cl })) {
        const center = [-1, 0, 1].find(offset => [-1, 0, 1].every(s => [-1, 0, 1].every(t =>
            isWalkable(g, d.i + d.wi * (s + offset) + d.ai * t, d.j + d.wj * (s + offset) + d.aj * t))));
        if (center === undefined) continue;
        entrances[d.a]++; entrances[d.b]++;
        for (let y = d.j - 2; y <= d.j + 2; y++) for (let x = d.i - 2; x <= d.i + 2; x++)
            if (x >= 0 && y >= 0 && x < g.w && y < g.h) mouths[y * g.w + x] = 1;
    }
    return (i, j) => {
        const rooms = new Set<number>();
        for (let y = j - 1; y <= j + 1; y++) for (let x = i - 1; x <= i + 1; x++) {
            const k = y * g.w + x;
            if (mouths[k]) return false;
            if (isWalkable(g, x, y) && owner[k] >= 0) rooms.add(owner[k]);
        }
        // Keep at least two already usable entrances on every affected side.
        // Tiny gaps never contribute to this budget; closing several cannot
        // spend the same supposed replacement exit more than once.
        return rooms.size > 0 && [...rooms].every(r => entrances[r] >= 2);
    };
}
