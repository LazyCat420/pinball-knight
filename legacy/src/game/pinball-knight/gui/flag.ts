/**
 * `?ui2=1` — run the in-game UI instead of the DOM overlays.
 *
 * A migration switch, not a setting. Each phase moves one more screen across,
 * and until a screen reaches parity the DOM version has to stay reachable so
 * the two can be compared side by side on the same build. The flag disappears
 * with the last overlay.
 *
 * Read ONCE at module load. Reading `location.search` per frame would let the
 * UI change identity mid-run if anything ever pushed history state, and a menu
 * that is DOM on one keypress and canvas on the next is not a thing worth being
 * able to express.
 */
const ON = typeof window !== "undefined" && /[?&]ui2=1\b/.test(window.location.search);

export function inGameUiEnabled(): boolean {
  return ON;
}
