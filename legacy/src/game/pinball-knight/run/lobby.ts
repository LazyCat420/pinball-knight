/**
 * OPENING THE LOBBY — the tavern, and nothing in front of it.
 *
 * Extracted from `core.ts` rather than added to it. The size ratchet in
 * `core-boundary.test.ts` states the rule this follows: a failure there "is not
 * 'the file is too big' — it is 'something that was extracted came back, or new
 * work chose core.ts as its home'". Opening the lobby is a lobby concern, so it
 * lives next to the rest of the run lifecycle.
 *
 * ── WHY NO CHARACTER MODAL HERE (2026-08-07) ────────────────────────────────
 *
 * This used to `push(characterSelectScreen(…))` the instant `enterTavern` was
 * kicked off, so the first thing after the title sequence was a modal sheet. It
 * looked like a system dialog rather than a game screen, and that was not a
 * styling accident — every full-screen sheet paints `scrim(f)`, which is
 * `UI.scrim`, palette 0 at 82%. The tavern behind it read as black, so the
 * player got a brown panel on nothing and no sign of the room they were told
 * they were entering. Reported live on braindeadbot.com/dungeon.
 *
 * The choice itself was also the wrong question to ask on entry: it is stored
 * (`playerSheetName()` reads localStorage) and therefore already answered for
 * everyone but a first-time visitor. So the screen moved to where you go when
 * you want to change how the knight looks — the GEAR tab of the Esc/I menu,
 * beside the plate and the hands. Reachable from the tavern AND mid-run, and
 * `dev/gui-hooks.ts` still opens it directly for QA.
 *
 * That deletes three things this file no longer needs: the once-per-page-load
 * latch, and the `?autostart=1` / `__skipDungeonIntro` guard that existed only
 * because a harness has nobody to click CONFIRM. A screen nothing pushes cannot
 * ambush a harness.
 */
import { enterTavern } from "../../../scenes/tavern";

export interface LobbyOptions {
  onDescend: (floor?: number) => void;
  onAbandon: () => void;
}

export function openLobby(container: HTMLElement, opts: LobbyOptions): void {
  void enterTavern(container, {
    stats: { grade: "-", floor: 0, kills: 0, bestCombo: 0 },
    onDescend: opts.onDescend,
    onAbandon: opts.onAbandon,
    lobby: true, // the entry hall IS the multiplayer lobby
  });
}
