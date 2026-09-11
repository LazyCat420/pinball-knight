/**
 * COMPUTER SCREEN — a retro 1980s CRT computer monitor terminal.
 *
 * Placed in Level 4 mazes. Flashes with green matrix code and periodically emits
 * ASCII Binary Humans until destroyed by the player.
 *
 * Procedural fallback cel-painter parameterised by (dir, phase, opts).
 */
import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  detail as figDetail,
  glow as figGlow,
  groundShadow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

// Vintage Terminal Palette Ramps:
const R_BEIGE_CASE: Ramp = [14, 15, 16]; // Classic 80s computer chassis
const R_SCREEN_DARK: Ramp = [17, 18, 19]; // Dark CRT bezel
const R_GREEN_SCREEN: Ramp = [6, 7, 8];   // Phosphor green screen
const R_HIGHLIGHT: Ramp = [7, 8, 22];    // Bright electrical spark / cursor

interface PoseOpts {
  bob?: number;
  surge?: boolean;
  spark?: boolean;
  deathT?: number;
  dead?: boolean;
}

function computerScreenFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { bob = 0, surge = false, spark = false, deathT = 0, dead = false } = opts;

    if (dead || deathT > 0) {
      // Shattered, smoking broken computer chassis on the floor
      const t = Math.min(1, Math.max(0, deathT));
      const collapseY = GROUND - 4;

      groundShadow(ctx, CX, GROUND, 24);

      // Crushed keyboard base
      ctx.fillStyle = "#888880";
      ctx.fillRect(CX - 12, collapseY - 4, 24, 7);

      // Cracked / shattered screen frame
      ctx.fillStyle = "#555550";
      ctx.fillRect(CX - 10, collapseY - 14 + t * 4, 20, 10);

      // Electrical sparks & smoke puffs
      ctx.fillStyle = "#33FF33";
      ctx.font = "bold 8px monospace";
      ctx.fillText("*", CX - 8 - t * 4, collapseY - 16);
      ctx.fillText("*", CX + 6 + t * 4, collapseY - 14);

      ctx.fillStyle = "#aaaaaa";
      ctx.beginPath();
      ctx.arc(CX + 2, collapseY - 18 - t * 6, 4 + t * 3, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    groundShadow(ctx, CX, GROUND, 26);

    const basePadY = GROUND - 6 + bob;
    const monitorY = basePadY - 16;

    // Desktop chassis / keyboard base
    ctx.fillStyle = "#999990";
    ctx.fillRect(CX - 14, basePadY - 4, 28, 8);
    ctx.fillStyle = "#777770";
    ctx.fillRect(CX - 12, basePadY - 2, 24, 4); // keyboard keys indentation

    // Monitor Bezel (Chunky CRT case)
    ctx.fillStyle = "#aaaa9e";
    ctx.fillRect(CX - 13, monitorY - 4, 26, 17);
    ctx.fillStyle = "#77776d";
    ctx.strokeRect(CX - 13, monitorY - 4, 26, 17);

    // Screen Frame (Dark recessed bezel)
    ctx.fillStyle = "#222220";
    ctx.fillRect(CX - 10, monitorY - 1, 20, 12);

    // Phosphor Green CRT Screen
    const screenColor = surge ? "#55FF55" : spark ? "#88FFAA" : "#117722";
    ctx.fillStyle = screenColor;
    ctx.fillRect(CX - 9, monitorY, 18, 10);

    // Glowing green aura
    if (surge || spark) {
      figGlow(ctx, CX, monitorY + 5, 14, 7, 8);
    } else {
      figGlow(ctx, CX, monitorY + 5, 8, 6, 7);
    }

    // Scanlines & terminal code
    ctx.fillStyle = "#66FF66";
    ctx.font = "6px monospace";
    if (surge) {
      ctx.fillText("0 1 0 1", CX - 8, monitorY + 4);
      ctx.fillText("1 0 1 0", CX - 8, monitorY + 8);
    } else {
      ctx.fillRect(CX - 8, monitorY + 2, 12, 1);
      ctx.fillRect(CX - 8, monitorY + 5, 8, 1);
      // Blinking cursor
      if (Math.sin(phase * 12) > 0) {
        ctx.fillRect(CX + 2, monitorY + 5, 2, 2);
      }
    }

    // Sparks when active or damaged
    if (spark) {
      figDetail(ctx, [[CX - 11, monitorY - 2], [CX - 9, monitorY - 2]], 2, R_HIGHLIGHT);
      figDetail(ctx, [[CX + 9, monitorY + 2], [CX + 11, monitorY + 2]], 2, R_HIGHLIGHT);
    }
  };
}

export function makeComputerScreenPaints(): ActorPaints {
  const facings: Array<Dir> = ["S", "N", "E"];
  const out: Partial<ActorPaints> = {};

  for (const dir of facings) {
    out[dir] = {
      idle: [
        computerScreenFrame(dir, 0.0, { bob: 0 }),
        computerScreenFrame(dir, 0.25, { bob: 0 }),
        computerScreenFrame(dir, 0.5, { bob: 0 }),
        computerScreenFrame(dir, 0.75, { bob: 0 }),
      ],
      walk: [
        computerScreenFrame(dir, 0.0, { surge: true }),
        computerScreenFrame(dir, 0.25, { surge: false }),
        computerScreenFrame(dir, 0.5, { surge: true }),
        computerScreenFrame(dir, 0.75, { surge: false }),
      ],
      attack: [
        computerScreenFrame(dir, 0.0, { spark: true }),
        computerScreenFrame(dir, 0.33, { spark: false }),
        computerScreenFrame(dir, 0.66, { spark: true }),
        computerScreenFrame(dir, 1.0, { spark: false }),
      ],
      death: [
        computerScreenFrame(dir, 0.0, { deathT: 0.2 }),
        computerScreenFrame(dir, 0.33, { deathT: 0.5 }),
        computerScreenFrame(dir, 0.66, { deathT: 0.8 }),
        computerScreenFrame(dir, 1.0, { dead: true, deathT: 1.0 }),
      ],
    };
  }

  return out as ActorPaints;
}
