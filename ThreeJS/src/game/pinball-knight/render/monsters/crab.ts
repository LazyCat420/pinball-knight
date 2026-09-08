/**
 * CRAB — Dapper Knife-Arm Crab monster ("Sir Pinch-a-Lot").
 *
 * Procedural fallback cel-painter for Dapper Knife Crab:
 * - Ornate crimson-orange chitin carapace.
 * - Victorian tilted black top hat with silk band.
 * - Golden rimmed monocle over the right eye.
 * - Razor-sharp steel chef knife blades in place of claws.
 * - 6 articulated scuttling crab legs.
 * - Clean horizontal spans to stay well within the sprite noise / confetti budget.
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
const R_SHELL: Ramp = [8, 9, 10];        // Vibrant crimson-orange shell
const R_SHELL_DK: Ramp = [6, 7, 8];      // Deep shell shadow
const R_BELLY: Ramp = [13, 14, 15];      // Tan/fleshy underbelly
const R_HAT: Ramp = [1, 2, 3];           // Black top hat
const R_BAND: Ramp = [7, 8, 9];          // Silk hat band
const R_MONOCLE: Ramp = [27, 28, 29];    // Gold monocle
const R_BLADE: Ramp = [23, 24, 25];      // Gleaming steel knife blades
const R_BLADE_DK: Ramp = [21, 22, 23];   // Blade shadow/spine

interface PoseOpts {
  slashPhase?: number; // 0 (ready) .. 1 (slashed)
  scuttleOffset?: number;
  deathT?: number;
  dead?: boolean;
}

function crabFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const {
      slashPhase = 0,
      scuttleOffset = 0,
      deathT = 0,
      dead = false,
    } = opts;

    if (dead || deathT > 0) {
      // Cracked shell flat on stones, top hat and monocle fallen off
      const t = Math.min(1, Math.max(0, deathT));
      const cy = GROUND - 3 + t * 2;
      groundShadow(ctx, CX, GROUND, 18);

      // Cracked carapace pieces
      ellShaded(ctx, CX - 8, cy + 2, 10, 4, R_SHELL_DK);
      ellShaded(ctx, CX + 6, cy + 3, 11, 4, R_SHELL_DK);

      // Fallen top hat
      rrectShaded(ctx, CX + 12, GROUND - 6, 6, 5, 1, R_HAT);
      rrectShaded(ctx, CX + 10, GROUND - 2, 10, 2, 1, R_HAT);

      // Detached knife blades on the ground
      rrectShaded(ctx, CX - 14, GROUND - 2, 8, 2, 1, R_BLADE);
      rrectShaded(ctx, CX + 2, GROUND - 2, 7, 2, 1, R_BLADE);

      // Fallen monocle
      ellShaded(ctx, CX + 8, GROUND - 2, 2, 2, R_MONOCLE);
      return;
    }

    const baseY = GROUND - 11;
    const bodyX = CX + scuttleOffset;

    // Ground shadow
    groundShadow(ctx, bodyX, GROUND, 18);

    // 1. Scuttling crab legs (3 on each side)
    const legPhase = (phase % 2 === 0) ? 1 : -1;
    for (let i = -1; i <= 1; i++) {
      const legY = baseY + 6 + i * 2;
      const legSpread = 16 + Math.abs(i) * 3;
      // Left legs
      ellShaded(ctx, bodyX - legSpread, legY + i * legPhase, 4, 2, R_SHELL_DK);
      // Right legs
      ellShaded(ctx, bodyX + legSpread, legY - i * legPhase, 4, 2, R_SHELL_DK);
    }

    // 2. Main carapace (chitinous shell)
    ellShaded(ctx, bodyX, baseY + 4, 16, 10, R_SHELL);
    ellShaded(ctx, bodyX, baseY + 6, 12, 6, R_BELLY);

    // 3. Beady crab eyes on stalks
    ellShaded(ctx, bodyX - 4, baseY - 2, 2, 3, R_HAT);
    ellShaded(ctx, bodyX + 4, baseY - 2, 2, 3, R_HAT);

    // 4. Golden monocle over right eye
    ellShaded(ctx, bodyX + 4, baseY - 1, 3, 3, R_MONOCLE);
    ellShaded(ctx, bodyX + 4, baseY - 1, 2, 2, R_BLADE); // glass glint

    // 5. Aristocratic Top Hat
    // Brim
    rrectShaded(ctx, bodyX - 8, baseY - 5, 12, 2, 1, R_HAT);
    // Crown
    rrectShaded(ctx, bodyX - 6, baseY - 14, 8, 9, 1, R_HAT);
    // Silk band
    rrectShaded(ctx, bodyX - 6, baseY - 7, 8, 2, 1, R_BAND);

    // 6. Dual knife-arm blades
    if (slashPhase > 0) {
      // Slashing motion
      if (slashPhase < 0.5) {
        // Raised overhead windup
        rrectShaded(ctx, bodyX - 10, baseY - 12, 4, 12, 1, R_BLADE);
        rrectShaded(ctx, bodyX + 8, baseY - 12, 4, 12, 1, R_BLADE);
      } else {
        // Scissor cross-slash forward
        rrectShaded(ctx, bodyX - 12, baseY, 14, 4, 1, R_BLADE);
        rrectShaded(ctx, bodyX - 2, baseY, 14, 4, 1, R_BLADE);
        // Blade shine/spark
        ellShaded(ctx, bodyX, baseY + 2, 3, 3, R_BLADE);
      }
    } else {
      // Idle / walk: knife arms held ready at the sides
      // Left knife arm
      ellShaded(ctx, bodyX - 12, baseY + 2, 4, 3, R_SHELL);
      rrectShaded(ctx, bodyX - 16, baseY - 2, 4, 9, 1, R_BLADE);
      rrectShaded(ctx, bodyX - 17, baseY - 2, 1, 9, 1, R_BLADE_DK);

      // Right knife arm
      ellShaded(ctx, bodyX + 12, baseY + 2, 4, 3, R_SHELL);
      rrectShaded(ctx, bodyX + 13, baseY - 2, 4, 9, 1, R_BLADE);
      rrectShaded(ctx, bodyX + 16, baseY - 2, 1, 9, 1, R_BLADE_DK);
    }
  };
}

export function makeCrabPaints(): ActorPaints {
  const makeDirectionalClips = (dir: Dir) => ({
    idle: [
      crabFrame(dir, 0),
      crabFrame(dir, 1),
      crabFrame(dir, 2),
      crabFrame(dir, 3),
    ],
    walk: [
      crabFrame(dir, 0, { scuttleOffset: -2 }),
      crabFrame(dir, 1, { scuttleOffset: 0 }),
      crabFrame(dir, 2, { scuttleOffset: 2 }),
      crabFrame(dir, 3, { scuttleOffset: 0 }),
    ],
    attack: [
      crabFrame(dir, 0, { slashPhase: 0.2 }),
      crabFrame(dir, 1, { slashPhase: 0.4 }),
      crabFrame(dir, 2, { slashPhase: 0.8 }),
      crabFrame(dir, 3, { slashPhase: 1.0 }),
    ],
    death: [
      crabFrame(dir, 0, { deathT: 0.25 }),
      crabFrame(dir, 1, { deathT: 0.50 }),
      crabFrame(dir, 2, { deathT: 0.75 }),
      crabFrame(dir, 3, { deathT: 1.0, dead: true }),
    ],
  });

  return {
    S: makeDirectionalClips("S"),
    N: makeDirectionalClips("N"),
    E: makeDirectionalClips("E"),
  };
}
