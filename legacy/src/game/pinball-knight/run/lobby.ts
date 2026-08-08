/**
 * OPENING THE LOBBY — the tavern, and the one question it asks first.
 *
 * Extracted from `core.ts` rather than added to it. The size ratchet in
 * `core-boundary.test.ts` states the rule this follows: a failure there "is not
 * 'the file is too big' — it is 'something that was extracted came back, or new
 * work chose core.ts as its home'". Opening the lobby is a lobby concern, so it
 * lives next to the rest of the run lifecycle.
 */
import { enterTavern } from "../../../scenes/tavern";
import { applyImportedMonsterArt } from "../boot/sheets";
import { push } from "../gui/stack";
import { characterSelectScreen } from "../gui/screens/character-select";
import { state } from "../state";

/**
 * Asked ONCE per page load, not once per lobby visit.
 *
 * The lobby is re-entered after every death and every abandoned run, and a modal
 * that reappears on each of those turns a character choice into a toll on dying.
 * Module scope rather than `state`: this survives `exitDungeonGame`, which is
 * the point — leaving the game and coming back is not a new session.
 */
let askedCharacter = false;

/** Test seam — the harness needs a fresh session without reloading the page. */
export function resetCharacterPrompt(): void {
  askedCharacter = false;
}

/**
 * Entries that must never meet a modal, because nothing can answer one.
 *
 * ── WHY NOT `shouldSkipIntro()` ─────────────────────────────────────────────
 * That predicate is deliberately broader: it also fires on `?no-intro=1` and on
 * prefers-reduced-motion. Neither says "there is no human here" — a player who
 * skips an 11-second title sequence, or who asked for less motion, still gets to
 * choose a character. Reusing it would silently take the choice away from the
 * people most likely to have set those.
 *
 * ── WHY NOT `state.player` ──────────────────────────────────────────────────
 * That was the first guard here and it does not work. `?autostart=1` schedules
 * `beginRun()` on the NEXT frame, so at the moment this runs the player is still
 * null and the guard reads "a human is in the lobby". Caught by driving the real
 * harness: gui-shot came back with `open: ["character-select"]` on an autostart
 * URL — a headless run parked on a screen with nobody to click CONFIRM.
 */
function isHarnessEntry(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get("autostart") === "1") return true;
    return Boolean((window as unknown as { __skipDungeonIntro?: boolean }).__skipDungeonIntro);
  } catch {
    return false;
  }
}

export interface LobbyOptions {
  onDescend: (floor?: number) => void;
  onAbandon: () => void;
}

export function openLobby(container: HTMLElement, opts: LobbyOptions): void {
  // ── THE MONSTER ATLASES REBUILD HERE, NOT AT BOOT ──
  //
  // `applyImportedMonsterArt` is one blocking canvas task per kind, roughly a
  // second each, and it used to be kicked from `buildMonsterSheets()` at boot —
  // straight onto the title sequence's frames. Measured on braindeadbot.com:
  // the intro rendered 4 frames in 2.4 seconds while one of those tasks ran,
  // and the whole 11.4s sequence took 22s.
  //
  // This is the right home for the call rather than `core.ts`: opening the
  // lobby is a lobby concern, and EVERY entry arrives here — the intro's
  // `onDone` fires whether the sequence played or was skipped, so `?no-intro=1`,
  // `?autostart=1` and the playtest bot all still start the load immediately.
  // Nothing is dropped by moving it, only reordered, and the load was already
  // asynchronous-and-late by design: the painters draw first and imported art
  // replaces them when it lands.
  void applyImportedMonsterArt();

  void enterTavern(container, {
    stats: { grade: "-", floor: 0, kills: 0, bestCombo: 0 },
    onDescend: opts.onDescend,
    onAbandon: opts.onAbandon,
    lobby: true, // the entry hall IS the multiplayer lobby
  });
  // WHO you are, over the lobby. Pushed here rather than before `enterTavern`
  // because nothing paints the GUI stack between the intro's last frame and the
  // tavern's first — see character-select.ts.
  //
  // `state.player` covers a run already in progress; `isHarnessEntry` covers the
  // routes that are ABOUT to start one and have nobody to click CONFIRM.
  if (askedCharacter || state.player || isHarnessEntry()) return;
  askedCharacter = true;
  push(characterSelectScreen(() => {}));
}
