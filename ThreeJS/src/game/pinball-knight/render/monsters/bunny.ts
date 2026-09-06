/**
 * ZOMBIE MINI BUNNY RABBIT — cute yet creepy undead minion spawned by the Necromancer.
 *
 * Procedural fallback cel-painter parameterised by (dir, phase).
 * Features tattered grey/decay-green fur, long floppy zombie rabbit ears,
 * glowing crimson evil eyes, twitching nose, and an energetic hopping gait.
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

// Palette Ramps
const R_FUR: Ramp = [23, 24, 25];     // Decay greenish-grey fur
const R_EAR_INNER: Ramp = [2, 3, 4];  // Rotting dark violet/pink ear lining
const R_NOSE = "#331122";
const R_EYE = "#FF2233";              // Glowing crimson undead eyes

function bunnyFrame(dir: Dir, phase: number, dead = false): FramePaint {
  return (ctx) => {
    if (dead) {
      // Squashed / popped bunny with flopped ears
      groundShadow(ctx, CX, GROUND, 10);
      ellShaded(ctx, CX, GROUND - 2, 8, 3, R_FUR);
      // Flopped ears on ground
      ctx.fillStyle = "#3a443a";
      ctx.fillRect(CX - 7, GROUND - 3, 5, 2);
      ctx.fillRect(CX + 3, GROUND - 3, 6, 2);
      return;
    }

    // Hopping arc: parabolic hop during walk/move
    const hopHeight = Math.max(0, Math.sin(phase * Math.PI)) * 8;
    const bodyY = GROUND - 10 - hopHeight;

    // Contact shadow (shrinks as bunny hops up)
    groundShadow(ctx, CX, GROUND, Math.max(4, 10 - hopHeight * 0.6));

    // Little fluffy cotton-ball tail (visible especially in N or E)
    if (dir === "N" || dir === "E") {
      const tailX = dir === "E" ? CX - 7 : CX;
      const tailY = bodyY + 2;
      ellShaded(ctx, tailX, tailY, 3, 3, R_FUR);
    }

    // Bunny Body (round, hunched rabbit torso)
    ellShaded(ctx, CX, bodyY, 7, 6, R_FUR);

    // Hind legs & paws
    const legExtend = hopHeight > 2 ? 3 : 0;
    ellShaded(ctx, CX - 4, bodyY + 4 + legExtend, 3, 3, R_FUR);
    ellShaded(ctx, CX + 4, bodyY + 4 + legExtend, 3, 3, R_FUR);

    // Head
    const headY = bodyY - 5;
    const headX = dir === "E" ? CX + 3 : CX;
    ellShaded(ctx, headX, headY, 5, 5, R_FUR);

    // Long Zombie Rabbit Ears
    const earY = headY - 8;
    // Left ear (straight/twitching)
    const earWiggle = Math.sin(phase * Math.PI * 2) * 1.5;
    ellShaded(ctx, headX - 3 + earWiggle, earY, 2, 6, R_FUR);
    ctx.fillStyle = "#4a2233";
    ctx.fillRect(headX - 3 + earWiggle, earY - 2, 1, 4);

    // Right ear (slightly bent / notched zombie ear)
    ellShaded(ctx, headX + 3 - earWiggle, earY + 1, 2, 5, R_FUR);
    ctx.fillStyle = "#4a2233";
    ctx.fillRect(headX + 3 - earWiggle, earY - 1, 1, 3);

    // Face Details (Face forward in S or side in E)
    if (dir !== "N") {
      // Glowing evil red eyes
      ctx.fillStyle = R_EYE;
      if (dir === "E") {
        ctx.fillRect(headX + 3, headY - 1, 2, 2);
        figGlow(ctx, headX + 4, headY, 3, 18, 17);
      } else {
        ctx.fillRect(headX - 3, headY - 1, 2, 2);
        ctx.fillRect(headX + 1, headY - 1, 2, 2);
        figGlow(ctx, headX - 2, headY, 2.5, 18, 17);
        figGlow(ctx, headX + 2, headY, 2.5, 18, 17);
      }

      // Little twitching nose
      ctx.fillStyle = R_NOSE;
      const noseX = dir === "E" ? headX + 4 : headX - 0.5;
      ctx.fillRect(noseX, headY + 2, 1.5, 1);
    }
  };
}

function bunnyAttack(dir: Dir, t: number): FramePaint {
  return (ctx) => {
    // Attack leap: lunging forward with bared buck teeth
    const lungeHop = Math.sin(t * Math.PI) * 10;
    const bodyY = GROUND - 10 - lungeHop;

    groundShadow(ctx, CX, GROUND, Math.max(3, 9 - lungeHop * 0.5));

    // Body lunging forward
    const fwdX = dir === "E" ? CX + (t * 6) : CX;
    ellShaded(ctx, fwdX, bodyY, 8, 5, R_FUR);

    // Head
    const headX = dir === "E" ? fwdX + 5 : fwdX;
    const headY = bodyY - 4;
    ellShaded(ctx, headX, headY, 5, 5, R_FUR);

    // Swept-back ears during leap
    ellShaded(ctx, headX - 4, headY - 4, 4, 2, R_FUR);
    ellShaded(ctx, headX - 3, headY - 6, 4, 2, R_FUR);

    // Glowing red eyes
    ctx.fillStyle = R_EYE;
    ctx.fillRect(headX + 1, headY - 1, 2, 2);
    figGlow(ctx, headX + 2, headY, 4, 18, 17);

    // Sharp little buck teeth nipping
    if (t > 0.3 && t < 0.8) {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(headX + 3, headY + 2, 2, 2);
      ctx.fillRect(headX + 3, headY + 3, 2, 1);
    }
  };
}

export function makeBunnyPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [bunnyFrame(dir, 0), bunnyFrame(dir, 0.5)],
    walk: [
      bunnyFrame(dir, 0),
      bunnyFrame(dir, 0.35),
      bunnyFrame(dir, 0.7),
      bunnyFrame(dir, 1),
    ],
    attack: [bunnyAttack(dir, 0), bunnyAttack(dir, 0.5), bunnyAttack(dir, 1)],
    death: [
      bunnyFrame(dir, 0.5),
      bunnyFrame(dir, 0, true),
      bunnyFrame(dir, 0, true),
      bunnyFrame(dir, 0, true),
    ],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
