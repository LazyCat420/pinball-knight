/**
 * THE SIX-ARMED INDIAN GOD (MAHADEVA ASURA) — radiant bronze skin, ornate golden
 * high mukut crown, third eye, six articulated arms wielding golden daggers,
 * and mouth roaring flame breath.
 *
 * Procedural fallback cel-painter parameterised by (dir, phase, pose).
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
const R_BRONZE: Ramp = [16, 17, 24];     // Radiant bronze / terracotta skin
const R_BRONZE_DK: Ramp = [1, 26, 27];   // Bronze shadow
const R_GOLD: Ramp = [16, 17, 24];       // Ornate golden crown (mukut) & jewelry
const R_DHOTI: Ramp = [8, 9, 10];        // Rich crimson silk dhoti / sashes
const R_DAGGER: Ramp = [20, 21, 22];     // Gleaming steel / golden blades
const R_FIRE: Ramp = [8, 14, 15];        // Roaring orange-red flame breath

interface PoseOpts {
  hoverY?: number;       // Levitation bob
  flameLength?: number;  // Mouth fire breath reach
  flame?: boolean;       // Mouth open breathing fire
  armsRaised?: boolean;  // 6 arms raised throwing daggers
  crumble?: number;      // Death crumble progression
  dead?: boolean;
}

function sixArmedGodFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { hoverY = 0, flameLength = 0, flame = false, armsRaised = false, crumble = 0, dead = false } = opts;

    if (dead) {
      // Divine light cracks open torso, crumbling into glowing stone fragments
      groundShadow(ctx, CX, GROUND + 1, 18);
      const spread = crumble * 6;
      const lift = (1 - crumble) * 6;
      // Fragments fall and spread across all four authored death frames.
      plateShaded(ctx, [[CX - 14 - spread, GROUND - 4 - lift], [CX - 6 - spread, GROUND - 14 - lift], [CX + 2 - spread, GROUND - 8 - lift], [CX - 6 - spread, GROUND - 2 - lift]], R_BRONZE_DK, { bounce: false });
      plateShaded(ctx, [[CX + 4 + spread, GROUND - 3 - lift], [CX + 12 + spread, GROUND - 16 - lift], [CX + 18 + spread, GROUND - 6 - lift]], R_BRONZE, { bounce: false });
      // Scattered golden daggers
      figDetail(ctx, [[CX - 18, GROUND - 3], [CX - 10, GROUND - 2]], 1.5, 21);
      figDetail(ctx, [[CX + 14, GROUND - 2], [CX + 22, GROUND - 3]], 1.5, 21);
      // Divine embers / sparks
      figGlow(ctx, CX - 2, GROUND - 10, 4, 15);
      figGlow(ctx, CX + 8, GROUND - 12, 4, 15);
      return;
    }

    const baseY = GROUND - 12 + hoverY;

    // Levitation shadow
    groundShadow(ctx, CX, GROUND + 1, 16);

    // Floating celestial crimson sashes (behind torso)
    const sashSway = Math.sin(phase * Math.PI * 2) * 3;
    plateShaded(ctx, [
      [CX - 16, baseY + 6],
      [CX - 22 + sashSway, baseY + 18],
      [CX - 14 + sashSway, baseY + 20],
      [CX - 10, baseY + 10]
    ], R_DHOTI, { bounce: false });
    plateShaded(ctx, [
      [CX + 10, baseY + 10],
      [CX + 14 - sashSway, baseY + 20],
      [CX + 22 - sashSway, baseY + 18],
      [CX + 16, baseY + 6]
    ], R_DHOTI, { bounce: false });

    // Legs / Dhoti in crossed/hovering posture
    ellShaded(ctx, CX, baseY + 12, 14, 8, R_DHOTI);
    ellShaded(ctx, CX - 6, baseY + 16, 5, 4, R_BRONZE);
    ellShaded(ctx, CX + 6, baseY + 16, 5, 4, R_BRONZE);

    // Muscular bronze torso
    plateShaded(ctx, [
      [CX - 10, baseY - 6],
      [CX + 10, baseY - 6],
      [CX + 7, baseY + 10],
      [CX - 7, baseY + 10]
    ], R_BRONZE, { bounce: false });

    // Golden necklace / chest ornaments
    figDetail(ctx, [[CX - 6, baseY - 2], [CX, baseY + 2], [CX + 6, baseY - 2]], 1.5, 17);

    // Suppress thin edge lighting on these small plates so six arms stay
    // readable after the pixel-grid downsample.
    // ── SIX ARMS ──
    const armWobble = Math.sin(phase * Math.PI * 2) * 2;

    if (armsRaised) {
      // Upper arms raised high
      plateShaded(ctx, [[CX - 9, baseY - 4], [CX - 18, baseY - 16], [CX - 14, baseY - 18], [CX - 7, baseY - 6]], R_BRONZE, { rim: false, bounce: false });
      plateShaded(ctx, [[CX + 7, baseY - 6], [CX + 14, baseY - 18], [CX + 18, baseY - 16], [CX + 9, baseY - 4]], R_BRONZE, { rim: false, bounce: false });
      // Middle arms flared outward
      plateShaded(ctx, [[CX - 9, baseY], [CX - 22, baseY - 4], [CX - 20, baseY - 8], [CX - 8, baseY - 2]], R_BRONZE, { rim: false, bounce: false });
      plateShaded(ctx, [[CX + 8, baseY - 2], [CX + 20, baseY - 8], [CX + 22, baseY - 4], [CX + 9, baseY]], R_BRONZE, { rim: false, bounce: false });
      // Lower arms forward-pointing
      plateShaded(ctx, [[CX - 8, baseY + 4], [CX - 18, baseY + 6], [CX - 16, baseY + 2], [CX - 7, baseY + 2]], R_BRONZE, { rim: false, bounce: false });
      plateShaded(ctx, [[CX + 7, baseY + 2], [CX + 16, baseY + 2], [CX + 18, baseY + 6], [CX + 8, baseY + 4]], R_BRONZE, { rim: false, bounce: false });

      // Golden daggers in all 6 hands
      figDetail(ctx, [[CX - 16, baseY - 24], [CX - 16, baseY - 16]], 2, 21);
      figDetail(ctx, [[CX + 16, baseY - 24], [CX + 16, baseY - 16]], 2, 21);
      figDetail(ctx, [[CX - 28, baseY - 6], [CX - 20, baseY - 6]], 2, 21);
      figDetail(ctx, [[CX + 20, baseY - 6], [CX + 28, baseY - 6]], 2, 21);
      figDetail(ctx, [[CX - 24, baseY + 6], [CX - 16, baseY + 6]], 2, 21);
      figDetail(ctx, [[CX + 16, baseY + 6], [CX + 24, baseY + 6]], 2, 21);
    } else {
      // Normal majestic stance with 6 arms poised
      plateShaded(ctx, [[CX - 9, baseY - 4], [CX - 16, baseY - 12 + armWobble], [CX - 13, baseY - 14 + armWobble], [CX - 7, baseY - 6]], R_BRONZE, { rim: false, bounce: false });
      plateShaded(ctx, [[CX + 7, baseY - 6], [CX + 13, baseY - 14 - armWobble], [CX + 16, baseY - 12 - armWobble], [CX + 9, baseY - 4]], R_BRONZE, { rim: false, bounce: false });

      plateShaded(ctx, [[CX - 9, baseY], [CX - 18, baseY - 2 + armWobble], [CX - 16, baseY - 5 + armWobble], [CX - 8, baseY - 2]], R_BRONZE, { rim: false, bounce: false });
      plateShaded(ctx, [[CX + 8, baseY - 2], [CX + 16, baseY - 5 - armWobble], [CX + 18, baseY - 2 - armWobble], [CX + 9, baseY]], R_BRONZE, { rim: false, bounce: false });

      plateShaded(ctx, [[CX - 8, baseY + 4], [CX - 15, baseY + 8 + armWobble], [CX - 13, baseY + 5 + armWobble], [CX - 7, baseY + 2]], R_BRONZE, { rim: false, bounce: false });
      plateShaded(ctx, [[CX + 7, baseY + 2], [CX + 13, baseY + 5 - armWobble], [CX + 15, baseY + 8 - armWobble], [CX + 8, baseY + 4]], R_BRONZE, { rim: false, bounce: false });

      // Golden daggers poised in hands
      figDetail(ctx, [[CX - 14, baseY - 20 + armWobble], [CX - 14, baseY - 12 + armWobble]], 1.5, 21);
      figDetail(ctx, [[CX + 14, baseY - 20 - armWobble], [CX + 14, baseY - 12 - armWobble]], 1.5, 21);
      figDetail(ctx, [[CX - 24, baseY - 4 + armWobble], [CX - 16, baseY - 4 + armWobble]], 1.5, 21);
      figDetail(ctx, [[CX + 16, baseY - 4 - armWobble], [CX + 24, baseY - 4 - armWobble]], 1.5, 21);
      figDetail(ctx, [[CX - 21, baseY + 8 + armWobble], [CX - 13, baseY + 8 + armWobble]], 1.5, 21);
      figDetail(ctx, [[CX + 13, baseY + 8 - armWobble], [CX + 21, baseY + 8 - armWobble]], 1.5, 21);
    }

    // Head
    ellShaded(ctx, CX, baseY - 12, 7, 7, R_BRONZE);

    // Ornate Golden High Mukut Crown
    plateShaded(ctx, [
      [CX - 8, baseY - 16],
      [CX - 5, baseY - 26],
      [CX, baseY - 29],
      [CX + 5, baseY - 26],
      [CX + 8, baseY - 16]
    ], R_GOLD, { bounce: false });
    figGlow(ctx, CX, baseY - 24, 3, 17);

    // Third eye glowing on forehead
    figGlow(ctx, CX, baseY - 14, 2, 14);

    // Mouth / Flame Breath
    if (flame) {
      // Unhinged mouth glowing with flame core
      figGlow(ctx, CX, baseY - 8, 3, 15);
      // Stream of roaring fire breath shooting forward
      const fReach = flameLength || 18;
      plateShaded(ctx, [
        [CX - 3, baseY - 8],
        [CX - 8, baseY + fReach * 0.5],
        [CX - 4, baseY + fReach],
        [CX + 4, baseY + fReach],
        [CX + 8, baseY + fReach * 0.5],
        [CX + 3, baseY - 8]
      ], R_FIRE, { bounce: false });
      figGlow(ctx, CX, baseY + fReach * 0.6, 5, 15);
    } else {
      // Stern mouth
      figDetail(ctx, [[CX - 2, baseY - 8], [CX + 2, baseY - 8]], 1, 1);
    }
  };
}

function deathFrames(dir: Dir): FramePaint[] {
  return [0.2, 0.5, 0.8, 1].map((crumble, i) =>
    sixArmedGodFrame(dir, i / 3, { dead: true, crumble }));
}

export function makeSixArmedGodPaints(): ActorPaints {
  return {
    S: {
      idle: [
        sixArmedGodFrame("S", 0.0, { hoverY: 0 }),
        sixArmedGodFrame("S", 0.25, { hoverY: -1 }),
        sixArmedGodFrame("S", 0.5, { hoverY: -2 }),
        sixArmedGodFrame("S", 0.75, { hoverY: -1 }),
      ],
      walk: [
        sixArmedGodFrame("S", 0.0, { hoverY: 0 }),
        sixArmedGodFrame("S", 0.25, { hoverY: -2 }),
        sixArmedGodFrame("S", 0.5, { hoverY: -3 }),
        sixArmedGodFrame("S", 0.75, { hoverY: -1 }),
      ],
      attack: [
        sixArmedGodFrame("S", 0.0, { hoverY: -1, armsRaised: true }),
        sixArmedGodFrame("S", 0.33, { hoverY: -3, armsRaised: true, flame: true, flameLength: 14 }),
        sixArmedGodFrame("S", 0.66, { hoverY: -3, armsRaised: true, flame: true, flameLength: 22 }),
        sixArmedGodFrame("S", 1.0, { hoverY: -1, armsRaised: true, flame: true, flameLength: 16 }),
      ],
      death: deathFrames("S"),
    },
    N: {
      idle: [sixArmedGodFrame("N", 0.0, { hoverY: 0 })],
      walk: [sixArmedGodFrame("N", 0.0, { hoverY: -1 })],
      attack: [sixArmedGodFrame("N", 0.5, { hoverY: -2, armsRaised: true })],
      death: deathFrames("N"),
    },
    E: {
      idle: [sixArmedGodFrame("E", 0.0, { hoverY: 0 })],
      walk: [sixArmedGodFrame("E", 0.0, { hoverY: -1 })],
      attack: [sixArmedGodFrame("E", 0.5, { hoverY: -2, armsRaised: true, flame: true, flameLength: 18 })],
      death: deathFrames("E"),
    },
  };
}
