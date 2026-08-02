/**
 * FISH_FEET — a fish monster walking on white Converse canvas sneakers with a cigarette.
 */
import {
  type Pt,
  type Ramp,
  CX,
  GROUND,
  limbShaded,
  ellShaded,
  detail as figDetail,
  glow as figGlow,
  groundShadow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

// Materials
const R_FISH_BACK: Ramp = [7, 8, 9];
const R_FISH_BELLY: Ramp = [19, 20, 21];
const R_SHOE_WHITE: Ramp = [22, 23, 24];
const R_CIG: Ramp = [14, 15, 16];

interface Pose {
  phase: number;
  walkStep?: number;
  kick?: boolean;
  dead?: boolean;
}

function fishFeetFrame(dir: Dir, pose: Pose): FramePaint {
  return (ctx) => {
    const breath = Math.sin(pose.phase * Math.PI) * 1.5;
    const cy = GROUND - 32 + breath;
    const bodyW = 28;
    const bodyH = 16;

    groundShadow(ctx, CX, GROUND + 2, 26);

    // Shoes
    const step = pose.walkStep ?? 0;
    const leftFootX = CX - 12 + (step % 2 === 0 ? -4 : 4);
    const rightFootX = CX + 12 + (step % 2 === 0 ? 4 : -4);

    for (const fx of [leftFootX, rightFootX]) {
      ellShaded(ctx, fx, GROUND - 6, 12, 6, R_SHOE_WHITE);
      figDetail(ctx, [[fx - 10, GROUND - 2], [fx + 10, GROUND - 2]], 2, 1);
    }

    // Legs
    limbShaded(ctx, [CX - 8, cy + 6], [leftFootX, GROUND - 8], 5, R_SHOE_WHITE);
    limbShaded(ctx, [CX + 8, cy + 6], [rightFootX, GROUND - 8], 5, R_SHOE_WHITE);

    if (pose.dead) {
      ellShaded(ctx, CX, GROUND - 8, bodyW, bodyH, R_FISH_BACK);
      // X Eye
      figDetail(ctx, [[CX + 10, GROUND - 12], [CX + 18, GROUND - 4]], 2, 1);
      figDetail(ctx, [[CX + 18, GROUND - 12], [CX + 10, GROUND - 4]], 2, 1);
      return;
    }

    // Body
    ellShaded(ctx, CX, cy, bodyW, bodyH, R_FISH_BACK);
    // Belly
    ellShaded(ctx, CX, cy + 4, bodyW * 0.7, bodyH * 0.5, R_FISH_BELLY);

    // Eye
    ellShaded(ctx, CX + 12, cy - 4, 4, 4, [22, 22, 22] as Ramp);

    // Cigarette
    figDetail(ctx, [[CX + 18, cy + 2], [CX + 28, cy + 2]], 2.5, R_CIG[1]);
    figGlow(ctx, CX + 29, cy + 2, 2, 13, 17);

    // Kick Attack
    if (pose.kick) {
      figDetail(ctx, [[CX + 10, cy], [CX + 34, cy - 4]], 3, 17);
    }
  };
}

export function makeFishFeetPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [fishFeetFrame(dir, { phase: 0 }), fishFeetFrame(dir, { phase: 0.5 })],
    walk: [
      fishFeetFrame(dir, { phase: 0, walkStep: 0 }),
      fishFeetFrame(dir, { phase: 0.25, walkStep: 1 }),
      fishFeetFrame(dir, { phase: 0.5, walkStep: 2 }),
      fishFeetFrame(dir, { phase: 0.75, walkStep: 3 }),
    ],
    attack: [
      fishFeetFrame(dir, { phase: 0, kick: false }),
      fishFeetFrame(dir, { phase: 0.5, kick: true }),
      fishFeetFrame(dir, { phase: 0, kick: false }),
    ],
    death: [
      fishFeetFrame(dir, { phase: 0, dead: true }),
      fishFeetFrame(dir, { phase: 0.5, dead: true }),
    ],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
