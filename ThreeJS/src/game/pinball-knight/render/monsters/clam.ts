/**
 * OLD CLAM — Weathered geriatric bivalve monster with sunglasses and walrus mustache.
 *
 * Procedural fallback cel-painter for Old Clam:
 * - Scalloped clam shell halves (bottom and top).
 * - Grumpy wrinkled old face inside with black sunglasses and walrus mustache.
 * - During attack, pops wide open to reveal a giant glistening pearl.
 * - Clean horizontal spans to stay well within the sprite noise / confetti budget.
 */
import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  groundShadow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

// Palette ramps
const R_SHELL: Ramp = [20, 21, 22];      // Weathered scalloped stone shell
const R_SHELL_DK: Ramp = [18, 19, 20];   // Deep shadow in shell ridges
const R_MANTLE: Ramp = [19, 20, 21];     // Pearlescent interior mantle
const R_FACE: Ramp = [14, 15, 16];       // Wrinkled grandfather flesh
const R_MUSTACHE: Ramp = [22, 23, 24];   // Bushy white/gray walrus mustache
const R_GLASSES: Ramp = [1, 2, 3];       // Dark black sunglasses
const R_PEARL: Ramp = [23, 24, 25];      // Glowing lustrous pearl

interface PoseOpts {
  shellOpen?: number;  // 0 (shut) .. 1 (wide open)
  spitting?: boolean;
  pearlVisible?: boolean;
  walkBob?: number;
  deathT?: number;
  dead?: boolean;
}

function clamFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const {
      shellOpen = 0.2,
      spitting = false,
      pearlVisible = false,
      walkBob = 0,
      deathT = 0,
      dead = false,
    } = opts;

    if (dead || deathT > 0) {
      // Cracked empty shell halves collapsed flat on stone floor
      const t = Math.min(1, Math.max(0, deathT));
      const cy = GROUND - 3 + t * 2;
      groundShadow(ctx, CX, GROUND, 18);

      // Cracked lower shell
      ellShaded(ctx, CX - 6, cy + 2, 12, 4, R_SHELL_DK);
      ellShaded(ctx, CX + 6, cy + 3, 10, 4, R_SHELL_DK);

      // Broken sunglasses on the ground
      ellShaded(ctx, CX + 4, GROUND - 1, 4, 2, R_GLASSES);

      // Scattered pearls
      ellShaded(ctx, CX - 9, GROUND - 1, 2, 2, R_PEARL);
      ellShaded(ctx, CX + 12, GROUND - 2, 2, 2, R_PEARL);
      return;
    }

    const baseY = GROUND - 10 + walkBob;

    // Ground shadow
    groundShadow(ctx, CX, GROUND, 16);

    // 1. Lower shell half
    ellShaded(ctx, CX, baseY + 6, 16, 8, R_SHELL);
    ellShaded(ctx, CX, baseY + 5, 14, 6, R_MANTLE);

    // 2. Interior face / head rising based on shellOpen
    const openAmount = Math.max(0, Math.min(1, shellOpen));
    const faceY = baseY + 3 - openAmount * 7;

    // Wrinkled clam face
    ellShaded(ctx, CX, faceY, 11, 8, R_FACE);

    // Pearl (visible when open)
    if (pearlVisible || openAmount > 0.5) {
      const pearlY = spitting ? faceY - 2 : faceY + 4;
      const pearlX = spitting ? CX + 9 : CX;
      ellShaded(ctx, pearlX, pearlY, 4.5, 4.5, R_PEARL);
    }

    // Sunglasses
    ellShaded(ctx, CX - 4, faceY - 2, 4, 2.5, R_GLASSES);
    ellShaded(ctx, CX + 4, faceY - 2, 4, 2.5, R_GLASSES);
    // Sunglasses bridge
    ellShaded(ctx, CX, faceY - 2.5, 2, 1.5, R_GLASSES);

    // Bushy Walrus Mustache
    ellShaded(ctx, CX - 4.5, faceY + 2.5, 5, 3, R_MUSTACHE);
    ellShaded(ctx, CX + 4.5, faceY + 2.5, 5, 3, R_MUSTACHE);
    ellShaded(ctx, CX, faceY + 1.5, 3, 2, R_MUSTACHE);

    // 3. Upper shell half (hinged at back)
    const upperShellY = baseY - 2 - openAmount * 10;
    ellShaded(ctx, CX, upperShellY, 16, 7 + openAmount * 2, R_SHELL);
    // Upper shell ridge line
    ellShaded(ctx, CX, upperShellY - 2, 13, 3, R_SHELL_DK);
  };
}

function makeDirectionalClips(dir: Dir) {
  return {
    idle: [
      clamFrame(dir, 0, { shellOpen: 0.25 }),
      clamFrame(dir, 1, { shellOpen: 0.30 }),
      clamFrame(dir, 2, { shellOpen: 0.35 }),
      clamFrame(dir, 3, { shellOpen: 0.28 }),
    ],
    walk: [
      clamFrame(dir, 0, { shellOpen: 0.25, walkBob: -2 }),
      clamFrame(dir, 1, { shellOpen: 0.28, walkBob: 0 }),
      clamFrame(dir, 2, { shellOpen: 0.25, walkBob: -2 }),
      clamFrame(dir, 3, { shellOpen: 0.22, walkBob: 0 }),
    ],
    attack: [
      clamFrame(dir, 0, { shellOpen: 0.5, pearlVisible: true }),
      clamFrame(dir, 1, { shellOpen: 0.9, pearlVisible: true }),
      clamFrame(dir, 2, { shellOpen: 1.0, spitting: true, pearlVisible: true }),
      clamFrame(dir, 3, { shellOpen: 0.2 }),
    ],
    death: [
      clamFrame(dir, 0, { deathT: 0.25 }),
      clamFrame(dir, 1, { deathT: 0.50 }),
      clamFrame(dir, 2, { deathT: 0.75 }),
      clamFrame(dir, 3, { deathT: 1.0, dead: true }),
    ],
  };
}

export function makeClamPaints(): ActorPaints {
  return {
    S: makeDirectionalClips("S"),
    N: makeDirectionalClips("N"),
    E: makeDirectionalClips("E"),
  };
}
