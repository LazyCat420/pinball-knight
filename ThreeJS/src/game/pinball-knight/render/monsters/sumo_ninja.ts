/**
 * DRUNK SUMO NINJA — a fat, rotund sumo wrestler in ninja attire.
 * Stumbles erratically in a drunken stupor, wobbles off-balance,
 * and flings spinning metallic ninja stars (shurikens) when stumbling.
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

// Palette ramps:
// Peach/tan flesh:
const R_SKIN: Ramp = [2, 3, 4];
const R_SKIN_DK: Ramp = [1, 2, 3];
// Black/charcoal ninja cowl, hood, and mawashi:
const R_NINJA: Ramp = [0, 1, 18];
const R_NINJA_HI: Ramp = [1, 18, 19];
// Drunken flushed red cheeks and headband accent:
const R_RED: Ramp = [10, 11, 12];
// Metallic steel for shurikens:
const R_STEEL: Ramp = [18, 19, 21];
// Ceramic sake gourd / bottle:
const R_SAKE: Ramp = [13, 14, 15];
// Dizzy stars:
const R_DIZZY: Ramp = [15, 16, 22];

interface PoseOpts {
  sway?: number;
  stumbleTilt?: number;
  throwing?: boolean;
  throwT?: number; // 0..1
  deathT?: number; // 0..1
  dead?: boolean;
}

function sumoNinjaFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { sway = 0, stumbleTilt = 0, throwing = false, throwT = 0, deathT = 0, dead = false } = opts;

    if (dead || deathT > 0) {
      // Belly flop crash & dizzy stars knockout
      const t = Math.min(1, Math.max(0, deathT));
      const crashY = GROUND - 4 + t * 4;
      const bodyW = 38 * (1 + t * 0.25);
      const bodyH = Math.max(12, 28 * (1 - t * 0.5));

      groundShadow(ctx, CX, GROUND + 2, 36 * (1 + t * 0.2));

      // Dizzy spinning stars above head before collapse
      if (t < 0.8) {
        const starAngle = phase * 6;
        for (let i = 0; i < 3; i++) {
          const a = starAngle + (i * Math.PI * 2) / 3;
          const sx = CX + Math.cos(a) * 16;
          const sy = crashY - bodyH - 10 + Math.sin(a) * 5;
          figDetail(ctx, [[sx, sy]], 2.5, R_DIZZY[1]);
          figGlow(ctx, sx, sy, 4, 15);
        }
      }

      // Flat belly-flopped rotund body
      ellShaded(ctx, CX + (dir === "E" ? 6 : -6) * t, crashY - bodyH * 0.5, bodyW, bodyH, R_SKIN);
      // Mawashi belt wrapped around waist
      ellShaded(ctx, CX, crashY - bodyH * 0.45, bodyW * 0.75, bodyH * 0.35, R_NINJA);
      // Head flat against floor
      const headX = CX + (dir === "E" ? 18 : -18);
      ellShaded(ctx, headX, crashY - 8, 14, 12, R_NINJA);
      // Flushed cheeks
      figDetail(ctx, [[headX - 3, crashY - 7], [headX + 3, crashY - 7]], 2, R_RED[1]);
      return;
    }

    // Live pose calculations
    const baseBob = Math.sin(phase * 4) * 2;
    const footStride = Math.sin(phase * 6) * 5;
    const bodyY = GROUND - 22 + baseBob;
    const leanX = CX + sway * 6 + stumbleTilt * 8;

    groundShadow(ctx, CX, GROUND + 2, 24 + Math.abs(sway) * 4);

    // Chunky sumo legs
    const legL_X = CX - 10 + footStride * 0.6;
    const legR_X = CX + 10 - footStride * 0.6;
    limbShaded(ctx, [CX - 8, bodyY + 10], [legL_X, GROUND - 1], 6, R_SKIN);
    limbShaded(ctx, [CX + 8, bodyY + 10], [legR_X, GROUND - 1], 6, R_SKIN);

    // Massive rotund belly & torso
    ellShaded(ctx, leanX, bodyY, 34, 28, R_SKIN);

    // Sumo mawashi (black belt & loincloth)
    ellShaded(ctx, leanX, bodyY + 8, 30, 10, R_NINJA);
    figDetail(ctx, [[leanX, bodyY + 11]], 4, R_NINJA_HI[1]);

    // Ninja hood & mask covering head
    const headY = bodyY - 18;
    const headX = leanX + (dir === "E" ? 3 : -3);
    ellShaded(ctx, headX, headY, 18, 16, R_NINJA);

    // Topknot (chonmage) on top of cowl
    ellShaded(ctx, headX, headY - 9, 6, 5, R_NINJA_HI);

    // Exposed squinting drunk eyes and flushed pink/red cheeks
    if (dir !== "N") {
      // Eye slit
      figDetail(ctx, [[headX - 3, headY - 1], [headX + 3, headY - 1]], 1.5, R_SKIN[2]);
      // Flushed drunken cheeks
      figDetail(ctx, [[headX - 5, headY + 3], [headX + 5, headY + 3]], 2.5, R_RED[1]);
    }

    // Sake gourd on hip
    const gourdX = leanX - 16;
    const gourdY = bodyY + 4;
    ellShaded(ctx, gourdX, gourdY, 7, 9, R_SAKE);
    ellShaded(ctx, gourdX, gourdY - 5, 4, 4, R_SAKE);
    figDetail(ctx, [[gourdX, gourdY - 2]], 2, R_RED[1]); // red cord wrap

    // Arms & Shuriken throwing action
    if (throwing || throwT > 0) {
      const armExt = Math.sin(throwT * Math.PI) * 14;
      const throwDirX = dir === "E" ? 1 : -1;
      const handX = leanX + (12 + armExt) * throwDirX;
      const handY = bodyY - 2 - Math.sin(throwT * Math.PI) * 6;

      // Throwing arm extended
      limbShaded(ctx, [leanX + 10 * throwDirX, bodyY - 6], [handX, handY], 5, R_SKIN);
      // Wrist wrap
      figDetail(ctx, [[handX - 2 * throwDirX, handY]], 3, R_NINJA[1]);

      // Thrown spinning metallic shuriken (ninja star)
      if (throwT > 0.1 && throwT < 0.9) {
        const starDist = throwT * 26;
        const starX = handX + starDist * throwDirX;
        const starY = handY - 2;
        // 4-point star glint
        figDetail(
          ctx,
          [
            [starX, starY],
            [starX - 3, starY],
            [starX + 3, starY],
            [starX, starY - 3],
            [starX, starY + 3],
          ],
          2,
          R_STEEL[1]
        );
        figGlow(ctx, starX, starY, 6, 19);
      }

      // Off arm balancing drunken stumble
      limbShaded(ctx, [leanX - 10 * throwDirX, bodyY - 4], [leanX - 16 * throwDirX, bodyY + 8], 4, R_SKIN);
    } else {
      // Clumsy swinging arms during walk/idle
      const armSwing = Math.cos(phase * 6) * 6;
      limbShaded(ctx, [leanX - 14, bodyY - 4], [leanX - 18, bodyY + 6 + armSwing], 4.5, R_SKIN);
      limbShaded(ctx, [leanX + 14, bodyY - 4], [leanX + 18, bodyY + 6 - armSwing], 4.5, R_SKIN);
    }
  };
}

export function makeSumoNinjaPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [
      sumoNinjaFrame(dir, 0, { sway: 0 }),
      sumoNinjaFrame(dir, 1, { sway: 0.3 }),
      sumoNinjaFrame(dir, 2, { sway: 0 }),
      sumoNinjaFrame(dir, 3, { sway: -0.3 }),
    ],
    walk: [
      sumoNinjaFrame(dir, 0, { sway: 0.6, stumbleTilt: -0.3 }),
      sumoNinjaFrame(dir, 1, { sway: 0.2, stumbleTilt: -0.1 }),
      sumoNinjaFrame(dir, 2, { sway: -0.6, stumbleTilt: 0.3 }),
      sumoNinjaFrame(dir, 3, { sway: -0.2, stumbleTilt: 0.1 }),
    ],
    attack: [
      sumoNinjaFrame(dir, 0, { stumbleTilt: 0.2, throwing: false }),
      sumoNinjaFrame(dir, 1, { stumbleTilt: 0.5, throwing: true, throwT: 0.35 }),
      sumoNinjaFrame(dir, 2, { stumbleTilt: 0.7, throwing: true, throwT: 0.7 }),
      sumoNinjaFrame(dir, 3, { stumbleTilt: 0.3, throwing: true, throwT: 1.0 }),
    ],
    death: [
      sumoNinjaFrame(dir, 0, { deathT: 0.25 }),
      sumoNinjaFrame(dir, 1, { deathT: 0.5 }),
      sumoNinjaFrame(dir, 2, { deathT: 0.75 }),
      sumoNinjaFrame(dir, 3, { deathT: 1.0, dead: true }),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
