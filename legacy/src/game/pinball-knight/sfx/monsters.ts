/**
 * MONSTERS AND NPCs — the things down here that make noise on their own.
 *
 * Serves `entities/zombie.ts` and all four call sites in `entities/npc.ts`.
 *
 * `sfxCartBell` is isolated here deliberately: it is the ONLY sting in the game
 * that takes an argument, and keeping the type irregularity in one file means the
 * registry's `SfxTrigger = () => void` correctly excludes it from the
 * function-reference tables in `marble.ts` and `ricochet-form.ts` at compile time
 * rather than by convention.
 */
import { clamp01 } from "../../../utils/math";
import { bus } from "./bus";
import { beep, burst } from "./synth";

/** A zombie notices you. Throttled by the CALLER — a chorus every frame is noise.
 *  See `sfx/gate.ts`; `entities/zombie.ts` has one gated site and one deliberately
 *  ungated one-shot (the mimic waking up). */
export function sfxGroan(): void {
  const b = bus("monsters");
  if (!b) return;
  beep(b, { type: "triangle", f0: 82, f1: 55, dur: 0.4, vol: 0.11 });
  beep(b, { type: "triangle", f0: 110, f1: 66, dur: 0.3, vol: 0.06, at: 0.08 });
}

/** Zombie goes down for good. */
export function sfxZombieDie(): void {
  const b = bus("monsters");
  if (!b) return;
  beep(b, { type: "sawtooth", f0: 160, f1: 36, dur: 0.35, vol: 0.14 });
  burst(b, 0.25, 0.1, "lowpass", 500, 0.05);
}

/** Bumper goblin — a rubbery BOING, lower and sillier than the bumper ping. */
export function sfxGoblin(): void {
  const b = bus("monsters");
  if (!b) return;
  beep(b, { type: "sine", f0: 180, f1: 420, dur: 0.1, vol: 0.2 });
  beep(b, { type: "sine", f0: 420, f1: 240, dur: 0.14, vol: 0.14, at: 0.08 });
}

/** The Magician's cackle — a descending, delighted arpeggio. */
export function sfxCackle(): void {
  const b = bus("monsters");
  if (!b) return;
  [880, 740, 620, 520, 440].forEach((f, k) => {
    beep(b, { type: "square", f0: f, f1: f * 0.92, dur: 0.09, vol: 0.12, at: k * 0.07 });
  });
}

/** The Oracle Frog — a fat contented croak. */
export function sfxRibbit(): void {
  const b = bus("monsters");
  if (!b) return;
  beep(b, { type: "sawtooth", f0: 110, f1: 160, dur: 0.14, vol: 0.16 });
  beep(b, { type: "sawtooth", f0: 90, f1: 140, dur: 0.18, vol: 0.14, at: 0.14 });
}

/**
 * The rolling cart's bell — two bright struck tones. `near` is 0..1 by proximity,
 * so a distant cart is a faint hint and a close one is a beacon; it is the only
 * way to know the merchant is on the floor at all.
 *
 * Its own per-NPC period timer stays in `entities/npc.ts` rather than moving to
 * `sfx/gate.ts` — a global keyed gate would be WRONG with two merchants on a
 * floor, because they are separate sound sources at different distances.
 */
export function sfxCartBell(near: number): void {
  const b = bus("monsters");
  if (!b) return;
  const vol = 0.03 + 0.11 * clamp01(near);
  beep(b, { type: "triangle", f0: 1568, f1: 1480, dur: 0.16, vol });
  beep(b, { type: "triangle", f0: 2093, f1: 1976, dur: 0.22, vol: vol * 0.7, at: 0.11 });
}
