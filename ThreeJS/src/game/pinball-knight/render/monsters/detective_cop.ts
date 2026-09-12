/**
 * DETECTIVE COP — Hard-boiled noir undercover detective.
 *
 * Procedural fallback cel-painter parameterised by (dir, phase).
 * Features a billowing khaki trench coat with popped lapel collar,
 * dark wool trousers, tilted fedora hat with black ribbon band,
 * glowing cigarette cherry with rising wisp of smoke,
 * and a heavy .44 Magnum revolver.
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

// Palette Ramps
const R_COAT: Ramp = [27, 28, 29];        // Khaki / taupe wool trench coat
const R_PANTS: Ramp = [1, 2, 3];           // Charcoal suit trousers
const R_SKIN: Ramp = [23, 24, 25];         // Human skin tone
const R_SHOES: Ramp = [0, 1, 2];           // Dark dress oxfords
const R_HAT: Ramp = [26, 27, 28];          // Felt fedora hat

function detectiveCopFrame(dir: Dir, phase: number, dead = false): FramePaint {
  return (ctx) => {
    if (dead) {
      groundShadow(ctx, CX, GROUND, 20);
      // Trench coat spread out on ground
      ellShaded(ctx, CX, GROUND - 5, 20, 7, R_COAT);
      ellShaded(ctx, CX - 12, GROUND - 6, 7, 7, R_SKIN);
      // Fedora rolled off to side
      ellShaded(ctx, CX + 14, GROUND - 6, 8, 5, R_HAT);
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(CX + 12, GROUND - 6, 4, 2); // Hatband
      return;
    }

    const bob = Math.abs(Math.sin(phase * Math.PI)) * 1.8;
    const bodyY = GROUND - 22 - bob;

    groundShadow(ctx, CX, GROUND, 16);

    // Trousers & shoes walking
    const legSwing = Math.sin(phase * Math.PI) * 3.5;
    ellShaded(ctx, CX - 4 + legSwing, GROUND - 10, 4, 7, R_PANTS);
    ellShaded(ctx, CX - 4 + legSwing, GROUND - 4, 4, 4, R_SHOES);
    ellShaded(ctx, CX + 4 - legSwing, GROUND - 10, 4, 7, R_PANTS);
    ellShaded(ctx, CX + 4 - legSwing, GROUND - 4, 4, 4, R_SHOES);

    // Billowing Trench Coat Skirt (hangs down past waist)
    ellShaded(ctx, CX, bodyY + 6, 11, 8, R_COAT);

    // Torso: Trench Coat with Belt & Buckle
    ellShaded(ctx, CX, bodyY - 1, 10, 10, R_COAT);
    // Belt tied at waist
    ctx.fillStyle = "#475569";
    ctx.fillRect(CX - 8, bodyY + 4, 16, 2.5);
    ctx.fillStyle = "#cbd5e1";
    ctx.fillRect(CX - 2, bodyY + 3.5, 4, 3.5); // Belt buckle

    // Front Collar Lapels & White Shirt/Red Tie
    if (dir !== "N") {
      // White dress shirt slit
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(CX - 2, bodyY - 7, 4, 6);
      // Crimson noir necktie
      ctx.fillStyle = "#991b1b";
      ctx.beginPath();
      ctx.moveTo(CX - 1, bodyY - 6);
      ctx.lineTo(CX + 1, bodyY - 6);
      ctx.lineTo(CX + 1.5, bodyY + 2);
      ctx.lineTo(CX - 1.5, bodyY + 2);
      ctx.closePath();
      ctx.fill();

      // High popped coat lapels
      ctx.fillStyle = "#78716c";
      ctx.beginPath();
      ctx.moveTo(CX - 6, bodyY - 6);
      ctx.lineTo(CX - 2, bodyY + 1);
      ctx.lineTo(CX - 4, bodyY + 1);
      ctx.closePath();
      ctx.fill();
    }

    // Head
    const headY = bodyY - 15;
    ellShaded(ctx, CX, headY, 7, 7, R_SKIN);

    // Felt Fedora Hat
    const hatY = headY - 4;
    ellShaded(ctx, CX, hatY, 10, 5, R_HAT);
    // Black hatband ribbon
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(CX - 9, hatY, 18, 2);
    // Fedora brim tilted low
    ctx.fillStyle = "#57534e";
    ctx.fillRect(CX - 10, hatY + 2, 20, 2);

    // Face details: Shadowed eyes + glowing cigarette
    if (dir !== "N") {
      // Heavy brow shadow under fedora brim
      ctx.fillStyle = "rgba(15, 23, 42, 0.6)";
      ctx.fillRect(CX - 6, headY - 1, 12, 3);

      // Glowing cigarette ember
      const cigX = dir === "E" ? CX + 4 : CX + 2;
      const cigY = headY + 4;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(cigX, cigY, 4, 1.5);
      ctx.fillStyle = "#f97316";
      ctx.fillRect(cigX + 4, cigY, 1.5, 1.5);
      // Smoke wisp rising
      ctx.fillStyle = "rgba(203, 213, 225, 0.4)";
      ctx.fillRect(cigX + 5, cigY - 3, 1.5, 3);
    }

    // Heavy .44 Magnum Revolver in hand
    if (dir === "E") {
      ctx.fillStyle = "#334155";
      ctx.fillRect(CX + 8, bodyY + 2, 8, 3); // Long barrel
      ctx.fillRect(CX + 6, bodyY + 3, 3, 3); // Cylinder
      ctx.fillStyle = "#78350f";
      ctx.fillRect(CX + 5, bodyY + 4, 2, 4); // Wooden grip
    } else if (dir === "S") {
      ctx.fillStyle = "#334155";
      ctx.fillRect(CX + 7, bodyY + 3, 4, 3);
      ctx.fillStyle = "#78350f";
      ctx.fillRect(CX + 7, bodyY + 5, 2, 3);
    }
  };
}

function detectiveCopAttack(dir: Dir, t: number): FramePaint {
  return (ctx) => {
    detectiveCopFrame(dir, 0)(ctx);

    const bodyY = GROUND - 22;
    const gunY = bodyY - 2;
    const gunX = dir === "E" ? CX + 14 : CX + 9;

    // Recoil kickback of the heavy .44 Magnum
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(gunX, gunY, 9, 4);
    ctx.fillRect(gunX - 2, gunY + 2, 3, 5);

    if (t > 0.25 && t < 0.75) {
      // Powerful orange/white muzzle blast
      figGlow(ctx, gunX + 11, gunY + 1, 8, 18, 17);
      ctx.fillStyle = "#fef08a";
      ctx.beginPath();
      ctx.arc(gunX + 11, gunY + 1, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  };
}

export function makeDetectiveCopPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [detectiveCopFrame(dir, 0), detectiveCopFrame(dir, 0.5)],
    walk: [
      detectiveCopFrame(dir, -0.75),
      detectiveCopFrame(dir, 0),
      detectiveCopFrame(dir, 0.75),
      detectiveCopFrame(dir, 0),
    ],
    attack: [detectiveCopAttack(dir, 0), detectiveCopAttack(dir, 0.5), detectiveCopAttack(dir, 1)],
    death: [
      detectiveCopFrame(dir, 0.5),
      detectiveCopFrame(dir, 0, true),
      detectiveCopFrame(dir, 0, true),
      detectiveCopFrame(dir, 0, true),
    ],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
