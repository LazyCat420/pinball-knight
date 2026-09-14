import { type Grid, type TilePos, at, T_FLOOR } from './generator';
import type { PinballPartSpot } from './decorate';
import { launchExitInspector } from './launch-exits';
type Pad = readonly [
    number,
    number,
    PinballPartSpot['kind'],
    number,
    number,
    number?,
    number?
];
export const BOOSTER_PATTERNS: ReadonlyArray<{
    name: string;
    pads: readonly Pad[];
}> = [
    { name: 'acceleration', pads: [[0, 0, 'booster', 1, 0], [4, 0, 'booster', 1, 0], [8, 0, 'booster', 1, 0]] },
    { name: 'jump-relay', pads: [[0, 0, 'booster', 1, 0], [4, 0, 'jumppad', 1, 0], [9, 0, 'booster', 1, 0]] },
    { name: 'chicane', pads: [[0, 0, 'booster', 1, 0], [2, 0, 'boostcorner', -1, 0, 0, 1], [2, 2, 'boostcorner', 0, -1, 1, 0], [4, 2, 'booster', 1, 0]] },
];
const rotate = (x: number, y: number, r: number): readonly [
    number,
    number
] => r === 0 ? [x, y] : r === 1 ? [-y, x] : r === 2 ? [-x, -y] : [y, -x];
export function patternParts(name: string, origin: TilePos, rotation = 0): PinballPartSpot[] {
    const pattern = BOOSTER_PATTERNS.find(p => p.name === name);
    if (!pattern)
        throw new Error(`Unknown booster pattern: ${name}`);
    const id = `${name}:${origin.i},${origin.j}:${rotation}`;
    return pattern.pads.map(([x, y, kind, dx, dy, ex = 0, ey = 0]) => {
        const [i, j] = rotate(x, y, rotation), [dirI, dirJ] = rotate(dx, dy, rotation), [dir2I, dir2J] = rotate(ex, ey, rotation);
        return { i: origin.i + i, j: origin.j + j, kind, dirI, dirJ, dir2I, dir2J, chain: true, pattern: name, patternId: id, patternSize: pattern.pads.length };
    });
}
/** Bounded, atomic placement in the existing chain budget. Spatial occupancy
 * makes candidate rejection independent of the total number of existing parts. */
export function placeBoosterPatterns(g: Grid, parts: PinballPartSpot[], candidates: readonly TilePos[], opts: {
    count: number;
    budget: number;
    offset?: number;
    allowed: (p: PinballPartSpot) => boolean;
}): number {
    const occupied = new Uint8Array(g.w * g.h);
    const claim = (p: TilePos) => { for (let y = p.j - 1; y <= p.j + 1; y++)
        for (let x = p.i - 1; x <= p.i + 1; x++)
            if (x >= 0 && y >= 0 && x < g.w && y < g.h)
                occupied[y * g.w + x] = 1; };
    parts.forEach(claim);
    let placed = 0;
    for (const origin of candidates) {
        if (placed >= opts.count)
            break;
        const pattern = BOOSTER_PATTERNS[((opts.offset ?? 0) + placed) % BOOSTER_PATTERNS.length];
        if (parts.length + pattern.pads.length > opts.budget)
            break;
        for (let rotation = 0; rotation < 4; rotation++) {
            const proposed = patternParts(pattern.name, origin, rotation);
            if (proposed.some(p => at(g, p.i, p.j) !== T_FLOOR || occupied[p.j * g.w + p.i] || !opts.allowed(p)))
                continue;
            // Every hand-off segment must be floor, with no foreign part in between.
            let blocked = false;
            for (let k = 0; k < proposed.length - 1; k++) {
                const a = proposed[k], b = proposed[k + 1], steps = Math.abs(b.i - a.i) + Math.abs(b.j - a.j);
                const dx = Math.sign(b.i - a.i), dy = Math.sign(b.j - a.j);
                for (let s = 1; s < steps; s++)
                    if (at(g, a.i + dx * s, a.j + dy * s) !== T_FLOOR || occupied[(a.j + dy * s) * g.w + a.i + dx * s])
                        blocked = true;
            }
            if (blocked)
                continue;
            const inspect = launchExitInspector(g, [...parts, ...proposed]);
            if (proposed.some(p => !inspect(p).safe))
                continue;
            parts.push(...proposed);
            proposed.forEach(claim);
            placed++;
            break;
        }
    }
    return placed;
}
