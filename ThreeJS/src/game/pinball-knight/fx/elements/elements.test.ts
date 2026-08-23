/**
 * The elemental materials, checked without a GPU.
 *
 * Building a TSL node graph is pure JS — no adapter, no context — so the one
 * thing a unit test CAN prove here is that the graph assembles and that its
 * colours are palette entries. Both matter more than they sound:
 *
 *  · A bad TSL call (wrong arity, a swizzle that does not exist, a float where a
 *    vec belongs) throws at BUILD time on the GPU, deep inside a frame, and the
 *    visible symptom is a black screen with nothing in the console. Constructing
 *    every material in a test moves that failure to a red line here.
 *  · A free-hex colour cannot be caught by looking at it. The pixel pass snaps
 *    to the nearest of 32 by a luma-weighted metric, and this repo has already
 *    shipped a warm wash that measured 26.8% ROT GREEN. So the ramps are
 *    asserted to be palette INDICES, and every index is asserted to exist.
 */
import { describe, expect, it } from "vitest";
import { PALETTE_HEX, PALETTE_SIZE } from "../../render/palette";
import { palLin, toLinear } from "../color";
import { FIRE_RAMP, createFireMaterial } from "./fire";
import { WATER_RAMP, createWaterMaterial } from "./water";
import { FROST_RAMP, createFrostMaterial } from "./frost";
import { OIL_RAMP, TAR_RAMP, createOilMaterial, createTarMaterial } from "./goo";
import { ROD_RAMP, createRodMaterial } from "./rod";

describe("fx/color", () => {
  it("inverts the sRGB transfer function at the anchors", () => {
    expect(toLinear(0)).toBe(0);
    expect(toLinear(1)).toBeCloseTo(1, 6);
    // Mid-grey sRGB 0.5 is ~0.214 linear. The 2.2-power approximation gives
    // 0.218 — close, but the pixel pass uses the real curve, so this must too.
    expect(toLinear(0.5)).toBeCloseTo(0.2140, 3);
  });

  it("returns linear values strictly below the sRGB ones it came from", () => {
    // Every palette entry except pure black/white must darken under the
    // inversion. If this ever passes trivially, the conversion is a no-op.
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const srgb = ((PALETTE_HEX[i]! >> 16) & 0xff) / 255;
      const lin = palLin(i)[0];
      if (srgb > 0.01 && srgb < 0.99) expect(lin).toBeLessThan(srgb);
    }
  });

  it("refuses an index outside the palette", () => {
    expect(() => palLin(PALETTE_SIZE)).toThrow();
    expect(() => palLin(-1)).toThrow();
  });
});

/**
 * EVERY ramp, by name, so a new elemental cannot skip these checks by not being
 * added to a list someone forgot about.
 */
const RAMPS: Array<[string, readonly number[]]> = [
  ["fire", FIRE_RAMP],
  ["water", WATER_RAMP],
  ["frost", FROST_RAMP],
  ["oil", OIL_RAMP],
  ["tar", TAR_RAMP],
  ["rod", ROD_RAMP],
];

const luma = (i: number) => {
  const [r, g, b] = palLin(i);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe("elemental ramps", () => {
  it("name only real palette indices", () => {
    for (const [name, ramp] of RAMPS) {
      for (const i of ramp) {
        expect(i, name).toBeGreaterThanOrEqual(0);
        expect(i, name).toBeLessThan(PALETTE_SIZE);
        expect(PALETTE_HEX[i], `${name} index ${i}`).toBeTypeOf("number");
      }
    }
  });

  /**
   * The one that actually caught a bug.
   *
   * `bandRamp` mixes with monotonic `step()` thresholds, so every threshold below
   * the field value fires and the LAST one wins. That is only a ramp if the
   * colours ascend in brightness — otherwise the bands render out of order and
   * the effect reads as noise with no gradient at all.
   *
   * Ordering by LUMA is not the same as ordering by how the palette NAMES read,
   * which is exactly how oil shipped broken for a moment: "steel dark" sounds
   * like a highlight next to "arcane dark", but it measures 0.082 against arcane
   * light's 0.543, so putting it last made the ramp FALL off a cliff at the top.
   */
  it("run dark to bright, so bandRamp's step chain reads as a ramp", () => {
    for (const [name, ramp] of RAMPS) {
      for (let i = 1; i < ramp.length; i++) {
        expect(
          luma(ramp[i]!),
          `${name}: index ${ramp[i - 1]} (luma ${luma(ramp[i - 1]!).toFixed(3)}) must be darker than ${ramp[i]} (${luma(ramp[i]!).toFixed(3)})`,
        ).toBeGreaterThan(luma(ramp[i - 1]!));
      }
    }
  });

  it("gives every ramp at least three bands to work with", () => {
    // Two colours is not a ramp, it is a threshold — and a thresholded field
    // under the dither reads as a crawling edge rather than as shading.
    for (const [name, ramp] of RAMPS) expect(ramp.length, name).toBeGreaterThanOrEqual(3);
  });

  it("keeps tar entirely out of the bright half — it must look DEAD", () => {
    // Tar's entire design job is to be the dullest thing on the floor. A bright
    // entry creeping into its ramp would make it read as inviting, which is what
    // oil is for; the pair only teaches the player something if they contrast.
    for (const i of TAR_RAMP) expect(luma(i), `tar index ${i}`).toBeLessThan(0.1);
  });

  it("puts fire's hot end above the pass's bloom threshold", () => {
    // BLOOM_THRESHOLD is 0.7 in constants/render.ts. The old fire had a
    // near-white gradient core specifically so torches and pools bled a halo;
    // if the new top band falls under the threshold that halo silently vanishes.
    const [r, g, b] = palLin(FIRE_RAMP[FIRE_RAMP.length - 1]!);
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeGreaterThan(0.7);
  });
});

describe("createFireMaterial", () => {
  it("builds a graph in both orientations", () => {
    for (const orientation of ["floor", "billboard"] as const) {
      const fx = createFireMaterial({ orientation });
      expect(fx.material.colorNode).toBeTruthy();
      expect(fx.material.transparent).toBe(true);
      expect(fx.material.depthWrite).toBe(false);
      fx.dispose();
    }
  });

  it("exposes live uniforms, and each instance owns its own", () => {
    const a = createFireMaterial();
    const b = createFireMaterial();
    a.uTime.value = 3;
    a.uSeed.value = 9;
    // The reason materials are rebuilt per instance rather than cloned: a
    // clone shares node references, so this would leak into b and every fire in
    // a room would flicker and fade in lockstep.
    expect(b.uTime.value).toBe(0);
    expect(b.uSeed.value).toBe(0);
    a.dispose();
    b.dispose();
  });

  it("adds light, because the bloom feeds on its core", () => {
    const fx = createFireMaterial();
    expect(fx.material.blending).toBe(2 /* THREE.AdditiveBlending */);
    fx.dispose();
  });
});

describe("the remaining elementals", () => {
  it("all build a graph with independent uniforms", () => {
    const made = [createFrostMaterial(), createOilMaterial(), createTarMaterial(), createRodMaterial()];
    for (const fx of made) {
      expect(fx.material.colorNode).toBeTruthy();
      expect(fx.material.transparent).toBe(true);
    }
    // Independence again, because this is the property a `.clone()` would break
    // and the symptom — every decal fading in lockstep — is easy to mistake for
    // an intentional effect.
    made[0]!.uOpacity.value = 0.3;
    expect(made[1]!.uOpacity.value).toBe(1);
    for (const fx of made) fx.dispose();
  });

  it("gives frost a growth clock, because a crystal spreads and then stops", () => {
    // The Canvas2D frost rotated the quad to gesture at "creeping". Rotation is
    // not growth; this is the handle that makes it actually spread from where it
    // was struck.
    const fx = createFrostMaterial();
    expect(fx.uAge.value).toBe(0);
    fx.uAge.value = 1.5;
    expect(fx.uAge.value).toBe(1.5);
    fx.dispose();
  });

  it("builds tar and oil from one graph but not one material", () => {
    const oil = createOilMaterial();
    const tar = createTarMaterial();
    expect(oil.material).not.toBe(tar.material);
    oil.dispose();
    tar.dispose();
  });
});

describe("createWaterMaterial", () => {
  it("builds a graph and exposes the torch handle", () => {
    const fx = createWaterMaterial();
    expect(fx.material.colorNode).toBeTruthy();
    expect(fx.uTorch.value).toBe(1);
    fx.dispose();
  });

  it("sits on the scene rather than adding to it", () => {
    // Water is a surface, not an emitter. Additive water turns a dark floor
    // into a glowing pool and stops reading as a liquid at all.
    const fx = createWaterMaterial();
    expect(fx.material.blending).toBe(1 /* THREE.NormalBlending */);
    fx.dispose();
  });

  it("builds with caustics disabled", () => {
    const fx = createWaterMaterial({ caustic: 0 });
    expect(fx.material.colorNode).toBeTruthy();
    fx.dispose();
  });
});
