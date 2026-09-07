/**
 * LAWNMOWER PIPE GNOME — an eccentric garden gnome with a pointed red hat,
 * bushy white beard, and wooden tobacco pipe, aggressively pushing a rotary
 * push lawnmower into battle.
 *
 * Procedural fallback cel-painter parameterised by (dir, phase, pose).
 * - Idle/Walk: Strides forward pushing the mower, pipe smoking rings of smoke.
 * - Attack: Leans forward revving the mower blades in a metallic blur, spewing
 *   grass clippings and friction sparks.
 * - Death: Lawnmower backfires and gnome instantly poofs into an expanding cloud
 *   of white/grey cartoon smoke, vanishing into thin air.
 */
import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  plateShaded,
  detail as figDetail,
  glow as figGlow,
  groundShadow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

// Palette ramps
const R_HAT: Ramp = [2, 3, 4];         // Bright red pointy hat
const R_COAT: Ramp = [5, 6, 7];        // Blue tunic / coat
const R_BEARD: Ramp = [20, 21, 22];    // White / grey bushy beard
const R_SKIN: Ramp = [23, 24, 25];     // Peach skin tone / round nose
const R_BOOTS: Ramp = [26, 27, 28];    // Brown leather boots
const R_PIPE: Ramp = [26, 27, 28];     // Dark briar wood pipe
const R_SMOKE: Ramp = [20, 21, 22];    // White / light grey cartoon smoke puffs
const R_MOWER: Ramp = [9, 10, 11];     // Green lawnmower deck
const R_STEEL: Ramp = [19, 20, 21];    // Steel cutter blades / mower handle
const R_TIRE: Ramp = [1, 19, 20];      // Black rubber mower wheels

interface PoseOpts {
  mowerRev?: boolean;  // blades whirring with sparks & grass clippings
  pipePuff?: number;   // smoke ring radius
  poofT?: number;      // 0..1 death smoke poof expansion
  dead?: boolean;
}

function gnomeFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { mowerRev = false, pipePuff = 0, poofT = 0, dead = false } = opts;

    if (dead) {
      // Expanding cartoon smoke poof cloud ("POOF!") dissolving into thin air
      const radius = 12 + (poofT || 0.5) * 16;
      groundShadow(ctx, CX, GROUND + 1, Math.max(0, 22 - (poofT || 0.5) * 18));

      // Layered billowy smoke circles
      ellShaded(ctx, CX - 6, GROUND - 14, radius * 0.8, radius * 0.65, R_SMOKE);
      ellShaded(ctx, CX + 8, GROUND - 18, radius * 0.75, radius * 0.6, R_SMOKE);
      ellShaded(ctx, CX, GROUND - 22, radius * 0.9, radius * 0.75, R_SMOKE);
      ellShaded(ctx, CX - 10, GROUND - 24, radius * 0.6, radius * 0.5, R_SMOKE);
      ellShaded(ctx, CX + 10, GROUND - 10, radius * 0.5, radius * 0.45, R_SMOKE);

      // Dissolving smoke spirals / cartoon stars
      figDetail(ctx, [[CX - 12, GROUND - 28], [CX - 8, GROUND - 32]], 1.5, 21);
      figDetail(ctx, [[CX + 14, GROUND - 26], [CX + 18, GROUND - 30]], 1.5, 21);
      figGlow(ctx, CX, GROUND - 18, 3.0, 17, 16);
      return;
    }

    const bob = Math.abs(Math.sin(phase * Math.PI)) * 2;
    const narrow = dir === "E" ? 0.9 : 1.0;
    groundShadow(ctx, CX, GROUND + 1, 18 * narrow);

    const gnomeX = dir === "E" ? CX - 8 : CX - 6;
    const gnomeY = GROUND - 16 - bob;
    const mowerX = dir === "E" ? CX + 12 : CX + 10;
    const mowerY = GROUND - 8;

    // ── 1. LAWNMOWER ──
    // Front and rear wheels
    ellShaded(ctx, mowerX - 8, mowerY + 5, 4, 4, R_TIRE);
    ellShaded(ctx, mowerX + 8, mowerY + 5, 4, 4, R_TIRE);
    // Green mower deck
    ellShaded(ctx, mowerX, mowerY + 2, 14, 5, R_MOWER);
    // Motor block
    plateShaded(
      ctx,
      [
        [mowerX - 5, mowerY + 1],
        [mowerX - 4, mowerY - 6],
        [mowerX + 4, mowerY - 6],
        [mowerX + 5, mowerY + 1],
      ],
      R_STEEL,
    );
    // Handlebar tubes connecting mower deck back to gnome's hands
    figDetail(ctx, [[mowerX - 4, mowerY - 2], [gnomeX + 4, gnomeY + 2]], 2.0, 20);
    figDetail(ctx, [[mowerX - 2, mowerY - 2], [gnomeX + 6, gnomeY + 3]], 2.0, 20);

    // Whirring blade sparks and grass clippings if revving/attacking
    if (mowerRev) {
      // Yellow blade sparks
      figGlow(ctx, mowerX + 6, mowerY + 2, 4.0, 16, 17);
      figGlow(ctx, mowerX + 10, mowerY - 1, 3.0, 16, 17);
      // Green grass clippings flying out of chute
      for (let i = 0; i < 4; i++) {
        const gx = mowerX + 8 + (i % 2) * 5;
        const gy = mowerY - 2 - i * 3;
        figDetail(ctx, [[gx, gy], [gx + 2, gy - 2]], 1.5, 10);
      }
    }

    // ── 2. GNOME BODY & CLOTHES ──
    // Boots
    ellShaded(ctx, gnomeX - 4, GROUND - 2, 4, 3, R_BOOTS);
    ellShaded(ctx, gnomeX + 3, GROUND - 2, 4, 3, R_BOOTS);
    // Blue coat tunic
    ellShaded(ctx, gnomeX, gnomeY + 4, 9, 8, R_COAT);
    // Bushy white beard
    ellShaded(ctx, gnomeX + 2, gnomeY - 1, 8, 7, R_BEARD);
    // Peach nose & cheeks
    ellShaded(ctx, gnomeX + 4, gnomeY - 5, 4, 3.5, R_SKIN);
    // Red pointy conical hat
    plateShaded(
      ctx,
      [
        [gnomeX - 7, gnomeY - 7],
        [gnomeX + 7, gnomeY - 7],
        [gnomeX - 1, gnomeY - 24],
      ],
      R_HAT,
    );

    // ── 3. WOODEN PIPE & SMOKE RINGS ──
    // Pipe bowl and stem clenched in mouth
    const pipeX = gnomeX + 8;
    const pipeY = gnomeY - 4;
    figDetail(ctx, [[gnomeX + 4, pipeY], [pipeX, pipeY]], 1.8, 27);
    ellShaded(ctx, pipeX + 1, pipeY - 2, 2.5, 3, R_PIPE);
    // Glowing pipe ember
    figGlow(ctx, pipeX + 1, pipeY - 3, 1.2, 3, 4);

    // Cartoon smoke puff floating up from pipe
    const smokeSize = 3 + (pipePuff || 0);
    ellShaded(ctx, pipeX + 3, pipeY - 8 - bob, smokeSize, smokeSize * 0.8, R_SMOKE);
    ellShaded(ctx, pipeX + 6, pipeY - 14 - bob, smokeSize * 1.2, smokeSize, R_SMOKE);
  };
}

function dirClips(dir: Dir): Partial<Record<string, FramePaint[]>> {
  return {
    idle: [
      gnomeFrame(dir, 0.0, { pipePuff: 0 }),
      gnomeFrame(dir, 0.25, { pipePuff: 0.5 }),
      gnomeFrame(dir, 0.5, { pipePuff: 1.0 }),
      gnomeFrame(dir, 0.75, { pipePuff: 0.5 }),
    ],
    walk: [
      gnomeFrame(dir, 0.0, { pipePuff: 0.5 }),
      gnomeFrame(dir, 0.25, { pipePuff: 0.8 }),
      gnomeFrame(dir, 0.5, { pipePuff: 1.0 }),
      gnomeFrame(dir, 0.75, { pipePuff: 0.8 }),
    ],
    attack: [
      gnomeFrame(dir, 0.0, { mowerRev: true }),
      gnomeFrame(dir, 0.3, { mowerRev: true }),
      gnomeFrame(dir, 0.6, { mowerRev: true }),
      gnomeFrame(dir, 0.9, { mowerRev: true }),
    ],
    death: [
      gnomeFrame(dir, 0.0, { dead: true, poofT: 0.2 }),
      gnomeFrame(dir, 0.3, { dead: true, poofT: 0.5 }),
      gnomeFrame(dir, 0.6, { dead: true, poofT: 0.8 }),
      gnomeFrame(dir, 1.0, { dead: true, poofT: 1.0 }),
    ],
  };
}

export function makeGnomePaints(): ActorPaints {
  return {
    S: dirClips("S") as any,
    N: dirClips("N") as any,
    E: dirClips("E") as any,
  };
}
