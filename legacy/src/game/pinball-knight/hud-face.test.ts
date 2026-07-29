/**
 * THE KNIGHT'S FACE — the two properties that were silently false.
 *
 * Neither of the defects this file pins was visible in code review, and neither
 * would fail any test that existed. Both were found by measuring.
 *
 * 1. **The blit was a fractional resample.** The face authored a 120px backing
 *    store and the HUD drew it into 72px with smoothing off — a nearest-
 *    neighbour downscale that deleted two of every five rows and columns. Every
 *    1px detail in the art had a 40% chance of not existing on screen. Nothing
 *    about that is observable from either file alone: `hud-face.ts` looked
 *    fine, `hud.ts` looked fine, and the product of the two was broken. So the
 *    geometry is asserted ACROSS the seam.
 *
 * 2. **Half the palette collapsed.** This canvas is composited inside the pixel
 *    pass and snapped to 32 colours by a luma-weighted nearest match, so two
 *    authored colours can become one on screen. Measured on the old face:
 *    `blood`/`bloodHi` → one entry (flat gore), sclera/catch-light → one entry
 *    (an invisible highlight), hair/helm → one entry (beard and armour merged).
 *    Authoring straight from `paletteCss` makes that impossible, and "every
 *    opaque pixel IS a palette entry" is the assertion that keeps it impossible.
 *
 * DOM-free vitest environment, so `document` is shimmed with node-canvas — the
 * same trick `render/monster-portrait.test.ts` uses.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { PALETTE_HEX } from "./render/palette";
import { FACE_BOX, FACE_BOX_INSET, faceBlitScale } from "./gui/screens/hud";

const realDoc = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

/** Lazily imported so the document shim is in place first. */
async function face() {
  return await import("./hud-face");
}

type Shot = { hex: Set<number>; opaque: number; bytes: string };

/** Render the face at a health fraction and report what it actually painted. */
async function shoot(frac: number): Promise<Shot> {
  const m = await face();
  const cv = m.createFace();
  m.setFaceHealth(Math.round(frac * 100), 100);
  m.renderFace(1 / 60);
  const ctx = (cv as unknown as { getContext(t: "2d"): CanvasRenderingContext2D }).getContext("2d");
  const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
  const hex = new Set<number>();
  let opaque = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue;
    opaque++;
    hex.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  }
  return { hex, opaque, bytes: Buffer.from(data).toString("base64") };
}

const TIERS: Array<[string, number]> = [
  ["fresh", 1],
  ["steady", 0.7],
  ["hurt", 0.5],
  ["bloodied", 0.3],
  ["dying", 0.12],
  ["dead", 0],
];

describe("the HUD blits the face at a whole multiple of its pixel grid", () => {
  it("divides exactly — a fractional scale would delete rows of the art", async () => {
    const { FACE_PX } = await face();
    // Asserted through the FUNCTION the HUD actually blits with, against the
    // cell the HUD actually gives it. An earlier version of this test
    // re-derived the box from the panel height, and the day the portrait was
    // allowed to overhang the panel that derivation stopped describing the
    // geometry while continuing to pass — a test that measures its own copy of
    // the layout can only ever agree with itself.
    const drawn = FACE_PX * faceBlitScale(FACE_BOX);
    expect(drawn).toBeGreaterThanOrEqual(FACE_PX);
    expect(drawn % FACE_PX).toBe(0);
    // And it fits, with the declared margin still around it.
    expect(drawn).toBeLessThanOrEqual(FACE_BOX - FACE_BOX_INSET);
  });

  it("the backing store is square and matches the declared grid", async () => {
    const { FACE_PX, createFace } = await face();
    const cv = createFace();
    expect(cv.width).toBe(FACE_PX);
    expect(cv.height).toBe(FACE_PX);
  });
});

describe("every pixel is a palette entry", () => {
  const PALETTE = new Set(PALETTE_HEX);

  it.each(TIERS)("%s paints nothing off-palette", async (_name, frac) => {
    const shot = await shoot(frac);
    const stray = [...shot.hex].filter((h) => !PALETTE.has(h));
    // A stray colour is not a cosmetic slip: downstream it gets luma-snapped to
    // whichever entry is nearest, which is how skin ended up on torch orange.
    expect(stray.map((h) => `#${h.toString(16).padStart(6, "0")}`)).toEqual([]);
  });

  it("keeps the eye's catch-light distinguishable from the sclera", async () => {
    // The specific regression: both were entry 22, so the highlight that "kills
    // the dead doll look" was painting the sclera's own colour onto the sclera.
    const shot = await shoot(1);
    expect(shot.hex.has(PALETTE_HEX[22])).toBe(true); // sclera, steel highlight
    expect(shot.hex.has(PALETTE_HEX[18])).toBe(true); // catch-light, flame core
  });

  it("keeps the grey hair off the steel the helm is painted in", async () => {
    // Beard on the stone ramp, helm on the steel ramp. Both on steel is what
    // merged them into one flat mass before.
    const shot = await shoot(1);
    const stone = [2, 3, 4, 5].filter((i) => shot.hex.has(PALETTE_HEX[i]));
    const steel = [19, 20, 21, 22].filter((i) => shot.hex.has(PALETTE_HEX[i]));
    expect(stone.length).toBeGreaterThanOrEqual(3);
    expect(steel.length).toBeGreaterThanOrEqual(3);
  });

  it("shades the gore across the blood ramp instead of flat red", async () => {
    // Two of the old face's four blood tones snapped to the same entry, so
    // every wound was a flat decal. At death's door all four should be present.
    const shot = await shoot(0.12);
    const blood = [10, 11, 12, 13].filter((i) => shot.hex.has(PALETTE_HEX[i]));
    expect(blood.length).toBe(4);
  });
});

describe("the face reads the health tier", () => {
  it("paints a different picture at every tier", async () => {
    const seen = new Map<string, string>();
    for (const [name, frac] of TIERS) {
      const shot = await shoot(frac);
      const clash = [...seen.entries()].find(([, b]) => b === shot.bytes);
      // A tier that renders identically to another is a tier the player can
      // never distinguish — the mechanic exists but does not occur.
      expect(clash ? `${name} === ${clash[0]}` : "distinct").toBe("distinct");
      seen.set(name, shot.bytes);
    }
  });

  it("paints a full portrait at every tier, including dead", async () => {
    for (const [name, frac] of TIERS) {
      const shot = await shoot(frac);
      expect(`${name}:${shot.opaque > 3000}`).toBe(`${name}:true`);
    }
  });

  it("adds blood as health falls and never takes it away", async () => {
    const bloodAt = async (frac: number): Promise<number> => {
      const shot = await shoot(frac);
      return [10, 11, 12, 13].filter((i) => shot.hex.has(PALETTE_HEX[i])).length;
    };
    expect(await bloodAt(1)).toBe(0); // unwounded — no gore at all
    expect(await bloodAt(0.5)).toBeGreaterThan(0);
    expect(await bloodAt(0.12)).toBeGreaterThanOrEqual(await bloodAt(0.5));
  });
});

describe("the face looks around on its own", () => {
  it("turns without needing to be hit", async () => {
    const m = await face();
    m.disposeFace();
    const cv = m.createFace();
    m.setFaceHealth(100, 100);
    const ctx = (cv as unknown as { getContext(t: "2d"): CanvasRenderingContext2D }).getContext("2d");
    const frames = new Set<string>();
    // ~8 seconds of idle. The scan re-rolls every 0.45-1.3s, so a face that
    // only moves on damage produces exactly one distinct frame here.
    for (let i = 0; i < 480; i++) {
      m.renderFace(1 / 60);
      frames.add(Buffer.from(ctx.getImageData(0, 0, cv.width, cv.height).data).toString("base64"));
    }
    expect(frames.size).toBeGreaterThan(2);
  });
});
