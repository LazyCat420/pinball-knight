/**
 * COMBAT — swinging, connecting, taking it, and things coming apart.
 *
 * Serves all 9 call sites in `entities/combat.ts` plus `secrets.ts`,
 * `run/grave-hole.ts` and `economy/tavern-shop.ts`. The category split follows
 * where the game reaches for a sound, not what the sound is like, so a dev
 * editing `entities/combat.ts` looks in `sfx/combat.ts`.
 *
 * `sfxHeavy` is reused well outside melee — a gravestone cracking, a secret wall
 * smashing — because a heavy dry impact is a heavy dry impact. That reuse is why
 * it stays here rather than moving somewhere more specific.
 */
import { bus } from "./bus";
import { beep, burst } from "./synth";

/** Sword swing — a fast air whoosh. */
export function sfxSwing(): void {
  const b = bus("combat");
  if (!b) return;
  burst(b, 0.09, 0.12, "bandpass", 1600);
  beep(b, { type: "square", f0: 330, f1: 140, dur: 0.08, vol: 0.05 });
}

/** Heavy swing — a slower, weightier whoosh than a light swing. */
export function sfxHeavy(): void {
  const b = bus("combat");
  if (!b) return;
  burst(b, 0.16, 0.16, "bandpass", 1100);
  beep(b, { type: "square", f0: 260, f1: 90, dur: 0.14, vol: 0.08 });
}

/** Blade connects with something rotten. */
export function sfxHit(): void {
  const b = bus("combat");
  if (!b) return;
  burst(b, 0.1, 0.2, "lowpass", 900);
  beep(b, { type: "square", f0: 190, f1: 70, dur: 0.11, vol: 0.14 });
}

/** You got bitten. */
export function sfxHurt(): void {
  const b = bus("combat");
  if (!b) return;
  beep(b, { type: "square", f0: 220, f1: 110, dur: 0.09, vol: 0.16 });
  beep(b, { type: "square", f0: 165, f1: 82, dur: 0.12, vol: 0.14, at: 0.07 });
}

/** Something you owned just fell apart — a dry crack and clatter. */
export function sfxBreak(): void {
  const b = bus("combat");
  if (!b) return;
  burst(b, 0.08, 0.22, "highpass", 1800);
  burst(b, 0.16, 0.12, "bandpass", 700, 0.05);
  beep(b, { type: "square", f0: 140, f1: 60, dur: 0.12, vol: 0.1, at: 0.03 });
}
