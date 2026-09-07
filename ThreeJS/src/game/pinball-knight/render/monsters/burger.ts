/**
 * BURGER MONSTER — a floating hamburger monster with lobster eyestalks
 * that deconstructs itself to attack with lettuce/mayo/mustard/tomatoes
 * and rots into decomposing sludge upon death.
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
// Bun: Warm golden brown
const R_BUN: Ramp = [26, 27, 24];
// Dark grilled meat patty:
const R_PATTY: Ramp = [1, 26, 27];
// Melted cheese / mustard:
const R_CHEESE: Ramp = [14, 15, 16];
// Fresh tomato:
const R_TOMATO: Ramp = [10, 11, 12];
// Ruffled lettuce:
const R_LETTUCE: Ramp = [6, 7, 8];
// Lobster eyestalks (crimson/coral):
const R_STALK: Ramp = [10, 11, 12];
// Beady lobster eyes:
const R_EYE: Ramp = [20, 21, 22];
// Rot / decomposing sludge:
const R_ROT: Ramp = [6, 7, 8];
const R_SLUDGE: Ramp = [1, 26, 27];

interface PoseOpts {
  bob?: number;
  tilt?: number;
  deconstruct?: number; // 0..1 attack progress
  rot?: number;         // 0..1 death rot progress
  dead?: boolean;
}

function burgerFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { bob = 0, tilt = 0, deconstruct = 0, rot = 0, dead = false } = opts;

    if (dead || rot > 0) {
      // Rotting death sequence
      const t = Math.min(1, Math.max(0, rot));
      const puddleR = 18 + t * 14;
      const puddleH = 6 + t * 4;
      
      // Sludge / mold puddle on ground
      ellShaded(ctx, CX, GROUND - 4, puddleR * 2, puddleH * 2, R_SLUDGE);
      ellShaded(ctx, CX, GROUND - 4, puddleR * 1.5, puddleH * 1.4, R_ROT);
      figGlow(ctx, CX - 6, GROUND - 6, 4, 7, 8);
      figGlow(ctx, CX + 8, GROUND - 3, 3, 6, 7);

      if (t < 0.8) {
        // Collapsing, rotting burger remnants sinking into puddle
        const remY = GROUND - 14 + t * 8;
        const scale = 1 - t * 0.7;
        ellShaded(ctx, CX, remY, 26 * scale, 10 * scale, R_ROT);
        ellShaded(ctx, CX, remY - 4 * scale, 22 * scale, 8 * scale, R_BUN);

        // Limp, melted eyestalks
        const ey = remY - 6 * scale;
        figDetail(ctx, [[CX - 8, ey], [CX - 16, ey + 4]], 3 * scale, R_STALK[0]);
        figDetail(ctx, [[CX + 8, ey], [CX + 14, ey + 5]], 3 * scale, R_STALK[0]);
      }
      return;
    }

    // Shadow on ground below floating monster
    const floatY = GROUND - 34 + bob;
    const shadowScale = Math.max(0.5, 1 - (GROUND - floatY) / 60);
    groundShadow(ctx, CX, GROUND + 2, 28 * shadowScale);

    ctx.save();
    ctx.translate(CX, floatY);
    if (tilt !== 0) {
      ctx.rotate(tilt);
    }

    const dec = deconstruct;

    // Normal or Deconstructing layers:
    // When attacking (dec > 0), ingredients fling apart!
    const topBunY = -12 - dec * 20;
    const tomatoY = -6 - dec * 12 + (dec > 0 ? (dir === "E" ? 8 : -8) : 0);
    const cheeseY = -2 - dec * 6;
    const pattyY = 2;
    const lettuceY = 6 + dec * 8 + (dec > 0 ? (dir === "E" ? 12 : -12) : 0);
    const botBunY = 11 + dec * 14;

    // Bottom bun
    ellShaded(ctx, 0, botBunY, 32, 10, R_BUN);

    // Lettuce ruffle
    ellShaded(ctx, dec > 0 ? (dir === "E" ? 8 : -8) : 0, lettuceY, 36, 8, R_LETTUCE);

    // Grilled patty
    ellShaded(ctx, 0, pattyY, 34, 11, R_PATTY);

    // Melted cheese
    ellShaded(ctx, 0, cheeseY, 32, 6, R_CHEESE);

    // Tomato slice
    ellShaded(ctx, dec > 0 ? (dir === "E" ? 6 : -6) : 0, tomatoY, 30, 7, R_TOMATO);

    // Top bun
    ellShaded(ctx, 0, topBunY, 34, 16, R_BUN);
    // Sesame seeds on top bun
    figDetail(ctx, [[-8, topBunY - 4], [-7, topBunY - 4]], 2, R_EYE[2]);
    figDetail(ctx, [[-2, topBunY - 6], [-1, topBunY - 6]], 2, R_EYE[2]);
    figDetail(ctx, [[5, topBunY - 5], [6, topBunY - 5]], 2, R_EYE[2]);
    figDetail(ctx, [[-4, topBunY - 2], [-3, topBunY - 2]], 2, R_EYE[2]);
    figDetail(ctx, [[4, topBunY - 2], [5, topBunY - 2]], 2, R_EYE[2]);

    // Lobster eyestalks protruding out from top bun!
    const stalkBaseY = topBunY - 4;
    const stalkLen = 14 + Math.sin(phase * Math.PI * 2) * 2;
    const stalkSpread = 10;

    // Left eyestalk
    const lTipX = -stalkSpread - (dir === "E" ? -1 : 2);
    const lTipY = stalkBaseY - stalkLen;
    limbShaded(ctx, [-5, stalkBaseY], [lTipX, lTipY], 4, R_STALK);
    // Left eye (beady lobster eye)
    ellShaded(ctx, lTipX, lTipY, 7, 7, R_EYE);
    ellShaded(ctx, lTipX + (dir === "E" ? 1 : -1), lTipY, 3, 3, [1, 1, 1] as Ramp); // dark pupil

    // Right eyestalk
    const rTipX = stalkSpread + (dir === "E" ? 2 : -1);
    const rTipY = stalkBaseY - stalkLen + 1;
    limbShaded(ctx, [5, stalkBaseY], [rTipX, rTipY], 4, R_STALK);
    // Right eye
    ellShaded(ctx, rTipX, rTipY, 7, 7, R_EYE);
    ellShaded(ctx, rTipX + (dir === "E" ? 1 : -1), rTipY, 3, 3, [1, 1, 1] as Ramp);

    // If attacking / deconstructing, draw projectile ingredients flying off!
    if (dec > 0.2) {
      const flingDist = dec * 26;
      const flingDir = dir === "E" ? 1 : -1;

      // Flying tomato disc
      ellShaded(ctx, flingDir * (flingDist + 12), tomatoY - 4, 12, 6, R_TOMATO);

      // Flying lettuce shard
      ellShaded(ctx, flingDir * (flingDist + 18), lettuceY - 8, 14, 5, R_LETTUCE);

      // Flying mustard/mayo condiment globs
      figGlow(ctx, flingDir * (flingDist + 8), 0, 4, 15, 16);
      figGlow(ctx, flingDir * (flingDist + 22), 4, 3, 21, 22);
    }

    ctx.restore();
  };
}

export function makeBurgerPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [
      burgerFrame(dir, 0, { bob: 0 }),
      burgerFrame(dir, 0.5, { bob: -3 }),
    ],
    walk: [
      burgerFrame(dir, 0, { bob: 0, tilt: dir === "E" ? 0.05 : -0.05 }),
      burgerFrame(dir, 0.25, { bob: -2, tilt: dir === "E" ? 0.1 : -0.1 }),
      burgerFrame(dir, 0.5, { bob: -4, tilt: dir === "E" ? 0.05 : -0.05 }),
      burgerFrame(dir, 0.75, { bob: -2, tilt: 0 }),
    ],
    attack: [
      burgerFrame(dir, 0, { bob: -2, deconstruct: 0.1 }),
      burgerFrame(dir, 0.33, { bob: -6, deconstruct: 0.6 }),
      burgerFrame(dir, 0.66, { bob: -8, deconstruct: 1.0 }),
      burgerFrame(dir, 1.0, { bob: -3, deconstruct: 0.2 }),
    ],
    death: [
      burgerFrame(dir, 0, { rot: 0.2 }),
      burgerFrame(dir, 0.33, { rot: 0.5 }),
      burgerFrame(dir, 0.66, { rot: 0.8 }),
      burgerFrame(dir, 1.0, { rot: 1.0, dead: true }),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
