/**
 * THE PAUSE CONTRACT.
 *
 * True while ANY modal surface owns the screen. `simulate` early-returns on it,
 * and the frame loop books the elapsed wall-clock into `state.pausedRunS` so the
 * leaderboard's run duration does not count time spent reading.
 *
 * It used to ask whether four particular DOM nodes existed — so the most
 * consequential boolean in the game lived in the document tree. Screens are
 * values on a stack now, and `gui/stack.ts` maintains `state.uiPauses` from the
 * screens that declare they pause. The walkable tavern is still its own scene
 * and answers separately.
 *
 * Its own module because both halves of the frame — the simulation and the loop
 * — ask it, and it must not drag either of them back into core.
 */
import { state } from "../state";
import { isTavernSceneOpen } from "../../../scenes/tavern";

export function isSimPaused(): boolean {
  return state.uiPauses || isTavernSceneOpen();
}
