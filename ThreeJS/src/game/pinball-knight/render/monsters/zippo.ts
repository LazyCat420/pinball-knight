/**
 * PYRO ZIPPO — a 1960s rubber-hose cartoon Zippo lighter monster.
 * Chrome rectangular lighter case with an open flip lid, cartoon noodle limbs
 * in white rubber-hose gloves and retro cartoon shoes. Emerging from the chimney
 * wick is a living cartoon flame face with vintage pie/oval eyes and a grin.
 * In its attack sequence, it pulls out a vintage alcohol bottle, chugs it into
 * its wick, and exhales a fiery torrent of fire breath.
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
// Chrome / Silver lighter case:
const R_CHROME: Ramp = [20, 21, 22];
const R_CHROME_DK: Ramp = [18, 19, 20];
// Chimney windscreen / perforated metal:
const R_WINDSCREEN: Ramp = [19, 20, 21];
// Cartoon Flame Face:
const R_FLAME_BASE: Ramp = [14, 15, 16];
const R_FLAME_HOT: Ramp = [10, 11, 12];
const R_FLAME_CORE: Ramp = [21, 22, 22];
// White rubber-hose cartoon gloves:
const R_GLOVE: Ramp = [20, 21, 22];
const R_GLOVE_DK: Ramp = [18, 19, 20];
// Shoes / Noodle legs:
const R_SHOE: Ramp = [18, 19, 20];
const R_LIMB: Ramp = [17, 18, 19];
// Alcohol bottle:
const R_GLASS: Ramp = [13, 14, 15];
const R_AMBER: Ramp = [14, 15, 16];

interface PoseOpts {
  bob?: number;
  legPhase?: number;
  chugging?: boolean;
  blowing?: boolean;
  fireT?: number; // 0..1
  deathT?: number; // 0..1
  dead?: boolean;
}

function zippoFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { bob = 0, legPhase = 0, chugging = false, blowing = false, fireT = 0, deathT = 0, dead = false } = opts;

    if (dead || deathT > 0) {
      // Snuffed out lighter collapsed on floor
      const t = Math.min(1, Math.max(0, deathT));
      const collapseY = GROUND - 4 + t * 2;
      groundShadow(ctx, CX, GROUND + 2, 24 * (1 + t * 0.2));

      // Tiny dying smoke wisp / ember
      if (t < 0.7) {
        figGlow(ctx, CX, collapseY - 14, 6 * (1 - t), R_FLAME_BASE[1]);
        ellShaded(ctx, CX + (t * 8), collapseY - 18 - (t * 10), 5 * (1 - t), 4 * (1 - t), R_CHROME_DK);
      }

      // Flat chrome lighter body resting sideways
      ellShaded(ctx, CX, collapseY, 26, 12, R_CHROME);
      ellShaded(ctx, CX - 4, collapseY + 1, 16, 8, R_CHROME_DK);

      // Open flip-top lid resting open to the left
      ellShaded(ctx, CX - 14, collapseY - 2, 10, 8, R_CHROME);

      // Limp white gloves and cartoon shoes lying flat
      ellShaded(ctx, CX - 18, GROUND - 2, 7, 5, R_GLOVE);
      ellShaded(ctx, CX + 16, GROUND - 2, 7, 5, R_GLOVE);
      ellShaded(ctx, CX + 10, GROUND - 1, 8, 5, R_SHOE);
      return;
    }

    const cy = GROUND - 26 + bob;
    groundShadow(ctx, CX, GROUND + 2, 22);

    ctx.save();
    ctx.translate(CX, cy);

    // 1. Legs & Shoes (1960s cartoon noodle legs)
    const lFootY = GROUND - cy - 2;
    const legOffset = Math.sin(legPhase) * 6;
    // Left leg
    limbShaded(ctx, [-6, 10], [-8 - legOffset, lFootY], 2.5, R_LIMB);
    ellShaded(ctx, -9 - legOffset, lFootY, 8, 5, R_SHOE);

    // Right leg
    limbShaded(ctx, [6, 10], [8 + legOffset, lFootY], 2.5, R_LIMB);
    ellShaded(ctx, 9 + legOffset, lFootY, 8, 5, R_SHOE);

    // 2. Chrome Rectangular Lighter Case
    const bodyW = 24;
    const bodyH = 22;
    ellShaded(ctx, 0, 0, bodyW, bodyH, R_CHROME);
    // Beveled chrome highlight stripe & core shadow
    ellShaded(ctx, dir === "E" ? 4 : -4, 0, bodyW * 0.45, bodyH * 0.85, R_CHROME_DK);
    ellShaded(ctx, 0, -6, bodyW * 0.7, 3, R_CHROME);

    // 3. Open Flip-Top Hinged Lid (angled left/back)
    ctx.save();
    ctx.translate(-bodyW / 2 + 2, -bodyH / 2 + 2);
    ctx.rotate(-0.45); // open lid tilt
    ellShaded(ctx, -4, -6, 12, 16, R_CHROME);
    ellShaded(ctx, -5, -6, 7, 12, R_CHROME_DK);
    ctx.restore();

    // 4. Chimney Windscreen (perforated metal box around wick)
    ellShaded(ctx, 0, -14, 14, 10, R_WINDSCREEN);
    // Perforations / vent holes
    figDetail(ctx, [
      [-4, -14],
      [0, -14],
      [4, -14],
      [-2, -12],
      [2, -12],
    ], 1.5, 0);

    // 5. Living Flame Face (Emerging from wick)
    const flameBob = Math.sin(phase * 4) * 2;
    const flameY = -24 + flameBob;
    const flameScale = chugging ? 1.3 : (blowing ? 1.4 : 1.0);

    // Flame outer aura & glow
    figGlow(ctx, 0, flameY, 14 * flameScale, blowing ? R_FLAME_HOT[1] : R_FLAME_BASE[1]);
    ellShaded(ctx, 0, flameY, 16 * flameScale, 18 * flameScale, blowing ? R_FLAME_HOT : R_FLAME_BASE);
    ellShaded(ctx, 0, flameY + 2, 10 * flameScale, 12 * flameScale, R_FLAME_CORE);

    // 6. 1960s Cartoon Face Features (Pie Eyes & Grin)
    const eyeY = flameY - 1;
    const eyeOffsetX = dir === "E" ? 2 : (dir === "N" ? 0 : -1);

    if (chugging) {
      // Closed happy eyes while drinking
      figDetail(ctx, [
        [-5 + eyeOffsetX, eyeY],
        [-3 + eyeOffsetX, eyeY - 2],
        [-1 + eyeOffsetX, eyeY],
        [1 + eyeOffsetX, eyeY],
        [3 + eyeOffsetX, eyeY - 2],
        [5 + eyeOffsetX, eyeY],
      ], 1.5, 0);
    } else if (blowing) {
      // Squinting focused eyes while blowing fire
      figDetail(ctx, [
        [-4 + eyeOffsetX, eyeY],
        [-1 + eyeOffsetX, eyeY - 1],
        [1 + eyeOffsetX, eyeY - 1],
        [4 + eyeOffsetX, eyeY],
      ], 1.5, 0);
      // Puffed cheeks / round mouth opening
      ellShaded(ctx, 4, flameY + 4, 5, 5, R_FLAME_HOT);
    } else {
      // Expressive 1960s cartoon oval/pie eyes
      ellShaded(ctx, -3 + eyeOffsetX, eyeY, 3, 5, R_CHROME);
      ellShaded(ctx, 3 + eyeOffsetX, eyeY, 3, 5, R_CHROME);
      figDetail(ctx, [[-3 + eyeOffsetX, eyeY], [3 + eyeOffsetX, eyeY]], 1.5, 0);

      // Grinning cartoon mouth
      figDetail(ctx, [
        [-3 + eyeOffsetX, flameY + 5],
        [0 + eyeOffsetX, flameY + 7],
        [3 + eyeOffsetX, flameY + 5],
      ], 1.5, 0);
    }

    // 7. Arms, Gloves & Alcohol Bottle
    if (chugging) {
      // Right hand holding liquor bottle tilted into wick
      limbShaded(ctx, [8, 0], [12, -12], 2.5, R_LIMB);
      ellShaded(ctx, 12, -12, 6, 6, R_GLOVE);
      // Glass bottle with amber liquid
      ellShaded(ctx, 8, -16, 7, 14, R_GLASS);
      ellShaded(ctx, 8, -15, 5, 8, R_AMBER);
      // Left arm cheering / holding hip
      limbShaded(ctx, [-8, 0], [-14, 2], 2.5, R_LIMB);
      ellShaded(ctx, -15, 2, 6, 6, R_GLOVE);
    } else if (blowing) {
      // Both hands thrust back in power stance
      limbShaded(ctx, [-8, 0], [-16, 4], 2.5, R_LIMB);
      ellShaded(ctx, -17, 5, 6, 6, R_GLOVE);
      limbShaded(ctx, [8, 0], [14, 6], 2.5, R_LIMB);
      ellShaded(ctx, 15, 7, 6, 6, R_GLOVE);

      // Fire breath torrent jetting forward
      const jetLen = 22 + fireT * 18;
      figGlow(ctx, 12 + jetLen * 0.5, flameY + 4, jetLen * 0.6, R_FLAME_HOT[1]);
      ellShaded(ctx, 8 + jetLen * 0.5, flameY + 4, jetLen, 10, R_FLAME_HOT);
      ellShaded(ctx, 6 + jetLen * 0.3, flameY + 4, jetLen * 0.5, 6, R_FLAME_CORE);
    } else {
      // Normal walking / idle rubber-hose arms with white gloves
      const armSwing = Math.sin(legPhase) * 6;
      limbShaded(ctx, [-8, 0], [-14, 4 - armSwing], 2.5, R_LIMB);
      ellShaded(ctx, -15, 5 - armSwing, 6, 6, R_GLOVE);
      limbShaded(ctx, [8, 0], [14, 4 + armSwing], 2.5, R_LIMB);
      ellShaded(ctx, 15, 5 + armSwing, 6, 6, R_GLOVE);
    }

    ctx.restore();
  };
}

export function makeZippoPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [
      zippoFrame(dir, 0, { bob: 0 }),
      zippoFrame(dir, 1, { bob: -2 }),
      zippoFrame(dir, 2, { bob: -3 }),
      zippoFrame(dir, 3, { bob: -1 }),
    ],
    walk: [
      zippoFrame(dir, 0, { bob: 0, legPhase: 0 }),
      zippoFrame(dir, 1, { bob: -2, legPhase: Math.PI * 0.5 }),
      zippoFrame(dir, 2, { bob: -3, legPhase: Math.PI }),
      zippoFrame(dir, 3, { bob: -1, legPhase: Math.PI * 1.5 }),
    ],
    attack: [
      zippoFrame(dir, 0, { bob: 1, chugging: true }), // pops open bottle & chugs
      zippoFrame(dir, 1, { bob: 0, chugging: true }), // chugging fuel surge
      zippoFrame(dir, 2, { bob: -2, blowing: true, fireT: 0.5 }), // blasts fire cone 1
      zippoFrame(dir, 3, { bob: -1, blowing: true, fireT: 1.0 }), // blasts fire cone 2
    ],
    death: [
      zippoFrame(dir, 0, { deathT: 0.25 }),
      zippoFrame(dir, 1, { deathT: 0.50 }),
      zippoFrame(dir, 2, { deathT: 0.75 }),
      zippoFrame(dir, 3, { deathT: 1.00, dead: true }),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
