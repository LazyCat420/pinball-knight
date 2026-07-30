/**
 * WHAT ONE TAVERN FRAME PRESENTS.
 *
 * One tiny decision in its own module so it can be tested without standing up a
 * WebGPU renderer, a three.js scene and the whole hub — `core.ts` cannot be
 * imported in a unit test, and the invariant below is exactly the kind that goes
 * quiet when nobody can assert it.
 */

/**
 * What a frame presents: the room, the UI alone, or nothing.
 *
 * ── WHY THIS IS A FUNCTION AND NOT TWO IFS IN `frame()` ──
 * It used to be two ifs, and the `frozen` one was a bare `return`:
 *
 *     if (frozen) return;                       // skip the 3D pass
 *     if (scene && camera && rendererReady) pixelPass.render(scene, camera);
 *
 * Skipping the ROOM while a panel is up is correct and stays correct: it is
 * 82%-obscured by the panel's scrim, the player is frozen, and redrawing a
 * near-static image at full cost STARVED the casino — the cabinet ran at ~2fps
 * behind this pass and, because its animation dt is clamped to 0.05, that turned
 * a 2.6s roulette spin into 26 seconds of wall clock.
 *
 * What was wrong was presenting NOTHING. The panels stopped being overlays the
 * browser composites on its own: every one of them — the four vendor counters,
 * the run summary, the menu, the casino cabinet — is now a painted screen inside
 * THIS pass, and `drawUiFrame` is wired into `pixelPass.render`/`presentUi` at
 * init. So the early return did not merely skip the room, it skipped the panel's
 * own paint AND its input handling, every frame, for as long as the panel was
 * open. Walking up to the Alchemist and pressing E froze the game on the last
 * frame of the room with no way out: Esc is handled inside `drawUiFrame`, and the
 * scene's own key handler yields to the UI whenever `uiPauses` is set, so nothing
 * was left that could close what nothing was left to draw.
 *
 * `presentUi` is the pass's existing answer to "a frame that must show only the
 * UI" — the final composite alone, over a cleared target. It keeps the whole
 * point of the skip (no scene, no bloom chain) while the panel stays painted and
 * live. The room no longer reads through the scrim while a panel is open; at 82%
 * scrim that is a small loss and the right trade against a hard freeze.
 *
 * The one invariant worth a test: `frozen` must NEVER map to "none". A panel that
 * pauses the world is the one thing that has to keep being drawn.
 */
export type PresentMode = "none" | "ui-only" | "scene";

export function presentMode(rendererReady: boolean, frozen: boolean): PresentMode {
  // rendererReady: the async backend init has to land before any render() or
  // present call, which throws otherwise. A few skipped frames on entry are
  // invisible — and a panel cannot be open that early.
  if (!rendererReady) return "none";
  return frozen ? "ui-only" : "scene";
}
