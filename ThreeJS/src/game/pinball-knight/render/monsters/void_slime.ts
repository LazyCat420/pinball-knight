/**
 * VOID SLIME — a cosmic obsidian/violet void gel entity with orbiting stellar
 * sparks, a pulsating singularity eye, and gravitational distortion ripples.
 */
import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  groundShadow,
  glow as figGlow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

// Palette Ramps
const R_VOID: Ramp = [0, 1, 19];         // Deep obsidian / dark cosmic violet
const R_SINGULARITY: Ramp = [19, 29, 30]; // Vibrant astral violet/cyan core
const R_STAR: Ramp = [20, 21, 22];       // White celestial stellar sparks
const R_ORBIT: Ramp = [19, 30, 31];      // Swirling gravity rim

function voidSlimeFrame(dir: Dir, squash: number, melt = 0, attacking = false): FramePaint {
  return (ctx) => {
    // When melting (collapsing into a singularity), it actually shrinks and condenses inward!
    const collapse = melt * 8;
    const spread = Math.max(8, Math.round(23 + squash * 6 - collapse));
    const height = Math.max(8, Math.round(24 - squash * 6 - collapse));
    const cy = GROUND - Math.round(height * 0.55);

    groundShadow(ctx, CX, GROUND + 2, Math.round(spread * 0.95));

    // Gravitational distortion aura
    figGlow(ctx, CX, cy, Math.round(spread * 0.85), 19, 30);

    // Singularity outer rim
    ellShaded(ctx, CX, cy, spread, height, R_VOID);

    // Swirling cosmic galaxy center
    const coreR = Math.max(4, Math.round(spread * 0.45));
    ellShaded(ctx, CX, cy, coreR, Math.round(coreR * 0.85), R_SINGULARITY);

    // Stellar sparks floating in the void body
    if (melt < 0.6) {
      ellShaded(ctx, CX - Math.round(spread * 0.45), cy - Math.round(height * 0.25), 3, 3, R_STAR, 0, { rim: false });
      ellShaded(ctx, CX + Math.round(spread * 0.4), cy + Math.round(height * 0.15), 3, 3, R_STAR, 0, { rim: false });
      ellShaded(ctx, CX - Math.round(spread * 0.2), cy + Math.round(height * 0.3), 4, 3, R_STAR, 0, { rim: false });
      ellShaded(ctx, CX + Math.round(spread * 0.35), cy - Math.round(height * 0.3), 3, 3, R_STAR, 0, { rim: false });
    }

    // Swirling gravity base drips
    if (squash > 0.15 || melt > 0) {
      ellShaded(ctx, CX - Math.round(spread * 0.7), GROUND - 4, 5, 3, R_VOID, 0, { rim: false });
      ellShaded(ctx, CX + Math.round(spread * 0.65), GROUND - 3, 4, 3, R_VOID, 0, { rim: false });
    }

    // Singular cosmic all-seeing eye
    if (melt < 0.7 && dir !== "N") {
      const ey = cy - Math.round(height * 0.05);
      const eyeR = attacking ? 5 : 4;
      ellShaded(ctx, CX, ey, eyeR, eyeR + 1, R_ORBIT, 0, { rim: false });
      // Black hole center pupil
      ellShaded(ctx, CX, ey, 2, 2, 0, 0, { rim: false, ink: 0 });
      figGlow(ctx, CX, ey, 6, 30, 31);
    }
  };
}

export function makeVoidSlimePaints(): ActorPaints {
  const dirClips = (dir: Dir) => ({
    idle: [voidSlimeFrame(dir, -0.2), voidSlimeFrame(dir, 0.25)],
    walk: [
      voidSlimeFrame(dir, -0.6),
      voidSlimeFrame(dir, 0.8),
      voidSlimeFrame(dir, -0.1),
      voidSlimeFrame(dir, 0.4),
    ],
    attack: [
      voidSlimeFrame(dir, -0.5, 0, true),
      voidSlimeFrame(dir, 0.9, 0, true),
    ],
    death: [
      voidSlimeFrame(dir, 0.4, 0.2),
      voidSlimeFrame(dir, 0.6, 0.5),
      voidSlimeFrame(dir, 0.8, 0.8),
      voidSlimeFrame(dir, 1.0, 1.0),
    ],
  });
  return { S: dirClips("S"), N: dirClips("N"), E: dirClips("E") };
}
