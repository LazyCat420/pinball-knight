/**
 * RIOT COP — SWAT ballistic breacher with clear riot shield & stun baton.
 *
 * Procedural fallback cel-painter parameterised by (dir, phase).
 * Features heavy midnight-navy tactical plate carrier, knee/shoulder pads,
 * ballistic riot helmet with clear cyan polycarbonate visor,
 * a large transparent-window riot shield, and a crackling stun baton.
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
const R_TACTICAL: Ramp = [0, 1, 2];       // Midnight navy / black tactical armor
const R_PANTS: Ramp = [1, 2, 3];          // Dark tactical BDUs
const R_SKIN: Ramp = [23, 24, 25];        // Human skin tone
const R_HELMET: Ramp = [0, 1, 2];         // Ballistic helmet shell
const R_BATON: Ramp = [14, 15, 16];       // Steel baton core

function riotCopFrame(dir: Dir, phase: number, dead = false): FramePaint {
  return (ctx) => {
    if (dead) {
      groundShadow(ctx, CX, GROUND, 22);
      // Fallen armor & legs
      ellShaded(ctx, CX + 4, GROUND - 4, 18, 6, R_PANTS);
      ellShaded(ctx, CX - 8, GROUND - 6, 14, 8, R_TACTICAL);
      // Dropped helmet
      ellShaded(ctx, CX - 18, GROUND - 7, 7, 7, R_HELMET);
      // Fallen riot shield on ground
      ctx.fillStyle = "rgba(56, 189, 248, 0.4)";
      ctx.fillRect(CX + 8, GROUND - 6, 16, 5);
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(CX + 8, GROUND - 6, 16, 5);
      return;
    }

    const bob = Math.abs(Math.sin(phase * Math.PI)) * 2;
    const bodyY = GROUND - 23 - bob;

    groundShadow(ctx, CX, GROUND, 18);

    // Marching tactical boots & legs
    const legSwing = Math.sin(phase * Math.PI) * 3.5;
    ellShaded(ctx, CX - 6 + legSwing, GROUND - 11, 5, 8, R_PANTS);
    ellShaded(ctx, CX - 6 + legSwing, GROUND - 4, 5, 5, R_TACTICAL);
    ellShaded(ctx, CX + 6 - legSwing, GROUND - 11, 5, 8, R_PANTS);
    ellShaded(ctx, CX + 6 - legSwing, GROUND - 4, 5, 5, R_TACTICAL);

    // Heavy tactical torso vest
    ellShaded(ctx, CX, bodyY, 12, 11, R_TACTICAL);

    // Front armor plate details
    if (dir !== "N") {
      ctx.fillStyle = "#334155";
      ctx.fillRect(CX - 7, bodyY - 5, 14, 5); // Chest placard
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(CX - 5, bodyY - 4, 10, 2); // White POLICE / SWAT text bar
      // Tactical pouch belt
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(CX - 8, bodyY + 5, 16, 3);
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(CX - 6, bodyY + 4, 3, 4);
      ctx.fillRect(CX + 3, bodyY + 4, 3, 4);
    }

    // Head & Ballistic Helmet
    const headY = bodyY - 15;
    ellShaded(ctx, CX, headY, 8, 8, R_SKIN);
    ellShaded(ctx, CX, headY - 3, 10, 7, R_HELMET);

    // Clear Polycarbonate Face Shield Visor
    if (dir !== "N") {
      ctx.fillStyle = "rgba(56, 189, 248, 0.45)";
      ctx.fillRect(CX - 7, headY - 1, 14, 6);
      ctx.strokeStyle = "rgba(224, 242, 254, 0.8)";
      ctx.lineWidth = 1;
      ctx.strokeRect(CX - 7, headY - 1, 14, 6);
      // Glare highlight on visor
      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      ctx.fillRect(CX - 5, headY, 4, 2);
    }

    // Riot Shield (held on side/front)
    const shieldX = dir === "E" ? CX + 8 : CX - 12;
    const shieldY = bodyY - 8;
    // Shield border
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(shieldX, shieldY, 8, 20);
    // Transparent polycarbonate window
    ctx.fillStyle = "rgba(56, 189, 248, 0.5)";
    ctx.fillRect(shieldX + 1, shieldY + 3, 6, 6);
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 0.8;
    ctx.strokeRect(shieldX + 1, shieldY + 3, 6, 6);
    // Stencil bar
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(shieldX + 1, shieldY + 12, 6, 2);

    // Stun Baton (in other hand)
    const batonX = dir === "E" ? CX - 5 : CX + 9;
    const batonY = bodyY - 4;
    ellShaded(ctx, batonX, batonY, 2, 9, R_BATON);
    // Electric stun tip sparking
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(batonX - 2, batonY - 9, 4, 3);
    if (Math.sin(phase * 8) > 0) {
      figGlow(ctx, batonX, batonY - 8, 4, 18, 17);
    }
  };
}

function riotCopAttack(dir: Dir, t: number): FramePaint {
  return (ctx) => {
    riotCopFrame(dir, 0)(ctx);

    const bodyY = GROUND - 23;
    // Shield bash forward thrust + overhead baton strike
    const bashX = dir === "E" ? CX + 14 : CX - 14;
    const shieldY = bodyY - 8;

    // Projected shield bash shockwave
    ctx.fillStyle = "rgba(56, 189, 248, 0.7)";
    ctx.fillRect(bashX, shieldY - 2, 9, 24);
    ctx.strokeStyle = "#e0f2fe";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bashX, shieldY - 2, 9, 24);

    if (t > 0.2 && t < 0.8) {
      // Electric arc flash
      figGlow(ctx, bashX + 4, shieldY + 10, 8, 18, 17);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(bashX + 4, shieldY + 10, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  };
}

export function makeRiotCopPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [riotCopFrame(dir, 0), riotCopFrame(dir, 0.5)],
    walk: [
      riotCopFrame(dir, -0.75),
      riotCopFrame(dir, 0),
      riotCopFrame(dir, 0.75),
      riotCopFrame(dir, 0),
    ],
    attack: [riotCopAttack(dir, 0), riotCopAttack(dir, 0.5), riotCopAttack(dir, 1)],
    death: [
      riotCopFrame(dir, 0.5),
      riotCopFrame(dir, 0, true),
      riotCopFrame(dir, 0, true),
      riotCopFrame(dir, 0, true),
    ],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
