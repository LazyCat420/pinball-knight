/**
 * The knight: movement, sprint, wall work, dodge roll and attack timing.
 *
 * Split out of the 2522-line constants.ts so parallel tracks stop colliding on
 * one file. Consumers still import from `../constants` — that barrel re-exports
 * every module here, so no call site changed.
 */
// ── Player ──────────────────────────────────────────────────────
export const PLAYER_SPEED = 4.2; // tiles/sec
export const PLAYER_R = 0.3; // collision circle radius
export const PLAYER_MAX_HP = 6;
/** After taking a hit you can't be hit again for this long. */
export const PLAYER_IFRAMES = 0.9;

// NB: STAMINA was removed 2026-07-16 ("i don't like that system … more like a
// pinball/sonic system where we want to do crazy combos"). Every move — sprint,
// dodge, wall-kick/ride/pounce, heavy — is now FREE and gated only by cooldowns
// / the sprint spool. The MoveTiming rows below keep no cost field.

// ── Sprint (hold Shift) ─────────────────────────────────────────
/**
 * Pressing Shift kicks in IMMEDIATELY at SPRINT_BASE_MULT (you feel the gear
 * change the moment you press it — playtest 2026-07-15: a spool that starts at
 * 1.0× read as "shift does nothing"), then the sprint CHARGE lerps you the rest
 * of the way to SPRINT_SPEED_MULT over the 3s ramp. Top gear is dramatic on
 * purpose — the payoff for a sustained run.
 */
export const SPRINT_BASE_MULT = 1.35; // instant multiplier the moment Shift is held
export const SPRINT_SPEED_MULT = 1.85; // top speed multiplier at full sprint charge
/**
 * Walk accel/friction stays snappy (press ≈ full WALK speed almost at once) so
 * ordinary movement is responsive. Sprint is layered on TOP via a separate
 * "sprint charge" that ramps over SPRINT_RAMP_TIME (see below) — that's the
 * gear you have to wind up, not the base walk.
 */
// Tuned up 2026-07-20: at 22/26 there was a ~0.19s spool-up to full walk speed
// on every keypress and a ~0.16s glide on release, which read as "slightly
// sluggish". At 55/42 the ramp is ~0.08s start / ~0.10s stop — taps feel
// immediate while still avoiding the jitter of a hard instant-velocity snap.
export const MOVE_ACCEL = 55; // units/sec² toward the desired velocity
export const MOVE_FRICTION = 42; // units/sec² decel when no input
/** Camera leads a little further ahead while sprinting (no ortho FOV trick available). */
/**
 * Sprint is a COMMITMENT you spool up, not an instant toggle. Holding Shift while
 * moving fills a 0→1 "sprint charge" over SPRINT_RAMP_TIME seconds; letting go
 * (or stopping) drains it back over SPRINT_DECAY_TIME. The charge lerps the top
 * speed from walk (1×) toward SPRINT_SPEED_MULT, so full sprint arrives only
 * after a sustained run — and the flashy wall-ride unlocks once the charge is
 * past SPRINT_RIDE_THRESHOLD (halfway up the ramp). Playtest-set to 3s per the
 * "ramp up over 3 seconds to full sprint" request.
 */
// Playtest 2026-07-23: 3.0s read as "shift does nothing" — the spool now fills
// in 1.5s (and the base gear above is meatier), so Shift visibly kicks.
export const SPRINT_RAMP_TIME = 1.5; // seconds of sustained run to reach full sprint
export const SPRINT_DECAY_TIME = 0.8; // seconds for the charge to bleed back to 0 when you stop
/**
 * The charge HOLDS for this long before it starts decaying, so a light swing
 * (~0.27s) or clipping a corner mid-run doesn't erase a 3-second spool.
 * Without it, real combat-heavy play never kept any charge and the ramp — and
 * the wall-ride it gates — read as broken (playtest 2026-07-15).
 */
export const SPRINT_GRACE = 0.6;
/** Sprint charge above this (halfway up the ramp, ~1.5s in) unlocks the wall-ride. */
export const SPRINT_RIDE_THRESHOLD = 0.5;
/** Above this charge the walk swaps to the leaning RUN clip. */
export const RUN_CLIP_THRESHOLD = 0.12;

// ── Speed aura (the "he's moving faster" signal) ────────────────
/**
 * A trail of fading AFTERIMAGE ghosts of the knight spawns once the sprint
 * charge passes AURA_MIN_CHARGE — faint and blue at first, GOLD once the spool
 * is full — and during every roll / wall launch. The ghost density scales with
 * charge, so the aura literally thickens as you wind up.
 */
export const AURA_MIN_CHARGE = 0.35;
export const AURA_INTERVAL = 0.11; // seconds between ghosts at minimum charge
export const AURA_LIFE = 0.32; // seconds a ghost takes to fade out
export const AURA_OPACITY = 0.4; // ghost starting opacity
export const AURA_TINT_COOL = 0x6fd0e8; // arcane-blue ghosts while spooling
export const AURA_TINT_HOT = 0xffd23f; // gold ghosts at full sprint
/** Charge at/above this reads as "full" and flips the aura gold. */
export const AURA_HOT_CHARGE = 0.95;

// ── Wall-ride SLIDE (ridable wall, not just the slash) ──────────
/**
 * Sprinting past SPRINT_RIDE_THRESHOLD while hugging a wall is a GRIND: extra
 * speed along the wall face and a spray of torch-coloured sparks off the
 * contact edge. Attack mid-grind for the sweeping WALLRIDE slash; dodge to
 * vault off. The boost only lives while wall contact + charge + Shift all hold.
 */
export const WALLRIDE_SLIDE_BOOST = 1.18; // speed multiplier while grinding
export const GRIND_SPARK_INTERVAL = 0.07; // seconds between spark bursts

// ── Wall moves (Mortal-Kombat-style specials off a wall) ────────
/**
 * With no vertical axis in a top-down grid, "jump off the wall" becomes
 * WALL-CONTACT specials: when the player is pressed against a wall, a short
 * input unlocks a distinct move driven off the existing melee timeline +
 * moveCircle. All hit harder and grant brief i-frames on the launch, and are
 * FREE (no stamina) — a tactical option near walls, always available.
 * wallContact() (collision.ts) supplies the wall NORMAL (the way to kick toward).
 */
/**
 * How far past the body radius we probe for a wall to count as "wall-adjacent".
 * Generous on purpose (playtest 2026-07-15: at 0.14 you had to be pixel-perfect
 * against the wall for any wall move to arm, which read as "doesn't work").
 */
export const WALL_CONTACT_PROBE = 0.26;
/** Wall-kick: dodge INTO a wall → rebound hop + a lunging light strike away from it. */
export const WALLKICK_DURATION = 0.3; // seconds of the launch hop
export const WALLKICK_IFRAMES = 0.16; // invuln over the front of the hop
export const WALLKICK_DISTANCE = 2.2; // tiles launched off the wall
export const WALLKICK: MoveTiming = { tag: "wallkick", windup: 0.04, active: 0.06, recovery: 0.14, damageMul: 1.4, arcMul: 1.2, rangeMul: 1.15, knockbackMul: 1.8, hitstopMul: 1.3 };
/** Wall-ride: sprint-charged slide along a wall face + a wide sweeping slash. */
export const WALLRIDE: MoveTiming = { tag: "wallride", windup: 0.05, active: 0.08, recovery: 0.16, damageMul: 1.5, arcMul: 1.7, rangeMul: 1.25, knockbackMul: 1.5, hitstopMul: 1.5 };
/** Pounce slam: face wall + charge + release → leap arc off the wall to an AoE landing. */
export const POUNCE_DURATION = 0.36; // arc travel time
export const POUNCE_IFRAMES = 0.22; // airborne = untouchable most of the arc
export const POUNCE_DISTANCE = 3.2; // tiles leapt off the wall
export const POUNCE_AOE = 1.6; // radial hit radius on landing (tiles)
export const POUNCE: MoveTiming = { tag: "pounce", windup: 0.02, active: 0.1, recovery: 0.26, damageMul: 1.9, arcMul: 2, rangeMul: 1, knockbackMul: 2.4, hitstopMul: 2 };

// ── Dodge-roll (tap Space) ──────────────────────────────────────
/**
 * The centrepiece defensive move. Gungeon's roll is ~0.7s with i-frames on the
 * first ~50%; scaled tighter for a faster crawler. The roll COMMITS a direction
 * at the start (input is ignored mid-roll) and i-frames cover only the first
 * ~52% — the back half still moves you but you're hittable, so timing AND aim
 * matter ("roll INTO the attack" to pass through it; roll away and its hitbox
 * can catch you as your i-frames end). Reuses the existing p.iframes guard so a
 * roll and a damage-hit never grant TWO overlapping invuln windows.
 */
export const ROLL_DURATION = 0.42; // seconds of roll body
export const ROLL_IFRAMES = 0.22; // invulnerable window (~52% of the roll)
export const ROLL_DISTANCE = 2.6; // tiles covered, eased fast→slow
export const ROLL_RECOVERY = 0.1; // rooted, vulnerable whiff after the roll body
/**
 * A roll is a MOMENTUM move now: you must already be moving at least this fast
 * (smoothed walk speed, units/sec) to convert into a tumble. Rolling from a dead
 * stop is out — you can't dodge-cannon the instant a floor's plunger parks you,
 * you have to get the knight rolling first. ~0.6× PLAYER_SPEED, so a beat of
 * running arms it; standing still or barely nudging does not.
 */
export const ROLL_MIN_SPEED = 2.5;

// ── Attack timing model (windup → active → recovery), per melee move ──
/**
 * Every swing is three phases. Light is fast and free; the combo finisher and
 * the heavy get progressively longer, more telegraphed windups (the "windup
 * scales with weight" readability rule) and hit harder. Times are seconds;
 * the animator plays the matching clip. Per-weapon damage/range/arc still come
 * from items.ts — these are the shared timing anchors.
 */
export interface MoveTiming {
  windup: number; // before the hitbox exists (the tell)
  active: number; // hitbox live
  recovery: number; // rooted after, until you can act
  damageMul: number; // scales the equipped weapon's base damage
  arcMul: number; // widens/narrows the equipped weapon's arc
  rangeMul: number; // reach relative to the weapon
  knockbackMul: number;
  /**
   * Per-move hit-freeze multiplier over HITSTOP_HIT — the hand-tuned feel dial
   * (deep-research 2026-07-15: Smash tunes hitstop per attack beyond the damage
   * formula — heavies and sweet spots freeze longer, so weight reads on impact).
   * Light ≈ 50ms stays the floor; the heavy lands at ~90ms.
   */
  hitstopMul: number;
  /**
   * Stable identity for the move. scaleMove() returns a COPY (heft-stretched),
   * so `move === COMBO_FINISH` reference checks silently stop matching the
   * moment a weapon has heft — six presentation branches broke exactly that way
   * while I was wiring this. Compare `move.tag`, never the object.
   */
  tag: MoveTag;
}
export type MoveTag = "light1" | "light2" | "finish" | "surge" | "heavy" | "wallride" | "pounce" | "wallkick";
// The chain ACCELERATES: each step is shorter than the last (and player.ts
// ramps the clip rate to match), so mashing visibly speeds up into the finisher.
export const LIGHT_1: MoveTiming = { tag: "light1", windup: 0.1, active: 0.05, recovery: 0.12, damageMul: 1, arcMul: 1, rangeMul: 1, knockbackMul: 1, hitstopMul: 1 };
export const LIGHT_2: MoveTiming = { tag: "light2", windup: 0.06, active: 0.05, recovery: 0.09, damageMul: 1.15, arcMul: 1.15, rangeMul: 1.05, knockbackMul: 1.1, hitstopMul: 1.1 };
// The finisher is the KATANA moment (white flash, triple cut, cut-through
// ghosts — see player.ts) so it hits like a payoff: 2× damage, a genuinely wide
// arc and the heaviest non-heavy hitstop in the kit.
export const COMBO_FINISH: MoveTiming = { tag: "finish", windup: 0.11, active: 0.07, recovery: 0.16, damageMul: 2.0, arcMul: 1.6, rangeMul: 1.25, knockbackMul: 2, hitstopMul: 1.8 };
export const HEAVY: MoveTiming = { tag: "heavy", windup: 0.24, active: 0.08, recovery: 0.28, damageMul: 2.2, arcMul: 1.5, rangeMul: 1.15, knockbackMul: 2.6, hitstopMul: 1.8 };

/**
 * FOURTH STEP — the chain no longer stops at three.
 *
 * The old chain was light-1 → light-2 → finisher → back to 1, which meant every
 * melee weapon in the game played the same three beats and the rhythm never
 * changed. Landing the full chain now opens a SURGE: a wide, hard-hitting
 * fourth swing that only exists if you actually connected your way there.
 */
export const COMBO_SURGE: MoveTiming = { tag: "surge", windup: 0.13, active: 0.09, recovery: 0.2, damageMul: 2.8, arcMul: 1.9, rangeMul: 1.35, knockbackMul: 2.8, hitstopMul: 2.1 };
/**
 * Widest sprite atlas we will build. WebGL's guaranteed floor is 2048 but every
 * target we ship to reports 8192+; over that the texture is silently RESIZED,
 * which corrupts the whole sheet's UVs and blanks every sprite (a black screen
 * with a working HUD). sprite.ts throws rather than let that ship.
 */
export const MAX_ATLAS_WIDTH = 8192;

/** Wrecking-ball damage multiplier at terminal momentum (1x at a standstill). */
export const MOMENTUM_WEAPON_MAX = 2.6;

/** How many steps a chain runs before it restarts. */
export const COMBO_MAX_STEP = 3;
/** The chain itself, in order. Indexed by p.comboStep. */
export const COMBO_CHAIN: MoveTiming[] = [LIGHT_1, LIGHT_2, COMBO_FINISH, COMBO_SURGE];

/**
 * The chain only advances on a swing that CONNECTED. Whiffing drops you back to
 * step 1 — the combo is a reward for hitting, not for mashing at empty air,
 * which is what made the old chain feel like it had no stakes.
 */
export const COMBO_REQUIRES_HIT = true;
/**
 * Each landed step shortens the NEXT step's windup by this much (compounding,
 * floored by COMBO_RAMP_FLOOR). A chain you're landing visibly accelerates.
 */
export const COMBO_RAMP = 0.92;
export const COMBO_RAMP_FLOOR = 0.7;

/** Chain to the next combo step only if the follow-up is pressed within this window after a swing's active frames. */
export const COMBO_WINDOW = 0.34;
/** A heavy weapon gets a longer link window — you cannot mash a greatsword at
 *  dagger speed, so the chain would be impossible to hold without this. */
export const COMBO_WINDOW_HEFT_MULT = 0.75;

/**
 * Scale a move's timeline by a weapon's HEFT. Stretches the windup (the tell)
 * and the recovery (the commitment) but never the ACTIVE window — a heavy
 * weapon is slow to start and slow to finish, not easier to land.
 *
 * Pure so the timing maths is unit-tested rather than eyeballed in-game.
 */
export function scaleMove(move: MoveTiming, heft: number): MoveTiming {
  if (heft === 1) return move;
  return { ...move, windup: move.windup * heft, recovery: move.recovery * heft };
}
/** A charge held past this releases the heavy at max power. */
export const CHARGE_TIME = 0.6;
/** Inputs landed this early still fire (action-game buffering courtesy). */
export const INPUT_BUFFER = 0.13;

// The attack is a short arc in front of the facing direction. The active window
// is tied to the 3-frame 12fps attack clip so the hitbox agrees with the art:
// frame 0 is windup, frame 1 is the swing (active), frame 2 is recovery.
// Per-weapon numbers (damage, range, arc, cooldown, durability) live in
// items.ts — these are just the shared timing anchors.
export const KNOCKBACK_ZOMBIE = 0.45; // how far a hit shoves a zombie
export const KNOCKBACK_PLAYER = 0.35;

/** Boots multiply run speed by this while equipped. */
export const BOOTS_SPEED_FACTOR = 1.18;

/** Walking within this range of a ground item picks it up. */
export const PICKUP_RANGE = 0.45;

/**
 * Grab radius for the two RUN-DEFINING drops — cards and marble materials.
 *
 * Deliberately wider than PICKUP_RANGE. A helmet you miss is a helmet; a card
 * you miss is the build you were going to play, and at pinball speed the ball
 * is not steerable to a 0.45-unit target. See PICKUP_SWEEP_MAX for the other
 * half of that fix.
 */
export const CARD_PICKUP_RANGE = 0.8;

/**
 * The furthest a single 60Hz step may have carried the knight for the pickup
 * sweep to trust the segment between the two samples.
 *
 * WHY A SWEEP AT ALL: pickups used to be a point-in-radius test run once per
 * fixed step, against the position the step ENDED at. At PINBALL_MAX_SPEED (22
 * u/s) a step covers 0.37 units and a rail step covers ~0.5 — so a card sitting
 * 0.4 units off the ball's line has both samples land outside its 0.45 radius
 * and is never picked up, no matter how squarely you ran over it. That is the
 * "I bounce straight through cards" bug: the faster you play, the smaller the
 * pickup radius effectively gets.
 *
 * WHY A CAP: the same two samples straddle a TELEPORT (floor start, pit
 * respawn, grab-throw, portal) and the segment between them would vacuum up
 * every item on the line. Above this the sweep degrades to the old point test,
 * which is exactly right for a jump — you did not travel that path.
 */
export const PICKUP_SWEEP_MAX = 1.5;

/** Seconds between repeats of a per-item refusal note ("stash full", "not
 * yours to take"). Without it the note is rebuilt 60x a second while you stand
 * on the item, which is a DOM node per frame. */
export const PICKUP_NOTE_COOLDOWN = 2.5;
