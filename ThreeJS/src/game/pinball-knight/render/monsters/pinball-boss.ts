/**
 * PINBALL BOSS — Tilt Titan.
 *
 * Procedural fallback cel-painter for Tilt Titan:
 * - Giant spherical chrome steel pinball head.
 * - Shaded metallic sphere with chrome glints and specular reflection.
 * - Glowing red visor eyes / mechanical scowl.
 * - Jagged wicked metallic grin with electrical sparks.
 * - Rolling spin animations for walk/charge.
 * - Dented, crumpled cracked steel sphere for death.
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
const R_STEEL: Ramp = [21, 22, 23];      // Chrome steel sphere
const R_STEEL_DK: Ramp = [19, 20, 21];   // Steel core shadow
const R_CHROME_HI: Ramp = [23, 24, 25];  // Bright chrome specular reflection
const R_EYE: Ramp = [8, 9, 10];          // Glowing red visor eyes
const R_EYE_DK: Ramp = [6, 7, 8];        // Red visor shadow
const R_MOUTH: Ramp = [1, 2, 3];         // Shadowed mouth interior
const R_TEETH: Ramp = [22, 23, 24];      // Sharp metallic jagged teeth
const R_SPARK: Ramp = [28, 29, 30];      // Electric cyan / yellow sparks

interface PoseOpts {
  rollAngle?: number;
  squashY?: number;
  eyesOpen?: boolean;
  teethBared?: boolean;
  sparkPhase?: number;
  deathT?: number;
  dead?: boolean;
}

function pinballBossFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const {
      rollAngle = 0,
      squashY = 1.0,
      eyesOpen = true,
      teethBared = true,
      sparkPhase = 0,
      deathT = 0,
      dead = false,
    } = opts;

    if (dead || deathT > 0) {
      const t = Math.min(1, Math.max(0, deathT));
      const cy = GROUND - 6 + t * 4;
      groundShadow(ctx, CX, GROUND, 28);

      // Crumpled, flattened cracked chrome sphere
      ellShaded(ctx, CX, cy + 4, 30 + t * 4, Math.max(2, 14 - t * 6), R_STEEL_DK);
      ellShaded(ctx, CX - 4, cy + 2, 22, 8, R_STEEL);
      ellShaded(ctx, CX + 6, cy + 3, 18, 6, R_STEEL_DK);

      // Shattered eye lenses
      ellShaded(ctx, CX - 10, cy + 1, 4, 2, R_EYE_DK);
      ellShaded(ctx, CX + 8, cy + 1, 3, 2, R_EYE_DK);

      // Fallen teeth / ball bearings
      ellShaded(ctx, CX - 18, GROUND - 2, 3, 3, R_CHROME_HI);
      ellShaded(ctx, CX + 16, GROUND - 2, 4, 3, R_CHROME_HI);
      ellShaded(ctx, CX + 22, GROUND - 1, 2, 2, R_CHROME_HI);
      return;
    }

    const rad = 26;
    const bodyY = GROUND - rad * squashY - 2;

    // Heavy ground shadow
    groundShadow(ctx, CX, GROUND, 26);

    ctx.save();
    ctx.translate(CX, bodyY);
    ctx.rotate(rollAngle);
    ctx.scale(1.0, squashY);

    // 1. Chrome steel sphere base
    ellShaded(ctx, 0, 0, rad, rad, R_STEEL);
    ellShaded(ctx, -2, 2, rad - 2, rad - 3, R_STEEL_DK);

    // 2. High-gloss chrome highlight curve
    ellShaded(ctx, -rad * 0.35, -rad * 0.35, rad * 0.45, rad * 0.3, R_CHROME_HI);

    // 3. Evil glowing visor eyes
    if (eyesOpen) {
      const eyeY = -rad * 0.15;
      const eyeSpacing = rad * 0.42;
      // Slanted menacing brow
      ellShaded(ctx, -eyeSpacing, eyeY, 6, 3.5, R_EYE);
      ellShaded(ctx, eyeSpacing, eyeY, 6, 3.5, R_EYE);
      // Glint in the eyes
      ellShaded(ctx, -eyeSpacing + 1, eyeY - 0.5, 2.5, 1.5, R_CHROME_HI);
      ellShaded(ctx, eyeSpacing - 1, eyeY - 0.5, 2.5, 1.5, R_CHROME_HI);
    }

    // 4. Wicked jagged steel grin
    if (teethBared) {
      const mouthY = rad * 0.28;
      ellShaded(ctx, 0, mouthY, rad * 0.62, 5, R_MOUTH);

      // Jagged teeth points
      for (let i = -3; i <= 3; i++) {
        const tx = i * (rad * 0.08);
        const ty = mouthY + (Math.abs(i) % 2 === 0 ? -1.5 : 1.5);
        ellShaded(ctx, tx, ty, 2, 2.5, R_TEETH);
      }
    }

    // 5. Electric crackle / sparks
    if (sparkPhase > 0) {
      const sAngle = sparkPhase * Math.PI * 2;
      const sx = Math.cos(sAngle) * (rad + 3);
      const sy = Math.sin(sAngle) * (rad + 3);
      ellShaded(ctx, sx, sy, 3, 3, R_SPARK);
      ellShaded(ctx, -sx * 0.7, -sy * 0.7, 2, 2, R_SPARK);
    }

    ctx.restore();
  };
}

export function makePinballBossPaints(): ActorPaints {
  const S_IDLE: FramePaint[] = [
    pinballBossFrame("S", 0, { squashY: 1.0, sparkPhase: 0.1 }),
    pinballBossFrame("S", 1, { squashY: 0.96, sparkPhase: 0.3 }),
    pinballBossFrame("S", 2, { squashY: 1.02, sparkPhase: 0.6 }),
    pinballBossFrame("S", 3, { squashY: 0.98, sparkPhase: 0.8 }),
  ];

  const S_WALK: FramePaint[] = [
    pinballBossFrame("S", 0, { rollAngle: 0, squashY: 0.95 }),
    pinballBossFrame("S", 1, { rollAngle: 0.4, squashY: 1.05, sparkPhase: 0.2 }),
    pinballBossFrame("S", 2, { rollAngle: 0.8, squashY: 0.95, sparkPhase: 0.5 }),
    pinballBossFrame("S", 3, { rollAngle: 1.2, squashY: 1.05, sparkPhase: 0.8 }),
  ];

  const S_ATTACK: FramePaint[] = [
    pinballBossFrame("S", 0, { rollAngle: 0, squashY: 0.9, sparkPhase: 0.2 }),
    pinballBossFrame("S", 1, { rollAngle: 1.5, squashY: 1.1, sparkPhase: 0.6 }),
    pinballBossFrame("S", 2, { rollAngle: 3.14, squashY: 0.88, sparkPhase: 0.9 }),
    pinballBossFrame("S", 3, { rollAngle: 4.7, squashY: 1.08, sparkPhase: 0.4 }),
  ];

  const S_DEATH: FramePaint[] = [
    pinballBossFrame("S", 0, { deathT: 0.2 }),
    pinballBossFrame("S", 1, { deathT: 0.5 }),
    pinballBossFrame("S", 2, { deathT: 0.8 }),
    pinballBossFrame("S", 3, { deathT: 1.0, dead: true }),
  ];

  return {
    S: { idle: S_IDLE, walk: S_WALK, attack: S_ATTACK, roll: S_ATTACK, ball: S_ATTACK, death: S_DEATH },
    N: { idle: S_IDLE, walk: S_WALK, attack: S_ATTACK, roll: S_ATTACK, ball: S_ATTACK, death: S_DEATH },
    E: { idle: S_IDLE, walk: S_WALK, attack: S_ATTACK, roll: S_ATTACK, ball: S_ATTACK, death: S_DEATH },
  };
}
