/**
 * THE JADE BUDDHA — an ancient carved emerald statue seated on a golden lotus,
 * wielding an ornate Chinese war fan thrown as a lethal returning boomerang.
 *
 * Procedural fallback cel-painter parameterised by (dir, phase, opts).
 * Used during headless tests or when imported art is resolving.
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
const R_JADE: Ramp = [8, 9, 10];       // Radiant emerald/jade stone
const R_JADE_DK: Ramp = [1, 7, 8];      // Deep jade shadow
const R_GOLD: Ramp = [15, 16, 17];      // Golden lotus pedestal & fan ribs
const R_GOLD_LT: Ramp = [16, 17, 18];   // Bright gold highlight
const R_FAN: Ramp = [7, 8, 10];         // Jade fan paper leaves
const R_ROBE: Ramp = [6, 7, 9];         // Silk drapery / jade robes
const R_TASSEL: Ramp = [11, 12, 13];    // Crimson silk tassel
const HALO_COLOR = 18;                  // Luminous jade/white radiance

interface PoseOpts {
  hoverBob?: number;   // floating offset
  fanThrust?: number;  // 0..1 arm extension
  fanThrown?: boolean; // fan left hand
  haloPulse?: number;  // aura expansion
  cracked?: boolean;   // death fracture state
  dead?: boolean;      // shattered into stone
}

function buddhaFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const {
      hoverBob = 0,
      fanThrust = 0,
      fanThrown = false,
      haloPulse = 1.0,
      cracked = false,
      dead = false,
    } = opts;

    if (dead) {
      // Shattered jade pebbles and empty golden lotus petals resting on ground
      groundShadow(ctx, CX, GROUND + 1, 26);
      // Lotus base broken
      plateShaded(
        ctx,
        [[CX - 24, GROUND - 2], [CX + 24, GROUND - 2], [CX + 16, GROUND + 3], [CX - 16, GROUND + 3]],
        R_GOLD,
      );
      // Jade fragments scattered
      ellShaded(ctx, CX - 12, GROUND - 3, 7, 5, R_JADE);
      ellShaded(ctx, CX + 10, GROUND - 4, 8, 6, R_JADE);
      ellShaded(ctx, CX - 2, GROUND - 2, 5, 4, R_JADE);
      ellShaded(ctx, CX + 20, GROUND - 1, 4, 3, R_JADE);
      return;
    }

    const bob = hoverBob + Math.sin(phase * Math.PI * 2) * 2.5;
    const baseY = GROUND - 14 - bob;
    const narrow = dir === "E" ? 0.9 : 1.0;

    // Meditative floating shadow
    groundShadow(ctx, CX, GROUND + 1, 22 * narrow);

    // ── HALO RADIANCE ──
    const haloY = baseY - 24;
    const haloR = 15 * haloPulse;
    figGlow(ctx, CX, haloY, haloR, HALO_COLOR, 10);

    // ── GOLDEN LOTUS THRONE PEDESTAL ──
    // Lower tier
    plateShaded(
      ctx,
      [
        [CX - 26 * narrow, baseY + 6],
        [CX + 26 * narrow, baseY + 6],
        [CX + 20 * narrow, baseY + 12],
        [CX - 20 * narrow, baseY + 12],
      ],
      R_GOLD,
    );
    // Upper blooming petals
    for (let p = -3; p <= 3; p++) {
      const px = CX + p * 7 * narrow;
      const py = baseY + 4;
      plateShaded(
        ctx,
        [
          [px - 5, py],
          [px, py - 6],
          [px + 5, py],
        ],
        R_GOLD_LT,
      );
    }

    // ── SEATED JADE BODY & CROSS-LEGGED KNEES ──
    // Wide cross-legged lotus posture base
    ellShaded(ctx, CX, baseY - 2, 22 * narrow, 9, R_JADE);
    // Robe folds over lap
    figDetail(ctx, [[CX - 16, baseY - 1], [CX + 16, baseY - 1]], 1.5, R_JADE_DK[1]);
    figDetail(ctx, [[CX - 12, baseY - 4], [CX + 12, baseY - 4]], 1.5, R_JADE_DK[1]);

    // Torso / chest
    ellShaded(ctx, CX, baseY - 14, 15 * narrow, 13, R_JADE);
    // Sash / drapery across chest
    plateShaded(
      ctx,
      [
        [CX - 12 * narrow, baseY - 22],
        [CX - 7 * narrow, baseY - 23],
        [CX + 12 * narrow, baseY - 8],
        [CX + 8 * narrow, baseY - 7],
      ],
      R_ROBE,
    );

    // ── HEAD & SERENE FACE ──
    const headY = baseY - 25;
    ellShaded(ctx, CX, headY, 10 * narrow, 11, R_JADE);
    // Ushnisha (topknot / wisdom crown)
    ellShaded(ctx, CX, headY - 11, 5 * narrow, 4, R_JADE);

    if (dir !== "N") {
      // Gentle closed meditative eyes
      figDetail(ctx, [[CX - 5 * narrow, headY - 2], [CX - 2 * narrow, headY - 1]], 1.4, R_JADE_DK[2]);
      figDetail(ctx, [[CX + 2 * narrow, headY - 1], [CX + 5 * narrow, headY - 2]], 1.4, R_JADE_DK[2]);
      // Small smile
      figDetail(ctx, [[CX - 2, headY + 3], [CX + 2, headY + 3]], 1.2, R_JADE_DK[2]);
      // Third eye bindu urna dot
      figDetail(ctx, [[CX, headY - 5], [CX, headY - 5]], 1.8, R_GOLD[1]);
    }

    // ── CHINESE WAR FAN (Weapon) ──
    if (!fanThrown) {
      ctx.save();
      const armX = CX + 12 * narrow + fanThrust * 10;
      const armY = baseY - 14 - fanThrust * 6;
      ctx.translate(armX, armY);
      ctx.rotate(fanThrust * 0.4 - 0.2);

      // Fan ribs and arc
      const fanR = 14;
      plateShaded(
        ctx,
        [
          [0, 0],
          [-fanR * 0.6, -fanR],
          [fanR * 0.6, -fanR],
        ],
        R_FAN,
      );
      // Gold bamboo frame ribs
      figDetail(ctx, [[0, 0], [-fanR * 0.6, -fanR]], 1.4, R_GOLD[1]);
      figDetail(ctx, [[0, 0], [0, -fanR * 1.1]], 1.4, R_GOLD[1]);
      figDetail(ctx, [[0, 0], [fanR * 0.6, -fanR]], 1.4, R_GOLD[1]);
      // Crimson tassel
      figDetail(ctx, [[0, 0], [2, 7]], 1.6, R_TASSEL[1]);

      ctx.restore();
    } else {
      // Wind gust ribbons where fan was thrown
      for (let i = 0; i < 3; i++) {
        const gx = CX + 14 + i * 8;
        const gy = baseY - 18 + i * 4;
        figDetail(ctx, [[gx, gy], [gx + 6, gy - 2]], 1.5, HALO_COLOR);
      }
    }

    // ── CRACKS ON DEATH / HURT ──
    if (cracked) {
      figDetail(ctx, [[CX - 6, headY], [CX + 3, headY + 8]], 1.8, R_GOLD_LT[1]);
      figDetail(ctx, [[CX + 3, headY + 8], [CX - 4, baseY - 6]], 1.8, R_GOLD_LT[1]);
      figDetail(ctx, [[CX - 4, baseY - 6], [CX + 8, baseY]], 1.8, R_GOLD_LT[1]);
      figGlow(ctx, CX, baseY - 14, 8, HALO_COLOR, 12);
    }
  };
}

export function makeBuddhaPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    // Idle: serene meditative floating hover
    idle: [
      buddhaFrame(dir, 0.0, { hoverBob: 0, haloPulse: 1.0 }),
      buddhaFrame(dir, 0.25, { hoverBob: 1.5, haloPulse: 1.15 }),
      buddhaFrame(dir, 0.5, { hoverBob: 3.0, haloPulse: 1.3 }),
      buddhaFrame(dir, 0.75, { hoverBob: 1.5, haloPulse: 1.15 }),
    ],
    // Walk: smooth gliding forward
    walk: [
      buddhaFrame(dir, 0.0, { hoverBob: 0.5 }),
      buddhaFrame(dir, 0.33, { hoverBob: 2.0 }),
      buddhaFrame(dir, 0.66, { hoverBob: 3.5 }),
      buddhaFrame(dir, 1.0, { hoverBob: 1.0 }),
    ],
    // Attack: 4-frame fan throw flourish
    // 0: charging fan
    // 1: wide sweep
    // 2: fan release
    // 3: follow-through with gust
    attack: [
      buddhaFrame(dir, 0.1, { fanThrust: 0.3, haloPulse: 1.2 }),
      buddhaFrame(dir, 0.3, { fanThrust: 0.8, haloPulse: 1.4 }),
      buddhaFrame(dir, 0.6, { fanThrust: 1.2, fanThrown: true, haloPulse: 1.5 }),
      buddhaFrame(dir, 0.8, { fanThrust: 0.5, fanThrown: true, haloPulse: 1.2 }),
    ],
    // Stumble
    stumble: [
      buddhaFrame(dir, 0.2, { hoverBob: -2, cracked: true }),
      buddhaFrame(dir, 0.6, { hoverBob: 0, cracked: true }),
    ],
    // Death: statue cracks and shatters
    death: [
      buddhaFrame(dir, 0.1, { hoverBob: 1, cracked: true }),
      buddhaFrame(dir, 0.4, { hoverBob: 0, cracked: true, haloPulse: 1.6 }),
      buddhaFrame(dir, 0.7, { hoverBob: -2, cracked: true, haloPulse: 2.0 }),
      buddhaFrame(dir, 1.0, { dead: true }),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
