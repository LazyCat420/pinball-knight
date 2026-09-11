/**
 * GIANT ASCII TITAN — a massive, towering colossus composed entirely of
 * glowing matrix green 0s and 1s.
 *
 * Formed when a quorum of ASCII Binary Humans merge together. Smashes the
 * stone ground with both massive binary fists, creating radiating fissures,
 * shockwave rings, screen shake, and radial knockback.
 *
 * Procedural fallback cel-painter parameterised by (dir, phase, opts).
 */
import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  limbShaded,
  detail as figDetail,
  glow as figGlow,
  groundShadow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

// Matrix Green Phosphor Ramps:
const R_BODY_BASE: Ramp = [17, 18, 19]; // Dark silhouette base
const R_GREEN_GLOW: Ramp = [6, 7, 8];   // Vibrant matrix terminal green
const R_HIGHLIGHT: Ramp = [7, 8, 22];   // Bright phosphor green/white

interface PoseOpts {
  bob?: number;
  legPhase?: number;
  smashT?: number;     // 0..1 double-fist ground smash
  deathT?: number;     // 0..1 collapsing de-rez
  dead?: boolean;
}

function giantAsciiHumanFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { bob = 0, legPhase = 0, smashT = 0, deathT = 0, dead = false } = opts;

    if (dead || deathT > 0) {
      // Catastrophic de-rez dissolve into tumbling 0s and 1s and collapsing matrix pool
      const t = Math.min(1, Math.max(0, deathT));
      const collapseY = GROUND - 10 + t * 8;

      groundShadow(ctx, CX, GROUND, Math.max(12, 36 * (1 - t * 0.7)));

      // Collapsing binary titan puddle
      ellShaded(ctx, CX, collapseY + 4, Math.max(16, 32 * (1 - t * 0.4)), Math.max(8, 14 * (1 - t * 0.4)), R_BODY_BASE);
      figGlow(ctx, CX, collapseY + 4, 20, 7, 8);

      // Cascading tumbling 0s, 1s, and matrix brackets
      ctx.fillStyle = "#00FF66";
      ctx.font = "bold 13px monospace";
      ctx.fillText("0", CX - 18 + t * 10, collapseY - 8);
      ctx.fillText("1", CX + 14 - t * 8, collapseY + 2);
      ctx.fillText("1", CX - 8, collapseY - 2);
      ctx.fillText("0", CX + 22, collapseY - 6);
      ctx.fillText("#", CX - 24, collapseY + 4);
      ctx.fillText("[01]", CX + 4, collapseY + 6);
      return;
    }

    groundShadow(ctx, CX, GROUND, 32);

    const torsoY = GROUND - 38 + bob;
    const legSwing = Math.sin(legPhase * Math.PI * 2) * 8;

    // Massive Legs
    const leftLegX = CX - 10;
    const rightLegX = CX + 10;
    limbShaded(ctx, [leftLegX, torsoY + 18], [leftLegX - legSwing * 0.5, GROUND], 9, R_BODY_BASE);
    limbShaded(ctx, [rightLegX, torsoY + 18], [rightLegX + legSwing * 0.5, GROUND], 9, R_BODY_BASE);

    // Broad Muscular Torso (Titan silhouette)
    ellShaded(ctx, CX, torsoY + 6, 20, 24, R_BODY_BASE);
    figGlow(ctx, CX, torsoY + 6, 18, 7, 8);

    // Head with glowing green digital eyes
    const headY = torsoY - 20;
    ellShaded(ctx, CX, headY, 13, 14, R_BODY_BASE);
    figGlow(ctx, CX, headY, 11, 7, 8);
    // Glowing eyes
    figDetail(ctx, [[CX - 5, headY - 1], [CX - 2, headY - 1]], 3, R_HIGHLIGHT);
    figDetail(ctx, [[CX + 2, headY - 1], [CX + 5, headY - 1]], 3, R_HIGHLIGHT);

    // Massive Binary Arms & Fists
    if (smashT > 0) {
      if (smashT < 0.6) {
        // Windup: Both fists locked high overhead
        const raise = smashT / 0.6;
        const fistY = torsoY - 26 - raise * 8;
        limbShaded(ctx, [CX - 16, torsoY - 6], [CX - 8, fistY], 8, R_GREEN_GLOW);
        limbShaded(ctx, [CX + 16, torsoY - 6], [CX + 8, fistY], 8, R_GREEN_GLOW);
        // Twin overhead glowing fists
        ellShaded(ctx, CX - 8, fistY, 7, 7, R_GREEN_GLOW);
        ellShaded(ctx, CX + 8, fistY, 7, 7, R_GREEN_GLOW);
        figGlow(ctx, CX, fistY, 14, 8, 22);
      } else {
        // Slam down: Fists smashing the ground!
        const slamProgress = (smashT - 0.6) / 0.4;
        const fistY = torsoY - 10 + slamProgress * 36;
        limbShaded(ctx, [CX - 16, torsoY - 4], [CX - 10, fistY], 8, R_GREEN_GLOW);
        limbShaded(ctx, [CX + 16, torsoY - 4], [CX + 10, fistY], 8, R_GREEN_GLOW);
        ellShaded(ctx, CX - 10, fistY, 8, 8, R_HIGHLIGHT);
        ellShaded(ctx, CX + 10, fistY, 8, 8, R_HIGHLIGHT);
        // Impact dust and shockwave sparks at ground
        figGlow(ctx, CX, GROUND, 24, 8, 22);
      }
    } else {
      // Stomping arms swing
      limbShaded(ctx, [CX - 16, torsoY - 4], [CX - 18 + legSwing * 0.4, torsoY + 16], 7, R_BODY_BASE);
      limbShaded(ctx, [CX + 16, torsoY - 4], [CX + 18 - legSwing * 0.4, torsoY + 16], 7, R_BODY_BASE);
      // Resting fists
      ellShaded(ctx, CX - 18 + legSwing * 0.4, torsoY + 18, 7, 7, R_GREEN_GLOW);
      ellShaded(ctx, CX + 18 - legSwing * 0.4, torsoY + 18, 7, 7, R_GREEN_GLOW);
    }

    // Dense cascading binary code streaks
    figDetail(ctx, [[CX - 12, torsoY - 4], [CX - 4, torsoY - 4]], 3, R_HIGHLIGHT);
    figDetail(ctx, [[CX + 2, torsoY - 4], [CX + 10, torsoY - 4]], 3, R_GREEN_GLOW);
    figDetail(ctx, [[CX - 8, torsoY + 8], [CX + 6, torsoY + 8]], 3, R_HIGHLIGHT);
    figDetail(ctx, [[CX - 10, torsoY + 18], [CX + 2, torsoY + 18]], 3, R_GREEN_GLOW);
  };
}

export function makeGiantAsciiHumanPaints(): ActorPaints {
  const facings: Array<Dir> = ["S", "N", "E"];
  const out: Partial<ActorPaints> = {};

  for (const dir of facings) {
    out[dir] = {
      idle: [
        giantAsciiHumanFrame(dir, 0.0, { bob: 0 }),
        giantAsciiHumanFrame(dir, 0.25, { bob: -1 }),
        giantAsciiHumanFrame(dir, 0.5, { bob: -2 }),
        giantAsciiHumanFrame(dir, 0.75, { bob: -1 }),
      ],
      walk: [
        giantAsciiHumanFrame(dir, 0.0, { legPhase: 0.0, bob: 0 }),
        giantAsciiHumanFrame(dir, 0.25, { legPhase: 0.25, bob: -2 }),
        giantAsciiHumanFrame(dir, 0.5, { legPhase: 0.5, bob: 0 }),
        giantAsciiHumanFrame(dir, 0.75, { legPhase: 0.75, bob: -2 }),
      ],
      attack: [
        giantAsciiHumanFrame(dir, 0.0, { smashT: 0.2, bob: -1 }),
        giantAsciiHumanFrame(dir, 0.33, { smashT: 0.55, bob: -3 }),
        giantAsciiHumanFrame(dir, 0.66, { smashT: 0.85, bob: 2 }),
        giantAsciiHumanFrame(dir, 1.0, { smashT: 1.0, bob: 3 }),
      ],
      death: [
        giantAsciiHumanFrame(dir, 0.0, { deathT: 0.2 }),
        giantAsciiHumanFrame(dir, 0.33, { deathT: 0.5 }),
        giantAsciiHumanFrame(dir, 0.66, { deathT: 0.8 }),
        giantAsciiHumanFrame(dir, 1.0, { deathT: 1.0, dead: true }),
      ],
    };
  }

  return out as ActorPaints;
}
