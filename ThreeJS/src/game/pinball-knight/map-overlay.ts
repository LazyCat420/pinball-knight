/**
 * THE FLOOR MAP — now a delegate.
 *
 * The painting was always in `map-render.ts`; this module was the chrome around
 * it (a fixed div, a canvas, a resize listener, a RAF). All of that is gone —
 * `gui/screens/floor-map.ts` gives the same painter a rect inside the pixel
 * pass. The suppression flag stays here because it is a RULE about when the map
 * is available (the site map yields the key for the run), not presentation.
 */
import { floorMapScreen } from "./gui/screens/floor-map";
import { close as closeUiScreen, isOpen as uiIsOpen, push as pushUiScreen } from "./gui/stack";

let suppressed = false;

/** The site map yields the map key for the run; this is that gate. */
export function setMapSuppressed(on: boolean): void {
  suppressed = on;
  if (on) closeUiScreen("floor-map");
}

export function isFloorMapOpen(): boolean {
  return uiIsOpen("floor-map");
}

export function closeFloorMap(): void {
  closeUiScreen("floor-map");
}

/** Returns whether the map is open AFTER the toggle. */
export function toggleFloorMap(_container?: HTMLElement): boolean {
  if (suppressed) return false;
  if (uiIsOpen("floor-map")) {
    closeUiScreen("floor-map");
    return false;
  }
  pushUiScreen(floorMapScreen());
  return true;
}
