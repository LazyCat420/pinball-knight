/**
 * TOXIC SHAKE — a fast-food milkshake cup monster inspired by Master Shake.
 * White cup body with plastic lid, pink-and-white striped bend straw,
 * iconic yellow rubber dishwasher gloves for hands, and an erratic ranged
 * attack that sprays sizzling toxic milkshake droplets at the player.
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
// White cup body:
const R_CUP: Ramp = [20, 21, 22];
const R_CUP_DK: Ramp = [18, 19, 20];
// Lid / Plastic rim:
const R_LID: Ramp = [19, 20, 21];
// Pink & Red Straw:
const R_STRAW_PINK: Ramp = [23, 24, 25];
const R_STRAW_RED: Ramp = [10, 11, 12];
// Yellow dishwashing rubber gloves:
const R_GLOVE: Ramp = [14, 15, 16];
const R_GLOVE_DK: Ramp = [26, 27, 28];
// Toxic green milkshake contents & spray:
const R_TOXIC: Ramp = [6, 7, 8];
const R_TOXIC_HI: Ramp = [7, 8, 9];
// Face / eyes:
const R_EYE: Ramp = [21, 22, 22];

interface PoseOpts {
  bob?: number;
  glideTilt?: number;
  firing?: boolean;
  sprayT?: number; // 0..1
  deathT?: number; // 0..1
  dead?: boolean;
}

function milkshakeFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { bob = 0, glideTilt = 0, firing = false, sprayT = 0, deathT = 0, dead = false } = opts;

    if (dead || deathT > 0) {
      // Crumpled cup death collapse & spilled toxic shake puddle
      const t = Math.min(1, Math.max(0, deathT));
      const collapseY = GROUND - 8 + t * 4;
      const cupScaleY = Math.max(0.2, 1 - t * 0.75);
      const cupW = 32 * (1 + t * 0.35);

      groundShadow(ctx, CX, GROUND + 2, 28 * (1 + t * 0.3));

      // Spilled toxic green shake puddle on floor
      const puddleW = 38 * (1 + t * 0.5);
      ellShaded(ctx, CX + 4, GROUND - 2, puddleW, 12 * t, R_TOXIC);
      figGlow(ctx, CX + 4, GROUND - 2, puddleW * 0.4, R_TOXIC_HI[1]);

      // Collapsed white cup lying sideways
      ellShaded(ctx, CX - 6, collapseY, cupW * 0.8, 14 * cupScaleY, R_CUP);
      ellShaded(ctx, CX - 6, collapseY + 2, cupW * 0.5, 8 * cupScaleY, R_CUP_DK);

      // Bent plastic straw pointing sideways
      limbShaded(ctx, [CX + 6, collapseY - 2], [CX + 24, GROUND - 4], 3, R_STRAW_PINK);

      // Limp yellow dishwasher gloves lying flat
      ellShaded(ctx, CX - 18, GROUND - 4, 10, 6, R_GLOVE);
      ellShaded(ctx, CX + 14, GROUND - 4, 10, 6, R_GLOVE);
      return;
    }

    const cy = GROUND - 30 + bob;
    groundShadow(ctx, CX, GROUND + 2, 24);

    ctx.save();
    ctx.translate(CX, cy);
    if (glideTilt !== 0) {
      ctx.rotate(glideTilt);
    }

    // 1. Cup Body (tapered white cup)
    const cupTopW = 28;
    const cupBotW = 20;
    const cupH = 28;

    // Cup shadow & base
    ellShaded(ctx, 0, 10, cupBotW, 8, R_CUP_DK);
    ellShaded(ctx, 0, -6, cupTopW, cupH, R_CUP);
    // Darker shading on side away from light
    ellShaded(ctx, dir === "E" ? 5 : -5, -4, cupTopW * 0.55, cupH * 0.85, R_CUP_DK);

    // Red/blue decorative fast-food stripe band across middle
    ellShaded(ctx, 0, 0, cupTopW * 0.85, 5, R_STRAW_RED);

    // 2. Plastic Lid on top of cup
    ellShaded(ctx, 0, -20, cupTopW * 1.05, 8, R_LID);
    // Translucent dome with toxic green shake showing through
    ellShaded(ctx, 0, -23, cupTopW * 0.7, 7, R_TOXIC);

    // 3. Bent Drinking Straw (pink & white stripes)
    const strawBaseX = dir === "E" ? 3 : -3;
    const strawBaseY = -23;
    const strawElbowX = strawBaseX + (dir === "E" ? 5 : -5);
    const strawElbowY = strawBaseY - 10;
    const strawTipX = strawElbowX + (dir === "E" ? 8 : -8);
    const strawTipY = strawElbowY - (firing ? 2 : 5);

    limbShaded(ctx, [strawBaseX, strawBaseY], [strawElbowX, strawElbowY], 4, R_STRAW_PINK);
    limbShaded(ctx, [strawElbowX, strawElbowY], [strawTipX, strawTipY], 3.5, R_STRAW_RED);

    // 4. Yellow Rubber Dishwashing Gloves (elbow-length style)
    const gloveW = 10;
    const gloveH = 12;

    if (firing) {
      // Thrusting both yellow gloved hands forward
      const fX = dir === "E" ? 14 : -14;
      limbShaded(ctx, [-12, -4], [fX - 4, -8], 5, R_GLOVE_DK);
      limbShaded(ctx, [12, -4], [fX + 4, -8], 5, R_GLOVE_DK);

      ellShaded(ctx, fX - 2, -10, gloveW, gloveH, R_GLOVE);
      ellShaded(ctx, fX + 4, -10, gloveW, gloveH, R_GLOVE);

      // Sizzling toxic green spray bursts from straw
      const sprayX = strawTipX + (dir === "E" ? 12 : -12);
      const sprayY = strawTipY - 2;
      figGlow(ctx, sprayX, sprayY, 14, R_TOXIC_HI[2]);
      figDetail(ctx, [
        [sprayX, sprayY],
        [sprayX + (dir === "E" ? 8 : -8), sprayY - 4],
        [sprayX + (dir === "E" ? 14 : -14), sprayY + 2],
      ], 4, R_TOXIC[1]);
    } else {
      // Yellow gloves resting at sides or bobbing
      const lArmX = -15;
      const rArmX = 15;
      const armY = -4 + bob * 0.5;

      limbShaded(ctx, [-12, -8], [lArmX, armY], 4.5, R_GLOVE_DK);
      limbShaded(ctx, [12, -8], [rArmX, armY], 4.5, R_GLOVE_DK);

      // Yellow rubber dishwasher gloves with thumb
      ellShaded(ctx, lArmX, armY + 4, gloveW, gloveH, R_GLOVE);
      ellShaded(ctx, rArmX, armY + 4, gloveW, gloveH, R_GLOVE);
      // Glove cuffs
      ellShaded(ctx, lArmX, armY - 2, gloveW * 0.9, 4, R_GLOVE_DK);
      ellShaded(ctx, rArmX, armY - 2, gloveW * 0.9, 4, R_GLOVE_DK);
    }

    // 5. Cartoon Face on Cup Front
    const eyeOffsetX = dir === "E" ? 3 : -3;
    const eyeY = -7;
    // Eye whites
    ellShaded(ctx, -5 + eyeOffsetX, eyeY, 6, 8, R_EYE);
    ellShaded(ctx, 5 + eyeOffsetX, eyeY, 6, 8, R_EYE);
    // Pupils
    figDetail(ctx, [
      [-4 + eyeOffsetX + (dir === "E" ? 1 : -1), eyeY],
      [6 + eyeOffsetX + (dir === "E" ? 1 : -1), eyeY],
    ], 2.5, 0); // black pupils

    // Dark cartoon eyebrows
    figDetail(ctx, [
      [-6 + eyeOffsetX, eyeY - 6],
      [-4 + eyeOffsetX, eyeY - 7],
      [4 + eyeOffsetX, eyeY - 7],
      [6 + eyeOffsetX, eyeY - 6],
    ], 2, 0);

    // Expressive smirk / mouth
    figDetail(ctx, [
      [-3 + eyeOffsetX, 5],
      [0 + eyeOffsetX, 6],
      [3 + eyeOffsetX, 5],
    ], 2, 0);

    ctx.restore();
  };
}

export function makeMilkshakePaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [
      milkshakeFrame(dir, 0, { bob: 0 }),
      milkshakeFrame(dir, 1, { bob: -2 }),
      milkshakeFrame(dir, 2, { bob: -3 }),
      milkshakeFrame(dir, 3, { bob: -1 }),
    ],
    walk: [
      milkshakeFrame(dir, 0, { bob: 0, glideTilt: -0.06 }),
      milkshakeFrame(dir, 1, { bob: -2, glideTilt: -0.03 }),
      milkshakeFrame(dir, 2, { bob: -4, glideTilt: 0.06 }),
      milkshakeFrame(dir, 3, { bob: -2, glideTilt: 0.03 }),
    ],
    attack: [
      milkshakeFrame(dir, 0, { bob: 2, firing: false }), // windup lean
      milkshakeFrame(dir, 1, { bob: -1, firing: true, sprayT: 0.33 }), // spray burst 1
      milkshakeFrame(dir, 2, { bob: -2, firing: true, sprayT: 0.66 }), // spray burst 2
      milkshakeFrame(dir, 3, { bob: 0, firing: true, sprayT: 1.0 }),  // spray followthrough
    ],
    death: [
      milkshakeFrame(dir, 0, { deathT: 0.25 }),
      milkshakeFrame(dir, 1, { deathT: 0.50 }),
      milkshakeFrame(dir, 2, { deathT: 0.75 }),
      milkshakeFrame(dir, 3, { deathT: 1.00, dead: true }),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
