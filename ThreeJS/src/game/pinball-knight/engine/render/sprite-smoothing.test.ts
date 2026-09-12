/**
 * Sprite MINIFICATION filtering — the fix for "everything looks low-res the
 * further I zoom out".
 *
 * The information is in the atlas; nearest minification was throwing it away by
 * point-sampling whichever texel landed under the sample, which moves with the
 * camera and reads as crawl rather than as detail loss.
 *
 * These pin the two properties that matter and nothing about how the filter is
 * plumbed: magnification stays nearest (pixel art is not negotiable), and the
 * toggle reaches textures that ALREADY EXIST (otherwise it is the restart bug
 * again, wearing a different hat).
 */
import { describe, expect, it } from "vitest";
import { LinearFilter, NearestFilter, Texture } from "three";
import { setSpriteSmoothing, spriteMinFilter } from "./sprite";

function fakeSheetTexture(): Texture {
  const tex = new Texture();
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  return tex;
}

describe("sprite minification filtering", () => {
  it("filters when minifying and stays NEAREST when magnifying", () => {
    const tex = fakeSheetTexture();
    setSpriteSmoothing(true, [tex]);
    expect(tex.minFilter, "zoomed out past the baked size, average the footprint").toBe(LinearFilter);
    expect(tex.magFilter, "zoomed in, a texel must stay a square block").toBe(NearestFilter);
  });

  it("can be turned off, and then sprites point-sample again", () => {
    const tex = fakeSheetTexture();
    setSpriteSmoothing(true, [tex]);
    setSpriteSmoothing(false, [tex]);
    expect(tex.minFilter).toBe(NearestFilter);
    expect(spriteMinFilter()).toBe(NearestFilter);
    setSpriteSmoothing(true, [tex]);
  });

  it("reaches textures that already exist — the whole point of the toggle", () => {
    // If this only applied to sheets built AFTER the change, the setting would
    // need a restart to take effect, which is the bug the feature exists to
    // remove. Build first, toggle second, assert the existing one moved.
    const built = fakeSheetTexture();
    setSpriteSmoothing(false, [built]);
    expect(built.minFilter).toBe(NearestFilter);
    setSpriteSmoothing(true, [built]);
    expect(built.minFilter).toBe(LinearFilter);
  });

  // `needsUpdate` is WRITE-ONLY in three — the setter bumps `version` and there
  // is no getter, so reading it back yields undefined. `version` is the
  // observable, and asserting on it is also the stronger check: it proves the
  // re-upload was actually requested rather than that a field was assigned.
  it("flags the texture for re-upload, or the sampler keeps the old filter", () => {
    // minFilter is baked into the GPU sampler at upload time. Changing the
    // field without a re-upload changes what JavaScript reports and nothing
    // about what is drawn — a green test over an unchanged screen.
    const tex = fakeSheetTexture();
    const before = tex.version;
    setSpriteSmoothing(true, [tex]);
    expect(tex.version, "a filter change must re-upload").toBeGreaterThan(before);
  });

  it("does not re-upload when the filter is already what was asked for", () => {
    const tex = fakeSheetTexture();
    setSpriteSmoothing(true, [tex]);
    const settled = tex.version;
    setSpriteSmoothing(true, [tex]);
    expect(tex.version, "a no-op must not cost a texture upload").toBe(settled);
  });

  it("never generates mipmaps — atlas frames have no gutter to bleed into", () => {
    // Frames are packed edge to edge (`repeat = 1/cols`), so a mip chain would
    // average across frame boundaries and ghost the neighbouring frame in.
    const tex = fakeSheetTexture();
    tex.generateMipmaps = false;
    setSpriteSmoothing(true, [tex]);
    expect(tex.generateMipmaps).toBe(false);
  });
});
