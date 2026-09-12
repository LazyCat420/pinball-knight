/**
 * CORVID BOMBER — an ominous raven/crow bomber with glossy midnight plumage,
 * piercing crimson eyes, hooked dark beak, and clutching a round cast-iron
 * delay bomb with a glowing fuse in its talons.
 */
import {
  type Ramp,
  type Pt,
  CX,
  GROUND,
  ellShaded,
  plateShaded,
  limbShaded,
  groundShadow,
  glow as figGlow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

function rectPts(x: number, y: number, w: number, h: number): Pt[] {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

// Palette Ramps
const R_BODY: Ramp = [0, 1, 19];       // Midnight void / dark violet feathers
const R_WING: Ramp = [1, 19, 20];      // Steel-sheened wing feathers
const R_BEAK: Ramp = [1, 2, 3];        // Sharp ebony beak
const R_EYE: Ramp = [10, 11, 13];      // Piercing crimson eye
const R_TALONS: Ramp = [1, 2, 3];      // Dark iron-grip talons
const R_BOMB: Ramp = [0, 1, 2];        // Heavy cast-iron bomb sphere
const R_FUSE: Ramp = [15, 16, 18];     // Burning orange/flame fuse spark

interface PoseOpts {
  attacking?: boolean;
  dead?: boolean;
  deathT?: number;
}

function corvidFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { attacking = false, dead = false, deathT = 0 } = opts;

    if (dead) {
      const t = deathT || 0.6;
      groundShadow(ctx, CX, GROUND + 1, 14);

      // Fallen bird body on ground
      ellShaded(ctx, CX, GROUND - 6, 12, 6, R_BODY);

      // Loose bomb on ground
      ellShaded(ctx, CX + 12 + t * 6, GROUND - 5, 6, 6, R_BOMB);

      // Bursting crow feathers
      ellShaded(ctx, CX - 12 - t * 8, GROUND - 10 - t * 8, 4, 3, R_WING);
      ellShaded(ctx, CX + 10 + t * 6, GROUND - 14 - t * 10, 4, 2.5, R_BODY);
      ellShaded(ctx, CX - 4, GROUND - 18 - t * 12, 3, 3, R_EYE);
      return;
    }

    const flap = Math.sin(phase * Math.PI * 2) * 5;
    const hoverY = Math.cos(phase * Math.PI * 2) * 2.5;
    const lungeX = attacking ? (dir === "E" ? 8 : dir === "S" ? 0 : -8) : 0;
    const lungeY = attacking ? 3 : 0;

    groundShadow(ctx, CX + lungeX * 0.3, GROUND + 1, 16);

    const bodyX = CX + lungeX;
    const bodyY = GROUND - 32 + hoverY + lungeY;

    // Tail feathers
    plateShaded(
      ctx,
      [
        [bodyX - 10, bodyY + 4],
        [bodyX - 2, bodyY],
        [bodyX - 2, bodyY + 6],
        [bodyX - 8, bodyY + 10],
      ],
      R_BODY,
    );

    // Oval body
    ellShaded(ctx, bodyX, bodyY, 13, 10, R_BODY);

    // Flapping Wings
    if (attacking) {
      // Wings flared high in release stoop
      plateShaded(
        ctx,
        [
          [bodyX - 6, bodyY - 2],
          [bodyX - 14, bodyY - 14],
          [bodyX + 2, bodyY - 18],
          [bodyX + 4, bodyY - 4],
        ],
        R_WING,
      );
    } else {
      // Sweeping wings flapping up and down
      ellShaded(ctx, bodyX - 4, bodyY - 2 - flap, 15, 7, R_WING);
    }

    // Head
    const headX = bodyX + (dir === "E" ? 8 : dir === "S" ? 4 : -4);
    const headY = bodyY - 6;
    ellShaded(ctx, headX, headY, 8, 7, R_BODY);

    // Crimson Eye
    const eyeX = headX + (dir === "E" ? 4 : dir === "S" ? 2 : -2);
    const eyeY = headY - 1;
    ellShaded(ctx, eyeX, eyeY, 2.5, 2.5, R_EYE);

    // Hooked Beak
    if (dir === "E") {
      plateShaded(
        ctx,
        [
          [headX + 6, headY - 1],
          [headX + 15, headY + 2],
          [headX + 13, headY + 5],
          [headX + 6, headY + 3],
        ],
        R_BEAK,
      );
    } else if (dir === "S") {
      plateShaded(
        ctx,
        [
          [headX - 1, headY + 3],
          [headX + 5, headY + 3],
          [headX + 2, headY + 10],
        ],
        R_BEAK,
      );
    } else {
      plateShaded(
        ctx,
        [
          [headX - 6, headY - 1],
          [headX - 15, headY + 2],
          [headX - 13, headY + 5],
          [headX - 6, headY + 3],
        ],
        R_BEAK,
      );
    }

    // Talons & Bomb Payload
    const talonY = bodyY + 10;
    if (attacking) {
      // Talons open, bomb just released falling below
      limbShaded(ctx, [bodyX - 3, talonY - 2], [bodyX - 5, talonY + 4], 2, R_TALONS);
      limbShaded(ctx, [bodyX + 3, talonY - 2], [bodyX + 5, talonY + 4], 2, R_TALONS);

      // Dropped bomb
      const bombDropY = talonY + 10;
      ellShaded(ctx, bodyX, bombDropY, 6, 6, R_BOMB);
      figGlow(ctx, bodyX + 2, bombDropY - 5, 2, 16, 18);
    } else {
      // Clutched iron bomb held tightly
      limbShaded(ctx, [bodyX - 3, talonY - 2], [bodyX - 2, talonY + 2], 2.5, R_TALONS);
      limbShaded(ctx, [bodyX + 3, talonY - 2], [bodyX + 2, talonY + 2], 2.5, R_TALONS);

      // Bomb sphere
      ellShaded(ctx, bodyX, talonY + 5, 6, 6, R_BOMB);
      // Sparking fuse
      figGlow(ctx, bodyX + 1, talonY, 2, 16, 18);
    }
  };
}

export function makeCorvidBomberPaints(): ActorPaints {
  const dirs: Dir[] = ["S", "N", "E"];
  const out: Partial<Record<Dir, any>> = {};

  for (const dir of dirs) {
    out[dir] = {
      idle: [
        corvidFrame(dir, 0.0),
        corvidFrame(dir, 0.25),
        corvidFrame(dir, 0.5),
        corvidFrame(dir, 0.75),
      ],
      walk: [
        corvidFrame(dir, 0.1),
        corvidFrame(dir, 0.35),
        corvidFrame(dir, 0.6),
        corvidFrame(dir, 0.85),
      ],
      run: [
        corvidFrame(dir, 0.15),
        corvidFrame(dir, 0.4),
        corvidFrame(dir, 0.65),
        corvidFrame(dir, 0.9),
      ],
      attack: [
        corvidFrame(dir, 0.0, { attacking: true }),
        corvidFrame(dir, 0.25, { attacking: true }),
        corvidFrame(dir, 0.5, { attacking: true }),
        corvidFrame(dir, 0.75, { attacking: true }),
      ],
      stumble: [
        corvidFrame(dir, 0.4),
      ],
      death: [
        corvidFrame(dir, 0.2, { dead: true, deathT: 0.2 }),
        corvidFrame(dir, 0.5, { dead: true, deathT: 0.5 }),
        corvidFrame(dir, 0.8, { dead: true, deathT: 0.8 }),
        corvidFrame(dir, 1.0, { dead: true, deathT: 1.0 }),
      ],
    };
  }

  return out as ActorPaints;
}
