/**
 * ROTORTAIL ART tests.
 *
 * Same shape as hound.test.ts and jester.test.ts, for the same reason: the
 * hound shipped for weeks as a red-tinted spider with every registry satisfied,
 * and the only thing that ever disagreed was the screen. These assert on
 * PIXELS, because a monster's identity is its silhouette and a test that checks
 * tables cannot see a silhouette.
 *
 * What is pinned here is exactly the claims the painter's header makes, each of
 * which would fail SILENTLY if a later edit walked it back:
 *
 *   1. THE ROTOR IS THE SILHOUETTE. A horizontal disc wider than the body, and
 *      wholly inside the cel. (It was NOT: the first mast height put the blade
 *      tips at y=0 and the top of the disc was clipped off by the cel edge.)
 *   2. IT IS AIRBORNE. There is a gap of empty rows between the body and its
 *      ground shadow. That gap IS the altitude — lose it and a flyer that hurls
 *      timber from above reads as a thing standing on the floor.
 *   3. THE ROTOR TURNS. Successive frames must differ in the disc, or the
 *      derived projection has quietly become a static sprite.
 *   4. THE FACE IS DIRECTIONAL. Lenses, teeth and belly in front; none behind.
 *      The first pass drew all three at every facing, so a rotortail flying
 *      away from you showed its goggles and its stomach.
 *   5. THE HOIST IS IN THE SILHOUETTE. The attack telegraph is a log lifted
 *      over the head — if that stops filling the band above the skull, the one
 *      warning the player gets has become an arm wiggle.
 *   6. THE STALL SAGS. A staggered rotortail loses altitude; that is the whole
 *      reward for reaching something that shoots from out of reach.
 *
 * Plus the one this creature is most at risk of: it is the roster's second
 * flyer and the bat's fellow orbiter, so it must not read as a bat.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { makeRotortailPaints } from "./rotortail";
import { makeBatPaints } from "../cel-painter";
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

function box(img: ImageData): { w: number; h: number; painted: number; y0: number; y1: number; x0: number; x1: number } {
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
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, painted, y0, y1, x0, x1 };
}

/** Leftmost-to-rightmost painted span on one row, 0 if the row is empty. */
function rowWidth(img: ImageData, y: number): number {
  let x0 = CEL, x1 = -1;
  for (let x = 0; x < CEL; x++) {
    if (img.data[(y * CEL + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  }
  return x1 < 0 ? 0 : x1 - x0 + 1;
}

/** Opaque pixels on one row. */
function rowCount(img: ImageData, y: number): number {
  let n = 0;
  for (let x = 0; x < CEL; x++) if (img.data[(y * CEL + x) * 4 + 3] > 8) n++;
  return n;
}

/** Opaque pixels in a row band. Used for the "is the log up?" measurement. */
function bandCount(img: ImageData, y0: number, y1: number): number {
  let n = 0;
  for (let y = y0; y < y1; y++) n += rowCount(img, y);
  return n;
}

const PAL_RGB = PALETTE_HEX.map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);

/**
 * Nearest palette entry under the SAME luma-weighted metric the sprite atlas
 * snaps with (engine/render/sprite.ts: weights 0.3/0.59/0.11). Counting exact
 * matches instead undercounts by roughly 3x, because canvas antialiases every
 * ellipse edge — and edges are exactly where the thin features live.
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

/** Opaque pixels that SNAP to one of `idx`. */
function countIdx(img: ImageData, idx: number[]): number {
  const want = new Set(idx);
  let n = 0;
  for (let y = 0; y < CEL; y++) {
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
  if (!f?.length) throw new Error(`rotortail has no ${dir}:${name}`);
  return f;
};

const P = makeRotortailPaints();
const DIRS: Dir[] = ["S", "N", "E"];

describe("rotortail art", () => {
  it("paints every clip in every authored direction", () => {
    for (const d of DIRS) {
      for (const c of ["idle", "walk", "attack", "stumble", "death"]) {
        for (const f of clip(P, d, c)) {
          expect(box(paint(f)).painted, `${d}:${c} painted nothing`).toBeGreaterThan(600);
        }
      }
    }
  });

  it("wears the rotor as its silhouette: a wide disc across the TOP, uncropped", () => {
    for (const d of DIRS) {
      const img = paint(clip(P, d, "idle")[0]);
      const b = box(img);
      // Nothing else in the roster is widest at its own crown. If a proportion
      // tweak ever makes the body the widest part, the one thing that
      // identifies this monster at a distance is gone.
      let widest = 0;
      let atY = 0;
      for (let y = b.y0; y <= b.y1; y++) {
        const w = rowWidth(img, y);
        if (w > widest) { widest = w; atY = y; }
      }
      expect(atY, `${d}: the widest row is not up at the rotor`).toBeLessThan(b.y0 + b.h * 0.25);
      // ...and the disc genuinely out-spans the barrel under it.
      const bodyWidth = rowWidth(img, b.y0 + Math.round(b.h * 0.45));
      expect(widest, `${d}: rotor is not wider than the body`).toBeGreaterThan(bodyWidth + 12);
      // THE CLIPPING BUG. The mast height is bounded by the cel: at 34 the blade
      // tips landed on y=0 and the top of the disc was silently cut off.
      expect(b.y0, `${d}: the rotor is clipped by the top of the cel`).toBeGreaterThan(0);
    }
  });

  it("flies: there is a gap of empty rows between the body and its shadow", () => {
    // The gap IS the altitude, and it is the only cue a 2D cel has for it. A
    // rotortail whose body drifts down onto its own shadow is a monster that
    // hurls timber from ground level, which is a different creature.
    for (const d of DIRS) {
      const img = paint(clip(P, d, "idle")[0]);
      const b = box(img);
      let longest = 0;
      let run = 0;
      for (let y = b.y0; y <= b.y1; y++) {
        if (rowCount(img, y) === 0) { run++; if (run > longest) longest = run; } else run = 0;
      }
      expect(longest, `${d}: body and shadow have merged — nothing reads as airborne`).toBeGreaterThan(14);
    }
  });

  it("turns the rotor between frames rather than pasting one disc", () => {
    // The blades are a projection of a rotor ANGLE (bladeProjection), so two
    // frames at different spins must differ across the disc. If someone caches
    // one blade shape or drops the per-frame spin step, this is what notices.
    for (const d of DIRS) {
      const a = paint(clip(P, d, "idle")[0]);
      const c = paint(clip(P, d, "idle")[1]);
      const top = box(a).y0;
      let diff = 0;
      for (let y = top; y < top + 19; y++) {
        for (let x = 0; x < CEL; x++) {
          const o = (y * CEL + x) * 4;
          if ((a.data[o + 3] > 128) !== (c.data[o + 3] > 128)) diff++;
        }
      }
      expect(diff, `${d}: the rotor is identical between idle frames`).toBeGreaterThan(150);
    }
  });

  it("shows lenses, teeth and belly from the front — and NONE of them from behind", () => {
    const front = paint(clip(P, "S", "idle")[0]);
    const side = paint(clip(P, "E", "idle")[0]);
    const back = paint(clip(P, "N", "idle")[0]);

    // Goggle glass: the only cold hue on the creature, so 30/31 is unambiguous.
    expect(countIdx(front, [30, 31])).toBeGreaterThan(30);
    expect(countIdx(side, [30, 31])).toBeGreaterThan(8);
    expect(countIdx(back, [30, 31]), "the back of the helmet has goggle lenses").toBe(0);

    // Chisel teeth: steel-light, and nothing else on the creature is that pale.
    expect(countIdx(front, [22])).toBeGreaterThan(8);
    expect(countIdx(back, [22]), "the back of the head has teeth").toBe(0);

    // Belly: the pale skin patch. Not zero from behind — the pelt's own
    // highlight tone blends into 25 at edges — but it must not be a STOMACH.
    const bellyFront = countIdx(front, [25]);
    expect(countIdx(back, [25]) * 1.6, "a rotortail flying away shows its belly")
      .toBeLessThan(bellyFront);
  });

  it("puts the attack telegraph in the SILHOUETTE: a log lifted over the head", () => {
    // The band between the rotor hub and the skull. In idle and in flight it
    // holds the mast and nothing else; through the throw it holds the timber.
    // Measuring the band rather than the whole frame on purpose — total pixel
    // counts move by a few percent for pose reasons and would not survive as a
    // threshold, and one facing's attack already paints FEWER pixels than its
    // idle. Where the mass is, is the claim; how much there is, is not.
    for (const d of DIRS) {
      const rest = bandCount(paint(clip(P, d, "idle")[0]), 18, 36);
      const flight = bandCount(paint(clip(P, d, "walk")[0]), 18, 36);
      expect(Math.abs(flight - rest), `${d}: flight already fills the hoist band`).toBeLessThan(60);
      for (const [i, f] of clip(P, d, "attack").entries()) {
        expect(bandCount(paint(f), 18, 36), `${d}: attack f${i} is not hoisting anything`)
          .toBeGreaterThan(rest + 150);
      }
    }
  });

  it("sags when the rotor stalls", () => {
    // A staggered rotortail loses ALTITUDE — that is what `stumble` is for, and
    // it is the payoff for closing on something that shoots from out of reach.
    // Measured off the top of the box, which is the rotor: if the whole creature
    // drops, the disc drops with it.
    for (const d of DIRS) {
      const up = box(paint(clip(P, d, "idle")[0])).y0;
      const sag = box(paint(clip(P, d, "stumble")[1])).y0;
      expect(sag, `${d}: a stalled rotortail has not lost any height`).toBeGreaterThan(up + 8);
    }
  });

  it("does not read as the bat, the other flyer it orbits alongside", () => {
    // Both fly, both run the `orbiter` policy, and in a crowd the player has to
    // know which one is winding up a log. A tinted-hound-shaped mistake here
    // would be two flying silhouettes that differ only in colour.
    const r = box(paint(clip(P, "S", "idle")[0]));
    const b = box(paint(clip(makeBatPaints(), "S", "idle")[0]));
    expect(r.painted, "rotortail is not visibly bulkier than a bat").toBeGreaterThan(b.painted * 2.5);
    expect(r.w, "rotortail is not visibly wider than a bat").toBeGreaterThan(b.w + 15);
  });
});
