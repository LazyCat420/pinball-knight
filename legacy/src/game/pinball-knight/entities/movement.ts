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
import { SPITTER_KITE_RANGE, DIRECT_STEER_RANGE } from "../constants";

/**
 * The movement vocabulary. Intents, not families: a policy is shared by every
 * family that wants to move that way, which is the whole reason a new enemy
 * costs a table row instead of a branch.
 *
 * These five are the intents the game ALREADY had, extracted verbatim from the
 * cascade; the Wave-5 vocabulary lands on top of the same table.
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
  | "inert";

export const MOVEMENT_KINDS: MovementKind[] = ["chase", "kite", "rooted", "phase", "inert"];

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
 * A telegraph the caller should paint so the intent is LEARNABLE. None of the
 * five baseline policies emits one (they never had a tell and this refactor
 * changes nothing); the field exists because the vocabulary that lands on this
 * table is only worth shipping if the player can see it coming.
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

const ZERO: Steer = { vx: 0, vz: 0 };

/** Unit vector toward the player, or (0,0) when standing on them. */
function toPlayer(c: MoveCtx): { x: number; z: number } {
  if (c.pdist <= 1e-4) return { x: 0, z: 0 };
  return { x: c.pdx / c.pdist, z: c.pdz / c.pdist };
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
 * THE DISPATCH TABLE. Exhaustive over `MovementKind` by the type system, and
 * pinned by `movement.test.ts` so an added kind fails a test rather than
 * silently inheriting `chase`.
 */
export const MOVEMENT_HANDLERS: Record<MovementKind, MovementHandler> = { chase, kite, rooted, phase, inert };

