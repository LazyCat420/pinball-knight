/**
 * DOPPELGÄNGER — The Corrupted Shadow Mirror of Pinball Knight.
 *
 * Procedural fallback cel-painter for The Doppelgänger:
 * - Blackened obsidian / abyssal steel plate armor.
 * - Pointed bascinet helmet with horizontal glowing violet/crimson visor eye slit.
 * - Flared spiked pauldrons and articulated dark plate limbs.
 * - Jagged dark rune greatsword crackling with violet void energy.
 * - Obsidian heater shield with dark heraldry.
 * - Dynamic poses for idle, armored stalk, leaping void cleave, and shattering death collapse.
 */
import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  groundShadow,
  limbShaded,
  glow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

// Palette ramps
const R_OBSIDIAN: Ramp = [0, 1, 2];          // Deep obsidian black
const R_OBSIDIAN_MID: Ramp = [2, 3, 4];      // Dark steel midtone
const R_OBSIDIAN_HI: Ramp = [4, 5, 6];       // Metal specular edge
const R_VOID_VIOLET: Ramp = [16, 17, 18];    // Glowing void violet runes/aura
const R_EYE_GLOW: Ramp = [8, 9, 10];         // Sinister crimson/violet eye visor
const R_BLADE: Ramp = [19, 20, 21];          // Jagged dark blade steel
const R_SLASH: Ramp = [27, 28, 29];          // Luminous purple energy slash arc

interface DoppelPoseOpts {
  bobY?: number;
  stride?: number;
  swordSwing?: number;
  deathT?: number;
  dead?: boolean;
}

function doppelgangerFrame(dir: Dir, phase: number, opts: DoppelPoseOpts = {}): FramePaint {
  return (ctx) => {
    const {
      bobY = 0,
      stride = 0,
      swordSwing = 0,
      deathT = 0,
      dead = false,
    } = opts;

    if (dead || deathT > 0) {
      const t = Math.min(1, Math.max(0, deathT));
      const cy = GROUND - 6 + t * 4;
      groundShadow(ctx, CX, GROUND, 26);

      // Shattered obsidian plates & dissolving dark energy
      ellShaded(ctx, CX - 8, cy + 3, 14, Math.max(2, 6 - t * 3), R_OBSIDIAN);
      ellShaded(ctx, CX + 10, cy + 4, 12, Math.max(2, 5 - t * 3), R_OBSIDIAN_MID);
      ellShaded(ctx, CX, cy + 2, 18, Math.max(2, 8 - t * 4), R_OBSIDIAN);

      // Bursting light beams / cracked energy
      if (t < 0.8) {
        glow(ctx, CX, cy, 14, 17, 18);
        limbShaded(ctx, [CX, cy], [CX - 16, cy - 14], 3, R_VOID_VIOLET);
        limbShaded(ctx, [CX, cy], [CX + 18, cy - 12], 3, R_VOID_VIOLET);
        limbShaded(ctx, [CX, cy], [CX + 2, cy - 20], 3, R_EYE_GLOW);
      }
      return;
    }

    groundShadow(ctx, CX, GROUND, 24);

    const baseCy = GROUND - 28 + bobY;
    const legL = Math.sin(stride) * 6;
    const legR = -legL;

    // Legs / Greaves
    limbShaded(ctx, [CX - 6, GROUND - 16], [CX - 6, GROUND - 2 + legL * 0.3], 5, R_OBSIDIAN);
    limbShaded(ctx, [CX + 6, GROUND - 16], [CX + 6, GROUND - 2 + legR * 0.3], 5, R_OBSIDIAN);
    ellShaded(ctx, CX - 6, GROUND - 2, 4, 3, R_OBSIDIAN_MID);
    ellShaded(ctx, CX + 6, GROUND - 2, 4, 3, R_OBSIDIAN_MID);

    // Torso (Curved Obsidian Cuirass)
    ellShaded(ctx, CX, baseCy + 6, 12, 11, R_OBSIDIAN);
    ellShaded(ctx, CX, baseCy + 4, 9, 8, R_OBSIDIAN_MID);
    // Glowing chest rune
    glow(ctx, CX, baseCy + 4, 3, 17, 18);

    // Shoulders (Spiked Pauldrons)
    ellShaded(ctx, CX - 13, baseCy - 1, 6, 5, R_OBSIDIAN_MID);
    ellShaded(ctx, CX + 13, baseCy - 1, 6, 5, R_OBSIDIAN_MID);

    // Bascinet Helmet
    const headY = baseCy - 10;
    ellShaded(ctx, CX, headY, 8, 9, R_OBSIDIAN);
    ellShaded(ctx, CX, headY - 1, 6, 7, R_OBSIDIAN_HI);

    // Glowing Horizontal Visor Eye Slit
    glow(ctx, CX, headY + 1, 4, 9, 10);

    // Dark plume / smoke wisp
    limbShaded(ctx, [CX, headY - 8], [CX - 3, headY - 14], 2, R_VOID_VIOLET);
    limbShaded(ctx, [CX - 3, headY - 14], [CX + 1, headY - 18], 2, R_OBSIDIAN_MID);

    // Left Arm + Obsidian Shield
    ellShaded(ctx, CX - 15, baseCy + 7, 7, 12, R_OBSIDIAN);
    ellShaded(ctx, CX - 15, baseCy + 7, 5, 9, R_OBSIDIAN_MID);
    limbShaded(ctx, [CX - 15, baseCy + 2], [CX - 15, baseCy + 12], 2, R_VOID_VIOLET);

    // Right Arm + Greatsword
    const swordAngle = swordSwing;
    const handX = CX + 14 + Math.cos(swordAngle) * 6;
    const handY = baseCy + 4 + Math.sin(swordAngle) * 6;

    ellShaded(ctx, handX, handY, 4, 4, R_OBSIDIAN_MID);

    // Sword blade
    const tipX = handX + Math.cos(swordAngle - 0.8) * 22;
    const tipY = handY - Math.sin(swordAngle - 0.8) * 22;
    limbShaded(ctx, [handX, handY], [tipX, tipY], 4, R_BLADE);
    limbShaded(ctx, [handX, handY], [tipX, tipY], 2, R_VOID_VIOLET);

    // Attack slash arc
    if (swordSwing !== 0) {
      limbShaded(ctx, [tipX, tipY], [tipX + 8, tipY + 12], 4, R_SLASH);
      limbShaded(ctx, [tipX + 8, tipY + 12], [tipX - 4, tipY + 20], 3, R_SLASH);
    }
  };
}

export function makeDoppelgangerPaints(): ActorPaints {
  const S_IDLE: FramePaint[] = [
    doppelgangerFrame("S", 0, { bobY: 0, swordSwing: 0.2 }),
    doppelgangerFrame("S", 1, { bobY: 1.2, swordSwing: 0.25 }),
    doppelgangerFrame("S", 2, { bobY: 0.4, swordSwing: 0.2 }),
    doppelgangerFrame("S", 3, { bobY: -0.8, swordSwing: 0.15 }),
  ];

  const S_WALK: FramePaint[] = [
    doppelgangerFrame("S", 0, { bobY: 0, stride: 0, swordSwing: 0.3 }),
    doppelgangerFrame("S", 1, { bobY: 2, stride: 1.5, swordSwing: 0.35 }),
    doppelgangerFrame("S", 2, { bobY: 0, stride: 3.14, swordSwing: 0.3 }),
    doppelgangerFrame("S", 3, { bobY: 2, stride: 4.7, swordSwing: 0.35 }),
  ];

  const S_ATTACK: FramePaint[] = [
    doppelgangerFrame("S", 0, { bobY: -1, swordSwing: 0.2 }),
    doppelgangerFrame("S", 1, { bobY: 4, swordSwing: 1.1 }),
    doppelgangerFrame("S", 2, { bobY: 2, swordSwing: 1.6 }),
    doppelgangerFrame("S", 3, { bobY: 0, swordSwing: 0.5 }),
  ];

  const S_DEATH: FramePaint[] = [
    doppelgangerFrame("S", 0, { deathT: 0.2 }),
    doppelgangerFrame("S", 1, { deathT: 0.5 }),
    doppelgangerFrame("S", 2, { deathT: 0.8 }),
    doppelgangerFrame("S", 3, { deathT: 1.0, dead: true }),
  ];

  return {
    S: { idle: S_IDLE, walk: S_WALK, attack: S_ATTACK, death: S_DEATH },
    N: { idle: S_IDLE, walk: S_WALK, attack: S_ATTACK, death: S_DEATH },
    E: { idle: S_IDLE, walk: S_WALK, attack: S_ATTACK, death: S_DEATH },
  };
}
