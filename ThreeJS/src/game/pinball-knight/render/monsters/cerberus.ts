/**
 * CERBERUS — The Three-Headed Hound of Hades.
 *
 * Procedural fallback cel-painter for Cerberus: massive dark stone-wolf quadruped
 * with three snarling heads, glowing molten eyes, razor fangs, and a spiked iron collar.
 */
import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  limbShaded,
  groundShadow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

// Palette ramps
const R_PELT: Ramp = [2, 3, 4];          // Obsidian / slate stone-dark hound body
const R_UNDER: Ramp = [1, 2, 3];         // Dark shadowy underbelly
const R_HACKLE: Ramp = [10, 11, 12];     // Molten red veins along spine hackles
const R_COLLAR: Ramp = [20, 21, 22];     // Spiked iron collar & chains
const R_EYE: Ramp = [14, 15, 18];        // Glowing molten gold/red eyes
const R_TOOTH: Ramp = [22, 23, 24];      // Bared steel razor fangs
const R_FIRE: Ramp = [8, 14, 15];        // Roaring flame breath particles

interface PoseOpts {
  lungeX?: number;
  lungeY?: number;
  mouthOpen?: boolean;
  thrashOffset?: number;
  walkPhase?: number;
  deathT?: number;
  dead?: boolean;
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  hx: number,
  hy: number,
  angle: number,
  mouthOpen: boolean,
  sizeScale = 1.0,
) {
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(angle);

  // Head base skull
  ellShaded(ctx, 0, 0, 11 * sizeScale, 8 * sizeScale, R_PELT);

  // Snout
  ellShaded(ctx, 0, 5 * sizeScale, 7 * sizeScale, 6 * sizeScale, R_PELT);

  // Ears
  ellShaded(ctx, -7 * sizeScale, -6 * sizeScale, 4 * sizeScale, 7 * sizeScale, R_HACKLE);
  ellShaded(ctx, 7 * sizeScale, -6 * sizeScale, 4 * sizeScale, 7 * sizeScale, R_HACKLE);

  // Glowing eyes
  ellShaded(ctx, -4 * sizeScale, -1 * sizeScale, 2.5 * sizeScale, 2.5 * sizeScale, R_EYE);
  ellShaded(ctx, 4 * sizeScale, -1 * sizeScale, 2.5 * sizeScale, 2.5 * sizeScale, R_EYE);

  // Muzzle / Jaws
  if (mouthOpen) {
    // Open jaws with sharp teeth
    ellShaded(ctx, 0, 7 * sizeScale, 6 * sizeScale, 4 * sizeScale, R_UNDER);
    // Upper fangs
    ellShaded(ctx, -3 * sizeScale, 6 * sizeScale, 1.5 * sizeScale, 3 * sizeScale, R_TOOTH);
    ellShaded(ctx, 3 * sizeScale, 6 * sizeScale, 1.5 * sizeScale, 3 * sizeScale, R_TOOTH);
    // Lower fangs
    ellShaded(ctx, -2 * sizeScale, 8 * sizeScale, 1.5 * sizeScale, 2.5 * sizeScale, R_TOOTH);
    ellShaded(ctx, 2 * sizeScale, 8 * sizeScale, 1.5 * sizeScale, 2.5 * sizeScale, R_TOOTH);
  } else {
    // Closed snarling mouth
    ellShaded(ctx, 0, 6 * sizeScale, 5 * sizeScale, 3 * sizeScale, R_UNDER);
    ellShaded(ctx, -2.5 * sizeScale, 6.5 * sizeScale, 1.5 * sizeScale, 2 * sizeScale, R_TOOTH);
    ellShaded(ctx, 2.5 * sizeScale, 6.5 * sizeScale, 1.5 * sizeScale, 2 * sizeScale, R_TOOTH);
  }

  ctx.restore();
}

function cerberusFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const {
      lungeX = 0,
      lungeY = 0,
      mouthOpen = false,
      thrashOffset = 0,
      walkPhase = 0,
      deathT = 0,
      dead = false,
    } = opts;

    if (dead || deathT > 0) {
      const t = Math.min(1, Math.max(0, deathT));
      const collapseY = GROUND - 10 + t * 7;
      groundShadow(ctx, CX, GROUND + 1, 30 * (1 + t * 0.2));

      // Crumbling collapsed body
      ellShaded(ctx, CX, collapseY, 24 * (1 - t * 0.3), 12 * (1 - t * 0.4), R_PELT);
      ellShaded(ctx, CX - 14, collapseY + 2, 8, 6, R_PELT);
      ellShaded(ctx, CX, collapseY + 1, 9, 7, R_PELT);
      ellShaded(ctx, CX + 14, collapseY + 3, 8, 6, R_PELT);
      return;
    }

    const bx = CX + lungeX + thrashOffset;
    const by = GROUND - 22 + lungeY;

    // Ground shadow
    groundShadow(ctx, bx, GROUND + 1, 28);

    // Hind legs
    const legSwing = Math.sin(walkPhase * Math.PI * 2);
    limbShaded(ctx, [bx - 14, by + 4], [bx - 16 + legSwing * 5, GROUND - 2], 5, R_UNDER, { rim: false });
    limbShaded(ctx, [bx + 14, by + 4], [bx + 16 - legSwing * 5, GROUND - 2], 5, R_UNDER, { rim: false });

    // Main torso
    ellShaded(ctx, bx, by + 2, 22, 14, R_PELT);

    // Spine hackle ridge
    ellShaded(ctx, bx, by - 6, 16, 5, R_HACKLE);

    // Fore legs
    limbShaded(ctx, [bx - 9, by + 8], [bx - 10 - legSwing * 6, GROUND - 2], 6, R_PELT, { rim: true });
    limbShaded(ctx, [bx + 9, by + 8], [bx + 10 + legSwing * 6, GROUND - 2], 6, R_PELT, { rim: true });

    // Spiked iron collar across chest
    ellShaded(ctx, bx, by - 4, 18, 5, R_COLLAR);
    for (let i = -12; i <= 12; i += 6) {
      ellShaded(ctx, bx + i, by - 7, 2, 3, R_TOOTH);
    }

    // Three Heads
    const bob = Math.sin(phase * Math.PI * 2) * 1.5;

    // Left Head
    drawHead(ctx, bx - 14, by - 12 + bob * 0.8, -0.28, mouthOpen, 0.9);

    // Right Head
    drawHead(ctx, bx + 14, by - 12 + bob * 0.8, 0.28, mouthOpen, 0.9);

    // Central Dominant Head (drawn last on top)
    drawHead(ctx, bx, by - 15 + bob, 0, mouthOpen, 1.15);

    // Fire breath flare particles if attacking/mouth wide open
    if (mouthOpen) {
      ellShaded(ctx, bx, by - 3, 4, 4, R_FIRE);
      ellShaded(ctx, bx - 14, by - 2, 3, 3, R_FIRE);
      ellShaded(ctx, bx + 14, by - 2, 3, 3, R_FIRE);
    }
  };
}

function makeDirectionalClips(dir: Dir) {
  return {
    idle: [
      cerberusFrame(dir, 0),
      cerberusFrame(dir, 0.5),
    ],
    walk: [
      cerberusFrame(dir, 0, { walkPhase: 0 }),
      cerberusFrame(dir, 0.25, { walkPhase: 0.25 }),
      cerberusFrame(dir, 0.5, { walkPhase: 0.5 }),
      cerberusFrame(dir, 0.75, { walkPhase: 0.75 }),
    ],
    attack: [
      cerberusFrame(dir, 0, { lungeY: -2, mouthOpen: false }),
      cerberusFrame(dir, 0.33, { lungeY: 3, mouthOpen: true }),
      cerberusFrame(dir, 0.66, { lungeY: 1, mouthOpen: true, thrashOffset: 3 }),
      cerberusFrame(dir, 1.0, { lungeY: 0, mouthOpen: false }),
    ],
    death: [
      cerberusFrame(dir, 0, { deathT: 0.2 }),
      cerberusFrame(dir, 0.33, { deathT: 0.5 }),
      cerberusFrame(dir, 0.66, { deathT: 0.8 }),
      cerberusFrame(dir, 1.0, { dead: true }),
    ],
  };
}

export function makeCerberusPaints(): ActorPaints {
  return {
    S: makeDirectionalClips("S"),
    N: makeDirectionalClips("N"),
    E: makeDirectionalClips("E"),
  };
}
