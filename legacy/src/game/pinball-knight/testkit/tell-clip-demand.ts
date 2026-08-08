/**
 * TESTKIT — WHICH CLIPS WILL A MOVEMENT POLICY ACTUALLY ASK FOR?
 *
 * ⚠️ NOT SHIPPED (testkit/ is test-only — see testkit-boundary.test.ts).
 *
 * Extracted from tell-clips.test.ts, which drove the real handlers to prove the
 * telegraph→pose mapping is covered. The same driver answers a question that
 * belongs to the ART side and had no way to ask it: given the policy a creature
 * is assigned in `enemy-rules`, WHICH CLIP NAMES does the game end up asking
 * its painter for?
 *
 * That gap shipped a real defect. The hound's charge telegraph was drawn and
 * committed as `attack`, and `enemy-rules` gives the hound `leaper`, whose tell
 * resolves to `crouch` — a name the painter did not author. So the pose the
 * whole creature was designed around resolved through `CLIP_FALLBACK` to `idle`
 * and never once appeared on screen, while a green test asserted the gather on
 * `attack`, the clip the mechanic had stopped asking for.
 *
 * The only way a painter's clip list and a policy's demands can be checked
 * against each other is to DERIVE both. Nothing here restates either: the
 * handlers are run, and `clipForSteer` is called.
 */
import { MOVEMENT_HANDLERS, type MoveActor, type MoveCtx, type Steer } from "../entities/movement";
import { clipForSteer } from "../render/tell-clips";
import type { ClipName } from "../engine/render/paint-types";

/** A plain approach context at `dist`, with the player due east. */
export function approachCtx(dist: number, over: Partial<MoveCtx> = {}): MoveCtx {
  return {
    dt: 1 / 60,
    pdx: dist,
    pdz: 0,
    pdist: dist,
    flowX: 1,
    flowZ: 0,
    contactRange: 1,
    los: true,
    packNear: 1,
    packCommitted: false,
    ...over,
  };
}

/** Run one policy for `secs` from `startDist`, collecting the clip each frame. */
export function clipsOver(
  kind: keyof typeof MOVEMENT_HANDLERS,
  startDist: number,
  secs: number,
  over: Partial<MoveCtx> = {},
): ClipName[] {
  const a: MoveActor = { x: 0, z: 0, speed: 3, movePhase: 0.2 };
  const seen: ClipName[] = [];
  let dist = startDist;
  for (let i = 0; i < Math.round(secs * 60); i++) {
    const s: Steer = MOVEMENT_HANDLERS[kind](a, approachCtx(dist, over));
    const moving = s.vx !== 0 || s.vz !== 0;
    const c = clipForSteer(s, moving);
    if (c) seen.push(c);
    if (moving && !s.hold) dist = Math.max(0.6, dist - 3 * (s.mult ?? 1) * (1 / 60));
  }
  return seen;
}

/** The distinct clips a policy demands over a full approach — deduped, ordered. */
export function clipDemand(
  kind: keyof typeof MOVEMENT_HANDLERS,
  startDist = 9,
  secs = 4,
  over: Partial<MoveCtx> = {},
): ClipName[] {
  return [...new Set(clipsOver(kind, startDist, secs, over))];
}

/**
 * ⚠️ ONE APPROACH IS NOT THE WHOLE DEMAND — use this for roster-wide sweeps.
 *
 * `clipDemand` walks in from 9 units, and `clipsOver` only closes the distance
 * on a frame the actor actually MOVES. That is correct for a leaper (it walks
 * in, then crouches) and blind for an **ambusher**, which by definition holds
 * still until you are close: it never moves, so `dist` never falls, so the
 * burst it exists to telegraph is never reached and the policy reports NO clip
 * demand at all. A roster check built on that would pass by not looking.
 *
 * Found by writing exactly that check (`tell-clips-roster.test.ts`): the first
 * run reported two demanded clips for the whole roster, and the sapper's
 * `wake` was missing rather than unauthored.
 *
 * So sweep the start distance instead of picking one. The far case exercises
 * approach telegraphs, the near cases exercise commit/spring telegraphs, and
 * the union is what the creature can be asked for over a fight.
 */
export const DEMAND_SWEEP_DISTS = [9, 4, 1.5];

export function clipDemandAll(
  kind: keyof typeof MOVEMENT_HANDLERS,
  over: Partial<MoveCtx> = {},
): ClipName[] {
  const seen = new Set<ClipName>();
  for (const d of DEMAND_SWEEP_DISTS) for (const c of clipsOver(kind, d, 4, over)) seen.add(c);
  return [...seen];
}
