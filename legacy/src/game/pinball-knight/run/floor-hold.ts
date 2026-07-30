/**
 * The descent hold — is the loading screen currently owning the display?
 *
 * Two flags with one job: `startLevel` raises the descent screen and HOLDS the
 * frame loop, the loop refuses to render or simulate while held, and the
 * continuation lowers it once the floor's pipelines are warm.
 *
 * They live here rather than as module `let`s in core because the writers
 * (`startLevel`, `armFloorLoading`) and the reader (the frame loop) ended up on
 * opposite sides of the decomposition. Sharing them through a module keeps the
 * dependency arrow pointing one way; the alternative was for the loop to import
 * core, which is the cycle the whole exercise avoids.
 *
 * Why holding matters, from the comment this replaced: rendering during a
 * descent triggers the lazy compile storm the warm-up exists to schedule, and
 * simulating runs the world for the several seconds the player can neither see
 * nor act in.
 */
import { openFloorLoading, type FloorLoading } from "../floor-loading";
import { presentUiFrame } from "../boot/renderer";
import { state } from "../state";

let floorLoad: FloorLoading | null = null;
let held = false;

/** The live descent screen, if one is up. */
export function currentFloorLoad(): FloorLoading | null {
  return floorLoad;
}

/** Raise the hold: the descent screen owns the display. */
export function holdForFloorLoad(load: FloorLoading): void {
  floorLoad = load;
  held = true;
}

/**
 * Lower the hold. Pass the screen you raised — a stale continuation whose floor
 * was superseded must not clear a NEWER screen, which is why this compares
 * rather than blindly nulling.
 */
export function releaseFloorLoad(load: FloorLoading | null): void {
  if (load === null || floorLoad === load) floorLoad = null;
  held = false;
}

/** True while the descent screen owns the display — the loop renders nothing. */
export function isRenderHeld(): boolean {
  return held;
}

/**
 * Raise the descent screen, PUT IT ON THE SCREEN, and only then let `then`
 * block the thread building the floor.
 *
 * ⚠️ The paint is the whole job, and it used to be missing. This waited two
 * empty frames on the theory that the browser would lay the overlay out and
 * its own loop would draw it — true of the DOM version, false of the canvas
 * one, which is painted by the frame loop. On the FIRST descent of a session
 * that loop is not even running yet (`beginRun` starts it inside this
 * continuation) and the tavern has just disposed the canvas it was rendering
 * into. So the two frames elapsed, nothing was drawn, `buildLevel` blocked the
 * thread for half a second and `warmFloorPipelines` for several more — all of
 * it on black. That is the bug this screen exists to prevent, delivered by the
 * screen itself.
 *
 * Still two frames, but each one now presents: the first submits, the second
 * gives the compositor a turn to actually put it up. GPU submission is async,
 * so that is the difference between "a frame was queued" and "the player can
 * see it" — and what is on screen during the block that follows is the point.
 *
 * ⚠️ It lived in core.ts until this fix, on the stated grounds that it wrote
 * "the `floorLoad` and `renderHeldForLoad` module flags". Those flags are the
 * two `let`s at the top of THIS file — the extraction that moved them here left
 * the note behind, so the reason to keep it in core had been false for a while.
 * It still crosses back through `run/deps.ts`, which is unchanged.
 */
export function armFloorLoading(level: number, then: () => void): void {
  if (!state.container) {
    then();
    return;
  }
  holdForFloorLoad(openFloorLoading(state.container, level));
  requestAnimationFrame(() => {
    presentUiFrame();
    requestAnimationFrame(() => {
      presentUiFrame();
      then();
    });
  });
}
