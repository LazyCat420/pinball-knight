import { type Grid, type TilePos, at, T_FLOOR } from './generator';
import { type PinballPartSpot, isStructuralPart } from './decorate';
import { placeBoosterPatterns, patternParts } from './booster-patterns';
/** Fit an activity in the remaining budget, or replace a small loose cluster
 * atomically. Never dismantle a route, machine, vault or existing pattern. */
export function placeRoomActivity(g: Grid, parts: PinballPartSpot[], candidates: readonly TilePos[], opts: {
    budget: number; allowed: (p: PinballPartSpot) => boolean;
}): number {
    const place = (into: PinballPartSpot[], sites: readonly TilePos[]) => placeBoosterPatterns(g, into, sites, { ...opts, count: 1, offset: 2 });
    if (place(parts, candidates)) return 1;
    const loose = new Map<number, PinballPartSpot[]>();
    for (const p of parts) if (!p.vault && !p.patternId && !isStructuralPart(p) && ['bumper', 'booster', 'target'].includes(p.kind)) {
        const k = p.j * g.w + p.i, bucket = loose.get(k) ?? [];
        bucket.push(p); loose.set(k, bucket);
    }
    // These parts cannot be removed by the replacement pass. Index their
    // footprints once, rather than rebuilding all occupancy for doomed sites.
    const fixed = new Uint8Array(g.w * g.h);
    for (const p of parts) if (!(loose.get(p.j * g.w + p.i) ?? []).includes(p)) {
        for (let y = Math.max(0, p.j - 1); y <= Math.min(g.h - 1, p.j + 1); y++)
            for (let x = Math.max(0, p.i - 1); x <= Math.min(g.w - 1, p.i + 1); x++) fixed[y * g.w + x] = 1;
    }
    for (const c of candidates) {
        // Necessary conditions only: the ordinary placer still proves every
        // hand-off and launch exit against the complete proposed furniture.
        if (![0, 1, 2, 3].some(rotation => patternParts('chicane', c, rotation).every(p =>
            at(g, p.i, p.j) === T_FLOOR && !fixed[p.j * g.w + p.i] && opts.allowed(p)))) continue;
        const drop = new Set<PinballPartSpot>();
        for (let y = Math.max(0, c.j - 5); y <= Math.min(g.h - 1, c.j + 5); y++)
            for (let x = Math.max(0, c.i - 5); x <= Math.min(g.w - 1, c.i + 5); x++)
                for (const p of loose.get(y * g.w + x) ?? []) drop.add(p);
        if (!drop.size || drop.size > 8 || parts.length - drop.size + 4 > opts.budget) continue;
        const proposed = parts.filter(p => !drop.has(p));
        if (!place(proposed, [c])) continue;
        parts.splice(0, parts.length, ...proposed);
        return 1;
    }
    return 0;
}
