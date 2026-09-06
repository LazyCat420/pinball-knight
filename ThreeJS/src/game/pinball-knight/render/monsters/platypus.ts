/**
 * IRON PLATYPUS — an armored aquatic predator with a tough duck bill ("peak"),
 * webbed clawed paws, and a massive segmented steel beaver-like tail.
 *
 * Procedural fallback cel-painter parameterised by (dir, phase, pose).
 * In combat, it executes a heavy TAIL SLAM: arching its rear tail high into the
 * air and crashing it down flat onto the stone floor to crack the ground and
 * radiate shockwave fissures.
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
const R_FUR: Ramp = [26, 27, 28];       // Dark brown pelt
const R_BELLY: Ramp = [24, 25, 25];     // Warm paler belly
const R_BILL: Ramp = [26, 27, 24];      // Leathery duck bill (peak)
const R_STEEL: Ramp = [19, 20, 22];     // Segmented iron/steel plates on tail
const R_STEEL_DK: Ramp = [1, 19, 20];   // Dark steel shadow
const R_BRASS: Ramp = [15, 16, 17];     // Brass rivets on metal tail
const R_PAW: Ramp = [23, 24, 25];       // Webbed clawed feet
const EYE_CORE = 18;
const EYE_HOT = 16;

interface PoseOpts {
  tailAngle?: number;  // radians: tail tilt/arch
  tailSlam?: boolean;  // true on impact frame: tail flat on floor with cracks & sparks
  slamT?: number;      // 0..1 progression
  dazed?: number;      // dizzy shock on hurt/death
  dead?: boolean;      // flat defeat collapse
}

function platypusFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { tailAngle = 0, tailSlam = false, slamT = 0, dazed = 0, dead = false } = opts;

    if (dead) {
      // Flat collapse: body low on ground, steel tail resting limp, dizzy stars
      groundShadow(ctx, CX, GROUND + 1, 24);
      // Limp flat steel tail
      plateShaded(
        ctx,
        [
          [CX - 32, GROUND - 3],
          [CX - 12, GROUND - 8],
          [CX - 10, GROUND - 1],
          [CX - 30, GROUND + 2],
        ],
        R_STEEL,
      );
      // Flat body
      ellShaded(ctx, CX + 4, GROUND - 5, 20, 9, R_FUR);
      ellShaded(ctx, CX + 6, GROUND - 3, 14, 5, R_BELLY);
      // Flat head & duck bill
      ellShaded(ctx, CX + 20, GROUND - 6, 10, 7, R_FUR);
      ellShaded(ctx, CX + 28, GROUND - 4, 11, 4.5, R_BILL);
      // X eyes
      figDetail(ctx, [[CX + 18, GROUND - 9], [CX + 22, GROUND - 5]], 1.8, 1);
      figDetail(ctx, [[CX + 22, GROUND - 9], [CX + 18, GROUND - 5]], 1.8, 1);
      return;
    }

    const bob = Math.abs(Math.sin(phase * Math.PI)) * 2;
    const bodyY = GROUND - 16 - bob;
    const narrow = dir === "E" ? 0.9 : 1.0;

    // Contact shadow
    groundShadow(ctx, CX, GROUND + 1, 20 * narrow);

    // ── IMPACT GROUND CRACKS & SPARKS (Attack impact frame) ──
    if (tailSlam) {
      // Radiating floor fracture lines under slammed tail
      const impactX = dir === "E" ? CX - 14 : CX - 18;
      const impactY = GROUND;
      for (const [dx, dy] of [
        [-16, -4], [-12, 3], [14, 2], [10, -5], [-20, 1], [18, -3],
      ] as [number, number][]) {
        figDetail(ctx, [[impactX, impactY], [impactX + dx, impactY + dy]], 1.8, 1);
      }
      // Explosive impact sparks / stone dust
      for (let i = 0; i < 5; i++) {
        const sx = impactX + (Math.random() - 0.5) * 24;
        const sy = impactY - 4 - Math.random() * 14;
        figGlow(ctx, sx, sy, 2.5, 17, 16);
      }
    }

    // ── SEGMENTED METAL TAIL ──
    // Pivots at rear base of body (left side in S/E facing, central in N)
    ctx.save();
    const tailPivotX = dir === "N" ? CX : CX - 14 * narrow;
    const tailPivotY = bodyY + 3;
    ctx.translate(tailPivotX, tailPivotY);
    ctx.rotate(tailAngle);

    // Segmented iron paddle: 3 steel plates with brass rivets
    if (tailSlam) {
      // Crushed flat into ground
      plateShaded(
        ctx,
        [[-28, 0], [4, -4], [4, 4], [-28, 6]],
        R_STEEL,
      );
      // Rivets
      figDetail(ctx, [[-20, 2], [-10, 1], [-2, 0]], 2.2, R_BRASS[1]);
    } else {
      // Arched paddle tail
      const tailLen = 28;
      const tailW = 11;
      plateShaded(
        ctx,
        [
          [-tailLen, -tailW * 0.7],
          [-tailLen * 0.5, -tailW],
          [2, -tailW * 0.5],
          [2, tailW * 0.5],
          [-tailLen * 0.5, tailW],
          [-tailLen, tailW * 0.7],
        ],
        R_STEEL,
      );
      // Steel center ridge & band lines
      figDetail(ctx, [[-tailLen * 0.8, 0], [0, 0]], 1.5, R_STEEL_DK[1]);
      figDetail(ctx, [[-tailLen * 0.45, -tailW * 0.8], [-tailLen * 0.45, tailW * 0.8]], 1.4, R_STEEL_DK[1]);
      // Brass rivets
      for (const rx of [-tailLen * 0.75, -tailLen * 0.5, -tailLen * 0.25]) {
        for (const ry of [-tailW * 0.45, tailW * 0.45]) {
          figDetail(ctx, [[rx, ry], [rx + 1, ry]], 2.0, R_BRASS[1]);
        }
      }
    }
    ctx.restore();

    // ── HIND WEBBED FEET ──
    const footBob = Math.sin(phase * Math.PI) * 3;
    ellShaded(ctx, CX - 10 * narrow, GROUND - 4 + footBob, 6, 4, R_PAW);
    ellShaded(ctx, CX + 8 * narrow, GROUND - 4 - footBob, 6, 4, R_PAW);

    // ── MAIN BODY (Muscular brown barrel) ──
    ellShaded(ctx, CX, bodyY, 18 * narrow, 13, R_FUR);
    if (dir !== "N") {
      // Pale warm belly
      ellShaded(ctx, CX + (dir === "E" ? 4 : 0), bodyY + 3, 11 * narrow, 7, R_BELLY);
    }

    // ── FORE WEBBED CLAW PAWS ──
    ellShaded(ctx, CX + (dir === "E" ? 14 : 12) * narrow, GROUND - 4, 6, 4, R_PAW);

    // ── HEAD & DUCK BILL ("PEAK") ──
    const headX = CX + (dir === "E" ? 12 : dir === "N" ? 0 : 8) * narrow;
    const headY = bodyY - 5;
    ellShaded(ctx, headX, headY, 11 * narrow, 9, R_FUR);

    if (dir !== "N") {
      // Broad duck bill ("peak") jutting forward
      const billX = headX + (dir === "E" ? 11 : 6) * narrow;
      const billY = headY + 3;
      ellShaded(ctx, billX, billY, 10 * narrow, 4.5, R_BILL);
      // Bill nostril ridges / seam
      figDetail(ctx, [[billX - 3, billY - 1], [billX + 4, billY - 1]], 1.2, 1);

      // Eye with glow
      const eyeX = headX + (dir === "E" ? 3 : 2) * narrow;
      const eyeY = headY - 2;
      if (dazed > 0.3) {
        // Dizzy eye
        ellShaded(ctx, eyeX, eyeY, 3, 3, [20, 21, 22] as Ramp);
        figDetail(ctx, [[eyeX - 1.5, eyeY], [eyeX + 1.5, eyeY]], 1.5, 1);
      } else {
        ellShaded(ctx, eyeX, eyeY, 3.2, 2.4, [0, 0, 1] as Ramp);
        figGlow(ctx, eyeX, eyeY, 1.8, EYE_CORE, EYE_HOT);
      }
    }

    // ── DAZED CIRCLING STARS ──
    if (dazed > 0.3) {
      for (let i = 0; i < 3; i++) {
        const a = phase * 3 + (i / 3) * Math.PI * 2;
        const sx = headX + Math.cos(a) * 14;
        const sy = headY - 10 + Math.sin(a) * 5;
        figDetail(ctx, [[sx - 2.5, sy], [sx + 2.5, sy]], 1.5, 17);
        figDetail(ctx, [[sx, sy - 2.5], [sx, sy + 2.5]], 1.5, 17);
      }
    }
  };
}

export function makePlatypusPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    // Idle: low resting posture, metal tail resting behind
    idle: [
      platypusFrame(dir, 0, { tailAngle: 0.1 }),
      platypusFrame(dir, 0.5, { tailAngle: 0.18 }),
      platypusFrame(dir, 1.0, { tailAngle: 0.12 }),
      platypusFrame(dir, 0.5, { tailAngle: 0.05 }),
    ],
    // Walk: 4-beat heavy quadruped waddle
    walk: [
      platypusFrame(dir, 0.2, { tailAngle: 0.2 }),
      platypusFrame(dir, 0.7, { tailAngle: 0.05 }),
      platypusFrame(dir, 1.2, { tailAngle: -0.1 }),
      platypusFrame(dir, 1.7, { tailAngle: 0.08 }),
    ],
    // Attack: 4-beat heavy metal tail slam!
    // 0: low coil, raising tail
    // 1: high arch / scorpion tail raise straight up
    // 2: downward tail whip with motion blur
    // 3: impact! tail slams ground, creating cracks & sparks
    attack: [
      platypusFrame(dir, 0.1, { tailAngle: -0.4 }),
      platypusFrame(dir, 0.2, { tailAngle: -1.35 }),
      platypusFrame(dir, 0.3, { tailAngle: -0.6 }),
      platypusFrame(dir, 0.4, { tailAngle: 0.25, tailSlam: true, slamT: 1 }),
    ],
    // Stumble: staggered from impact
    stumble: [
      platypusFrame(dir, 0.2, { tailAngle: -0.5, dazed: 0.6 }),
      platypusFrame(dir, 0.6, { tailAngle: 0.2, dazed: 0.4 }),
    ],
    // Death: collapse & defeat
    death: [
      platypusFrame(dir, 0.1, { tailAngle: -0.7, dazed: 0.8 }),
      platypusFrame(dir, 0.4, { tailAngle: -0.2, dazed: 1.0 }),
      platypusFrame(dir, 0.7, { tailAngle: 0.1, dazed: 1.0 }),
      platypusFrame(dir, 0, { dead: true }),
    ],
  });

  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
