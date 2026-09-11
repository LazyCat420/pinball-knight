/**
 * TOASTER GREMLIN — spindly purple goblin with a vintage chrome 2-slice American
 * toaster head and glowing red heating coils.
 */
import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  groundShadow,
  plateShaded,
  glow as figGlow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

const figDetail = (ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, m: Ramp | number) =>
  ellShaded(ctx, x, y, Math.max(1, rx), Math.max(1, ry), m);

const R_PURPLE: Ramp = [12, 13, 14];   // Spindly purple body
const R_CHROME: Ramp = [20, 21, 22];   // Shiny toaster housing
const R_COILS: Ramp = [0, 1, 2];       // Red-hot heating coils
const R_TOAST: Ramp = [4, 5, 16];      // Toasted pastry slices
const R_SPARK: Ramp = [16, 17, 24];    // Electrical sparks

interface PoseOpts {
  step?: number;
  leverDown?: boolean;
  launchToast?: boolean;
  sparkT?: number;
  dead?: boolean;
}

function toasterGremlinFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { step = 0, leverDown = false, launchToast = false, sparkT = 0, dead = false } = opts;

    if (dead) {
      groundShadow(ctx, CX, GROUND, 20);
      ellShaded(ctx, CX, GROUND - 6, 12, 5, R_CHROME);
      figDetail(ctx, CX - 4, GROUND - 8, 3, 3, R_TOAST);
      figDetail(ctx, CX + 6, GROUND - 7, 4, 3, R_TOAST);
      figGlow(ctx, CX, GROUND - 10, 8, R_SPARK[1], R_SPARK[2]);
      return;
    }

    groundShadow(ctx, CX, GROUND, 16);

    // Spindly thin purple legs
    const legOffset = step * 4;
    ellShaded(ctx, CX - 6 + legOffset, GROUND - 6, 2, 8, R_PURPLE);
    ellShaded(ctx, CX + 6 - legOffset, GROUND - 6, 2, 8, R_PURPLE);
    ellShaded(ctx, CX - 7 + legOffset, GROUND - 2, 4, 2, R_PURPLE);
    ellShaded(ctx, CX + 7 - legOffset, GROUND - 2, 4, 2, R_PURPLE);

    // Thin hunchbacked purple torso
    const bob = Math.sin(phase * Math.PI * 2) * 1.5;
    ellShaded(ctx, CX, GROUND - 18 + bob, 7, 10, R_PURPLE);

    // Long spindly rubbery arms
    ellShaded(ctx, CX - 10, GROUND - 17 + bob, 2, 9, R_PURPLE);
    ellShaded(ctx, CX + 10, GROUND - 17 + bob, 2, 9, R_PURPLE);

    // Chrome 2-slice toaster head
    const headY = GROUND - 30 + bob;
    plateShaded(
      ctx,
      [
        [CX - 12, headY - 8],
        [CX + 12, headY - 8],
        [CX + 11, headY + 8],
        [CX - 11, headY + 8],
      ],
      R_CHROME,
    );

    // Toaster slots (top)
    figDetail(ctx, CX - 6, headY - 8, 4, 1, [0, 0, 0]);
    figDetail(ctx, CX + 2, headY - 8, 4, 1, [0, 0, 0]);

    // Side lever
    const leverY = leverDown ? headY + 4 : headY - 2;
    figDetail(ctx, CX + 12, leverY, 4, 2, [0, 0, 0]);

    // Glowing heating coil eye-slits in front face
    ellShaded(ctx, CX - 5, headY, 3, 4, [0, 0, 0]);
    ellShaded(ctx, CX + 5, headY, 3, 4, [0, 0, 0]);
    figDetail(ctx, CX - 5, headY, 2, 2, R_COILS);
    figDetail(ctx, CX + 5, headY, 2, 2, R_COILS);
    figGlow(ctx, CX - 5, headY, 6, R_COILS[1], R_COILS[2]);
    figGlow(ctx, CX + 5, headY, 6, R_COILS[1], R_COILS[2]);

    if (launchToast) {
      // Toast popping high out of slots
      ellShaded(ctx, CX + 16, headY - 14, 5, 4, R_TOAST);
      figDetail(ctx, CX + 16, headY - 10, 4, 2, R_COILS);
      figGlow(ctx, CX + 16, headY - 10, 8, R_SPARK[1], R_SPARK[2]);
    } else if (leverDown) {
      // Toasts tucked inside warming up
      figDetail(ctx, CX - 6, headY - 10, 3, 2, R_TOAST);
      figDetail(ctx, CX + 2, headY - 10, 3, 2, R_TOAST);
    }
  };
}

export function makeToasterGremlinPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [
      toasterGremlinFrame(dir, 0, { step: 0 }),
      toasterGremlinFrame(dir, 0.25, { step: 0.5 }),
      toasterGremlinFrame(dir, 0.5, { step: 0 }),
      toasterGremlinFrame(dir, 0.75, { step: -0.5 }),
    ],
    walk: [
      toasterGremlinFrame(dir, 0, { step: -1 }),
      toasterGremlinFrame(dir, 0.25, { step: 0 }),
      toasterGremlinFrame(dir, 0.5, { step: 1 }),
      toasterGremlinFrame(dir, 0.75, { step: 0 }),
    ],
    attack: [
      toasterGremlinFrame(dir, 0, { leverDown: false }),
      toasterGremlinFrame(dir, 0.3, { leverDown: true }),
      toasterGremlinFrame(dir, 0.6, { leverDown: true, launchToast: true }),
      toasterGremlinFrame(dir, 0.9, { leverDown: false, launchToast: false }),
    ],
    stumble: [
      toasterGremlinFrame(dir, 0.2, { step: 1.5 }),
      toasterGremlinFrame(dir, 0.6, { step: -1.5 }),
    ],
    death: [
      toasterGremlinFrame(dir, 0.1, { sparkT: 0.3, dead: false }),
      toasterGremlinFrame(dir, 0.4, { sparkT: 0.6, dead: false }),
      toasterGremlinFrame(dir, 0.7, { sparkT: 1.0, dead: true }),
      toasterGremlinFrame(dir, 1.0, { dead: true }),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
