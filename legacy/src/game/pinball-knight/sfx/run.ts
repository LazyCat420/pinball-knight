/**
 * RUN LIFECYCLE — descending, arriving, being warned, and dying.
 *
 * Serves `core.ts:519-524`, `boot/wiring.ts`, `run/descend.ts` and `run/death.ts`.
 * These five fire at most once each per floor, which is why they can afford to be
 * the longest and loudest stings in the game.
 *
 * The pair that matters is `sfxStairs` and `sfxLevelStart`. They fire within about
 * a second of each other across a descent, so their SHAPES are deliberately
 * opposed: stairs ASCENDS (you are leaving) and levelStart settles onto a held
 * root (you have arrived). If both rose they would read as one long confusing
 * run. `sfx-snapshot.test.ts` and the older audio tests both assert that contour
 * on actual note pitches rather than on node counts, because node count is not a
 * musical property and would pass by accident.
 */
import { bus } from "./bus";
import { beep, burst } from "./synth";

/**
 * ARRIVAL on a new floor — a low gate-swing that opens into a two-note chord.
 *
 * Kept under the plunger BOING that fires a beat later in startLevel — the launch
 * is the moment the player acts on, and an arrival sting that buried it would be
 * worse than no arrival sting.
 */
export function sfxLevelStart(): void {
  const b = bus("run");
  if (!b) return;
  // Stone gate grinding open.
  burst(b, 0.34, 0.09, "lowpass", 420);
  beep(b, { type: "sawtooth", f0: 78, f1: 62, dur: 0.3, vol: 0.09 });
  // …settling onto a root + fifth.
  beep(b, { type: "triangle", f0: 196, dur: 0.34, vol: 0.09, at: 0.16 });
  beep(b, { type: "triangle", f0: 294, dur: 0.3, vol: 0.06, at: 0.22 });
}

/**
 * A floor MODIFIER is in play — an ominous two-note drop under the toast.
 * Modifiers are announced in text; a floor that is quietly half-lit or crawling
 * reads as a bug unless something marks the moment. Scheduled a little late so it
 * lands after the arrival sting rather than on top of it.
 */
export function sfxModifier(): void {
  const b = bus("run");
  if (!b) return;
  beep(b, { type: "sawtooth", f0: 233, f1: 220, dur: 0.26, vol: 0.1, at: 0.45 });
  beep(b, { type: "sawtooth", f0: 156, f1: 147, dur: 0.42, vol: 0.11, at: 0.62 });
  burst(b, 0.5, 0.05, "lowpass", 320, 0.62);
}

/**
 * An OVERLORD is on this floor — a low brass-ish swell. Louder and longer than the
 * modifier sting: a boss floor is the biggest thing the descent card can tell you,
 * and it previously said it in text only.
 */
export function sfxBossReveal(): void {
  const b = bus("run");
  if (!b) return;
  [
    [98, 0],
    [123, 0.1],
    [147, 0.2],
  ].forEach(([f, at]) => beep(b, { type: "sawtooth", f0: f!, dur: 0.75 - at!, vol: 0.1, at: at! + 0.3 }));
  burst(b, 0.7, 0.08, "lowpass", 260, 0.35);
}

/** Found the stairs — a little ascending fanfare. */
export function sfxStairs(): void {
  const b = bus("run");
  if (!b) return;
  const notes = [392, 494, 587, 784];
  notes.forEach((f, i) => beep(b, { type: "square", f0: f, dur: 0.12, vol: 0.1, at: i * 0.09 }));
}

/** You died. */
export function sfxGameOver(): void {
  const b = bus("run");
  if (!b) return;
  const notes = [330, 262, 196, 131];
  notes.forEach((f, i) => beep(b, { type: "square", f0: f, dur: 0.22, vol: 0.12, at: i * 0.17 }));
  burst(b, 0.5, 0.06, "lowpass", 300, 0.55);
}
