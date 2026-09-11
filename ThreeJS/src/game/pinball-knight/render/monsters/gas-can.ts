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
      const collapseY = GROUND - 8 + t * 4;

      // Spilled oil puddle expanding on ground
      const oilR = 18 + t * 24;
      ellShaded(ctx, CX + 2, collapseY + 4, oilR, 8 + t * 4, R_OIL);

      // Canister lying on side
      groundShadow(ctx, CX, GROUND, 24);
      ellShaded(ctx, CX + t * 4, collapseY, 24, 14, R_CAN_RED, 0.75 + t * 0.4);

      // Detached spout & lid
      ellShaded(ctx, CX + 26 + t * 6, collapseY - 4, 10, 6, R_SPOUT, 0.3);

      // Dizzy 'X' eyes on fallen can
      ellShaded(ctx, CX + t * 4 - 6, collapseY - 2, 5, 4, R_GLOVE, 0);
      ellShaded(ctx, CX + t * 4 + 6, collapseY - 2, 5, 4, R_GLOVE, 0);
      return;
    }

    const yOff = bob;
    const bodyY = GROUND - 32 + yOff;

    // Ground shadow pulses with bounce
    groundShadow(ctx, CX, GROUND, Math.max(12, 24 - Math.abs(yOff) * 2));

    // ── Noodle Legs & Shoes ──
    const leftLegSwing = Math.sin(legPhase) * 8;
    const rightLegSwing = -Math.sin(legPhase) * 8;

    const leftFootY = GROUND - 4 + Math.max(0, -leftLegSwing * 0.5);
    const rightFootY = GROUND - 4 + Math.max(0, -rightLegSwing * 0.5);

    // Left leg
    limbShaded(ctx, [CX - 10, bodyY + 18], [CX - 12 + leftLegSwing, leftFootY], 4.5, R_LIMB);
    // Right leg
    limbShaded(ctx, [CX + 10, bodyY + 18], [CX + 12 + rightLegSwing, rightFootY], 4.5, R_LIMB);

    // Cartoon Shoes
    ellShaded(ctx, CX - 12 + leftLegSwing + (dir === "E" ? 3 : dir === "S" ? -2 : 0), leftFootY, 10, 6, R_SHOE);
    ellShaded(ctx, CX + 12 + rightLegSwing + (dir === "E" ? 3 : dir === "S" ? 2 : 0), rightFootY, 10, 6, R_SHOE);

    // ── Main Gasoline Canister Body ──
    // Slightly trapezoidal vintage red can (squash & stretch)
    const stretch = 1 + (yOff > 0 ? 0.05 : -0.05);
    const squish = 1 / stretch;

    ellShaded(ctx, CX, bodyY + 4, 22 * squish, 24 * stretch, R_CAN_RED, dir === "E" ? 0.08 : 0);

    // Top metal handle
    ellShaded(ctx, CX, bodyY - 18, 14, 6, R_HANDLE, 0);
    ellShaded(ctx, CX, bodyY - 18, 8, 3, R_CAN_RED, 0);

    // Yellow Spout angled out the side
    const spoutX = dir === "E" ? CX + 18 : dir === "S" ? CX + 16 : CX - 16;
    const spoutY = bodyY - 14;
    ellShaded(ctx, spoutX, spoutY, 10, 6, R_SPOUT, dir === "E" ? 0.6 : dir === "S" ? 0.45 : -0.45);

    // Splashing fuel stream during attack
    if (splashing) {
      const splashEndX = spoutX + (dir === "E" ? 22 : dir === "S" ? 16 : -16);
      const splashEndY = spoutY + 12;
      limbShaded(ctx, [spoutX, spoutY], [splashEndX, splashEndY], 6, R_OIL);
      ellShaded(ctx, splashEndX, splashEndY + 4, 8, 5, R_OIL, 0);
    }

    // ── 1950s Toon Face (if facing South or East) ──
    if (dir === "S" || dir === "E") {
      const faceOffX = dir === "E" ? 5 : 0;
      const eyeY = bodyY - 2;

      // Big white oval cartoon eye background
      ellShaded(ctx, CX - 7 + faceOffX, eyeY, 7.0, 10.0, R_GLOVE, -0.05);
      ellShaded(ctx, CX + 7 + faceOffX, eyeY, 7.0, 10.0, R_GLOVE, 0.05);

      // Classic pie-cut black pupils
      ellShaded(ctx, CX - 6 + faceOffX, eyeY, 4.0, 5.0, R_LIMB, 0);
      ellShaded(ctx, CX + 6 + faceOffX, eyeY, 4.0, 5.0, R_LIMB, 0);

      // Huge cartoon smile grin with cheek curves
      const smileY = bodyY + 12;
      ellShaded(ctx, CX + faceOffX, smileY, 13.0, 7.0, R_CAN_RED, 0);
      ellShaded(ctx, CX + faceOffX, smileY + 2, 9.0, 4.0, R_LIMB, 0);
    } else {
      // Back of canister seams
      ellShaded(ctx, CX, bodyY + 2, 5, 20, R_CAN_RED, 0);
    }

    // ── Rubber-Hose Arms & White Gloves ──
    const armSwing = Math.cos(legPhase) * 10;
    const armY = bodyY - 4;

    if (splashing) {
      // Wind-up: arms throwing forward
      limbShaded(ctx, [CX - 18, armY], [CX - 24, armY - 8], 5.0, R_LIMB);
      limbShaded(ctx, [CX + 18, armY], [CX + 26, armY + 4], 5.0, R_LIMB);
      ellShaded(ctx, CX - 24, armY - 8, 8.0, 8.0, R_GLOVE);
      ellShaded(ctx, CX + 26, armY + 4, 8.0, 8.0, R_GLOVE);
    } else {
      // Cheery 50s bouncy arm swing
      limbShaded(ctx, [CX - 18, armY], [CX - 22 + armSwing, armY + 12], 5.0, R_LIMB);
      limbShaded(ctx, [CX + 18, armY], [CX + 22 - armSwing, armY + 12], 5.0, R_LIMB);
      ellShaded(ctx, CX - 22 + armSwing, armY + 12, 8.0, 8.0, R_GLOVE);
      ellShaded(ctx, CX + 22 - armSwing, armY + 12, 8.0, 8.0, R_GLOVE);
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
