/**
 * CROAKER ART tests — the same discipline hound.test.ts sets: assert on PIXELS,
 * because a monster's identity is its silhouette and a test that checks tables
 * cannot see a silhouette.
 *
 * What is pinned is the three things the painter's header claims, each of which
 * is a RULE the player has to read off the sprite:
 *
 *   1. WIDE AND LOW. It is the only horizontal-oval silhouette on the roster,
 *      and that shape is the promise that it goes over things.
 *   2. THE HOP IS A STRETCH. `crouch` (the tell) and `run` (airborne) must be
 *      visibly different extensions of one creature, or a leap that crosses a
 *      wall reads as teleporting.
 *   3. THE EYES ARE THE WEAPON, and only they fire. The beams must leave the
 *      eyes and must NOT cross the body — an earlier cut converged them on a
 *      shared point in front, which head-on is behind the creature's own chin,
 *      and both strokes ran across its belly.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { makeCroakerPaints } from "./croaker";
import { makeSpitterPaints } from "../cel-painter";
import { PALETTE_HEX, installPalette } from "../palette";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

const realDoc = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
  installPalette();
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

const CEL = 128;
const PAL_RGB = PALETTE_HEX.map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);

function paint(f: FramePaint): ImageData {
  const cv = createCanvas(CEL, CEL);
  const ctx = cv.getContext("2d") as unknown as CanvasRenderingContext2D;
  f(ctx);
  return (ctx as unknown as { getImageData: (a: number, b: number, c: number, d: number) => ImageData })
    .getImageData(0, 0, CEL, CEL);
}

function box(img: ImageData): { w: number; h: number; painted: number; y0: number } {
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
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, painted, y0 };
}

/** Nearest palette index under the atlas's own luma-weighted metric — see
 *  measuring-a-cel: exact matching undercounts ~3x because of antialiasing. */
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

/** Opaque pixels snapping to `idx`, optionally inside a box. */
function countIdx(img: ImageData, idx: number[], within?: { x0: number; x1: number; y0: number; y1: number }): number {
  const want = new Set(idx);
  let n = 0;
  for (let y = within?.y0 ?? 0; y < (within?.y1 ?? CEL); y++) {
    for (let x = within?.x0 ?? 0; x < (within?.x1 ?? CEL); x++) {
      const o = (y * CEL + x) * 4;
      if (img.data[o + 3] < 128) continue;
      if (want.has(snapIdx(img.data[o], img.data[o + 1], img.data[o + 2]))) n++;
    }
  }
  return n;
}

const clip = (p: ActorPaints, dir: Dir, name: string): FramePaint[] => {
  const f = (p[dir] as Record<string, FramePaint[] | undefined>)[name];
  if (!f?.length) throw new Error(`croaker has no ${dir}:${name}`);
  return f;
};

const P = makeCroakerPaints();

describe("croaker art", () => {
  it("paints every clip in every authored direction", () => {
    for (const d of ["S", "N", "E"] as Dir[]) {
      for (const c of ["idle", "walk", "attack", "crouch", "run", "stumble", "death"]) {
        for (const f of clip(P, d, c)) {
          expect(box(paint(f)).painted, `${d}:${c} painted nothing`).toBeGreaterThan(500);
        }
      }
    }
  });

  it("is WIDE AND LOW — the silhouette that promises it goes over things", () => {
    for (const d of ["S", "N"] as Dir[]) {
      const b = box(paint(clip(P, d, "idle")[0]));
      expect(b.w / b.h, `${d}: not a horizontal oval`).toBeGreaterThan(1.35);
    }
  });

  it("does not read as the spitter, whose ranged-kiter job it shares", () => {
    const c = box(paint(clip(P, "S", "idle")[0]));
    const s = box(paint(makeSpitterPaints().S.idle![0]));
    // The spitter is a hunched upright blob; this must not converge on it.
    expect(c.w / c.h).toBeGreaterThan((s.w / s.h) * 1.3);
  });

  it("puts the hop in the SILHOUETTE: crouch is gathered, airborne is lifted", () => {
    for (const d of ["S", "N", "E"] as Dir[]) {
      const idle = box(paint(clip(P, d, "idle")[0]));
      const crouch = box(paint(clip(P, d, "crouch")[0]));
      const air = box(paint(clip(P, d, "run")[0]));
      // Gathered: wider and flatter than at rest.
      expect(crouch.w, `${d}: the crouch tell is not wider than idle`).toBeGreaterThan(idle.w);
      // Airborne: the whole body has left the floor, so the top edge climbs.
      expect(air.y0, `${d}: the airborne pose is not lifted off the ground`).toBeLessThan(idle.y0);
    }
  });

  it("fires from the EYES, and the beams stay off its own body", () => {
    const rest = paint(clip(P, "S", "attack")[0]); // charging, no beam yet
    const firing = paint(clip(P, "S", "attack")[2]); // full beam
    const beamIdx = [13, 17];
    expect(countIdx(firing, beamIdx), "no beam was drawn").toBeGreaterThan(
      countIdx(rest, beamIdx) + 120,
    );
    // The belly column: a narrow band down the centre of the creature. The
    // convergent version ran BOTH strokes through here, which is what "shooting
    // itself" looked like. Splayed, this band gains essentially nothing.
    const band = { x0: CEL / 2 - 7, x1: CEL / 2 + 7, y0: 70, y1: 108 };
    const added = countIdx(firing, beamIdx, band) - countIdx(rest, beamIdx, band);
    expect(added, "the beams are crossing the creature's own belly").toBeLessThan(30);
  });

  it("spends the gold spots that stop it reading as a zombie", () => {
    // Rot-green is the ZOMBIE colour and the floor paint uses it too. The spots
    // are the hue break that makes this a frog; losing them is a silent
    // regression that no other test in the repo would notice.
    const img = paint(clip(P, "S", "idle")[0]);
    const warm = countIdx(img, [14, 15, 16, 17]);
    expect(warm / box(img).painted).toBeGreaterThan(0.06);
  });

  it("melts into a puddle on the last death frame", () => {
    const frames = clip(P, "S", "death");
    const last = box(paint(frames[frames.length - 1]));
    const first = box(paint(frames[0]));
    expect(last.h, "the final death pose is not flatter than the first").toBeLessThan(first.h * 0.55);
  });
});
