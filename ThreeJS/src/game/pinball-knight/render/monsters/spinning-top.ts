/**
 * SPINNING TOP — Whirligig Top.
 *
 * Procedural fallback cel-painter for Whirligig Top:
 * - Conical brass/steel spinning top with heavy flywheel rim.
 * - Sharp ground contact spindle/pin emitting friction sparks.
 * - Upper crown peg with concentric spinning rings.
 * - Glowing mechanical visor eyes / rotating gear patterns.
 * - Fast spinning rotation, tilts, and high-speed slam poses.
 * - Toppled, cracked spindle and scattered gears for death.
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
const R_STEEL: Ramp = [19, 20, 21];       // Steel dark, mid, light
const R_STEEL_HI: Ramp = [20, 21, 22];    // Specular steel
const R_BRASS: Ramp = [14, 15, 16];       // Warm brass / bronze
const R_BRASS_HI: Ramp = [15, 16, 17];    // Brass highlight
const R_EYE: Ramp = [10, 12, 13];         // Crimson eye sensor
const R_SPARK: Ramp = [16, 17, 18];       // Bright sparks
const R_VOID: Ramp = [0, 1, 2];           // Shadow / recessed seam

interface PoseOpts {
  spinAngle?: number;
  tiltAngle?: number;
  squashY?: number;
  sparkPhase?: number;
  deathT?: number;
  dead?: boolean;
}

function spinningTopFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const {
      spinAngle = 0,
      tiltAngle = 0,
      squashY = 1.0,
      sparkPhase = 0,
      deathT = 0,
      dead = false,
    } = opts;

    if (dead || deathT > 0) {
      const t = Math.min(1, Math.max(0, deathT));
      const cy = GROUND - 6 + t * 3;
      groundShadow(ctx, CX, GROUND, 24);

      // Toppled, fractured top body lying on its side
      ellShaded(ctx, CX + t * 4, cy + 2, 22, Math.max(3, 10 - t * 4), R_BRASS);
      ellShaded(ctx, CX - 6, cy + 1, 14, 7, R_STEEL);

      // Detached bent spindle pin
      ellShaded(ctx, CX - 18, GROUND - 2, 6, 2, R_STEEL_HI);

      // Scattered brass gear fragments
      ellShaded(ctx, CX + 16, GROUND - 2, 4, 3, R_BRASS_HI);
      ellShaded(ctx, CX + 24, GROUND - 1, 2, 2, R_SPARK);
      ellShaded(ctx, CX - 12, GROUND - 3, 3, 2, R_STEEL);
      return;
    }

    const radX = 22;
    const bodyHeight = 28;
    const pivotY = GROUND - 4;

    // Contact ground shadow
    groundShadow(ctx, CX, GROUND, Math.max(12, Math.round(radX * 0.9)));

    ctx.save();
    ctx.translate(CX, pivotY);
    ctx.rotate(tiltAngle);
    ctx.scale(1.0, squashY);

    // 1. Spindle Pin (bottom ground contact point)
    ellShaded(ctx, 0, 1, 3.5, 4, R_STEEL_HI);
    ellShaded(ctx, 0, -3, 5, 5, R_STEEL);

    // 2. Conical Lower Body (tapering from rim down to spindle)
    const coneSteps = 3;
    for (let i = 0; i < coneSteps; i++) {
      const stepY = -6 - i * 6;
      const stepW = 7 + i * 5;
      const ramp = i % 2 === 0 ? R_BRASS : R_STEEL;
      ellShaded(ctx, 0, stepY, stepW, 4, ramp);
    }

    // 3. Heavy Flywheel Rim (thick rotating outer perimeter)
    const rimY = -bodyHeight + 4;
    ellShaded(ctx, 0, rimY + 2, radX + 1, 7, R_VOID);
    ellShaded(ctx, 0, rimY, radX, 6.5, R_BRASS);

    // Rotating segments along the rim
    const segCount = 4;
    for (let s = 0; s < segCount; s++) {
      const segAngle = spinAngle + (s * Math.PI * 2) / segCount;
      const segX = Math.cos(segAngle) * (radX - 4);
      const segY = rimY + Math.sin(segAngle) * 2;
      const isHi = (s % 2 === 0);
      ellShaded(ctx, segX, segY, 3.5, 3, isHi ? R_STEEL_HI : R_BRASS_HI);
    }

    // 4. Glowing Visor Eye / Sensor
    const eyePhase = Math.sin(spinAngle);
    const eyeX = eyePhase * (radX * 0.45);
    const eyeY = rimY - 1;
    ellShaded(ctx, eyeX, eyeY, 4, 2.5, R_EYE);
    ellShaded(ctx, eyeX + 0.5, eyeY - 0.5, 1.5, 1, R_SPARK);

    // 5. Upper Dome & Crown Peg
    const domeY = rimY - 5;
    ellShaded(ctx, 0, domeY, 12, 5, R_STEEL);
    ellShaded(ctx, 0, domeY - 4, 5, 4, R_BRASS_HI);
    ellShaded(ctx, 0, domeY - 8, 3, 4, R_STEEL_HI);

    // 6. Friction & Whirling Sparks
    if (sparkPhase > 0) {
      const p1 = (sparkPhase * 6.28) % 6.28;
      const sx1 = Math.cos(p1) * 14;
      const sy1 = 2 - Math.abs(Math.sin(p1)) * 4;
      ellShaded(ctx, sx1, sy1, 2.5, 2.5, R_SPARK);

      const p2 = p1 + Math.PI;
      const sx2 = Math.cos(p2) * (radX + 2);
      const sy2 = rimY + Math.sin(p2) * 3;
      ellShaded(ctx, sx2, sy2, 2, 2, R_SPARK);
    }

    ctx.restore();
  };
}

export function makeSpinningTopPaints(): ActorPaints {
  const S_IDLE: FramePaint[] = [
    spinningTopFrame("S", 0, { spinAngle: 0, tiltAngle: 0.05, squashY: 1.0 }),
    spinningTopFrame("S", 1, { spinAngle: 1.57, tiltAngle: -0.05, squashY: 0.98, sparkPhase: 0.2 }),
    spinningTopFrame("S", 2, { spinAngle: 3.14, tiltAngle: 0.04, squashY: 1.01 }),
    spinningTopFrame("S", 3, { spinAngle: 4.71, tiltAngle: -0.04, squashY: 0.99, sparkPhase: 0.7 }),
  ];

  const S_WALK: FramePaint[] = [
    spinningTopFrame("S", 0, { spinAngle: 0, tiltAngle: 0.12, squashY: 0.97, sparkPhase: 0.3 }),
    spinningTopFrame("S", 1, { spinAngle: 1.6, tiltAngle: 0.18, squashY: 1.02, sparkPhase: 0.6 }),
    spinningTopFrame("S", 2, { spinAngle: 3.2, tiltAngle: -0.12, squashY: 0.97, sparkPhase: 0.8 }),
    spinningTopFrame("S", 3, { spinAngle: 4.8, tiltAngle: -0.18, squashY: 1.02, sparkPhase: 0.4 }),
  ];

  const S_ATTACK: FramePaint[] = [
    spinningTopFrame("S", 0, { spinAngle: 0, tiltAngle: 0.28, squashY: 0.92, sparkPhase: 0.4 }),
    spinningTopFrame("S", 1, { spinAngle: 2.2, tiltAngle: 0.38, squashY: 1.08, sparkPhase: 0.9 }),
    spinningTopFrame("S", 2, { spinAngle: 4.4, tiltAngle: 0.32, squashY: 0.94, sparkPhase: 0.5 }),
    spinningTopFrame("S", 3, { spinAngle: 6.6, tiltAngle: 0.42, squashY: 1.06, sparkPhase: 1.0 }),
  ];

  const S_DEATH: FramePaint[] = [
    spinningTopFrame("S", 0, { deathT: 0.2, tiltAngle: 0.5 }),
    spinningTopFrame("S", 1, { deathT: 0.5, tiltAngle: 1.1 }),
    spinningTopFrame("S", 2, { deathT: 0.8, tiltAngle: 1.4 }),
    spinningTopFrame("S", 3, { deathT: 1.0, dead: true }),
  ];

  return {
    S: { idle: S_IDLE, walk: S_WALK, attack: S_ATTACK, death: S_DEATH },
    N: { idle: S_IDLE, walk: S_WALK, attack: S_ATTACK, death: S_DEATH },
    E: { idle: S_IDLE, walk: S_WALK, attack: S_ATTACK, death: S_DEATH },
  };
}
