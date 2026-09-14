import { type Grid, at, T_CRACKED, T_FLOOR } from './generator';
import { type TrackMask } from './track-carve';
import { removeWallStubs } from './track-socket';
import { arcSpanMask } from './doorways';
import { compactArcs, clearOrphanArcTiles } from './arc-contract';
import { enforceWallJoins } from './wall-junctions';
import { narrowGaps, repairNarrowGaps } from './gap-clearance';
/** Opening-only final repair: safe after furniture, independent of optional
 * corner art, and rechecked after rejected arcs expose square stone. */
export function finishClearance(g: Grid, mask?: TrackMask) {
    let widened = 0;
    // These ports already exist because closing them disconnected the map.
    // Widen their approaches instead of preserving an emergency one-tile door.
    const access = [...(mask?.chuteAccessPorts ?? [])];
    const nearAccess = (i: number, j: number) => access.some(k =>
        Math.max(Math.abs(k % g.w - i), Math.abs(Math.floor(k / g.w) - j)) <= 2);
    const before = access.length ? g.t.slice() : null;
    for (let round = 0; round < 8; round++) {
        const spans = arcSpanMask(g);
        const structural = (i: number, j: number) => {
            // Preserve the actual sealed flank. The old two-tile halo also
            // protected unrelated corner noses outside it, hiding choke points.
            if (mask?.sealed) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const x = i + dx, y = j + dy;
                if (x >= 0 && y >= 0 && x < g.w && y < g.h && mask.sealed[y * g.w + x] && !nearAccess(i, j)) return true;
            }
            // Secret barriers keep their authored breakthrough band intact.
            for (let y = j - 1; y <= j + 1; y++) for (let x = i - 1; x <= i + 1; x++) if (at(g, x, y) === T_CRACKED) return true;
            return false;
        };
        const result = repairNarrowGaps(g, (i, j) => !!spans[j * g.w + i] || structural(i, j));
        // A curved face is not permission to retain a choke. First try keeping
        // it; otherwise widen and let the arc contract trim/drop the affected
        // face so rendering and collision agree with the new passage.
        const relief = result.unresolved ? repairNarrowGaps(g, structural) : { widened: 0 };
        result.widened += relief.widened;
        widened += result.widened;
        clearOrphanArcTiles(g);
        const joins = enforceWallJoins(g);
        compactArcs(g);
        const stubs = removeWallStubs(g, mask ?? null);
        if (!result.widened && !joins && !stubs) break;
    }
    if (before && mask) for (let k = 0; k < before.length; k++) {
        if (before[k] !== g.t[k] && g.t[k] === T_FLOOR && nearAccess(k % g.w, Math.floor(k / g.w)))
            (mask.chuteAccessPorts ??= new Set()).add(k);
    }
    return { widened, remaining: narrowGaps(g) };
}
