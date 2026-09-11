/**
 * BLASTER FRANK — short, stout, balding rogue inspired by Danny DeVito / Frank Reynolds
 * wearing round spectacles and an unbuttoned trenchcoat, wielding a snub-nosed revolver
 * that he shoots into the ceiling.
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

const R_SKIN: Ramp = [4, 5, 16];       // Warm peach skin tone
const R_COAT: Ramp = [16, 17, 24];     // Tan / khaki rumpled trenchcoat
const R_SHIRT: Ramp = [8, 9, 10];      // Dark forest green collared shirt
const R_PANTS: Ramp = [4, 5, 16];      // Brown trousers
const R_GUN: Ramp = [20, 21, 22];      // Steel / chrome snub-nosed revolver
const R_HAIR: Ramp = [20, 21, 22];     // Gray / black side hair tufts
const R_FLASH: Ramp = [16, 17, 24];    // Yellow / orange muzzle flash & sparks

interface PoseOpts {
  step?: number;
  shootSky?: boolean;
  misfireSparks?: boolean;
  recoil?: number;
  dead?: boolean;
}

function blasterFrankFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { step = 0, shootSky = false, misfireSparks = false, recoil = 0, dead = false } = opts;

    if (dead) {
      groundShadow(ctx, CX, GROUND, 22);
      // Flat fallen body on back
      ellShaded(ctx, CX, GROUND - 4, 16, 6, R_COAT);
      ellShaded(ctx, CX - 2, GROUND - 5, 10, 4, R_SHIRT);
      // Fallen bald head with dizzy glasses
      ellShaded(ctx, CX - 12, GROUND - 5, 6, 5, R_SKIN);
      // Dizzy spectacles
      figDetail(ctx, CX - 13, GROUND - 6, 2, 2, [0, 0, 0]);
      figDetail(ctx, CX - 10, GROUND - 6, 2, 2, [0, 0, 0]);
      // Dropped smoking revolver
      ellShaded(ctx, CX + 14, GROUND - 4, 4, 2, R_GUN);
      figDetail(ctx, CX + 16, GROUND - 5, 2, 1, R_GUN);
      // Smoke puff
      figGlow(ctx, CX + 16, GROUND - 8, 4, 20, 21);
      return;
    }

    groundShadow(ctx, CX, GROUND, 18);

    // Short stubby waddling legs & dark shoes
    const legOffset = step * 3;
    ellShaded(ctx, CX - 5 + legOffset, GROUND - 3, 3, 4, R_PANTS);
    ellShaded(ctx, CX + 5 - legOffset, GROUND - 3, 3, 4, R_PANTS);
    figDetail(ctx, CX - 6 + legOffset, GROUND - 1, 4, 2, [0, 0, 0]);
    figDetail(ctx, CX + 6 - legOffset, GROUND - 1, 4, 2, [0, 0, 0]);

    // Recoil offset
    const recY = recoil * 2;
    const bob = Math.sin(phase * Math.PI * 2) * 1.2 + recY;

    // Stout rounded torso (green shirt visible in middle, unbuttoned coat on sides)
    ellShaded(ctx, CX, GROUND - 14 + bob, 12, 10, R_COAT);
    ellShaded(ctx, CX, GROUND - 13 + bob, 7, 8, R_SHIRT);

    // Round head, bald top with hair fringe on sides
    const headY = GROUND - 24 + bob;
    // Side hair tufts
    ellShaded(ctx, CX - 8, headY - 1, 3, 5, R_HAIR);
    ellShaded(ctx, CX + 8, headY - 1, 3, 5, R_HAIR);
    // Bald head
    ellShaded(ctx, CX, headY, 7, 7, R_SKIN);

    // Round spectacles / glasses & mustache
    figDetail(ctx, CX - 3, headY, 2, 2, [0, 0, 0]);
    figDetail(ctx, CX + 3, headY, 2, 2, [0, 0, 0]);
    figDetail(ctx, CX, headY - 1, 2, 1, [0, 0, 0]); // bridge
    figDetail(ctx, CX, headY + 3, 4, 1, [0, 0, 0]); // mustache

    if (shootSky) {
      // Arms raised high, pointing revolver straight UP into the ceiling!
      ellShaded(ctx, CX + 7, headY - 4, 3, 7, R_COAT);
      // Hand holding revolver pointed UP
      ellShaded(ctx, CX + 8, headY - 12, 3, 4, R_GUN);
      figDetail(ctx, CX + 8, headY - 16, 2, 3, R_GUN); // barrel pointing up

      // Muzzle flash star and sparks erupting upward
      figGlow(ctx, CX + 8, headY - 22, 10, R_FLASH[1], R_FLASH[2]);
      figDetail(ctx, CX + 8, headY - 24, 4, 5, R_FLASH);
      figDetail(ctx, CX + 4, headY - 22, 2, 2, R_FLASH);
      figDetail(ctx, CX + 12, headY - 22, 2, 2, R_FLASH);
    } else {
      // Idle / waddling stance: revolver held forward at waist level
      ellShaded(ctx, CX + 9, GROUND - 13 + bob, 3, 5, R_COAT);
      ellShaded(ctx, CX + 11, GROUND - 14 + bob, 4, 3, R_GUN);
      figDetail(ctx, CX + 14, GROUND - 14 + bob, 3, 1.5, R_GUN); // barrel

      if (misfireSparks) {
        // Sudden unexpected spark at muzzle
        figGlow(ctx, CX + 17, GROUND - 14 + bob, 6, R_FLASH[1], R_FLASH[2]);
      }
    }
  };
}

export function makeBlasterFrankPaints(): ActorPaints {
  const S = {
    idle: [
      blasterFrankFrame("S", 0.0),
      blasterFrankFrame("S", 0.25),
      blasterFrankFrame("S", 0.5),
      blasterFrankFrame("S", 0.75),
    ],
    walk: [
      blasterFrankFrame("S", 0.0, { step: 1 }),
      blasterFrankFrame("S", 0.25, { step: 0 }),
      blasterFrankFrame("S", 0.5, { step: -1 }),
      blasterFrankFrame("S", 0.75, { step: 0 }),
    ],
    attack: [
      blasterFrankFrame("S", 0.0, { shootSky: true, recoil: 0 }),
      blasterFrankFrame("S", 0.3, { shootSky: true, recoil: 1 }),
      blasterFrankFrame("S", 0.6, { shootSky: true, recoil: 1.5 }),
      blasterFrankFrame("S", 0.9, { shootSky: true, recoil: 0.5 }),
    ],
    death: [
      blasterFrankFrame("S", 0.0, { recoil: 2 }),
      blasterFrankFrame("S", 0.33, { recoil: 3 }),
      blasterFrankFrame("S", 0.66, { dead: true }),
      blasterFrankFrame("S", 1.0, { dead: true }),
    ],
  };

  const N = {
    idle: [
      blasterFrankFrame("N", 0.0),
      blasterFrankFrame("N", 0.25),
      blasterFrankFrame("N", 0.5),
      blasterFrankFrame("N", 0.75),
    ],
    walk: [
      blasterFrankFrame("N", 0.0, { step: 1 }),
      blasterFrankFrame("N", 0.25, { step: 0 }),
      blasterFrankFrame("N", 0.5, { step: -1 }),
      blasterFrankFrame("N", 0.75, { step: 0 }),
    ],
    attack: [
      blasterFrankFrame("N", 0.0, { shootSky: true, recoil: 0 }),
      blasterFrankFrame("N", 0.3, { shootSky: true, recoil: 1 }),
      blasterFrankFrame("N", 0.6, { shootSky: true, recoil: 1.5 }),
      blasterFrankFrame("N", 0.9, { shootSky: true, recoil: 0.5 }),
    ],
    death: [
      blasterFrankFrame("N", 0.0, { recoil: 2 }),
      blasterFrankFrame("N", 0.33, { recoil: 3 }),
      blasterFrankFrame("N", 0.66, { dead: true }),
      blasterFrankFrame("N", 1.0, { dead: true }),
    ],
  };

  const E = {
    idle: [
      blasterFrankFrame("E", 0.0),
      blasterFrankFrame("E", 0.25),
      blasterFrankFrame("E", 0.5),
      blasterFrankFrame("E", 0.75),
    ],
    walk: [
      blasterFrankFrame("E", 0.0, { step: 1 }),
      blasterFrankFrame("E", 0.25, { step: 0 }),
      blasterFrankFrame("E", 0.5, { step: -1 }),
      blasterFrankFrame("E", 0.75, { step: 0 }),
    ],
    attack: [
      blasterFrankFrame("E", 0.0, { shootSky: true, recoil: 0 }),
      blasterFrankFrame("E", 0.3, { shootSky: true, recoil: 1 }),
      blasterFrankFrame("E", 0.6, { shootSky: true, recoil: 1.5 }),
      blasterFrankFrame("E", 0.9, { shootSky: true, recoil: 0.5 }),
    ],
    death: [
      blasterFrankFrame("E", 0.0, { recoil: 2 }),
      blasterFrankFrame("E", 0.33, { recoil: 3 }),
      blasterFrankFrame("E", 0.66, { dead: true }),
      blasterFrankFrame("E", 1.0, { dead: true }),
    ],
  };

  return { S, N, E };
}
