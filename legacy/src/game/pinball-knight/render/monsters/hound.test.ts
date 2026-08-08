/**
 * HOUND ART tests.
 *
 * The hound shipped for weeks as a red-tinted SPIDER, and nothing failed —
 * every registry was satisfied, `kind` said "hound", the card said "Hound", and
 * the only thing that disagreed was the screen. The lesson (and the reason this
 * file asserts on PIXELS rather than on wiring) is that a monster's identity is
 * its silhouette, and a test that checks the tables cannot see the silhouette.
 *
 * So: the hound must be its own art, it must be shaped like a charger, and its
 * charge tell must not look like its walk.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { makeHoundPaints } from "./hound";
import { makeSpiderPaints } from "../cel-painter";
import { MOVEMENT_BY_KIND } from "../../entities/enemy-rules";
import { clipDemand } from "../../testkit/tell-clip-demand";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

const realDoc = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

const CEL = 128;

/** Paint one frame onto a fresh cel and hand back its pixels. */
function paint(f: FramePaint): ImageData {
  const cv = createCanvas(CEL, CEL);
  const ctx = cv.getContext("2d") as unknown as CanvasRenderingContext2D;
  f(ctx);
  return (ctx as unknown as { getImageData: (a: number, b: number, c: number, d: number) => ImageData })
    .getImageData(0, 0, CEL, CEL);
}

/** The painted bounding box, and how many pixels are opaque. */
function box(img: ImageData): { w: number; h: number; painted: number; x0: number; x1: number } {
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
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, painted, x0, x1 };
}

const first = (p: ActorPaints, dir: Dir, clip: string): FramePaint => {
  const f = (p[dir] as Record<string, FramePaint[] | undefined>)[clip];
  if (!f?.length) throw new Error(`hound has no ${dir}:${clip}`);
  return f[0];
};

describe("hound art", () => {
  const hound = makeHoundPaints();

  it("paints something in every direction and clip the spawner can ask for", () => {
    // `run` is the charge; without it the dash falls back to walk and the
    // fastest thing on the floor animates like it is strolling.
    for (const dir of ["S", "N", "E"] as Dir[]) {
      for (const clip of ["idle", "walk", "attack", "run", "death"]) {
        const b = box(paint(first(hound, dir, clip)));
        expect(b.painted, `${dir}:${clip} painted nothing`).toBeGreaterThan(200);
      }
    }
  });

  it("is a LONG LOW quadruped in profile — the charge axis is the silhouette", () => {
    // The whole point of the redraw: a hound is wider than it is tall, because
    // it is drawn along the line it charges down. Every other monster here is
    // taller than it is wide, which is exactly why the spider reskin misread.
    const b = box(paint(first(hound, "E", "idle")));
    expect(b.w, "profile hound should be wider than tall").toBeGreaterThan(b.h);
  });

  it("does NOT paint the same picture as the spider it used to borrow", () => {
    // The regression that matters. If someone re-points the hound at
    // sheetFor("spider"), these two become identical and this fails.
    const spider = makeSpiderPaints();
    for (const dir of ["S", "E"] as Dir[]) {
      const h = paint(first(hound, dir, "idle"));
      const s = paint(first(spider, dir, "idle"));
      let same = 0;
      for (let i = 0; i < h.data.length; i += 4) {
        if (h.data[i] === s.data[i] && h.data[i + 1] === s.data[i + 1] &&
            h.data[i + 2] === s.data[i + 2] && h.data[i + 3] === s.data[i + 3]) same++;
      }
      const identical = same / (h.data.length / 4);
      expect(identical, `${dir}:idle is pixel-identical to the spider`).toBeLessThan(0.98);
    }
  });

  it("AUTHORS EVERY CLIP ITS OWN POLICY ASKS FOR — derived, not restated", () => {
    // The defect this catches shipped and was invisible for weeks. The gather
    // was authored as `attack`; `enemy-rules` gives the hound the `leaper`
    // policy, whose telegraph resolves (render/tell-clips.ts) to `crouch`; the
    // painter authored no `crouch`, so CLIP_FALLBACK sent the charge tell to
    // `idle` and the pose the creature was designed around never played. Every
    // test in this file was green throughout, because they all asked about
    // `attack` — the clip the mechanic had stopped requesting.
    //
    // So take neither name on faith. Read the hound's policy out of the rules
    // table, RUN that policy, and ask the same mapping the renderer asks.
    const demanded = clipDemand(MOVEMENT_BY_KIND.hound);
    expect(demanded, "the leaper policy raised no telegraph pose at all").not.toHaveLength(0);
    for (const dir of ["S", "N", "E"] as Dir[]) {
      const authored = hound[dir] as Record<string, FramePaint[] | undefined>;
      for (const clip of demanded) {
        expect(
          authored[clip]?.length ?? 0,
          `${dir}: the game asks a hound for "${clip}" and the painter authors none — it will fall back and the tell will not read`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("the CHARGE TELL reads differently from the walk", () => {
    // HOUND_CHARGE_WINDUP is 0.45s of warning. A tell that paints the same
    // pixels as ordinary movement is not a warning, it is decoration.
    const walk = paint(first(hound, "E", "walk"));
    const tell = paint(first(hound, "E", "crouch"));
    let diff = 0;
    for (let i = 3; i < walk.data.length; i += 4) {
      if ((walk.data[i] > 8) !== (tell.data[i] > 8)) diff++;
    }
    expect(diff, "the crouch is indistinguishable from the walk").toBeGreaterThan(150);
  });

  it("bristles: the gather raises the ridge FURTHER above the back", () => {
    // The ridge is the one mark you can read in silhouette at gameplay
    // distance, and it is supposed to stand up when the hound gathers.
    //
    // Measured as the ridge's height ABOVE ITS OWN BACK, not as the top of the
    // silhouette and not by colour:
    //
    //  · not the silhouette top — the gather also DROPS the whole body ~7px (a
    //    loaded hound sinks), so a crouching frame's highest pixel is lower
    //    even while the quills are taller. That measures the body drop.
    //  · not by colour — these painters write PALETTE INDICES as grey values
    //    and the hues arrive later in the quantize shader, so every pixel here
    //    is greyscale and "count the red ones" counts nothing. (Confirmed by
    //    histogram: the frames are 17,17,17 / 51,51,51 / 170,170,170.)
    //
    // What is left is geometry. Over the spine the quills are the only thing
    // above the trunk, so scan the middle columns of the body and measure the
    // gap between the topmost painted pixel and the solid back beneath it.
    const ridgeRise = (img: ImageData): number => {
      const alpha = (x: number, y: number): boolean => img.data[(y * CEL + x) * 4 + 3] > 8;
      let best = 0;
      // Body columns only — skip the head/ears (right) and the tail (left).
      for (let x = 44; x <= 78; x++) {
        let top = -1;
        for (let y = 0; y < CEL; y++) if (alpha(x, y)) { top = y; break; }
        if (top < 0) continue;
        // Walk down from the top until the column becomes CONTINUOUSLY solid —
        // that boundary is the back. The distance to it is the quill.
        let y = top;
        while (y < CEL - 3 && !(alpha(x, y) && alpha(x, y + 1) && alpha(x, y + 2) && alpha(x, y + 3))) y++;
        best = Math.max(best, y - top);
      }
      return best;
    };
    const walkFrames = (hound.E as Record<string, FramePaint[] | undefined>).walk!;
    const tellFrames = (hound.E as Record<string, FramePaint[] | undefined>).attack!;
    const walkRise = Math.max(...walkFrames.map((f) => ridgeRise(paint(f))));
    const tellRise = Math.max(...tellFrames.map((f) => ridgeRise(paint(f))));
    expect(tellRise, "the gather does not bristle higher than a walk").toBeGreaterThan(walkRise);
  });

  it("death collapses — the corpse is flatter than the standing animal", () => {
    const standing = box(paint(first(hound, "E", "idle")));
    const deathFrames = (hound.E as Record<string, FramePaint[] | undefined>).death!;
    const corpse = box(paint(deathFrames[deathFrames.length - 1]));
    expect(corpse.h, "corpse is not flatter than the standing hound").toBeLessThan(standing.h);
  });
});
