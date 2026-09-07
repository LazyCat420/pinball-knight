/**
 * FRY SENTINEL — a sentient red french fry carton monster with crinkle-cut
 * limbs, a mystic eye medallion amulet necklace, and crinkle fries on top
 * that launches sizzling crinkle-cut fry darts out of its head.
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
// Red carton body:
const R_CARTON: Ramp = [10, 11, 12];
const R_CARTON_DK: Ramp = [0, 10, 11];
// Golden crispy crinkle-cut fries:
const R_FRY: Ramp = [14, 15, 16];
const R_FRY_DK: Ramp = [26, 27, 28];
// Mystic eye amulet & chain:
const R_GOLD: Ramp = [15, 16, 17];
const R_AMULET: Ramp = [6, 7, 8];
// Eyes:
const R_EYE: Ramp = [20, 21, 22];

interface PoseOpts {
  bob?: number;
  walkStep?: number;
  firing?: boolean;
  launchT?: number; // 0..1
  deathT?: number;  // 0..1
  dead?: boolean;
}

function friesFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { bob = 0, walkStep = 0, firing = false, launchT = 0, deathT = 0, dead = false } = opts;

    if (dead || deathT > 0) {
      // Crumpling carton death collapse
      const t = Math.min(1, Math.max(0, deathT));
      const collapseY = GROUND - 10 + t * 6;
      const boxScaleY = Math.max(0.2, 1 - t * 0.75);
      const boxW = 34 * (1 + t * 0.3);

      groundShadow(ctx, CX, GROUND + 2, 28 * (1 + t * 0.2));

      // Flattened, crumpled red carton
      ellShaded(ctx, CX, collapseY, boxW, 16 * boxScaleY, R_CARTON);
      ellShaded(ctx, CX, collapseY, boxW * 0.7, 10 * boxScaleY, R_CARTON_DK);

      // Crinkle-cut fry shards scattered around
      const frySpread = t * 24;
      figDetail(ctx, [[CX - 16 - frySpread * 0.6, GROUND - 4], [CX - 8 - frySpread * 0.3, GROUND - 6]], 3.5, R_FRY[1]);
      figDetail(ctx, [[CX + 10 + frySpread * 0.4, GROUND - 5], [CX + 20 + frySpread * 0.7, GROUND - 3]], 3.5, R_FRY[1]);
      figDetail(ctx, [[CX - 6, GROUND - 7], [CX + 4, GROUND - 8]], 3, R_FRY[0]);

      // Dropped eye medallion
      ellShaded(ctx, CX + 6, GROUND - 4, 8, 6, R_AMULET);
      figDetail(ctx, [[CX + 5, GROUND - 4], [CX + 7, GROUND - 4]], 2, 1);
      return;
    }

    const cy = GROUND - 32 + bob;
    groundShadow(ctx, CX, GROUND + 2, 26);

    ctx.save();
    ctx.translate(CX, cy);

    // 1. Crinkle-cut fry legs
    const step = walkStep;
    const lLegX = -8 + (step % 2 === 0 ? -2 : 2);
    const rLegX = 8 + (step % 2 === 0 ? 2 : -2);
    const lFootY = 32;
    const rFootY = 32;

    // Crinkle joints for left leg
    limbShaded(ctx, [-8, 12], [lLegX, lFootY - 6], 5, R_FRY);
    ellShaded(ctx, lLegX + (dir === "E" ? 2 : -1), lFootY - 2, 8, 5, R_FRY); // boot/foot

    // Crinkle joints for right leg
    limbShaded(ctx, [8, 12], [rLegX, rFootY - 6], 5, R_FRY);
    ellShaded(ctx, rLegX + (dir === "E" ? 2 : -1), rFootY - 2, 8, 5, R_FRY);

    // 2. Red Carton Box Body
    const boxW = 32;
    const boxH = 30;
    // Main carton body
    ellShaded(ctx, 0, 0, boxW, boxH, R_CARTON);
    // Beveled carton shadow
    ellShaded(ctx, dir === "E" ? 6 : -6, 2, boxW * 0.6, boxH * 0.85, R_CARTON_DK);

    // 3. Crinkle-cut Fry Arms
    const lArmX = -18;
    const rArmX = 18;
    const armY = 4 + (firing ? -4 : 0);
    limbShaded(ctx, [-14, 0], [lArmX, armY + 12], 4.5, R_FRY);
    limbShaded(ctx, [14, 0], [rArmX, armY + 12], 4.5, R_FRY);

    // 4. Crinkle-Cut Fries on Top of Carton Head
    const fryTopY = -16;
    for (let i = -3; i <= 3; i++) {
      const fx = i * 4.2;
      const fryH = 14 + Math.abs(i) * 2;
      figDetail(ctx, [[fx, fryTopY], [fx, fryTopY - fryH]], 4, R_FRY[i % 2 === 0 ? 1 : 2]);
      // Crinkle tick marks
      figDetail(ctx, [[fx - 2, fryTopY - fryH * 0.4], [fx + 2, fryTopY - fryH * 0.4]], 1.5, R_FRY_DK[0]);
      figDetail(ctx, [[fx - 2, fryTopY - fryH * 0.7], [fx + 2, fryTopY - fryH * 0.7]], 1.5, R_FRY_DK[0]);
    }

    // 5. Face Details
    const faceX = dir === "E" ? 2 : -2;
    // Eyes
    ellShaded(ctx, faceX - 5, -3, 6, 8, R_EYE);
    ellShaded(ctx, faceX + 5, -3, 6, 8, R_EYE);
    // Dark pupils looking forward/player
    ellShaded(ctx, faceX - 5 + (dir === "E" ? 1 : -1), -3, 2.5, 3.5, [1, 1, 1] as Ramp);
    ellShaded(ctx, faceX + 5 + (dir === "E" ? 1 : -1), -3, 2.5, 3.5, [1, 1, 1] as Ramp);

    // Thick curved black eyebrows
    figDetail(ctx, [[faceX - 9, -9], [faceX - 2, -8]], 2.5, 1);
    figDetail(ctx, [[faceX + 2, -8], [faceX + 9, -9]], 2.5, 1);

    // Nose & Mouth
    figDetail(ctx, [[faceX, -2], [faceX + 3, 3]], 2, R_CARTON_DK[0]);
    figDetail(ctx, [[faceX - 4, 7], [faceX + 4, 8]], 2, R_CARTON_DK[0]);

    // 6. Mystic Eye Medallion Necklace
    // Chain draped across carton
    figDetail(ctx, [[-12, 10], [0, 16]], 1.5, R_GOLD[1]);
    figDetail(ctx, [[0, 16], [12, 10]], 1.5, R_GOLD[1]);
    // Eye Amulet
    ellShaded(ctx, 0, 18, 9, 8, R_AMULET);
    figGlow(ctx, 0, 18, 2, 7, 8);
    // Triangle + Eye glyph inside amulet
    figDetail(ctx, [[-2, 18], [2, 18]], 1.5, 1);

    // 7. Firing Fry Barrage from Head
    if (firing && launchT > 0.1) {
      const launchDist = launchT * 28;
      const fDir = dir === "E" ? 1 : -1;

      // Rocketing crinkle fry darts blasting out of head!
      figDetail(ctx, [[fDir * 4, fryTopY - 14 - launchDist], [fDir * 12, fryTopY - 26 - launchDist]], 4, R_FRY[2]);
      figGlow(ctx, fDir * 8, fryTopY - 20 - launchDist, 4, 15, 16);

      figDetail(ctx, [[fDir * -4, fryTopY - 10 - launchDist * 0.8], [fDir * 6, fryTopY - 22 - launchDist * 0.8]], 4, R_FRY[1]);
      figGlow(ctx, fDir * 2, fryTopY - 16 - launchDist * 0.8, 3, 14, 15);
    }

    ctx.restore();
  };
}

export function makeFriesPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [
      friesFrame(dir, 0, { bob: 0 }),
      friesFrame(dir, 0.5, { bob: -2 }),
    ],
    walk: [
      friesFrame(dir, 0, { bob: 0, walkStep: 0 }),
      friesFrame(dir, 0.25, { bob: -1, walkStep: 1 }),
      friesFrame(dir, 0.5, { bob: -3, walkStep: 2 }),
      friesFrame(dir, 0.75, { bob: -1, walkStep: 3 }),
    ],
    attack: [
      friesFrame(dir, 0, { firing: true, launchT: 0.1 }),
      friesFrame(dir, 0.33, { firing: true, launchT: 0.5 }),
      friesFrame(dir, 0.66, { firing: true, launchT: 1.0 }),
      friesFrame(dir, 1.0, { firing: false }),
    ],
    death: [
      friesFrame(dir, 0, { deathT: 0.2 }),
      friesFrame(dir, 0.33, { deathT: 0.5 }),
      friesFrame(dir, 0.66, { deathT: 0.8 }),
      friesFrame(dir, 1.0, { deathT: 1.0, dead: true }),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
