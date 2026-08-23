/**
 * WORLD — things the dungeon does to you, and things you pick up off its floor.
 *
 * Serves `economy/pickups.ts`, `economy/shop.ts`, `lamp-puzzle.ts` and the
 * trapdoor ride in `entities/player.ts`.
 */
import { bus } from "./bus";
import { beep, burst } from "./synth";
import { voice } from "./gate";

/** Scooped something off the floor — a bright little blip. */
export function sfxPickup(): void {
  const b = bus("world");
  if (!b) return;
  beep(b, { type: "square", f0: 523, f1: 784, dur: 0.09, vol: 0.1 });
  beep(b, { type: "square", f0: 784, dur: 0.08, vol: 0.08, at: 0.07 });
}

/** Trapdoor — a wooden creak, then the drop whoosh. */
export function sfxTrapdoor(): void {
  const b = bus("world");
  if (!b) return;
  beep(b, { type: "sawtooth", f0: 140, f1: 70, dur: 0.18, vol: 0.14 });
  burst(b, 0.35, 0.16, "lowpass", 500, 0.12);
  beep(b, { type: "sine", f0: 500, f1: 90, dur: 0.4, vol: 0.12, at: 0.15 });
}

// ── Coin absorb ─────────────────────────────────────────────────
/**
 * A pentatonic ladder, a stagger and a voice cap. One kill mints 2-6 coins that
 * land within a few hundred ms of each other, so the naive thing — fire the same
 * chime per coin — produces a buzz (identical partials stacking in phase), not a
 * jingle. Instead each coin in a cluster takes the NEXT rung of the ladder and is
 * scheduled COIN_STEP later than the one before, which turns a burst into a
 * rising arpeggio. The ladder resets after a quiet gap so a lone coin is always
 * the low, warm root note.
 *
 * The cluster bookkeeping now comes from `sfx/gate.ts`'s `voice()` rather than
 * two module-local `let`s. That is why `voice` returns an INDEX and not a
 * boolean: the index is musical here, not just a permission.
 */
const COIN_LADDER = [1046.5, 1174.7, 1396.9, 1568.0, 1864.7, 2093.0];
/** Hard ceiling on chimes per cluster — the rest bank silently. */
const COIN_VOICES = 5;
const COIN_STEP = 0.055; // seconds between successive coins in one cluster
const COIN_RESET = 0.35; // silence this long starts a fresh ladder

/** A coin absorbed into the knight — a bright struck chime with an octave tail. */
export function sfxCoin(): void {
  const b = bus("world");
  if (!b) return;
  const i = voice("coin", COIN_VOICES, COIN_RESET);
  if (i < 0) return; // cluster full — adding more only muddies it
  // Schedule relative to this coin's rung so coins arriving in the SAME frame
  // still come out spaced, then detune a hair so no two are bit-identical.
  const at = i * COIN_STEP;
  const f = COIN_LADDER[Math.min(i, COIN_LADDER.length - 1)]! * (0.99 + Math.random() * 0.02);
  beep(b, { type: "triangle", f0: f, dur: 0.07, vol: 0.07, at });
  beep(b, { type: "triangle", f0: f * 2, dur: 0.1, vol: 0.04, at: at + 0.045 });
}
