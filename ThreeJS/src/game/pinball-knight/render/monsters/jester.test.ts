/**
 * JESTER ART tests.
 *
 * The hound shipped for weeks as a red-tinted spider and every registry was
 * satisfied the whole time — the only thing that disagreed was the screen.
 * hound.test.ts is the answer to that, and this file is the same shape: it
 * asserts on PIXELS, because a monster's identity is its silhouette and a test
 * that checks tables cannot see a silhouette.
 *
 * What is worth pinning here is narrower than "does it look right", which no
 * test can hold. It is the three claims the painter's header makes, each of
 * which would fail silently if a later edit walked it back:
 *
 *   1. THE SPRING IS THE TELEGRAPH. The wind-up compresses and the release
 *      extends, so the creature's HEIGHT is what a player reads. If a tweak
 *      flattens the extension range, the monster keeps working and stops being
 *      readable — the worst kind of regression, because nothing fails.
 *   2. THE FACE IS DIRECTIONAL. Greasepaint in front, none from behind.
 *   3. THE WARM RAMP IS ACTUALLY SPENT. The palette census found the torch ramp
 *      at 2.26% of all actor pixels; the whole argument for a harlequin is that
 *      it is the body that fixes that. Measure it rather than claim it.
 *
 * Plus the one this creature is most at risk of: it kites and shoots, which is
 * the SPITTER's job, so it must not read as a spitter.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { makeJesterPaints } from "./jester";
import { makeSpitterPaints } from "../cel-painter";
import { PALETTE_HEX, installPalette } from "../palette";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

const realDoc = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
  // Without this, figure.ts's palette delegate is still on the greyscale
  // fallback and every hue assertion below would be measuring nothing.
  installPalette();
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

const CEL = 128;

function paint(f: FramePaint): ImageData {
  const cv = createCanvas(CEL, CEL);
  const ctx = cv.getContext("2d") as unknown as CanvasRenderingContext2D;
  f(ctx);
  return (ctx as unknown as { getImageData: (a: number, b: number, c: number, d: number) => ImageData })
    .getImageData(0, 0, CEL, CEL);
}

/** The painted bounding box and opaque-pixel count. `y0` is the top edge — for
 *  a figure standing on GROUND that IS its height. */
function box(img: ImageData): { w: number; h: number; painted: number; y0: number; x0: number; x1: number } {
  let x0 = CEL, x1 = -1, y0 = CEL, y1 = -1, painted = 0;
  for (let y = 0; y < CEL; y++) {
    for (let x = 0; x < CEL; x++) {
      if (img.data[(y * CEL + x) * 4 + 3] <= 8) continue;
      painted++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, painted, y0, x0, x1 };
}

const PAL_RGB = PALETTE_HEX.map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);

/**
 * Nearest palette entry under the SAME luma-weighted metric the sprite atlas
 * snaps with (engine/render/sprite.ts: weights 0.3/0.59/0.11).
 *
 * Counting exact colour matches instead was the first cut and it was wrong by a
 * factor of nearly three: canvas antialiases every ellipse and stroke edge, so
 * roughly 60% of a painted cel is a blend that matches no palette entry
 * literally — and edges are exactly where the thin features live (the coil, the
 * eye diamonds), so the undercount was worst on the things being measured.
 * Snapping is also what makes a share here comparable to the palette census's,
 * which is the number these assertions are argued against.
 */
function snapIdx(r: number, g: number, b: number): number {
  let best = 0;
  let bd = Infinity;
  for (let p = 0; p < PAL_RGB.length; p++) {
    const dr = (r - PAL_RGB[p][0]) * 0.3;
    const dg = (g - PAL_RGB[p][1]) * 0.59;
    const db = (b - PAL_RGB[p][2]) * 0.11;
    const d = dr * dr + dg * dg + db * db;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/** Opaque pixels that SNAP to one of `idx`, optionally within a row band. */
function countIdx(img: ImageData, idx: number[], within?: { y0: number; y1: number }): number {
  const want = new Set(idx);
  let n = 0;
  for (let y = within?.y0 ?? 0; y < (within?.y1 ?? CEL); y++) {
    for (let x = 0; x < CEL; x++) {
      const o = (y * CEL + x) * 4;
      if (img.data[o + 3] < 128) continue;
      if (want.has(snapIdx(img.data[o], img.data[o + 1], img.data[o + 2]))) n++;
    }
  }
  return n;
}

const clip = (p: ActorPaints, dir: Dir, name: string): FramePaint[] => {
  const f = (p[dir] as Record<string, FramePaint[] | undefined>)[name];
  if (!f?.length) throw new Error(`jester has no ${dir}:${name}`);
  return f;
};

const P = makeJesterPaints();

describe("jester art", () => {
  it("paints every clip in every authored direction", () => {
    for (const d of ["S", "N", "E"] as Dir[]) {
      for (const c of ["idle", "walk", "attack", "death"]) {
        for (const f of clip(P, d, c)) {
          expect(box(paint(f)).painted, `${d}:${c} painted nothing`).toBeGreaterThan(600);
        }
      }
    }
  });

  it("puts the attack telegraph in the SILHOUETTE: the spring compresses, then extends", () => {
    // The whole design claim. A player reads the wind-up off the creature's
    // height, at any facing, with no colour cue — so the height had better
    // actually change, and change in the right ORDER.
    for (const d of ["S", "N", "E"] as Dir[]) {
      const idle = box(paint(clip(P, d, "idle")[0])).y0;
      const load = box(paint(clip(P, d, "attack")[0])).y0;
      const fire = box(paint(clip(P, d, "attack")[1])).y0;
      // Compressed on the wind-up: the plate drops well below where it rests.
      expect(load, `${d}: wind-up is not visibly lower than idle`).toBeGreaterThan(idle + 6);
      // Extended on the release: it clears idle by a wide margin.
      expect(fire, `${d}: release is not visibly taller than idle`).toBeLessThan(idle - 8);
    }
  });

  it("shows greasepaint from the front and none from behind", () => {
    const paintIdx = [31]; // arcane light — the eye diamonds, and nothing else
    expect(countIdx(paint(clip(P, "S", "idle")[0]), paintIdx)).toBeGreaterThan(12);
    expect(countIdx(paint(clip(P, "E", "idle")[0]), paintIdx)).toBeGreaterThan(5);
    expect(countIdx(paint(clip(P, "N", "idle")[0]), paintIdx), "the back of the head has a face").toBe(0);
  });

  it("spends the torch ramp the palette census found unused", () => {
    // 2.26% across all actors was the finding. The motley, the plate rim and
    // the bells are the fix; a rewrite that quietly drops the gold half of the
    // checker would sail through every other test in this repo.
    const img = paint(clip(P, "S", "idle")[0]);
    const warm = countIdx(img, [14, 15, 16, 17, 18]);
    expect(warm / box(img).painted).toBeGreaterThan(0.09);
  });

  it("keeps a visible coil between the head and the plate", () => {
    // The spring is the second half of the silhouette and it is THIN, so it is
    // the part most likely to be lost to a proportion tweak. Sample the band
    // strictly above the skull: whatever steel is there is coil.
    const img = paint(clip(P, "S", "idle")[0]);
    const headTop = 118 - 60 - 13; // GROUND - HEAD_Y - HEAD_R
    const steel = countIdx(img, [19, 20, 21, 22], { y0: 8, y1: headTop - 2 });
    expect(steel, "no visible spring above the head").toBeGreaterThan(90);
  });

  it("does not read as the spitter, whose job it shares", () => {
    // Both kite and both shoot, so "ranged monster" is not an identity. The
    // jester is a tall narrow stack; the spitter is a hunched blob. If those
    // two silhouettes ever converge, the player has no way to know which shot
    // is coming — and that is precisely the mistake the tinted hound made.
    const j = box(paint(clip(P, "S", "idle")[0]));
    const s = box(paint(clip(makeSpitterPaints(), "S", "idle")[0]));
    expect(j.h / j.w, "jester is not markedly taller than it is wide").toBeGreaterThan(1.5);
    expect(j.h).toBeGreaterThan(s.h + 10);
  });
});
