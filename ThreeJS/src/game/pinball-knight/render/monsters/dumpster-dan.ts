/**
 * DUMPSTER DAN — living green municipal trashbag gremlin wearing a backwards baseball cap
 * and wielding a ballpark hotdog club.
 */
import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  groundShadow,
  glow as figGlow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

const figDetail = (ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, m: Ramp | number) =>
  ellShaded(ctx, x, y, Math.max(1, rx), Math.max(1, ry), m);

const R_BAG: Ramp = [8, 9, 10];        // Heavy duty green trash bag
const R_CAP: Ramp = [0, 1, 2];         // Red trucker/baseball cap
const R_HOTDOG: Ramp = [4, 5, 16];     // Hotdog bun and wiener
const R_MUSTARD: Ramp = [16, 17, 24];  // Yellow mustard & teeth
const R_CAN: Ramp = [20, 21, 22];      // Aluminum soda cans

interface PoseOpts {
  crinkle?: number;
  runBob?: number;
  swingHotdog?: boolean;
  burstT?: number;
  dead?: boolean;
}

function dumpsterDanFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { crinkle = 0, runBob = 0, swingHotdog = false, burstT = 0, dead = false } = opts;

    if (dead) {
      groundShadow(ctx, CX, GROUND, 24);
      // Deflated flat bag with torn seam
      ellShaded(ctx, CX, GROUND - 4, 18, 5, R_BAG);
      // Fallen red cap
      ellShaded(ctx, CX - 12, GROUND - 4, 5, 3, R_CAP);
      // Spilled soda cans & trash
      figDetail(ctx, CX + 8, GROUND - 6, 4, 2, R_CAN);
      figDetail(ctx, CX + 14, GROUND - 4, 3, 2, R_CAN);
      figDetail(ctx, CX - 4, GROUND - 7, 2, 2, R_MUSTARD);
      return;
    }

    groundShadow(ctx, CX, GROUND, 20);

    // Short stubby green bag feet
    ellShaded(ctx, CX - 7, GROUND - 3, 4, 3, R_BAG);
    ellShaded(ctx, CX + 7, GROUND - 3, 4, 3, R_BAG);

    // Chunky trashbag body with wrinkly crinkles
    const bob = Math.sin(phase * Math.PI * 2) * 1.5 + runBob;
    ellShaded(ctx, CX, GROUND - 16 + bob, 15 + crinkle, 13 - crinkle, R_BAG);
    // Tied knot top
    ellShaded(ctx, CX, GROUND - 29 + bob, 6, 5, R_BAG);
    figDetail(ctx, CX - 2, GROUND - 33 + bob, 4, 3, R_BAG);

    // Backwards red baseball cap resting crookedly on bag knot
    ellShaded(ctx, CX, GROUND - 30 + bob, 8, 4, R_CAP);
    figDetail(ctx, CX + 4, GROUND - 29 + bob, 5, 2, R_CAP); // visor sticking back

    // Googly eyes on belly
    ellShaded(ctx, CX - 5, GROUND - 18 + bob, 4, 4, R_CAN);
    ellShaded(ctx, CX + 5, GROUND - 17 + bob, 3, 3, R_CAN);
    figDetail(ctx, CX - 5, GROUND - 18 + bob, 2, 2, [0, 0, 0]);
    figDetail(ctx, CX + 5, GROUND - 17 + bob, 1, 1, [0, 0, 0]);

    // Crooked yellow zipper mouth
    ellShaded(ctx, CX, GROUND - 11 + bob, 7, 3, [0, 0, 0]);
    figDetail(ctx, CX - 4, GROUND - 11 + bob, 2, 1, R_MUSTARD);
    figDetail(ctx, CX, GROUND - 10 + bob, 2, 1, R_MUSTARD);
    figDetail(ctx, CX + 3, GROUND - 11 + bob, 2, 1, R_MUSTARD);

    // Hands and Ballpark Hotdog club
    const armY = GROUND - 16 + bob;
    ellShaded(ctx, CX - 13, armY, 3, 3, R_BAG);
    ellShaded(ctx, CX + 13, armY, 3, 3, R_BAG);

    if (swingHotdog) {
      // Hotdog club raised / swung down
      ellShaded(ctx, CX + 18, armY - 4, 8, 4, R_HOTDOG);
      figDetail(ctx, CX + 18, armY - 5, 7, 1, R_MUSTARD); // yellow mustard line
    } else {
      // Resting hotdog
      ellShaded(ctx, CX + 14, armY - 2, 5, 3, R_HOTDOG);
      figDetail(ctx, CX + 14, armY - 3, 4, 1, R_MUSTARD);
    }
  };
}

export function makeDumpsterDanPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [
      dumpsterDanFrame(dir, 0, { crinkle: 0 }),
      dumpsterDanFrame(dir, 0.25, { crinkle: 1 }),
      dumpsterDanFrame(dir, 0.5, { crinkle: 0 }),
      dumpsterDanFrame(dir, 0.75, { crinkle: -1 }),
    ],
    walk: [
      dumpsterDanFrame(dir, 0, { runBob: -1, crinkle: 1 }),
      dumpsterDanFrame(dir, 0.25, { runBob: 0, crinkle: 0 }),
      dumpsterDanFrame(dir, 0.5, { runBob: 1, crinkle: -1 }),
      dumpsterDanFrame(dir, 0.75, { runBob: 0, crinkle: 0 }),
    ],
    attack: [
      dumpsterDanFrame(dir, 0, { swingHotdog: false, runBob: -1 }),
      dumpsterDanFrame(dir, 0.3, { swingHotdog: true, runBob: 1 }),
      dumpsterDanFrame(dir, 0.6, { swingHotdog: true, runBob: 2 }),
      dumpsterDanFrame(dir, 0.9, { swingHotdog: false, runBob: 0 }),
    ],
    stumble: [
      dumpsterDanFrame(dir, 0.2, { crinkle: 2, runBob: -2 }),
      dumpsterDanFrame(dir, 0.6, { crinkle: -2, runBob: 2 }),
    ],
    death: [
      dumpsterDanFrame(dir, 0.1, { burstT: 0.3, dead: false }),
      dumpsterDanFrame(dir, 0.4, { burstT: 0.6, dead: true }),
      dumpsterDanFrame(dir, 0.7, { burstT: 0.9, dead: true }),
      dumpsterDanFrame(dir, 1.0, { burstT: 1.0, dead: true }),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
