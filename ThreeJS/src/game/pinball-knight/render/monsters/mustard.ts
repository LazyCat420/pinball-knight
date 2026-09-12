/**
 * MUSTARD MONSTER ("Colonel Dijon" / Mister Yellow)
 *
 * Living retro diner yellow squeeze bottle with ribbed plastic body, yellow screw cap,
 * conical squirt nozzle, sharp angled cartoon eyes, and spicy stadium mustard attacks.
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
// Bottle: Vibrant golden stadium mustard yellow
const R_MUSTARD: Ramp = [14, 15, 16];
// Cap: Slightly darker yellow plastic
const R_CAP: Ramp = [15, 16, 27];
// Sneakers: White
const R_WHITE: Ramp = [20, 21, 22];
// Outlines / Eyes: Charcoal black
const R_CHAR: Ramp = [0, 1, 2];

interface PoseOpts {
  bob?: number;
  tilt?: number;
  jet?: number; // 0..1 attack progress
  burst?: number; // 0..1 death splatter progress
  dead?: boolean;
}

function mustardFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { bob = 0, tilt = 0, jet = 0, burst = 0, dead = false } = opts;

    if (dead || burst > 0) {
      // Death splatter: bottle pops, yellow mustard puddle spreads
      const t = Math.min(1, Math.max(0, burst));
      const puddleR = 16 + t * 16;
      const puddleH = 5 + t * 5;

      // Slick yellow mustard puddle on ground
      ellShaded(ctx, CX, GROUND - 3, puddleR * 2, puddleH * 2, R_MUSTARD);
      figGlow(ctx, CX - 5, GROUND - 4, 3, 14, 15);
      figGlow(ctx, CX + 6, GROUND - 2, 2, 14, 15);

      if (t < 0.85) {
        const scale = 1 - t * 0.7;
        ctx.save();
        ctx.translate(CX, GROUND - 6);
        ctx.scale(scale, scale);
        // Popped cap
        ellShaded(ctx, 14, -6, 10, 8, R_CAP);
        // Deflated bottle body
        ellShaded(ctx, -6, -2, 26, 14, R_MUSTARD);
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

    // Main Yellow Bottle Body
    const squash = jet > 0 ? Math.sin(jet * Math.PI) * 5 : 0;
    const bWidth = 22 + squash;
    const bHeight = 44 - squash;
    ellShaded(ctx, 0, -2, bWidth, bHeight, R_MUSTARD);

    // Ribbed grip rings on squeeze bottle
    figDetail(ctx, [[-7, -8], [7, -8]], 2, R_MUSTARD[1]);
    figDetail(ctx, [[-8, 2], [8, 2]], 2, R_MUSTARD[1]);
    figDetail(ctx, [[-7, 10], [7, 10]], 2, R_MUSTARD[1]);

    // Yellow Screw Cap & Conical squirt nozzle tip
    ellShaded(ctx, 0, -24, 14, 8, R_CAP);
    ellShaded(ctx, 0, -30, 7, 10, R_CAP);

    // Sharp Determined Eyes
    const eyeY = -12;
    ellShaded(ctx, -4, eyeY, 6, 7, R_WHITE);
    ellShaded(ctx, 4, eyeY, 6, 7, R_WHITE);
    const pupilX = dir === "E" ? 1 : 0;
    figDetail(ctx, [[-4 + pupilX, eyeY], [-4 + pupilX, eyeY]], 2, R_CHAR[0]);
    figDetail(ctx, [[4 + pupilX, eyeY], [4 + pupilX, eyeY]], 2, R_CHAR[0]);

    // Determined smirking mouth
    figDetail(ctx, [[-2, -4], [4, -3]], 2, R_CHAR[0]);

    // High-Pressure Mustard Jet Attack
    if (jet > 0) {
      const jetLen = 16 + jet * 28;
      const aimDir = dir === "E" ? 1 : -1;
      ellShaded(ctx, aimDir * (jetLen / 2 + 6), -30 - jet * 3, jetLen, 7, R_MUSTARD);
      figGlow(ctx, aimDir * (jetLen + 6), -30 - jet * 3, 5, 14, 15);
    }

    ctx.restore();
  };
}

export function makeMustardPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [
      mustardFrame(dir, 0, { bob: 0 }),
      mustardFrame(dir, 0.25, { bob: -1 }),
      mustardFrame(dir, 0.5, { bob: -2 }),
      mustardFrame(dir, 0.75, { bob: -1 }),
    ],
    walk: [
      mustardFrame(dir, 0, { tilt: -0.08, bob: -1 }),
      mustardFrame(dir, 0.25, { tilt: 0, bob: 2 }),
      mustardFrame(dir, 0.5, { tilt: 0.08, bob: -1 }),
      mustardFrame(dir, 0.75, { tilt: 0, bob: 2 }),
    ],
    attack: [
      mustardFrame(dir, 0, { jet: 0.1, bob: -2 }),
      mustardFrame(dir, 0.3, { jet: 0.6, bob: 1 }),
      mustardFrame(dir, 0.6, { jet: 1.0, bob: 2 }),
      mustardFrame(dir, 0.9, { jet: 0.3, bob: 0 }),
    ],
    death: [
      mustardFrame(dir, 0, { burst: 0.2 }),
      mustardFrame(dir, 0.3, { burst: 0.5 }),
      mustardFrame(dir, 0.6, { burst: 0.8 }),
      mustardFrame(dir, 1.0, { burst: 1.0, dead: true }),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
