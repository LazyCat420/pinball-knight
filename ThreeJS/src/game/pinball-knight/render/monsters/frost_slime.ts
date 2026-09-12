/**
 * FROST SLIME — a prismatic glacial crystal slime with jagged ice spines,
 * diamond facets, frozen cyan gel, and a momentum-deflecting crystal crust.
 */
import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  plateShaded,
  groundShadow,
  glow as figGlow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

// Palette Ramps
const R_ICE: Ramp = [29, 30, 31];       // Glacial cyan frost
const R_CRYSTAL: Ramp = [20, 21, 22];   // Pure white / steel crystal spikes
const R_DEEP: Ramp = [3, 4, 30];        // Deep cold blue core
const R_EYE: Ramp = [20, 30, 31];       // Shimmering crystalline eyes

function frostSlimeFrame(dir: Dir, squash: number, melt = 0, attacking = false): FramePaint {
  return (ctx) => {
    const spread = Math.round(22 + squash * 6 + melt * 15);
    const height = Math.round(24 - squash * 6 - melt * 15);
    const cy = GROUND - Math.round(height * 0.55);

    groundShadow(ctx, CX, GROUND + 2, Math.round(spread * 0.95));

    // Glacial chill aura
    figGlow(ctx, CX, cy, Math.round(spread * 0.8), 30, 31);

    // Deep cold core
    ellShaded(ctx, CX, cy, Math.round(spread * 0.8), Math.round(height * 0.8), R_DEEP);

    // Main translucent icy gel dome
    ellShaded(ctx, CX, cy, spread, height, R_ICE);

    // Jagged crystal spikes jutting from the crown & flanks
    if (melt < 0.6) {
      const topY = cy - Math.round(height * 0.5);
      // Center crown spike
      plateShaded(ctx, [
        [CX - 4, topY + 4],
        [CX, topY - 10],
        [CX + 4, topY + 4],
      ], R_CRYSTAL);

      // Left flank crystal spike
      plateShaded(ctx, [
        [CX - Math.round(spread * 0.65), cy - 2],
        [CX - Math.round(spread * 0.95), cy - 8],
        [CX - Math.round(spread * 0.5), cy + 4],
      ], R_CRYSTAL);

      // Right flank crystal spike
      plateShaded(ctx, [
        [CX + Math.round(spread * 0.65), cy - 2],
        [CX + Math.round(spread * 0.95), cy - 8],
        [CX + Math.round(spread * 0.5), cy + 4],
      ], R_CRYSTAL);
    }

    // Facet glint
    ellShaded(ctx, CX - Math.round(spread * 0.35), cy - Math.round(height * 0.35), 6, 4, R_CRYSTAL, 0, { rim: false });

    // Frozen ice shards at the base
    if (squash > 0.15 || melt > 0) {
      ellShaded(ctx, CX - Math.round(spread * 0.75), GROUND - 4, 5, 3, R_CRYSTAL, 0, { rim: false });
      ellShaded(ctx, CX + Math.round(spread * 0.7), GROUND - 3, 4, 3, R_CRYSTAL, 0, { rim: false });
    }

    // Frozen eyes
    if (melt < 0.6 && dir !== "N") {
      const ey = cy - Math.round(height * 0.1) + Math.round(melt * 8);
      const eyeR = attacking ? 4 : 3;
      ellShaded(ctx, CX - 7, ey, eyeR, eyeR + 1, R_EYE, 0, { rim: false });
      ellShaded(ctx, CX + 7, ey, eyeR, eyeR + 1, R_EYE, 0, { rim: false });
      // Inner glint
      figGlow(ctx, CX - 7, ey, 4, 30, 31);
      figGlow(ctx, CX + 7, ey, 4, 30, 31);
    }
  };
}

export function makeFrostSlimePaints(): ActorPaints {
  const dirClips = (dir: Dir) => ({
    idle: [frostSlimeFrame(dir, -0.2), frostSlimeFrame(dir, 0.25)],
    walk: [
      frostSlimeFrame(dir, -0.6),
      frostSlimeFrame(dir, 0.8),
      frostSlimeFrame(dir, -0.1),
      frostSlimeFrame(dir, 0.4),
    ],
    attack: [
      frostSlimeFrame(dir, -0.5, 0, true),
      frostSlimeFrame(dir, 0.9, 0, true),
    ],
    death: [
      frostSlimeFrame(dir, 0.6, 0.15),
      frostSlimeFrame(dir, 0.8, 0.4),
      frostSlimeFrame(dir, 1.0, 0.7),
      frostSlimeFrame(dir, 1.0, 1.0),
    ],
  });
  return { S: dirClips("S"), N: dirClips("N"), E: dirClips("E") };
}
