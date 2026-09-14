import { type Grid, type TilePos } from './generator';
import { type PinballPartSpot, isStructuralPart } from './decorate';
import { placeBoosterPatterns } from './booster-patterns';
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
    for (const c of candidates) {
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
