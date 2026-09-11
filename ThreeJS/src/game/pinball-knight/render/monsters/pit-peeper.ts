/**
 * THE PIT PEEPER — an orange hairy lump monster with giant bloodshot googly eyes
 * sprouting out of its armpits, wearing tube socks.
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

const R_ORANGE: Ramp = [4, 5, 6];      // Vibrant hairy orange blob body
const R_WHITE: Ramp = [20, 21, 22];    // Eyes / tube socks
const R_RED: Ramp = [0, 1, 2];         // Bloodshot veins / sock stripes
const R_TEETH: Ramp = [16, 17, 24];    // Crooked yellow teeth
const R_STINK: Ramp = [8, 9, 10];      // Green toxic funk particles

interface PoseOpts {
  stalkWobble?: number;
  armFlap?: number;
  swingSock?: boolean;
  dead?: boolean;
  burstT?: number;
}

function pitPeeperFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { stalkWobble = 0, armFlap = 0, swingSock = false, dead = false, burstT = 0 } = opts;

    if (dead) {
      groundShadow(ctx, CX, GROUND, 20 * (1 - burstT * 0.5));
      // Stink smoke cloud and popped rubbery skin
      ellShaded(ctx, CX, GROUND - 10, Math.max(2, 16 * (1 - burstT)), Math.max(2, 6 * (1 - burstT)), R_ORANGE);
      figGlow(ctx, CX - 10 * burstT, GROUND - 16, 12 * burstT, R_STINK[1], R_STINK[2]);
      figGlow(ctx, CX + 10 * burstT, GROUND - 14, 10 * burstT, R_STINK[1], R_STINK[2]);
      figDetail(ctx, CX - 6, GROUND - 4, 3, 2, R_WHITE); // dropped tube sock
      return;
    }

    groundShadow(ctx, CX, GROUND, 18);

    // Stubby legs with striped tube socks
    ellShaded(ctx, CX - 8, GROUND - 4, 5, 4, R_WHITE);
    ellShaded(ctx, CX + 8, GROUND - 4, 5, 4, R_WHITE);
    figDetail(ctx, CX - 8, GROUND - 5, 4, 1, R_RED);
    figDetail(ctx, CX + 8, GROUND - 5, 4, 1, R_RED);

    // Pear-shaped hairy orange blob body
    const bodyBob = Math.sin(phase * Math.PI * 2) * 2;
    ellShaded(ctx, CX, GROUND - 18 + bodyBob, 16, 14, R_ORANGE);
    ellShaded(ctx, CX, GROUND - 28 + bodyBob, 12, 10, R_ORANGE);

    // Goofy mouth with yellow crooked teeth (no eyes on face!)
    ellShaded(ctx, CX, GROUND - 20 + bodyBob, 8, 4, [0, 0, 0]);
    figDetail(ctx, CX - 4, GROUND - 22 + bodyBob, 2, 2, R_TEETH);
    figDetail(ctx, CX + 2, GROUND - 21 + bodyBob, 3, 2, R_TEETH);

    // Armpit eyestalks (left & right)
    const leftStalkX = CX - 16;
    const rightStalkX = CX + 16;
    const stalkY = GROUND - 32 + bodyBob + stalkWobble * 3;

    // Eyestalk stalks
    ellShaded(ctx, leftStalkX + 4, GROUND - 22 + bodyBob, 3, 8, R_ORANGE);
    ellShaded(ctx, rightStalkX - 4, GROUND - 22 + bodyBob, 3, 8, R_ORANGE);

    // Big bloodshot googly eyes on top of stalks
    ellShaded(ctx, leftStalkX, stalkY, 6, 6, R_WHITE);
    ellShaded(ctx, rightStalkX, stalkY, 6, 6, R_WHITE);
    // Pupils
    figDetail(ctx, leftStalkX + 1, stalkY + 1, 2, 2, [0, 0, 0]);
    figDetail(ctx, rightStalkX - 1, stalkY + 1, 2, 2, [0, 0, 0]);
    // Bloodshot veins
    figDetail(ctx, leftStalkX - 3, stalkY - 1, 2, 1, R_RED);
    figDetail(ctx, rightStalkX + 2, stalkY - 1, 2, 1, R_RED);

    // Arms and Smelly Sock Weapon
    const armY = GROUND - 18 + bodyBob + armFlap * 4;
    ellShaded(ctx, CX - 14, armY, 4, 3, R_ORANGE);
    ellShaded(ctx, CX + 14, armY, 4, 3, R_ORANGE);

    if (swingSock) {
      // Swung tube sock flail forward
      figDetail(ctx, CX + 18, armY + 2, 10, 4, R_WHITE);
      figDetail(ctx, CX + 24, armY + 3, 3, 2, R_RED);
      // Stink sweat particles
      figDetail(ctx, CX + 20, armY - 6, 2, 2, R_STINK);
      figDetail(ctx, CX + 26, armY - 2, 2, 2, R_STINK);
    } else {
      // Held tube sock
      figDetail(ctx, CX + 15, armY + 4, 5, 4, R_WHITE);
      figDetail(ctx, CX + 16, armY + 6, 3, 2, R_RED);
    }
  };
}

export function makePitPeeperPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [
      pitPeeperFrame(dir, 0, { stalkWobble: 0 }),
      pitPeeperFrame(dir, 0.25, { stalkWobble: 1 }),
      pitPeeperFrame(dir, 0.5, { stalkWobble: 0 }),
      pitPeeperFrame(dir, 0.75, { stalkWobble: -1 }),
    ],
    walk: [
      pitPeeperFrame(dir, 0, { armFlap: -1, stalkWobble: -1 }),
      pitPeeperFrame(dir, 0.25, { armFlap: 0, stalkWobble: 0 }),
      pitPeeperFrame(dir, 0.5, { armFlap: 1, stalkWobble: 1 }),
      pitPeeperFrame(dir, 0.75, { armFlap: 0, stalkWobble: 0 }),
    ],
    attack: [
      pitPeeperFrame(dir, 0, { armFlap: -1, swingSock: false }),
      pitPeeperFrame(dir, 0.3, { armFlap: 1, swingSock: true }),
      pitPeeperFrame(dir, 0.6, { armFlap: 2, swingSock: true }),
      pitPeeperFrame(dir, 0.9, { armFlap: 0, swingSock: false }),
    ],
    stumble: [
      pitPeeperFrame(dir, 0.2, { stalkWobble: 2, armFlap: -2 }),
      pitPeeperFrame(dir, 0.6, { stalkWobble: -2, armFlap: 2 }),
    ],
    death: [
      pitPeeperFrame(dir, 0.1, { burstT: 0.2, dead: false }),
      pitPeeperFrame(dir, 0.4, { burstT: 0.5, dead: true }),
      pitPeeperFrame(dir, 0.7, { burstT: 0.8, dead: true }),
      pitPeeperFrame(dir, 1.0, { burstT: 1.0, dead: true }),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
