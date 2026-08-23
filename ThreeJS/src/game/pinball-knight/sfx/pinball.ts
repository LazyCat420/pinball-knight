/**
 * PINBALL — the machine: bumpers, springs, spin pads, targets, and rolling.
 *
 * The densest category by far. It serves all 18 call sites in
 * `entities/pinball-collide.ts` — one import line replaces the seven-name import
 * that file used to carry — plus `shots.ts`, `coop.ts`, `entities/marble.ts`,
 * `entities/ricochet-form.ts` and the player's momentum paths.
 *
 * That density is also why the category bus in `bus.ts` exists: if the machine
 * ever needs to come down 2dB relative to combat, this is one number rather than
 * five scattered literals.
 */
import { bus } from "./bus";
import { beep, burst } from "./synth";

/** Pop bumper — a bright arcade PING that rises with a slight random pitch. */
export function sfxBumper(): void {
  const b = bus("pinball");
  if (!b) return;
  const p = 0.94 + Math.random() * 0.12;
  beep(b, { type: "square", f0: 620 * p, f1: 980 * p, dur: 0.08, vol: 0.09 });
  beep(b, { type: "sine", f0: 1240 * p, f1: 1240 * p, dur: 0.05, vol: 0.05 });
}

/** Spring/plunger — a rubbery BOING: a fast down-up pitch flick. */
export function sfxSpring(): void {
  const b = bus("pinball");
  if (!b) return;
  beep(b, { type: "triangle", f0: 180, f1: 640, dur: 0.16, vol: 0.1 });
  beep(b, { type: "sine", f0: 90, f1: 320, dur: 0.12, vol: 0.06 });
}

/** Spin pad — a rising slot-machine whirl. */
export function sfxSpin(): void {
  const b = bus("pinball");
  if (!b) return;
  beep(b, { type: "square", f0: 220, f1: 880, dur: 0.16, vol: 0.16 });
  beep(b, { type: "square", f0: 330, f1: 1320, dur: 0.14, vol: 0.1, at: 0.05 });
}

/** Target bullseye — a bright double DING. */
export function sfxTarget(): void {
  const b = bus("pinball");
  if (!b) return;
  beep(b, { type: "triangle", f0: 1320, dur: 0.08, vol: 0.2 });
  beep(b, { type: "triangle", f0: 1760, dur: 0.12, vol: 0.16, at: 0.07 });
}

/**
 * Dodge-roll AND rolling momentum — a low, quick body whoosh: filtered noise
 * sweeping down. The pitch is jittered ±8% per roll so a flurry of dodges doesn't
 * machine-gun the exact same sample.
 *
 * It lives in `pinball` rather than `combat` on a count: six of its ten call
 * sites are momentum (the rail ride, the bounce, the intro) against four dodge
 * sites. Timbrally it is a body whoosh; by usage it is the ball moving.
 */
export function sfxRoll(): void {
  const b = bus("pinball");
  if (!b) return;
  const p = 0.92 + Math.random() * 0.16; // 0.92..1.08
  burst(b, 0.16, 0.11, "lowpass", 700 * p);
  beep(b, { type: "sine", f0: 260 * p, f1: 90 * p, dur: 0.14, vol: 0.05 });
}
