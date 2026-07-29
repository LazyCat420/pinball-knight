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
import type { FloorLoading } from "../floor-loading";

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
