/**
 * HOTDOG MONSTER ("Franken-Frank" / Glizzy Goliath)
 *
 * Plump ballpark frankfurter inside a toasted split bun with mustard zigzag,
 * emerald relish chunks, cartoon eyes, and mustard cannon attack.
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
// Bun: Warm golden toasted bakery ramp
const R_BUN: Ramp = [26, 27, 24];
// Frankfurter: Savory grilled wiener red-brown
const R_FRANK: Ramp = [1, 2, 3];
// Mustard: Vibrant stadium neon yellow
const R_MUSTARD: Ramp = [14, 15, 16];
// Relish: Emerald pickle relish chunks
const R_RELISH: Ramp = [6, 7, 8];
// Eyes / Sesame seeds: White & black
const R_WHITE: Ramp = [20, 21, 22];
const R_CHAR: Ramp = [0, 1, 2];

interface PoseOpts {
  bob?: number;
  tilt?: number;
  blast?: number; // 0..1 attack progress
  burst?: number; // 0..1 death splatter progress
  dead?: boolean;
}

function hotdogFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { bob = 0, tilt = 0, blast = 0, burst = 0, dead = false } = opts;

    if (dead || burst > 0) {
      // Death splatter: bun cracks, frank splits, mustard & relish puddle
      const t = Math.min(1, Math.max(0, burst));
      const puddleR = 16 + t * 16;
      const puddleH = 6 + t * 5;

      // Mustard & relish condiment puddle on ground
      ellShaded(ctx, CX, GROUND - 3, puddleR * 2, puddleH * 2, R_MUSTARD);
      ellShaded(ctx, CX, GROUND - 3, puddleR * 1.4, puddleH * 1.4, R_RELISH);
      figGlow(ctx, CX - 5, GROUND - 4, 3, 14, 15);
      figGlow(ctx, CX + 7, GROUND - 2, 3, 6, 7);

      if (t < 0.85) {
        // Splintered bun halves and frank remnants
        const scale = 1 - t * 0.65;
        // Left bun half
        ellShaded(ctx, CX - 14 * scale, GROUND - 8 * scale, 16 * scale, 12 * scale, R_BUN);
        // Right bun half
        ellShaded(ctx, CX + 14 * scale, GROUND - 8 * scale, 16 * scale, 12 * scale, R_BUN);
        // Snapped sausage piece
        ellShaded(ctx, CX, GROUND - 10 * scale, 12 * scale, 8 * scale, R_FRANK);
      }
      return;
    }

    // Ground shadow
    const baseY = GROUND - 24 + bob;
    groundShadow(ctx, CX, GROUND + 2, 26);

    ctx.save();
    ctx.translate(CX, baseY);
    if (tilt !== 0) {
      ctx.rotate(tilt);
    }

    // Stubby Bun Feet
    const footBob = Math.sin(phase * Math.PI * 2) * 3;
    ellShaded(ctx, -8, 22 - footBob, 10, 6, R_BUN);
    ellShaded(ctx, 8, 22 + footBob, 10, 6, R_BUN);

    // Outer Back Bun
    ellShaded(ctx, 0, 0, 32, 44, R_BUN);

    // Grilled Frankfurter Body
    const blastSquash = blast > 0 ? Math.sin(blast * Math.PI) * 4 : 0;
    ellShaded(ctx, 0, -2 - blastSquash, 18 + blastSquash * 0.5, 46, R_FRANK);

    // Char grill lines across wiener
    figDetail(ctx, [[-6, -12], [6, -10]], 2, R_CHAR[0]);
    figDetail(ctx, [[-6, -2], [6, 0]], 2, R_CHAR[0]);
    figDetail(ctx, [[-6, 8], [6, 10]], 2, R_CHAR[0]);

    // Relish flecks
    figDetail(ctx, [[-4, -8], [-2, -6]], 3, R_RELISH[1]);
    figDetail(ctx, [[3, 2], [5, 4]], 3, R_RELISH[1]);
    figDetail(ctx, [[-3, 12], [-1, 14]], 3, R_RELISH[1]);

    // Mustard Zigzag Stream
    figDetail(
      ctx,
      [
        [0, -18],
        [-5, -14],
        [5, -8],
        [-5, -2],
        [5, 4],
        [-5, 10],
        [0, 16],
      ],
      3,
      R_MUSTARD[0]
    );

    // Front Bun Lip
    ellShaded(ctx, -10, 2, 12, 40, R_BUN);
    ellShaded(ctx, 10, 2, 12, 40, R_BUN);

    // Sesame seeds on outer bun folds
    figDetail(ctx, [[-12, -10], [-11, -10]], 2, R_WHITE[2]);
    figDetail(ctx, [[-13, 4], [-12, 4]], 2, R_WHITE[2]);
    figDetail(ctx, [[12, -8], [13, -8]], 2, R_WHITE[2]);
    figDetail(ctx, [[11, 6], [12, 6]], 2, R_WHITE[2]);

    // Googly Cartoon Eyes
    const eyeY = -18;
    // Eye whites
    ellShaded(ctx, -4, eyeY, 6, 7, R_WHITE);
    ellShaded(ctx, 4, eyeY, 6, 7, R_WHITE);
    // Pupils looking in direction
    const pupilX = dir === "E" ? 1 : 0;
    figDetail(ctx, [[-4 + pupilX, eyeY], [-4 + pupilX, eyeY]], 2, R_CHAR[0]);
    figDetail(ctx, [[4 + pupilX, eyeY], [4 + pupilX, eyeY]], 2, R_CHAR[0]);

    // Mouth / Condiment Cannon
    if (blast > 0) {
      // Mouth open wide firing mustard jet!
      const mouthY = -10;
      ellShaded(ctx, 0, mouthY, 10, 8, R_CHAR);
      // Mustard stream jet projecting forward
      const jetLen = 14 + blast * 20;
      const jetDir = dir === "E" ? 1 : -1;
      ellShaded(ctx, jetDir * (jetLen / 2 + 6), mouthY, jetLen, 8, R_MUSTARD);
      figGlow(ctx, jetDir * (jetLen + 4), mouthY, 4, 14, 15);
    } else {
      // Goofy grin
      figDetail(ctx, [[-3, -9], [3, -9]], 2, R_CHAR[0]);
    }

    ctx.restore();
  };
}

export function makeHotdogPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [
      hotdogFrame(dir, 0, { bob: 0 }),
      hotdogFrame(dir, 0.25, { bob: -1 }),
      hotdogFrame(dir, 0.5, { bob: -2 }),
      hotdogFrame(dir, 0.75, { bob: -1 }),
    ],
    walk: [
      hotdogFrame(dir, 0, { tilt: -0.08, bob: -1 }),
      hotdogFrame(dir, 0.25, { tilt: 0, bob: 2 }),
      hotdogFrame(dir, 0.5, { tilt: 0.08, bob: -1 }),
      hotdogFrame(dir, 0.75, { tilt: 0, bob: 2 }),
    ],
    attack: [
      hotdogFrame(dir, 0, { blast: 0.1, bob: -2 }),
      hotdogFrame(dir, 0.3, { blast: 0.6, bob: 1 }),
      hotdogFrame(dir, 0.6, { blast: 1.0, bob: 2 }),
      hotdogFrame(dir, 0.9, { blast: 0.3, bob: 0 }),
    ],
    death: [
      hotdogFrame(dir, 0, { burst: 0.2 }),
      hotdogFrame(dir, 0.3, { burst: 0.5 }),
      hotdogFrame(dir, 0.6, { burst: 0.8 }),
      hotdogFrame(dir, 1.0, { burst: 1.0, dead: true }),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
