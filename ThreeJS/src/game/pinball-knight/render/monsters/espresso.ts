/**
 * WALKING ESPRESSO CUP — a porcelain demitasse cup of scalding espresso on
 * little ceramic feet.
 *
 * Procedural fallback cel-painter parameterised by (dir, phase, pose).
 * - Attack: Disneyland spinning teacup attack, spinning rapidly in place with
 *   centrifugal coffee droplets.
 * - Death: Cup shatters/tips over, spilling boiling coffee and crema across the floor.
 */
import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  plateShaded,
  detail as figDetail,
  glow as figGlow,
  groundShadow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

// Palette ramps
const R_CERAMIC: Ramp = [20, 21, 22];    // White / bone porcelain cup
const R_CERAMIC_DK: Ramp = [19, 20, 21]; // Shadow on ceramic curve
const R_COFFEE: Ramp = [1, 26, 27];      // Dark roast espresso
const R_CREMA: Ramp = [16, 17, 24];      // Golden rich crema foam
const R_STEAM: Ramp = [20, 21, 22];      // Pale steam wisps
const R_HANDLE: Ramp = [19, 21, 22];     // Glazed porcelain handle

interface PoseOpts {
  spinAngle?: number;    // Spin progression for teacup attack
  tilt?: number;         // Cup tilt angle
  wobble?: number;       // Walk wobble
  spillT?: number;       // Death spill progress
  dead?: boolean;
}

function espressoFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { spinAngle = 0, tilt = 0, wobble = 0, spillT = 0, dead = false } = opts;

    if (dead) {
      // Shattered/collapsed cup spilling boiling coffee
      groundShadow(ctx, CX, GROUND + 1, 20);

      // Spilled dark coffee puddle with crema swirls
      ellShaded(ctx, CX, GROUND - 1, 22, 7, R_COFFEE);
      ellShaded(ctx, CX + 3, GROUND - 1, 14, 4, R_CREMA);

      // Cracked cup shards
      plateShaded(
        ctx,
        [
          [CX - 12, GROUND - 2],
          [CX - 6, GROUND - 10],
          [CX + 2, GROUND - 6],
          [CX - 4, GROUND - 1],
        ],
        R_CERAMIC,
      );
      plateShaded(
        ctx,
        [
          [CX + 4, GROUND - 1],
          [CX + 8, GROUND - 8],
          [CX + 14, GROUND - 3],
        ],
        R_CERAMIC_DK,
      );

      // Floating steam wisps
      figDetail(ctx, [[CX - 2, GROUND - 8], [CX - 4, GROUND - 14]], 1.5, 21);
      figDetail(ctx, [[CX + 6, GROUND - 7], [CX + 8, GROUND - 13]], 1.5, 21);
      return;
    }

    // Shadow on ground
    const shadowR = Math.max(8, 14 - Math.abs(tilt) * 3);
    groundShadow(ctx, CX, GROUND + 1, shadowR);

    const bob = Math.sin(phase * Math.PI * 2) * 2;
    const cupY = GROUND - 12 + bob;
    const cupX = CX + wobble * 2;

    // Ceramic Feet
    if (spinAngle === 0) {
      const legPhase = Math.sin(phase * Math.PI * 2);
      // Left foot
      ellShaded(ctx, cupX - 5, GROUND - 2 + (legPhase > 0 ? -legPhase * 3 : 0), 3, 3, R_CERAMIC_DK);
      // Right foot
      ellShaded(ctx, cupX + 5, GROUND - 2 + (legPhase < 0 ? legPhase * 3 : 0), 3, 3, R_CERAMIC_DK);
    }

    ctx.save();
    ctx.translate(cupX, cupY);
    if (tilt !== 0) ctx.rotate(tilt);
    if (spinAngle !== 0) {
      // Squash and stretch horizontally during spin to simulate 3D rotation
      const spinScale = Math.cos(spinAngle);
      ctx.scale(spinScale === 0 ? 0.1 : spinScale, 1);
    }

    // Saucer base
    ellShaded(ctx, 0, 8, 12, 3, R_CERAMIC);

    // Cup body (trapezoidal ceramic bowl)
    plateShaded(
      ctx,
      [
        [-8, 7],
        [-11, -4],
        [11, -4],
        [8, 7],
      ],
      R_CERAMIC,
    );

    // Porcelain Handle
    if (dir !== "N") {
      figDetail(ctx, [[10, -1], [15, 1], [10, 5]], 2.5, 21);
    }

    // Coffee rim (top opening)
    ellShaded(ctx, 0, -4, 11, 4, R_CERAMIC_DK);
    // Dark espresso inside
    ellShaded(ctx, 0, -4, 9, 3, R_COFFEE);
    // Crema foam circle
    ellShaded(ctx, 1, -4, 6, 2, R_CREMA);

    // Steam wisps rising
    if (spinAngle === 0) {
      const steamBob = (phase * 6) % 6;
      figDetail(ctx, [[-2, -8 - steamBob], [-1, -12 - steamBob]], 1.2, 21);
      figDetail(ctx, [[3, -7 - steamBob], [4, -11 - steamBob]], 1.2, 21);
    } else {
      // Flung coffee droplets in spin
      figDetail(ctx, [[-14, -2], [-18, -4]], 1.5, 27);
      figDetail(ctx, [[14, 2], [18, 4]], 1.5, 27);
      figGlow(ctx, 0, 0, 6, 17, 18);
    }

    ctx.restore();
  };
}

export function makeEspressoPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    // Idle: gentle warm steaming and bubbling
    idle: [
      espressoFrame(dir, 0, { tilt: 0 }),
      espressoFrame(dir, 0.25, { tilt: 0.04 }),
      espressoFrame(dir, 0.5, { tilt: 0 }),
      espressoFrame(dir, 0.75, { tilt: -0.04 }),
    ],
    // Walk: fast waddling run
    walk: [
      espressoFrame(dir, 0, { wobble: -1, tilt: -0.08 }),
      espressoFrame(dir, 0.25, { wobble: 0, tilt: 0 }),
      espressoFrame(dir, 0.5, { wobble: 1, tilt: 0.08 }),
      espressoFrame(dir, 0.75, { wobble: 0, tilt: 0 }),
    ],
    // Attack: Disneyland spinning teacup attack!
    attack: [
      espressoFrame(dir, 0, { spinAngle: Math.PI * 0.5, tilt: 0.15 }),
      espressoFrame(dir, 0.25, { spinAngle: Math.PI * 1.0, tilt: -0.15 }),
      espressoFrame(dir, 0.5, { spinAngle: Math.PI * 1.5, tilt: 0.18 }),
      espressoFrame(dir, 0.75, { spinAngle: Math.PI * 2.0, tilt: -0.18 }),
    ],
    // Stumble: sloshing violently
    stumble: [
      espressoFrame(dir, 0.2, { tilt: 0.25, wobble: -2 }),
      espressoFrame(dir, 0.6, { tilt: -0.2, wobble: 2 }),
    ],
    // Death: cup cracks and boiling coffee spills
    death: [
      espressoFrame(dir, 0.1, { tilt: 0.4 }),
      espressoFrame(dir, 0.3, { tilt: 0.7, spillT: 0.3 }),
      espressoFrame(dir, 0.6, { tilt: 0.9, spillT: 0.7 }),
      espressoFrame(dir, 0, { dead: true, spillT: 1.0 }),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
