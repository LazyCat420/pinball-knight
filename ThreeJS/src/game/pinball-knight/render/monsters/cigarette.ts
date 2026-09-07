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
      groundShadow(ctx, CX, GROUND + 1, 16);

      // Crushed cigarette butt flattened on the ground
      plateShaded(ctx, rectPts(CX - 10, GROUND - 6, 20, 6), R_FILTER);
      plateShaded(ctx, rectPts(CX - 6, GROUND - 9, 14, 4), R_PAPER);

      // Ash pile surrounding the butt
      ellShaded(ctx, CX + 6, GROUND - 3, 8, 4, R_ASH);
      ellShaded(ctx, CX - 7, GROUND - 3, 7, 3, R_ASH);

      // Fallen white gloves splayed on the ground
      ellShaded(ctx, CX - 14, GROUND - 2, 5, 3, R_GLOVES);
      ellShaded(ctx, CX + 14, GROUND - 2, 5, 3, R_GLOVES);

      // Dissipating wisps of smoke
      ellShaded(ctx, CX, GROUND - 12 - t * 8, 6, 4, R_SMOKE);
      ellShaded(ctx, CX + 5, GROUND - 18 - t * 10, 4, 3, R_SMOKE);
      return;
    }

    const bob = Math.sin(phase * Math.PI * 2) * 2;
    const stride = Math.sin(phase * Math.PI * 2) * 6;
    const lungeX = attacking ? (dir === "E" ? 8 : dir === "S" ? 0 : -6) : 0;
    const lungeY = attacking ? 3 : 0;

    groundShadow(ctx, CX + lungeX * 0.4, GROUND + 1, attacking ? 18 : 14);

    // Rubberhose legs & shoes
    const legL_X = CX - 5 + (attacking ? -2 : -stride);
    const legR_X = CX + 5 + (attacking ? 6 : stride);

    ctx.strokeStyle = "#111118";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";

    // Left leg curve
    ctx.beginPath();
    ctx.moveTo(CX - 4, GROUND - 12 + bob + lungeY);
    ctx.quadraticCurveTo(CX - 8, GROUND - 6 + bob, legL_X, GROUND - 2);
    ctx.stroke();

    // Right leg curve
    ctx.beginPath();
    ctx.moveTo(CX + 4, GROUND - 12 + bob + lungeY);
    ctx.quadraticCurveTo(CX + 8, GROUND - 6 + bob, legR_X, GROUND - 2);
    ctx.stroke();

    // Shoes
    ellShaded(ctx, legL_X - 1, GROUND - 1, 5, 3, R_LIMBS);
    ellShaded(ctx, legR_X + 1, GROUND - 1, 5, 3, R_LIMBS);

    // Main Cigarette Cylinder Body
    const bodyX = CX - 7 + lungeX;
    const bodyY = GROUND - 38 + bob + lungeY;
    const bodyW = 14;

    // Filter at base
    plateShaded(ctx, rectPts(bodyX, bodyY + 16, bodyW, 10), R_FILTER);
    // Gold band
    plateShaded(ctx, rectPts(bodyX, bodyY + 14, bodyW, 2), R_GOLD);
    // White paper column
    plateShaded(ctx, rectPts(bodyX, bodyY, bodyW, 14), R_PAPER);

    // Lit glowing cherry tip at top
    ellShaded(ctx, bodyX + bodyW / 2, bodyY, bodyW / 2, 3, R_EMBER);
    figGlow(ctx, bodyX + bodyW / 2, bodyY - 1, 4.0, 14, 13);

    // Wisps of smoke curling up from cherry
    const smokeY = bodyY - 6;
    ellShaded(ctx, bodyX + bodyW / 2 + Math.sin(phase * 3) * 3, smokeY, 4 + smokePuff, 3, R_SMOKE);
    ellShaded(ctx, bodyX + bodyW / 2 - Math.cos(phase * 3) * 4, smokeY - 6, 5 + smokePuff, 3.5, R_SMOKE);

    // Vintage 1950s Cartoon Face (pie-eyes & mischievous grin)
    if (dir === "S" || dir === "E") {
      const faceX = bodyX + (dir === "E" ? 8 : 7);
      const faceY = bodyY + 8;

      // Pie eyes
      ellShaded(ctx, faceX - 3, faceY - 2, 1.5, 2.5, R_LIMBS);
      ellShaded(ctx, faceX + 3, faceY - 2, 1.5, 2.5, R_LIMBS);

      // Vintage toothy cartoon smile
      ctx.beginPath();
      ctx.arc(faceX, faceY + 3, 4, 0.2, Math.PI - 0.2);
      ctx.strokeStyle = "#111118";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Rubberhose arms with white 4-fingered gloves
    const armL_X = bodyX - 7;
    const armR_X = bodyX + bodyW + 7;
    const armY = bodyY + 12;

    if (attacking) {
      // Jabbing thrust forward with white gloved hand holding a glowing ember
      ctx.beginPath();
      ctx.moveTo(bodyX + 2, armY);
      ctx.quadraticCurveTo(bodyX + bodyW + 6, armY - 6, bodyX + bodyW + 12, armY + 2);
      ctx.stroke();

      // Brandished burning tip & sparks
      ellShaded(ctx, bodyX + bodyW + 12, armY + 2, 4, 4, R_GLOVES);
      figGlow(ctx, bodyX + bodyW + 16, armY + 1, 4.0, 14, 13);
      figDetail(ctx, [[bodyX + bodyW + 16, armY - 1], [bodyX + bodyW + 19, armY - 2]], 1.5, 14);
      figDetail(ctx, [[bodyX + bodyW + 16, armY + 3], [bodyX + bodyW + 18, armY + 5]], 1.5, 2);
    } else {
      // Normal swinging arms
      ctx.beginPath();
      ctx.moveTo(bodyX, armY);
      ctx.quadraticCurveTo(armL_X, armY + 4, armL_X - 1, armY + 8);
      ctx.stroke();
      ellShaded(ctx, armL_X - 1, armY + 8, 4, 4, R_GLOVES);

      ctx.beginPath();
      ctx.moveTo(bodyX + bodyW, armY);
      ctx.quadraticCurveTo(armR_X, armY + 4, armR_X + 1, armY + 8);
      ctx.stroke();
      ellShaded(ctx, armR_X + 1, armY + 8, 4, 4, R_GLOVES);
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
