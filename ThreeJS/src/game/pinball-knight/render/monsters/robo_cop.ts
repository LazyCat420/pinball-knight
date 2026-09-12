/**
 * ROBO-COP — Cybernetic titanium law enforcer.
 *
 * Procedural fallback cel-painter parameterised by (dir, phase).
 * Features gleaming titanium/steel-blue alloy armor chassis,
 * matte black hydraulic joints, cylindrical cybernetic helmet with
 * a horizontal glowing crimson laser scanning eye slit,
 * high-tech Auto-9 machine pistol, and sparking blue EMP core.
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
const R_ARMOR: Ramp = [14, 15, 16];       // Titanium / steel-blue alloy chassis
const R_JOINTS: Ramp = [0, 1, 2];          // Matte black hydraulic servos
const R_HELMET: Ramp = [14, 15, 16];       // Titanium helmet shell
const R_GUN: Ramp = [0, 1, 2];             // Matte black polymer Auto-9

function roboCopFrame(dir: Dir, phase: number, dead = false): FramePaint {
  return (ctx) => {
    if (dead) {
      groundShadow(ctx, CX, GROUND, 22);
      // Shattered cyborg chassis collapsed
      ellShaded(ctx, CX + 4, GROUND - 4, 18, 6, R_JOINTS);
      ellShaded(ctx, CX - 8, GROUND - 6, 14, 8, R_ARMOR);
      ellShaded(ctx, CX - 18, GROUND - 7, 7, 7, R_HELMET);
      // Sparking EMP electrical discharge from breached power core
      figGlow(ctx, CX - 8, GROUND - 6, 8, 22, 21); // Blue electrical glow
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(CX - 10, GROUND - 8, 4, 4);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(CX - 9, GROUND - 7, 2, 2);
      return;
    }

    const bob = Math.abs(Math.sin(phase * Math.PI)) * 1.5; // Heavy robotic gait
    const bodyY = GROUND - 23 - bob;

    groundShadow(ctx, CX, GROUND, 18);

    // Mechanical robotic legs & pistons
    const legSwing = Math.sin(phase * Math.PI) * 3.5;
    // Left leg: thigh armor plate + hydraulic knee + shin guard
    ellShaded(ctx, CX - 6 + legSwing, GROUND - 12, 5, 8, R_ARMOR);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(CX - 7 + legSwing, GROUND - 9, 3, 3); // Knee joint servo
    ellShaded(ctx, CX - 6 + legSwing, GROUND - 4, 5, 5, R_ARMOR);

    // Right leg
    ellShaded(ctx, CX + 6 - legSwing, GROUND - 12, 5, 8, R_ARMOR);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(CX + 5 - legSwing, GROUND - 9, 3, 3); // Knee joint servo
    ellShaded(ctx, CX + 6 - legSwing, GROUND - 4, 5, 5, R_ARMOR);

    // Heavy Titanium Torso Chassis
    ellShaded(ctx, CX, bodyY, 12, 11, R_ARMOR);

    // Chestplate details: hydraulic ribs & police emblem
    if (dir !== "N") {
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(CX - 8, bodyY - 4, 16, 2); // Upper rib line
      ctx.fillRect(CX - 7, bodyY - 1, 14, 2); // Middle rib line
      ctx.fillRect(CX - 6, bodyY + 2, 12, 2); // Lower rib line

      // Police chest insignia badge
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(CX - 2, bodyY - 5, 4, 3);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(CX - 1, bodyY - 4, 2, 1);

      // Belt utility battery pack
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(CX - 8, bodyY + 5, 16, 3);
    }

    // Head: Cybernetic Helmet
    const headY = bodyY - 15;
    ellShaded(ctx, CX, headY, 8, 8, R_HELMET);

    // Chin / Mouth guard
    if (dir !== "N") {
      ctx.fillStyle = "#cbd5e1"; // Exposed lower face / mouth
      ctx.fillRect(CX - 4, headY + 2, 8, 5);
      ctx.fillStyle = "#64748b";
      ctx.fillRect(CX - 2, headY + 5, 4, 1); // Stern mouth slit

      // Horizontal Glowing Crimson Laser Visor Slit
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(CX - 7, headY - 2, 14, 3);
      // Intense eye bar glow
      figGlow(ctx, CX, headY - 1, 5, 18, 17);
      // Laser scan dot
      const scanX = CX - 5 + Math.abs(Math.sin(phase * 4)) * 10;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(scanX, headY - 2, 2, 3);
    }

    // High-tech Auto-9 Machine Pistol
    if (dir === "E") {
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(CX + 8, bodyY + 1, 10, 4); // Long compensator barrel
      ctx.fillRect(CX + 6, bodyY + 3, 3, 5);  // Magazine grip
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(CX + 9, bodyY + 2, 3, 1);  // Digital ammo counter
    } else if (dir === "S") {
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(CX + 7, bodyY + 2, 4, 4);
      ctx.fillRect(CX + 7, bodyY + 4, 2, 4);
    }
  };
}

function roboCopAttack(dir: Dir, t: number): FramePaint {
  return (ctx) => {
    roboCopFrame(dir, 0)(ctx);

    const bodyY = GROUND - 23;
    const gunY = bodyY - 1;
    const gunX = dir === "E" ? CX + 16 : CX + 10;

    // Firm two-handed Auto-9 firing lock
    ctx.fillStyle = "#020617";
    ctx.fillRect(gunX, gunY, 11, 4);
    ctx.fillRect(gunX - 3, gunY + 2, 4, 5);

    if (t > 0.2 && t < 0.8) {
      // Rapid 3-burst cyan / white muzzle flash
      figGlow(ctx, gunX + 12, gunY + 2, 8, 22, 21);
      ctx.fillStyle = "#e0f2fe";
      ctx.beginPath();
      ctx.arc(gunX + 12, gunY + 2, 4, 0, Math.PI * 2);
      ctx.fill();

      // Red laser targeting line
      ctx.strokeStyle = "rgba(239, 68, 68, 0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gunX + 12, gunY + 2);
      ctx.lineTo(gunX + 28, gunY + 2);
      ctx.stroke();
    }
  };
}

export function makeRoboCopPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [roboCopFrame(dir, 0), roboCopFrame(dir, 0.5)],
    walk: [
      roboCopFrame(dir, -0.75),
      roboCopFrame(dir, 0),
      roboCopFrame(dir, 0.75),
      roboCopFrame(dir, 0),
    ],
    attack: [roboCopAttack(dir, 0), roboCopAttack(dir, 0.5), roboCopAttack(dir, 1)],
    death: [
      roboCopFrame(dir, 0.5),
      roboCopFrame(dir, 0, true),
      roboCopFrame(dir, 0, true),
      roboCopFrame(dir, 0, true),
    ],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
