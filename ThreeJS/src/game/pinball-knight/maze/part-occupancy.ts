import type { Grid, TilePos } from './generator';
/** For a placement phase that only appends parts. Index each addition once;
 * spacing queries inspect the small neighbourhood, not every existing part. */
export function appendOnlyPartOccupancy(g: Pick<Grid, 'w' | 'h'>, parts: readonly TilePos[]) {
    const tiles = new Uint8Array(g.w * g.h);
    let indexed = 0;
    return (i: number, j: number, radius: number, manhattan = false): boolean => {
        if (parts.length < indexed)
            throw new Error('Part occupancy cannot span a removal phase');
        while (indexed < parts.length) {
            const p = parts[indexed++];
            if (p.i >= 0 && p.j >= 0 && p.i < g.w && p.j < g.h)
                tiles[p.j * g.w + p.i] = 1;
        }
        for (let y = Math.max(0, j - radius); y <= Math.min(g.h - 1, j + radius); y++) {
            for (let x = Math.max(0, i - radius); x <= Math.min(g.w - 1, i + radius); x++) {
                if (manhattan && Math.abs(x - i) + Math.abs(y - j) > radius)
                    continue;
                if (tiles[y * g.w + x])
                    return true;
            }
        }
        return false;
    };
}
