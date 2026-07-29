/**
 * THE DESCENT SCREEN — now a delegate.
 *
 * The decorative labyrinth, the fade transition and the fixed overlay moved to
 * `gui/screens/floor-loading.ts`, where the progress bar is driven by WALL
 * CLOCK rather than by frames — see the note there, and the lesson this repo
 * already paid for once: a bar that stops moving reads as a hang, and this is
 * the one screen whose whole job is to be on screen while the loop is blocked.
 */
export type { FloorLoading } from "./gui/screens/floor-loading";
export { isFloorLoadingOpen } from "./gui/screens/floor-loading";
import { openFloorLoading as openUi } from "./gui/screens/floor-loading";
import type { FloorLoading } from "./gui/screens/floor-loading";

export function openFloorLoading(_container: HTMLElement | null, level: number): FloorLoading {
  return openUi(level);
}
