/**
 * LIGHTNING ROD — a planted stake that HUMS.
 *
 * The kind this replaces was already the odd one out in `updateFloorFx`: it got
 * its own early-return branch with a tight `sin(age * 11)` scale pulse instead of
 * the shared grow/breathe, because a stake is not a puddle. That distinction is
 * worth keeping, and it moves into the shader where it belongs — the CPU no
 * longer pulses the quad at all.
 *
 * Three terms, and each is doing a specific job the old radial gradient could not:
 *
 *   · **A hard pinpoint core** — `pow(1-r, 8)`. The rod is a POINT that things
 *     are earthed through, and a soft gradient centre reads as an area effect.
 *   · **A charged ring** at a fixed radius, humming at ~11Hz. Fast and shallow:
 *     a slow deep pulse reads as breathing (alive, organic), a fast shallow one
 *     reads as electrical (energised, mechanical). Same distinction the torch
 *     lights make with two out-of-phase sines instead of random flicker.
 *   · **Radial filaments** from angular noise, so the discharge has direction.
 *     They creep rather than strobe, because the rod is idling between zaps —
 *     the actual arc is `vfx.sparks` fired from the sim on each tick, and this
 *     is the thing that makes the player believe a zap is COMING.
 *
 * Additive, and colour scaled by its own field, for the reason in `fire.ts`.
 */
import { abs, atan, cos, float, length, pow, saturate, sin, smoothstep, uniform, vec3, vec4 } from "three/tsl";
import { bandRamp, discP, noise01 } from "./noise";
import { elementMaterial, type ElementMaterial } from "./element";

/** Arcane bright → steel highlight → flame core. The hottest thing on the floor. */
export const ROD_RAMP = [29, 31, 22, 18] as const;
const ROD_STOPS = [0.28, 0.60, 0.88] as const;

export function createRodMaterial(): ElementMaterial {
  const uTime = uniform(0);
  const uOpacity = uniform(1);
  const uIntensity = uniform(1);
  const uSeed = uniform(0);

  const material = elementMaterial(true); // the rod ADDS light

  const p = discP();
  const r = length(p);
  const t = uTime.add(uSeed);

  // The HUM: fast, shallow. Electrical, not organic.
  const hum = sin(t.mul(11.0)).mul(0.12).add(1.0);

  // A pinpoint, not a pool. The high exponent is the whole read.
  const core = pow(saturate(r.oneMinus()), float(8.0)).mul(hum);

  // The charged ring — a thin band at a fixed radius, breathing with the hum.
  const ringR = float(0.52).mul(hum);
  const ring = smoothstep(float(0.10), float(0.0), abs(r.sub(ringR))).mul(0.55);

  // Filaments: angular noise so they have direction and creep between zaps.
  const ang = atan(p.y, p.x);
  const fil = noise01(vec3(cos(ang).mul(3.0), sin(ang).mul(3.0), t.mul(0.9)))
    .mul(smoothstep(float(1.0), float(0.15), r))
    .mul(0.34);

  const charge = saturate(core.add(ring).add(fil).mul(uIntensity));

  const col = bandRamp(charge, ROD_RAMP, ROD_STOPS);
  const alpha = smoothstep(float(0.06), float(0.20), charge).mul(uOpacity);

  material.colorNode = vec4(col.mul(charge), alpha);

  return { material, uTime, uOpacity, uIntensity, uSeed, dispose: () => material.dispose() };
}
