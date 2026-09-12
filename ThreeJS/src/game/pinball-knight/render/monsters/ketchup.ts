/**
 * KETCHUP MONSTER ("Baron von Ketchup" / Sir Squirt)
 *
 * Living retro diner red squeeze bottle with ribbed plastic body, white screw cap,
 * conical squirt nozzle, googly cartoon eyes, and sticky tomato paste attacks.
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
// Bottle: Rich crimson tomato ketchup red
const R_KETCHUP: Ramp = [2, 3, 4];
// Cap / Sneakers: White plastic
const R_WHITE: Ramp = [20, 21, 22];
// Eyes / Pupils / Outlines: Charcoal black
const R_CHAR: Ramp = [0, 1, 2];
// Highlights: Bright tomato reflection
const R_HILITE: Ramp = [1, 2, 3];

interface PoseOpts {
  bob?: number;
  tilt?: number;
  squirt?: number; // 0..1 attack progress
  burst?: number; // 0..1 death splatter progress
  dead?: boolean;
}

function ketchupFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { bob = 0, tilt = 0, squirt = 0, burst = 0, dead = false } = opts;

    if (dead || burst > 0) {
      // Death splatter: bottle collapses, cap pops, sticky tomato puddle
      const t = Math.min(1, Math.max(0, burst));
      const puddleR = 15 + t * 15;
      const puddleH = 5 + t * 5;

      // Sticky red tomato puddle on ground
      ellShaded(ctx, CX, GROUND - 3, puddleR * 2, puddleH * 2, R_KETCHUP);
      figGlow(ctx, CX - 4, GROUND - 4, 3, 2, 3);
      figGlow(ctx, CX + 6, GROUND - 2, 2, 2, 3);

      if (t < 0.85) {
        const scale = 1 - t * 0.7;
        ctx.save();
        ctx.translate(CX, GROUND - 6);
        ctx.scale(scale, scale);
        // Popped cap
        ellShaded(ctx, 14, -6, 10, 8, R_WHITE);
        // Deflated bottle body
        ellShaded(ctx, -6, -2, 26, 14, R_KETCHUP);
        ctx.restore();
      }
      return;
    }

    // Live bottle
    groundShadow(ctx, CX, GROUND, 14);

    ctx.save();
    ctx.translate(CX, GROUND - 18 + bob);
    if (tilt !== 0) ctx.rotate(tilt);

    // Sneakers
    const legPhase = Math.sin(phase * Math.PI * 2);
    const leftFootY = 16 + (legPhase > 0 ? -legPhase * 4 : 0);
    const rightFootY = 16 + (legPhase < 0 ? legPhase * 4 : 0);
    ellShaded(ctx, -7, leftFootY, 11, 7, R_WHITE);
    ellShaded(ctx, 7, rightFootY, 11, 7, R_WHITE);

    // Main Red Bottle Body (compressed during squirt attack)
    const squash = squirt > 0 ? Math.sin(squirt * Math.PI) * 4 : 0;
    const bWidth = 22 + squash;
    const bHeight = 44 - squash;
    ellShaded(ctx, 0, -2, bWidth, bHeight, R_KETCHUP);

    // Ribbed grip rings on squeeze bottle
    figDetail(ctx, [[-7, -8], [7, -8]], 2, R_KETCHUP[0]);
    figDetail(ctx, [[-8, 2], [8, 2]], 2, R_KETCHUP[0]);
    figDetail(ctx, [[-7, 10], [7, 10]], 2, R_KETCHUP[0]);

    // White Screw Cap
    ellShaded(ctx, 0, -24, 14, 8, R_WHITE);
    // Conical squirt nozzle tip
    ellShaded(ctx, 0, -30, 7, 10, R_WHITE);

    // Googly Eyes
    const eyeY = -12;
    ellShaded(ctx, -4, eyeY, 6, 7, R_WHITE);
    ellShaded(ctx, 4, eyeY, 6, 7, R_WHITE);
    const pupilX = dir === "E" ? 1 : dir === "S" ? 0 : 0;
    figDetail(ctx, [[-4 + pupilX, eyeY], [-4 + pupilX, eyeY]], 2, R_CHAR[0]);
    figDetail(ctx, [[4 + pupilX, eyeY], [4 + pupilX, eyeY]], 2, R_CHAR[0]);

    // Mouth / Smile
    figDetail(ctx, [[-3, -4], [3, -4]], 2, R_CHAR[0]);

    // Squirting Arc Attack
    if (squirt > 0) {
      const squirtLen = 14 + squirt * 24;
      const aimDir = dir === "E" ? 1 : -1;
      ellShaded(ctx, aimDir * (squirtLen / 2 + 6), -30 - squirt * 4, squirtLen, 8, R_KETCHUP);
      figGlow(ctx, aimDir * (squirtLen + 6), -30 - squirt * 4, 5, 2, 3);
    }

    ctx.restore();
  };
}

export function makeKetchupPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [
      ketchupFrame(dir, 0, { bob: 0 }),
      ketchupFrame(dir, 0.25, { bob: -1 }),
      ketchupFrame(dir, 0.5, { bob: -2 }),
      ketchupFrame(dir, 0.75, { bob: -1 }),
    ],
    walk: [
      ketchupFrame(dir, 0, { tilt: -0.08, bob: -1 }),
      ketchupFrame(dir, 0.25, { tilt: 0, bob: 2 }),
      ketchupFrame(dir, 0.5, { tilt: 0.08, bob: -1 }),
      ketchupFrame(dir, 0.75, { tilt: 0, bob: 2 }),
    ],
    attack: [
      ketchupFrame(dir, 0, { squirt: 0.1, bob: -2 }),
      ketchupFrame(dir, 0.3, { squirt: 0.6, bob: 1 }),
      ketchupFrame(dir, 0.6, { squirt: 1.0, bob: 2 }),
      ketchupFrame(dir, 0.9, { squirt: 0.3, bob: 0 }),
    ],
    death: [
      ketchupFrame(dir, 0, { burst: 0.2 }),
      ketchupFrame(dir, 0.3, { burst: 0.5 }),
      ketchupFrame(dir, 0.6, { burst: 0.8 }),
      ketchupFrame(dir, 1.0, { burst: 1.0, dead: true }),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
