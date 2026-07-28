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
export type ActorPaints = Record<Dir, Partial<Record<ClipName, FramePaint[]>>>;
