/**
 * TILT TITAN SPIN CADENCE — timing only.
 *
 * The baked sheets and the rig that produced them are the shipped art and are
 * never re-baked to change how fast the ball turns. Everything here is
 * playback rate.
 *
 * ── WHY A TABLE AND NOT ONE NUMBER ────────────────────────────────────────
 *
 * One baked loop takes `1/rate` seconds for all three spin clips: loop time is
 * `beats/(fps * rate)` (engine/render/monster-animator.ts), and the override in
 * boot/sheets.ts sets `beats` equal to each clip's effective fps — attack 12
 * against anim.attack 12, roll 14 against anim.roll 14, ball 6 against the
 * `default: 6` in `fpsFor` (there is deliberately no `case "ball"` there).
 *
 * But **one loop is not one turn.** The three clips sweep different total
 * rotation, because `roll` and `ball` carry a full turn about TWO axes:
 *
 *   attack  YXZ(0.34 sin ph,  ph,             0.26 sin 2ph)   1.0883 turns
 *   roll    ZYX(ph,          -ph,             0.55 sin ph)    1.4602 turns
 *   ball    YZX(ph,           0.65 sin 2ph,  -ph + 0.25 sin ph) 1.6431 turns
 *
 * (geodesic quaternion path length over the pose paths in
 * render/pinball-boss-3d.ts, 200k samples.)
 *
 * So a single shared rate makes the SAME charge read up to 51% faster or
 * slower depending only on which axis path the RNG drew that time. Every rate
 * below is therefore expressed in SURFACE revolutions per second and divided
 * by the clip's gain, so all three read alike.
 */
export type PinballSpinClip = "attack" | "roll" | "ball";

export const SPIN_TURNS_PER_LOOP: Record<PinballSpinClip, number> = {
  attack: 1.0883,
  roll: 1.4602,
  ball: 1.6431,
};

/**
 * The clip the Titan rolls on between charges.
 *
 * NOT `walk`. The Titan is a ball, and its `walk` pose turns the riveted seam
 * ring only — `render/pinball-boss-3d.ts` holds `ball.rotation.x` at a static
 * 0.16 lean with a ±0.03 wobble, so the hull and the face do not rotate at
 * all. A chrome sphere crossing the floor without turning does not read as
 * "slowly spinning", it reads as sliding, and that is a quarter of the fight.
 *
 * `roll` is also the most readable of the three on the shipped atlas: none of
 * its 32 cells hide the face, where `attack` hides it for seven.
 *
 * ⚠ `roll` does not loop by default (see LOOPS in monster-animator.ts), so
 * every caller must pass `{ loop: true }` or the ball completes one turn and
 * freezes on the last cell.
 */
export const PINBALL_AMBIENT_CLIP: PinballSpinClip = "roll";

/**
 * Surface revolutions per second, by state.
 *
 * ── THESE ARE NOT A NO-SLIP CALIBRATION, ON PURPOSE ───────────────────────
 *
 * The drawn ball is ~2.4 world units across, so its circumference is ~7.5 and
 * a true no-slip roll at the phase-1 ground speed of 26 would be ~3.5 rev/s.
 * Two of the three clips ALREADY exceed that today. Calibrating to physics
 * would make the boss slower, not faster, and a ball this big rolling
 * honestly reads as ponderous. These are ~1.7x no-slip because they are tuned
 * to look right, and saying so is better than dressing them up as physics.
 *
 * `max` is the ALIASING budget, not a taste limit. At 60 Hz the display
 * advances `32 * rate / 60` baked cells per shown frame; measured
 * frame-to-frame decorrelation on the shipped atlas reaches the arbitrary-pair
 * baseline at a lag of about 3.5 cells. Past that, consecutive frames are as
 * different as unrelated ones and the surface BOILS rather than reading as
 * faster — the classic way a spin gets slower-looking the harder you push it.
 * So the ceiling stays near 6-7 rev/s and the gap is closed by raising the
 * FLOOR instead.
 */
export const PINBALL_SPIN = { ambient: 1.2, floor: 2.4, peak: 6.0, max: 7.0 } as const;

/** The animator rate that makes `clip` sweep `revs` surface turns per second. */
export function spinRate(clip: PinballSpinClip, revs: number): number {
  return revs / SPIN_TURNS_PER_LOOP[clip];
}

/**
 * Peak surface rev/s for a charge at this ground speed — the dash rate, and
 * the top of the rev-up.
 *
 * Scales with `spec.speed` so the second phase actually escalates; the old
 * hard-coded 3.0 was identical in both phases.
 */
export function pinballPeakRevs(speed: number): number {
  return Math.min(PINBALL_SPIN.max, PINBALL_SPIN.peak * (speed / 26));
}

/**
 * Baked cells advanced per DISPLAYED frame at `refreshHz` — the aliasing
 * budget. Kept here rather than inlined in the test so the guard and the
 * tuning cannot drift apart.
 */
export function cellsPerDisplayedFrame(clip: PinballSpinClip, revs: number, refreshHz = 60): number {
  return (32 * spinRate(clip, revs)) / refreshHz;
}
