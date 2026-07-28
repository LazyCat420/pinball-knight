/**
 * MOVEMENT POLICIES — what a monster is TRYING to do with its feet.
 *
 * ## Why this file exists
 *
 * `updateZombies` was a ~470-line per-frame cascade of `if (z.kind === …)`
 * blocks, and underneath every one of them sat the same three lines: walk
 * downhill on the shared BFS flow field, steer straight once you're close, get
 * shoved apart from your neighbours. Twenty-two enemy families and eight zombie
 * sub-types all approached the knight along the SAME line at different speeds.
 * `ZombieMode` looked like a state machine but was a flag the cascade read.
 *
 * So the cascade is now a DISPATCH TABLE keyed by intent, exactly the shape
 * proven by `PART_HANDLERS` in pinball-collide.ts: one exhaustive
 * `Record<MovementKind, MovementHandler>`, one lookup per actor per frame, and a
 * test that fails when a kind has no handler. A monster can only ever run its
 * own policy — there is no fall-through for a new kind to land in.
 *
 * ## The contract
 *
 * A handler answers ONE question — "which way do I want to go this frame, and
 * how fast" — and answers it from a plain-data context. It never touches
 * `state`, three, the DOM or the grid, which is what makes every policy in here
 * unit-testable and, more importantly, MEASURABLE: `movement.test.ts` drives
 * each handler over a simulated approach and asserts the resulting path differs
 * from `chase` on a named quantity (off-axis angle, held range, curvature). A
 * movement type that measures identical to chase is a label, not a behaviour.
 *
 * Everything that is a STATUS rather than an intent — the oil skid, the shadow
 * lure, the bat's wobble, separation, chill — stays a post-stage in zombie.ts
 * and layers on top of whatever the handler asked for. Intent and affliction are
 * different axes and collapsing them is how the cascade grew in the first place.
 *
 * ## Determinism
 *
 * Zero `Math.random()`. Every per-actor asymmetry (which way a flanker peels,
 * which way an orbiter rings) comes from `movePhase`, derived from the co-op
 * `nid` at spawn — so two peers watching the same horde see the same arcs.
 */
import {
  SPITTER_KITE_RANGE,
  DIRECT_STEER_RANGE,
  FLANK_ANGLE,
  FLANK_CLOSE,
  FLANK_FAR,
  STRAFE_RANGE,
  STRAFE_BAND,
  STRAFE_DART_CD,
  STRAFE_DART_TIME,
  STRAFE_DART_MULT,
  STRAFE_TELL_LEAD,
  AMBUSH_RANGE,
  AMBUSH_BURST_MULT,
  AMBUSH_BURST_TIME,
  ORBIT_RADIUS,
  ORBIT_BAND,
  ORBIT_TIGHTEN,
  LEAP_RANGE,
  LEAP_MIN_RANGE,
  LEAP_WINDUP,
  LEAP_TIME,
  LEAP_SPEED_MULT,
  LEAP_CURVE,
  LEAP_CD,
  LEAP_CRUISE_MULT,
  PACK_MIN,
  PACK_HOLD_RANGE,
  PACK_STALK_MULT,
  PACK_RUSH_MULT,
} from "../constants";

/**
 * The movement vocabulary. Intents, not families: a policy is shared by every
 * family that wants to move that way, which is the whole reason a new enemy
 * costs a table row instead of a branch.
 *
 * The first five are the intents the game ALREADY had, extracted verbatim from
 * the cascade. The last six are the Wave-5 vocabulary (DECLONE §6): each one
 * takes a measurably different PATH to the same knight, and each declares a
 * telegraph so a player can learn which is which.
 */
export type MovementKind =
  /** Downhill on the flow field, straight at the knight up close. The default. */
  | "chase"
  /** Ranged: back off when crowded, hold the firing band, path in when far. */
  | "kite"
  /** Furniture with teeth — faces you, never takes a step, never gets shoved. */
  | "rooted"
  /** Ignores the maze entirely and drifts through walls (ghost, Death Dealer). */
  | "phase"
  /** No AI at all; something else integrates its motion (the bowling pin). */
  | "inert"
  /** Approaches OFF-AXIS, closing the angle only as it arrives. */
  | "flanker"
  /** Holds a preferred range, circles, and darts in on a cadence. */
  | "strafer"
  /** Motionless until it has line of sight AND you are close, then commits. */
  | "ambusher"
  /** Rings you at radius, spiralling slowly inward. */
  | "orbiter"
  /** Telegraphed crouch, then a committed pounce along a curved arc. */
  | "leaper"
  /** Holds at the edge until N of its kind are near, then the pack goes at once. */
  | "packhunter";

export const MOVEMENT_KINDS: MovementKind[] = [
  "chase",
  "kite",
  "rooted",
  "phase",
  "inert",
  "flanker",
  "strafer",
  "ambusher",
  "orbiter",
  "leaper",
  "packhunter",
];

/**
 * The mutable slice of an actor a policy is allowed to see and write.
 *
 * Structurally satisfied by `Zombie` (state.ts appends these fields) but
 * deliberately NOT `Zombie` itself: a handler that could reach `sprite`/`anim`
 * would drag three into this module and take the tests with it.
 */
export interface MoveActor {
  x: number;
  z: number;
  /** World units per second, already carrying floor scaling + sub-type mult. */
  speed: number;
  /**
   * Deterministic per-actor phase in [0,1), seeded from the co-op nid. Drives
   * every left/right asymmetry so peers agree and two neighbours don't mirror.
   */
  movePhase?: number;
  /** Policy commit flag/timer. Meaning is per-policy; 0/undefined = uncommitted. */
  moveCommit?: number;
  /** Policy clock (seconds). Cadences, spiral tightening, leap phases. */
  moveT?: number;
  /** Committed heading, for the policies that lock a line (leaper's arc). */
  moveDirX?: number;
  moveDirZ?: number;
}

/** Everything a handler needs about the world, as plain numbers. */
export interface MoveCtx {
  dt: number;
  /** Player minus actor, and its length. */
  pdx: number;
  pdz: number;
  pdist: number;
  /**
   * The flow field's preferred heading (unit), or (0,0) when there is no field
   * / the actor stands on the player's own tile. This is the ONE pathfinding
   * substrate — no policy in here builds a second one.
   */
  flowX: number;
  flowZ: number;
  /** This actor's attack reach, so a policy can hold just outside it. */
  contactRange: number;
  /** Clear straight line from actor to player? Only computed for ambushers. */
  los: boolean;
  /** Living neighbours running the same policy within PACK_RANGE, self included. */
  packNear: number;
  /** True when one of those neighbours has already committed. */
  packCommitted: boolean;
}

/**
 * A telegraph the caller should paint so the intent is LEARNABLE. The five
 * baseline policies emit none (they never had a tell); every Wave-5 policy
 * does, because a behaviour the player cannot see coming is indistinguishable
 * from no behaviour at all.
 */
export interface MoveTell {
  /** Target tint (blended from white by `k` — see lerpTint in zombie.ts). */
  color: number;
  /** 0..1 intensity. */
  k: number;
}

/** What a policy wants done with this actor's feet this frame. */
export interface Steer {
  /** Desired heading. Need not be unit; the caller normalises nothing, so
   *  handlers return unit vectors and use `mult` for magnitude. */
  vx: number;
  vz: number;
  /** Speed multiplier for this frame (default 1). */
  mult?: number;
  /** Never moved by steering OR separation — it holds its tile. */
  rooted?: boolean;
  /** Deliberately standing still: play the idle clip even though it is aggroed. */
  hold?: boolean;
  /** Committed to a locked line: separation must not shove it off the arc. */
  locked?: boolean;
  /** The readable tell for this frame, if the policy has one right now. */
  tell?: MoveTell;
}

type MovementHandler = (a: MoveActor, c: MoveCtx) => Steer;

/**
 * Telegraph colours, one per policy that has one. These are the "learn the
 * monster" channel: a player who cannot see the intent cannot counter it, and a
 * behaviour nobody can see is indistinguishable from no behaviour at all.
 */
export const MOVE_TELL = {
  /** Flanker — cold blue while it is deliberately off your line. */
  flank: 0x9fd0ff,
  /** Strafer — amber while circling, ramping hot in the beat before a dart. */
  strafe: 0xffd98a,
  /** Strafer's dart / ambusher's commit — the same hot orange as a bite windup. */
  commit: 0xff7a2a,
  /** Orbiter — violet while it rings you. */
  orbit: 0xc9a0ff,
  /** Leaper — the crouch. Ramps to full over LEAP_WINDUP, like an attack tell. */
  leap: 0xff4d2a,
  /** Pack-hunter — sickly green while it waits for numbers. */
  pack: 0x8fe08f,
} as const;

const ZERO: Steer = { vx: 0, vz: 0 };

/** Unit vector toward the player, or (0,0) when standing on them. */
function toPlayer(c: MoveCtx): { x: number; z: number } {
  if (c.pdist <= 1e-4) return { x: 0, z: 0 };
  return { x: c.pdx / c.pdist, z: c.pdz / c.pdist };
}

/** Rotate a 2-vector by `a` radians (world XZ plane). */
function rot(vx: number, vz: number, a: number): { vx: number; vz: number } {
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  return { vx: vx * cs - vz * sn, vz: vx * sn + vz * cs };
}

/** Normalise, or (0,0) if degenerate. */
function unit(vx: number, vz: number): { vx: number; vz: number } {
  const d = Math.hypot(vx, vz);
  return d > 1e-6 ? { vx: vx / d, vz: vz / d } : { vx: 0, vz: 0 };
}

/** −1 or +1, deterministically, from the actor's seeded phase. */
function side(a: MoveActor): number {
  return (a.movePhase ?? 0) < 0.5 ? -1 : 1;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * THE BASELINE. Downhill on the flow field until you're within
 * DIRECT_STEER_RANGE, then straight at the knight — because the field only
 * knows tile centres and door-frame shuffling at close range looks robotic.
 *
 * Every other grounded policy is a deviation from this line, and the tests
 * measure the deviation. Extracted verbatim from the old cascade.
 */
const chase: MovementHandler = (_a, c) => {
  if (c.pdist <= DIRECT_STEER_RANGE) {
    const u = toPlayer(c);
    return { vx: u.x, vz: u.z };
  }
  return { vx: c.flowX, vz: c.flowZ };
};

/**
 * KITE — the spitter/webspinner/necromancer policy, verbatim from the cascade:
 * too close → back away to keep firing distance; inside the fire band → hold
 * still and shoot; too far → path in like anything else.
 */
const kite: MovementHandler = (_a, c) => {
  if (c.pdist < SPITTER_KITE_RANGE && c.pdist > 1e-4) {
    const u = toPlayer(c);
    return { vx: -u.x, vz: -u.z };
  }
  if (c.pdist <= c.contactRange) return ZERO; // in range, not too close: shoot
  return { vx: c.flowX, vz: c.flowZ };
};

/**
 * ROOTED — golems and chompers. They still FACE you (the old code kept steering
 * and then multiplied the step by zero, so the walk clip and the facing both
 * kept updating); `rooted` is what stops the feet and the separation shove.
 */
const rooted: MovementHandler = (a, c) => ({ ...chase(a, c), rooted: true });

/**
 * PHASE — the ghost and the Death Dealer. Straight at the knight, through
 * walls: no field, no collision. `updateGhost` owns the whole frame for these
 * two and asks this handler only for the heading.
 */
const phase: MovementHandler = (_a, c) => {
  const u = toPlayer(c);
  return { vx: u.x, vz: u.z };
};

/**
 * INERT — the bowling pin. It has no steering at all; `updatePin` integrates the
 * slide a knockback handed it. The row exists so the table stays TOTAL: without
 * it, a pin would resolve to `chase` the day someone edits the dispatch, and a
 * chasing bowling pin is a bug nobody would think to look for.
 */
const inert: MovementHandler = () => ({ ...ZERO, hold: true });

/**
 * FLANKER — comes at you from the side.
 *
 * Rotate the baseline heading by a fixed angle that FADES OUT as it arrives:
 * full FLANK_ANGLE beyond FLANK_FAR, straight in inside FLANK_CLOSE. So it
 * cannot orbit forever (the angle is a bounded rotation of a converging field,
 * not a tangent) and it always lands its bite — it just refuses to walk down
 * the corridor you are pointing your sword at.
 *
 * The tell is the arc itself, painted cold blue whenever the deviation is
 * meaningful; the player learns "the blue ones come round the side."
 */
const flanker: MovementHandler = (a, c) => {
  const base = chase(a, c);
  if (base.vx === 0 && base.vz === 0) return base;
  const k = clamp01((c.pdist - FLANK_CLOSE) / Math.max(1e-4, FLANK_FAR - FLANK_CLOSE));
  if (k <= 0) return base;
  const r = rot(base.vx, base.vz, FLANK_ANGLE * k * side(a));
  return { vx: r.vx, vz: r.vz, tell: { color: MOVE_TELL.flank, k: k * 0.75 } };
};

/**
 * STRAFER — holds a range and circles it, then commits on a cadence.
 *
 * Radial error drives it back to STRAFE_RANGE; the rest of the budget goes
 * TANGENTIAL, so it sidesteps around you instead of closing. Every
 * STRAFE_DART_CD seconds it spends STRAFE_DART_TIME driving straight in at
 * STRAFE_DART_MULT speed — the circling is the rest state, the dart is the
 * threat, and the tint goes hot STRAFE_TELL_LEAD seconds before the dart so the
 * commit is readable rather than a surprise.
 */
const strafer: MovementHandler = (a, c) => {
  a.moveT = (a.moveT ?? 0) + c.dt;
  const u = toPlayer(c);
  if (u.x === 0 && u.z === 0) return ZERO;

  // Mid-dart: straight in, fast, unmistakably committed.
  if ((a.moveCommit ?? 0) > 0) {
    a.moveCommit = Math.max(0, (a.moveCommit ?? 0) - c.dt);
    return { vx: u.x, vz: u.z, mult: STRAFE_DART_MULT, tell: { color: MOVE_TELL.commit, k: 1 } };
  }
  if (a.moveT >= STRAFE_DART_CD) {
    a.moveT = 0;
    a.moveCommit = STRAFE_DART_TIME;
    return { vx: u.x, vz: u.z, mult: STRAFE_DART_MULT, tell: { color: MOVE_TELL.commit, k: 1 } };
  }

  // Circling. Radial pull toward the band, tangential the rest of the way.
  const err = c.pdist - Math.max(STRAFE_RANGE, c.contactRange * 1.2);
  const radial = Math.max(-1, Math.min(1, err / STRAFE_BAND));
  const s = side(a);
  const v = unit(u.x * radial - u.z * s, u.z * radial + u.x * s);
  // The tell ramps into the dart — amber at rest, hot in the last beat.
  const lead = clamp01((a.moveT - (STRAFE_DART_CD - STRAFE_TELL_LEAD)) / Math.max(1e-4, STRAFE_TELL_LEAD));
  return {
    vx: v.vx,
    vz: v.vz,
    tell: lead > 0 ? { color: MOVE_TELL.commit, k: lead } : { color: MOVE_TELL.strafe, k: 0.55 },
  };
};

/**
 * AMBUSHER — does not exist until it does.
 *
 * It holds ABSOLUTELY still (no walk clip, no drift, no tell) while it has no
 * line of sight or you are far. The stillness is the telegraph: in a floor
 * where everything shambles toward you, the thing that never moved is the thing
 * you walked past. When both conditions land it commits ONCE and for good — a
 * bright commit flash, then a burst of speed for AMBUSH_BURST_TIME.
 *
 * It never re-hides. An ambusher that resets is a stealth mechanic; this is a
 * trap, and a trap only springs once.
 */
const ambusher: MovementHandler = (a, c) => {
  if ((a.moveCommit ?? 0) <= 0) {
    if (c.los && c.pdist <= AMBUSH_RANGE) {
      a.moveCommit = 1;
      a.moveT = 0;
    } else {
      return { ...ZERO, hold: true };
    }
  }
  a.moveT = (a.moveT ?? 0) + c.dt;
  const base = chase(a, c);
  const burst = a.moveT < AMBUSH_BURST_TIME;
  return {
    ...base,
    mult: burst ? AMBUSH_BURST_MULT : 1,
    tell: burst ? { color: MOVE_TELL.commit, k: 1 - a.moveT / AMBUSH_BURST_TIME } : undefined,
  };
};

/**
 * ORBITER — rings you at radius and spirals in.
 *
 * Pure tangential motion with a radial correction back onto the ring, so the
 * path is a circle rather than a line. The ring TIGHTENS at ORBIT_TIGHTEN per
 * second (floored at its own bite range) — an orbiter that held its radius
 * forever would be a decoration you could ignore, and this way the fantasy
 * ("it's circling") and the threat ("and it's getting closer") are the same
 * motion. Violet the whole time, because the orbit is always the intent.
 */
const orbiter: MovementHandler = (a, c) => {
  a.moveT = (a.moveT ?? 0) + c.dt;
  const u = toPlayer(c);
  if (u.x === 0 && u.z === 0) return ZERO;
  const want = Math.max(c.contactRange, ORBIT_RADIUS - ORBIT_TIGHTEN * a.moveT);
  const radial = Math.max(-1, Math.min(1, (c.pdist - want) / ORBIT_BAND));
  const s = side(a);
  const v = unit(u.x * radial - u.z * s, u.z * radial + u.x * s);
  return { vx: v.vx, vz: v.vz, tell: { color: MOVE_TELL.orbit, k: 0.6 } };
};

/**
 * LEAPER — crouch, then a committed pounce along a CURVED line.
 *
 * Three phases on one clock, all readable:
 *   · cruise   — closes at LEAP_CRUISE_MULT of its speed, no tell;
 *   · crouch   — dead stop, tint ramping to full red over LEAP_WINDUP. This is
 *                the whole skill test: you have that window to move;
 *   · pounce   — LEAP_TIME of locked heading at LEAP_SPEED_MULT, the heading
 *                rotating at LEAP_CURVE rad/s so the path is an ARC, not a line.
 *
 * The arc is the point. A straight dash is dodged by stepping sideways once; an
 * arc has to be read, because it bends toward where you are going. The heading
 * is locked at crouch-exit and never re-aimed, so a leap can be BAITED — which
 * is the counterplay the telegraph promises.
 *
 * `moveCommit` encodes the phase: >1 crouching (value = crouch time left + 1),
 * in (0,1] pouncing (value = pounce time left), <=0 recovering.
 */
const leaper: MovementHandler = (a, c) => {
  const u = toPlayer(c);
  const commit = a.moveCommit ?? 0;

  // ── Pounce: locked arc, no re-aim. ──
  if (commit > 0 && commit <= 1) {
    a.moveCommit = commit - c.dt;
    const r = rot(a.moveDirX ?? u.x, a.moveDirZ ?? u.z, LEAP_CURVE * side(a) * c.dt);
    a.moveDirX = r.vx;
    a.moveDirZ = r.vz;
    if ((a.moveCommit ?? 0) <= 0) {
      a.moveCommit = 0;
      a.moveT = -LEAP_CD; // recovery: the clock has to climb back to 0
    }
    return { vx: r.vx, vz: r.vz, mult: LEAP_SPEED_MULT, locked: true };
  }

  // ── Crouch: rooted, tell ramping, heading being aimed until the last frame. ──
  if (commit > 1) {
    const left = commit - 1 - c.dt;
    a.moveDirX = u.x;
    a.moveDirZ = u.z;
    if (left <= 0) {
      a.moveCommit = LEAP_TIME; // release
      return { vx: u.x, vz: u.z, mult: LEAP_SPEED_MULT, locked: true, tell: { color: MOVE_TELL.leap, k: 1 } };
    }
    a.moveCommit = left + 1;
    return { ...ZERO, hold: true, tell: { color: MOVE_TELL.leap, k: 1 - left / LEAP_WINDUP } };
  }

  // ── Cruise / recover. ──
  a.moveT = (a.moveT ?? 0) + c.dt;
  if ((a.moveT ?? 0) >= 0 && c.pdist <= LEAP_RANGE && c.pdist >= LEAP_MIN_RANGE && c.los) {
    a.moveCommit = LEAP_WINDUP + 1;
    return { ...ZERO, hold: true, tell: { color: MOVE_TELL.leap, k: 0 } };
  }
  const base = chase(a, c);
  return { ...base, mult: LEAP_CRUISE_MULT };
};

/**
 * PACK-HUNTER — will not fight you alone.
 *
 * While fewer than PACK_MIN of its own policy are within PACK_RANGE it STALKS:
 * it shadows you at PACK_HOLD_RANGE at half speed, closing no further. The
 * moment the count lands — or one neighbour commits — the whole pack goes at
 * once, because `packCommitted` propagates: the first to commit drags the rest
 * in on the same frame, which is what makes the surge read as a decision rather
 * than as several monsters happening to arrive.
 *
 * Sickly green while it waits. When a floor's greens all turn off at the same
 * instant, that is the mechanic announcing itself.
 */
const packhunter: MovementHandler = (a, c) => {
  if ((a.moveCommit ?? 0) <= 0) {
    if (c.packNear >= PACK_MIN || c.packCommitted) {
      a.moveCommit = 1;
    } else {
      const u = toPlayer(c);
      if (u.x === 0 && u.z === 0) return { ...ZERO, hold: true };
      // Shadow at the hold range: close if further, ease off if nearer.
      if (c.pdist <= PACK_HOLD_RANGE) {
        return { vx: -u.x, vz: -u.z, mult: PACK_STALK_MULT, tell: { color: MOVE_TELL.pack, k: 0.7 } };
      }
      const base = chase(a, c);
      return { ...base, mult: PACK_STALK_MULT, tell: { color: MOVE_TELL.pack, k: 0.7 } };
    }
  }
  const base = chase(a, c);
  return { ...base, mult: PACK_RUSH_MULT };
};

/**
 * THE DISPATCH TABLE. Exhaustive over `MovementKind` by the type system, and
 * pinned by `movement.test.ts` so an added kind fails a test rather than
 * silently inheriting `chase`.
 */
export const MOVEMENT_HANDLERS: Record<MovementKind, MovementHandler> = {
  chase,
  kite,
  rooted,
  phase,
  inert,
  flanker,
  strafer,
  ambusher,
  orbiter,
  leaper,
  packhunter,
};

/**
 * True while the actor is mid-POUNCE. Nothing may interrupt a committed arc —
 * not a contact windup, not a shove. A telegraph that can be cancelled by the
 * thing it was telegraphing is not a telegraph.
 *
 * The CROUCH is deliberately not covered: walking into a crouching leaper
 * should get you bitten, and `cancelCommit` converts the wind-up into that bite.
 */
export function isCommitted(m: MovementKind, a: MoveActor): boolean {
  const c = a.moveCommit ?? 0;
  return m === "leaper" && c > 0 && c <= 1;
}

/** Drop any in-progress commit — the actor is doing something else now. */
export function cancelCommit(a: MoveActor): void {
  a.moveCommit = 0;
}

/** Which policies need a line-of-sight probe (the only cost worth paying for). */
export function needsLos(m: MovementKind): boolean {
  return m === "ambusher" || m === "leaper";
}

/** Which policies need the O(n) neighbour census. Only one, and it is rare. */
export function needsPack(m: MovementKind): boolean {
  return m === "packhunter";
}
