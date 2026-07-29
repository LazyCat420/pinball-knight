/**
 * The sprint/overcharge meter's repaint cache.
 *
 * One number: how many twentieths the HUD last painted. The meter is a DOM
 * write, so repainting it every frame at 60Hz for a value that changes a few
 * times a second is pure waste — this exists so the loop can skip the write
 * when nothing changed.
 *
 * It lives in its own module because two unrelated places touch it: the frame
 * loop compares and updates it, and building a floor invalidates it so the new
 * floor's first frame repaints unconditionally. It used to be a module `let` in
 * core.ts, which meant the floor builder could not move out without either
 * importing core (a cycle) or silently dropping the invalidation — and a
 * dropped invalidation shows up as a meter frozen at the previous floor's fill,
 * which is exactly the kind of bug nobody attributes to a refactor.
 */

/** Sentinel meaning "nothing painted yet — repaint whatever you have". */
const NONE = -1;

let shown = NONE;

/** What the HUD last painted, in twentieths. */
export function meterBlocksShown(): number {
  return shown;
}

/** Record what was just painted. */
export function setMeterBlocksShown(blocks: number): void {
  shown = blocks;
}

/** Force the next frame to repaint. Call when a floor is built. */
export function invalidateMeterBlocks(): void {
  shown = NONE;
}
