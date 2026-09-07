/**
 * THE SIX-ARMED INDIAN GOD (MAHADEVA ASURA) — radiant bronze skin, ornate golden
 * high mukut crown, third eye, six articulated arms wielding golden daggers,
 * and mouth roaring flame breath.
 *
 * Procedural fallback cel-painter parameterised by (dir, phase, opts).
 */
import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  limbShaded,
  plateShaded,
  groundShadow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

// Palette ramps
const R_BRONZE: Ramp = [16, 17, 24];     // Radiant bronze / terracotta skin
const R_GOLD: Ramp = [16, 17, 24];       // Ornate golden crown (mukut) & jewelry
const R_DHOTI: Ramp = [8, 9, 10];        // Rich crimson silk dhoti / sashes
const R_DAGGER: Ramp = [20, 21, 22];     // Gleaming golden daggers
const R_FIRE: Ramp = [8, 14, 15];        // Roaring orange-red flame breath

interface PoseOpts {
  hoverY?: number;
  flameLength?: number;
  flame?: boolean;
  armsRaised?: boolean;
  deathT?: number;
  dead?: boolean;
}

function sixArmedGodFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { hoverY = 0, flameLength = 0, flame = false, armsRaised = false, deathT = 0, dead = false } = opts;

    if (dead || deathT > 0) {
      const t = Math.min(1, Math.max(0, deathT));
      // Divine collapse: torso crumbles into golden stone pedestal fragments
      const collapseY = GROUND - 8 + t * 6;
      groundShadow(ctx, CX, GROUND + 1, 24 * (1 + t * 0.2));

      // Shaded bronze torso fragments
      ellShaded(ctx, CX - 10 * (1 + t * 0.5), collapseY + 2, 14 * (1 - t * 0.4), 8, R_BRONZE);
      ellShaded(ctx, CX + 10 * (1 + t * 0.5), collapseY + 3, 14 * (1 - t * 0.4), 8, R_BRONZE);

      // Shaded golden crown / remnant
      ellShaded(ctx, CX, collapseY - 2, 16 * (1 - t * 0.5), 10 * (1 - t * 0.5), R_GOLD);

      // Resting golden daggers
      limbShaded(ctx, [CX - 18, GROUND - 2], [CX - 8, GROUND - 2], 5, R_DAGGER, { rim: false });
      limbShaded(ctx, [CX + 8, GROUND - 2], [CX + 18, GROUND - 2], 5, R_DAGGER, { rim: false });
      return;
    }

    const baseY = GROUND - 14 + hoverY;

    // Levitation shadow
    groundShadow(ctx, CX, GROUND + 1, 22);

    // Flowing celestial crimson sashes (behind torso)
    const sashSway = Math.sin(phase * Math.PI * 2) * 3;
    limbShaded(ctx, [CX - 12, baseY + 4], [CX - 20 + sashSway, baseY + 18], 7, R_DHOTI, { rim: false });
    limbShaded(ctx, [CX + 12, baseY + 4], [CX + 20 - sashSway, baseY + 18], 7, R_DHOTI, { rim: false });

    // Legs / Dhoti in crossed lotus hovering posture
    ellShaded(ctx, CX, baseY + 12, 18, 10, R_DHOTI);
    ellShaded(ctx, CX - 8, baseY + 14, 8, 6, R_BRONZE);
    ellShaded(ctx, CX + 8, baseY + 14, 8, 6, R_BRONZE);

    // Muscular bronze torso
    ellShaded(ctx, CX, baseY + 2, 16, 14, R_BRONZE);

    // Golden chest ornament
    ellShaded(ctx, CX, baseY - 2, 8, 6, R_GOLD);

    // ── SIX ARMS (drawn with limbShaded to guarantee clean quantization runs) ──
    const armWobble = Math.sin(phase * Math.PI * 2) * 2;

    if (armsRaised) {
      // Upper pair (raised high overhead)
      limbShaded(ctx, [CX - 8, baseY - 4], [CX - 18, baseY - 18], 6, R_BRONZE);
      limbShaded(ctx, [CX + 8, baseY - 4], [CX + 18, baseY - 18], 6, R_BRONZE);
      limbShaded(ctx, [CX - 18, baseY - 18], [CX - 18, baseY - 28], 5, R_DAGGER);
      limbShaded(ctx, [CX + 18, baseY - 18], [CX + 18, baseY - 28], 5, R_DAGGER);

      // Middle pair (flared outward)
      limbShaded(ctx, [CX - 10, baseY + 2], [CX - 22, baseY - 2], 6, R_BRONZE);
      limbShaded(ctx, [CX + 10, baseY + 2], [CX + 22, baseY - 2], 6, R_BRONZE);
      limbShaded(ctx, [CX - 22, baseY - 2], [CX - 30, baseY - 2], 5, R_DAGGER);
      limbShaded(ctx, [CX + 22, baseY - 2], [CX + 30, baseY - 2], 5, R_DAGGER);

      // Lower pair (thrust forward)
      limbShaded(ctx, [CX - 8, baseY + 6], [CX - 18, baseY + 8], 6, R_BRONZE);
      limbShaded(ctx, [CX + 8, baseY + 6], [CX + 18, baseY + 8], 6, R_BRONZE);
      limbShaded(ctx, [CX - 18, baseY + 8], [CX - 26, baseY + 8], 5, R_DAGGER);
      limbShaded(ctx, [CX + 18, baseY + 8], [CX + 26, baseY + 8], 5, R_DAGGER);
    } else {
      // Upper pair poised
      limbShaded(ctx, [CX - 8, baseY - 4], [CX - 16, baseY - 12 + armWobble], 6, R_BRONZE);
      limbShaded(ctx, [CX + 8, baseY - 4], [CX + 16, baseY - 12 - armWobble], 6, R_BRONZE);
      limbShaded(ctx, [CX - 16, baseY - 12 + armWobble], [CX - 16, baseY - 22 + armWobble], 5, R_DAGGER);
      limbShaded(ctx, [CX + 16, baseY - 12 - armWobble], [CX + 16, baseY - 22 - armWobble], 5, R_DAGGER);

      // Middle pair poised
      limbShaded(ctx, [CX - 10, baseY + 2], [CX - 18, baseY + armWobble], 6, R_BRONZE);
      limbShaded(ctx, [CX + 10, baseY + 2], [CX + 18, baseY - armWobble], 6, R_BRONZE);
      limbShaded(ctx, [CX - 18, baseY + armWobble], [CX - 26, baseY + armWobble], 5, R_DAGGER);
      limbShaded(ctx, [CX + 18, baseY - armWobble], [CX + 26, baseY - armWobble], 5, R_DAGGER);

      // Lower pair poised
      limbShaded(ctx, [CX - 8, baseY + 6], [CX - 15, baseY + 8 + armWobble], 6, R_BRONZE);
      limbShaded(ctx, [CX + 8, baseY + 6], [CX + 15, baseY + 8 - armWobble], 6, R_BRONZE);
      limbShaded(ctx, [CX - 15, baseY + 8 + armWobble], [CX - 22, baseY + 8 + armWobble], 5, R_DAGGER);
      limbShaded(ctx, [CX + 15, baseY + 8 - armWobble], [CX + 22, baseY + 8 - armWobble], 5, R_DAGGER);
    }

    // Head
    ellShaded(ctx, CX, baseY - 10, 12, 12, R_BRONZE);

    // Ornate Golden High Mukut Crown
    plateShaded(ctx, [
      [CX - 8, baseY - 14],
      [CX - 6, baseY - 26],
      [CX, baseY - 30],
      [CX + 6, baseY - 26],
      [CX + 8, baseY - 14]
    ], R_GOLD);

    // Third eye glowing jewel
    ellShaded(ctx, CX, baseY - 13, 4, 4, R_GOLD);

    // Mouth / Flame Breath
    if (flame) {
      const fReach = flameLength || 18;
      // Roaring cone of flame
      plateShaded(ctx, [
        [CX - 4, baseY - 5],
        [CX - 10, baseY + fReach * 0.5],
        [CX - 6, baseY + fReach],
        [CX + 6, baseY + fReach],
        [CX + 10, baseY + fReach * 0.5],
        [CX + 4, baseY - 5]
      ], R_FIRE);
    }
  };
}

function makeDirectionalClips(dir: Dir) {
  return {
    idle: [
      sixArmedGodFrame(dir, 0.0, { hoverY: 0 }),
      sixArmedGodFrame(dir, 0.25, { hoverY: -1 }),
      sixArmedGodFrame(dir, 0.5, { hoverY: -2 }),
      sixArmedGodFrame(dir, 0.75, { hoverY: -1 }),
    ],
    walk: [
      sixArmedGodFrame(dir, 0.0, { hoverY: 0 }),
      sixArmedGodFrame(dir, 0.25, { hoverY: -2 }),
      sixArmedGodFrame(dir, 0.5, { hoverY: -3 }),
      sixArmedGodFrame(dir, 0.75, { hoverY: -1 }),
    ],
    attack: [
      sixArmedGodFrame(dir, 0.0, { hoverY: -1, armsRaised: true }),
      sixArmedGodFrame(dir, 0.33, { hoverY: -3, armsRaised: true, flame: true, flameLength: 14 }),
      sixArmedGodFrame(dir, 0.66, { hoverY: -3, armsRaised: true, flame: true, flameLength: 22 }),
      sixArmedGodFrame(dir, 1.0, { hoverY: -1, armsRaised: true, flame: true, flameLength: 16 }),
    ],
    death: [
      sixArmedGodFrame(dir, 0.0, { deathT: 0.25 }),
      sixArmedGodFrame(dir, 0.33, { deathT: 0.50 }),
      sixArmedGodFrame(dir, 0.66, { deathT: 0.75 }),
      sixArmedGodFrame(dir, 1.0, { deathT: 1.00, dead: true }),
    ],
  };
}

export function makeSixArmedGodPaints(): ActorPaints {
  return {
    S: makeDirectionalClips("S"),
    N: makeDirectionalClips("N"),
    E: makeDirectionalClips("E"),
  };
}
