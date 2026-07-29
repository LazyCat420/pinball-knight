/**
 * THE PAUSE CONTRACT.
 *
 * True while ANY modal surface owns the screen: the merchant shop, the DOM
 * tavern, the walkable tavern scene, the card reader, or the in-game menu.
 * `simulate` early-returns on it, and the frame loop books the elapsed
 * wall-clock into `state.pausedRunS` so the leaderboard's run duration does not
 * count time spent reading.
 *
 * Its own module because both halves of the frame — the simulation and the loop
 * — ask it, and it must not drag either of them back into core.
 */
import { state } from "../state";
import { isTavernSceneOpen } from "../../../scenes/tavern";

export function isSimPaused(): boolean {
  return !!(state.shopEl || state.tavernEl || state.cardReaderEl || state.menuEl) || isTavernSceneOpen();
}
