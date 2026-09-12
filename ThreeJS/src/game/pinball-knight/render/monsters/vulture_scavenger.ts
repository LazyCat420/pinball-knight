/**
 * VULTURE SCAVENGER — a hulking, ragged umber scavenger bird with a bare
 * wrinkled neck, hunched feather ruff, hooked bone beak, and dripping
 * toxic sludge pouch.
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
const R_BODY: Ramp = [26, 27, 28];     // Ragged dark umber / leather feathers
const R_RUFF: Ramp = [27, 28, 4];      // Dusty neck ruff collar
const R_NECK: Ramp = [23, 24, 25];     // Bare wrinkled flesh / skin
const R_BEAK: Ramp = [2, 3, 4];        // Pale hooked bone beak
const R_EYE: Ramp = [14, 15, 16];      // Predatory amber/torch eye
const R_TALONS: Ramp = [26, 27, 28];   // Gnarled talons
const R_SLUDGE: Ramp = [6, 7, 9];      // Toxic rot green sludge sac
const R_DRIP: Ramp = [8, 9, 18];       // Acid glow drip highlight

interface PoseOpts {
  attacking?: boolean;
  dead?: boolean;
  deathT?: number;
}

function vultureFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { attacking = false, dead = false, deathT = 0 } = opts;

    if (dead) {
      const t = deathT || 0.6;
      groundShadow(ctx, CX, GROUND + 1, 18);

      // Fallen bird body on ground
      ellShaded(ctx, CX, GROUND - 7, 15, 7, R_BODY);

      // Bare neck stretched on ground
      limbShaded(ctx, [CX + 6, GROUND - 6], [CX + 18 + t * 4, GROUND - 3], 4, R_NECK);

      // Toxic splatters
      ellShaded(ctx, CX - 10 - t * 8, GROUND - 5, 5, 3, R_SLUDGE);
      ellShaded(ctx, CX + 12 + t * 10, GROUND - 4, 6, 4, R_SLUDGE);

      // Feathers
      ellShaded(ctx, CX - 14 - t * 6, GROUND - 12 - t * 8, 4, 3, R_BODY);
      ellShaded(ctx, CX + 8, GROUND - 16 - t * 10, 5, 3, R_RUFF);
      return;
    }

    const flap = Math.sin(phase * Math.PI * 2) * 5.5;
    const hoverY = Math.cos(phase * Math.PI * 2) * 3;
    const lungeX = attacking ? (dir === "E" ? 10 : dir === "S" ? 0 : -10) : 0;
    const lungeY = attacking ? 4 : 0;

    groundShadow(ctx, CX + lungeX * 0.4, GROUND + 1, 20);

    const bodyX = CX - 2 + lungeX;
    const bodyY = GROUND - 34 + hoverY + lungeY;

    // Ragged tail feathers
    plateShaded(
      ctx,
      [
        [bodyX - 14, bodyY + 6],
        [bodyX - 4, bodyY + 2],
        [bodyX - 4, bodyY + 8],
        [bodyX - 12, bodyY + 12],
      ],
      R_BODY,
    );

    // Hunched heavy body
    ellShaded(ctx, bodyX, bodyY + 2, 16, 12, R_BODY);

    // Dusty neck ruff collar
    ellShaded(ctx, bodyX + 6, bodyY - 3, 9, 7, R_RUFF);

    // Broad wings with jagged tips
    if (attacking) {
      plateShaded(
        ctx,
        [
          [bodyX - 8, bodyY],
          [bodyX - 18, bodyY - 16],
          [bodyX + 2, bodyY - 20],
          [bodyX + 6, bodyY - 4],
        ],
        R_BODY,
      );
    } else {
      ellShaded(ctx, bodyX - 6, bodyY - flap, 18, 9, R_BODY);
    }

    // Bare S-curved wrinkled neck
    const neckBaseX = bodyX + (dir === "E" ? 8 : dir === "S" ? 4 : -4);
    const neckBaseY = bodyY - 5;
    const headTargetX = neckBaseX + (attacking ? (dir === "E" ? 14 : 0) : (dir === "E" ? 8 : dir === "S" ? 2 : -6));
    const headTargetY = neckBaseY - (attacking ? 2 : 7);

    limbShaded(ctx, [neckBaseX, neckBaseY], [headTargetX, headTargetY], 4, R_NECK);

    // Bare vulture head
    ellShaded(ctx, headTargetX, headTargetY, 6, 6, R_NECK);

    // Amber Eye
    const eyeX = headTargetX + (dir === "E" ? 3 : dir === "S" ? 2 : -2);
    const eyeY = headTargetY - 1;
    ellShaded(ctx, eyeX, eyeY, 2, 2, R_EYE);

    // Hooked Bone Beak
    if (dir === "E") {
      plateShaded(
        ctx,
        [
          [headTargetX + 4, headTargetY - 2],
          [headTargetX + 13, headTargetY + 1],
          [headTargetX + 11, headTargetY + 6],
          [headTargetX + 4, headTargetY + 3],
        ],
        R_BEAK,
      );
    } else if (dir === "S") {
      plateShaded(
        ctx,
        [
          [headTargetX - 2, headTargetY + 2],
          [headTargetX + 4, headTargetY + 2],
          [headTargetX + 1, headTargetY + 9],
        ],
        R_BEAK,
      );
    } else {
      plateShaded(
        ctx,
        [
          [headTargetX - 4, headTargetY - 2],
          [headTargetX - 13, headTargetY + 1],
          [headTargetX - 11, headTargetY + 6],
          [headTargetX - 4, headTargetY + 3],
        ],
        R_BEAK,
      );
    }

    // Underbelly Sludge Pouch & Talons
    const pouchY = bodyY + 11;
    if (attacking) {
      // Heaving/dropping toxic sludge blob
      ellShaded(ctx, bodyX, pouchY + 10, 8, 7, R_SLUDGE);
      figGlow(ctx, bodyX + 1, pouchY + 12, 2, 9, 18);
    } else {
      // Distended bubbling sludge sac
      ellShaded(ctx, bodyX + 2, pouchY, 9, 7, R_SLUDGE);
      figGlow(ctx, bodyX + 3, pouchY + 2, 2, 9, 18);
      // Gnarled talons gripping the sac
      limbShaded(ctx, [bodyX - 3, pouchY - 4], [bodyX - 2, pouchY + 2], 2.5, R_TALONS);
      limbShaded(ctx, [bodyX + 5, pouchY - 4], [bodyX + 4, pouchY + 2], 2.5, R_TALONS);
    }
  };
}

export function makeVultureScavengerPaints(): ActorPaints {
  const dirs: Dir[] = ["S", "N", "E"];
  const out: Partial<Record<Dir, any>> = {};

  for (const dir of dirs) {
    out[dir] = {
      idle: [
        vultureFrame(dir, 0.0),
        vultureFrame(dir, 0.25),
        vultureFrame(dir, 0.5),
        vultureFrame(dir, 0.75),
      ],
      walk: [
        vultureFrame(dir, 0.1),
        vultureFrame(dir, 0.35),
        vultureFrame(dir, 0.6),
        vultureFrame(dir, 0.85),
      ],
      run: [
        vultureFrame(dir, 0.15),
        vultureFrame(dir, 0.4),
        vultureFrame(dir, 0.65),
        vultureFrame(dir, 0.9),
      ],
      attack: [
        vultureFrame(dir, 0.0, { attacking: true }),
        vultureFrame(dir, 0.25, { attacking: true }),
        vultureFrame(dir, 0.5, { attacking: true }),
        vultureFrame(dir, 0.75, { attacking: true }),
      ],
      stumble: [
        vultureFrame(dir, 0.4),
      ],
      death: [
        vultureFrame(dir, 0.2, { dead: true, deathT: 0.2 }),
        vultureFrame(dir, 0.5, { dead: true, deathT: 0.5 }),
        vultureFrame(dir, 0.8, { dead: true, deathT: 0.8 }),
        vultureFrame(dir, 1.0, { dead: true, deathT: 1.0 }),
      ],
    };
  }

  return out as ActorPaints;
}
