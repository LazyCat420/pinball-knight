/**
 * NECROMANCER — dark hooded wizard who conjures undead zombie mini bunny rabbits.
 *
 * Procedural fallback cel-painter parameterised by (dir, phase).
 * Features tattered obsidian & purple robes, glowing green necrotic eyes under a dark hood,
 * and a carved horned bone skull staff that channels summoning magic.
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
const R_ROBE: Ramp = [0, 1, 2];       // Deep midnight / tattered black
const R_HOOD: Ramp = [2, 3, 4];       // Dark purple / shadowed cowl
const R_BONE: Ramp = [26, 27, 28];    // Ancient bleached bone skull & staff
const R_GLOW_GREEN = "#33FF66";      // Necrotic green magic
const R_GLOW_PURPLE = "#AA22FF";     // Dark soul resonance

function necroFrame(dir: Dir, phase: number, dead = false): FramePaint {
  return (ctx) => {
    if (dead) {
      // Necromancer collapsed, robes pooling on ground, broken skull staff
      groundShadow(ctx, CX, GROUND, 18);
      // Fallen robe heap
      ellShaded(ctx, CX, GROUND - 4, 16, 6, R_ROBE);
      ellShaded(ctx, CX - 4, GROUND - 5, 10, 5, R_HOOD);
      // Broken bone staff lying on floor
      ctx.fillStyle = "#DDEEAA";
      ctx.fillRect(CX + 6, GROUND - 3, 12, 2);
      // Fading soul spark
      ctx.fillStyle = "#552288";
      ctx.fillRect(CX - 2, GROUND - 7, 4, 2);
      return;
    }

    // Floating / hovering bob motion
    const hoverBob = Math.sin(phase * Math.PI) * 3;
    const bodyY = GROUND - 22 + hoverBob;

    // Soft hovering ground shadow that scales with height
    groundShadow(ctx, CX, GROUND, 14 - hoverBob * 0.5);

    // Billowing lower robes
    const sway = Math.cos(phase * Math.PI) * 2;
    ellShaded(ctx, CX + sway, bodyY + 8, 11, 10, R_ROBE);
    ellShaded(ctx, CX, bodyY, 9, 10, R_ROBE);

    // Tattered bottom robe frills
    ctx.fillStyle = "#110b18";
    ctx.fillRect(CX - 8 + sway, bodyY + 12, 4, 4);
    ctx.fillRect(CX - 2 + sway, bodyY + 13, 5, 4);
    ctx.fillRect(CX + 5 + sway, bodyY + 11, 4, 4);

    // Hood / Cowl
    const headY = bodyY - 14;
    ellShaded(ctx, CX, headY, 8, 9, R_HOOD);

    // Inner shadow of the hood (deep black)
    if (dir !== "N") {
      ctx.fillStyle = "#05000a";
      ctx.beginPath();
      ctx.ellipse(CX, headY + 1, 5, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Glowing necrotic eyes peering from the abyss
      const eyeY = headY;
      ctx.fillStyle = R_GLOW_GREEN;
      if (dir === "E") {
        ctx.fillRect(CX + 1, eyeY, 3, 2);
        figGlow(ctx, CX + 2, eyeY + 1, 4, 18, 17);
      } else {
        ctx.fillRect(CX - 4, eyeY, 2, 2);
        ctx.fillRect(CX + 2, eyeY, 2, 2);
        figGlow(ctx, CX - 3, eyeY + 1, 3, 18, 17);
        figGlow(ctx, CX + 3, eyeY + 1, 3, 18, 17);
      }
    }

    // Horned Skull Bone Staff
    const staffX = dir === "E" ? CX + 10 : CX - 10;
    const staffTopY = bodyY - 18;

    // Staff shaft
    ellShaded(ctx, staffX, bodyY, 2, 22, R_BONE);

    // Staff skull headpiece
    ellShaded(ctx, staffX, staffTopY, 5, 5, R_BONE);
    // Skull eye sockets
    ctx.fillStyle = "#111115";
    ctx.fillRect(staffX - 2, staffTopY - 1, 2, 2);
    ctx.fillRect(staffX + 1, staffTopY - 1, 2, 2);

    // Staff necrotic aura
    figGlow(ctx, staffX, staffTopY, 5, 17, 16);
  };
}

function necroAttack(dir: Dir, t: number): FramePaint {
  return (ctx) => {
    // Base frame in summoning cast
    necroFrame(dir, 0)(ctx);

    const bodyY = GROUND - 22;
    const staffX = dir === "E" ? CX + 12 : CX - 12;
    const staffTopY = bodyY - 24;

    // Raised bone staff channeling magic
    ellShaded(ctx, staffX, staffTopY, 6, 6, R_BONE);

    // Green/purple necrotic summoning rune on ground
    const runeRadius = 14 + Math.sin(t * Math.PI) * 4;
    ctx.strokeStyle = t > 0.4 ? R_GLOW_GREEN : R_GLOW_PURPLE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(CX, GROUND, runeRadius, runeRadius * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Swirling necrotic particles and summoning sparks
    if (t > 0.25 && t < 0.85) {
      figGlow(ctx, staffX, staffTopY, 8, 18, 17);
      figGlow(ctx, CX, GROUND - 4, 10, 17, 16);

      // Mini bunny ears silhouette popping up from rune
      ctx.fillStyle = "#223322";
      ctx.fillRect(CX + 6, GROUND - 7, 2, 6);
      ctx.fillRect(CX + 9, GROUND - 7, 2, 6);
      ctx.fillStyle = "#FF2233";
      ctx.fillRect(CX + 7, GROUND - 3, 2, 2); // Glowing bunny eye
    }
  };
}

export function makeNecroPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [necroFrame(dir, 0), necroFrame(dir, 0.5)],
    walk: [
      necroFrame(dir, -0.75),
      necroFrame(dir, 0),
      necroFrame(dir, 0.75),
      necroFrame(dir, 0),
    ],
    attack: [necroAttack(dir, 0), necroAttack(dir, 0.5), necroAttack(dir, 1)],
    death: [
      necroFrame(dir, 0.5),
      necroFrame(dir, 0, true),
      necroFrame(dir, 0, true),
      necroFrame(dir, 0, true),
    ],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
