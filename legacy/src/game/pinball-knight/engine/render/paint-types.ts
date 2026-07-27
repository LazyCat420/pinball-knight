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

/** The named animation clips an actor can have. */
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
  | "forge";

/** An actor's full art table: per direction, per clip, a list of frames. */
export type ActorPaints = Record<Dir, Partial<Record<ClipName, FramePaint[]>>>;
