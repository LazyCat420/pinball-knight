/**
 * AQUATIC & MAFIA MONSTERS — Procedural Fallback Cel-Painters
 *
 * Procedural fallback cel-painters for all 10 aquatic mafia creatures:
 * 1. Shark Trapper (Great white shark in trapper vest with fishing pole)
 * 2. Dolphin Brawler (Bipedal dolphin in 90s blue jeans & shades with boxing gloves)
 * 3. Octopus Mob Boss ("Don Tentacolo" with fedora & revolver tentacles)
 * 4. Clownfish Mobster (Orange clownfish in pinstripe suit & fedora with tommy gun)
 * 5. Lionfish Enforcer (Spiny lionfish in waistcoat with shotgun)
 * 6. Anglerfish Hitman (Trenchcoat hitman with glowing lure & sniper rifle)
 * 7. Pufferfish Capo (Round spiky mobster with blunderbuss)
 * 8. Swordfish Mobster (Sleek mobster in black suit with speargun harpoon)
 * 9. Moray Eel Extortionist (Green moray in zoot suit with electric orbs)
 * 10. Seahorse Gunner (Armored seahorse in mob vest with water mortar)
 */

import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  groundShadow,
  rrectShaded,
  limbShaded,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

// Common Mafia & Aquatic Ramps
const R_BLACK: Ramp = [1, 2, 3];          // Fedora, dark suit, sunglasses
const R_CHARCOAL: Ramp = [2, 3, 4];       // Trenchcoat, pinstripe jacket
const R_WHITE: Ramp = [22, 23, 24];       // Dress shirt, clownfish stripes, pearl
const R_RED: Ramp = [10, 11, 12];         // Mob tie, boxing gloves, lionfish stripes
const R_GOLD: Ramp = [26, 27, 28];        // Gold chains, lure lamp, brass
const R_STEEL: Ramp = [19, 20, 21];       // Revolvers, harpoon, fishing rod
const R_JEANS: Ramp = [17, 18, 19];       // 90s denim blue jeans
const R_SHARK: Ramp = [18, 19, 20];       // Great white slate skin
const R_DOLPHIN: Ramp = [17, 18, 19];     // Dolphin grey-blue skin
const R_OCTO: Ramp = [11, 12, 13];        // Purple-crimson octopus skin
const R_CLOWN: Ramp = [8, 9, 10];         // Bright orange clownfish
const R_LION: Ramp = [9, 10, 11];         // Lionfish striped body
const R_ANGLER: Ramp = [2, 3, 4];         // Deep sea black-grey skin
const R_PUFFER: Ramp = [13, 14, 15];      // Mottled yellow-tan puffer belly
const R_SWORD: Ramp = [18, 19, 20];       // Sleek navy-steel swordfish skin
const R_MORAY: Ramp = [6, 7, 8];          // Green mottled eel skin
const R_SEAHORSE: Ramp = [14, 15, 16];    // Golden-tan seahorse armor plates

function makeDirectionalSet(
  frameFn: (dir: Dir, phase: number, clip: "idle" | "walk" | "attack" | "death") => FramePaint
) {
  const makeClips = (dir: Dir) => ({
    idle: [
      frameFn(dir, 0, "idle"),
      frameFn(dir, 1, "idle"),
      frameFn(dir, 2, "idle"),
      frameFn(dir, 3, "idle"),
    ],
    walk: [
      frameFn(dir, 0, "walk"),
      frameFn(dir, 1, "walk"),
      frameFn(dir, 2, "walk"),
      frameFn(dir, 3, "walk"),
    ],
    attack: [
      frameFn(dir, 0, "attack"),
      frameFn(dir, 1, "attack"),
      frameFn(dir, 2, "attack"),
      frameFn(dir, 3, "attack"),
    ],
    death: [
      frameFn(dir, 0, "death"),
      frameFn(dir, 1, "death"),
      frameFn(dir, 2, "death"),
      frameFn(dir, 3, "death"),
    ],
  });

  return {
    S: makeClips("S"),
    N: makeClips("N"),
    E: makeClips("E"),
  };
}

// ── 1. SHARK TRAPPER ──────────────────────────────────────────────
export function makeSharkTrapperPaints(): ActorPaints {
  return makeDirectionalSet((dir, phase, clip) => (ctx) => {
    if (clip === "death") {
      groundShadow(ctx, CX, GROUND, 18);
      ellShaded(ctx, CX, GROUND - 4, 16, 6, R_SHARK);
      rrectShaded(ctx, CX - 10, GROUND - 3, 18, 2, 1, R_STEEL);
      return;
    }
    const bob = clip === "walk" ? (phase % 2 === 0 ? -2 : 2) : 0;
    const cy = GROUND - 18 + bob;
    groundShadow(ctx, CX, GROUND, 16);

    // Shark body
    ellShaded(ctx, CX, cy, 14, 18, R_SHARK);
    // Belly
    ellShaded(ctx, CX, cy + 4, 9, 12, R_WHITE);
    // Trapper Vest
    rrectShaded(ctx, CX - 11, cy - 6, 22, 14, 2, R_CHARCOAL);
    // Trapper Hat
    ellShaded(ctx, CX, cy - 14, 13, 5, R_CHARCOAL);
    rrectShaded(ctx, CX - 10, cy - 18, 20, 6, 2, R_CHARCOAL);
    // Fishing rod & hook
    const rodAngle = clip === "attack" ? -12 : -4;
    limbShaded(ctx, [CX + 8, cy], [CX + 18 + rodAngle, cy - 24], 3, R_STEEL);
    ellShaded(ctx, CX + 18 + rodAngle, cy - 24, 2, 2, R_GOLD);
  });
}

// ── 2. DOLPHIN BRAWLER ────────────────────────────────────────────
export function makeDolphinBrawlerPaints(): ActorPaints {
  return makeDirectionalSet((dir, phase, clip) => (ctx) => {
    if (clip === "death") {
      groundShadow(ctx, CX, GROUND, 16);
      ellShaded(ctx, CX, GROUND - 5, 14, 5, R_DOLPHIN);
      ellShaded(ctx, CX + 6, GROUND - 4, 4, 3, R_JEANS);
      return;
    }
    const bob = clip === "walk" ? (phase % 2 === 0 ? -2 : 2) : 0;
    const cy = GROUND - 20 + bob;
    groundShadow(ctx, CX, GROUND, 15);

    // 90s Baggy Blue Jeans (wide horizontal spans)
    rrectShaded(ctx, CX - 10, cy + 6, 20, 14, 2, R_JEANS);
    rrectShaded(ctx, CX - 9, cy + 14, 8, 10, 2, R_JEANS);
    rrectShaded(ctx, CX + 1, cy + 14, 8, 10, 2, R_JEANS);

    // Dolphin muscular torso & head
    ellShaded(ctx, CX, cy - 4, 14, 15, R_DOLPHIN);
    ellShaded(ctx, CX, cy + 2, 9, 10, R_WHITE);
    // Snout
    ellShaded(ctx, CX, cy - 12, 8, 5, R_DOLPHIN);
    // Sunglasses
    rrectShaded(ctx, CX - 7, cy - 8, 14, 4, 1, R_BLACK);

    // Boxing gloves (red)
    const punchX = clip === "attack" ? (phase % 2 === 0 ? 8 : -8) : 0;
    const punchY = clip === "attack" ? -4 : 0;
    ellShaded(ctx, CX - 12, cy + punchY, 6, 6, R_RED);
    ellShaded(ctx, CX + 12 + punchX, cy + punchY, 6, 6, R_RED);
  });
}

// ── 3. OCTOPUS MOB BOSS ───────────────────────────────────────────
export function makeOctopusGunnerPaints(): ActorPaints {
  return makeDirectionalSet((dir, phase, clip) => (ctx) => {
    if (clip === "death") {
      groundShadow(ctx, CX, GROUND, 20);
      ellShaded(ctx, CX, GROUND - 4, 18, 5, R_OCTO);
      rrectShaded(ctx, CX - 6, GROUND - 7, 12, 4, 1, R_BLACK);
      return;
    }
    const bob = clip === "walk" ? (phase % 2 === 0 ? -1 : 1) : 0;
    const cy = GROUND - 18 + bob;
    groundShadow(ctx, CX, GROUND, 18);

    // Tentacles spread at base
    ellShaded(ctx, CX - 14, cy + 10, 8, 6, R_OCTO);
    ellShaded(ctx, CX + 14, cy + 10, 8, 6, R_OCTO);
    ellShaded(ctx, CX - 8, cy + 12, 7, 5, R_OCTO);
    ellShaded(ctx, CX + 8, cy + 12, 7, 5, R_OCTO);

    // Bulbous head & suit jacket
    ellShaded(ctx, CX, cy - 4, 15, 14, R_OCTO);
    rrectShaded(ctx, CX - 10, cy + 2, 20, 8, 2, R_BLACK);
    ellShaded(ctx, CX, cy + 3, 3, 4, R_RED); // red mob tie

    // Don Fedora
    ellShaded(ctx, CX, cy - 14, 16, 4, R_BLACK);
    rrectShaded(ctx, CX - 10, cy - 18, 20, 6, 2, R_BLACK);
    rrectShaded(ctx, CX - 10, cy - 14, 20, 2, 1, R_RED); // hat ribbon

    // Revolvers held in side tentacles
    const shootOffset = clip === "attack" ? 3 : 0;
    rrectShaded(ctx, CX - 16 - shootOffset, cy + 4, 6, 3, 1, R_STEEL);
    rrectShaded(ctx, CX + 12 + shootOffset, cy + 4, 6, 3, 1, R_STEEL);
  });
}

// ── 4. CLOWNFISH MOBSTER ──────────────────────────────────────────
export function makeClownfishMobPaints(): ActorPaints {
  return makeDirectionalSet((dir, phase, clip) => (ctx) => {
    if (clip === "death") {
      groundShadow(ctx, CX, GROUND, 14);
      ellShaded(ctx, CX, GROUND - 4, 12, 5, R_CLOWN);
      return;
    }
    const bob = clip === "walk" ? (phase % 2 === 0 ? -2 : 2) : 0;
    const cy = GROUND - 16 + bob;
    groundShadow(ctx, CX, GROUND, 13);

    // Orange clownfish body
    ellShaded(ctx, CX, cy - 2, 11, 14, R_CLOWN);
    // White body bars
    ellShaded(ctx, CX, cy - 6, 10, 3, R_WHITE);
    ellShaded(ctx, CX, cy + 2, 9, 3, R_WHITE);

    // Pinstripe Suit Jacket
    rrectShaded(ctx, CX - 8, cy + 1, 16, 9, 2, R_CHARCOAL);
    ellShaded(ctx, CX, cy + 2, 2, 3, R_RED);

    // Fedora
    ellShaded(ctx, CX, cy - 12, 12, 3, R_BLACK);
    rrectShaded(ctx, CX - 7, cy - 16, 14, 5, 2, R_BLACK);

    // Tommy gun with drum magazine
    const gunX = clip === "attack" ? CX + 6 : CX + 4;
    rrectShaded(ctx, gunX - 4, cy + 3, 14, 3, 1, R_BLACK);
    ellShaded(ctx, gunX + 2, cy + 6, 4, 4, R_STEEL); // drum magazine
  });
}

// ── 5. LIONFISH ENFORCER ──────────────────────────────────────────
export function makeLionfishMobPaints(): ActorPaints {
  return makeDirectionalSet((dir, phase, clip) => (ctx) => {
    if (clip === "death") {
      groundShadow(ctx, CX, GROUND, 16);
      ellShaded(ctx, CX, GROUND - 4, 14, 5, R_LION);
      return;
    }
    const bob = clip === "walk" ? (phase % 2 === 0 ? -1 : 1) : 0;
    const cy = GROUND - 17 + bob;
    groundShadow(ctx, CX, GROUND, 15);

    // Flared venom spines
    limbShaded(ctx, [CX - 12, cy - 8], [CX - 20, cy - 16], 2, R_WHITE);
    limbShaded(ctx, [CX + 12, cy - 8], [CX + 20, cy - 16], 2, R_WHITE);
    limbShaded(ctx, [CX - 14, cy], [CX - 22, cy - 4], 2, R_WHITE);
    limbShaded(ctx, [CX + 14, cy], [CX + 22, cy - 4], 2, R_WHITE);

    // Striped body
    ellShaded(ctx, CX, cy, 13, 14, R_LION);
    ellShaded(ctx, CX, cy - 3, 11, 3, R_WHITE);
    ellShaded(ctx, CX, cy + 3, 9, 3, R_RED);

    // Mob Waistcoat & bowtie
    rrectShaded(ctx, CX - 7, cy + 1, 14, 8, 1, R_CHARCOAL);
    ellShaded(ctx, CX, cy + 1, 3, 2, R_RED);

    // Shotgun / Enforcer Blaster
    rrectShaded(ctx, CX + 3, cy + 4, 14, 4, 1, R_STEEL);
  });
}

// ── 6. ANGLERFISH HITMAN ──────────────────────────────────────────
export function makeAnglerfishHitmanPaints(): ActorPaints {
  return makeDirectionalSet((dir, phase, clip) => (ctx) => {
    if (clip === "death") {
      groundShadow(ctx, CX, GROUND, 15);
      ellShaded(ctx, CX, GROUND - 4, 13, 5, R_ANGLER);
      ellShaded(ctx, CX + 6, GROUND - 3, 3, 3, R_GOLD);
      return;
    }
    const bob = clip === "walk" ? (phase % 2 === 0 ? -2 : 2) : 0;
    const cy = GROUND - 18 + bob;
    groundShadow(ctx, CX, GROUND, 14);

    // Trenchcoat body
    rrectShaded(ctx, CX - 9, cy - 2, 18, 14, 2, R_CHARCOAL);

    // Dark head & needle jaws
    ellShaded(ctx, CX, cy - 8, 11, 10, R_ANGLER);
    ellShaded(ctx, CX, cy - 4, 8, 3, R_WHITE); // needle teeth

    // Glowing Lure (Esca) projecting forward
    limbShaded(ctx, [CX, cy - 14], [CX + 8, cy - 20], 2, R_ANGLER);
    ellShaded(ctx, CX + 9, cy - 21, 4, 4, R_GOLD); // glowing orb

    // Piercing sniper rifle
    const aimX = clip === "attack" ? 18 : 12;
    rrectShaded(ctx, CX + 2, cy + 2, aimX, 3, 1, R_STEEL);
  });
}

// ── 7. PUFFERFISH CAPO ────────────────────────────────────────────
export function makePufferfishMobPaints(): ActorPaints {
  return makeDirectionalSet((dir, phase, clip) => (ctx) => {
    if (clip === "death") {
      groundShadow(ctx, CX, GROUND, 18);
      ellShaded(ctx, CX, GROUND - 4, 16, 5, R_PUFFER);
      return;
    }
    const bob = clip === "walk" ? (phase % 2 === 0 ? -1 : 1) : 0;
    const cy = GROUND - 17 + bob;
    groundShadow(ctx, CX, GROUND, 17);

    // Rotund body & spines
    const size = clip === "attack" ? 17 : 15;
    ellShaded(ctx, CX, cy, size, size, R_PUFFER);
    ellShaded(ctx, CX, cy + 4, size - 3, size - 4, R_WHITE);

    // Spines radiating
    ellShaded(ctx, CX - size + 2, cy - 5, 3, 2, R_GOLD);
    ellShaded(ctx, CX + size - 2, cy - 5, 3, 2, R_GOLD);
    ellShaded(ctx, CX - size + 2, cy + 5, 3, 2, R_GOLD);
    ellShaded(ctx, CX + size - 2, cy + 5, 3, 2, R_GOLD);

    // Mob vest stretched around belly
    rrectShaded(ctx, CX - 8, cy - 2, 16, 10, 2, R_BLACK);
    ellShaded(ctx, CX, cy, 2, 3, R_RED);

    // Fedora
    ellShaded(ctx, CX, cy - size + 2, 13, 3, R_BLACK);
    rrectShaded(ctx, CX - 7, cy - size - 2, 14, 5, 2, R_BLACK);

    // Heavy blunderbuss
    rrectShaded(ctx, CX + 6, cy + 4, 11, 5, 2, R_STEEL);
  });
}

// ── 8. SWORDFISH MOBSTER ──────────────────────────────────────────
export function makeSwordfishMobPaints(): ActorPaints {
  return makeDirectionalSet((dir, phase, clip) => (ctx) => {
    if (clip === "death") {
      groundShadow(ctx, CX, GROUND, 16);
      ellShaded(ctx, CX, GROUND - 4, 15, 4, R_SWORD);
      rrectShaded(ctx, CX - 4, GROUND - 3, 14, 2, 1, R_STEEL);
      return;
    }
    const bob = clip === "walk" ? (phase % 2 === 0 ? -2 : 2) : 0;
    const cy = GROUND - 19 + bob;
    groundShadow(ctx, CX, GROUND, 15);

    // Black Italian Suit
    rrectShaded(ctx, CX - 8, cy - 2, 16, 15, 2, R_BLACK);
    ellShaded(ctx, CX, cy + 2, 2, 4, R_RED); // red silk tie
    limbShaded(ctx, [CX - 4, cy + 13], [CX - 4, GROUND - 2], 3, R_BLACK);
    limbShaded(ctx, [CX + 4, cy + 13], [CX + 4, GROUND - 2], 3, R_BLACK);

    // Sleek swordfish head & elongated upper bill
    ellShaded(ctx, CX, cy - 8, 10, 11, R_SWORD);
    limbShaded(ctx, [CX + 2, cy - 10], [CX + 14, cy - 13], 2, R_SWORD); // bill

    // Harpoon Speargun (Two-handed weapon, NO handheld sword)
    const gunX = clip === "attack" ? 18 : 12;
    rrectShaded(ctx, CX + 2, cy + 1, gunX, 4, 1, R_STEEL);
    limbShaded(ctx, [CX + gunX + 2, cy + 3], [CX + gunX + 8, cy + 3], 2, R_GOLD); // harpoon tip
  });
}

// ── 9. MORAY EEL EXTORTIONIST ─────────────────────────────────────
export function makeMorayMobPaints(): ActorPaints {
  return makeDirectionalSet((dir, phase, clip) => (ctx) => {
    if (clip === "death") {
      groundShadow(ctx, CX, GROUND, 16);
      ellShaded(ctx, CX, GROUND - 4, 15, 5, R_MORAY);
      return;
    }
    const bob = clip === "walk" ? (phase % 2 === 0 ? -2 : 2) : 0;
    const cy = GROUND - 18 + bob;
    groundShadow(ctx, CX, GROUND, 15);

    // Sinuous eel body in zoot suit jacket
    rrectShaded(ctx, CX - 8, cy - 1, 16, 14, 3, R_CHARCOAL);

    // Moray head & wicked needle-tooth open jaw
    ellShaded(ctx, CX, cy - 9, 9, 12, R_MORAY);
    ellShaded(ctx, CX + 3, cy - 7, 6, 4, R_WHITE); // toothy grin
    ellShaded(ctx, CX - 3, cy - 11, 2, 2, R_GOLD); // beady eye

    // Electric spark orbs flanking hands
    const sparkOffset = clip === "attack" ? 4 : 0;
    ellShaded(ctx, CX - 12 - sparkOffset, cy + 2, 4, 4, R_GOLD);
    ellShaded(ctx, CX + 12 + sparkOffset, cy + 2, 4, 4, R_GOLD);
  });
}

// ── 10. SEAHORSE GUNNER ───────────────────────────────────────────
export function makeSeahorseMobPaints(): ActorPaints {
  return makeDirectionalSet((dir, phase, clip) => (ctx) => {
    if (clip === "death") {
      groundShadow(ctx, CX, GROUND, 14);
      ellShaded(ctx, CX, GROUND - 4, 12, 4, R_SEAHORSE);
      return;
    }
    const bob = clip === "walk" ? (phase % 2 === 0 ? -1 : 1) : 0;
    const cy = GROUND - 18 + bob;
    groundShadow(ctx, CX, GROUND, 13);

    // Curled tail at base
    ellShaded(ctx, CX, cy + 12, 6, 6, R_SEAHORSE);

    // Segmented torso & mob vest
    ellShaded(ctx, CX, cy + 2, 8, 12, R_SEAHORSE);
    rrectShaded(ctx, CX - 6, cy - 1, 12, 10, 2, R_BLACK);

    // Seahorse snout head & crown crest
    ellShaded(ctx, CX, cy - 8, 7, 9, R_SEAHORSE);
    limbShaded(ctx, [CX + 2, cy - 7], [CX + 10, cy - 6], 3, R_SEAHORSE); // tubular snout
    ellShaded(ctx, CX - 2, cy - 14, 4, 4, R_GOLD); // crown

    // Fedora
    ellShaded(ctx, CX - 1, cy - 12, 10, 3, R_CHARCOAL);

    // Shoulder-mounted water mortar tube
    const tubeAngle = clip === "attack" ? -14 : -8;
    limbShaded(ctx, [CX - 4, cy + 4], [CX - 8, cy + tubeAngle], 4, R_STEEL);
  });
}
