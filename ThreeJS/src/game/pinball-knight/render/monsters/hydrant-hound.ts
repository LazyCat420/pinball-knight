/**
 * HYDRANT HOUND — red cast-iron American fire hydrant mutated into a bulldog beast
 * with work glove ears, underbite jowls, and high-pressure side water cannons.
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

const R_CAST_IRON: Ramp = [0, 1, 2];    // Classic fire engine red iron
const R_BRASS: Ramp = [16, 17, 24];     // Brass nozzle caps & bolts
const R_GLOVE: Ramp = [16, 17, 24];     // Yellow work glove dog ears
const R_WATER: Ramp = [20, 21, 22];     // High-pressure white/blue water spray

interface PoseOpts {
  pant?: number;
  chargeBob?: number;
  waterBlast?: boolean;
  geyserT?: number;
  dead?: boolean;
}

function hydrantHoundFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { pant = 0, chargeBob = 0, waterBlast = false, geyserT = 0, dead = false } = opts;

    if (dead) {
      groundShadow(ctx, CX, GROUND, 24);
      // Fallen cracked hydrant on side with upward geyser
      ellShaded(ctx, CX, GROUND - 6, 16, 8, R_CAST_IRON);
      figDetail(ctx, CX - 10, GROUND - 10, 4, 3, R_BRASS); // popped cap
      // Vertical rushing geyser fountain
      ellShaded(ctx, CX + 4, GROUND - 20, 6, 16, R_WATER);
      figGlow(ctx, CX + 4, GROUND - 20, 14, R_WATER[1], R_WATER[2]);
      return;
    }

    groundShadow(ctx, CX, GROUND, 22);

    // Four stubby muscular bulldog legs
    const legOffset = Math.sin(phase * Math.PI * 2) * 3;
    ellShaded(ctx, CX - 10 + legOffset, GROUND - 4, 5, 4, R_CAST_IRON);
    ellShaded(ctx, CX - 4 - legOffset, GROUND - 4, 5, 4, R_CAST_IRON);
    ellShaded(ctx, CX + 4 + legOffset, GROUND - 4, 5, 4, R_CAST_IRON);
    ellShaded(ctx, CX + 10 - legOffset, GROUND - 4, 5, 4, R_CAST_IRON);

    // Cylindrical heavy cast-iron hydrant barrel body
    const bob = Math.sin(phase * Math.PI * 2) * 1.5 + chargeBob;
    const bodyY = GROUND - 18 + bob;

    plateShaded(
      ctx,
      [
        [CX - 12, bodyY - 12],
        [CX + 12, bodyY - 12],
        [CX + 11, bodyY + 10],
        [CX - 11, bodyY + 10],
      ],
      R_CAST_IRON,
    );

    // Top domed bonnet & pentagonal nut
    ellShaded(ctx, CX, bodyY - 14, 10, 5, R_CAST_IRON);
    figDetail(ctx, CX - 3, bodyY - 18, 6, 4, R_BRASS);

    // Side brass hose outlet nozzles (left & right)
    figDetail(ctx, CX - 15, bodyY - 2, 4, 5, R_BRASS);
    figDetail(ctx, CX + 11, bodyY - 2, 4, 5, R_BRASS);

    // Drooling bulldog jaw underbite
    ellShaded(ctx, CX, bodyY + 4 + pant * 2, 10, 6, R_CAST_IRON);
    // Yellow fangs protruding upward
    figDetail(ctx, CX - 6, bodyY + 2 + pant * 2, 2, 3, R_BRASS);
    figDetail(ctx, CX + 4, bodyY + 2 + pant * 2, 2, 3, R_BRASS);
    // Drool drip
    figDetail(ctx, CX - 2, bodyY + 8 + pant * 2, 2, 4, R_WATER);

    // Floppy yellow leather work glove ears
    ellShaded(ctx, CX - 14, bodyY - 10, 4, 7, R_GLOVE);
    ellShaded(ctx, CX + 14, bodyY - 10, 4, 7, R_GLOVE);

    if (waterBlast) {
      // Twin pressurized water cannons spraying outward
      ellShaded(ctx, CX - 26, bodyY - 2, 12, 6, R_WATER);
      ellShaded(ctx, CX + 26, bodyY - 2, 12, 6, R_WATER);
      figGlow(ctx, CX - 26, bodyY - 2, 10, R_WATER[1], R_WATER[2]);
      figGlow(ctx, CX + 26, bodyY - 2, 10, R_WATER[1], R_WATER[2]);
    }
  };
}

export function makeHydrantHoundPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [
      hydrantHoundFrame(dir, 0, { pant: 0 }),
      hydrantHoundFrame(dir, 0.25, { pant: 1 }),
      hydrantHoundFrame(dir, 0.5, { pant: 0 }),
      hydrantHoundFrame(dir, 0.75, { pant: 1 }),
    ],
    walk: [
      hydrantHoundFrame(dir, 0, { chargeBob: -1 }),
      hydrantHoundFrame(dir, 0.25, { chargeBob: 0 }),
      hydrantHoundFrame(dir, 0.5, { chargeBob: 1 }),
      hydrantHoundFrame(dir, 0.75, { chargeBob: 0 }),
    ],
    attack: [
      hydrantHoundFrame(dir, 0, { pant: 2, waterBlast: false }),
      hydrantHoundFrame(dir, 0.3, { pant: 1, waterBlast: true }),
      hydrantHoundFrame(dir, 0.6, { pant: 0, waterBlast: true }),
      hydrantHoundFrame(dir, 0.9, { pant: 0, waterBlast: false }),
    ],
    stumble: [
      hydrantHoundFrame(dir, 0.2, { chargeBob: -2, pant: 2 }),
      hydrantHoundFrame(dir, 0.6, { chargeBob: 2, pant: 0 }),
    ],
    death: [
      hydrantHoundFrame(dir, 0.1, { geyserT: 0.3, dead: false }),
      hydrantHoundFrame(dir, 0.4, { geyserT: 0.6, dead: true }),
      hydrantHoundFrame(dir, 0.7, { geyserT: 0.9, dead: true }),
      hydrantHoundFrame(dir, 1.0, { geyserT: 1.0, dead: true }),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
