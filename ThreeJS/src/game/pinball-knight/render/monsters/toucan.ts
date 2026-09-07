/**
 * TROPICAL TOUCAN — aerial striker with a massive multi-tone rainbow banana beak,
 * sleek jet-black plumage, white chest bib, cyan eye markings, and aerodynamic
 * corkscrew barrel roll dive attack.
 *
 * Procedural fallback cel-painter parameterised by (dir, phase, pose).
 * - Idle: Hovers / perches with gentle rhythmic wing flapping and beak bobbing.
 * - Walk: Low gliding flutter forward with sweeping wings and tail bobbing.
 * - Attack: 360-degree aerodynamic corkscrew barrel roll dive straight forward
 *   like a high-speed drill with wing streaks and spiral wind.
 * - Death: Tumbles down with tropical feathers bursting outward.
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
const R_BODY: Ramp = [1, 19, 20];       // Sleek glossy black feathers
const R_CHEST: Ramp = [20, 21, 22];     // Clean white chest bib
const R_BEAK_Y: Ramp = [16, 17, 18];    // Bright golden-yellow beak base
const R_BEAK_R: Ramp = [2, 3, 4];       // Flame-orange / red beak tip
const R_EYE: Ramp = [9, 10, 11];        // Cyan / turquoise eye ring
const R_LEGS: Ramp = [8, 9, 10];        // Slate blue talons
const R_FEATHERS: Ramp = [16, 17, 18];  // Accent feathers
const R_WIND: Ramp = [20, 21, 22];      // White spiral wind trail

interface PoseOpts {
  attacking?: boolean;
  rollPhase?: number;
  dead?: boolean;
  deathT?: number;
}

function toucanFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { attacking = false, rollPhase = 0, dead = false, deathT = 0 } = opts;

    if (dead) {
      const t = deathT || 0.6;
      groundShadow(ctx, CX, GROUND + 1, 16);

      // Fallen bird body on ground
      ellShaded(ctx, CX, GROUND - 6, 12, 6, R_BODY);
      ellShaded(ctx, CX + 6, GROUND - 7, 7, 5, R_CHEST);

      // Rainbow beak pointing to side
      plateShaded(
        ctx,
        [
          [CX + 8, GROUND - 8],
          [CX + 20, GROUND - 5],
          [CX + 14, GROUND - 2],
          [CX + 7, GROUND - 4],
        ],
        R_BEAK_Y,
      );
      ellShaded(ctx, CX + 19, GROUND - 5, 4, 3, R_BEAK_R);

      // Exploded tropical feathers scattered around
      ellShaded(ctx, CX - 14 - t * 6, GROUND - 8 - t * 10, 4, 3, R_FEATHERS);
      ellShaded(ctx, CX + 16 + t * 8, GROUND - 12 - t * 8, 4, 3, R_EYE);
      ellShaded(ctx, CX - 4, GROUND - 18 - t * 12, 3, 3, R_BEAK_R);
      ellShaded(ctx, CX + 10, GROUND - 20 - t * 10, 4, 2.5, R_BODY);
      return;
    }

    const flap = Math.sin(phase * Math.PI * 2) * 3;
    const hoverY = Math.cos(phase * Math.PI * 2) * 2;
    const lungeX = attacking ? (dir === "E" ? 14 : dir === "S" ? 0 : -10) : 0;
    const lungeY = attacking ? 4 : 0;

    groundShadow(ctx, CX + lungeX * 0.4, GROUND + 1, attacking ? 22 : 18);

    const bodyX = CX - 6 + lungeX;
    const bodyY = GROUND - 28 + hoverY + lungeY;

    if (attacking) {
      // ── BARREL ROLL DIVE ATTACK ──
      // Streamlined horizontal torpedo posture with 360-degree corkscrew rotation
      const spinAngle = (rollPhase || phase) * Math.PI * 2;
      const rollOffset = Math.sin(spinAngle) * 3;

      // Spiral wind vortex rings behind the diving bird
      ellShaded(ctx, bodyX - 8, bodyY + 2, 10, 12, R_WIND);

      // Torpedo black body
      ellShaded(ctx, bodyX + 2, bodyY + 2, 18, 9, R_BODY);
      ellShaded(ctx, bodyX + 6, bodyY + 1 + rollOffset, 10, 6, R_CHEST);

      // Rotating wings tucked in high-speed spin
      limbShaded(ctx, [bodyX, bodyY], [bodyX + 8, bodyY - 6 + rollOffset], 5, R_BODY);
      limbShaded(ctx, [bodyX, bodyY + 4], [bodyX + 8, bodyY + 10 - rollOffset], 5, R_BODY);

      // Massive leading rainbow beak drilling forward
      plateShaded(ctx, rectPts(bodyX + 14, bodyY - 3, 18, 10), R_BEAK_Y);
      ellShaded(ctx, bodyX + 30, bodyY + 2, 6, 4.5, R_BEAK_R);

      // Eye
      ellShaded(ctx, bodyX + 10, bodyY - 1, 3, 3, R_EYE);
      return;
    }

    // ── NORMAL HOVER / GLIDE (Idle & Walk) ──
    // Talons tucked closely underneath body
    ellShaded(ctx, bodyX - 2, bodyY + 14, 6, 3, R_LEGS);
    ellShaded(ctx, bodyX + 4, bodyY + 14, 6, 3, R_LEGS);

    // Black tail feathers
    plateShaded(ctx, rectPts(bodyX - 14, bodyY + 6, 12, 8), R_BODY);

    // Main oval body
    ellShaded(ctx, bodyX + 2, bodyY + 4, 16, 13, R_BODY);

    // White throat / chest bib
    ellShaded(ctx, bodyX + 8, bodyY + 4, 9, 9, R_CHEST);

    // Flapping wings attached flush to body
    ellShaded(ctx, bodyX - 4, bodyY + 2 - flap, 14, 8, R_BODY);

    // Cyan eye ring
    const eyeX = bodyX + (dir === "E" ? 10 : 8);
    const eyeY = bodyY - 2;
    ellShaded(ctx, eyeX, eyeY, 3, 3, R_EYE);

    // Giant Banana Rainbow Beak
    const beakBaseX = eyeX + 2;
    const beakBaseY = eyeY - 3;
    plateShaded(ctx, rectPts(beakBaseX, beakBaseY, 18, 11), R_BEAK_Y);

    // Red tip of beak
    ellShaded(ctx, beakBaseX + 16, beakBaseY + 5.5, 6, 5, R_BEAK_R);
  };
}

export function makeToucanPaints(): ActorPaints {
  const dirs: Dir[] = ["S", "N", "E"];
  const out: Partial<Record<Dir, any>> = {};

  for (const dir of dirs) {
    out[dir] = {
      idle: [
        toucanFrame(dir, 0.0),
        toucanFrame(dir, 0.25),
        toucanFrame(dir, 0.5),
        toucanFrame(dir, 0.75),
      ],
      walk: [
        toucanFrame(dir, 0.1),
        toucanFrame(dir, 0.35),
        toucanFrame(dir, 0.6),
        toucanFrame(dir, 0.85),
      ],
      run: [
        toucanFrame(dir, 0.15),
        toucanFrame(dir, 0.4),
        toucanFrame(dir, 0.65),
        toucanFrame(dir, 0.9),
      ],
      attack: [
        toucanFrame(dir, 0.0, { attacking: true, rollPhase: 0.0 }),
        toucanFrame(dir, 0.25, { attacking: true, rollPhase: 0.25 }),
        toucanFrame(dir, 0.5, { attacking: true, rollPhase: 0.5 }),
        toucanFrame(dir, 0.75, { attacking: true, rollPhase: 0.75 }),
      ],
      stumble: [
        toucanFrame(dir, 0.4),
      ],
      death: [
        toucanFrame(dir, 0.2, { dead: true, deathT: 0.2 }),
        toucanFrame(dir, 0.5, { dead: true, deathT: 0.5 }),
        toucanFrame(dir, 0.8, { dead: true, deathT: 0.8 }),
        toucanFrame(dir, 1.0, { dead: true, deathT: 1.0 }),
      ],
    };
  }

  return out as ActorPaints;
}
