/**
 * CHRISTMAS TREE MONSTER — a festive decorated evergreen that hops on its stump,
 * throws glass bauble ornaments at knights, and erupts into a roaring bonfire and
 * ash pile upon death.
 *
 * Procedural fallback cel-painter parameterised by (dir, phase, opts).
 */
import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  limbShaded,
  detail as figDetail,
  glow as figGlow,
  groundShadow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

// Palette Ramps
// Pine needle conifer foliage:
const R_PINE: Ramp = [27, 28, 29];
const R_PINE_DK: Ramp = [26, 27, 28];
const R_PINE_LGT: Ramp = [28, 29, 30];

// Wooden tree stump trunk:
const R_STUMP: Ramp = [23, 24, 25];
const R_STUMP_DK: Ramp = [22, 23, 24];

// Golden topper star & yellow lights:
const R_STAR: Ramp = [10, 11, 12];
const R_GOLD: Ramp = [11, 12, 13];

// Festive bauble ornaments:
const R_RED_ORN: Ramp = [14, 15, 16];
const R_BLUE_ORN: Ramp = [30, 31, 31];

// Death Fire & Embers:
const R_FIRE_CORE: Ramp = [10, 11, 12];
const R_FIRE_MID: Ramp = [14, 15, 16];
const R_ASH: Ramp = [22, 23, 24];

interface TreePoseOpts {
  hopY?: number;
  sway?: number;
  tossing?: boolean;
  tossT?: number; // 0..1
  deathT?: number; // 0..1
  dead?: boolean;
}

function christmasTreeFrame(dir: Dir, phase: number, opts: TreePoseOpts = {}): FramePaint {
  return (ctx) => {
    const { hopY = 0, sway = 0, tossing = false, tossT = 0, deathT = 0, dead = false } = opts;

    if (dead || deathT > 0) {
      // Cremation into roaring bonfire and charred ash pile
      const t = Math.min(1, Math.max(0, deathT));
      const collapseY = GROUND - 2;
      groundShadow(ctx, CX, GROUND + 2, 28 * (1 + t * 0.15));

      if (t < 0.8) {
        // Roaring flame envelope
        const flameH = (1 - t * 0.7) * 36;
        figGlow(ctx, CX, collapseY - flameH * 0.5, flameH * 0.6, R_FIRE_CORE[1]);
        ellShaded(ctx, CX, collapseY - flameH * 0.4, 22 * (1 - t * 0.4), flameH, R_FIRE_MID);
        ellShaded(ctx, CX, collapseY - flameH * 0.3, 14 * (1 - t * 0.4), flameH * 0.7, R_FIRE_CORE);
      }

      // Charred wooden stump & glowing embers at the base
      ellShaded(ctx, CX, collapseY - 4, 18, 8, R_ASH);
      ellShaded(ctx, CX - 6, collapseY - 3, 6, 4, R_FIRE_MID);
      ellShaded(ctx, CX + 5, collapseY - 5, 5, 3, R_FIRE_CORE);
      return;
    }

    const baseY = GROUND - 14 - hopY;
    const shadowR = Math.max(12, 24 - hopY * 0.5);
    groundShadow(ctx, CX, GROUND + 2, shadowR);

    ctx.save();
    ctx.translate(CX, baseY);

    const swayAng = Math.sin(sway) * 0.08;
    ctx.rotate(swayAng);

    // 1. Wooden Stump Base (hops with tree)
    ellShaded(ctx, 0, 10, 16, 12, R_STUMP);
    ellShaded(ctx, -2, 12, 10, 6, R_STUMP_DK);

    // 2. Conifer Foliage (3 Tiers: Bottom, Mid, Top)
    // Bottom Tier (widest)
    ellShaded(ctx, 0, 4, 38, 18, R_PINE);
    ellShaded(ctx, 0, 6, 32, 14, R_PINE_DK);
    ellShaded(ctx, 0, -1, 34, 10, R_PINE_LGT);

    // Mid Tier
    ellShaded(ctx, 0, -10, 28, 16, R_PINE);
    ellShaded(ctx, 0, -8, 24, 12, R_PINE_DK);
    ellShaded(ctx, 0, -14, 24, 8, R_PINE_LGT);

    // Top Tier (pointy apex)
    ellShaded(ctx, 0, -22, 18, 14, R_PINE);
    ellShaded(ctx, 0, -20, 14, 10, R_PINE_DK);

    // 3. Ornaments & Twinkling Baubles
    if (dir === "S" || dir === "E") {
      // Red baubles
      ellShaded(ctx, -10, 6, 6, 6, R_RED_ORN);
      ellShaded(ctx, 12, 5, 6, 6, R_RED_ORN);
      ellShaded(ctx, 2, -9, 5, 5, R_RED_ORN);

      // Blue baubles
      ellShaded(ctx, 8, -6, 5, 5, R_BLUE_ORN);
      ellShaded(ctx, -6, -8, 5, 5, R_BLUE_ORN);

      // Gold lights / tinsel
      figGlow(ctx, -4, 4, 3, R_GOLD[1]);
      figGlow(ctx, 6, 3, 3, R_GOLD[1]);
      figGlow(ctx, -2, -18, 3, R_GOLD[1]);
    } else {
      // North facing back
      ellShaded(ctx, -8, 5, 5, 5, R_RED_ORN);
      ellShaded(ctx, 9, -7, 5, 5, R_BLUE_ORN);
    }

    // 4. Attack Branch Pose (Ornament Toss)
    if (tossing) {
      const armX = dir === "E" ? 14 : 16;
      const reach = tossT < 0.5 ? tossT * 2 : (1 - tossT) * 2;
      limbShaded(ctx, [6, -4], [armX + reach * 8, -4 - reach * 4], 3, R_STUMP);
      if (tossT < 0.7) {
        // Held bauble ready to throw
        ellShaded(ctx, armX + reach * 8 + 4, -4 - reach * 4, 7, 7, R_RED_ORN);
        figGlow(ctx, armX + reach * 8 + 4, -4 - reach * 4, 6, R_GOLD[0]);
      }
    }

    // 5. Golden Topper Star
    const starY = -30;
    figGlow(ctx, 0, starY, 9, R_STAR[1]);
    ellShaded(ctx, 0, starY, 8, 8, R_STAR);
    ellShaded(ctx, 0, starY - 1, 4, 4, R_GOLD);

    ctx.restore();
  };
}

export function makeChristmasTreePaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [
      christmasTreeFrame(dir, 0, { sway: 0 }),
      christmasTreeFrame(dir, 1, { sway: Math.PI * 0.5 }),
      christmasTreeFrame(dir, 2, { sway: Math.PI }),
      christmasTreeFrame(dir, 3, { sway: Math.PI * 1.5 }),
    ],
    walk: [
      // 4-frame stump hop cycle
      christmasTreeFrame(dir, 0, { hopY: 0, sway: 0 }),
      christmasTreeFrame(dir, 1, { hopY: 8, sway: 0.2 }),
      christmasTreeFrame(dir, 2, { hopY: 12, sway: 0 }),
      christmasTreeFrame(dir, 3, { hopY: 4, sway: -0.2 }),
    ],
    attack: [
      // Ornament toss sequence
      christmasTreeFrame(dir, 0, { tossing: true, tossT: 0.1 }),
      christmasTreeFrame(dir, 1, { tossing: true, tossT: 0.4 }),
      christmasTreeFrame(dir, 2, { tossing: true, tossT: 0.8 }),
      christmasTreeFrame(dir, 3, { tossing: true, tossT: 1.0 }),
    ],
    death: [
      // Flame eruption and ash collapse
      christmasTreeFrame(dir, 0, { deathT: 0.15 }),
      christmasTreeFrame(dir, 1, { deathT: 0.45 }),
      christmasTreeFrame(dir, 2, { deathT: 0.75 }),
      christmasTreeFrame(dir, 3, { dead: true, deathT: 1.0 }),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}

