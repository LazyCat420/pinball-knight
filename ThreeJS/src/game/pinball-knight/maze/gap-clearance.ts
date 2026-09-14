/** Whole-grid choke audit, including corner-to-corner diagonal apertures. */
import { type Grid, at, isWalkable, setTile, T_FLOOR, T_WALL } from './generator';
import { SHAPE_FULL } from '../engine/tile-shape';
const AXES = [[1, 0], [0, 1], [1, 1], [1, -1]] as const;
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
export function isNarrowGap(g: Grid, i: number, j: number): boolean {
    return at(g, i, j) === T_FLOOR && AXES.some(([x, y]) =>
        at(g, i - x, j - y) === T_WALL && at(g, i + x, j + y) === T_WALL &&
        isWalkable(g, i - y, j + x) && isWalkable(g, i + y, j - x));
}
export function narrowGaps(g: Grid): number[] {
    const out: number[] = [];
    for (let j = 1; j < g.h - 1; j++) for (let i = 1; i < g.w - 1; i++)
        if (isNarrowGap(g, i, j)) out.push(j * g.w + i);
    return out;
}
/** Widen to a 3x3 turning pocket. If masonry is protected, close a redundant
 * slit only when its neighbours still connect locally. The queue revisits
 * changed neighbourhoods; opened floor and closed stone are never reversed. */
export function repairNarrowGaps(g: Grid, protectedWall: (i: number, j: number) => boolean,
    protectedFloor: (i: number, j: number) => boolean = () => true) {
    const initial = narrowGaps(g), queue = [...initial];
    const queued = new Uint8Array(g.t.length), opened = new Uint8Array(g.t.length), closed = new Uint8Array(g.t.length);
    for (const k of queue) queued[k] = 1;
    let widened = 0, sealed = 0;
    const changed = (k: number) => {
        const i = k % g.w, j = Math.floor(k / g.w);
        for (let y = Math.max(1, j - 2); y <= Math.min(g.h - 2, j + 2); y++)
            for (let x = Math.max(1, i - 2); x <= Math.min(g.w - 2, i + 2); x++) {
                const n = y * g.w + x;
                if (!queued[n]) { queued[n] = 1; queue.push(n); }
            }
    };
    for (let h = 0; h < queue.length; h++) {
        const k = queue[h], i = k % g.w, j = Math.floor(k / g.w);
        queued[k] = 0;
        if (!isNarrowGap(g, i, j)) continue;
        let carve: number[] | null = null;
        // Shift the pocket when the centered one meets the map rim or protected
        // stone. This widens an edge corridor inward instead of accepting it.
        for (const [sx, sy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const proposed: number[] = [];
            let blocked = false;
            for (let y = j + sy - 1; y <= j + sy + 1; y++) for (let x = i + sx - 1; x <= i + sx + 1; x++) {
                if (isWalkable(g, x, y)) continue;
                const n = y * g.w + x;
                if (x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1 || at(g, x, y) !== T_WALL || closed[n] || protectedWall(x, y)) blocked = true;
                else proposed.push(n);
            }
            if (blocked || !proposed.length) continue;
            const remainsWall = (x: number, y: number) => at(g, x, y) === T_WALL && !proposed.includes(y * g.w + x);
            if (AXES.some(([x, y]) => remainsWall(i - x, j - y) && remainsWall(i + x, j + y) &&
                isWalkable(g, i - y, j + x) && isWalkable(g, i + y, j - x))) continue;
            carve = proposed;
            break;
        }
        if (carve) {
            for (const n of carve) { setTile(g, n % g.w, Math.floor(n / g.w), T_FLOOR); g.shapes[n] = SHAPE_FULL; if (g.arcIdx) g.arcIdx[n] = -1; opened[n] = 1; changed(n); }
            widened++;
            continue;
        }
        if (opened[k] || protectedFloor(i, j)) continue;
        const neighbours = SIDES.filter(([x, y]) => isWalkable(g, i + x, j + y)).map(([x, y]) => (j + y) * g.w + i + x);
        // Do not create a free-standing pillar or a new wall stub.
        if (neighbours.length !== 2) continue;
        const seen = new Set([neighbours[0]]), visit = [neighbours[0]];
        for (let h = 0; h < visit.length; h++) {
            const n = visit[h], x = n % g.w, y = Math.floor(n / g.w);
            for (const [dx, dy] of SIDES) {
                const nx = x + dx, ny = y + dy, next = ny * g.w + nx;
                if (next === k || Math.abs(nx - i) > 4 || Math.abs(ny - j) > 4 || seen.has(next) || !isWalkable(g, nx, ny)) continue;
                seen.add(next); visit.push(next);
            }
        }
        if (seen.has(neighbours[1])) { setTile(g, i, j, T_WALL); closed[k] = 1; sealed++; changed(k); }
    }
    return { detected: initial.length, widened, closed: sealed, unresolved: narrowGaps(g).length };
}
