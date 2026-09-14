/** Preserve the width of an authored doorway through short obstructed approaches.
 * Snapshot classification and a fixed three-tile reach prevent erosion from
 * creating fresh candidates. No new tunnel or room connection is excavated. */
import { type Grid, at, isWalkable, setTile, T_FLOOR, T_WALL } from './generator';
import { type Doorway } from './doorways';
import { SHAPE_FULL } from '../engine/tile-shape';

export function clearPassageMouths(g: Grid, doors: readonly Doorway[], protectedTile: (i: number, j: number) => boolean = () => false): number {
    const original = { ...g, t: g.t.slice() };
    const remove = new Set<number>();
    for (const d of doors) for (const sign of [-1, 1]) {
        const edge = sign < 0 ? -d.back : d.fwd;
        const half = (d.w - 1) / 2;
        const pending: number[] = [];
        for (let depth = 1; depth <= 3; depth++) {
            const t = edge + sign * depth;
            const x = d.i + d.ai * t, y = d.j + d.aj * t;
            // Only straighten an existing approach; never drill through its end.
            if (!isWalkable(original, x, y)) break;
            let blocked = false, solid = 0;
            for (let o = -half; o <= half; o++) {
                const i = x + d.wi * o, j = y + d.wj * o;
                if (isWalkable(original, i, j)) continue;
                const k = j * g.w + i;
                if (i < 1 || j < 1 || i >= g.w - 1 || j >= g.h - 1 ||
                    at(original, i, j) !== T_WALL || g.shapes[k] !== SHAPE_FULL || protectedTile(i, j)) {
                    blocked = true;
                    break;
                }
                pending.push(k);
                solid++;
            }
            if (blocked) break;
            // Require the original full width beyond the nose before committing.
            if (solid === 0) {
                for (const k of pending) remove.add(k);
                break;
            }
        }
    }
    for (const k of remove) setTile(g, k % g.w, Math.floor(k / g.w), T_FLOOR);
    return remove.size;
}
