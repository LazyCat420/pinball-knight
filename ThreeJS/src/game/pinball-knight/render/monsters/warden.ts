/**
 * WARDEN — a stern prison guard / cop (Wolfenstein 3D hybrid).
 *
 * Procedural fallback cel-painter parameterised by (dir, phase).
 * Features a slate-blue uniform, khaki trousers, gold police badge,
 * dark aviator sunglasses, peaked service cap with gold emblem,
 * black combat boots, and a drawn service revolver.
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
const R_SHIRT: Ramp = [21, 22, 23];  // Slate-blue police shirt
const R_PANTS: Ramp = [26, 27, 28];  // Khaki uniform trousers
const R_SKIN: Ramp = [23, 24, 25];   // Human skin tones
const R_BOOTS: Ramp = [0, 1, 2];     // Polished black leather boots
const R_CAP: Ramp = [21, 22, 23];    // Slate-blue peaked cap

function wardenFrame(dir: Dir, phase: number, dead = false): FramePaint {
  return (ctx) => {
    if (dead) {
      // Guard collapsed on ground, cap knocked off
      groundShadow(ctx, CX, GROUND, 20);
      // Fallen body
      ellShaded(ctx, CX + 4, GROUND - 4, 18, 6, R_PANTS);
      ellShaded(ctx, CX - 8, GROUND - 6, 12, 7, R_SHIRT);
      // Head
      ellShaded(ctx, CX - 18, GROUND - 7, 6, 6, R_SKIN);
      // Peaked cap lying nearby
      ctx.fillStyle = "#334466";
      ctx.fillRect(CX + 14, GROUND - 5, 8, 4);
      ctx.fillStyle = "#FFD700";
      ctx.fillRect(CX + 16, GROUND - 6, 4, 2);
      return;
    }

    const bob = Math.abs(Math.sin(phase * Math.PI)) * 2;
    const bodyY = GROUND - 22 - bob;

    // Contact shadow
    groundShadow(ctx, CX, GROUND, 16);

    // Legs / Boots marching
    const legSwing = Math.sin(phase * Math.PI) * 4;
    // Left leg
    ellShaded(ctx, CX - 5 + legSwing, GROUND - 10, 4, 7, R_PANTS);
    ellShaded(ctx, CX - 5 + legSwing, GROUND - 4, 4, 4, R_BOOTS);
    // Right leg
    ellShaded(ctx, CX + 5 - legSwing, GROUND - 10, 4, 7, R_PANTS);
    ellShaded(ctx, CX + 5 - legSwing, GROUND - 4, 4, 4, R_BOOTS);

    // Belt & Holster
    ctx.fillStyle = "#111115";
    ctx.fillRect(CX - 8, bodyY + 6, 16, 3);
    // Holster on right hip
    ctx.fillRect(CX + 7, bodyY + 7, 3, 6);

    // Torso: Slate-blue uniform shirt
    ellShaded(ctx, CX, bodyY - 1, 10, 10, R_SHIRT);

    // Front details (badge, tie) visible in S and E
    if (dir !== "N") {
      // Black tie
      ctx.fillStyle = "#0c0c10";
      ctx.beginPath();
      ctx.moveTo(CX - 1, bodyY - 6);
      ctx.lineTo(CX + 1, bodyY - 6);
      ctx.lineTo(CX + 2, bodyY + 4);
      ctx.lineTo(CX - 2, bodyY + 4);
      ctx.closePath();
      ctx.fill();

      // Shiny gold police badge
      const badgeX = dir === "E" ? CX + 4 : CX - 5;
      const badgeY = bodyY - 3;
      ctx.fillStyle = "#FFD700";
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Head
    const headY = bodyY - 15;
    ellShaded(ctx, CX, headY, 7, 7, R_SKIN);

    // Peaked officer cap
    const capY = headY - 5;
    ellShaded(ctx, CX, capY, 9, 5, R_CAP);
    // Gold cap emblem
    ctx.fillStyle = "#FFD700";
    ctx.fillRect(CX - 2, capY - 1, 4, 3);
    // Black visor / brim
    ctx.fillStyle = "#0a0a0e";
    ctx.fillRect(CX - 8, capY + 2, 16, 2);

    // Face details
    if (dir !== "N") {
      // Dark aviator sunglasses
      const glassY = headY - 1;
      ctx.fillStyle = "#08080c";
      if (dir === "E") {
        ctx.fillRect(CX + 1, glassY, 5, 3);
      } else {
        ctx.fillRect(CX - 6, glassY, 5, 3);
        ctx.fillRect(CX + 1, glassY, 5, 3);
        // Bridge
        ctx.fillRect(CX - 1, glassY, 2, 1);
      }

      // Stern jaw / mouth line
      ctx.fillStyle = "#774433";
      ctx.fillRect(CX - 2, headY + 4, 4, 1);
    }

    // Service pistol held at ready
    if (dir === "E") {
      ctx.fillStyle = "#222226";
      ctx.fillRect(CX + 9, bodyY + 1, 7, 3);
      ctx.fillRect(CX + 8, bodyY + 3, 3, 4);
    } else if (dir === "S") {
      ctx.fillStyle = "#222226";
      ctx.fillRect(CX + 7, bodyY + 2, 4, 3);
      ctx.fillRect(CX + 8, bodyY + 4, 2, 4);
    }
  };
}

function wardenAttack(dir: Dir, t: number): FramePaint {
  return (ctx) => {
    // Base frame with aim stance
    wardenFrame(dir, 0)(ctx);

    const bodyY = GROUND - 22;
    const gunY = bodyY - 2;

    // Two-handed extended pistol aim
    const gunX = dir === "E" ? CX + 14 : CX + 9;
    ctx.fillStyle = "#18181c";
    ctx.fillRect(gunX, gunY, 8, 3);
    ctx.fillRect(gunX - 2, gunY + 2, 3, 4);

    // Firing flash at peak (t ~ 0.5)
    if (t > 0.3 && t < 0.7) {
      figGlow(ctx, gunX + 10, gunY + 1, 6, 18, 17); // Bright muzzle flash
      ctx.fillStyle = "#FFEE88";
      ctx.beginPath();
      ctx.arc(gunX + 9, gunY + 1, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  };
}

export function makeWardenPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [wardenFrame(dir, 0), wardenFrame(dir, 0.5)],
    walk: [
      wardenFrame(dir, -0.75),
      wardenFrame(dir, 0),
      wardenFrame(dir, 0.75),
      wardenFrame(dir, 0),
    ],
    attack: [wardenAttack(dir, 0), wardenAttack(dir, 0.5), wardenAttack(dir, 1)],
    death: [
      wardenFrame(dir, 0.5),
      wardenFrame(dir, 0, true),
      wardenFrame(dir, 0, true),
      wardenFrame(dir, 0, true),
    ],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
