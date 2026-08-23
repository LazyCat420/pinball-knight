/**
 * The family-crossing measurement, wired to the REAL constants.
 *
 * The model lives in `light-crossing.ts` and takes its rig as an argument, so it
 * has no opinion about the game. This file is where it meets the shipped
 * numbers — which means drift shows up HERE, as a changed rate, rather than as a
 * model that quietly measures a rig nobody ships.
 */
import { describe, it, expect } from "vitest";
import { BIOMES } from "../boot/biomes";
import {
  AMBIENT_INTENSITY,
  HEMI_INTENSITY,
  DIR_INTENSITY,
} from "../constants";
import { PALETTE_HEX } from "./palette";
import { familyOf } from "./palette-shading";
import {
  familyCrossing,
  lightMultiplier,
  brightnessRange,
  snapToPalette,
  litColour,
  SITUATIONS,
  type Rig,
} from "./light-crossing";

/** The key light and the torch pool, as `boot/lighting.ts` and `maze/build.ts` build them. */
const DIR_HEX = 0xa7c0e0;
const TORCH_HEX = PALETTE_HEX[16];
const TORCH_INTENSITY = 6;

const RIGS: Rig[] = BIOMES.map((b) => ({
  ambientHex: b.amb,
  ambientIntensity: AMBIENT_INTENSITY,
  skyHex: b.sky,
  groundHex: b.ground,
  hemiIntensity: HEMI_INTENSITY,
  dirHex: DIR_HEX,
  dirIntensity: DIR_INTENSITY,
  torchHex: TORCH_HEX,
  torchIntensity: TORCH_INTENSITY,
}));

describe("family crossing — the model", () => {
  it("NEGATIVE CONTROL: a rig that multiplies albedo by exactly 1 crosses nothing", () => {
    // Every light black except a white ambient at exactly PI, which BRDF_Lambert
    // divides straight back out. If this is not zero the model is broken, and
    // every other number in this file is decoration — the first draft reported
    // 59.6% here because "ambient intensity 0" still left hemi and the key light on.
    const unit: Rig = {
      ambientHex: 0xffffff,
      ambientIntensity: Math.PI,
      skyHex: 0x000000,
      groundHex: 0x000000,
      hemiIntensity: 0,
      dirHex: 0x000000,
      dirIntensity: 0,
      torchHex: 0x000000,
      torchIntensity: 0,
    };
    const mul = lightMultiplier(unit, { ndotl: 1, up: 0.5, torch: 0 });
    for (const c of mul) expect(c).toBeCloseTo(1, 5);
    expect(familyCrossing([unit], "lit").rate).toBe(0);
  });

  it("POSITIVE CONTROL: snapping on the albedo crosses nothing, under any rig", () => {
    // The shipped path. Zero by construction — and that is the point: the family
    // is chosen from the material, so no lighting term can move it.
    expect(familyCrossing(RIGS, "albedo").rate).toBe(0);
  });
});

describe("family crossing — what the LIT snap does", () => {
  it("the pre-albedo path crossed families for most of the palette", () => {
    // The defect this wave fixed, kept as a live negative control so the
    // invariant above cannot become unfalsifiable. If this ever reads near 0,
    // either the rig changed radically or the model stopped measuring anything.
    const r = familyCrossing(RIGS, "lit");
    expect(r.rate).toBeGreaterThan(35);
    expect(r.total).toBe(RIGS.length * SITUATIONS.length * (PALETTE_HEX.length - 2));
  });

  it("desaturating the torch does NOT fix it — the mechanism is the darkening", () => {
    // `MAZE_COLOUR_PLAN.md` offered this as the cheap thing to try first. It is
    // worth about three points out of fifty, because the hue rotation everyone
    // could see is not what moves the family.
    const shipped = familyCrossing(RIGS, "lit").rate;
    const pale = familyCrossing(RIGS.map((r) => ({ ...r, torchHex: 0xe8b878 })), "lit").rate;
    const white = familyCrossing(RIGS.map((r) => ({ ...r, torchHex: 0xffffff })), "lit").rate;
    expect(shipped - pale).toBeLessThan(10);
    expect(shipped - white).toBeLessThan(10);
  });

  it("the rig renders the dungeon well under its own albedo on an open floor", () => {
    // The mechanism, stated as one number. Ambient at 3.5 sounds like an
    // over-bright fill; after BRDF_Lambert it is a ~0.4x multiply, and this
    // palette's families are far enough apart that a 0.4x multiply relocates
    // most of them.
    for (const rig of RIGS) {
      const mul = lightMultiplier(rig, { ndotl: 0.7, up: 0.5, torch: 0 });
      for (const c of mul) expect(c).toBeLessThan(0.9);
    }
  });
});

describe("family crossing — what it implies for the shaded palette", () => {
  it("lighting runs both BELOW and ABOVE unity, so the ramp must walk both ways", () => {
    // The reason `buildShadedPalette` gained rows above the identity. A
    // downward-only table clamps every torch-lit surface at row 0: the torch
    // stops making anything brighter and the dungeon reads flat.
    const { min, max } = brightnessRange(RIGS);
    expect(min).toBeLessThan(0.7);
    expect(max).toBeGreaterThan(1.2);
  });

  it("names the worst crossings, so a palette edit can be judged against them", () => {
    const r = familyCrossing(RIGS, "lit");
    // Not an assertion about which pair is worst — that would pin an accident.
    // It asserts the report is populated and self-consistent, which is what a
    // future palette edit will read it for.
    expect(r.worst.length).toBeGreaterThan(3);
    expect(r.worst.reduce((s, [, n]) => s + n, 0)).toBe(r.crossings);
  });
});

describe("the model's snap agrees with the palette it claims to model", () => {
  it("every palette entry snaps to itself", () => {
    for (let i = 0; i < PALETTE_HEX.length; i++) {
      const srgb = [((PALETTE_HEX[i] >> 16) & 255) / 255, ((PALETTE_HEX[i] >> 8) & 255) / 255, (PALETTE_HEX[i] & 255) / 255] as const;
      expect(snapToPalette(srgb)).toBe(i);
    }
  });

  it("an unlit material keeps its family through litColour at unit light", () => {
    for (let i = 2; i < PALETTE_HEX.length; i++) {
      expect(familyOf(snapToPalette(litColour(i, [1, 1, 1])))).toBe(familyOf(i));
    }
  });
});
