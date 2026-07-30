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

describe("the dead tier is a picture, not the end of a ramp", () => {
  /**
   * The face's own 36x36 grid, as palette INDICES.
   *
   * Every assertion below is about where a material is, so they need the cells
   * rather than the pixels. Sampling the top-left texel of each cell is exact:
   * the painter only ever fills whole cells at `SCALE`.
   */
  async function cells(frac: number): Promise<number[][]> {
    const m = await face();
    m.disposeFace();
    const cv = m.createFace();
    m.setFaceHealth(Math.round(frac * 100), 100);
    m.renderFace(1 / 60);
    const ctx = (cv as unknown as { getContext(t: "2d"): CanvasRenderingContext2D }).getContext("2d");
    const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
    const N = 36;
    const s = cv.width / N;
    const out: number[][] = [];
    for (let y = 0; y < N; y++) {
      const row: number[] = [];
      for (let x = 0; x < N; x++) {
        const i = (y * s * cv.width + x * s) * 4;
        row.push(PALETTE_HEX.indexOf((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]));
      }
      out.push(row);
    }
    return out;
  }

  const count = (grid: number[][], pred: (i: number, x: number, y: number) => boolean): number =>
    grid.reduce((n, row, y) => n + row.filter((i, x) => pred(i, x, y)).length, 0);

  it("carries LESS gore than the tier before it", async () => {
    // The point of the rework. `dead` used to be `dying` plus another layer, so
    // it was the noisiest cell on the sheet: 106 blood cells against dying's 86,
    // most of them loose single pixels including three SWEAT beads on a corpse.
    // A purpose-drawn pass is 67 — fewer marks, each of them a shape.
    const dying = await cells(0.12);
    const dead = await cells(0);
    const gore = (g: number[][]): number => count(g, (i) => i >= 10 && i <= 13);
    expect(gore(dead)).toBeLessThan(gore(dying));
  });

  it("shows bone where hair can never reach", async () => {
    // The skull, asserted where nothing else on the stone ramp can be: the far
    // cheek and jaw, below the eyes and outboard of the nose. The fringe stops
    // at y12 and the beard is on the leather ramp, so a stone-ramp cell down
    // here is bone or it is nothing. 19 cells at death, 1 at every living tier
    // — which is the anti-vacuity half: delete `paintDeath` and this goes to 1.
    const inJaw = (i: number, x: number, y: number): boolean => i >= 2 && i <= 5 && y >= 18 && x >= 20;
    expect(count(await cells(0), inJaw)).toBeGreaterThan(10);
    expect(count(await cells(0.12), inJaw)).toBeLessThan(4);
  });

  it("keeps both x-eyes whole and on something they can be read against", async () => {
    // The x is the one mark that MEANS dead. It survived before (19 of its 20
    // cells did), but it sat on lit skin ringed by splatter, which is a dark
    // mark among dark marks. Both halves are pinned: every cell of both x's is
    // ink, and every one of them sits on the socket floor — so a future pass
    // cannot quietly take the hollow away and leave the mark floating.
    const g = await cells(0);
    let ink = 0;
    for (const ox of [11, 20]) {
      for (let i = 0; i < 5; i++) {
        if (g[14 + i][ox + i] === 1) ink++;
        if (g[14 + i][ox + 4 - i] === 1) ink++;
      }
      // The socket floor, sampled beside the x rather than under it.
      expect(g[16][ox + 1]).toBe(23); // skin shadow — the mid the ink reads on
    }
    expect(ink).toBe(20);
  });
});

describe("the death screen's portrait", () => {
  /** Every pixel of a canvas, as a comparable string. */
  const bytesOf = (cv: HTMLCanvasElement): string => {
    const ctx = (cv as unknown as { getContext(t: "2d"): CanvasRenderingContext2D }).getContext("2d");
    return Buffer.from(ctx.getImageData(0, 0, cv.width, cv.height).data).toString("base64");
  };

  it("is a full dead portrait on the mugshot's own grid", async () => {
    const m = await face();
    m.disposeFace();
    const dead = m.deadFace();
    expect(dead).not.toBeNull();
    // Same grid as the live face, because `game-over.ts` blits it at 1:1 —
    // anything else is the fractional resample the whole file is about.
    expect(`${dead?.width}x${dead?.height}`).toBe(`${m.FACE_PX}x${m.FACE_PX}`);

    const shot = bytesOf(dead as HTMLCanvasElement);
    const data = Buffer.from(shot, "base64");
    const PALETTE = new Set(PALETTE_HEX);
    let opaque = 0;
    const stray = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 8) continue;
      opaque++;
      const hex = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      if (!PALETTE.has(hex)) stray.add(hex);
    }
    expect(opaque).toBeGreaterThan(3000); // a portrait, not an empty plate
    expect([...stray]).toEqual([]);
  });

  it("is the dead face, not whatever the run ended on", async () => {
    const m = await face();
    m.disposeFace();
    // A live face in rude health. The portrait must not be a picture of THIS.
    m.createFace();
    m.setFaceHealth(100, 100);
    m.renderFace(1 / 60);
    const alive = bytesOf(m.createFace());
    expect(bytesOf(m.deadFace() as HTMLCanvasElement)).not.toBe(alive);
  });

  it("puts the live face back exactly as it found it", async () => {
    const m = await face();
    m.disposeFace();
    const live = m.createFace();
    m.setFaceHealth(100, 100);
    m.renderFace(1 / 60);
    const before = bytesOf(live);
    // The portrait drives the singleton to build itself. The HUD is painted
    // behind the death screen off that same canvas, so anything left behind
    // here is a corpse in the status bar — or a live face on the death screen,
    // depending on which one repainted last.
    m.deadFace();
    expect(bytesOf(live)).toBe(before);
  });

  it("is built once", async () => {
    const m = await face();
    m.disposeFace();
    expect(m.deadFace()).toBe(m.deadFace());
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
