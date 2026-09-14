/** Give rasterized diagonal boundaries a solid 2x2 backing where it fits.
 * Local floor connectivity and three-tile passage clearance take precedence. */
import { type Grid, at, isWalkable, T_FLOOR, T_WALL, setTile } from './generator';
import { SHAPE_FULL } from '../engine/tile-shape';
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const CLEARANCE_DIRS = [...DIRS, [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
export function thickenDiagonalWalls(g: Grid, protectedTile: (i: number, j: number) => boolean = () => false): number {
    let filled = 0;
    // Classify the original boundary: newly added backing must never seed
    // another repair and consume an ordinary room corner.
    const original = { ...g, t: g.t.slice() };
    for (let j = 2; j < g.h - 3; j++)
        for (let i = 2; i < g.w - 3; i++) {
            const square = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]] as const;
            if (square.some(([x, y]) => g.shapes[y * g.w + x] !== SHAPE_FULL))
                continue;
            const walls = square.map(([x, y]) => at(original, x, y) === T_WALL);
            const count = walls.filter(Boolean).length;
            // Three-square elbows, or two walls touching only at a diagonal point.
            if (count !== 3 && !(count === 2 && walls[0] === walls[3] && walls[1] === walls[2]))
                continue;
            // A lone L-shaped corner is not a diagonal boundary. Require
            // the original staircase to continue outside this square.
            if (count === 3) {
                const continuation = walls[0] && walls[3]
                    ? [[i - 1, j - 1], [i + 2, j + 2]]
                    : [[i + 2, j - 1], [i - 1, j + 2]];
                if (!continuation.some(([x, y]) => at(original, x, y) === T_WALL &&
                    DIRS.filter(([dx, dy]) => at(original, x + dx, y + dy) === T_FLOOR).length >= 2)) continue;
            }
            const fill = square.filter((_, k) => !walls[k]);
            if (!square.some(([x, y], k) => walls[k] &&
                DIRS.filter(([dx, dy]) => at(original, x + dx, y + dy) === T_FLOOR).length >= 2))
                continue;
            if (fill.some(([x, y]) => at(g, x, y) !== T_FLOOR || protectedTile(x, y)))
                continue;
            // Do not touch the backing of an authored shape or special wall.
            if (square.some(([x, y]) => DIRS.some(([dx, dy]) => {
                const k = (y + dy) * g.w + x + dx;
                return g.shapes[k] !== SHAPE_FULL || (at(g, x + dx, y + dy) !== T_FLOOR && at(g, x + dx, y + dy) !== T_WALL);
            })))
                continue;
            const blocked = new Set(fill.map(([x, y]) => y * g.w + x));
            const open = (x: number, y: number) => isWalkable(g, x, y) && !blocked.has(y * g.w + x);
            let pinched = false;
            for (const [x, y] of fill)
                for (const [dx, dy] of CLEARANCE_DIRS) {
                    // Diagonal wall corners can oppose each other without a
                    // cardinal slit. Keep three samples clear on these axes too.
                    let gap = 0;
                    for (let d = 1; d <= 3; d++) {
                        if (!open(x + dx * d, y + dy * d))
                            break;
                        gap++;
                    }
                    if (gap > 0 && gap < 3)
                        pinched = true;
                }
            if (pinched)
                continue;
            // Each removed floor tile's surviving neighbours must still connect locally.
            // A local proof is conservative: failure means leave the original floor.
            const neighbours = new Set<number>();
            for (const [x, y] of fill)
                for (const [dx, dy] of DIRS)
                    if (open(x + dx, y + dy))
                        neighbours.add((y + dy) * g.w + x + dx);
            const first = neighbours.values().next().value;
            if (first !== undefined) {
                const seen = new Set<number>([first]), queue = [first];
                for (let h = 0; h < queue.length; h++) {
                    const k = queue[h], x = k % g.w, y = Math.floor(k / g.w);
                    for (const [dx, dy] of DIRS) {
                        const nx = x + dx, ny = y + dy, nk = ny * g.w + nx;
                        if (nx < i - 3 || nx > i + 4 || ny < j - 3 || ny > j + 4 || !open(nx, ny) || seen.has(nk))
                            continue;
                        seen.add(nk);
                        queue.push(nk);
                    }
                }
                if ([...neighbours].some(k => !seen.has(k)))
                    continue;
            }
            for (const [x, y] of fill) {
                setTile(g, x, y, T_WALL);
                filled++;
            }
        }
    return filled;
}
