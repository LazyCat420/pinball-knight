/** Small solid islands in genuinely large empty rooms. A clear six-tile
 * approach surrounds each island; keep main lanes and authored exits clear. */
import { type Grid, type TilePos, at, setTile, T_FLOOR, T_WALL } from './generator';
export function authorRoomIslands(g: Grid, reserved: (i: number, j: number) => boolean): TilePos[] {
    const sites: TilePos[] = [];
    const cap = Math.max(1, Math.floor(g.w * g.h / 1800));
    for (let j = 8; j < g.h - 8 && sites.length < cap; j += 4) for (let i = 8; i < g.w - 8 && sites.length < cap; i += 4) {
        if (sites.some(p => Math.max(Math.abs(p.i - i), Math.abs(p.j - j)) < 17)) continue;
        let fits = true;
        for (let y = j - 7; y <= j + 7 && fits; y++) for (let x = i - 7; x <= i + 7; x++) {
            if (at(g, x, y) !== T_FLOOR) { fits = false; break; }
        }
        if (!fits) continue;
        for (let y = j - 2; y <= j + 2; y++) for (let x = i - 2; x <= i + 2; x++) if (reserved(x, y)) fits = false;
        if (!fits) continue;
        // Solid 2x3: no isolated single-block pillar and no three-sided stubs.
        for (let y = j - 1; y <= j + 1; y++) for (let x = i; x <= i + 1; x++) setTile(g, x, y, T_WALL);
        sites.push({ i, j });
    }
    return sites;
}

/** Activity coverage is separate from wall-island fit: a nine-tile-wide room
 * can host a small machine even when it is too small for independent masonry. */
export function roomActivitySites(g: Grid, reserved: (i: number, j: number) => boolean, islands: readonly TilePos[] = []): TilePos[] {
    const sites = [...islands];
    for (let j = 5; j < g.h - 5; j += 4) for (let i = 5; i < g.w - 5; i += 4) {
        if (reserved(i, j) || sites.some(p => Math.max(Math.abs(p.i - i), Math.abs(p.j - j)) < 12)) continue;
        let fits = true;
        for (let y = j - 4; y <= j + 4 && fits; y++) for (let x = i - 4; x <= i + 4; x++)
            if (at(g, x, y) !== T_FLOOR) { fits = false; break; }
        if (fits) sites.push({ i, j });
    }
    return sites;
}
