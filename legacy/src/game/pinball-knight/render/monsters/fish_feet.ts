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

// Materials matching Cold Crypt palette:
// Steel/Silver ramp for fish body: 20=steel-dark, 21=steel-mid, 22=steel-light
const R_FISH_BACK: Ramp = [19, 20, 21];
const R_FISH_BELLY: Ramp = [21, 22, 22];
// Skin ramp for human legs: 23=skin-dark, 24=skin-mid, 25=skin-light
const R_LEGS: Ramp = [23, 24, 25];
// White Converse high-top canvas sneakers: 21=sole-dark, 22=white-canvas, 22=highlight
const R_SHOE_WHITE: Ramp = [20, 21, 22];
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
    const cy = GROUND - 36 + breath;
    const bodyW = 34;
    const bodyH = 18;

    groundShadow(ctx, CX, GROUND + 2, 26);

    // Feet & Shoes (White Converse Canvas High-Tops)
    const step = pose.walkStep ?? 0;
    const leftFootX = CX - 14 + (step % 2 === 0 ? -6 : 6);
    const rightFootX = pose.kick ? CX + 24 : CX + 12 + (step % 2 === 0 ? 6 : -6);
    const rightFootY = pose.kick ? cy - 2 : GROUND - 8;

    // Legs (Human skin tone)
    limbShaded(ctx, [CX - 8, cy + 6], [leftFootX, GROUND - 10], 6, R_LEGS);
    limbShaded(ctx, [CX + 8, cy + 6], [rightFootX, rightFootY], 6, R_LEGS);

    // Left Shoe
    ellShaded(ctx, leftFootX, GROUND - 6, 14, 7, R_SHOE_WHITE);
    figDetail(ctx, [[leftFootX - 12, GROUND - 2], [leftFootX + 12, GROUND - 2]], 2.5, 1); // sole
    figDetail(ctx, [[leftFootX - 2, GROUND - 12], [leftFootX - 2, GROUND - 4]], 4, R_SHOE_WHITE[1]); // canvas ankle

    // Right Shoe
    ellShaded(ctx, rightFootX, rightFootY + 2, 14, 7, R_SHOE_WHITE);
    figDetail(ctx, [[rightFootX - 12, rightFootY + 6], [rightFootX + 12, rightFootY + 6]], 2.5, 1);
    figDetail(ctx, [[rightFootX - 2, rightFootY - 4], [rightFootX - 2, rightFootY + 4]], 4, R_SHOE_WHITE[1]);

    if (pose.dead) {
      // Slumped fish on the ground
      ellShaded(ctx, CX, GROUND - 8, bodyW * 1.1, bodyH * 0.8, R_FISH_BACK);
      // Tail fin
      figDetail(ctx, [[CX - bodyW / 2 - 8, GROUND - 14], [CX - bodyW / 2, GROUND - 6]], 4, R_FISH_BACK[0]);
      // X Eye
      figDetail(ctx, [[CX + 10, GROUND - 12], [CX + 18, GROUND - 4]], 2, 1);
      figDetail(ctx, [[CX + 18, GROUND - 12], [CX + 10, GROUND - 4]], 2, 1);
      return;
    }

    // Fish Tail Fin (Back)
    figDetail(ctx, [[CX - bodyW / 2 - 10, cy - 8], [CX - bodyW / 2, cy]], 5, R_FISH_BACK[0]);
    figDetail(ctx, [[CX - bodyW / 2 - 10, cy + 8], [CX - bodyW / 2, cy]], 5, R_FISH_BACK[0]);

    // Fish Body (Silver Steel)
    ellShaded(ctx, CX, cy, bodyW, bodyH, R_FISH_BACK);
    // Fish Belly (Light Silver)
    ellShaded(ctx, CX, cy + 4, bodyW * 0.75, bodyH * 0.5, R_FISH_BELLY);

    // Dorsal Fin (Top)
    figDetail(ctx, [[CX - 4, cy - bodyH / 2 - 4], [CX + 6, cy - bodyH / 2]], 4, R_FISH_BACK[0]);

    // Eye
    ellShaded(ctx, CX + 12, cy - 4, 4, 4, [21, 21, 21] as Ramp);

    // Cigarette with glowing ash tip
    figDetail(ctx, [[CX + 18, cy + 2], [CX + 28, cy + 2]], 2.5, R_CIG[1]);
    figGlow(ctx, CX + 29, cy + 2, 2, 13, 17);

    // Kick Attack Arc
    if (pose.kick) {
      figDetail(ctx, [[CX + 12, cy + 10], [CX + 38, cy - 4]], 3, 17);
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
      fishFeetFrame(dir, { phase: 0.33, kick: true }),
      fishFeetFrame(dir, { phase: 0.66, kick: true }),
      fishFeetFrame(dir, { phase: 1.0, kick: false }),
    ],
    death: [
      fishFeetFrame(dir, { phase: 0, dead: true }),
      fishFeetFrame(dir, { phase: 0.5, dead: true }),
    ],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
