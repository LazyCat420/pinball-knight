/**
 * 1950s TOON GAS CAN — a vintage rubber-hose cartoon gasoline canister monster.
 * Red vintage metal gas can with a yellow spout, black carry handle, cartoon
 * noodle limbs in white rubber-hose gloves and rounded clown shoes. Across its
 * belly is a classic 1950s pie-eyed toon face with a cheerful wide grin.
 * Paired with Pyro Zippo; when killed, its cap pops off and it spills a wide
 * puddle of oil slick that easily catches fire.
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
// Vintage Red Metal Canister:
const R_CAN_RED: Ramp = [9, 10, 11];
// Yellow / Brass Spout:
const R_SPOUT: Ramp = [14, 15, 16];
// Handle & Noodle Limbs:
const R_HANDLE: Ramp = [17, 18, 19];
const R_LIMB: Ramp = [17, 18, 19];
// White rubber-hose cartoon gloves & face whites:
const R_GLOVE: Ramp = [20, 21, 22];
// Shoes:
const R_SHOE: Ramp = [18, 19, 20];
// Oil / Gasoline:
const R_OIL: Ramp = [17, 17, 18];

interface PoseOpts {
  bob?: number;
  legPhase?: number;
  splashing?: boolean;
  deathT?: number; // 0..1
  dead?: boolean;
}

function gasCanFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { bob = 0, legPhase = 0, splashing = false, deathT = 0, dead = false } = opts;

    if (dead || deathT > 0) {
      // Toppled over gas canister leaking oil on the floor
      const t = Math.min(1, Math.max(0, deathT));
      const collapseY = GROUND - 4 + t * 2;

      // Spilled oil puddle expanding on ground
      const oilR = 10 + t * 14;
      ellShaded(ctx, CX + 2, collapseY + 2, oilR, 4 + t * 2, R_OIL, 0.1);

      // Canister lying on side
      groundShadow(ctx, CX, GROUND, 14);
      ellShaded(ctx, CX + t * 3, collapseY, 12, 7, R_CAN_RED, 0.75 + t * 0.4);

      // Detached spout & lid
      ellShaded(ctx, CX + 14 + t * 4, collapseY - 2, 5, 3, R_SPOUT, 0.3);

      // Dizzy 'X' eyes on fallen can
      figGlow(ctx, CX + t * 3 - 3, collapseY - 1, 1.5, 18, 20);
      figGlow(ctx, CX + t * 3 + 3, collapseY - 1, 1.5, 18, 20);
      return;
    }

    const yOff = bob;
    const bodyY = GROUND - 18 + yOff;

    // Ground shadow pulses with bounce
    groundShadow(ctx, CX, GROUND, Math.max(6, 13 - Math.abs(yOff) * 1.5));

    // ── Noodle Legs & Shoes ──
    const leftLegSwing = Math.sin(legPhase) * 6;
    const rightLegSwing = -Math.sin(legPhase) * 6;

    const leftFootY = GROUND - 2 + Math.max(0, -leftLegSwing * 0.5);
    const rightFootY = GROUND - 2 + Math.max(0, -rightLegSwing * 0.5);

    // Left leg
    limbShaded(ctx, [CX - 6, bodyY + 10], [CX - 7 + leftLegSwing, leftFootY], 3, R_LIMB);
    // Right leg
    limbShaded(ctx, [CX + 6, bodyY + 10], [CX + 7 + rightLegSwing, rightFootY], 3, R_LIMB);

    // Cartoon Shoes
    ellShaded(ctx, CX - 7 + leftLegSwing + (dir === "E" ? 2 : dir === "S" ? -1 : 0), leftFootY, 5, 3, R_SHOE);
    ellShaded(ctx, CX + 7 + rightLegSwing + (dir === "E" ? 2 : dir === "S" ? 1 : 0), rightFootY, 5, 3, R_SHOE);

    // ── Main Gasoline Canister Body ──
    // Slightly trapezoidal vintage red can (squash & stretch)
    const stretch = 1 + (yOff > 0 ? 0.05 : -0.05);
    const squish = 1 / stretch;

    ellShaded(ctx, CX, bodyY + 2, 11 * squish, 12 * stretch, R_CAN_RED, dir === "E" ? 0.08 : 0);

    // Top metal handle
    ellShaded(ctx, CX, bodyY - 11, 7, 3, R_HANDLE, 0);

    // Yellow Spout angled out the side
    const spoutX = dir === "E" ? CX + 10 : dir === "S" ? CX + 9 : CX - 9;
    const spoutY = bodyY - 8;
    ellShaded(ctx, spoutX, spoutY, 5, 3, R_SPOUT, dir === "E" ? 0.6 : dir === "S" ? 0.45 : -0.45);

    // Splashing fuel stream during attack
    if (splashing) {
      const splashEndX = spoutX + (dir === "E" ? 12 : dir === "S" ? 8 : -8);
      const splashEndY = spoutY + 6;
      limbShaded(ctx, [spoutX, spoutY], [splashEndX, splashEndY], 3, R_OIL);
      ellShaded(ctx, splashEndX, splashEndY + 2, 4, 2, R_OIL, 0);
    }

    // ── 1950s Toon Face (if facing South or East) ──
    if (dir === "S" || dir === "E") {
      const faceOffX = dir === "E" ? 3 : 0;
      const eyeY = bodyY - 1;

      // Big white oval cartoon eye background
      ellShaded(ctx, CX - 4 + faceOffX, eyeY, 3.5, 5, R_GLOVE, -0.05);
      ellShaded(ctx, CX + 4 + faceOffX, eyeY, 3.5, 5, R_GLOVE, 0.05);

      // Classic pie-cut black pupils (small glow dots)
      figGlow(ctx, CX - 3.5 + faceOffX, eyeY, 1.8, 17, 1);
      figGlow(ctx, CX + 3.5 + faceOffX, eyeY, 1.8, 17, 1);

      // Huge cartoon smile grin with cheek curves
      const smileY = bodyY + 6;
      ellShaded(ctx, CX + faceOffX, smileY, 6, 3, R_CAN_RED, 0);
      figGlow(ctx, CX + faceOffX, smileY + 1, 1.5, 11, 12);
    } else {
      // Back of canister seams
      figDetail(ctx, [[CX, bodyY - 4], [CX, bodyY + 6]], 1.5, 17);
    }

    // ── Rubber-Hose Arms & White Gloves ──
    const armSwing = Math.cos(legPhase) * 6;
    const armY = bodyY - 2;

    if (splashing) {
      // Wind-up: arms throwing forward
      limbShaded(ctx, [CX - 9, armY], [CX - 13, armY - 4], 2.5, R_LIMB);
      limbShaded(ctx, [CX + 9, armY], [CX + 14, armY + 2], 2.5, R_LIMB);
      ellShaded(ctx, CX - 13, armY - 4, 3.5, 3.5, R_GLOVE);
      ellShaded(ctx, CX + 14, armY + 2, 3.5, 3.5, R_GLOVE);
    } else {
      // Cheery 50s bouncy arm swing
      limbShaded(ctx, [CX - 10, armY], [CX - 12 + armSwing, armY + 6], 2.5, R_LIMB);
      limbShaded(ctx, [CX + 10, armY], [CX + 12 - armSwing, armY + 6], 2.5, R_LIMB);
      ellShaded(ctx, CX - 12 + armSwing, armY + 6, 3.5, 3.5, R_GLOVE);
      ellShaded(ctx, CX + 12 - armSwing, armY + 6, 3.5, 3.5, R_GLOVE);
    }
  };
}

export function makeGasCanPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [
      gasCanFrame(dir, 0, { bob: 0 }),
      gasCanFrame(dir, 1, { bob: -1 }),
      gasCanFrame(dir, 2, { bob: 0 }),
      gasCanFrame(dir, 3, { bob: 1 }),
    ],
    walk: [
      gasCanFrame(dir, 0, { bob: -1.5, legPhase: 0 }),
      gasCanFrame(dir, 1, { bob: 1, legPhase: Math.PI * 0.5 }),
      gasCanFrame(dir, 2, { bob: -1.5, legPhase: Math.PI }),
      gasCanFrame(dir, 3, { bob: 1, legPhase: Math.PI * 1.5 }),
    ],
    attack: [
      gasCanFrame(dir, 0, { bob: 1 }),
      gasCanFrame(dir, 1, { bob: -2, splashing: true }),
      gasCanFrame(dir, 2, { bob: -1, splashing: true }),
      gasCanFrame(dir, 3, { bob: 0 }),
    ],
    death: [
      gasCanFrame(dir, 0, { deathT: 0.2 }),
      gasCanFrame(dir, 1, { deathT: 0.5 }),
      gasCanFrame(dir, 2, { deathT: 0.8 }),
      gasCanFrame(dir, 3, { deathT: 1.0, dead: true }),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
