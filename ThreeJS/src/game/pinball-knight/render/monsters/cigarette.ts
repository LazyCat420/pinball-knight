/**
 * 1950s CARTOON WALKING CIGARETTE — vintage rubberhose style animated
 * cigarette character with white paper cylinder, tobacco filter base,
 * pie-eyes, white gloves, tap shoes, and glowing cherry ember tip.
 *
 * Procedural fallback cel-painter parameterised by (dir, phase, pose).
 * - Idle: Bounces with classic rubberhose rhythm, smoke curling from lit tip.
 * - Walk: Struts forward with swinging white-gloved arms and bendy legs.
 * - Attack: Brandishes burning cherry ember in a lunging jab with sparks.
 * - Death: Gets stubbed out flat into an ash pile on the ground with smoke.
 */
import {
  type Ramp,
  type Pt,
  CX,
  GROUND,
  ellShaded,
  plateShaded,
  limbShaded,
  detail as figDetail,
  glow as figGlow,
  groundShadow,
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

// Palette ramps
const R_PAPER: Ramp = [20, 21, 22];    // Clean white cigarette paper
const R_FILTER: Ramp = [26, 27, 28];   // Tobacco-brown / cork filter
const R_GOLD: Ramp = [13, 14, 15];     // Gold brand foil ring
const R_EMBER: Ramp = [2, 13, 14];     // Glowing red-hot lit cherry
const R_ASH: Ramp = [1, 19, 20];       // Dark grey ash flecks
const R_SMOKE: Ramp = [20, 21, 22];    // White / grey smoke curls
const R_LIMBS: Ramp = [1, 19, 20];     // Rubberhose black limbs & shoes
const R_GLOVES: Ramp = [20, 21, 22];   // 1950s 4-finger white cartoon gloves

interface PoseOpts {
  attacking?: boolean;
  smokePuff?: number;
  stubbedT?: number;
  dead?: boolean;
}

function cigaretteFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { attacking = false, smokePuff = 0, stubbedT = 0, dead = false } = opts;

    if (dead) {
      // Stubbed out flat into a crushed butt and ash pile on the floor
      const t = stubbedT || 0.6;
      groundShadow(ctx, CX, GROUND + 1, 18);

      // Crushed cigarette butt flattened on the ground
      plateShaded(ctx, rectPts(CX - 12, GROUND - 7, 24, 7), R_FILTER);
      plateShaded(ctx, rectPts(CX - 8, GROUND - 10, 16, 4), R_PAPER);

      // Ash pile surrounding the butt
      ellShaded(ctx, CX + 7, GROUND - 3, 9, 4, R_ASH);
      ellShaded(ctx, CX - 8, GROUND - 3, 8, 4, R_ASH);

      // Fallen white gloves splayed on the ground
      ellShaded(ctx, CX - 15, GROUND - 2, 6, 3, R_GLOVES);
      ellShaded(ctx, CX + 15, GROUND - 2, 6, 3, R_GLOVES);

      // Dissipating wisps of smoke
      ellShaded(ctx, CX, GROUND - 12 - t * 8, 7, 4, R_SMOKE);
      ellShaded(ctx, CX + 6, GROUND - 18 - t * 10, 5, 3, R_SMOKE);
      return;
    }

    const bob = Math.sin(phase * Math.PI * 2) * 2;
    const stride = Math.sin(phase * Math.PI * 2) * 6;
    const lungeX = attacking ? (dir === "E" ? 8 : dir === "S" ? 0 : -6) : 0;
    const lungeY = attacking ? 3 : 0;

    groundShadow(ctx, CX + lungeX * 0.4, GROUND + 1, attacking ? 20 : 16);

    // Main Cigarette Cylinder Body
    const bodyW = 18;
    const bodyX = CX - 9 + lungeX;
    const bodyY = GROUND - 38 + bob + lungeY;

    // Rubberhose legs & shoes
    const legL_X = CX - 6 + (attacking ? -2 : -stride);
    const legR_X = CX + 6 + (attacking ? 6 : stride);

    limbShaded(ctx, [CX - 4, bodyY + 24], [legL_X, GROUND - 4], 4, R_LIMBS);
    limbShaded(ctx, [CX + 4, bodyY + 24], [legR_X, GROUND - 4], 4, R_LIMBS);

    // Shoes
    ellShaded(ctx, legL_X - 1, GROUND - 2, 6, 3.5, R_LIMBS);
    ellShaded(ctx, legR_X + 1, GROUND - 2, 6, 3.5, R_LIMBS);

    // Filter at base
    plateShaded(ctx, rectPts(bodyX, bodyY + 16, bodyW, 10), R_FILTER);
    // Gold band
    plateShaded(ctx, rectPts(bodyX, bodyY + 13, bodyW, 3), R_GOLD);
    // White paper column
    plateShaded(ctx, rectPts(bodyX, bodyY, bodyW, 13), R_PAPER);

    // Lit glowing cherry tip at top
    ellShaded(ctx, bodyX + bodyW / 2, bodyY, bodyW / 2, 3.5, R_EMBER);

    // Smoke curling up from cherry
    const smokeY = bodyY - 6;
    ellShaded(ctx, bodyX + bodyW / 2 + Math.sin(phase * 3) * 2, smokeY, 5 + smokePuff, 3.5, R_SMOKE);

    // Vintage 1950s Cartoon Face (pie-eyes & mischievous grin)
    if (dir === "S" || dir === "E") {
      const faceX = bodyX + (dir === "E" ? 11 : 9);
      const faceY = bodyY + 7;

      // Pie eyes
      ellShaded(ctx, faceX - 3, faceY - 2, 2, 2.5, R_LIMBS);
      ellShaded(ctx, faceX + 3, faceY - 2, 2, 2.5, R_LIMBS);

      // Vintage grin
      figDetail(ctx, [[faceX - 4, faceY + 3], [faceX + 4, faceY + 3]], 2, 1);
    }

    // Rubberhose arms with white 4-fingered gloves
    const armY = bodyY + 11;
    const armL_X = bodyX - 7;
    const armR_X = bodyX + bodyW + 7;

    if (attacking) {
      // Jabbing thrust forward with white gloved hand holding glowing ember
      limbShaded(ctx, [bodyX + 2, armY], [bodyX + bodyW + 10, armY + 2], 3.5, R_LIMBS);
      ellShaded(ctx, bodyX + bodyW + 11, armY + 2, 5, 4.5, R_GLOVES);
      figGlow(ctx, bodyX + bodyW + 16, armY + 1, 4.0, 14, 13);
      figDetail(ctx, [[bodyX + bodyW + 16, armY - 1], [bodyX + bodyW + 19, armY - 2]], 2, 14);
      figDetail(ctx, [[bodyX + bodyW + 16, armY + 3], [bodyX + bodyW + 18, armY + 5]], 2, 2);
    } else {
      // Normal swinging arms
      limbShaded(ctx, [bodyX, armY], [armL_X, armY + 6], 3.5, R_LIMBS);
      ellShaded(ctx, armL_X, armY + 6, 5, 4, R_GLOVES);

      limbShaded(ctx, [bodyX + bodyW, armY], [armR_X, armY + 6], 3.5, R_LIMBS);
      ellShaded(ctx, armR_X, armY + 6, 5, 4, R_GLOVES);
    }
  };
}

export function makeCigarettePaints(): ActorPaints {
  const dirs: Dir[] = ["S", "N", "E"];
  const out: Partial<Record<Dir, any>> = {};

  for (const dir of dirs) {
    out[dir] = {
      idle: [
        cigaretteFrame(dir, 0.0),
        cigaretteFrame(dir, 0.25),
        cigaretteFrame(dir, 0.5),
        cigaretteFrame(dir, 0.75),
      ],
      walk: [
        cigaretteFrame(dir, 0.1),
        cigaretteFrame(dir, 0.35),
        cigaretteFrame(dir, 0.6),
        cigaretteFrame(dir, 0.85),
      ],
      run: [
        cigaretteFrame(dir, 0.15),
        cigaretteFrame(dir, 0.4),
        cigaretteFrame(dir, 0.65),
        cigaretteFrame(dir, 0.9),
      ],
      attack: [
        cigaretteFrame(dir, 0.2, { attacking: true }),
        cigaretteFrame(dir, 0.5, { attacking: true }),
        cigaretteFrame(dir, 0.8, { attacking: true }),
      ],
      stumble: [
        cigaretteFrame(dir, 0.4, { smokePuff: 2 }),
      ],
      death: [
        cigaretteFrame(dir, 0.2, { dead: true, stubbedT: 0.2 }),
        cigaretteFrame(dir, 0.5, { dead: true, stubbedT: 0.5 }),
        cigaretteFrame(dir, 0.8, { dead: true, stubbedT: 0.8 }),
        cigaretteFrame(dir, 1.0, { dead: true, stubbedT: 1.0 }),
      ],
    };
  }

  return out as ActorPaints;
}
