/**
 * MAGMA SLIME — a molten volcanic fire gel with floating obsidian crust plates,
 * a glowing flame core, and dripping fiery magma drops.
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
const R_MAGMA: Ramp = [14, 15, 18];    // Molten orange/red core
const R_CRUST: Ramp = [10, 11, 12];    // Dark volcanic obsidian crust chunks
const R_CORE: Ramp = [16, 17, 18];     // Bright yellow flame interior
const R_EYE: Ramp = [18, 17, 16];      // Incandescent flame eyes

function magmaSlimeFrame(dir: Dir, squash: number, melt = 0, attacking = false): FramePaint {
  return (ctx) => {
    const spread = Math.round(22 + squash * 7 + melt * 16);
    const height = Math.round(24 - squash * 7 - melt * 16);
    const cy = GROUND - Math.round(height * 0.55);

    groundShadow(ctx, CX, GROUND + 2, Math.round(spread * 0.95));

    // Molten core ambient glow
    figGlow(ctx, CX, cy, Math.round(spread * 0.8), 16, 17);

    // Main molten slime dome
    ellShaded(ctx, CX, cy, spread, height, R_MAGMA);

    // Dark volcanic obsidian crust plates floating on the surface
    if (melt < 0.7) {
      const crustY1 = cy - Math.round(height * 0.25);
      const crustY2 = cy + Math.round(height * 0.15);
      ellShaded(ctx, CX - Math.round(spread * 0.45), crustY1, 6, 4, R_CRUST);
      ellShaded(ctx, CX + Math.round(spread * 0.4), crustY1 - 2, 7, 5, R_CRUST);
      ellShaded(ctx, CX - Math.round(spread * 0.2), crustY2, 5, 4, R_CRUST);
      ellShaded(ctx, CX + Math.round(spread * 0.35), crustY2 + 1, 6, 4, R_CRUST);
    }

    // Droplets / magma goop puddling at base
    if (squash > 0.15 || melt > 0) {
      ellShaded(ctx, CX - Math.round(spread * 0.75), GROUND - 4, 5, 3, R_MAGMA, 0, { rim: false });
      ellShaded(ctx, CX + Math.round(spread * 0.7), GROUND - 3, 4, 3, R_MAGMA, 0, { rim: false });
      // Little hot embers
      ellShaded(ctx, CX - Math.round(spread * 0.85), GROUND - 6, 3, 3, R_CORE, 0, { rim: false });
    }

    // Incandescent molten eyes (facing forward/side)
    if (melt < 0.6 && dir !== "N") {
      const ey = cy - Math.round(height * 0.1) + Math.round(melt * 8);
      const eyeR = attacking ? 4 : 3;
      ellShaded(ctx, CX - 7, ey, eyeR, eyeR + 1, R_EYE, 0, { rim: false });
      ellShaded(ctx, CX + 7, ey, eyeR, eyeR + 1, R_EYE, 0, { rim: false });
      // Eye glow pupils
      figGlow(ctx, CX - 7, ey, 5, 17, 18);
      figGlow(ctx, CX + 7, ey, 5, 17, 18);
    }
  };
}

export function makeMagmaSlimePaints(): ActorPaints {
  const dirClips = (dir: Dir) => ({
    idle: [magmaSlimeFrame(dir, -0.2), magmaSlimeFrame(dir, 0.25)],
    walk: [
      magmaSlimeFrame(dir, -0.6),
      magmaSlimeFrame(dir, 0.8),
      magmaSlimeFrame(dir, -0.1),
      magmaSlimeFrame(dir, 0.4),
    ],
    attack: [
      magmaSlimeFrame(dir, -0.5, 0, true),
      magmaSlimeFrame(dir, 0.9, 0, true),
    ],
    death: [
      magmaSlimeFrame(dir, 0.6, 0.15),
      magmaSlimeFrame(dir, 0.8, 0.4),
      magmaSlimeFrame(dir, 1.0, 0.7),
      magmaSlimeFrame(dir, 1.0, 1.0),
    ],
  });
  return { S: dirClips("S"), N: dirClips("N"), E: dirClips("E") };
}
