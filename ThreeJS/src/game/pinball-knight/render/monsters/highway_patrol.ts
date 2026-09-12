/**
 * HIGHWAY PATROL — State trooper motorcycle interceptor.
 *
 * Procedural fallback cel-painter parameterised by (dir, phase).
 * Features a tan uniform shirt, midnight blue breeches with gold side stripe,
 * tall polished riding boots, white trooper helmet with gold state seal,
 * dark aviator sunglasses, and an active flashing red/blue emergency siren beacon!
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
const R_SHIRT: Ramp = [26, 27, 28];       // Khaki / tan uniform shirt
const R_PANTS: Ramp = [21, 22, 23];       // Midnight navy riding breeches
const R_SKIN: Ramp = [23, 24, 25];        // Human skin tone
const R_BOOTS: Ramp = [0, 1, 2];          // Polished tall black leather boots
const R_HELMET: Ramp = [29, 30, 31];      // Crisp white motorcycle helmet

function highwayPatrolFrame(dir: Dir, phase: number, dead = false): FramePaint {
  return (ctx) => {
    if (dead) {
      groundShadow(ctx, CX, GROUND, 20);
      // Fallen trooper
      ellShaded(ctx, CX + 4, GROUND - 4, 18, 6, R_PANTS);
      ellShaded(ctx, CX - 8, GROUND - 6, 12, 7, R_SHIRT);
      // Dislodged white helmet with extinguished siren
      ellShaded(ctx, CX - 18, GROUND - 7, 7, 7, R_HELMET);
      ctx.fillStyle = "#64748b";
      ctx.fillRect(CX - 19, GROUND - 11, 4, 3);
      return;
    }

    const bob = Math.abs(Math.sin(phase * Math.PI)) * 2.5; // Brisk stride
    const bodyY = GROUND - 22 - bob;

    groundShadow(ctx, CX, GROUND, 16);

    // Riding breeches with gold side stripe & tall riding boots
    const legSwing = Math.sin(phase * Math.PI) * 4.5;
    // Left leg
    ellShaded(ctx, CX - 5 + legSwing, GROUND - 12, 4, 8, R_PANTS);
    ellShaded(ctx, CX - 5 + legSwing, GROUND - 5, 4, 6, R_BOOTS);
    // Right leg
    ellShaded(ctx, CX + 5 - legSwing, GROUND - 12, 4, 8, R_PANTS);
    ellShaded(ctx, CX + 5 - legSwing, GROUND - 5, 4, 6, R_BOOTS);

    // Gold lateral piping stripe on breeches
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(CX - 6 + legSwing, GROUND - 12, 1, 6);
    ctx.fillRect(CX + 6 - legSwing, GROUND - 12, 1, 6);

    // Leather Sam Browne belt & diagonal shoulder strap
    ctx.fillStyle = "#1e1b18";
    ctx.fillRect(CX - 8, bodyY + 6, 16, 3); // Belt
    ctx.fillRect(CX + 7, bodyY + 7, 3, 5); // Holster

    // Torso: Tan highway patrol uniform shirt
    ellShaded(ctx, CX, bodyY - 1, 10, 10, R_SHIRT);

    // Diagonal Sam Browne strap
    ctx.fillStyle = "#1e1b18";
    ctx.beginPath();
    ctx.moveTo(CX - 6, bodyY + 6);
    ctx.lineTo(CX - 3, bodyY + 6);
    ctx.lineTo(CX + 5, bodyY - 7);
    ctx.lineTo(CX + 2, bodyY - 7);
    ctx.closePath();
    ctx.fill();

    // Front details (gold badge, tie)
    if (dir !== "N") {
      // Dark brown tie
      ctx.fillStyle = "#292524";
      ctx.fillRect(CX - 1, bodyY - 6, 2, 8);

      // Gold trooper star badge
      const badgeX = dir === "E" ? CX + 4 : CX - 5;
      const badgeY = bodyY - 3;
      ctx.fillStyle = "#eab308";
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Head
    const headY = bodyY - 15;
    ellShaded(ctx, CX, headY, 7, 7, R_SKIN);

    // White Motorcycle Trooper Helmet
    ellShaded(ctx, CX, headY - 4, 9, 6, R_HELMET);
    // Black visor brim
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(CX - 8, headY - 1, 16, 2);

    // Emergency Flashing Siren Dome Beacon on Helmet
    const sirenRed = Math.sin(phase * 12) > 0;
    const sirenColor = sirenRed ? "#ef4444" : "#3b82f6";
    ctx.fillStyle = sirenColor;
    ctx.fillRect(CX - 3, headY - 10, 6, 4);
    // Beacon strobe glow
    figGlow(ctx, CX, headY - 9, 6, sirenRed ? 18 : 22, sirenRed ? 17 : 21);

    // Face details
    if (dir !== "N") {
      // Teardrop dark sunglasses
      const glassY = headY - 1;
      ctx.fillStyle = "#09090b";
      if (dir === "E") {
        ctx.fillRect(CX + 1, glassY, 5, 3);
      } else {
        ctx.fillRect(CX - 6, glassY, 5, 3);
        ctx.fillRect(CX + 1, glassY, 5, 3);
        ctx.fillRect(CX - 1, glassY, 2, 1);
      }
    }
  };
}

function highwayPatrolAttack(dir: Dir, t: number): FramePaint {
  return (ctx) => {
    highwayPatrolFrame(dir, 0)(ctx);

    const bodyY = GROUND - 22;
    // Dropping spike strip on ground
    const dropX = dir === "E" ? CX + 12 : CX - 12;
    const dropY = GROUND - 3;

    // Metallic spike strip unfolding
    ctx.fillStyle = "#334155";
    ctx.fillRect(dropX - 6, dropY, 14, 3);
    // Sharp metal teeth
    ctx.fillStyle = "#e2e8f0";
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(dropX - 5 + i * 3, dropY - 2, 2, 2);
    }

    // Siren alarm flare at attack trigger
    if (t > 0.2 && t < 0.8) {
      figGlow(ctx, CX, bodyY - 24, 10, 18, 17); // Red strobe flare
      figGlow(ctx, dropX, dropY, 5, 14, 13);
    }
  };
}

export function makeHighwayPatrolPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [highwayPatrolFrame(dir, 0), highwayPatrolFrame(dir, 0.5)],
    walk: [
      highwayPatrolFrame(dir, -0.75),
      highwayPatrolFrame(dir, 0),
      highwayPatrolFrame(dir, 0.75),
      highwayPatrolFrame(dir, 0),
    ],
    attack: [highwayPatrolAttack(dir, 0), highwayPatrolAttack(dir, 0.5), highwayPatrolAttack(dir, 1)],
    death: [
      highwayPatrolFrame(dir, 0.5),
      highwayPatrolFrame(dir, 0, true),
      highwayPatrolFrame(dir, 0, true),
      highwayPatrolFrame(dir, 0, true),
    ],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
