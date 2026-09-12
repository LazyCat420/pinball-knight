/**
 * TOXIC SLIME — a bubbling translucent neon rot-green acidic ooze with
 * caustic pustules, glowing yellow eyes, and corrosive dripping sludge.
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
const R_ACID: Ramp = [6, 7, 9];         // Neon caustic rot-green
const R_PUSTULE: Ramp = [8, 9, 7];      // Bubbling acidic pustules
const R_GLOSS: Ramp = [20, 21, 22];     // Wet highlight gloss
const R_EYE: Ramp = [16, 17, 18];       // Acid-yellow irises

function toxicSlimeFrame(dir: Dir, squash: number, melt = 0, attacking = false): FramePaint {
  return (ctx) => {
    const spread = Math.round(20 + squash * 6 + melt * 15);
    const height = Math.round(22 - squash * 6 - melt * 15);
    const cy = GROUND - Math.round(height * 0.55);

    groundShadow(ctx, CX, GROUND + 2, Math.round(spread * 0.95));

    // Caustic acid ambient green glow
    figGlow(ctx, CX, cy, Math.round(spread * 0.75), 8, 9);

    // Main toxic gel dome
    ellShaded(ctx, CX, cy, spread, height, R_ACID);

    // Bubbling caustic pustules along top & sides
    if (melt < 0.7) {
      const pustuleY1 = cy - Math.round(height * 0.35);
      const pustuleY2 = cy - Math.round(height * 0.15);
      ellShaded(ctx, CX - Math.round(spread * 0.3), pustuleY1, 5, 4, R_PUSTULE);
      ellShaded(ctx, CX + Math.round(spread * 0.25), pustuleY1 - 1, 4, 4, R_PUSTULE);
      ellShaded(ctx, CX - Math.round(spread * 0.5), pustuleY2, 4, 3, R_PUSTULE);
      ellShaded(ctx, CX + Math.round(spread * 0.45), pustuleY2, 5, 4, R_PUSTULE);
    }

    // Wet acid gloss shine
    ellShaded(ctx, CX - Math.round(spread * 0.3), cy - Math.round(height * 0.4), 6, 3, R_GLOSS, 0, { rim: false });

    // Acidic sludge drips at base
    if (squash > 0.15 || melt > 0) {
      ellShaded(ctx, CX - Math.round(spread * 0.75), GROUND - 4, 5, 3, R_ACID, 0, { rim: false });
      ellShaded(ctx, CX + Math.round(spread * 0.7), GROUND - 3, 4, 3, R_ACID, 0, { rim: false });
      ellShaded(ctx, CX + Math.round(spread * 0.85), GROUND - 2, 3, 3, R_PUSTULE, 0, { rim: false });
    }

    // Acid eyes
    if (melt < 0.6 && dir !== "N") {
      const ey = cy - Math.round(height * 0.1) + Math.round(melt * 8);
      const eyeR = attacking ? 4 : 3;
      ellShaded(ctx, CX - 6, ey, eyeR, eyeR + 1, R_EYE, 0, { rim: false });
      ellShaded(ctx, CX + 6, ey, eyeR, eyeR + 1, R_EYE, 0, { rim: false });
      // Inner pupils
      ellShaded(ctx, CX - 6, ey, 2, 2, 1, 0, { rim: false, ink: 1 });
      ellShaded(ctx, CX + 6, ey, 2, 2, 1, 0, { rim: false, ink: 1 });
    }
  };
}

export function makeToxicSlimePaints(): ActorPaints {
  const dirClips = (dir: Dir) => ({
    idle: [toxicSlimeFrame(dir, -0.2), toxicSlimeFrame(dir, 0.25)],
    walk: [
      toxicSlimeFrame(dir, -0.6),
      toxicSlimeFrame(dir, 0.8),
      toxicSlimeFrame(dir, -0.1),
      toxicSlimeFrame(dir, 0.4),
    ],
    attack: [
      toxicSlimeFrame(dir, -0.5, 0, true),
      toxicSlimeFrame(dir, 0.9, 0, true),
    ],
    death: [
      toxicSlimeFrame(dir, 0.6, 0.15),
      toxicSlimeFrame(dir, 0.8, 0.4),
      toxicSlimeFrame(dir, 1.0, 0.7),
      toxicSlimeFrame(dir, 1.0, 1.0),
    ],
  });
  return { S: dirClips("S"), N: dirClips("N"), E: dirClips("E") };
}
