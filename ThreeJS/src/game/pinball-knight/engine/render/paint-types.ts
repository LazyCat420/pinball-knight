/**
 * The vocabulary of the painter-based sprite pipeline.
 *
 * These are the shapes the ENGINE speaks: a frame is a function that draws
 * into a 2D context, an actor's art is a table of clips per direction. What
 * gets drawn — a knight, a zombie, the Reaper — is content, and lives in
 * `render/cel-painter.ts`.
 *
 * Split out of cel-painter so `sprite.ts` can consume the types without
 * importing 3372 lines of hand-painted art with them. `cel-painter.ts`
 * re-exports these, so its own call sites are unchanged.
 */

/** One frame: draw into the supplied 2D context. */
export type FramePaint = (ctx: CanvasRenderingContext2D) => void;

/**
 * The three painted directions. W is rendered by horizontally flipping E, so
 * it is never painted — see `ActorSprite.setFlipped`.
 */
export type Dir = "S" | "N" | "E";

/**
 * The named animation clips an actor can have.
 *
 * The last four are TELEGRAPH clips. A movement policy (entities/movement.ts)
 * declares an intent and a tell colour; until this wave the tell was a tint and
 * nothing else, which is legible but thin — a crouching leaper and a stalking
 * pack-hunter both played `idle`, and a staggered monster played `idle` pale.
 * The most frequent piece of feedback in the game had no animation at all.
 *
 * They are deliberately OPTIONAL. `Animator.indices` falls back down a chain
 * (see CLIP_FALLBACK) to whatever the actor does author, so a family with no
 * `stumble` plays exactly what it played before rather than freezing on an
 * empty clip. That is what makes it affordable to author these for the handful
 * of sheets that actually run those policies instead of all twenty-two.
 */
export type ClipName =
  | "idle"
  | "walk"
  | "attack"
  | "death"
  | "roll"
  | "run"
  | "ball"
  | "steelball"
  /**
   * MARBLE BODIES — one clip per `MarbleMaterial`. The material axis used to
   * render the plain `ball` (the tucked knight) with a tinted trail, so the six
   * materials were told apart only by the colour of their afterimages. Each is
   * now its own sphere, painted from `MARBLE_SKINS` (render/cel-painter.ts).
   *
   * They share the `ball` cadence — same ride, different substance — and, like
   * `steelball`, they are authored ONCE and handed to all three facings by
   * reference, because a sphere looks the same from every angle.
   */
  | "diamondball"
  | "waterball"
  | "stoneball"
  | "stormball"
  | "shadowball"
  | "lavaball"
  | "magnetball"
  /**
   * RICOCHET FORMS (entities/ricochet-form.ts) — the two seconds where the ball
   * is not yours. Not marble bodies: while these run you are not a sphere at
   * all, which is why they are their own clips rather than another skin.
   */
  | "boltform"
  | "laserform"
  | "equip"
  | "forge"
  /** Leaper wind-up: a loaded crouch, held. The one tell you must read fast. */
  | "crouch"
  /** Pack-hunter stalk: a wary held gait, visibly not the walk. */
  | "wait"
  /** Ambusher spring / strafer dart: the burst out of stillness. */
  | "wake"
  /** Stagger: rocked back off the blow, then held. */
  | "stumble";

/** An actor's full art table: per direction, per clip, a list of frames. */
export interface ActorPaints extends Record<Dir, Partial<Record<ClipName, FramePaint[]>>> {
  /**
   * How many BEATS a clip was AUTHORED as, per clip. Frame count divided by
   * beats scales that clip's playback rate, so adding in-betweens changes
   * SMOOTHNESS and never DURATION.
   *
   * Absent ⇒ 1:1 with the frame count, i.e. exactly today's behaviour.
   *
   * ⚠️ WHY THIS IS PER-ACTOR AND NOT A GLOBAL NOMINAL TABLE. There is no
   * nominal. At the single global FPS_WALK the roster's walk counts are knight
   * 8, zombie 6, most monsters 4, and pin/magnet/bat/chomper 2 — cycle
   * durations of 1.0s / 0.75s / 0.5s / 0.25s. Any constant N retimes everyone
   * whose count is not N: `NOMINAL.walk = 4` would double the knight's leg
   * speed and halve the pin's flap. It is worse on one-shots, where crouch and
   * wake are paced to END on a mechanic window (LEAP_WINDUP, the wake burst) —
   * a nominal-driven retime desyncs a telegraph from the thing it advertises,
   * silently.
   *
   * It also has to live at the TOP LEVEL rather than per-direction, because
   * `withRecoil` spreads the top level and replaces only the Dir keys — a
   * per-direction field would be silently dropped for the recoil variant.
   */
  beats?: Partial<Record<ClipName, number>>;
}
