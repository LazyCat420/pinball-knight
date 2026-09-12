/**
 * SKY FALCON — a razor-sharp peregrine raptor with slate-blue plumage,
 * barred white breast, dark hooded cowl, piercing gaze, and an incendiary
 * napalm fire canister slung underneath.
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
const R_BACK: Ramp = [29, 30, 31];     // Sleek slate-blue / arcane raptor feathers
const R_BREAST: Ramp = [20, 21, 22];   // Barred white / steel breast
const R_HOOD: Ramp = [0, 1, 29];       // Dark hooded cowl / eye stripe
const R_CERE: Ramp = [15, 16, 17];     // Bright yellow beak cere & eye ring
const R_BEAK: Ramp = [1, 2, 3];        // Hooked slate raptor beak tip
const R_EYE: Ramp = [0, 1, 19];        // Keen dark pupil
const R_TALONS: Ramp = [15, 16, 17];   // Yellow raptor talons
const R_CANISTER: Ramp = [10, 11, 15]; // Red / bronze napalm canister
const R_FLAME: Ramp = [15, 16, 18];    // Glowing incendiary flame core

interface PoseOpts {
  attacking?: boolean;
  dead?: boolean;
  deathT?: number;
}

function falconFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { attacking = false, dead = false, deathT = 0 } = opts;

    if (dead) {
      const t = deathT || 0.6;
      groundShadow(ctx, CX, GROUND + 1, 16);

      // Fallen raptor body on ground
      ellShaded(ctx, CX, GROUND - 6, 13, 6, R_BACK);
      ellShaded(ctx, CX + 4, GROUND - 6, 7, 5, R_BREAST);

      // Smashed canister
      ellShaded(ctx, CX + 12 + t * 6, GROUND - 4, 5, 3, R_CANISTER);
      figGlow(ctx, CX + 12 + t * 6, GROUND - 4, 2, 16, 18);

      // Blue & white feathers
      ellShaded(ctx, CX - 12 - t * 8, GROUND - 10 - t * 8, 4, 3, R_BACK);
      ellShaded(ctx, CX + 8, GROUND - 14 - t * 10, 3, 2, R_BREAST);
      ellShaded(ctx, CX - 4, GROUND - 18 - t * 12, 3, 3, R_FLAME);
      return;
    }

    const flap = Math.sin(phase * Math.PI * 4) * 4;
    const hoverY = Math.cos(phase * Math.PI * 2) * 2;
    const lungeX = attacking ? (dir === "E" ? 12 : dir === "S" ? 0 : -12) : 0;
    const lungeY = attacking ? 5 : 0;

    groundShadow(ctx, CX + lungeX * 0.4, GROUND + 1, 18);

    const bodyX = CX + lungeX;
    const bodyY = GROUND - 32 + hoverY + lungeY;

    // Wedge tail feathers
    plateShaded(
      ctx,
      [
        [bodyX - 12, bodyY + 4],
        [bodyX - 2, bodyY],
        [bodyX - 2, bodyY + 6],
        [bodyX - 10, bodyY + 9],
      ],
      R_BACK,
    );

    // Torpedo streamlined body
    ellShaded(ctx, bodyX, bodyY, 14, 9, R_BACK);

    // Barred white breast
    ellShaded(ctx, bodyX + 4, bodyY + 1, 8, 7, R_BREAST);

    // Sharp swept-back wings
    if (attacking) {
      // Stoop dive angle: wings folded tight like a delta dart
      plateShaded(
        ctx,
        [
          [bodyX - 6, bodyY - 4],
          [bodyX - 16, bodyY - 14],
          [bodyX - 2, bodyY - 18],
          [bodyX + 6, bodyY - 5],
        ],
        R_BACK,
      );
    } else {
      // Swept sharp wings
      ellShaded(ctx, bodyX - 4, bodyY - 2 - flap, 16, 7, R_BACK);
      ellShaded(ctx, bodyX - 8, bodyY - 4 - flap, 8, 4, R_HOOD);
    }

    // Head with dark hooded cowl
    const headX = bodyX + (dir === "E" ? 8 : dir === "S" ? 4 : -4);
    const headY = bodyY - 5;
    ellShaded(ctx, headX, headY, 7, 6, R_HOOD);

    // Yellow eye ring & keen dark eye
    const eyeX = headX + (dir === "E" ? 3 : dir === "S" ? 2 : -2);
    const eyeY = headY - 1;
    ellShaded(ctx, eyeX, eyeY, 3, 3, R_CERE);
    ellShaded(ctx, eyeX, eyeY, 1.5, 1.5, R_EYE);

    // Yellow cere & hooked raptor beak
    if (dir === "E") {
      plateShaded(
        ctx,
        [
          [headX + 5, headY - 2],
          [headX + 9, headY - 1],
          [headX + 9, headY + 3],
          [headX + 5, headY + 3],
        ],
        R_CERE,
      );
      plateShaded(
        ctx,
        [
          [headX + 8, headY - 1],
          [headX + 14, headY + 2],
          [headX + 11, headY + 5],
          [headX + 8, headY + 3],
        ],
        R_BEAK,
      );
    } else if (dir === "S") {
      plateShaded(
        ctx,
        [
          [headX - 1, headY + 2],
          [headX + 4, headY + 2],
          [headX + 1.5, headY + 5],
        ],
        R_CERE,
      );
      plateShaded(
        ctx,
        [
          [headX, headY + 4],
          [headX + 3, headY + 4],
          [headX + 1.5, headY + 8],
        ],
        R_BEAK,
      );
    } else {
      plateShaded(
        ctx,
        [
          [headX - 5, headY - 2],
          [headX - 9, headY - 1],
          [headX - 9, headY + 3],
          [headX - 5, headY + 3],
        ],
        R_CERE,
      );
      plateShaded(
        ctx,
        [
          [headX - 8, headY - 1],
          [headX - 14, headY + 2],
          [headX - 11, headY + 5],
          [headX - 8, headY + 3],
        ],
        R_BEAK,
      );
    }

    // Undercarriage Talons & Napalm Fire Canister
    const talonY = bodyY + 8;
    if (attacking) {
      // Releasing canister with fiery flash
      limbShaded(ctx, [bodyX - 3, talonY], [bodyX - 6, talonY + 4], 2, R_TALONS);
      limbShaded(ctx, [bodyX + 3, talonY], [bodyX + 6, talonY + 4], 2, R_TALONS);

      // Dropping fiery cylinder
      const canDropY = talonY + 8;
      plateShaded(ctx, rectPts(bodyX - 3, canDropY - 3, 6, 8), R_CANISTER);
      figGlow(ctx, bodyX, canDropY + 1, 3, 16, 18);
    } else {
      // Clutched incendiary canister
      limbShaded(ctx, [bodyX - 2, talonY], [bodyX - 1, talonY + 3], 2, R_TALONS);
      limbShaded(ctx, [bodyX + 2, talonY], [bodyX + 1, talonY + 3], 2, R_TALONS);

      // Sleek incendiary bomb cylinder
      plateShaded(ctx, rectPts(bodyX - 3, talonY + 2, 6, 7), R_CANISTER);
      figGlow(ctx, bodyX, talonY + 5, 2, 16, 18);
    }
  };
}

export function makeSkyFalconPaints(): ActorPaints {
  const dirs: Dir[] = ["S", "N", "E"];
  const out: Partial<Record<Dir, any>> = {};

  for (const dir of dirs) {
    out[dir] = {
      idle: [
        falconFrame(dir, 0.0),
        falconFrame(dir, 0.25),
        falconFrame(dir, 0.5),
        falconFrame(dir, 0.75),
      ],
      walk: [
        falconFrame(dir, 0.1),
        falconFrame(dir, 0.35),
        falconFrame(dir, 0.6),
        falconFrame(dir, 0.85),
      ],
      run: [
        falconFrame(dir, 0.15),
        falconFrame(dir, 0.4),
        falconFrame(dir, 0.65),
        falconFrame(dir, 0.9),
      ],
      attack: [
        falconFrame(dir, 0.0, { attacking: true }),
        falconFrame(dir, 0.25, { attacking: true }),
        falconFrame(dir, 0.5, { attacking: true }),
        falconFrame(dir, 0.75, { attacking: true }),
      ],
      stumble: [
        falconFrame(dir, 0.4),
      ],
      death: [
        falconFrame(dir, 0.2, { dead: true, deathT: 0.2 }),
        falconFrame(dir, 0.5, { dead: true, deathT: 0.5 }),
        falconFrame(dir, 0.8, { dead: true, deathT: 0.8 }),
        falconFrame(dir, 1.0, { dead: true, deathT: 1.0 }),
      ],
    };
  }

  return out as ActorPaints;
}
