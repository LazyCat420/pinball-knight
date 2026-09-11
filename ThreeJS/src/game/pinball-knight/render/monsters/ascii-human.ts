/**
 * ASCII BINARY HUMAN — a matrix-like humanoid monster composed entirely of
 * glowing green 0s and 1s.
 *
 * Emerges from CRT computer screens on Level 4. Swarms the player and attacks
 * with rapid binary punches. Infects and converts other monsters into new
 * ASCII humans on contact.
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
  punchT?: number;     // 0..1 punch forward
  deathT?: number;     // 0..1 collapsing de-rez
  dead?: boolean;
}

function asciiHumanFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { bob = 0, legPhase = 0, punchT = 0, deathT = 0, dead = false } = opts;

    if (dead || deathT > 0) {
      // Cascading de-rez dissolve into falling 0s and 1s on floor
      const t = Math.min(1, Math.max(0, deathT));
      const collapseY = GROUND - 6 + t * 4;

      groundShadow(ctx, CX, GROUND, Math.max(6, 20 * (1 - t * 0.7)));

      // Collapsing binary puddle
      ellShaded(ctx, CX, collapseY + 2, Math.max(8, 18 * (1 - t * 0.4)), Math.max(4, 8 * (1 - t * 0.4)), R_BODY_BASE);
      figGlow(ctx, CX, collapseY + 2, 12, 7, 8);

      // Scatted tumbling 0 and 1 glyphs
      ctx.fillStyle = "#00FF66";
      ctx.font = "bold 9px monospace";
      ctx.fillText("0", CX - 10 + t * 6, collapseY - 2);
      ctx.fillText("1", CX + 6 - t * 4, collapseY + 3);
      ctx.fillText("0", CX - 4, collapseY + 1);
      ctx.fillText("1", CX + 12, collapseY - 1);
      return;
    }

    groundShadow(ctx, CX, GROUND, 18);

    const torsoY = GROUND - 24 + bob;
    const legSwing = Math.sin(legPhase * Math.PI * 2) * 5;

    // Legs
    const leftLegX = CX - 5;
    const rightLegX = CX + 5;
    limbShaded(ctx, [leftLegX, torsoY + 12], [leftLegX - legSwing * 0.6, GROUND], 5, R_BODY_BASE);
    limbShaded(ctx, [rightLegX, torsoY + 12], [rightLegX + legSwing * 0.6, GROUND], 5, R_BODY_BASE);

    // Torso (Humanoid silhouette)
    ellShaded(ctx, CX, torsoY + 4, 11, 14, R_BODY_BASE);
    figGlow(ctx, CX, torsoY + 4, 10, 7, 8);

    // Head
    const headY = torsoY - 13;
    ellShaded(ctx, CX, headY, 8, 9, R_BODY_BASE);
    figGlow(ctx, CX, headY, 7, 7, 8);

    // Arms / Punches
    if (punchT > 0) {
      const punchReach = punchT * 12;
      const punchDir = dir === "E" ? 1 : dir === "S" ? (Math.sin(phase * 10) > 0 ? 1 : -1) : -1;
      // Extended punching arm
      limbShaded(ctx, [CX + 6 * punchDir, torsoY - 2], [CX + (14 + punchReach) * punchDir, torsoY], 4, R_GREEN_GLOW);
      // Punch fist burst
      figGlow(ctx, CX + (14 + punchReach) * punchDir, torsoY, 6, 8, 22);
      // Other arm tucked
      limbShaded(ctx, [CX - 6 * punchDir, torsoY - 2], [CX - 8 * punchDir, torsoY + 8], 4, R_BODY_BASE);
    } else {
      // Shuffling arms
      limbShaded(ctx, [CX - 8, torsoY - 2], [CX - 10 + legSwing * 0.5, torsoY + 8], 4, R_BODY_BASE);
      limbShaded(ctx, [CX + 8, torsoY - 2], [CX + 10 - legSwing * 0.5, torsoY + 8], 4, R_BODY_BASE);
    }

    // Binary matrix code texture overlay (0s and 1s drawn in bright green)
    ctx.fillStyle = "#33FF33";
    ctx.font = "bold 8px monospace";
    ctx.fillText("1", CX - 4, headY + 3);
    ctx.fillText("0", CX + 1, headY + 3);

    const f1 = (Math.floor(phase * 10) % 2 === 0) ? "1" : "0";
    const f2 = (f1 === "1") ? "0" : "1";
    ctx.fillText(f1, CX - 7, torsoY + 1);
    ctx.fillText(f2, CX - 1, torsoY + 1);
    ctx.fillText(f1, CX + 4, torsoY + 1);

    ctx.fillText(f2, CX - 5, torsoY + 9);
    ctx.fillText(f1, CX + 2, torsoY + 9);

    // Digital highlights / sparkles
    figDetail(ctx, [[CX - 1, torsoY - 1], [CX + 2, torsoY - 1]], 2, R_HIGHLIGHT);
  };
}

export function makeAsciiHumanPaints(): ActorPaints {
  const facings: Array<Dir> = ["S", "N", "E"];
  const out: Partial<ActorPaints> = {};

  for (const dir of facings) {
    out[dir] = {
      idle: [
        asciiHumanFrame(dir, 0.0, { bob: 0 }),
        asciiHumanFrame(dir, 0.25, { bob: -1 }),
        asciiHumanFrame(dir, 0.5, { bob: 0 }),
        asciiHumanFrame(dir, 0.75, { bob: 1 }),
      ],
      walk: [
        asciiHumanFrame(dir, 0.0, { bob: -1, legPhase: 0.0 }),
        asciiHumanFrame(dir, 0.25, { bob: 0, legPhase: 0.25 }),
        asciiHumanFrame(dir, 0.5, { bob: -1, legPhase: 0.5 }),
        asciiHumanFrame(dir, 0.75, { bob: 0, legPhase: 0.75 }),
      ],
      attack: [
        asciiHumanFrame(dir, 0.0, { punchT: 0.2 }),
        asciiHumanFrame(dir, 0.33, { punchT: 0.7 }),
        asciiHumanFrame(dir, 0.66, { punchT: 1.0 }),
        asciiHumanFrame(dir, 1.0, { punchT: 0.3 }),
      ],
      death: [
        asciiHumanFrame(dir, 0.0, { deathT: 0.2 }),
        asciiHumanFrame(dir, 0.33, { deathT: 0.5 }),
        asciiHumanFrame(dir, 0.66, { deathT: 0.8 }),
        asciiHumanFrame(dir, 1.0, { dead: true, deathT: 1.0 }),
      ],
    };
  }

  return out as ActorPaints;
}
