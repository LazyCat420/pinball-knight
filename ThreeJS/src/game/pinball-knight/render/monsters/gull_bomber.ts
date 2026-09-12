/**
 * GULL BOMBER — a raucous coastal seagull with pure white plumage, slate-grey
 * mantle and wingtips, yellow beak with a signature crimson dot, and clutching
 * a speckled cluster egg bomb.
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
const R_BODY: Ramp = [20, 21, 22];     // Clean white / steel highlight plumage
const R_MANTLE: Ramp = [2, 3, 4];      // Slate grey back mantle and wingtips
const R_BEAK: Ramp = [15, 16, 17];     // Bright yellow beak
const R_DOT: Ramp = [10, 11, 12];      // Red mandible spot
const R_EYE: Ramp = [16, 17, 18];      // Beady yellow eye with dark center
const R_LEGS: Ramp = [14, 15, 16];     // Pinkish/orange webbed feet
const R_EGG: Ramp = [4, 21, 22];       // Speckled egg bomb shell
const R_SPECKS: Ramp = [2, 3, 4];      // Dark slate speckles on egg

interface PoseOpts {
  attacking?: boolean;
  dead?: boolean;
  deathT?: number;
}

function gullFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { attacking = false, dead = false, deathT = 0 } = opts;

    if (dead) {
      const t = deathT || 0.6;
      groundShadow(ctx, CX, GROUND + 1, 14);

      // Fallen bird body on ground
      ellShaded(ctx, CX, GROUND - 6, 12, 6, R_BODY);

      // Cracked egg pieces
      ellShaded(ctx, CX + 10 + t * 6, GROUND - 4, 4, 3, R_EGG);
      ellShaded(ctx, CX + 14 + t * 8, GROUND - 5, 3, 3, R_EGG);

      // White feathers fluttering
      ellShaded(ctx, CX - 12 - t * 8, GROUND - 10 - t * 8, 4, 3, R_BODY);
      ellShaded(ctx, CX + 8, GROUND - 14 - t * 10, 4, 2.5, R_MANTLE);
      ellShaded(ctx, CX - 4, GROUND - 18 - t * 12, 3, 2, R_BODY);
      return;
    }

    const flap = Math.sin(phase * Math.PI * 4) * 4.5;
    const hoverY = Math.cos(phase * Math.PI * 2) * 2;
    const lungeX = attacking ? (dir === "E" ? 8 : dir === "S" ? 0 : -8) : 0;
    const lungeY = attacking ? 2 : 0;

    groundShadow(ctx, CX + lungeX * 0.3, GROUND + 1, 16);

    const bodyX = CX + lungeX;
    const bodyY = GROUND - 30 + hoverY + lungeY;

    // Tail feathers
    plateShaded(
      ctx,
      [
        [bodyX - 10, bodyY + 3],
        [bodyX - 2, bodyY],
        [bodyX - 2, bodyY + 5],
        [bodyX - 8, bodyY + 8],
      ],
      R_BODY,
    );

    // Oval body (white)
    ellShaded(ctx, bodyX, bodyY, 13, 9, R_BODY);

    // Slate mantle on back
    ellShaded(ctx, bodyX - 2, bodyY - 2, 10, 6, R_MANTLE);

    // Wings
    if (attacking) {
      // Wings spread wide
      plateShaded(
        ctx,
        [
          [bodyX - 4, bodyY - 1],
          [bodyX - 14, bodyY - 12],
          [bodyX + 2, bodyY - 16],
          [bodyX + 4, bodyY - 3],
        ],
        R_MANTLE,
      );
    } else {
      // Clean flapping wings
      ellShaded(ctx, bodyX - 3, bodyY - flap, 14, 8, R_MANTLE);
    }

    // Head (white)
    const headX = bodyX + (dir === "E" ? 7 : dir === "S" ? 3 : -4);
    const headY = bodyY - 5;
    ellShaded(ctx, headX, headY, 7, 6, R_BODY);

    // Eye (yellow)
    const eyeX = headX + (dir === "E" ? 3 : dir === "S" ? 2 : -2);
    const eyeY = headY - 1;
    ellShaded(ctx, eyeX, eyeY, 3, 3, R_EYE);

    // Beak with Red Tip
    if (dir === "E") {
      plateShaded(
        ctx,
        [
          [headX + 5, headY - 2],
          [headX + 14, headY + 1],
          [headX + 12, headY + 5],
          [headX + 5, headY + 3],
        ],
        R_BEAK,
      );
      ellShaded(ctx, headX + 11, headY + 3, 3, 2, R_DOT);
    } else if (dir === "S") {
      plateShaded(
        ctx,
        [
          [headX - 1, headY + 2],
          [headX + 4, headY + 2],
          [headX + 1, headY + 8],
        ],
        R_BEAK,
      );
      ellShaded(ctx, headX + 1, headY + 6, 2.5, 2, R_DOT);
    } else {
      plateShaded(
        ctx,
        [
          [headX - 5, headY - 2],
          [headX - 14, headY + 1],
          [headX - 12, headY + 5],
          [headX - 5, headY + 3],
        ],
        R_BEAK,
      );
      ellShaded(ctx, headX - 11, headY + 3, 3, 2, R_DOT);
    }

    // Legs & Egg Bomb Payload
    const legY = bodyY + 8;
    if (attacking) {
      // Legs kicked open, dropping egg bomb
      limbShaded(ctx, [bodyX - 3, legY], [bodyX - 6, legY + 5], 3, R_LEGS);
      limbShaded(ctx, [bodyX + 3, legY], [bodyX + 6, legY + 5], 3, R_LEGS);

      // Dropped egg bomb
      const eggDropY = legY + 10;
      ellShaded(ctx, bodyX, eggDropY, 7, 8, R_EGG);
    } else {
      // Cradled egg bomb in feet
      limbShaded(ctx, [bodyX - 2, legY], [bodyX - 1, legY + 3], 3, R_LEGS);
      limbShaded(ctx, [bodyX + 2, legY], [bodyX + 1, legY + 3], 3, R_LEGS);

      // Egg bomb
      ellShaded(ctx, bodyX, legY + 6, 6, 8, R_EGG);
    }
  };
}

export function makeGullBomberPaints(): ActorPaints {
  const dirs: Dir[] = ["S", "N", "E"];
  const out: Partial<Record<Dir, any>> = {};

  for (const dir of dirs) {
    out[dir] = {
      idle: [
        gullFrame(dir, 0.0),
        gullFrame(dir, 0.25),
        gullFrame(dir, 0.5),
        gullFrame(dir, 0.75),
      ],
      walk: [
        gullFrame(dir, 0.1),
        gullFrame(dir, 0.35),
        gullFrame(dir, 0.6),
        gullFrame(dir, 0.85),
      ],
      run: [
        gullFrame(dir, 0.15),
        gullFrame(dir, 0.4),
        gullFrame(dir, 0.65),
        gullFrame(dir, 0.9),
      ],
      attack: [
        gullFrame(dir, 0.0, { attacking: true }),
        gullFrame(dir, 0.25, { attacking: true }),
        gullFrame(dir, 0.5, { attacking: true }),
        gullFrame(dir, 0.75, { attacking: true }),
      ],
      stumble: [
        gullFrame(dir, 0.4),
      ],
      death: [
        gullFrame(dir, 0.2, { dead: true, deathT: 0.2 }),
        gullFrame(dir, 0.5, { dead: true, deathT: 0.5 }),
        gullFrame(dir, 0.8, { dead: true, deathT: 0.8 }),
        gullFrame(dir, 1.0, { dead: true, deathT: 1.0 }),
      ],
    };
  }

  return out as ActorPaints;
}
