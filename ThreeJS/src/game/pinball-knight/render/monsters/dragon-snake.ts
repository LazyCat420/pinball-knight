/**
 * 🐉 DRAGON SNAKE CEL-PAINTER — Procedural fallback renderer for the
 * multi-part Serpentine Dragon Boss (head, body segments, and tail).
 */
import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  glow as figGlow,
  groundShadow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

const R_SCALES: Ramp = [2, 3, 4];      // Fiery crimson scales
const R_BELLY: Ramp = [15, 16, 17];    // Golden underbelly scutes
const EYE_CORE = 16;
const EYE_HOT = 18;

function dragonHeadFrame(dir: Dir, phase: number, attack = false, dead = false): FramePaint {
  return (ctx) => {
    groundShadow(ctx, CX, GROUND + 1, 28);

    if (dead) {
      ellShaded(ctx, CX, GROUND - 6, 22, 10, R_SCALES);
      return;
    }

    const bob = Math.sin(phase * Math.PI * 2) * 2;
    // Sinuous neck & head
    ellShaded(ctx, CX, GROUND - 18 + bob, 20, 16, R_SCALES);
    ellShaded(ctx, CX + 4, GROUND - 14 + bob, 14, 10, R_BELLY);

    // Glowing eyes
    figGlow(ctx, CX + 6, GROUND - 22 + bob, 3, EYE_CORE, EYE_HOT);

    if (attack) {
      // Fire burst from open maw
      figGlow(ctx, CX + 16, GROUND - 16 + bob, 6, 17, 18);
    }
  };
}

export function makeDragonSnakeHeadPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [
      dragonHeadFrame(dir, 0, false, false),
      dragonHeadFrame(dir, 0.25, false, false),
      dragonHeadFrame(dir, 0.5, false, false),
      dragonHeadFrame(dir, 0.75, false, false),
    ],
    walk: [
      dragonHeadFrame(dir, 0.2, false, false),
      dragonHeadFrame(dir, 0.4, false, false),
      dragonHeadFrame(dir, 0.6, false, false),
      dragonHeadFrame(dir, 0.8, false, false),
    ],
    attack: [
      dragonHeadFrame(dir, 0.1, true, false),
      dragonHeadFrame(dir, 0.3, true, false),
      dragonHeadFrame(dir, 0.5, true, false),
      dragonHeadFrame(dir, 0.7, true, false),
    ],
    death: [
      dragonHeadFrame(dir, 0, false, true),
      dragonHeadFrame(dir, 0.2, false, true),
      dragonHeadFrame(dir, 0.5, false, true),
      dragonHeadFrame(dir, 1, false, true),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}

function dragonBodyFrame(dir: Dir, phase: number, enrage = false, dead = false): FramePaint {
  return (ctx) => {
    groundShadow(ctx, CX, GROUND + 1, 20);

    if (dead) {
      ellShaded(ctx, CX, GROUND - 5, 16, 8, [1, 2, 3]);
      return;
    }

    const wave = Math.sin(phase * Math.PI * 2) * 2.5;
    // Serpentine body link
    ellShaded(ctx, CX + wave, GROUND - 14, 16, 14, enrage ? [3, 4, 17] : R_SCALES);
    ellShaded(ctx, CX + wave, GROUND - 9, 12, 8, R_BELLY);
  };
}

export function makeDragonSnakeBodyPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [
      dragonBodyFrame(dir, 0, false, false),
      dragonBodyFrame(dir, 0.25, false, false),
      dragonBodyFrame(dir, 0.5, false, false),
      dragonBodyFrame(dir, 0.75, false, false),
    ],
    walk: [
      dragonBodyFrame(dir, 0.2, false, false),
      dragonBodyFrame(dir, 0.4, false, false),
      dragonBodyFrame(dir, 0.6, false, false),
      dragonBodyFrame(dir, 0.8, false, false),
    ],
    attack: [
      dragonBodyFrame(dir, 0.1, true, false),
      dragonBodyFrame(dir, 0.3, true, false),
      dragonBodyFrame(dir, 0.5, true, false),
      dragonBodyFrame(dir, 0.7, true, false),
    ],
    death: [
      dragonBodyFrame(dir, 0, false, true),
      dragonBodyFrame(dir, 0.2, false, true),
      dragonBodyFrame(dir, 0.5, false, true),
      dragonBodyFrame(dir, 1, false, true),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}

function dragonTailFrame(dir: Dir, phase: number, enrage = false, dead = false): FramePaint {
  return (ctx) => {
    groundShadow(ctx, CX, GROUND + 1, 16);

    if (dead) {
      ellShaded(ctx, CX, GROUND - 4, 12, 6, [1, 2, 3]);
      return;
    }

    const swish = Math.sin(phase * Math.PI * 2) * 3.5;
    ellShaded(ctx, CX + swish, GROUND - 12, 12, 10, R_SCALES);
    figGlow(ctx, CX + swish - 8, GROUND - 14, 4, 16, 18);
  };
}

export function makeDragonSnakeTailPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [
      dragonTailFrame(dir, 0, false, false),
      dragonTailFrame(dir, 0.25, false, false),
      dragonTailFrame(dir, 0.5, false, false),
      dragonTailFrame(dir, 0.75, false, false),
    ],
    walk: [
      dragonTailFrame(dir, 0.2, false, false),
      dragonTailFrame(dir, 0.4, false, false),
      dragonTailFrame(dir, 0.6, false, false),
      dragonTailFrame(dir, 0.8, false, false),
    ],
    attack: [
      dragonTailFrame(dir, 0.1, true, false),
      dragonTailFrame(dir, 0.3, true, false),
      dragonTailFrame(dir, 0.5, true, false),
      dragonTailFrame(dir, 0.7, true, false),
    ],
    death: [
      dragonTailFrame(dir, 0, false, true),
      dragonTailFrame(dir, 0.2, false, true),
      dragonTailFrame(dir, 0.5, false, true),
      dragonTailFrame(dir, 1, false, true),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
