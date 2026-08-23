/**
 * Audio tuning. Per the house rule at the top of `constants.ts`, every tuning
 * number lives in this tree.
 *
 * NOTE what is deliberately NOT here: the 28 per-sting volume and pitch literals
 * in `sfx/*.ts`. Those are TIMBRE, not tuning — the 0.12 in a sword swing is part
 * of what makes it a sword swing, in the same way its filter frequency is, and
 * hoisting all 28 into a table here would separate each number from the sound it
 * shapes while making the sfx/ move's diff unreadable. What belongs here is the
 * numbers a PLAYER or a SYSTEM adjusts, not the ones an ear composed.
 */

/**
 * Notches on the volume slider.
 *
 * 10 gives 10% steps, which is fine enough to find a comfortable level and coarse
 * enough that every step is audible — a 20-step slider has notches nobody can
 * tell apart, which makes the control feel broken rather than precise.
 */
export const VOLUME_STEPS = 10;
