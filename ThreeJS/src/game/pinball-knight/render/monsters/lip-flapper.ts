/**
 * LIP FLAPPER — tall black-and-red striped accordion stalk monster topped with
 * colossal voluptuous red wax lips, dental braces, and a mini fedora.
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

const R_RED_LIPS: Ramp = [0, 1, 2];      // Voluptuous shiny red lips
const R_BLACK: Ramp = [0, 0, 0];        // Black stripes / fedora
const R_STRIPE_RED: Ramp = [0, 1, 2];   // Red stripes
const R_BRACES: Ramp = [20, 21, 22];    // Silver metal dental braces
const R_GLOVES: Ramp = [20, 21, 22];    // White cartoon gloves

interface PoseOpts {
  compress?: number;
  openMouth?: number;
  kissMark?: boolean;
  deflateT?: number;
  dead?: boolean;
}

function lipFlapperFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { compress = 0, openMouth = 0, kissMark = false, deflateT = 0, dead = false } = opts;

    if (dead) {
      groundShadow(ctx, CX, GROUND, 22);
      // Flat deflated rubber tube on floor
      ellShaded(ctx, CX, GROUND - 3, 20, 4, R_RED_LIPS);
      ellShaded(ctx, CX - 6, GROUND - 3, 6, 3, R_BLACK);
      figDetail(ctx, CX + 12, GROUND - 4, 3, 2, R_GLOVES);
      return;
    }

    groundShadow(ctx, CX, GROUND, 16);

    // Accordion cane stalk body (series of alternating black and red rings)
    const baseHeight = 36;
    const currentHeight = Math.max(12, baseHeight * (1 - deflateT) + compress * 4);
    const ringCount = 8;
    const ringH = currentHeight / ringCount;

    for (let i = 0; i < ringCount; i++) {
      const ringY = GROUND - 4 - i * ringH;
      const ramp = i % 2 === 0 ? R_BLACK : R_STRIPE_RED;
      const ringW = 6 + Math.sin(i + phase * Math.PI) * 1.5;
      ellShaded(ctx, CX, ringY, ringW, Math.max(2, ringH * 0.8), ramp);
    }

    // Small rubber hose arms with white cartoon gloves
    const midY = GROUND - currentHeight * 0.5;
    ellShaded(ctx, CX - 10, midY, 2, 8, R_BLACK);
    ellShaded(ctx, CX + 10, midY, 2, 8, R_BLACK);
    ellShaded(ctx, CX - 11, midY + 5, 3, 3, R_GLOVES);
    ellShaded(ctx, CX + 11, midY + 5, 3, 3, R_GLOVES);

    // GIANT LUSCIOUS RED WAX LIPS HEAD
    const headY = GROUND - 4 - currentHeight;
    const lipW = 18;
    const lipH = 10 + openMouth * 6;

    // Top lip
    ellShaded(ctx, CX, headY - lipH * 0.3, lipW, lipH * 0.5, R_RED_LIPS);
    // Bottom lip
    ellShaded(ctx, CX, headY + lipH * 0.3, lipW, lipH * 0.5, R_RED_LIPS);

    // Mouth cavity
    ellShaded(ctx, CX, headY, lipW * 0.7, Math.max(2, openMouth * 6), [0, 0, 0]);

    // Dental braces on teeth
    figDetail(ctx, CX - 8, headY - 1, 16, 2, R_BRACES);
    for (let bx = -6; bx <= 6; bx += 3) {
      figDetail(ctx, CX + bx, headY - 2, 2, 3, R_BRACES);
    }

    // Tilted mini black fedora
    ellShaded(ctx, CX - 4, headY - lipH * 0.6, 7, 3, R_BLACK);
    figDetail(ctx, CX - 7, headY - lipH * 0.55, 12, 1, R_BLACK);

    if (kissMark) {
      // Floating red cartoon kiss mark
      ellShaded(ctx, CX + 16, headY - 4, 4, 3, R_RED_LIPS);
      figDetail(ctx, CX + 16, headY - 4, 2, 1, R_GLOVES);
      figGlow(ctx, CX + 16, headY - 4, 6, R_RED_LIPS[1], R_RED_LIPS[2]);
    }
  };
}

export function makeLipFlapperPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [
      lipFlapperFrame(dir, 0, { compress: 0 }),
      lipFlapperFrame(dir, 0.25, { compress: 1 }),
      lipFlapperFrame(dir, 0.5, { compress: 0 }),
      lipFlapperFrame(dir, 0.75, { compress: -1 }),
    ],
    walk: [
      lipFlapperFrame(dir, 0, { compress: -1.5 }),
      lipFlapperFrame(dir, 0.25, { compress: 0 }),
      lipFlapperFrame(dir, 0.5, { compress: 1.5 }),
      lipFlapperFrame(dir, 0.75, { compress: 0 }),
    ],
    attack: [
      lipFlapperFrame(dir, 0, { openMouth: 0.5, compress: -1 }),
      lipFlapperFrame(dir, 0.3, { openMouth: 1.0, compress: 1 }),
      lipFlapperFrame(dir, 0.6, { openMouth: 0.2, kissMark: true }),
      lipFlapperFrame(dir, 0.9, { openMouth: 0, kissMark: false }),
    ],
    stumble: [
      lipFlapperFrame(dir, 0.2, { compress: -3 }),
      lipFlapperFrame(dir, 0.6, { compress: 3 }),
    ],
    death: [
      lipFlapperFrame(dir, 0.1, { deflateT: 0.3 }),
      lipFlapperFrame(dir, 0.4, { deflateT: 0.7 }),
      lipFlapperFrame(dir, 0.7, { deflateT: 0.9, dead: true }),
      lipFlapperFrame(dir, 1.0, { dead: true }),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
