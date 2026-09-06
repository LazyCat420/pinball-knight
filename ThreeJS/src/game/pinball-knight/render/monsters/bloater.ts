/**
 * BLOATER — a grotesque garbage monster and trash golem.
 *
 * Procedural fallback cel-painter parameterised by (dir, phase).
 * Features a massive heaving junk body, squelching refuse, and an
 * incandescent glowing belly with molten magma fissures.
 */
import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  glow as figGlow,
  groundShadow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

const R_BODY: Ramp = [26, 27, 28]; // Leather/sludge brown
const R_ROT: Ramp = [6, 7, 8];     // Rot green sludge
const MAGMA_HOT = 17;              // Torch light
const MAGMA_CORE = 16;             // Flame
const MAGMA_DARK = 15;             // Ember dark

function bloaterFrame(dir: Dir, phase: number, dead = false): FramePaint {
  return (ctx) => {
    if (dead) {
      // Smoking ruptured crater on ground
      groundShadow(ctx, CX, GROUND, 24);
      ellShaded(ctx, CX, GROUND - 4, 20, 8, [0, 1, 2] as Ramp);
      figGlow(ctx, CX, GROUND - 4, 12, MAGMA_CORE, MAGMA_HOT);
      return;
    }

    const bob = Math.abs(Math.sin(phase * Math.PI)) * 3;
    const sway = Math.sin(phase * Math.PI) * 2;
    const bodyY = GROUND - 26 - bob;
    const bellyPulse = 1 + Math.sin(phase * Math.PI * 2) * 0.08;

    // Contact shadow
    groundShadow(ctx, CX, GROUND, 22 + bellyPulse * 2);

    // Legs / sludge base
    const legOff = Math.sin(phase * Math.PI) * 4;
    ellShaded(ctx, CX - 10 + legOff, GROUND - 8, 8, 6, R_BODY);
    ellShaded(ctx, CX + 10 - legOff, GROUND - 8, 8, 6, R_BODY);

    // Exhaust pipe on back (visible in S/N)
    ctx.fillStyle = "#333338";
    ctx.fillRect(CX - 16, bodyY - 22, 6, 14);
    figGlow(ctx, CX - 13, bodyY - 24, 3, MAGMA_CORE, MAGMA_HOT);

    // Main heaving garbage torso
    ellShaded(ctx, CX + sway * 0.5, bodyY, 22, 24, R_BODY);
    ellShaded(ctx, CX + sway * 0.5 - 6, bodyY + 4, 14, 16, R_ROT);

    // Bloated glowing magma belly (visible in S and E)
    if (dir !== "N") {
      const bellyX = dir === "E" ? CX + 8 : CX;
      const bellyY = bodyY + 4;
      const bellyR = 14 * bellyPulse;
      ellShaded(ctx, bellyX, bellyY, bellyR, bellyR * 0.9, [MAGMA_DARK, MAGMA_CORE, MAGMA_HOT] as Ramp);
      figGlow(ctx, bellyX, bellyY, bellyR * 0.7, MAGMA_CORE, MAGMA_HOT);

      // Cracked magma veins
      ctx.strokeStyle = `rgba(255, 220, 100, 0.8)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bellyX - 6, bellyY - 4);
      ctx.lineTo(bellyX, bellyY);
      ctx.lineTo(bellyX + 7, bellyY - 2);
      ctx.moveTo(bellyX, bellyY);
      ctx.lineTo(bellyX + 2, bellyY + 7);
      ctx.stroke();
    }

    // Head / gaping maw
    const headY = bodyY - 18;
    ellShaded(ctx, CX + sway * 0.8, headY, 12, 10, R_BODY);

    if (dir !== "N") {
      // Small glowing eyes
      const eyeY = headY - 2;
      figGlow(ctx, CX - 4, eyeY, 2, MAGMA_HOT, MAGMA_CORE);
      figGlow(ctx, CX + 4, eyeY, 2, MAGMA_HOT, MAGMA_CORE);

      // Crooked mouth
      ctx.fillStyle = "#151515";
      ctx.fillRect(CX - 5, headY + 3, 10, 3);
    }
  };
}

function bloaterAttack(dir: Dir, t: number): FramePaint {
  return (ctx) => {
    // Deep inhalation then vomit spray
    bloaterFrame(dir, 0.5 + t * 0.5)(ctx);
    if (dir === "N") return;

    // Spew burning sludge
    const mouthY = GROUND - 40;
    ctx.fillStyle = "rgba(255, 80, 0, 0.85)";
    for (let i = 0; i < 4; i++) {
      const r = 2 + Math.random() * 3;
      const ox = (Math.random() - 0.5) * 12 + t * 16;
      const oy = mouthY + (Math.random() - 0.5) * 8 + t * 12;
      ctx.beginPath();
      ctx.arc(CX + ox, oy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  };
}

export function makeBloaterPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [bloaterFrame(dir, 0), bloaterFrame(dir, 0.5)],
    walk: [
      bloaterFrame(dir, -0.75),
      bloaterFrame(dir, 0),
      bloaterFrame(dir, 0.75),
      bloaterFrame(dir, 0),
    ],
    attack: [bloaterAttack(dir, 0), bloaterAttack(dir, 0.5), bloaterAttack(dir, 1)],
    death: [
      bloaterFrame(dir, 0.8),
      bloaterFrame(dir, 0, true),
      bloaterFrame(dir, 0, true),
      bloaterFrame(dir, 0, true),
    ],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
