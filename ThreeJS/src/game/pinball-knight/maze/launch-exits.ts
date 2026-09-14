/** Final launch safety uses finished geometry and actual receiving parts.
 * Tags describe ownership, never proof of an escape. No RNG or wall edits. */
import { type Grid, at, T_CRACKED, T_WALL } from './generator';
import { circleCollides } from '../engine/collision';
import { PLAYER_R, PINBALL_MAX_SPEED, BOOSTER_STEER_LOCK, CORNER_BOOST_STEER_LOCK, CURVE_BOOST_STEER_LOCK, BOOSTER_RADIUS, CORNER_BOOST_RADIUS, CURVE_BOOST_RADIUS } from '../constants';
import type { PinballPartSpot } from './decorate';
import { exitRay } from './flow-loops';
const LAUNCH = new Set(['booster', 'boostcorner', 'boostcurve', 'ramp', 'spring', 'slingshot', 'flipper', 'jumppad']);
const PASSIVE = new Set(['rollover', 'lamp', 'target', 'oil', 'trapdoor', 'pit', 'electric', 'firevent', 'magstrip']);
export const STEERING_RUNOUT = 3;
export interface LaunchExit {
    safe: boolean;
    reason: 'steering-pocket' | 'jump-landing' | 'breakthrough' | 'wall' | 'part' | 'cycle' | 'invalid-heading';
}
/** Tile index shared by every ray, rather than searching the full part array. */
export function launchExitInspector(g: Grid, parts: readonly PinballPartSpot[]) {
    const byTile = new Map<number, PinballPartSpot[]>();
    for (const p of parts) {
        const k = p.j * g.w + p.i;
        const bucket = byTile.get(k) ?? [];
        bucket.push(p);
        byTile.set(k, bucket);
    }
    const clear = (x: number, y: number) => !circleCollides(g, x - g.w / 2, y - g.h / 2, PLAYER_R);
    const pocket = (x: number, y: number, dx: number, dy: number): boolean => {
        // Enough continuous space to leave the launch line after steering unlocks.
        for (const side of [-1, 1]) {
            let ok = true;
            for (let d = .5; d <= STEERING_RUNOUT; d += .5) {
                if (!clear(x - dy * d * side, y + dx * d * side)) {
                    ok = false;
                    break;
                }
            }
            if (ok)
                return true;
        }
        return false;
    };
    return (source: PinballPartSpot): LaunchExit => {
        const visited = new Set<PinballPartSpot>();
        const trace = (p: PinballPartSpot, heading: readonly number[]): LaunchExit => {
            route: for (;;) {
                if (visited.has(p))
                    return { safe: false, reason: 'cycle' };
                visited.add(p);
                const length = Math.hypot(heading[0], heading[1]);
                if (!Number.isFinite(length) || length < .001)
                    return { safe: false, reason: 'invalid-heading' };
                const dx = heading[0] / length, dy = heading[1] / length;
                const sx = p.i + .5, sy = p.j + .5;
                // Prove the outlet is available after the worst-speed steering
                // lock, not merely after a fixed three-tile runway.
                const lock = p.kind === 'booster' ? BOOSTER_STEER_LOCK :
                    p.kind === 'boostcorner' ? CORNER_BOOST_STEER_LOCK :
                    p.kind === 'boostcurve' ? CURVE_BOOST_STEER_LOCK : 0;
                const steeringDistance = Math.max(STEERING_RUNOUT, PINBALL_MAX_SPEED * lock);
                // Springs have an explicit ballistic landing; validate its footprint.
                if (p.kind === 'spring' && p.span && p.span > 0 &&
                    clear(sx + dx * p.span, sy + dy * p.span) &&
                    pocket(sx + dx * p.span, sy + dy * p.span, dx, dy)) {
                    return { safe: true, reason: 'jump-landing' };
                }
                // A vault badge is only valid when a thin wall band has a clear far side.
                if ((p.kind === 'jumppad' || p.kind === 'ramp') && p.vault && Math.abs(dx) + Math.abs(dy) === 1) {
                    let d = 1;
                    while (d <= 2 && at(g, p.i + dx * d, p.j + dy * d) === T_WALL)
                        d++;
                    if (d > 1 && d <= 3 && clear(sx + dx * d, sy + dy * d) && clear(sx + dx * (d + 1), sy + dy * (d + 1))) {
                        return { safe: true, reason: 'jump-landing' };
                    }
                }
                // Stop at a physical obstacle, never pronounce a long ray safe by timeout.
                const limit = Math.hypot(g.w, g.h) + 1;
                for (let d = .25; d <= limit; d += .25) {
                    const x = sx + dx * d, y = sy + dy * d;
                    const i = Math.floor(x), j = Math.floor(y);
                    if (!clear(x, y)) {
                        // Only a real breakable band with a reachable far side is an exit.
                        for (let s = .25; s <= .75; s += .25) {
                            const wi = Math.floor(x + dx * s), wj = Math.floor(y + dy * s);
                            if (at(g, wi, wj) !== T_CRACKED)
                                continue;
                            for (let far = .5; far <= 3; far += .5) {
                                const fx = x + dx * far, fy = y + dy * far;
                                const tile = at(g, Math.floor(fx), Math.floor(fy));
                                if (tile === T_WALL)
                                    break;
                                if (clear(fx, fy) && clear(fx + dx, fy + dy))
                                    return { safe: true, reason: 'breakthrough' };
                            }
                        }
                        return { safe: false, reason: 'wall' };
                    }
                    // Neighbour buckets include trigger discs crossing a tile boundary.
                    for (let oy = -1; oy <= 1; oy++)
                        for (let ox = -1; ox <= 1; ox++) {
                            for (const q of byTile.get((j + oy) * g.w + i + ox) ?? []) {
                                if (q === p || PASSIVE.has(q.kind)) continue;
                                const radius = q.kind === 'booster' ? BOOSTER_RADIUS :
                                    q.kind === 'boostcorner' ? CORNER_BOOST_RADIUS :
                                    q.kind === 'boostcurve' ? CURVE_BOOST_RADIUS : .5;
                                // Test the whole sampled segment, including grazing
                                // trigger contacts between its quarter-tile endpoints.
                                const along = Math.max(d - .25, Math.min(d, (q.i + .5 - sx) * dx + (q.j + .5 - sy) * dy));
                                if (Math.hypot(q.i + .5 - sx - dx * along, q.j + .5 - sy - dy * along) > radius) continue;
                                if (q.kind === 'deflector') {
                                    const a = -dx * q.dirI - dy * q.dirJ, b = -dx * q.dir2I - dy * q.dir2J;
                                    if (Math.max(a, b) < .3)
                                        continue; // runtime does not catch this approach
                                    p = q;
                                    heading = a >= b ? [q.dir2I, q.dir2J] : [q.dirI, q.dirJ];
                                    continue route;
                                }
                                // Corner pads decline axial exit traffic, including
                                // rebounds; only a genuine side entry can turn here.
                                if (q.kind === 'boostcorner' && Math.abs(dx * q.dir2I + dy * q.dir2J) > .7)
                                    continue;
                                if (LAUNCH.has(q.kind)) {
                                    p = q;
                                    heading = exitRay(q);
                                    continue route;
                                }
                                return { safe: false, reason: 'part' }; // an impact bumper is not an authored exit
                            }
                        }
                    if (d >= steeringDistance && pocket(x, y, dx, dy))
                        return { safe: true, reason: 'steering-pocket' };
                }
                return { safe: false, reason: 'wall' };
            }
        };
        return trace(source, exitRay(source));
    };
}
export function unsafeLaunchers(g: Grid, parts: readonly PinballPartSpot[]): PinballPartSpot[] {
    const inspect = launchExitInspector(g, parts);
    return parts.filter(p => LAUNCH.has(p.kind) && !inspect(p).safe);
}
/** Removal cannot introduce a forced shove; recheck after receivers disappear. */
export function enforceLaunchExits(g: Grid, parts: PinballPartSpot[]): number {
    let removed = 0;
    for (;;) {
        const bad = new Set(unsafeLaunchers(g, parts));
        const groups = new Map<string, PinballPartSpot[]>();
        for (const p of parts)
            if (p.patternId) {
                const group = groups.get(p.patternId) ?? [];
                group.push(p);
                groups.set(p.patternId, group);
            }
        for (const group of groups.values())
            if (group.length !== group[0].patternSize || group.some(p => bad.has(p)))
                for (const p of group)
                    bad.add(p);
        if (!bad.size)
            return removed;
        // Keep route/machine landmarks readable when their powered shot is unsafe.
        // A passive rollover cannot force a wall rebound and preserves the budget.
        for (const p of bad) {
            if (!p.patternId && (p.spine || p.chute || p.circuit !== undefined || p.asm !== undefined)) {
                p.launchFallback = p.kind;
                p.kind = 'rollover';
                bad.delete(p);
            }
        }
        if (!bad.size)
            continue;
        let write = 0;
        for (const p of parts)
            if (!bad.has(p))
                parts[write++] = p;
        parts.length = write;
        removed += bad.size;
    }
}
