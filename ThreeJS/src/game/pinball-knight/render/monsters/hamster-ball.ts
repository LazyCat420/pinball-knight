/**
 * HAMSTER BALL — a manic hamster sprinting inside a transparent plastic exercise ball.
 * Dual-mode combat physics:
 *  - When player is walking (p.momSpeed <= 0): touches player and damages them.
 *  - When player is in pinball roll (p.momSpeed > 0): behaves as a kinetic deflector /
 *    pinball bumper, launching the pinball away at high ricochet velocity.
 *  - On death: the plastic sphere fractures and shatters into ricocheting plastic shards.
 *
 * Procedural fallback cel-painter parameterised by (dir, phase, opts).
 */
import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  limbShaded,
  glow as figGlow,
  groundShadow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

// Palette ramps:
// Transparent Plastic Shell (Cyan / Sky Gloss):
const R_PLASTIC: Ramp = [2, 3, 4];
const R_PLASTIC_HOT: Ramp = [20, 21, 22]; // Specular white highlight
// Fluffy Hamster Body (Golden Brown / Buff):
const R_FUR: Ramp = [11, 12, 13];
const R_FUR_BELLY: Ramp = [14, 15, 16]; // Cream / light buff
// Ears & Paws (Soft Pink):
const R_PINK: Ramp = [6, 7, 8];
// Eyes & Whiskers:
const R_EYES: Ramp = [17, 18, 19];

interface PoseOpts {
  bob?: number;
  rollAngle?: number;
  charging?: boolean;
  deathT?: number; // 0..1
  dead?: boolean;
}

function hamsterBallFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { bob = 0, rollAngle = 0, charging = false, deathT = 0, dead = false } = opts;

    if (dead || deathT > 0) {
      // Shattered plastic sphere shards scattering, dizzy hamster
      const t = Math.min(1, Math.max(0, deathT));
      const collapseY = GROUND - 2 + t * 2;

      groundShadow(ctx, CX, GROUND, Math.max(4, 12 * (1 - t * 0.5)));

      // Fractured plastic shell fragments flying apart
      const shardSpread = t * 16;
      ellShaded(ctx, CX - 10 - shardSpread, collapseY - 6 - t * 4, 5, 3, R_PLASTIC, -0.6);
      ellShaded(ctx, CX + 10 + shardSpread, collapseY - 8 - t * 6, 4, 3, R_PLASTIC, 0.7);
      ellShaded(ctx, CX - 4 - shardSpread * 0.6, collapseY - 14 - t * 8, 3, 2, R_PLASTIC_HOT, 0.2);
      ellShaded(ctx, CX + 5 + shardSpread * 0.7, collapseY + 2 + t * 2, 4, 2, R_PLASTIC, 1.1);

      // Dizzy little hamster tumbling in the center
      const hamX = CX + t * 4;
      const hamY = collapseY - 3;
      ellShaded(ctx, hamX, hamY, 6, 5, R_FUR, 0.4);
      ellShaded(ctx, hamX - 2, hamY + 1, 4, 3, R_FUR_BELLY, 0.2);
      // Pink little paws and ears
      ellShaded(ctx, hamX - 3, hamY - 4, 1.5, 1.5, R_PINK);
      ellShaded(ctx, hamX + 2, hamY - 4, 1.5, 1.5, R_PINK);
      ellShaded(ctx, hamX + 4, hamY + 2, 1.5, 1.5, R_PINK);
      // Spiral dizzy eyes
      ellShaded(ctx, hamX + 2, hamY - 1, 1.2, 1.2, R_EYES);
      ellShaded(ctx, hamX - 1, hamY - 1, 1.2, 1.2, R_EYES);
      return;
    }

    const sphereR = charging ? 14 : 13;
    const centerY = GROUND - 11 + bob;

    // Ground shadow beneath transparent sphere
    groundShadow(ctx, CX, GROUND, sphereR + 1);

    // Kinetic charge glow if attacking/charging
    if (charging) {
      figGlow(ctx, CX, centerY, sphereR + 4, 4, 21);
    }

    // --- Back half of the transparent plastic sphere (translucent base) ---
    ellShaded(ctx, CX, centerY, sphereR, sphereR, R_PLASTIC, 0);

    // --- Inner Hamster Body ---
    const hamScale = 0.62;
    const hamY = centerY + 3 - Math.abs(Math.sin(phase * Math.PI * 2)) * 1.5;
    const hamX = dir === "E" ? CX + 2 : CX;

    // Little scurrying paws
    const step = Math.sin(phase * Math.PI * 2);
    limbShaded(ctx, [hamX - 4, hamY + 3], [hamX - 5 + step * 2, hamY + 6], 1.2, R_PINK);
    limbShaded(ctx, [hamX + 3, hamY + 3], [hamX + 4 - step * 2, hamY + 6], 1.2, R_PINK);

    // Chubby torso
    ellShaded(ctx, hamX, hamY, 7 * hamScale + 2.5, 6 * hamScale + 2, R_FUR, dir === "E" ? 0.3 : -0.3);
    // Belly patch
    if (dir !== "N") {
      ellShaded(ctx, hamX, hamY + 1, 5 * hamScale + 1, 4 * hamScale + 1, R_FUR_BELLY, 0);
    }

    // Head, ears, and cute face
    const headY = hamY - 3;
    const headX = dir === "E" ? hamX + 2 : hamX;
    ellShaded(ctx, headX, headY, 5 * hamScale + 1.5, 4.5 * hamScale + 1.5, R_FUR, 0);

    // Pink ears
    ellShaded(ctx, headX - 3, headY - 3, 1.5, 1.5, R_PINK);
    ellShaded(ctx, headX + 3, headY - 3, 1.5, 1.5, R_PINK);

    if (dir !== "N") {
      // Big cartoon eyes with white catchlight
      ellShaded(ctx, headX - 2, headY, 1.2, 1.5, R_EYES);
      ellShaded(ctx, headX - 2, headY - 1, 0.8, 0.8, R_PLASTIC_HOT);
      ellShaded(ctx, headX + 2, headY, 1.2, 1.5, R_EYES);
      ellShaded(ctx, headX + 2, headY - 1, 0.8, 0.8, R_PLASTIC_HOT);

      // Pink nose
      ellShaded(ctx, headX, headY + 2, 1, 0.8, R_PINK);
    }

    // --- Front half of transparent plastic sphere with highlights & seam lines ---
    // Equatorial rotating seam line
    const seamRot = rollAngle + phase * Math.PI * 2;
    const seamH = Math.abs(Math.cos(seamRot)) * (sphereR * 0.75);
    ellShaded(ctx, CX, centerY, sphereR, Math.max(1, seamH), R_PLASTIC, 0.2);

    // Outer glassy sphere reflection rim
    ellShaded(ctx, CX, centerY, sphereR, sphereR, R_PLASTIC, 0.35, { rim: true });

    // Curved specular highlight gloss on top-left of exercise ball
    ellShaded(ctx, CX - sphereR * 0.45, centerY - sphereR * 0.45, 1.5, 1.5, R_PLASTIC_HOT);
    ellShaded(ctx, CX - sphereR * 0.45 + 1, centerY - sphereR * 0.45, 1.2, 1.2, R_PLASTIC_HOT);
    ellShaded(ctx, CX - sphereR * 0.35, centerY - sphereR * 0.55, 1.2, 1.2, R_PLASTIC_HOT);
    ellShaded(ctx, CX - sphereR * 0.55, centerY - sphereR * 0.35, 1.2, 1.2, R_PLASTIC_HOT);
  };
}

export function makeHamsterBallPaints(): ActorPaints {
  const mkDir = (dir: Dir) => ({
    idle: [
      hamsterBallFrame(dir, 0.0, { bob: 0, rollAngle: 0 }),
      hamsterBallFrame(dir, 0.25, { bob: -1, rollAngle: 0.1 }),
      hamsterBallFrame(dir, 0.5, { bob: 0, rollAngle: 0.2 }),
      hamsterBallFrame(dir, 0.75, { bob: 1, rollAngle: 0.1 }),
    ],
    walk: [
      hamsterBallFrame(dir, 0.0, { bob: -0.5, rollAngle: 0 }),
      hamsterBallFrame(dir, 0.25, { bob: 0.5, rollAngle: Math.PI * 0.5 }),
      hamsterBallFrame(dir, 0.5, { bob: -0.5, rollAngle: Math.PI }),
      hamsterBallFrame(dir, 0.75, { bob: 0.5, rollAngle: Math.PI * 1.5 }),
    ],
    attack: [
      hamsterBallFrame(dir, 0.0, { bob: 0, charging: true, rollAngle: 0 }),
      hamsterBallFrame(dir, 0.25, { bob: -1, charging: true, rollAngle: Math.PI * 0.7 }),
      hamsterBallFrame(dir, 0.5, { bob: 1, charging: true, rollAngle: Math.PI * 1.4 }),
      hamsterBallFrame(dir, 0.75, { bob: -0.5, charging: true, rollAngle: Math.PI * 2.1 }),
    ],
    death: [
      hamsterBallFrame(dir, 0.0, { deathT: 0.1 }),
      hamsterBallFrame(dir, 0.33, { deathT: 0.45 }),
      hamsterBallFrame(dir, 0.66, { deathT: 0.8 }),
      hamsterBallFrame(dir, 1.0, { deathT: 1.0, dead: true }),
    ],
  });

  return {
    S: mkDir("S"),
    N: mkDir("N"),
    E: mkDir("E"),
  };
}
