/**
 * MEDUSA — Gorgon Medusa Monster ("The Petrifier").
 *
 * Procedural fallback cel-painter for Gorgon Medusa:
 * - Coiled emerald/forest green serpentine tail.
 * - Dark charcoal/bronze bustier and scaled waist.
 * - Pale serpentine face with glowing golden petrifying eyes.
 * - Writhing crown of viper snake hair tendrils with venomous heads.
 * - Gaze attack pose: reared up tall with blazing golden laser eye flares.
 * - Death pose: petrified granite statue cracking and shattering into rubble.
 */
import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  groundShadow,
  rrectShaded,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

// Palette ramps
const R_TAIL: Ramp = [4, 5, 6];          // Dark emerald scales
const R_TAIL_LT: Ramp = [5, 6, 7];       // Lighter emerald belly scales
const R_SKIN: Ramp = [13, 14, 15];       // Pale olive / fair skin
const R_DRESS: Ramp = [1, 2, 3];         // Charcoal dark bustier
const R_SNAKES: Ramp = [5, 6, 7];        // Viper snake hair
const R_EYES_GLOW: Ramp = [27, 28, 29];  // Glowing golden amber petrifying eyes
const R_STONE: Ramp = [21, 22, 23];      // Petrified grey granite stone
const R_STONE_DK: Ramp = [19, 20, 21];   // Dark stone cracks/rubble

interface PoseOpts {
  gazePhase?: number; // 0 (idle) .. 1 (full gaze beam)
  slitherOffset?: number;
  deathT?: number;
  dead?: boolean;
}

function medusaFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const {
      gazePhase = 0,
      slitherOffset = 0,
      deathT = 0,
      dead = false,
    } = opts;

    if (dead || deathT > 0) {
      // Petrified into cracked grey stone statue crumbling to rubble
      const t = Math.min(1, Math.max(0, deathT));
      groundShadow(ctx, CX, GROUND, 16);

      // Crumbled rubble base
      ellShaded(ctx, CX - 6, GROUND - 3, 9, 4, R_STONE_DK);
      ellShaded(ctx, CX + 6, GROUND - 3, 8, 4, R_STONE);
      ellShaded(ctx, CX, GROUND - 5, 10, 5, R_STONE);

      if (t < 0.7) {
        // Upper petrified torso cracking apart
        const crackY = GROUND - 14 - (1 - t) * 6;
        ellShaded(ctx, CX, crackY, 7, 9, R_STONE);
        ellShaded(ctx, CX, crackY - 9, 6, 6, R_STONE_DK);
      }
      return;
    }

    const slither = Math.sin(phase * Math.PI * 2) * 3 + slitherOffset;
    const rearUp = gazePhase > 0 ? -4 : 0;
    const bodyY = GROUND - 16 + rearUp;

    groundShadow(ctx, CX, GROUND, 18);

    // ── Coiled Serpentine Lower Body ──
    ellShaded(ctx, CX + slither * 0.5, GROUND - 4, 16, 6, R_TAIL);
    ellShaded(ctx, CX - slither * 0.4, GROUND - 8, 12, 5, R_TAIL_LT);

    // S-curve tail tip
    ellShaded(ctx, CX + 14 + slither, GROUND - 6, 6, 4, R_TAIL);

    // ── Torso & Charcoal Dress ──
    ellShaded(ctx, CX, bodyY + 4, 7, 8, R_DRESS);
    rrectShaded(ctx, CX - 5, bodyY, 10, 6, 2, R_DRESS);

    // ── Pale Serpent Head & Face ──
    ellShaded(ctx, CX, bodyY - 7, 6, 6, R_SKIN);

    // ── Snake Hair Tendrils ──
    const hairWiggle = Math.sin(phase * Math.PI * 4) * 2;
    ellShaded(ctx, CX - 6 + hairWiggle, bodyY - 12, 4, 4, R_SNAKES);
    ellShaded(ctx, CX + 6 - hairWiggle, bodyY - 12, 4, 4, R_SNAKES);
    ellShaded(ctx, CX - 3, bodyY - 14, 5, 4, R_SNAKES);
    ellShaded(ctx, CX + 3, bodyY - 14, 5, 4, R_SNAKES);
    ellShaded(ctx, CX - 9, bodyY - 8, 3, 3, R_SNAKES);
    ellShaded(ctx, CX + 9, bodyY - 8, 3, 3, R_SNAKES);

    // ── Glowing Petrifying Eyes ──
    if (gazePhase > 0) {
      // Intense eye flare beam
      ellShaded(ctx, CX - 3, bodyY - 8, 3, 3, R_EYES_GLOW);
      ellShaded(ctx, CX + 3, bodyY - 8, 3, 3, R_EYES_GLOW);
      // Forward laser beam indicator
      rrectShaded(ctx, CX - 10, bodyY - 7, 20, 2, 1, R_EYES_GLOW);
    } else {
      // Piercing amber slit eyes
      ellShaded(ctx, CX - 2, bodyY - 8, 2, 2, R_EYES_GLOW);
      ellShaded(ctx, CX + 2, bodyY - 8, 2, 2, R_EYES_GLOW);
    }
  };
}

export function makeMedusaPaints(): ActorPaints {
  const makeDirectionalClips = (dir: Dir) => ({
    idle: [
      medusaFrame(dir, 0.0),
      medusaFrame(dir, 0.25),
      medusaFrame(dir, 0.5),
      medusaFrame(dir, 0.75),
    ],
    walk: [
      medusaFrame(dir, 0.0, { slitherOffset: -2 }),
      medusaFrame(dir, 0.25, { slitherOffset: 0 }),
      medusaFrame(dir, 0.5, { slitherOffset: 2 }),
      medusaFrame(dir, 0.75, { slitherOffset: 0 }),
    ],
    attack: [
      medusaFrame(dir, 0.1, { gazePhase: 0.3 }),
      medusaFrame(dir, 0.3, { gazePhase: 0.7 }),
      medusaFrame(dir, 0.6, { gazePhase: 1.0 }),
      medusaFrame(dir, 0.9, { gazePhase: 0.8 }),
    ],
    death: [
      medusaFrame(dir, 0.0, { deathT: 0.1 }),
      medusaFrame(dir, 0.0, { deathT: 0.4 }),
      medusaFrame(dir, 0.0, { deathT: 0.8 }),
      medusaFrame(dir, 0.0, { deathT: 1.0, dead: true }),
    ],
  });

  return {
    S: makeDirectionalClips("S"),
    N: makeDirectionalClips("N"),
    E: makeDirectionalClips("E"),
  };
}
