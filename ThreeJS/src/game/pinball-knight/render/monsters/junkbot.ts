/**
 * JUNKBOT — a scavenger robot monster with a retro CRT monitor chassis and scrap metal limbs.
 *
 * Scavenges parts from across the realm (tractor treads, industrial robotics, automobile
 * springs, demolition crane hooks, and appliance motors).
 *
 * Procedural fallback cel-painter parameterised by (dir, phase, opts).
 */
import {
  CX,
  GROUND,
  groundShadow,
  glow as figGlow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

interface JunkbotOpts {
  bob?: number;
  stride?: number;
  swing?: number;
  deathT?: number;
  dead?: boolean;
}

function junkbotFrame(dir: Dir, phase: number, opts: JunkbotOpts = {}): FramePaint {
  return (ctx) => {
    const { bob = 0, stride = 0, swing = 0, deathT = 0, dead = false } = opts;

    if (dead || deathT > 0) {
      // Shattered screen, broken limbs, smoking metal scrap heap
      const t = Math.min(1, Math.max(0, deathT));
      const collapseY = GROUND - 3;

      groundShadow(ctx, CX, GROUND, 26);

      // Broken tractor treads & wheels on floor
      ctx.fillStyle = "#333333";
      ctx.fillRect(CX - 14, collapseY - 4, 10, 5);
      ctx.fillRect(CX + 6, collapseY - 5, 8, 6);

      // Cracked CRT monitor chassis
      ctx.fillStyle = "#8a8878";
      ctx.fillRect(CX - 8, collapseY - 12 + t * 4, 18, 11);

      // Shattered screen with sparks
      ctx.fillStyle = "#112222";
      ctx.fillRect(CX - 6, collapseY - 10 + t * 4, 14, 7);

      // Glitch sparks
      ctx.fillStyle = "#00ffff";
      ctx.fillRect(CX - 4, collapseY - 8 + t * 4, 3, 2);
      ctx.fillStyle = "#ffff00";
      ctx.fillRect(CX + 3, collapseY - 9 + t * 4, 2, 3);

      // Detached metal robotic arm
      ctx.fillStyle = "#666666";
      ctx.fillRect(CX - 16, collapseY - 6, 8, 3);
      ctx.fillStyle = "#e0a020";
      ctx.fillRect(CX + 14, collapseY - 7, 7, 5); // excavator bucket piece

      // Smoke puff
      ctx.fillStyle = "#888888";
      ctx.beginPath();
      ctx.arc(CX, collapseY - 14 - t * 6, 4 + t * 3, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    groundShadow(ctx, CX, GROUND, 28);

    const bodyY = GROUND - 18 + bob;
    const legY = bodyY + 12;

    // ── LEGS / TREADS ──
    const leftLegOffset = Math.sin(stride) * 4;
    const rightLegOffset = -Math.sin(stride) * 4;

    // Left tread / leg
    ctx.fillStyle = "#444440";
    ctx.fillRect(CX - 12 + leftLegOffset, legY, 7, 8);
    ctx.fillStyle = "#222220";
    ctx.fillRect(CX - 13 + leftLegOffset, legY + 6, 9, 3);

    // Right tread / leg
    ctx.fillStyle = "#444440";
    ctx.fillRect(CX + 5 + rightLegOffset, legY, 7, 8);
    ctx.fillStyle = "#222220";
    ctx.fillRect(CX + 4 + rightLegOffset, legY + 6, 9, 3);

    // ── TORSO / CRT COMPUTER MONITOR ──
    // Chassis bevel (beige / grey retro casing)
    ctx.fillStyle = "#b5b29f";
    ctx.fillRect(CX - 12, bodyY - 10, 24, 18);
    ctx.fillStyle = "#7a7768";
    ctx.strokeRect(CX - 12, bodyY - 10, 24, 18);

    // CRT Screen bezel
    ctx.fillStyle = "#202020";
    ctx.fillRect(CX - 9, bodyY - 7, 18, 12);

    // Glowing screen face
    ctx.fillStyle = "#0c3b2e";
    ctx.fillRect(CX - 8, bodyY - 6, 16, 10);

    // Digital pixel eyes
    ctx.fillStyle = "#00ffcc";
    ctx.fillRect(CX - 5, bodyY - 4, 3, 3);
    ctx.fillRect(CX + 2, bodyY - 4, 3, 3);
    // Smile / mouth scanline
    ctx.fillRect(CX - 3, bodyY + 1, 6, 1);

    figGlow(ctx, CX, bodyY - 1, 10, 6, 7);

    // ── ARMS & TOOLS ──
    // Left arm: hydraulic boom & excavator scoop
    ctx.fillStyle = "#d49a17";
    const leftArmAngle = Math.sin(stride) * 0.3 + swing * 0.8;
    ctx.save();
    ctx.translate(CX - 12, bodyY - 4);
    ctx.rotate(-0.2 + leftArmAngle);
    ctx.fillRect(-10, -3, 10, 4); // upper arm
    ctx.fillStyle = "#777777";
    ctx.fillRect(-14, 1, 6, 8);  // scoop bucket
    ctx.restore();

    // Right arm: industrial robot welder / clamp
    ctx.fillStyle = "#666666";
    const rightArmAngle = -Math.sin(stride) * 0.3 - swing * 1.2;
    ctx.save();
    ctx.translate(CX + 12, bodyY - 4);
    ctx.rotate(0.2 + rightArmAngle);
    ctx.fillRect(0, -2, 10, 4);
    ctx.fillStyle = "#00ffff";
    if (swing > 0.5) {
      // Welding spark flash during attack
      ctx.fillRect(10, -1, 5, 2);
      figGlow(ctx, CX + 20, bodyY, 6, 6, 8);
    } else {
      ctx.fillStyle = "#444444";
      ctx.fillRect(10, -3, 3, 6); // pincer claw
    }
    ctx.restore();

    // Diesel exhaust stack on shoulder
    ctx.fillStyle = "#555555";
    ctx.fillRect(CX - 10, bodyY - 15, 3, 6);
    if (Math.sin(phase * 4) > 0.2) {
      ctx.fillStyle = "#999999";
      ctx.fillRect(CX - 11, bodyY - 18, 5, 2); // smoke puff
    }
  };
}

export function makeJunkbotPaints(): ActorPaints {
  const facings: Array<Dir> = ["S", "N", "E"];
  const out: Partial<ActorPaints> = {};

  for (const dir of facings) {
    out[dir] = {
      idle: [
        junkbotFrame(dir, 0.0, { bob: 0 }),
        junkbotFrame(dir, 0.25, { bob: -1 }),
        junkbotFrame(dir, 0.5, { bob: 0 }),
        junkbotFrame(dir, 0.75, { bob: 1 }),
      ],
      walk: [
        junkbotFrame(dir, 0.0, { stride: 0.0, bob: 0 }),
        junkbotFrame(dir, 0.25, { stride: 1.57, bob: -1 }),
        junkbotFrame(dir, 0.5, { stride: 3.14, bob: 0 }),
        junkbotFrame(dir, 0.75, { stride: 4.71, bob: -1 }),
      ],
      attack: [
        junkbotFrame(dir, 0.0, { swing: 0.2 }),
        junkbotFrame(dir, 0.33, { swing: 0.6 }),
        junkbotFrame(dir, 0.66, { swing: 1.0 }),
        junkbotFrame(dir, 1.0, { swing: 0.3 }),
      ],
      death: [
        junkbotFrame(dir, 0.0, { deathT: 0.25 }),
        junkbotFrame(dir, 0.33, { deathT: 0.50 }),
        junkbotFrame(dir, 0.66, { deathT: 0.75 }),
        junkbotFrame(dir, 1.0, { deathT: 1.0, dead: true }),
      ],
    };
  }

  return out as ActorPaints;
}
