/**
 * DRACULA — Count Dracula Monster ("The Vampire Lord").
 *
 * Procedural fallback cel-painter for Count Dracula:
 * - High-collared gothic midnight-black cape with blood-red silk lining.
 * - Pale vampire aristocratic face, sharp fangs, ruby glowing eyes, black widow's peak.
 * - Victorian midnight waistcoat with gold buttons and crisp white ascot.
 * - Blood siphon attack pose: flared cape, raised clawed hands with crimson energy motes.
 * - Death pose: collapses into shadowy crimson vortex as bats scatter.
 */
import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  groundShadow,
  rrectShaded,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

// Palette ramps
const R_CAPE: Ramp = [1, 2, 3];          // Midnight black / deep charcoal
const R_LINING: Ramp = [16, 17, 18];     // Blood crimson / velvet red lining
const R_SKIN: Ramp = [13, 14, 15];       // Pale vampire flesh
const R_VEST: Ramp = [2, 3, 4];          // Charcoal tailored vest
const R_CRAVAT: Ramp = [14, 15, 15];     // Crisp white ascot cravat
const R_GOLD: Ramp = [27, 28, 29];       // Gold buttons & chain
const R_EYES: Ramp = [17, 18, 18];       // Glowing crimson ruby eyes
const R_HAIR: Ramp = [0, 1, 2];          // Jet black widow's peak hair
const R_VORTEX: Ramp = [16, 17, 18];     // Crimson shadows / bats

interface PoseOpts {
  drainPhase?: number; // 0 (idle) .. 1 (full siphon channel)
  bob?: number;
  deathT?: number;
  dead?: boolean;
}

function draculaFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const {
      drainPhase = 0,
      bob = 0,
      deathT = 0,
      dead = false,
    } = opts;

    if (dead || deathT > 0) {
      // Swirling mist vortex and bat dispersal
      const t = Math.min(1, Math.max(0, deathT));
      groundShadow(ctx, CX, GROUND, 16 * (1 - t * 0.5));

      // Dissolving shadow pool
      ellShaded(ctx, CX, GROUND - 3, 14 * (1 - t * 0.4), 6 * (1 - t * 0.4), R_CAPE);
      ellShaded(ctx, CX, GROUND - 5, 10 * (1 - t * 0.5), 4 * (1 - t * 0.5), R_LINING);

      // Bats dispersing upward
      const batLift = t * 24;
      ellShaded(ctx, CX - 8 - t * 6, GROUND - 12 - batLift, 4, 2, R_CAPE);
      ellShaded(ctx, CX + 8 + t * 6, GROUND - 16 - batLift * 1.2, 4, 2, R_CAPE);
      ellShaded(ctx, CX + (t * 4 - 2), GROUND - 22 - batLift * 1.4, 5, 2.5, R_CAPE);
      return;
    }

    const walkBob = Math.sin(phase * Math.PI * 2) * 2 + bob;
    const bodyY = GROUND - 16 + walkBob;
    const flare = drainPhase > 0 ? 5 : 0;

    groundShadow(ctx, CX, GROUND, 18 + flare);

    // ── Flowing Cape (Back layer) ──
    // Midnight cape silhouette behind torso
    rrectShaded(ctx, CX - 10 - flare, bodyY - 4, 20 + flare * 2, 18, 3, R_CAPE);
    // Crimson velvet lining peeking inside
    rrectShaded(ctx, CX - 7 - flare, bodyY, 14 + flare * 2, 14, 2, R_LINING);

    // High pointed gothic collar
    ellShaded(ctx, CX - 8 - flare * 0.5, bodyY - 10, 4, 7, R_CAPE);
    ellShaded(ctx, CX + 8 + flare * 0.5, bodyY - 10, 4, 7, R_CAPE);

    // ── Legs & Boots ──
    const stride = Math.sin(phase * Math.PI * 2) * 3;
    rrectShaded(ctx, CX - 4 + stride, GROUND - 7, 3, 7, 1, R_CAPE);
    rrectShaded(ctx, CX + 1 - stride, GROUND - 7, 3, 7, 1, R_CAPE);

    // ── Torso & Victorian Vest ──
    rrectShaded(ctx, CX - 6, bodyY - 2, 12, 12, 2, R_VEST);

    // Crisp white cravat
    ellShaded(ctx, CX, bodyY + 1, 3, 4, R_CRAVAT);
    // Gold vest buttons
    ellShaded(ctx, CX, bodyY + 5, 1, 1, R_GOLD);
    ellShaded(ctx, CX, bodyY + 8, 1, 1, R_GOLD);

    // ── Pale Vampire Head ──
    ellShaded(ctx, CX, bodyY - 9, 6, 7, R_SKIN);

    // Widow's peak jet-black hair
    ellShaded(ctx, CX, bodyY - 14, 6, 4, R_HAIR);
    ellShaded(ctx, CX - 5, bodyY - 11, 2.5, 4, R_HAIR);
    ellShaded(ctx, CX + 5, bodyY - 11, 2.5, 4, R_HAIR);

    // Glowing ruby eyes
    ellShaded(ctx, CX - 2.5, bodyY - 9, 1.5, 1.5, R_EYES);
    ellShaded(ctx, CX + 2.5, bodyY - 9, 1.5, 1.5, R_EYES);

    // Fangs
    ellShaded(ctx, CX - 1.5, bodyY - 6, 0.8, 1.5, R_CRAVAT);
    ellShaded(ctx, CX + 1.5, bodyY - 6, 0.8, 1.5, R_CRAVAT);

    // ── Clawed Hands & Siphon Energy ──
    if (drainPhase > 0) {
      // Arms thrust forward channeling siphon
      ellShaded(ctx, CX - 11, bodyY + 3, 3, 3, R_SKIN);
      ellShaded(ctx, CX + 11, bodyY + 3, 3, 3, R_SKIN);

      // Crimson siphon energy orbs at fingertips
      ellShaded(ctx, CX - 12, bodyY + 2, 4, 4, R_EYES);
      ellShaded(ctx, CX + 12, bodyY + 2, 4, 4, R_EYES);
      ellShaded(ctx, CX, bodyY - 2, 8, 2, R_LINING);
    } else {
      // Aristocratic hand posture
      ellShaded(ctx, CX - 7, bodyY + 4, 2.5, 2.5, R_SKIN);
      ellShaded(ctx, CX + 7, bodyY + 4, 2.5, 2.5, R_SKIN);
    }
  };
}

export function makeDraculaPaints(): ActorPaints {
  const makeDirectionalClips = (dir: Dir) => ({
    idle: [
      draculaFrame(dir, 0.0),
      draculaFrame(dir, 0.25),
      draculaFrame(dir, 0.5),
      draculaFrame(dir, 0.75),
    ],
    walk: [
      draculaFrame(dir, 0.0, { bob: -1 }),
      draculaFrame(dir, 0.25, { bob: 0 }),
      draculaFrame(dir, 0.5, { bob: 1 }),
      draculaFrame(dir, 0.75, { bob: 0 }),
    ],
    attack: [
      draculaFrame(dir, 0.1, { drainPhase: 0.3 }),
      draculaFrame(dir, 0.3, { drainPhase: 0.7 }),
      draculaFrame(dir, 0.6, { drainPhase: 1.0 }),
      draculaFrame(dir, 0.9, { drainPhase: 0.8 }),
    ],
    death: [
      draculaFrame(dir, 0.0, { deathT: 0.1 }),
      draculaFrame(dir, 0.0, { deathT: 0.4 }),
      draculaFrame(dir, 0.0, { deathT: 0.8 }),
      draculaFrame(dir, 0.0, { deathT: 1.0, dead: true }),
    ],
  });

  return {
    S: makeDirectionalClips("S"),
    N: makeDirectionalClips("N"),
    E: makeDirectionalClips("E"),
  };
}
