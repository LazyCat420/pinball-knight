/**
 * TELEGRAPH → CLIP. Which animation a movement policy's tell is wearing.
 *
 * ## Why this is a mapping and not a branch in zombie.ts
 *
 * `entities/movement.ts` ships eleven movement intents, six of which declare a
 * `MoveTell` — a colour and an intensity — so the intent is LEARNABLE. Until
 * this wave that tell was a tint and nothing else. It is legible, but it is
 * thin: a leaper mid-crouch, a pack-hunter stalking the edge of the light and
 * an ambusher that has just committed all played the same `idle` or `walk`
 * clip, in three different colours.
 *
 * The fix belongs on the SAME channel the tint already uses. A policy does not
 * know what a sprite is (that is what makes every handler unit-testable and
 * measurable), so it cannot name a clip; it names an intent-with-a-colour, and
 * this module — presentation, in render/ — decides what that looks like. Add a
 * seventh telegraph to a policy and it inherits a sane clip here or it does
 * not, but either way `movement.ts` stays free of three.js.
 *
 * ## Why the colour is the key
 *
 * Because the colour IS the vocabulary. `MOVE_TELL.leap` is not "the leaper's
 * colour", it is "the crouch", and the flailer zombie and the hound both wear
 * it for the same reason. Keying on the policy name instead would mean every
 * family that borrows a tell has to be re-listed here, and the day a new one
 * borrows `MOVE_TELL.commit` it would silently get no animation at all — the
 * exact failure mode this file exists to end.
 */
import { MOVE_TELL, type Steer } from "../entities/movement";
import type { ClipName } from "../engine/render/paint-types";

/**
 * The clip for a steer this frame, or null for "the caller's normal choice".
 *
 * Null rather than "walk"/"idle" on purpose: the caller already has facing,
 * lure, oil and rooted logic wrapped around its clip pick, and a policy tell is
 * an OVERRIDE on that, not a replacement for it.
 */
export function clipForSteer(steer: Steer, moving: boolean): ClipName | null {
  const tell = steer.tell;
  if (!tell) return null;
  switch (tell.color) {
    // The crouch. Only while the actor is actually held — a leaper's tell is
    // also raised on the release frame, when it is already travelling, and a
    // crouch pose on something moving at 3.4× speed would be a lie.
    case MOVE_TELL.leap:
      return steer.hold ? "crouch" : null;

    // The stalk. The pack-hunter shadows you at half speed, so it IS moving;
    // `wait` is a gait, not a stand. When it is genuinely still (standing on
    // the player) let the caller's idle through.
    case MOVE_TELL.pack:
      return moving ? "wait" : null;

    // The burst. Shared by the ambusher's spring and the strafer's dart,
    // because they are the same read: a thing that was not coming at you is
    // now coming at you fast.
    case MOVE_TELL.commit:
      return moving ? "wake" : null;

    // flank / strafe / orbit are approach FLAVOURS, not events — the actor is
    // walking and should look like it. Their tint carries them.
    default:
      return null;
  }
}
