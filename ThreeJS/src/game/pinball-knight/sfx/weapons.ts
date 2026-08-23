/**
 * WEAPONS — the ranged kit and the freeze ray.
 *
 * These four are the ones `entities/player.ts:620` dispatches between by weapon
 * id, so keeping them in one module makes that dispatch a single import.
 *
 * `sfxFlame` is the most-reused sting in the game and the reason `sfx/gate.ts`
 * insists a throttle belongs at the CALL SITE: it is the player's flamethrower,
 * the fire vent hazard, AND the lava marble transform. Gating it in here to calm
 * the vent would silence the weapon.
 */
import { bus } from "./bus";
import { beep, burst } from "./synth";

/** Gunshot — a sharp crack with a low thump under it. */
export function sfxGun(): void {
  const b = bus("weapons");
  if (!b) return;
  burst(b, 0.05, 0.3, "highpass", 2200);
  burst(b, 0.12, 0.18, "lowpass", 600);
  beep(b, { type: "square", f0: 220, f1: 60, dur: 0.09, vol: 0.12 });
}

/** Bowstring — a taut twang and the arrow's hiss. */
export function sfxBow(): void {
  const b = bus("weapons");
  if (!b) return;
  beep(b, { type: "triangle", f0: 480, f1: 180, dur: 0.12, vol: 0.14 });
  burst(b, 0.14, 0.08, "bandpass", 3000, 0.02);
}

/** Flamethrower puff — a soft roar. Fired per trigger tick, so it's kept short and quiet. */
export function sfxFlame(): void {
  const b = bus("weapons");
  if (!b) return;
  burst(b, 0.12, 0.07, "lowpass", 900);
  burst(b, 0.09, 0.04, "bandpass", 1700, 0.01);
}

/** Freeze ray — a crystalline downward shimmer. */
export function sfxFreeze(): void {
  const b = bus("weapons");
  if (!b) return;
  beep(b, { type: "triangle", f0: 1760, f1: 440, dur: 0.5, vol: 0.14 });
  burst(b, 0.4, 0.06, "highpass", 3000, 0.05);
}
